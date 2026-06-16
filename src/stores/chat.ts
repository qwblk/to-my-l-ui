import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getChatHistory } from '@/api/chat'
import { WS_BASE } from '@/config/env'
import type { ChatMessage, MomentMedia, WsMessage } from '@/types'

const HEART_MARKER = '__TML_HEART__'
const HISTORY_PAGE_SIZE = 30

export type WsEventCallback = (msg: WsMessage) => void

export const useChatStore = defineStore('chat', () => {
  const messages = ref<WsMessage[]>([])
  const partnerOnline = ref(false)
  const lastEventTime = ref(0)
  const lastEventType = ref('')
  const isConnected = ref(false)
  const loadingHistory = ref(false)
  const historyCursor = ref<string | null>(null)
  const historyCursorId = ref<number | null>(null)
  const historyHasMore = ref(true)
  const historyLoaded = ref(false)
  const historyError = ref('')
  /** Unread chat messages — incremented on every incoming partner chat
   *  unless the user is currently on the chat page. Cleared by
   *  markChatRead() (called on chat-page enter). */
  const chatUnread = ref(0)

  let ws: WebSocket | null = null
  let myUsername = ''
  let myDisplayName = ''
  /** Set by callers (auth store) so presence frames can be self-identified
   *  by stable id rather than name. The string-based isSelf() is still kept
   *  as a fallback for older backend frames that don't carry data.userId. */
  let myUserId: number | null = null
  let shouldReconnect = true
  /** Set when the server tells us a new session has signed in with the
   *  same account. Both the kicked WS frame and the close(4001) path read
   *  this so we don't reconnect and don't double-announce. */
  let kickedFlag = false
  const eventListeners: WsEventCallback[] = []
  let loginGraceTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  function onEvent(cb: WsEventCallback) {
    eventListeners.push(cb)
    return () => {
      const idx = eventListeners.indexOf(cb)
      if (idx > -1) eventListeners.splice(idx, 1)
    }
  }

  function emitEvent(msg: WsMessage) {
    eventListeners.forEach((cb) => cb(msg))
  }

  function isSelf(sender: string): boolean {
    const s = (sender || '').toLowerCase()
    // Empty/whitespace sender is "no one in particular" — treat as not-self
    // so it doesn't accidentally match anyone, but the call sites that ask
    // "is this *me*" should also defensively skip empty before deciding
    // anything (e.g. status snapshots filter empty entries before this).
    if (!s) return false
    if (myUsername && s === myUsername.toLowerCase()) return true
    if (myDisplayName && s === myDisplayName.toLowerCase()) return true
    return false
  }

  /** Decide whether a presence-style frame's actor is *this* user.
   *
   *  Prefer the new `data.userId` channel (added by backend after the
   *  presence-protocol upgrade — exactly one canonical id per actor, no
   *  string ambiguity). Fall back to the historical name-based isSelf()
   *  only when userId is absent, so we keep working against an older
   *  server during the transition.
   */
  function isSelfFrame(msg: WsMessage): boolean {
    const uid = (msg.data as { userId?: number } | undefined)?.userId
    if (typeof uid === 'number') return uid === myUserId
    return isSelf(msg.sender)
  }

  function setMyUserId(id: number | null) {
    myUserId = id
  }

  function connect(username: string, displayName?: string) {
    if (ws) {
      // Update display name even on no-op connect (AppHeader connects first
      // with username only, ChatView later refreshes with the display name).
      if (displayName) myDisplayName = displayName
      return
    }
    shouldReconnect = true
    kickedFlag = false
    myUsername = username
    if (displayName) myDisplayName = displayName
    window.addEventListener('beforeunload', onBeforeUnload)
    if (partnerOnline.value) startLoginGrace()
    const token = localStorage.getItem('token')
    if (!token) {
      console.warn('%c[WS] %c没有 token，跳过连接', 'color: #f59e0b; font-weight: bold;', 'color: #5C4A52;')
      return
    }
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const base = WS_BASE || `${proto}//${location.host}`
    // Backend now authenticates WS via SaToken; username in query is no
    // longer trusted/accepted. Identity is resolved from token server-side.
    ws = new WebSocket(`${base}/ws/chat?token=${encodeURIComponent(token)}`)

    ws.onopen = () => {
      console.log('%c[WS] %c已连接', 'color: #10b981; font-weight: bold;', 'color: #5C4A52;')
      isConnected.value = true
    }

    ws.onmessage = (e) => {
      if (loginGraceTimer) { clearTimeout(loginGraceTimer); loginGraceTimer = null }
      const msg: WsMessage = JSON.parse(e.data)
      console.log(
        `%c[WS] %c${msg.type} %c来自 ${msg.sender}`,
        'color: #8b5cf6; font-weight: bold;',
        'color: #FF7EB6;',
        'color: #5C4A52;',
        msg,
      )

      // Backend error frame (unsupported command, invalid token before close,
      // etc.). Don't append to chat list; expose it via lastEventType so the
      // global handler can toast if needed.
      if (msg.type === 'error') {
        lastEventTime.value = Date.now()
        lastEventType.value = 'error'
        emitEvent(msg)
        return
      }

      // Heart signal: preferred future protocol is { type: 'heart' }.
      // Current backend treats outgoing WS text as chat, so we also accept
      // a private marker payload carried in a chat frame. We do NOT append
      // it to the chat message list; it just fires an event so ChatView can
      // burst hearts on the receiver's screen.
      if (msg.type === 'heart' || (msg.type === 'chat' && msg.content === HEART_MARKER)) {
        if (!isSelfFrame(msg)) {
          lastEventTime.value = Date.now()
          lastEventType.value = 'heart'
          emitEvent({ ...msg, type: 'heart', content: 'heart' })
        }
        return
      }

      // "Kicked" frame: backend tells the older session that a new device
      // just signed in with the same account. Stop reconnecting, drop the
      // session, fire an event so the UI can show a notice + redirect to
      // /login. Treat the close that immediately follows (code 4001) as
      // expected, not a transient disconnect.
      if (msg.type === 'kicked') {
        kickedFlag = true
        shouldReconnect = false
        lastEventTime.value = Date.now()
        lastEventType.value = 'kicked'
        emitEvent(msg)
        return
      }

      // Server-sent chat history can arrive as a WS history frame.
      if (msg.type === 'history') {
        const list = (msg.data?.messages || msg.data?.list) as ChatMessage[] | undefined
        if (Array.isArray(list)) prependHistory(list)
        lastEventTime.value = Date.now()
        lastEventType.value = 'history'
        emitEvent(msg)
        return
      }

      // Drop server-echo of chat messages we authored ourselves — UI has
      // already optimistically rendered the bubble in send(). Without this
      // guard, every user message would briefly double up the moment the
      // server bounces it back to its origin connection.
      if (msg.type === 'chat' && isSelfFrame(msg)) return

      // Track partner presence — used by AppHeader's status dot only.
      // Identity is resolved by id (new protocol) with a name-string fallback
      // for any old-format frames still in flight during the rollout.
      if (msg.type === 'online' && !isSelfFrame(msg)) partnerOnline.value = true
      if (msg.type === 'offline' && !isSelfFrame(msg)) partnerOnline.value = false
      if (msg.type === 'status') {
        // New format: data.online is an array of { userId, name }.
        // Old format: data.online is an array of strings (display names),
        //   sometimes with empty placeholders. Both are accepted while the
        //   server rolls forward, but the moment any entry has a userId we
        //   trust id-based identification exclusively for that snapshot.
        const raw = msg.data?.online as Array<unknown> | undefined
        if (Array.isArray(raw)) {
          const partnerPresent = raw.some(entry => {
            if (entry && typeof entry === 'object') {
              const e = entry as { userId?: number; name?: string }
              if (typeof e.userId === 'number') return e.userId !== myUserId
              if (typeof e.name === 'string' && e.name.trim()) return !isSelf(e.name)
              return false
            }
            if (typeof entry === 'string') {
              return entry.trim().length > 0 && !isSelf(entry)
            }
            return false
          })
          partnerOnline.value = partnerPresent
        }
      }

      messages.value.push(msg)
      lastEventTime.value = Date.now()
      lastEventType.value = msg.type
      // Bump unread for partner chats; useGlobalEvents resets it when
      // entering /chat, so any chat the user actually sees doesn't count.
      if (msg.type === 'chat' && !isSelfFrame(msg)) chatUnread.value++
      emitEvent(msg)
    }

    ws.onclose = (ev) => {
      isConnected.value = false
      ws = null
      // Backend's "kicked" close uses code 4001; invalid/expired WS token
      // uses 4003. Either means don't reconnect — the user must log in
      // again or accept the kicked-session redirect.
      if (ev.code === 4001 || ev.code === 4003 || kickedFlag) {
        if (!kickedFlag) {
          kickedFlag = true
          lastEventTime.value = Date.now()
          lastEventType.value = ev.code === 4003 ? 'error' : 'kicked'
          emitEvent({
            sender: 'SYSTEM',
            content: ev.code === 4003 ? 'WebSocket token invalid' : 'Logged in elsewhere',
            time: '',
            type: ev.code === 4003 ? 'error' : 'kicked',
          })
        }
        shouldReconnect = false
        console.log(
          ev.code === 4003
            ? '%c[WS] %ctoken 无效，已断开'
            : '%c[WS] %c账号在其他设备登录，已断开',
          'color: #f43f5e; font-weight: bold;',
          'color: #5C4A52;',
        )
        return
      }
      console.log('%c[WS] %c断开连接，3秒后重连', 'color: #f59e0b; font-weight: bold;', 'color: #5C4A52;')
      // Track the timer so disconnect() can cancel it before it fires.
      // Otherwise a fast disconnect+reconnect cycle (logout → login as
      // someone else, kicked → re-auth, etc.) could let the *previous*
      // user's reconnect attempt land after the new connection started.
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        if (!ws && shouldReconnect) connect(username)
      }, 3000)
    }

    ws.onerror = (err) => {
      console.error('%c[WS] %c错误', 'color: #f43f5e; font-weight: bold;', 'color: #5C4A52;', err)
    }
  }

  function disconnect() {
    shouldReconnect = false
    window.removeEventListener('beforeunload', onBeforeUnload)
    if (loginGraceTimer) { clearTimeout(loginGraceTimer); loginGraceTimer = null }
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
    ws?.close()
    ws = null
    isConnected.value = false
  }

  function prependHistory(list: ChatMessage[]) {
    const existingIds = new Set(
      messages.value
        .map(m => m.data?.id)
        .filter((id): id is number => typeof id === 'number'),
    )
    const existingKey = new Set(messages.value.map(m => `${m.sender}|${m.time}|${m.content}`))
    const mapped = [...list]
      // Backend returns DESC; display needs ASC.
      .sort((a, b) => new Date(a.createTime).getTime() - new Date(b.createTime).getTime() || a.id - b.id)
      .map<WsMessage>((m) => ({
        sender: m.senderName,
        content: m.content,
        time: m.createTime.slice(11, 19),
        type: 'chat',
        data: { id: m.id, senderId: m.senderId, receiverId: m.receiverId, createTime: m.createTime, mediaList: m.mediaList || [] },
      }))
      .filter(m => {
        const id = m.data?.id
        if (typeof id === 'number' && existingIds.has(id)) return false
        return !existingKey.has(`${m.sender}|${m.time}|${m.content}`)
      })
    messages.value.unshift(...mapped)
  }

  async function loadHistory(reset = false) {
    if (loadingHistory.value) return
    if (!reset && !historyHasMore.value) return
    loadingHistory.value = true
    historyError.value = ''
    try {
      if (reset) {
        historyCursor.value = null
        historyCursorId.value = null
        historyHasMore.value = true
        historyLoaded.value = false
        messages.value = messages.value.filter(m => !m.data?.id) // keep optimistic live messages only
      }
      const res = await getChatHistory({
        cursor: historyCursor.value,
        cursorId: historyCursorId.value,
        size: HISTORY_PAGE_SIZE,
      })
      prependHistory(res.data.list)
      historyCursor.value = res.data.nextCursor
      historyCursorId.value = res.data.nextCursorId ?? null
      historyHasMore.value = res.data.hasMore
      historyLoaded.value = true
    } catch (err: any) {
      const msg = err?.msg || err?.message || '聊天记录加载失败'
      historyError.value = msg
      console.warn('[chat] loadHistory failed', err)
      throw err
    } finally {
      loadingHistory.value = false
    }
  }

  function send(text: string, mediaList: MomentMedia[] = []) {
    console.log(
      `%c[WS] %c发送 %c${text}`,
      'color: #3b82f6; font-weight: bold;',
      'color: #FF7EB6;',
      'color: #5C4A52;',
      mediaList,
    )
    const now = new Date()
    const hh = String(now.getHours()).padStart(2, '0')
    const mm = String(now.getMinutes()).padStart(2, '0')
    const ss = String(now.getSeconds()).padStart(2, '0')
    const localMsg: WsMessage = {
      sender: myDisplayName || myUsername,
      content: text,
      time: `${hh}:${mm}:${ss}`,
      type: 'chat',
      data: { mediaList },
    }
    messages.value.push(localMsg)
    lastEventTime.value = Date.now()
    lastEventType.value = 'chat'

    ws?.send(JSON.stringify({ type: 'chat', content: text, mediaList }))
  }

  /**
   * Send a visible heart to the partner.
   *
   * Temporary compatibility path: until backend supports a real `heart`
   * WS type, we send a private marker string through the existing text
   * channel. Our client recognizes that marker and renders hearts instead
   * of showing it as chat text. Backend prompt below asks to formalize this
   * as a `type: "heart"` frame so it never enters persisted chat history.
   */
  function sendHeart() {
    const now = new Date()
    const hh = String(now.getHours()).padStart(2, '0')
    const mm = String(now.getMinutes()).padStart(2, '0')
    const ss = String(now.getSeconds()).padStart(2, '0')
    lastEventTime.value = Date.now()
    lastEventType.value = 'heart'
    emitEvent({
      sender: myDisplayName || myUsername,
      content: 'heart',
      time: `${hh}:${mm}:${ss}`,
      type: 'heart',
    })
    ws?.send(JSON.stringify({ type: 'heart' }))
  }

  function onBeforeUnload() { ws?.close() }

  function startLoginGrace() {
    // If login said partnerOnline=true but no `status` confirmation arrives
    // within 10s, our optimistic flag is wrong — reset to offline.
    loginGraceTimer = setTimeout(() => {
      if (partnerOnline.value && !isConnected.value) {
        console.log('%c[WS] %clogin grace expired, reset online', 'color: #f59e0b; font-weight: bold;', 'color: #5C4A52;')
        partnerOnline.value = false
      }
    }, 10000)
  }

  function markChatRead() {
    chatUnread.value = 0
  }

  return {
    messages,
    partnerOnline,
    lastEventTime,
    lastEventType,
    isConnected,
    loadingHistory,
    historyHasMore,
    historyLoaded,
    historyError,
    chatUnread,
    connect,
    disconnect,
    loadHistory,
    send,
    sendHeart,
    markChatRead,
    setMyUserId,
    onEvent,
  }
})
