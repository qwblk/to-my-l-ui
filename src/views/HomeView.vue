<script setup lang="ts">
/**
 * "我们的首页" — narrative landing page.
 *
 * Vertical narrative column: day-counter → date → small inline stats →
 * 对方写给我的最近一封漂流瓶 → primary call-to-action.
 *
 * The latest-letter card on the home page and the receive list on /message
 * both read from the shared messages store, so opening the letter here
 * marks it read everywhere — the unread badge, the envelope on /message,
 * the AppHeader red dot.
 */
import { onMounted, ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useChatStore } from '@/stores/chat'
import { useMessagesStore } from '@/stores/messages'
import { getAllDiaries } from '@/api/diary'
import { getAllMoments } from '@/api/moment'
import { useSpecialDate, daysSince } from '@/composables/useSpecialDate'
import { useHeartBurst } from '@/composables/useHeartBurst'
import { useSettings } from '@/composables/useSettings'
import { getPartnerDisplayName } from '@/constants/user'
import PullToRefresh from '@/components/PullToRefresh.vue'

const router = useRouter()
const auth = useAuthStore()
const chat = useChatStore()
const messages = useMessagesStore()
const hearts = useHeartBurst()
const special = useSpecialDate()
const settings = useSettings()

const diaryCount = ref(0)
const momentCount = ref(0)
const loading = ref(true)

const days = computed(() => daysSince())
const partnerName = computed(() => auth.currentUser?.id ? getPartnerDisplayName(auth.currentUser.id) : '')

const todayLabel = computed(() => {
  const d = new Date()
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
  return `${d.getFullYear()} 年 ${String(d.getMonth() + 1).padStart(2, '0')} 月 ${String(d.getDate()).padStart(2, '0')} 日 · 星期${weekday}`
})

const heroLine = computed(() => {
  if (!auth.currentUser) return ''
  return auth.currentUser.id === 1
    ? `今天是喜欢${partnerName.value}的第`
    : `${partnerName.value}已经记录了`
})
const heroLineSuffix = computed(() => auth.currentUser?.id === 1 ? '天' : '天的喜欢')

// The "最近一句话" — the most recent letter the partner wrote to me.
// Pulled from the shared messages store so unread state and open state
// stay in sync with /message.
const latestLetter = computed(() => messages.latestReceived)
const messageCount = computed(() => messages.received.length + messages.sent.length)
const isLatestRead = computed(() => latestLetter.value?.isRead === 1)

/** Letters longer than this in the home preview get truncated with a
 *  "读全文 →" affordance that opens the full-text dialog. The limit is
 *  intentionally tight so the home page never overflows the viewport. */
const PREVIEW_CHARS = 40

const showFullLetter = ref(false)
const previewText = computed(() => {
  const text = latestLetter.value?.content || ''
  if (text.length <= PREVIEW_CHARS) return text
  return text.slice(0, PREVIEW_CHARS) + '…'
})
const isLong = computed(() => (latestLetter.value?.content.length || 0) > PREVIEW_CHARS)

onMounted(async () => {
  await Promise.all([fetchSecondary(), messages.refreshLatest()])
  if (special.isSpecial.value && settings.value.showSpecialDateHint) {
    setTimeout(() => hearts.rain(40), 200)
  }
})

watch(() => chat.lastEventTime, (t, old) => {
  if (!t || t === old) return
  if (['diary', 'moment'].includes(chat.lastEventType)) fetchSecondary()
  if (['message', 'read'].includes(chat.lastEventType)) messages.refreshLatest()
})

async function fetchSecondary() {
  loading.value = true
  try {
    const [diaries, moments] = await Promise.all([getAllDiaries(), getAllMoments()])
    diaryCount.value = diaries.data.length
    momentCount.value = moments.data.length
  } catch {
    // silent
  } finally {
    loading.value = false
  }
}

function openLatestLetter() {
  if (!latestLetter.value) return
  // First click on an unread letter: mark it read by toggling the store
  // expanded state on (idempotent — store guards against double markRead).
  if (!isLatestRead.value) {
    messages.toggle(latestLetter.value)
    return
  }
  // Already read: jump straight to the full-text dialog.
  showFullLetter.value = true
}

function readFullText() {
  if (!latestLetter.value) return
  // Defensive: if the user somehow has an unread long letter, mark it
  // read on the way to the full-text view.
  if (!isLatestRead.value) messages.toggle(latestLetter.value)
  showFullLetter.value = true
}

function goWriteDiary() { router.push('/diary?compose=1') }

async function onPullRefresh() {
  await Promise.all([fetchSecondary(), messages.refreshLatest()])
}

function formatDate(s: string): string {
  const d = new Date(s)
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}
function formatDateTime(s: string): string {
  const d = new Date(s)
  return `${formatDate(s)} ${d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
}
</script>

<template>
  <div class="home-page">
    <PullToRefresh @refresh="onPullRefresh" />
    <!-- Hero: the day counter -->
    <header class="hero">
      <p class="hero-line">
        <span>{{ heroLine }}</span>
        <span class="hero-num">{{ days }}</span>
        <span>{{ heroLineSuffix }}</span>
      </p>
      <p class="hero-date">{{ todayLabel }}</p>
      <p v-if="special.isSpecial.value && settings.showSpecialDateHint" class="hero-special">
        ✨ 今天{{ special.note.value }}
      </p>
    </header>

    <!-- Inline stats: small, no cards -->
    <div class="stats-line" v-loading="loading">
      <router-link to="/diary" class="stat">
        <span class="stat-icon">📖</span>
        已写日记 <em>{{ diaryCount }}</em> 篇
      </router-link>
      <router-link to="/discover/message" class="stat">
        <span class="stat-icon">💌</span>
        留言 <em>{{ messageCount }}</em> 条
      </router-link>
      <router-link to="/discover/moment" class="stat">
        <span class="stat-icon">📷</span>
        瞬间 <em>{{ momentCount }}</em> 个
      </router-link>
    </div>

    <hr class="divider" />

    <!-- Latest letter from the partner -->
    <section class="recent">
      <p class="recent-label">{{ partnerName }} 最近写给你的</p>

      <div
        v-if="latestLetter"
        class="latest-letter"
        :class="{
          unread: !isLatestRead,
          opened: isLatestRead,
        }"
        @click="openLatestLetter"
      >
        <div class="letter-meta">
          <span class="letter-from">{{ latestLetter.senderName }}</span>
          <span class="letter-date">{{ formatDate(latestLetter.createTime) }}</span>
          <span v-if="!isLatestRead" class="seal">✦</span>
        </div>

        <template v-if="isLatestRead">
          <blockquote class="recent-quote font-serif">{{ previewText }}</blockquote>
          <button
            v-if="isLong"
            class="read-more"
            type="button"
            @click.stop="readFullText"
          >读全文 →</button>
        </template>
        <p v-else class="recent-hint">点一下，拆开看看 →</p>
      </div>

      <blockquote v-else class="recent-quote font-serif placeholder">
        希望以后看到这些的时候，<br />
        你会知道我曾经认真喜欢过你。
      </blockquote>
    </section>

    <!-- Full-text dialog: the letter as a piece of letter paper -->
    <el-dialog
      v-model="showFullLetter"
      width="560px"
      :show-close="true"
      :title="latestLetter ? `来自 ${latestLetter.senderName} 的信` : ''"
    >
      <article v-if="latestLetter" class="full-letter font-serif">
        <p class="full-letter-date">{{ formatDateTime(latestLetter.createTime) }}</p>
        <div class="full-letter-body">{{ latestLetter.content }}</div>
      </article>
    </el-dialog>

    <hr class="divider" />

    <!-- Single primary action -->
    <div class="actions">
      <button class="btn-romance primary-action" @click="goWriteDiary">
        写一篇今天的日记 →
      </button>
      <div class="secondary-row">
        <router-link to="/discover/message" class="secondary-link">写一封漂流瓶</router-link>
        <span class="dot">·</span>
        <router-link to="/discover/timeline" class="secondary-link">看看我们的时间轴</router-link>
      </div>
    </div>
  </div>
</template>

<style scoped>
.home-page {
  max-width: 640px;
  margin: 0 auto;
  padding: var(--space-page-y) var(--space-page-x);
  /* Reserve room for the bottom tab bar on small screens */
  padding-bottom: calc(var(--space-page-y) + var(--tab-bar-height));
  animation: fade-up 0.7s ease-out;
}

.hero { text-align: center; margin-bottom: 24px; }
.hero-line {
  font-family: var(--font-serif);
  font-size: 22px;
  font-weight: 500;
  color: var(--ink-warm);
  margin: 0 0 6px;
  line-height: 1.4;
  letter-spacing: 0.5px;
}
.hero-num {
  display: inline-block;
  margin: 0 6px;
  font-family: var(--font-script);
  font-size: 44px;
  font-weight: 700;
  background: linear-gradient(135deg, var(--pink-600), var(--rose-heart));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  vertical-align: -6px;
}
.hero-date { font-size: 13px; color: var(--ink-mute); margin: 0; letter-spacing: 1px; }
.hero-special {
  margin: 10px 0 0;
  font-family: var(--font-script);
  font-size: 20px;
  color: var(--rose-heart);
  letter-spacing: 0.5px;
}

.stats-line {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 12px 24px;
  margin-bottom: 20px;
}
.stat {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 13px; color: var(--ink-soft);
  text-decoration: none;
  transition: color 0.2s;
}
.stat:hover { color: var(--pink-700); }
.stat-icon { font-size: 16px; }
.stat em {
  font-style: normal; font-weight: 600;
  color: var(--pink-700);
  margin: 0 2px;
}

.divider {
  border: 0;
  border-top: 1px dashed var(--pink-300);
  margin: 20px auto;
  width: 56px;
}

.recent { text-align: center; }
.recent-label {
  font-size: 12px; color: var(--ink-mute);
  letter-spacing: 2px; margin: 0 0 12px;
  text-transform: uppercase;
}

.latest-letter {
  position: relative;
  max-width: 480px;
  margin: 0 auto;
  padding: 14px 20px;
  text-align: left;
  background: #fff;
  border: 1px solid var(--pink-300);
  border-radius: 14px;
  box-shadow: 0 4px 14px rgba(255,126,182,0.1);
  transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s;
}
.latest-letter.unread {
  cursor: pointer;
  border-color: var(--pink-600);
  box-shadow: 0 6px 22px rgba(255,77,109,0.18);
}
.latest-letter.unread:hover { transform: translateY(-2px); }
.latest-letter.opened {
  cursor: pointer;
  background-image: repeating-linear-gradient(
    to bottom, transparent 0, transparent 27px,
    var(--pink-200) 27px, var(--pink-200) 28px
  );
  border-left: 4px solid var(--pink-400);
}
.latest-letter.opened:hover { box-shadow: 0 6px 22px rgba(255,126,182,0.18); }

.letter-meta {
  display: flex; align-items: center; gap: 10px;
  font-size: 12px; color: var(--ink-mute);
  margin-bottom: 6px;
  letter-spacing: 0.5px;
}
.letter-from { font-weight: 500; color: var(--pink-700); font-size: 13px; }
.letter-date { color: var(--ink-mute); }

.seal {
  margin-left: auto;
  width: 22px; height: 22px;
  background: linear-gradient(135deg, var(--pink-600), var(--rose-heart));
  color: #fff;
  border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 12px;
  box-shadow: 0 2px 5px rgba(255,77,109,0.4);
}

.recent-quote {
  margin: 0;
  font-size: 15px;
  line-height: 1.7;
  color: var(--ink-warm);
  letter-spacing: 0.5px;
  white-space: pre-wrap;
  word-break: break-word;
}
.recent-quote.placeholder {
  font-size: 16px;
  color: var(--ink-soft);
  text-align: center;
}

.recent-hint {
  margin: 0;
  font-size: 13px;
  color: var(--ink-mute);
  font-style: italic;
}

.read-more {
  display: inline-block;
  margin-top: 8px;
  padding: 3px 10px;
  background: transparent;
  border: 1px solid var(--pink-300);
  border-radius: 999px;
  color: var(--pink-700);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s;
}
.read-more:hover { background: var(--pink-200); border-color: var(--pink-600); }

/* === Full-text dialog === */
.full-letter {
  background: #FFFCFD;
  background-image: repeating-linear-gradient(
    to bottom, transparent 0, transparent 31px,
    var(--pink-200) 31px, var(--pink-200) 32px
  );
  border-left: 4px solid var(--pink-400);
  border-radius: 12px;
  padding: 24px 28px;
}
.full-letter-date {
  margin: 0 0 16px;
  font-size: 12px;
  color: var(--ink-mute);
  letter-spacing: 1px;
}
.full-letter-body {
  font-size: 16px;
  line-height: 32px;
  color: var(--ink-warm);
  white-space: pre-wrap;
  word-break: break-word;
  letter-spacing: 0.5px;
}

.actions { text-align: center; margin-top: 8px; }
.primary-action {
  font-family: var(--font-serif);
  font-size: 15px;
  padding: 10px 24px;
}
.secondary-row {
  margin-top: 12px;
  font-size: 13px;
  color: var(--ink-mute);
}
.secondary-link {
  color: var(--ink-soft);
  text-decoration: none;
  transition: color 0.2s;
}
.secondary-link:hover { color: var(--pink-700); }
.dot { margin: 0 10px; color: var(--ink-faint); }

@media (max-width: 600px) {
  .hero-line { font-size: 18px; }
  .hero-num { font-size: 36px; }
  .latest-letter { padding: 12px 16px; }
  .divider { margin: 14px auto; }
  .stats-line { gap: 8px 16px; font-size: 12px; }
  .secondary-row { font-size: 12px; }
  .dot { margin: 0 6px; }
}
</style>
