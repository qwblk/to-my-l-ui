<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  getAnalyticsRecent,
  getAnalyticsSummary,
  type AnalyticsEventType,
  type AnalyticsRecentEvent,
  type AnalyticsSummary,
} from '@/api/analytics'

const loading = ref(false)
const days = ref(14)
const summary = ref<AnalyticsSummary | null>(null)
const recent = ref<AnalyticsRecentEvent[]>([])
const error = ref('')
const personFilter = ref<'all' | 'me' | 'partner' | 'anonymous'>('all')

const eventLabels: Record<AnalyticsEventType, string> = {
  session_start: '会话开始',
  auth_seen: '登录态回来',
  login_success: '手动登录',
  page_view: '页面访问',
  ritual_open: '打开入口',
  ritual_video_play: '播放视频',
  ritual_video_end: '看完视频',
  ritual_hand_view: '看到手',
  ritual_enter_click: '点击进入',
}

const funnelOrder: AnalyticsEventType[] = [
  'ritual_open',
  'ritual_video_play',
  'ritual_video_end',
  'ritual_hand_view',
  'ritual_enter_click',
  'login_success',
]

const maxDaily = computed(() => Math.max(1, ...(summary.value?.daily.map(d => d.sessionStart + d.authSeen + d.loginSuccess + d.pageView + d.ritualOpen) || [1])))

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [s, r] = await Promise.all([
      getAnalyticsSummary(days.value, personFilter.value),
      getAnalyticsRecent(200, personFilter.value),
    ])
    summary.value = s
    recent.value = r
  } catch (e: any) {
    error.value = e?.msg || e?.message || '统计加载失败'
  } finally {
    loading.value = false
  }
}

function setFilter(filter: typeof personFilter.value) {
  personFilter.value = filter
  load()
}

function labelOf(type: string) {
  return eventLabels[type as AnalyticsEventType] || type
}

function personOf(userId: number | null) {
  if (userId === 1) return '王水群'
  if (userId === 2) return '潘佩雪'
  return '未登录'
}

onMounted(load)
</script>

<template>
  <main class="analytics-page">
    <header class="page-head">
      <div>
        <p class="eyebrow">To My L</p>
        <h1 class="title font-serif">访问记录</h1>
        <p class="subtitle">只看必要的脚印：来过几次，走到了哪里。</p>
      </div>
      <div class="actions">
        <select v-model.number="days" @change="load">
          <option :value="7">最近 7 天</option>
          <option :value="14">最近 14 天</option>
          <option :value="30">最近 30 天</option>
        </select>
        <button type="button" :disabled="loading" @click="load">{{ loading ? '刷新中' : '刷新' }}</button>
        <span v-if="loading" class="loading-dot" aria-hidden="true"></span>
      </div>
    </header>

    <p v-if="error" class="error">{{ error }}</p>

    <template v-if="summary">
      <section class="filter-card">
        <span>查看</span>
        <button :class="{ active: personFilter === 'all' }" @click="setFilter('all')">全部</button>
        <button :class="{ active: personFilter === 'me' }" @click="setFilter('me')">王水群</button>
        <button :class="{ active: personFilter === 'partner' }" @click="setFilter('partner')">潘佩雪</button>
        <button :class="{ active: personFilter === 'anonymous' }" @click="setFilter('anonymous')">未登录</button>
      </section>

      <section class="cards">
        <article class="stat-card">
          <span>{{ personFilter === 'all' ? '总事件' : '筛选事件' }}</span>
          <strong>{{ summary.totalEvents }}</strong>
        </article>
        <article class="stat-card">
          <span>访客浏览器</span>
          <strong>{{ summary.uniqueVisitors }}</strong>
        </article>
        <article class="stat-card wide">
          <span>最近一次</span>
          <strong>{{ summary.lastVisitAt || '暂无' }}</strong>
        </article>
      </section>

      <section class="panel">
        <h2>入口漏斗</h2>
        <div class="funnel">
          <div v-for="type in funnelOrder" :key="type" class="funnel-step">
            <span>{{ labelOf(type) }}</span>
            <strong>{{ summary.funnel[type] || 0 }}</strong>
          </div>
        </div>
      </section>

      <section class="panel">
        <h2>每日概览</h2>
        <div class="daily-list">
          <div v-for="d in summary.daily" :key="d.date" class="daily-row">
            <span class="date">{{ d.date.slice(5) }}</span>
            <div class="bar-wrap">
              <span class="bar" :style="{ width: ((d.sessionStart + d.authSeen + d.loginSuccess + d.pageView + d.ritualOpen) / maxDaily * 100) + '%' }"></span>
            </div>
            <span class="num">{{ d.sessionStart + d.authSeen + d.loginSuccess + d.pageView + d.ritualOpen }}</span>
          </div>
        </div>
      </section>

      <section class="panel">
        <h2>事件分布</h2>
        <div class="event-grid">
          <div
            v-for="(count, type) in summary.byEventType"
            :key="type"
            class="event-pill"
          >
            <span>{{ labelOf(type) }}</span>
            <strong>{{ count }}</strong>
          </div>
        </div>
      </section>

      <section class="panel recent-panel">
        <h2>最近记录</h2>
        <div class="recent-list">
          <article v-for="e in recent" :key="e.id" class="recent-item">
            <div class="recent-main">
              <strong>{{ labelOf(e.eventType) }}</strong>
              <span>{{ e.path || '-' }}</span>
            </div>
            <span class="person">{{ personOf(e.userId) }}</span>
            <time>{{ e.createTime }}</time>
          </article>
        </div>
      </section>
    </template>
  </main>
</template>

<style scoped>
.analytics-page {
  max-width: 980px;
  margin: 0 auto;
  padding: var(--space-page-y) var(--space-page-x);
  padding-bottom: calc(var(--space-page-y) + var(--tab-bar-height));
}
.page-head {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: flex-end;
  margin-bottom: 22px;
}
.eyebrow { margin: 0 0 4px; color: var(--pink-700); font-size: 12px; letter-spacing: 1px; }
.title { margin: 0; color: var(--ink-warm); font-size: 32px; }
.subtitle { margin: 6px 0 0; color: var(--ink-mute); font-size: 14px; }
.actions { display: flex; gap: 8px; align-items: center; }
.actions select,
.actions button {
  height: 36px;
  border: 1px solid var(--pink-300);
  border-radius: 999px;
  background: #fff;
  color: var(--ink-soft);
  padding: 0 14px;
  transition: transform 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease, background 0.16s ease;
}
.actions select:hover {
  border-color: var(--pink-400);
  box-shadow: 0 6px 18px rgba(255,126,182,0.12);
}
.actions button {
  color: #fff;
  border: none;
  background: linear-gradient(135deg, var(--pink-600), var(--rose-heart));
  box-shadow: 0 8px 18px rgba(255,77,109,0.18);
}
.actions button:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 12px 26px rgba(255,77,109,0.26);
}
.actions button:disabled { opacity: 0.72; cursor: wait; }
.loading-dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  background: var(--rose-heart);
  box-shadow: 0 0 0 0 rgba(255,77,109,0.35);
  animation: loading-pulse 1s ease-in-out infinite;
}
.error { color: #e11d48; }
.filter-card,
.stat-card,
.panel {
  border: 1px solid var(--pink-300);
  border-radius: 22px;
  background: rgba(255,255,255,0.84);
  box-shadow: 0 8px 28px rgba(255,126,182,0.08);
  animation: analytics-rise 0.28s ease;
}
.stat-card,
.panel,
.filter-card {
  transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
}
.stat-card:hover,
.panel:hover,
.filter-card:hover {
  transform: translateY(-2px);
  border-color: var(--pink-400);
  box-shadow: 0 12px 34px rgba(255,126,182,0.13);
}
.filter-card {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  padding: 12px;
  margin-bottom: 14px;
}
.filter-card span { color: var(--ink-mute); font-size: 12px; margin-right: 4px; }
.filter-card button {
  border: 1px solid var(--pink-300);
  border-radius: 999px;
  background: #fff;
  color: var(--ink-soft);
  padding: 7px 12px;
  transition: transform 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease, background 0.16s ease;
}
.filter-card button:hover {
  transform: translateY(-1px);
  border-color: var(--pink-400);
  box-shadow: 0 6px 18px rgba(255,126,182,0.13);
}
.filter-card button.active {
  background: var(--rose-heart);
  color: #fff;
  border-color: transparent;
  box-shadow: 0 8px 18px rgba(255,77,109,0.18);
}
.cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 14px; }
.stat-card { padding: 18px; }
.stat-card span { color: var(--ink-mute); font-size: 12px; }
.stat-card strong { display: block; margin-top: 8px; color: var(--ink-warm); font-size: 26px; }
.panel { padding: 18px; margin-bottom: 14px; }
.panel h2 { margin: 0 0 14px; color: var(--ink-warm); font-size: 18px; }
.funnel { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; }
.funnel-step {
  min-height: 84px;
  border-radius: 18px;
  background: var(--pink-50);
  display: grid;
  place-items: center;
  text-align: center;
  padding: 10px;
}
.funnel-step span { color: var(--ink-mute); font-size: 12px; }
.funnel-step strong { color: var(--rose-heart); font-size: 24px; }
.daily-list { display: grid; gap: 8px; }
.daily-row { display: grid; grid-template-columns: 48px 1fr 36px; gap: 10px; align-items: center; }
.date, .num { color: var(--ink-mute); font-size: 12px; }
.bar-wrap { height: 10px; border-radius: 999px; background: var(--pink-100); overflow: hidden; }
.bar {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--pink-500), var(--rose-heart));
  transform-origin: left center;
  animation: bar-grow 0.42s ease both;
}
.event-grid { display: flex; flex-wrap: wrap; gap: 10px; }
.event-pill { display: inline-flex; gap: 8px; align-items: center; padding: 8px 12px; border-radius: 999px; background: var(--pink-50); color: var(--ink-soft); }
.event-pill strong { color: var(--rose-heart); }
.recent-panel { padding-bottom: 10px; }
.recent-list {
  max-height: 360px;
  overflow-y: auto;
  padding-right: 6px;
  display: grid;
  gap: 8px;
}
.recent-item {
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: center;
  gap: 12px;
  padding: 10px 8px;
  border-bottom: 1px dashed var(--pink-200);
  border-radius: 12px;
  transition: background 0.16s ease, transform 0.16s ease;
}
.recent-item:hover {
  background: var(--pink-50);
  transform: translateX(2px);
}
.recent-item:last-child { border-bottom: none; }
.recent-main { display: grid; gap: 2px; min-width: 0; }
.recent-main strong { color: var(--ink-warm); }
.recent-main span,
.recent-item time { color: var(--ink-mute); font-size: 12px; }
.person { color: var(--pink-700); font-size: 12px; white-space: nowrap; }

@keyframes analytics-rise {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes bar-grow {
  from { transform: scaleX(0); }
  to   { transform: scaleX(1); }
}
@keyframes loading-pulse {
  0%, 100% { transform: scale(0.9); box-shadow: 0 0 0 0 rgba(255,77,109,0.35); }
  50%      { transform: scale(1.15); box-shadow: 0 0 0 8px rgba(255,77,109,0); }
}
@media (prefers-reduced-motion: reduce) {
  .filter-card,
  .stat-card,
  .panel,
  .bar {
    animation: none;
  }
  .filter-card,
  .stat-card,
  .panel,
  .recent-item {
    transition: none;
  }
}

@media (max-width: 760px) {
  .page-head { display: block; }
  .actions { margin-top: 14px; }
  .cards { grid-template-columns: 1fr; }
  .funnel { grid-template-columns: repeat(2, 1fr); }
  .recent-item { grid-template-columns: 1fr; gap: 4px; }
}
</style>
