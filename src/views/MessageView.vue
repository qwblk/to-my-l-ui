<script setup lang="ts">
/**
 * 漂流瓶 — private 1:1 messages.
 *
 * Sending: a card writes the new line, then flies off-screen on submit
 * (paper-fly keyframe), suggesting a bottle dropped into the sea.
 *
 * Receiving: each unread message renders as a closed envelope; clicking
 * it flips the flap open via CSS 3D transform and reveals the letter
 * inside, then calls markRead. **Reading is one-way** — the server-side
 * `isRead` flag never reverts. But visually the user can still toggle
 * the letter open/closed (collapse to save screen space without
 * re-firing any markRead toast).
 */
import { computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useChatStore } from '@/stores/chat'
import { useMessagesStore } from '@/stores/messages'
import { sendMessage } from '@/api/message'
import { ElMessage } from 'element-plus'
import { getPartnerDisplayName } from '@/constants/user'
import { ref } from 'vue'
import type { Message } from '@/types'
import PullToRefresh from '@/components/PullToRefresh.vue'
import BackButton from '@/components/BackButton.vue'

const route = useRoute()
const auth = useAuthStore()
const chat = useChatStore()
const store = useMessagesStore()

const tab = ref<'received' | 'sent'>('received')
const loadMoreEl = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

const showCompose = ref(false)
const composeText = ref('')
const composing = ref(false)
const flying = ref(false)            // animates the compose card off-screen on send

const partnerName = computed(() => auth.currentUser?.id ? getPartnerDisplayName(auth.currentUser.id) : '')

onMounted(async () => {
  await Promise.all([store.resetReceived(), store.resetSent()])
  setupObserver()
  const q = typeof route.query.messageId === 'string' ? Number(route.query.messageId) : NaN
  if (Number.isFinite(q)) {
    const hit = [...store.received, ...store.sent].find((m) => m.id === q)
    if (hit) {
      store.toggle(hit)
      await nextTick()
      document.getElementById('message-' + q)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }
})
onBeforeUnmount(() => observer?.disconnect())

watch(() => chat.lastEventTime, (t, old) => {
  if (t && t !== old && ['message', 'read'].includes(chat.lastEventType)) store.refreshLatest()
})

watch(tab, async (v) => {
  if (v === 'received' && store.received.length === 0) await store.resetReceived()
  if (v === 'sent' && store.sent.length === 0) await store.resetSent()
})

function setupObserver() {
  observer?.disconnect()
  const rootEl = document.querySelector('.route-frame') as Element | null
  observer = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return
    if (tab.value === 'received') store.loadMoreReceived()
    else store.loadMoreSent()
  }, { root: rootEl, rootMargin: '320px 0px' })

  watch(loadMoreEl, (el) => {
    observer?.disconnect()
    if (el) observer?.observe(el)
  }, { immediate: true })
}

function handleOpen(m: Message) { store.toggle(m) }

async function handleSend() {
  if (!composeText.value.trim() || !auth.currentUser) return
  composing.value = true
  try {
    await sendMessage({
      receiverId: auth.currentUser.id === 1 ? 2 : 1,
      content: composeText.value,
    })
    flying.value = true
    await nextTick()
    setTimeout(() => {
      flying.value = false
      showCompose.value = false
      composeText.value = ''
      ElMessage.success('信已经投出去了')
      store.resetSent()
    }, 700)
  } catch {
    ElMessage.error('发送失败')
  } finally {
    composing.value = false
  }
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr)
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
}

async function onPullRefresh() {
  if (tab.value === 'received') await store.resetReceived()
  else await store.resetSent()
}
</script>

<template>
  <div class="message-page">
    <PullToRefresh @refresh="onPullRefresh" />
    <header class="page-head">
      <BackButton class="page-back" />
      <h1 class="title font-serif">漂流瓶</h1>
      <p class="subtitle">把现在的话，扔进时间的海里</p>
      <button class="btn-romance write-btn" @click="showCompose = true">写给{{ partnerName }}</button>
    </header>

    <div class="tabs-row">
      <button class="tab-btn" :class="{ active: tab === 'received' }" @click="tab = 'received'">
        收到的
        <span v-if="store.unreadCount > 0" class="tab-badge">{{ store.unreadCount }}</span>
      </button>
      <button class="tab-btn" :class="{ active: tab === 'sent' }" @click="tab = 'sent'">寄出的</button>
    </div>

    <!-- Received -->
    <div v-if="tab === 'received'" v-loading="store.loadingReceived && store.sortedReceived.length === 0" class="bottle-list">
      <p v-if="!store.loadingReceived && store.sortedReceived.length === 0" class="empty">
        还没有收到漂流瓶。<br />等一等，会有的。
      </p>

      <div
        v-for="m in store.sortedReceived" :id="'message-' + m.id" :key="m.id"
        class="bottle"
        :class="{ open: store.isExpanded(m), unread: !m.isRead }"
        @click="handleOpen(m)"
      >
        <div class="envelope">
          <div class="env-flap"></div>
          <div class="env-body">
            <div class="env-meta">
              <span class="from">来自 {{ m.senderName }}</span>
              <span class="env-date">{{ formatDate(m.createTime) }}</span>
            </div>
            <div v-if="!m.isRead" class="seal">✦</div>
          </div>
        </div>
        <div class="letter-content font-serif">
          <p>{{ m.content }}</p>
        </div>
      </div>

      <div ref="loadMoreEl" class="load-more">
        <span v-if="store.loadingReceived">正在打捞更早的漂流瓶…</span>
        <span v-else-if="store.receivedHasMore">继续往下，会看到更早的信</span>
        <span v-else-if="store.sortedReceived.length">已经没有更早的漂流瓶了</span>
      </div>
    </div>

    <!-- Sent -->
    <div v-else v-loading="store.loadingSent && store.sortedSent.length === 0" class="bottle-list">
      <p v-if="!store.loadingSent && store.sortedSent.length === 0" class="empty">还没有寄出的话。</p>

      <div v-for="m in store.sortedSent" :id="'message-' + m.id" :key="m.id" class="sent-card">
        <div class="env-meta">
          <span class="from">写给 {{ partnerName }}</span>
          <span class="env-date">{{ formatDate(m.createTime) }}</span>
          <span class="read-mark" :class="{ done: m.isRead }">{{ m.isRead ? '已被看见' : '在路上…' }}</span>
        </div>
        <p class="sent-content font-serif">{{ m.content }}</p>
      </div>

      <div ref="loadMoreEl" class="load-more">
        <span v-if="store.loadingSent">正在翻找更早寄出的信…</span>
        <span v-else-if="store.sentHasMore">继续往下，会看到更早写过的话</span>
        <span v-else-if="store.sortedSent.length">已经没有更早的了</span>
      </div>
    </div>

    <!-- Compose dialog -->
    <el-dialog
      v-model="showCompose" width="480px"
      :close-on-click-modal="false" :show-close="!composing"
      title="写一封漂流瓶"
    >
      <div class="compose-card" :class="{ flying }">
        <el-input
          v-model="composeText" type="textarea" :rows="6"
          maxlength="500" show-word-limit
          placeholder="想说点什么…"
        />
      </div>
      <template #footer>
        <el-button @click="showCompose = false" :disabled="composing">先不写</el-button>
        <el-button type="primary" :loading="composing" @click="handleSend">投出去</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.message-page {
  max-width: 720px;
  margin: 0 auto;
  padding: var(--space-page-y) var(--space-page-x);
  padding-bottom: calc(var(--space-page-y) + var(--tab-bar-height));
}

.page-head { text-align: center; margin-bottom: 32px; position: relative; }
.title { font-size: 32px; font-weight: 600; color: var(--ink-warm); letter-spacing: 4px; margin: 0 0 4px; }
.subtitle { font-size: 13px; color: var(--ink-mute); margin: 0 0 20px; }
.write-btn { padding: 10px 22px; font-size: 14px; }

.tabs-row {
  display: flex; gap: 6px; justify-content: center; margin-bottom: 28px;
}
.tab-btn {
  position: relative;
  padding: 6px 18px; font-size: 13px;
  background: transparent; border: 1px solid var(--pink-300);
  border-radius: 999px; color: var(--ink-soft); cursor: pointer;
  transition: all 0.2s;
}
.tab-btn:hover { background: var(--pink-200); }
.tab-btn.active {
  background: linear-gradient(135deg, var(--pink-600), var(--rose-heart));
  color: #fff; border-color: transparent;
}.tab-badge {
  display: inline-block; margin-left: 6px;
  min-width: 16px; height: 16px; padding: 0 4px;
  background: var(--rose-heart); color: #fff;
  border-radius: 999px;
  font-size: 10px; font-weight: 600; line-height: 16px;
}
.tab-btn.active .tab-badge { background: #fff; color: var(--rose-heart); }

.empty {
  text-align: center; color: var(--ink-mute);
  font-size: 14px; line-height: 2; padding: 80px 0;
}

/* === Envelope === */
.bottle { margin-bottom: 22px; cursor: pointer; }
.envelope {
  position: relative;
  width: 100%; max-width: 480px; margin: 0 auto;
  height: 140px;
  background: linear-gradient(180deg, #fff 0%, #FFF8FB 100%);
  border: 1px solid var(--pink-300);
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(255,126,182,0.12);
  overflow: hidden;
  transition: transform 0.2s, box-shadow 0.2s;
}
.bottle:hover .envelope { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(255,126,182,0.2); }

.env-flap {
  position: absolute; top: 0; left: 0; width: 100%;
  height: 70px;
  background: linear-gradient(180deg, var(--pink-200), var(--pink-300));
  clip-path: polygon(0 0, 100% 0, 50% 100%);
  transform-origin: 50% 0;
  transition: transform 0.7s cubic-bezier(0.4, 0, 0.2, 1);
  z-index: 2;
}
.bottle.open .env-flap { transform: rotateX(180deg); }

.env-body {
  position: absolute; inset: 0;
  padding: 30px 28px;
  display: flex; flex-direction: column; justify-content: flex-end;
}
.env-meta {
  display: flex; align-items: baseline; justify-content: space-between;
  font-size: 13px; color: var(--ink-soft);
  letter-spacing: 0.5px;
}
.from { font-weight: 500; color: var(--pink-700); }
.env-date { color: var(--ink-mute); font-size: 12px; }

.seal {
  position: absolute; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: 36px; height: 36px;
  background: linear-gradient(135deg, var(--pink-600), var(--rose-heart));
  color: #fff;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 18px;
  z-index: 3;
  box-shadow: 0 2px 6px rgba(255,77,109,0.4);
  transition: opacity 0.4s, transform 0.4s;
}
.bottle.open .seal { opacity: 0; transform: translate(-50%, -50%) scale(0.4); }

.bottle.unread .envelope {
  border-color: var(--pink-600);
  box-shadow: 0 4px 18px rgba(255,77,109,0.18);
}
/* Read-but-collapsed: subtle hint that there's content folded inside */
.bottle:not(.unread):not(.open) .envelope {
  background: linear-gradient(180deg, #fff 0%, var(--pink-100) 100%);
}

/* Letter content slides up from below the envelope */
.letter-content {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.6s ease, padding 0.4s ease, margin 0.4s ease;
  background: #FFFCFD;
  background-image: repeating-linear-gradient(
    to bottom, transparent 0, transparent 27px,
    var(--pink-200) 27px, var(--pink-200) 28px
  );
  border-left: 4px solid var(--pink-400);
  border-radius: 0 0 14px 14px;
  margin: 0 12px;
  font-size: 15px;
  line-height: 28px;
  color: var(--ink-warm);
}
.bottle.open .letter-content {
  max-height: 800px;
  padding: 18px 22px;
  margin-top: -20px;
}
.letter-content p { margin: 0; white-space: pre-wrap; }

/* === Sent card === */
.sent-card {
  background: #fff;
  border: 1px solid var(--pink-300);
  border-radius: 14px;
  padding: 16px 20px;
  margin-bottom: 14px;
  box-shadow: 0 2px 10px rgba(255,126,182,0.06);
}
.sent-content {
  margin: 8px 0 0;
  font-size: 15px;
  line-height: 1.8;
  color: var(--ink-warm);
  white-space: pre-wrap;
}
.read-mark {
  margin-left: auto;
  font-size: 12px; color: var(--ink-mute);
}
.read-mark.done { color: var(--pink-700); }

/* === Compose card fly-away === */
.compose-card { transition: transform 0.7s ease, opacity 0.6s ease; }
.compose-card.flying {
  animation: paper-fly 0.7s ease forwards;
  pointer-events: none;
}

.load-more {
  text-align: center;
  padding: 22px 0;
  font-size: 13px;
  color: var(--ink-mute);
}

@media (max-width: 960px) {
  .title { font-size: 28px; letter-spacing: 3px; }
  .envelope { height: 120px; }
  .env-flap { height: 60px; }
  .env-body { padding: 24px 20px; }
  .letter-content { font-size: 14px; line-height: 26px; }
  .bottle.open .letter-content { padding: 14px 18px; }
  .sent-card { padding: 14px 16px; }
  .sent-content { font-size: 14px; line-height: 1.7; }
}
</style>
