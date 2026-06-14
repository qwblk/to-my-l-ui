import { onMounted, onUnmounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useChatStore } from '@/stores/chat'
import { ElNotification } from 'element-plus'
import type { MomentMedia, WsMessage } from '@/types'
import { getPartnerDisplayName } from '@/constants/user'
import { getSettings } from '@/composables/useSettings'
import { useRoute } from 'vue-router'

/** During the first N ms after WS connect we treat presence transitions as
 *  "replay of existing state", not real flips — so login doesn't pop a
 *  toast about the partner already being online. */
const LOGIN_GRACE_MS = 4000

export function useGlobalEvents() {
  const auth = useAuthStore()
  const chat = useChatStore()
  const route = useRoute()
  let unsub: (() => void) | null = null
  let lastAnnouncedOnline = false

  onMounted(() => {
    unsub = chat.onEvent(handleEvent)
    lastAnnouncedOnline = chat.partnerOnline
  })

  onUnmounted(() => { unsub?.() })

  function inLoginGrace(): boolean {
    return chat.connectedAt > 0 && Date.now() - chat.connectedAt < LOGIN_GRACE_MS
  }

  /** Are we currently watching the live chat? Then no toast for incoming chat. */
  function isOnChatPage(): boolean {
    return route.path === '/chat'
  }
  /** Tab in the background or device sleeping → desktop notification path. */
  function isHidden(): boolean {
    return typeof document !== 'undefined' && document.visibilityState !== 'visible'
  }

  /** Best-effort desktop notification. We don't aggressively prompt for
   *  permission here — that's the chat composer's responsibility on a real
   *  user gesture. We just use the permission if it's already granted. */
  function desktopNotify(title: string, body: string) {
    if (typeof Notification === 'undefined') return
    if (Notification.permission !== 'granted') return
    const opts: NotificationOptions & { tag?: string } = {
      body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: 'tml-chat',
    }
    // Service-worker route — works when the page is fully backgrounded /
    // throttled / closed (mobile Chrome, PWA installed). The plain
    // `new Notification(...)` path only fires while the page is alive.
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (reg && typeof reg.showNotification === 'function') {
          reg.showNotification(title, opts).catch(() => fallbackNotify(title, opts))
        } else {
          fallbackNotify(title, opts)
        }
      }).catch(() => fallbackNotify(title, opts))
    } else {
      fallbackNotify(title, opts)
    }
  }

  function fallbackNotify(title: string, opts: NotificationOptions) {
    try {
      const n = new Notification(title, opts)
      n.onclick = () => {
        try { window.focus() } catch { /* ignore */ }
        n.close()
      }
    } catch {
      // Browsers in privacy modes / iframes throw — best-effort only.
    }
  }

  function handleEvent(msg: WsMessage) {
    // Skip own echoes
    if (msg.sender === auth.currentUser?.name) return

    // === Live chat from the partner ===
    if (msg.type === 'chat') {
      // Currently watching the chat tab → no overlay; the bubble in the
      // ChatView is feedback enough.
      if (isOnChatPage()) return
      const partnerName = msg.sender || (auth.currentUser?.id ? getPartnerDisplayName(auth.currentUser.id) : '对方')
      const media = (msg.data?.mediaList as MomentMedia[] | undefined) || []
      const preview = msg.content?.trim()
        ? msg.content
        : media.length
          ? (media[0].type === 'image' ? '[图片]' : '[视频]')
          : ''
      const title = '💬 ' + partnerName
      const body = preview
      // Tab in the background → real desktop notification (also keep the
      // in-app toast so when the user comes back the recent state is still
      // visible). Foreground → just toast.
      if (isHidden()) {
        desktopNotify(title, body)
      }
      notify(title, body, 'success')
      return
    }

    // Snapshot-style frames are NEVER toasted. `status` is the initial
    // presence snapshot the server sends to a freshly-connected client;
    // `history` is reserved for future server-side replay frames. Both
    // describe state, not events.
    if (msg.type === 'status' || msg.type === 'history') {
      // Silently sync our presence cache so the next real online/offline
      // diff has a correct baseline.
      lastAnnouncedOnline = chat.partnerOnline
      return
    }

    const partnerName = auth.currentUser?.id
      ? getPartnerDisplayName(auth.currentUser.id)
      : '对方'

    // === Presence: online / offline ===
    if (msg.type === 'online' || msg.type === 'offline') {
      // Silent during the login grace — that "online" is replay, not new.
      if (inLoginGrace()) {
        lastAnnouncedOnline = chat.partnerOnline
        return
      }
      if (msg.type === 'online') {
        if (lastAnnouncedOnline) return
        lastAnnouncedOnline = true
        if (getSettings().toastPresence) notify('🟢 上线提醒', partnerName + ' 上线了', 'success')
        return
      }
      // offline: only pop if we'd previously announced "online"
      if (!lastAnnouncedOnline) return
      lastAnnouncedOnline = false
      if (getSettings().toastPresence) notify('🔴 离线提醒', partnerName + ' 离线了', 'info')
      return
    }

    // === Business events: diary / moment / like / comment / message / read ===
    // These ALWAYS notify when the user is currently in-app. Offline catch-up
    // (events that happened while the user was logged out) is handled by
    // useOfflineCatchup, not here.
    //
    // Filter by *originator* — every business event carries the actor's id
    // in `data` (sender is always "SYSTEM"). The actor toasts no one but
    // their counterpart:
    //
    //   diary / moment / like / comment  → data.userId is the author
    //   message                          → data.senderId is the writer
    //   read                             → data.senderId is the writer of
    //                                      the original letter (i.e. the
    //                                      person we *should* tell that
    //                                      their letter was read). The
    //                                      reader (other side) gets nothing.
    const myId = auth.currentUser?.id
    const data = (msg.data || {}) as Record<string, unknown>
    const actorId = (data.senderId ?? data.userId) as number | undefined

    // For 'message': only the receiver should see the toast.
    if (msg.type === 'message') {
      const receiverId = data.receiverId as number | undefined
      if (receiverId !== myId) return
    } else if (msg.type === 'read') {
      // For 'read': data.senderId is the original letter's writer — i.e.
      // the user who deserves to know "she opened it." Anyone else stays
      // silent (the reader herself has no business getting a toast).
      const originalSender = data.senderId as number | undefined
      if (originalSender !== myId) return
    } else {
      // For diary / moment / like / comment: skip if I'm the actor.
      if (actorId !== undefined && actorId === myId) return
    }

    const titleMap: Record<string, string> = {
      diary: '📖 新日记',
      moment: '📷 新动态',
      like: '❤️ 点赞',
      comment: '💬 新评论',
      message: '💌 新漂流瓶',
      read: '✅ 已读回执',
    }
    const contentMap: Record<string, string> = {
      diary: partnerName + '写了一篇新日记',
      moment: partnerName + '分享了新的瞬间',
      like: msg.content || partnerName + '给你的动态点了赞',
      comment: msg.content || partnerName + '评论了你的动态',
      message: partnerName + '给你写了一封漂流瓶',
      read: partnerName + '看到了你的漂流瓶',
    }

    // Per-type opt-out from settings
    const settings = getSettings()
    const enabled: Record<string, boolean> = {
      diary: settings.toastNewDiary,
      moment: settings.toastNewMoment,
      like: settings.toastNewMoment,
      comment: settings.toastNewMoment,
      message: settings.toastNewMessage,
      read: settings.toastReadReceipt,
    }
    if (!enabled[msg.type]) return

    if (titleMap[msg.type]) {
      notify(titleMap[msg.type], contentMap[msg.type] || msg.content, 'success')
    }
  }

  function notify(title: string, message: string, type: 'success' | 'info') {
    ElNotification({
      title,
      message,
      type,
      duration: 4000,
      position: 'top-right',
    })
  }
}
