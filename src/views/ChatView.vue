<script setup lang="ts">
/**
 * 晚安聊天室 — real-time chat over WebSocket.
 *
 * Visual: starfield background over a soft pink-violet wash. Bubbles
 * cluster by author and acquire a tail on the last bubble of a run for
 * a softer "speech" feel. Hour markers pin the conversation to time.
 *
 * Behaviour:
 *   - Optimistic send: messages render immediately on Enter; the chat
 *     store dedupes the server's echo so doubles never appear.
 *   - Auto-scroll only when the user is already near the bottom — if
 *     they've scrolled up to read history we don't yank them down.
 *   - Enter sends, Shift+Enter inserts a newline.
 *   - A small emoji palette for one-tap reactions; no keyboard switch
 *     on phones.
 *   - Heart FAB: client-side hearts only, never crosses the wire.
 */
import { ref, onMounted, onBeforeUnmount, nextTick, computed, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useChatStore } from '@/stores/chat'
import { getPartnerDisplayName } from '@/constants/user'
import { useHeartBurst } from '@/composables/useHeartBurst'
import { useBreakpoint } from '@/composables/useBreakpoint'
import { uploadFile } from '@/api/upload'
import { resolveAssetUrl } from '@/api/client'
import Lightbox from '@/components/Lightbox.vue'
import type { MomentMedia, WsMessage } from '@/types'

const auth = useAuthStore()
const chat = useChatStore()
const hearts = useHeartBurst()
const { isPhone } = useBreakpoint()

const inputText = ref('')
const inputEl = ref<HTMLTextAreaElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const chatContainer = ref<HTMLElement | null>(null)
const heartBtn = ref<HTMLElement | null>(null)
const showEmoji = ref(false)
const stickToBottom = ref(true)
const heartPulse = ref(0)
const uploadingMedia = ref(false)
const chatMedia = ref<MomentMedia[]>([])

/** Phone gets a short hint, desktop keeps the full instruction. The 480px
 *  threshold matches the input row max width on a typical narrow phone. */
const inputPlaceholder = computed(() => isPhone.value
  ? '想说什么…'
  : '想说什么…（Enter 发送，Shift+Enter 换行）')

/** Auto-grow the textarea up to a few rows, then start scrolling inside.
 *  Pure JS measure-and-set; no extra deps. */
const INPUT_MIN_HEIGHT = 38
const INPUT_MAX_HEIGHT = 132
function autosizeInput() {
  const el = inputEl.value
  if (!el) return
  el.style.height = 'auto'
  const next = Math.min(INPUT_MAX_HEIGHT, Math.max(INPUT_MIN_HEIGHT, el.scrollHeight))
  el.style.height = next + 'px'
  el.style.overflowY = el.scrollHeight > INPUT_MAX_HEIGHT ? 'auto' : 'hidden'
}
watch(inputText, () => nextTick(autosizeInput))

const partnerName = computed(() =>
  auth.currentUser?.id ? getPartnerDisplayName(auth.currentUser.id) : '',
)

const presenceText = computed(() => {
  if (!partnerName.value) return ''
  if (!chat.isConnected) return '正在连接…'
  return chat.partnerOnline ? `${partnerName.value} 在线` : `${partnerName.value} 离线`
})

const presenceState = computed<'connecting' | 'online' | 'offline'>(() => {
  if (!chat.isConnected) return 'connecting'
  return chat.partnerOnline ? 'online' : 'offline'
})

const EMOJI_QUICK = ['😊', '😂', '🥺', '🤔', '👍', '🌙', '❤️', '💕', '✨', '🌷']

interface BubbleItem {
  kind: 'msg'
  msg: WsMessage
  isMine: boolean
  /** Last bubble in a same-author run — gets the speech tail. */
  isTail: boolean
  /** First bubble in a same-author run — shows the sender label. */
  isHead: boolean
}
interface SeparatorItem { kind: 'sep'; label: string }
type Item = BubbleItem | SeparatorItem

const chatMessages = computed(() => {
  // Sort by chronological time. History (with full createTime) and
  // optimistic local sends (HH:mm:ss only) get aligned to the same axis
  // by stamping today's date onto plain HH:mm:ss values.
  const list = chat.messages.filter(m => m.type === 'chat')
  return [...list].sort((a, b) => timeOf(a) - timeOf(b))
})

function timeOf(m: WsMessage): number {
  const ct = m.data?.createTime as string | undefined
  if (ct) return new Date(ct.includes('T') ? ct : ct.replace(' ', 'T')).getTime()
  if (m.time) {
    const today = new Date()
    const [hh, mm, ss] = m.time.split(':').map(Number)
    today.setHours(hh || 0, mm || 0, ss || 0, 0)
    return today.getTime()
  }
  return 0
}

/** Build the rendered list with grouping markers. Walking backwards lets
 *  us tag the *last* bubble of each author run as the "tail" for styling. */
const items = computed<Item[]>(() => {
  const list = chatMessages.value
  const out: Item[] = []
  let lastSep = ''
  for (let i = 0; i < list.length; i++) {
    const m = list[i]
    const isMine = m.sender === auth.currentUser?.name
    const sep = sepLabel(m.time)
    if (sep && sep !== lastSep) {
      out.push({ kind: 'sep', label: sep })
      lastSep = sep
    }
    const prev = list[i - 1]
    const next = list[i + 1]
    const isHead = !prev || prev.sender !== m.sender
      || sepLabel(prev.time) !== sep
    const isTail = !next || next.sender !== m.sender
      || sepLabel(next.time) !== sep
    out.push({ kind: 'msg', msg: m, isMine, isTail, isHead })
  }
  return out
})

/** Coarse "hour marker" labels: 09:00 / 14:00. We don't actually have
 *  date info on chat frames — the server emits "HH:mm:ss" only — so we
 *  keep grouping shallow. */
function sepLabel(time: string | undefined): string {
  if (!time) return ''
  const m = /^(\d{2}):/.exec(time)
  return m ? m[1] + ':00' : ''
}

let stopWsEvents: (() => void) | null = null
function onVisibilityChange() {
  if (document.visibilityState === 'visible') chat.markChatRead()
}

onMounted(async () => {
  if (auth.currentUser) chat.connect(auth.currentUser.username, auth.currentUser.name)
  // Entering the chat page = "I've seen these"; clear the unread badge.
  chat.markChatRead()
  // Ask for desktop notification permission on the first chat visit. The
  // user is already on the chat page = clear gesture context, browsers
  // accept the prompt without a click. We never ask elsewhere so this
  // doesn't feel naggy.
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => undefined)
    }
  } catch { /* ignore */ }
  // Load persisted history first, then jump to bottom. If backend history
  // is not available yet, loadHistory fails silently via caller catch and
  // realtime still works.
  try {
    await chat.loadHistory(true)
  } catch {
    // UI exposes the error in the top history strip; realtime chat still works.
  }
  scrollToBottom(true)
  // Track scroll position to suspend auto-scroll if the user is reading
  // history. Idiom: any scroll position more than 80px from the bottom
  // counts as "reading history."
  chatContainer.value?.addEventListener('scroll', onMessagesScroll, { passive: true })
  document.addEventListener('visibilitychange', onVisibilityChange)
  stopWsEvents = chat.onEvent((msg) => {
    if (msg.type === 'heart' && msg.sender !== auth.currentUser?.name) {
      heartPulse.value++
      softHeartInChat()
    }
  })
})
onBeforeUnmount(() => {
  chatContainer.value?.removeEventListener('scroll', onMessagesScroll)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  stopWsEvents?.()
})

watch(() => chat.messages.length, () => {
  if (stickToBottom.value) scrollToBottom()
  // Only clear unread when the tab is actually visible. If the user is
  // "on" /chat but the browser is backgrounded, incoming messages should
  // still count as unread and trigger desktop notification.
  if (document.visibilityState === 'visible') chat.markChatRead()
})

async function onMessagesScroll() {
  const el = chatContainer.value
  if (!el) return
  const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
  stickToBottom.value = distanceFromBottom < 80

  // Lazy-load older persisted chat when user reaches the top. Preserve
  // visual position after prepending older messages by adding the delta
  // in scrollHeight back to scrollTop.
  if (el.scrollTop < 24 && chat.historyHasMore && !chat.loadingHistory) {
    const oldHeight = el.scrollHeight
    await chat.loadHistory(false).catch(() => undefined)
    await nextTick()
    const newHeight = el.scrollHeight
    el.scrollTop = newHeight - oldHeight
  }
}

async function scrollToBottom(force = false) {
  await nextTick()
  const el = chatContainer.value
  if (!el) return
  if (force) stickToBottom.value = true
  el.scrollTop = el.scrollHeight
}

function handleSend() {
  const text = inputText.value.trim()
  if (!text && chatMedia.value.length === 0) return
  if (!chat.isConnected || uploadingMedia.value) return
  chat.send(text, chatMedia.value)
  inputText.value = ''
  chatMedia.value = []
  showEmoji.value = false
  stickToBottom.value = true
  nextTick(() => {
    inputEl.value?.focus()
    autosizeInput()
  })
}

function onInputKeydown(e: KeyboardEvent) {
  if (e.key !== 'Enter') return
  // Shift+Enter / IME composing → let the textarea handle it normally
  if (e.shiftKey || e.isComposing) return
  e.preventDefault()
  handleSend()
}

function insertEmoji(emoji: string) {
  const el = inputEl.value
  if (!el) {
    inputText.value += emoji
    return
  }
  const start = el.selectionStart ?? inputText.value.length
  const end = el.selectionEnd ?? start
  inputText.value = inputText.value.slice(0, start) + emoji + inputText.value.slice(end)
  nextTick(() => {
    const pos = start + emoji.length
    el.focus()
    el.setSelectionRange(pos, pos)
  })
}

function openFilePicker() { fileInput.value?.click() }
async function onPickFile(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files || [])
  input.value = ''
  if (!files.length) return
  uploadingMedia.value = true
  try {
    for (const file of files.slice(0, 4)) {
      const res = await uploadFile(file)
      chatMedia.value.push({ type: res.data.type, url: res.data.url, width: res.data.width, height: res.data.height })
    }
  } finally {
    uploadingMedia.value = false
  }
}
function removeChatMedia(idx: number) { chatMedia.value.splice(idx, 1) }
function mediaFrom(msg: WsMessage): MomentMedia[] {
  // Backend always sets data.mediaList = [] when there's no media; we still
  // guard against legacy frames where it might be missing or stringified.
  const raw = msg.data?.mediaList
  if (Array.isArray(raw)) return raw as MomentMedia[]
  return []
}

const lightboxOpen = ref(false)
const lightboxList = ref<MomentMedia[]>([])
const lightboxIndex = ref(0)
function openChatLightbox(list: MomentMedia[], idx: number) {
  lightboxList.value = list
  lightboxIndex.value = idx
  lightboxOpen.value = true
}

function popHeart() {
  // Local feedback immediately, then notify partner via WS.
  heartPulse.value++
  hearts.burstFrom(heartBtn.value, 5)
  softHeartInChat()
  if (chat.isConnected) chat.sendHeart()
}

function softHeartInChat() {
  const el = chatContainer.value
  if (!el) return
  const r = el.getBoundingClientRect()
  // Softer than the old burst: just a few hearts around the visual center.
  hearts.burst(r.left + r.width * 0.5, r.top + r.height * 0.48, 4)
}

function senderInitial(s: string): string {
  return (s || '').trim().slice(0, 1) || '·'
}
</script>

<template>
  <div class="chat-page">
    <header class="chat-head">
      <div class="head-line">
        <h1 class="title font-serif">晚安聊天室</h1>
        <span class="dot" :class="presenceState" :title="presenceText"></span>
      </div>
      <p class="presence" :class="presenceState">{{ presenceText }}</p>
    </header>

    <div ref="chatContainer" class="messages">
      <div class="history-tip" :class="{ error: !!chat.historyError }">
        <span v-if="chat.loadingHistory">正在翻更早的聊天…</span>
        <template v-else-if="chat.historyError">
          <span>聊天记录加载失败</span>
          <button type="button" @click="chat.loadHistory(true).then(() => scrollToBottom(true)).catch(() => undefined)">重试</button>
        </template>
        <span v-else-if="chat.historyHasMore && chat.historyLoaded">上滑加载更早消息</span>
        <span v-else-if="chat.historyLoaded && chatMessages.length > 0">已经到最早了</span>
      </div>

      <p v-if="chatMessages.length === 0" class="empty">
        <span class="empty-emoji">🌙</span>
        <span>还没有消息，打个招呼吧</span>
      </p>

      <template v-for="(item, idx) in items" :key="idx">
        <div v-if="item.kind === 'sep'" class="sep">
          <span>{{ item.label }}</span>
        </div>

        <div
          v-else
          class="bubble-row"
          :class="{ mine: item.isMine, tail: item.isTail, head: item.isHead }"
        >
          <div v-if="!item.isMine && item.isTail" class="avatar partner">
            {{ senderInitial(item.msg.sender) }}
          </div>
          <div v-else-if="!item.isMine" class="avatar-spacer" />

          <div class="bubble-stack">
            <span v-if="item.isHead && !item.isMine" class="bubble-sender">
              {{ item.msg.sender }}
            </span>
            <div class="bubble">
              <div v-if="mediaFrom(item.msg).length" class="bubble-media">
                <div
                  v-for="(m, mIdx) in mediaFrom(item.msg)"
                  :key="m.url"
                  class="chat-media"
                  :class="'kind-' + m.type"
                  @click="m.type === 'image' ? openChatLightbox(mediaFrom(item.msg), mIdx) : undefined"
                >
                  <img v-if="m.type === 'image'" :src="resolveAssetUrl(m.url)" alt="" />
                  <video v-else :src="resolveAssetUrl(m.url)" controls preload="metadata" playsinline />
                </div>
              </div>
              <p v-if="item.msg.content" class="bubble-text">{{ item.msg.content }}</p>
              <span class="bubble-time">{{ item.msg.time || '' }}</span>
            </div>
          </div>

          <div v-if="item.isMine && item.isTail" class="avatar mine">
            {{ senderInitial(item.msg.sender) }}
          </div>
          <div v-else-if="item.isMine" class="avatar-spacer" />
        </div>
      </template>

      <Transition name="jump-fade">
        <button
          v-if="!stickToBottom && chatMessages.length > 0"
          class="jump-bottom"
          type="button"
          @click="scrollToBottom(true)"
        >回到底部 ↓</button>
      </Transition>
    </div>

    <Transition name="emoji-fade">
      <div v-if="showEmoji" class="emoji-tray">
        <button
          v-for="e in EMOJI_QUICK" :key="e"
          type="button" class="emoji-btn"
          @click="insertEmoji(e)"
        >{{ e }}</button>
      </div>
    </Transition>

    <div v-if="chatMedia.length" class="chat-media-preview">
      <div v-for="(m, idx) in chatMedia" :key="m.url" class="preview-item">
        <img v-if="m.type === 'image'" :src="resolveAssetUrl(m.url)" alt="" />
        <video v-else :src="resolveAssetUrl(m.url)" muted preload="metadata" playsinline />
        <button type="button" @click="removeChatMedia(idx)">×</button>
      </div>
    </div>

    <div class="input-row">
      <input ref="fileInput" type="file" accept="image/*,video/*" multiple hidden @change="onPickFile" />
      <button type="button" class="icon-btn" :disabled="uploadingMedia" aria-label="发送图片或视频" @click="openFilePicker">＋</button>
      <button
        type="button" class="icon-btn"
        :class="{ active: showEmoji }"
        :aria-label="showEmoji ? '收起表情' : '打开表情'"
        @click="showEmoji = !showEmoji"
      >☺</button>
      <button
        ref="heartBtn"
        :key="heartPulse"
        type="button"
        class="icon-btn heart-inline"
        :class="{ pulse: heartPulse > 0 }"
        title="给对方一个心动"
        aria-label="给对方一个心动"
        @click="popHeart"
      >❤</button>
      <textarea
        ref="inputEl"
        v-model="inputText"
        class="input"
        :placeholder="inputPlaceholder"
        rows="1"
        maxlength="500"
        @keydown="onInputKeydown"
        @input="autosizeInput"
      />
      <button
        type="button"
        class="send-btn"
        :disabled="(!inputText.trim() && chatMedia.length === 0) || !chat.isConnected || uploadingMedia"
        @click="handleSend"
      >发送</button>
    </div>

    <Lightbox
      v-model="lightboxOpen"
      :list="lightboxList"
      :index="lightboxIndex"
    />
  </div>
</template>

<style scoped>
.chat-page {
  max-width: 760px;
  margin: 0 auto;
  padding: 18px 20px 16px;
  /* The parent .route-frame already fills the gap between AppHeader and
   * MobileTabBar. Filling 100% of that is enough; no need to compute
   * viewport heights manually. */
  height: 100%;
  overflow: hidden;
  display: flex; flex-direction: column;
  min-height: 0; min-width: 0;
  position: relative;
  background:
    radial-gradient(2px 2px at 20% 18%, rgba(255,255,255,0.95) 50%, transparent 51%),
    radial-gradient(1.5px 1.5px at 70% 12%, rgba(255,255,255,0.9) 50%, transparent 51%),
    radial-gradient(2px 2px at 82% 48%, rgba(255,255,255,0.85) 50%, transparent 51%),
    radial-gradient(1px 1px at 35% 70%, rgba(255,255,255,0.85) 50%, transparent 51%),
    radial-gradient(1.5px 1.5px at 55% 35%, rgba(255,255,255,0.7) 50%, transparent 51%),
    radial-gradient(2px 2px at 12% 88%, rgba(255,255,255,0.85) 50%, transparent 51%),
    radial-gradient(1px 1px at 92% 78%, rgba(255,255,255,0.7) 50%, transparent 51%),
    radial-gradient(circle at 110% -10%, rgba(255, 200, 220, 0.65), transparent 45%),
    linear-gradient(180deg, #F8E1F0 0%, #FFF0F7 55%, #FFF8FB 100%);
}

/* === Header === */
.chat-head {
  display: flex; flex-direction: column; align-items: center;
  padding-bottom: 10px;
  margin-bottom: 6px;
  border-bottom: 1px dashed var(--pink-300);
  flex-shrink: 0;
}
.head-line { display: flex; align-items: center; gap: 10px; }
.title { font-size: 22px; font-weight: 600; color: var(--ink-warm); letter-spacing: 4px; margin: 0; }
.dot {
  width: 9px; height: 9px; border-radius: 50%;
  background: #d1d5db;
  box-shadow: 0 0 0 3px rgba(209,213,219,0.18);
}
.dot.online { background: var(--el-color-success); box-shadow: 0 0 0 3px rgba(16,185,129,0.18); }
.dot.connecting { background: #f59e0b; animation: dot-pulse 1.4s ease-in-out infinite; }
@keyframes dot-pulse {
  0%,100% { box-shadow: 0 0 0 0 rgba(245,158,11,0.5); }
  50%     { box-shadow: 0 0 0 6px rgba(245,158,11,0); }
}
.presence {
  margin: 4px 0 0; font-size: 12px; color: var(--ink-mute); letter-spacing: 0.5px;
  transition: color 0.3s;
}
.presence.online { color: var(--pink-700); }
.presence.connecting { color: #b88500; }

/* === Message list === */
.messages {
  flex: 1; overflow-y: auto;
  min-height: 0;
  padding: 12px 8px 8px;
  display: flex; flex-direction: column; gap: 4px;
  -webkit-overflow-scrolling: touch;
  position: relative;
  /* Firefox */
  scrollbar-width: thin;
  scrollbar-color: rgba(255,126,182,0.35) transparent;
}
/* Chromium / Safari */
.messages::-webkit-scrollbar { width: 5px; }
.messages::-webkit-scrollbar-track { background: transparent; }
.messages::-webkit-scrollbar-thumb {
  background: rgba(255,126,182,0.28);
  border-radius: 999px;
}
.messages:hover::-webkit-scrollbar-thumb { background: rgba(255,126,182,0.55); }
@media (max-width: 960px) {
  .messages { scrollbar-width: none; }
  .messages::-webkit-scrollbar { display: none; }
}
.history-tip {
  text-align: center;
  min-height: 22px;
  font-size: 11px;
  color: var(--ink-mute);
  margin-bottom: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.history-tip.error { color: var(--rose-heart); }
.history-tip button {
  border: 1px solid var(--pink-300);
  border-radius: 999px;
  background: #fff;
  color: var(--pink-700);
  padding: 2px 10px;
  font-size: 11px;
  cursor: pointer;
}
.empty {
  margin: auto;
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  color: var(--ink-mute); font-size: 14px;
}
.empty-emoji { font-size: 32px; opacity: 0.7; }

/* hour separator */
.sep {
  text-align: center; margin: 14px 0 6px;
  position: relative;
}
.sep span {
  display: inline-block;
  background: rgba(255,255,255,0.7);
  border: 1px solid var(--pink-200);
  color: var(--ink-mute);
  font-size: 11px;
  padding: 2px 12px;
  border-radius: 999px;
  letter-spacing: 1px;
  backdrop-filter: blur(4px);
}

/* === Bubble row: clean IM style === */
.bubble-row {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) 28px;
  column-gap: 8px;
  /* Align avatar with the *top* edge of the bubble (sender label or
   * first content line). Looks more like the head of speech than the
   * old end-aligned variant. */
  align-items: start;
  width: 100%;
  margin: 2px 0;
}
.bubble-row.head { margin-top: 10px; }

.avatar, .avatar-spacer {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: 50%;
}
.avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  box-shadow: 0 2px 6px rgba(92,74,82,0.12);
  /* Nudge down slightly so the avatar's vertical centerline lines up with
   * the first text line of the bubble (sender label sits above on the
   * partner side; the bubble itself starts a few px lower than the row). */
  margin-top: 2px;
}
.avatar.partner { background: linear-gradient(135deg, #c4b5fd, #8b5cf6); }
.avatar.mine { background: linear-gradient(135deg, var(--pink-600), var(--rose-heart)); }

.bubble-stack {
  grid-column: 2;
  display: flex;
  flex-direction: column;
  max-width: min(78%, 480px);
  min-width: 0;
  justify-self: start;
}
.bubble-row.mine .bubble-stack {
  grid-column: 2;
  justify-self: end;
  align-items: flex-end;
}
.bubble-row.mine .avatar,
.bubble-row.mine .avatar-spacer { grid-column: 3; }
.bubble-row:not(.mine) .avatar,
.bubble-row:not(.mine) .avatar-spacer { grid-column: 1; }

.bubble-sender {
  font-size: 11px;
  color: var(--ink-mute);
  margin: 0 8px 3px;
}

.bubble {
  position: relative;
  padding: 9px 13px;
  border-radius: 18px;
  background: rgba(255,255,255,0.96);
  border: 1px solid rgba(255, 196, 227, 0.9);
  box-shadow: 0 3px 10px rgba(255,126,182,0.08);
  min-width: 0;
  overflow: hidden;
}
.bubble-row:not(.mine) .bubble { border-bottom-left-radius: 8px; }
.bubble-row.mine .bubble {
  background: linear-gradient(135deg, #FF86BF, #FF5C7D);
  color: #fff;
  border: none;
  box-shadow: 0 4px 12px rgba(255,77,109,0.20);
  border-bottom-right-radius: 8px;
}

.bubble-text {
  margin: 0;
  font-size: 14px;
  line-height: 1.55;
  word-break: break-word;
  overflow-wrap: anywhere;
  color: var(--ink-warm);
  white-space: pre-wrap;
}
.bubble-row.mine .bubble-text { color: #fff; }
.bubble-time {
  display: block;
  font-size: 10px;
  margin-top: 4px;
  opacity: 0.55;
  text-align: right;
  letter-spacing: 0.5px;
}
.bubble-row.mine .bubble-time { color: rgba(255,255,255,0.86); }

.bubble-media {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
  gap: 6px;
  margin-bottom: 6px;
  max-width: 280px;
}
.chat-media {
  border-radius: 12px;
  overflow: hidden;
  background: var(--pink-100);
  max-height: 220px;
}
.chat-media img,
.chat-media video {
  width: 100%;
  height: 100%;
  max-height: 220px;
  object-fit: cover;
  display: block;
}

/* Jump-to-bottom chip */
.jump-bottom {
  position: absolute;
  left: 50%;
  bottom: 12px;
  transform: translateX(-50%);
  padding: 6px 14px;
  border-radius: 999px;
  background: linear-gradient(135deg, var(--pink-600), var(--rose-heart));
  color: #fff;
  border: none;
  font-size: 12px;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(255,77,109,0.28);
}
.jump-fade-enter-active, .jump-fade-leave-active { transition: opacity 0.15s, transform 0.15s; }
.jump-fade-enter-from, .jump-fade-leave-to { opacity: 0; transform: translate(-50%, 4px); }

/* === Emoji tray === */
.emoji-tray {
  display: flex; flex-wrap: wrap; gap: 4px;
  padding: 8px 6px 4px;
  border-top: 1px dashed var(--pink-300);
  background: rgba(255,255,255,0.6);
  backdrop-filter: blur(8px);
}
.emoji-btn {
  width: 36px; height: 36px;
  border: none;
  background: transparent;
  font-size: 22px;
  cursor: pointer;
  border-radius: 10px;
  -webkit-tap-highlight-color: transparent;
}
@media (hover: hover) { .emoji-btn:hover { background: var(--pink-200); } }
.emoji-btn:active { transform: scale(0.92); }
.emoji-fade-enter-active, .emoji-fade-leave-active { transition: opacity 0.15s, transform 0.15s; transform-origin: bottom; }
.emoji-fade-enter-from, .emoji-fade-leave-to { opacity: 0; transform: translateY(6px); }

.chat-media-preview {
  display: flex;
  gap: 8px;
  padding: 8px 4px 2px;
  overflow-x: auto;
}
.preview-item {
  position: relative;
  flex: 0 0 58px;
  width: 58px;
  height: 58px;
  border-radius: 12px;
  overflow: hidden;
  background: var(--pink-100);
  border: 1px solid var(--pink-300);
}
.preview-item img,
.preview-item video { width: 100%; height: 100%; object-fit: cover; display: block; }
.preview-item button {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 50%;
  background: rgba(0,0,0,0.55);
  color: #fff;
  line-height: 1;
}

/* === Input row === */
.input-row {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 6px 0;
  border-top: 1px solid transparent;
  position: relative;
  z-index: 2;
  background: linear-gradient(180deg, rgba(255,248,251,0), rgba(255,248,251,0.96) 30%);
}
.icon-btn {
  width: 38px; height: 38px;
  border: 1px solid var(--pink-300);
  background: rgba(255,255,255,0.9);
  color: var(--pink-700);
  border-radius: 50%;
  font-size: 19px;
  line-height: 1;
  cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  transition: background 0.15s, color 0.15s;
  flex: 0 0 38px;
  padding: 0;
}
.icon-btn.active { background: var(--pink-200); }
@media (hover: hover) { .icon-btn:hover { background: var(--pink-200); } }

.input {
  flex: 1;
  min-width: 0;
  min-height: 38px;
  max-height: 132px;
  height: 38px;
  resize: none;
  overflow-y: hidden;
  padding: 8px 14px;
  border: 1px solid var(--pink-300);
  border-radius: 18px;
  background: #fff;
  color: var(--ink-warm);
  font-size: 14px;
  line-height: 20px;
  outline: none;
  font-family: var(--font-body);
  transition: border-color 0.15s, box-shadow 0.15s;
}
.input:focus { border-color: var(--pink-600); box-shadow: 0 0 0 3px rgba(255,126,182,0.14); }
.input::placeholder { color: var(--ink-faint); }
/* Keep the textarea's internal scrolling, but hide the scrollbar so it
 * can't visually pierce the rounded pill corners on Windows / Android. */
.input::-webkit-scrollbar { width: 0; height: 0; }
.input { scrollbar-width: none; }

.send-btn {
  height: 38px;
  padding: 0 18px;
  border: none;
  border-radius: 999px;
  background: linear-gradient(135deg, var(--pink-600), var(--rose-heart));
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  letter-spacing: 1px;
  box-shadow: 0 4px 14px rgba(255,77,109,0.22);
  transition: transform 0.15s, box-shadow 0.15s, opacity 0.15s;
  flex-shrink: 0;
}
.send-btn:disabled { opacity: 0.4; cursor: not-allowed; box-shadow: none; }
@media (hover: hover) { .send-btn:not(:disabled):hover { transform: translateY(-1px); box-shadow: 0 8px 20px rgba(255,77,109,0.32); } }
.send-btn:not(:disabled):active { transform: translateY(0); }

/* === Inline heart button === */
.heart-inline {
  color: var(--rose-heart);
  font-size: 19px;
}
.heart-inline.pulse { animation: soft-heart-pulse 0.55s ease; }
@keyframes soft-heart-pulse {
  0%   { transform: scale(1); box-shadow: none; }
  35%  { transform: scale(1.12); box-shadow: 0 0 0 7px rgba(255,77,109,0.10); }
  100% { transform: scale(1); box-shadow: none; }
}

@media (max-width: 960px) {
  .chat-page {
    padding: 12px 14px 12px;
    /* MobileTabBar is fixed and overlays the bottom of route-frame.
     * If ChatView uses height:100%, the input row sits underneath the tab bar.
     * Reserve exactly the tab-bar height here so the composer is always visible. */
    height: calc(100% - var(--tab-bar-height));
  }
  .title { font-size: 18px; letter-spacing: 3px; }
  .bubble-row { grid-template-columns: 26px minmax(0, 1fr) 26px; column-gap: 7px; }
  .bubble-stack { max-width: 82%; }
  .avatar, .avatar-spacer { width: 26px; height: 26px; }
  .bubble { padding: 8px 12px; }
  .bubble-text { font-size: 14px; }
  .input-row { gap: 6px; }
  .icon-btn { width: 36px; height: 36px; font-size: 18px; }
  .send-btn { padding: 0 14px; }
}
</style>
