/**
 * Offline catch-up: replay events that happened while the user was logged out.
 *
 * The "last seen" anchor is now server-tracked (cross-device, persistent):
 *   - `User.lastSeenAt` is populated by /user/me on login
 *   - `PUT /user/heartbeat` updates it during active use
 *   - localStorage is kept as a tier-2 fallback for when the new endpoints
 *     are unreachable (network blip, backend down)
 *
 * The flow:
 *   1. On login, read `auth.currentUser.lastSeenAt` (came back with /user/me)
 *   2. Fetch /message/received + /diary/all, filter by createTime > lastSeenAt
 *   3. Surface a sequenced toast queue (oldest first, ~900ms apart)
 *   4. Send a heartbeat to push lastSeenAt forward to "now"
 *   5. While the tab is visible, heartbeat every 30s
 *
 * Online state is intentionally ignored: catch-up is about "what did I miss
 * while I was away," not "what is the partner's current presence."
 */
import { ElNotification } from 'element-plus'
import { getReceivedMessages } from '@/api/message'
import { getAllDiaries } from '@/api/diary'
import { heartbeat as apiHeartbeat, getLastSeen as apiGetLastSeen } from '@/api/user'
import { useAuthStore } from '@/stores/auth'
import { getPartnerDisplayName } from '@/constants/user'
import type { Message, Diary } from '@/types'

// v2: previous versions had a bug where beforeunload could write a
// too-recent local anchor that wasn't reflected on the server, causing
// silent event-swallowing on the next login. Bumping the storage key
// invalidates any leftover bad anchors from those builds.
const STORAGE_KEY = 'to-my-l:lastSeenAt:v2'
const TOAST_INTERVAL_MS = 900
const MAX_PER_KIND = 5

/** Module-level guard so concurrent run() / refocus events don't replay
 *  the same events twice. Cleared on completion or error. */
let runInFlight = false

interface CatchupItem {
  kind: 'message' | 'diary'
  ts: number
  payload: Message | Diary
}

function localKey(userId: number): string {
  return `${STORAGE_KEY}:${userId}`
}
function readLocalLastSeen(userId: number): number {
  const raw = localStorage.getItem(localKey(userId))
  const n = raw ? parseInt(raw, 10) : 0
  return Number.isFinite(n) ? n : 0
}
function writeLocalLastSeen(userId: number, ts: number) {
  localStorage.setItem(localKey(userId), String(ts))
}

/** Parse 'yyyy-MM-dd HH:mm:ss' (server format, Asia/Shanghai). */
function parseServerTime(s: string): number {
  return new Date(s.replace(' ', 'T')).getTime()
}

/** Format an epoch back into the server's yyyy-MM-dd HH:mm:ss. We use this
 *  to keep `currentUser.lastSeenAt` in sync with what we've already seen,
 *  so a same-session refresh (which re-reads currentUser.lastSeenAt as the
 *  catch-up anchor) doesn't replay events that already toasted. */
function formatLocalTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} `
    + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function useOfflineCatchup() {
  const auth = useAuthStore()

  /** Push "I'm here" to the backend. **Server-first**: only after the
   *  heartbeat call resolves do we mirror the new timestamp into the
   *  in-memory user object and localStorage. Otherwise a beforeunload-style
   *  call could write local while leaving the server value stale, then on
   *  next login we'd resolve `since` from a too-recent local anchor and
   *  silently swallow events that arrived after the user actually left. */
  async function markSeen() {
    if (!auth.currentUser) return
    const userId = auth.currentUser.id
    try {
      await apiHeartbeat()
    } catch (err) {
      // Loud — silently swallowing this would let "since" drift forever
      // backwards if the heartbeat endpoint is broken (most common cause:
      // last_seen_at column not added to the user table). Don't update
      // local state — keep the existing anchor so we don't pretend more
      // time has passed than the server thinks.
      console.warn(
        '%c[catchup] %cheartbeat failed — server lastSeenAt not advanced. '
        + 'Keeping previous local anchor to avoid silently swallowing events.',
        'color: #f43f5e; font-weight: bold;',
        'color: #5C4A52;',
        err,
      )
      return
    }
    // Server confirmed. Mirror the timestamp locally so a same-session
    // refresh / refocus sees the same value without re-fetching /user/me.
    const now = Date.now()
    writeLocalLastSeen(userId, now)
    if (auth.currentUser) {
      auth.currentUser.lastSeenAt = formatLocalTime(now)
    }
  }

  /** Resolve the "what should we replay since" timestamp.
   *
   *  Server is the single source of truth — it's the only value advanced
   *  exclusively by successful heartbeats, so it always reflects "the last
   *  time we *know* the user looked at the app." localStorage is only used
   *  if the server has no record at all (offline first run, or server
   *  endpoint not yet deployed); we do NOT take max(server, local), because
   *  a too-recent local anchor (e.g. from a beforeunload write that didn't
   *  reach the server) would silently swallow events that arrived between
   *  the local write and the next login. */
  async function resolveSinceMs(userId: number): Promise<number | null> {
    const fromMe = auth.currentUser?.lastSeenAt
    if (fromMe) return parseServerTime(fromMe)

    try {
      const res = await apiGetLastSeen()
      if (res.data?.lastSeenAt) return parseServerTime(res.data.lastSeenAt)
    } catch {
      // server unreachable — fall through to local fallback
    }

    // True last-resort: server has never seen this user (or the endpoint
    // is broken). Use whatever local anchor we have, otherwise null.
    const local = readLocalLastSeen(userId)
    return local > 0 ? local : null
  }

  /** Run on login (or refocus). Re-entrant safe — concurrent calls share
   *  the in-flight result, so a slow network can't fan out duplicate
   *  toasts when both `onMounted` and a `watch` fire on the same login. */
  async function run() {
    if (runInFlight) return
    runInFlight = true
    try {
      await runImpl()
    } finally {
      runInFlight = false
    }
  }

  async function runImpl() {
    const me = auth.currentUser
    if (!me) return

    const since = await resolveSinceMs(me.id)
    // Brand-new account / first device / never-heartbeat'd: bookmark now
    // and exit without dumping history.
    if (since === null) {
      console.log(
        '%c[catchup] %cno prior anchor — first run on this account, bookmarking now',
        'color: #8b5cf6; font-weight: bold;', 'color: #5C4A52;',
      )
      await markSeen()
      return
    }

    console.log(
      `%c[catchup] %csince = ${formatLocalTime(since)} (${since})`,
      'color: #8b5cf6; font-weight: bold;', 'color: #5C4A52;',
    )

    const items: CatchupItem[] = []

    try {
      const recv = await getReceivedMessages()
      const totalUnread = recv.data.filter(m => !m.isRead).length
      const fresh = recv.data
        .filter(m => !m.isRead && parseServerTime(m.createTime) > since)
        .sort((a, b) => parseServerTime(a.createTime) - parseServerTime(b.createTime))
        .slice(-MAX_PER_KIND)
      console.log(
        `%c[catchup] %cmessages: ${recv.data.length} total, ${totalUnread} unread, ${fresh.length} fresh after since`,
        'color: #8b5cf6; font-weight: bold;', 'color: #5C4A52;',
      )
      for (const m of fresh) items.push({ kind: 'message', ts: parseServerTime(m.createTime), payload: m })
    } catch (err) { console.warn('[catchup] getReceivedMessages failed', err) }

    try {
      const diaries = await getAllDiaries()
      const partnerCount = diaries.data.filter(d => d.userId !== me.id).length
      const fresh = diaries.data
        .filter(d => d.userId !== me.id && parseServerTime(d.createTime) > since)
        .sort((a, b) => parseServerTime(a.createTime) - parseServerTime(b.createTime))
        .slice(-MAX_PER_KIND)
      console.log(
        `%c[catchup] %cdiaries: ${diaries.data.length} total, ${partnerCount} from partner, ${fresh.length} fresh after since`,
        'color: #8b5cf6; font-weight: bold;', 'color: #5C4A52;',
      )
      for (const d of fresh) items.push({ kind: 'diary', ts: parseServerTime(d.createTime), payload: d })
    } catch (err) { console.warn('[catchup] getAllDiaries failed', err) }

    // Bookmark immediately so a refresh mid-replay won't repeat anything.
    // This pushes server lastSeenAt and (on success) the in-memory mirror
    // forward; on failure it leaves the previous anchor intact.
    await markSeen()

    if (items.length === 0) return

    items.sort((a, b) => a.ts - b.ts)
    const partnerName = getPartnerDisplayName(me.id)

    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      setTimeout(() => surface(it, partnerName), i * TOAST_INTERVAL_MS)
    }
  }

  function surface(it: CatchupItem, partnerName: string) {
    if (it.kind === 'message') {
      const m = it.payload as Message
      ElNotification({
        title: '💌 离线期间收到的漂流瓶',
        message: `${partnerName}给你写了一封：${truncate(m.content, 40)}`,
        type: 'success',
        duration: 5000,
        position: 'top-right',
      })
    } else {
      const d = it.payload as Diary
      ElNotification({
        title: '📖 离线期间的新日记',
        message: `${partnerName}写了：${d.title}`,
        type: 'success',
        duration: 5000,
        position: 'top-right',
      })
    }
  }

  function truncate(s: string, n: number): string {
    return s.length > n ? s.slice(0, n) + '…' : s
  }

  return { run, markSeen }
}
