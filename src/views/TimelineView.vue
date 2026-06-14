<script setup lang="ts">
/**
 * 我们的时间轴 — "回忆年表".
 *
 * This view is no longer a raw merged list. It presents a compact
 * month/day archive:
 *   - Summary counters at the top
 *   - Type filter (all / diary / moment / message)
 *   - Months collapsible
 *   - Days grouped, with sections for diary / moments / messages / milestones
 *   - Moment media thumbnails (max 3)
 *   - Click sections to jump to the relevant page where possible
 *
 * Deep linking is deliberately basic in Stage A:
 *   - diary → /diary?date=yyyy-MM-dd (DiaryView already loads via /diary/day)
 *   - moment → /moment?momentId=id (MomentView can add highlight later)
 *   - message → /message?messageId=id (MessageView can add deep search later)
 */
import { onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useChatStore } from '@/stores/chat'
import { useTimeline, type TimelineFilter } from '@/composables/useTimeline'
import { resolveAssetUrl } from '@/api/client'
import BackToTop from '@/components/BackToTop.vue'
import BackButton from '@/components/BackButton.vue'
import PullToRefresh from '@/components/PullToRefresh.vue'
import type { Moment, Message } from '@/types'

const router = useRouter()
const chat = useChatStore()
const tl = useTimeline()

onMounted(tl.load)

watch(() => chat.lastEventTime, (t, old) => {
  if (!t || t === old) return
  if (['diary', 'diary_delete', 'moment', 'moment_delete', 'message', 'read'].includes(chat.lastEventType)) {
    tl.load()
  }
})

function setFilter(v: TimelineFilter) { tl.setFilter(v) }

function goDiary(date: string) { router.push(`/diary?date=${date}`) }
function goMoment(m: Moment) { router.push(`/discover/moment?momentId=${m.id}`) }
function goMessage(m: Message) { router.push(`/discover/message?messageId=${m.id}`) }

function trim(s: string, n = 44): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}
function timeOf(s: string): string {
  return new Date(s).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}
function momentThumbs(m: Moment) {
  return (m.mediaList || []).slice(0, 3)
}
</script>

<template>
  <div class="timeline-page">
    <PullToRefresh @refresh="tl.load" />
    <header class="page-head">
      <BackButton class="page-back" />
      <h1 class="title font-serif">我们的时间轴</h1>
      <p class="subtitle">把那些日子，一天一天串起来</p>
    </header>

    <!-- Overview -->
    <section class="overview">
      <p class="overview-line font-serif">
        从 <span>2026.05.24</span> 开始，已经记录了 <strong>{{ tl.stats.value.sinceDays }}</strong> 天。
      </p>
      <div class="stat-row">
        <span>📖 {{ tl.stats.value.diaryCount }} 段</span>
        <span>📷 {{ tl.stats.value.momentCount }} 条</span>
        <span>💌 {{ tl.stats.value.messageCount }} 封</span>
        <span>☁️ {{ tl.stats.value.recordedDayCount }} 天</span>
      </div>
    </section>

    <!-- Filters -->
    <nav class="filters" aria-label="时间轴筛选">
      <button :class="{ active: tl.filter.value === 'all' }" @click="setFilter('all')">全部</button>
      <button :class="{ active: tl.filter.value === 'diary' }" @click="setFilter('diary')">日记</button>
      <button :class="{ active: tl.filter.value === 'moment' }" @click="setFilter('moment')">瞬间</button>
      <button :class="{ active: tl.filter.value === 'message' }" @click="setFilter('message')">漂流瓶</button>
    </nav>

    <div v-loading="tl.loading.value" class="timeline">
      <p v-if="tl.error.value" class="empty">{{ tl.error.value }}</p>
      <p v-else-if="!tl.loading.value && tl.filteredMonths.value.length === 0" class="empty">
        还没有可以放进时间轴的记录。
      </p>

      <section v-for="month in tl.filteredMonths.value" :key="month.monthKey" class="month-block">
        <button class="month-head" type="button" @click="tl.toggleMonth(month.monthKey)">
          <span class="chev">{{ tl.collapsedMonths.value.has(month.monthKey) ? '▶' : '▼' }}</span>
          <span class="month-title font-serif">{{ month.title }}</span>
          <span class="month-count">{{ month.days.length }} 天</span>
        </button>

        <Transition name="month-fold">
          <div v-if="!tl.collapsedMonths.value.has(month.monthKey)" class="days">
            <article v-for="day in month.days" :key="day.date" class="day-card">
              <div class="day-date">
                <span class="date-main font-script">{{ day.displayDate }}</span>
                <span class="weekday">{{ day.weekday }}</span>
              </div>

              <div class="day-line">
                <!-- Milestones -->
                <section v-if="day.milestones.length" class="section milestones">
                  <div v-for="m in day.milestones" :key="m.id" class="milestone">
                    <span class="emoji">{{ m.emoji }}</span>
                    <span>{{ m.title }}</span>
                  </div>
                </section>

                <!-- Diaries -->
                <section v-if="day.diaries.length" class="section clickable" @click="goDiary(day.date)">
                  <h3>📖 日记 · {{ day.diaries.length }} 段</h3>
                  <ul class="entry-list">
                    <li v-for="d in day.diaries.slice(0, 3)" :key="d.id">
                      <span class="time">{{ timeOf(d.createTime) }}</span>
                      <span class="entry-title">{{ trim(d.title, 22) }}</span>
                      <span class="preview">{{ trim(d.content, 32) }}</span>
                    </li>
                  </ul>
                  <p v-if="day.diaries.length > 3" class="more">还有 {{ day.diaries.length - 3 }} 段…</p>
                </section>

                <!-- Moments -->
                <section v-if="day.moments.length" class="section">
                  <h3>📷 瞬间 · {{ day.moments.length }} 条</h3>
                  <div v-for="m in day.moments.slice(0, 2)" :key="m.id" class="moment-row clickable" @click="goMoment(m)">
                    <div v-if="momentThumbs(m).length" class="thumbs">
                      <div v-for="media in momentThumbs(m)" :key="media.url" class="thumb" :class="'kind-' + media.type">
                        <img v-if="media.type === 'image'" :src="resolveAssetUrl(media.url)" alt="" />
                        <video v-else :src="resolveAssetUrl(media.url)" preload="metadata" muted playsinline />
                        <span v-if="media.type === 'video'" class="video-mark">▶</span>
                      </div>
                    </div>
                    <p class="moment-text">{{ trim(m.content, 52) }}</p>
                  </div>
                  <p v-if="day.moments.length > 2" class="more">还有 {{ day.moments.length - 2 }} 条…</p>
                </section>

                <!-- Messages -->
                <section v-if="day.messages.length" class="section">
                  <h3>💌 漂流瓶 · {{ day.messages.length }} 封</h3>
                  <div
                    v-for="m in day.messages.slice(0, 3)"
                    :key="m.id"
                    class="message-row clickable"
                    @click="goMessage(m)"
                  >
                    <span class="time">{{ timeOf(m.createTime) }}</span>
                    <span class="quote">“{{ trim(m.content, 42) }}”</span>
                  </div>
                  <p v-if="day.messages.length > 3" class="more">还有 {{ day.messages.length - 3 }} 封…</p>
                </section>
              </div>
            </article>
          </div>
        </Transition>
      </section>
    </div>

    <BackToTop />
  </div>
</template>

<style scoped>
.timeline-page {
  max-width: 780px;
  margin: 0 auto;
  padding: var(--space-page-y) var(--space-page-x);
  padding-bottom: calc(var(--space-page-y) + var(--tab-bar-height));
}

.page-head { text-align: center; margin-bottom: 28px; position: relative; }
.title { font-size: 32px; font-weight: 600; color: var(--ink-warm); letter-spacing: 4px; margin: 0 0 4px; }
.subtitle { font-size: 13px; color: var(--ink-mute); margin: 0; }

.overview {
  background: #fff;
  border: 1px solid var(--pink-300);
  border-radius: 18px;
  padding: 18px 20px;
  box-shadow: 0 4px 16px rgba(255,126,182,0.08);
  margin-bottom: 18px;
  text-align: center;
}
.overview-line { margin: 0 0 12px; color: var(--ink-warm); line-height: 1.8; }
.overview-line span { color: var(--pink-700); }
.overview-line strong { font-size: 24px; color: var(--rose-heart); font-family: var(--font-script); }
.stat-row { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px 20px; font-size: 13px; color: var(--ink-soft); }

.filters { display: flex; justify-content: center; gap: 6px; margin: 18px 0 28px; }
.filters button {
  padding: 6px 16px;
  border-radius: 999px;
  border: 1px solid var(--pink-300);
  background: transparent;
  color: var(--ink-soft);
  cursor: pointer;
  font-size: 13px;
  transition: all 0.15s;
}
.filters button.active { background: linear-gradient(135deg, var(--pink-600), var(--rose-heart)); color: #fff; border-color: transparent; }
@media (hover: hover) { .filters button:hover:not(.active) { background: var(--pink-200); } }

.empty { text-align: center; color: var(--ink-mute); padding: 60px 0; }

.month-block { margin-bottom: 28px; }
.month-head {
  width: 100%;
  display: flex; align-items: center; gap: 10px;
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--ink-warm);
  padding: 8px 4px;
  border-bottom: 1px dashed var(--pink-300);
}
.chev { color: var(--pink-700); font-size: 12px; width: 14px; }
.month-title { font-size: 22px; font-weight: 600; letter-spacing: 1px; }
.month-count { margin-left: auto; font-size: 12px; color: var(--ink-mute); }

.days { padding-top: 16px; }
.day-card {
  display: grid;
  grid-template-columns: 86px 1fr;
  gap: 14px;
  margin-bottom: 22px;
}
.day-date { text-align: right; padding-top: 4px; }
.date-main { display: block; font-size: 28px; color: var(--pink-700); line-height: 1; }
.weekday { font-size: 12px; color: var(--ink-mute); }
.day-line {
  position: relative;
  padding-left: 18px;
  border-left: 2px solid var(--pink-300);
}
.day-line::before {
  content: '';
  position: absolute;
  left: -7px; top: 8px;
  width: 12px; height: 12px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--pink-600), var(--rose-heart));
  box-shadow: 0 0 0 4px #fff;
}

.section {
  background: #fff;
  border: 1px solid var(--pink-300);
  border-radius: 14px;
  padding: 12px 14px;
  margin-bottom: 10px;
  box-shadow: 0 2px 10px rgba(255,126,182,0.05);
}
.section h3 { margin: 0 0 8px; font-size: 14px; color: var(--pink-700); font-weight: 600; }
.clickable { cursor: pointer; }
@media (hover: hover) { .clickable:hover { border-color: var(--pink-600); background: var(--pink-50); } }

.milestone { display: flex; align-items: center; gap: 8px; font-family: var(--font-serif); color: var(--pink-700); }
.emoji { font-size: 18px; }

.entry-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
.entry-list li { display: grid; grid-template-columns: 44px minmax(0, 88px) 1fr; gap: 8px; align-items: baseline; font-size: 13px; color: var(--ink-soft); }
.time { color: var(--ink-mute); font-size: 12px; }
.entry-title { color: var(--ink-warm); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.preview { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.moment-row { display: flex; gap: 10px; align-items: center; padding: 4px 0; }
.thumbs { display: flex; gap: 3px; flex-shrink: 0; }
.thumb { position: relative; width: 42px; height: 42px; border-radius: 8px; overflow: hidden; background: var(--pink-100); }
.thumb img, .thumb video { width: 100%; height: 100%; object-fit: cover; display: block; }
.video-mark { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #fff; background: rgba(0,0,0,0.25); font-size: 14px; }
.moment-text { margin: 0; font-size: 13px; color: var(--ink-soft); line-height: 1.5; }

.message-row { display: flex; gap: 8px; align-items: baseline; padding: 4px 0; font-size: 13px; color: var(--ink-soft); }
.quote { line-height: 1.6; }
.more { margin: 6px 0 0; font-size: 12px; color: var(--ink-mute); }

.month-fold-enter-active, .month-fold-leave-active { transition: opacity 0.18s, transform 0.18s; }
.month-fold-enter-from, .month-fold-leave-to { opacity: 0; transform: translateY(-4px); }

@media (max-width: 960px) {
  .title { font-size: 26px; letter-spacing: 3px; }
  .overview { padding: 14px 16px; }
  .filters { overflow-x: auto; justify-content: flex-start; padding-bottom: 4px; }
  .filters button { flex: 0 0 auto; }
  .month-title { font-size: 19px; }
  .day-card { grid-template-columns: 58px 1fr; gap: 10px; }
  .date-main { font-size: 22px; }
  .day-line { padding-left: 14px; }
  .section { padding: 10px 12px; }
  .entry-list li { grid-template-columns: 40px 1fr; }
  .entry-list .preview { grid-column: 2; white-space: normal; }
}
</style>
