<script setup lang="ts">
/**
 * 日记本 —按天合并 + 懒加载。
 *
 * Backend now returns day-grouped pages via /diary/days. We render one
 * letter paper per date; multiple diaries written on the same day are
 * displayed as separate entries inside that one letter. The database still
 * keeps every diary as an independent row, so time/mood/weather/delete all
 * remain precise.
 */
import { ref, onMounted, watch, computed, nextTick, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useChatStore } from '@/stores/chat'
import { useAuthStore } from '@/stores/auth'
import {
  createDiary,
  getDiaryDays,
  getDiaryDay,
  deleteDiary,
  updateDiaryPrivacy,
  type DiaryScope,
} from '@/api/diary'
import type { Diary, DiaryCreateRequest, DiaryDayGroup } from '@/types'
import { ElMessage, ElMessageBox } from 'element-plus'
import DiaryCalendar from '@/components/DiaryCalendar.vue'
import BackToTop from '@/components/BackToTop.vue'
import PullToRefresh from '@/components/PullToRefresh.vue'
import { useSettings } from '@/composables/useSettings'

const PAGE_SIZE = 10

const chat = useChatStore()
const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const settings = useSettings()

const dayGroups = ref<DiaryDayGroup[]>([])
const loading = ref(false)
const loadingMore = ref(false)
const hasMore = ref(true)
const nextCursorDate = ref<string | null>(null)
const tab = ref<DiaryScope>(settings.value.diaryDefaultScope)
/** Only meaningful when tab === 'mine': filter the visible diaries by
 *  privacy. 'all' shows everything, 'public' filters to entries the
 *  partner can see, 'private' to ones marked 仅自己可见. */
const mineFilter = ref<'all' | 'public' | 'private'>('all')
const showCreate = ref(false)
const showMobileCalendar = ref(false)
const selectedDate = ref<string | undefined>(undefined)
const loadMoreEl = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

interface CreateForm {
  title: string
  content: string
  mood: string
  weather: string
  isPrivate: boolean
}
const blankForm = (): CreateForm => ({ title: '', content: '', mood: '', weather: '', isPrivate: false })
const createForm = ref<CreateForm>(blankForm())

interface Glyph { value: string; emoji: string; label: string }
const MOODS: Glyph[] = [
  { value: 'happy', emoji: '😊', label: '开心' },
  { value: 'calm', emoji: '☁️', label: '平静' },
  { value: 'excited', emoji: '✨', label: '雀跃' },
  { value: 'grateful', emoji: '🌷', label: '感激' },
  { value: 'sad', emoji: '🌧️', label: '难过' },
  { value: 'anxious', emoji: '🌙', label: '不安' },
]
const WEATHERS: Glyph[] = [
  { value: 'sunny', emoji: '☀️', label: '晴' },
  { value: 'cloudy', emoji: '⛅', label: '多云' },
  { value: 'rainy', emoji: '🌧️', label: '雨' },
  { value: 'snowy', emoji: '❄️', label: '雪' },
  { value: 'windy', emoji: '🍃', label: '风' },
]

function moodEmoji(v: string | null) { return MOODS.find(m => m.value === v)?.emoji || '' }
function weatherEmoji(v: string | null) { return WEATHERS.find(w => w.value === v)?.emoji || '' }

/** All loaded day keys. Note: without a dedicated "all diary dates" API,
 *  the calendar can only mark days that are currently loaded or have been
 *  individually queried via /diary/day. */
const diaryDateKeys = computed(() => dayGroups.value.map((g) => g.date))

/** Apply the mine-only privacy filter without mutating store state. The
 *  feed always loads everything; visibility decisions live here. */
const visibleDayGroups = computed<DiaryDayGroup[]>(() => {
  if (tab.value !== 'mine' || mineFilter.value === 'all') return dayGroups.value
  const want = mineFilter.value === 'private' ? 1 : 0
  const out: DiaryDayGroup[] = []
  for (const g of dayGroups.value) {
    const entries = g.entries.filter((e) => (e.isPrivate ?? 0) === want)
    if (entries.length) out.push({ ...g, entries })
  }
  return out
})

onMounted(async () => {
  if (route.query.compose === '1') {
    showCreate.value = true
    router.replace({ query: {} })
  }
  await resetAndLoad()
  setupInfiniteObserver()
  const qDate = typeof route.query.date === 'string' ? route.query.date : ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(qDate)) {
    onDateSelect(qDate)
  }
})

onBeforeUnmount(() => observer?.disconnect())

watch(() => chat.lastEventTime, (t, old) => {
  if (!t || t === old) return
  // diary_delete: a row was removed somewhere — reset to drop it from the
  // local feed reliably.
  if (chat.lastEventType === 'diary_delete') {
    resetAndLoad()
    return
  }
  // diary: covers create / privacy update / future edits. We only want to
  // refresh when the event was authored by *the partner*; events triggered
  // by our own actions have already been mirrored optimistically and
  // resetAndLoad would scroll the user back to the top, which feels like
  // an unwanted page refresh.
  if (chat.lastEventType === 'diary') {
    const data = (chat.messages.at(-1)?.data || {}) as Record<string, unknown>
    const actorId = data.userId as number | undefined
    if (actorId !== undefined && actorId === auth.currentUser?.id) return
    resetAndLoad()
  }
})

async function resetAndLoad() {
  loading.value = true
  dayGroups.value = []
  nextCursorDate.value = null
  hasMore.value = true
  try {
    await loadNextPage()
  } catch {
    ElMessage.error('日记加载失败')
  } finally {
    loading.value = false
  }
}

async function loadNextPage() {
  if (!hasMore.value || loadingMore.value) return
  loadingMore.value = true
  try {
    const res = await getDiaryDays({
      scope: tab.value,
      cursorDate: nextCursorDate.value,
      size: PAGE_SIZE,
    })
    mergeDayGroups(res.data.list)
    nextCursorDate.value = res.data.nextCursorDate
    hasMore.value = res.data.hasMore
  } finally {
    loadingMore.value = false
  }
}

function mergeDayGroups(incoming: DiaryDayGroup[]) {
  const map = new Map(dayGroups.value.map((g) => [g.date, g]))
  for (const g of incoming) {
    const existing = map.get(g.date)
    if (existing) {
      const ids = new Set(existing.entries.map((e) => e.id))
      existing.entries.push(...g.entries.filter((e) => !ids.has(e.id)))
      existing.entries.sort(sortEntryAsc)
    } else {
      map.set(g.date, { ...g, entries: [...g.entries].sort(sortEntryAsc) })
    }
  }
  dayGroups.value = Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date))
}

function sortEntryAsc(a: Diary, b: Diary) {
  const t = new Date(a.createTime).getTime() - new Date(b.createTime).getTime()
  if (t !== 0) return t
  return a.id - b.id
}

function onTabChange() { resetAndLoad() }

function setupInfiniteObserver() {
  observer?.disconnect()
  // Use .route-frame as the scroll root because that's where page-level
  // scroll lives in this app (html/body are overflow:hidden). Falls back
  // to the viewport if the wrapper isn't found.
  const rootEl = document.querySelector('.route-frame') as Element | null
  observer = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) loadNextPage()
  }, { root: rootEl, rootMargin: '360px 0px' })
  watch(loadMoreEl, (el) => {
    observer?.disconnect()
    if (el) observer?.observe(el)
  }, { immediate: true })
}

async function handleCreate() {
  if (!createForm.value.title.trim() || !createForm.value.content.trim()) {
    ElMessage.warning('标题和正文都需要写一点')
    return
  }
  const data: DiaryCreateRequest = {
    title: createForm.value.title,
    content: createForm.value.content,
    mood: createForm.value.mood || undefined,
    weather: createForm.value.weather || undefined,
    isPrivate: createForm.value.isPrivate ? 1 : 0,
  }
  try {
    await createDiary(data)
    ElMessage.success('已经记下来了')
    showCreate.value = false
    createForm.value = blankForm()
    await resetAndLoad()
  } catch {
    ElMessage.error('保存失败')
  }
}

async function handleCancelCompose() {
  const f = createForm.value
  const hasDraft = f.title.trim() || f.content.trim() || f.mood || f.weather
  if (hasDraft) {
    try {
      await ElMessageBox.confirm('放弃这一篇吗？', '提示', {
        confirmButtonText: '放弃',
        cancelButtonText: '继续编辑',
        type: 'warning',
        customClass: 'pink-message-box',
      })
    } catch { return }
  }
  showCreate.value = false
  createForm.value = blankForm()
}

async function handleDelete(group: DiaryDayGroup, entry: Diary) {
  if (entry.userId !== auth.currentUser?.id) return

  if (settings.value.confirmDelete) {
    try {
      await ElMessageBox.confirm('确定要删除这一段日记吗？', '删除', {
        confirmButtonText: '删除',
        cancelButtonText: '再想想',
        type: 'warning',
        customClass: 'pink-message-box',
        confirmButtonClass: 'el-button--danger',
      })
    } catch { return }
  }

  const groupIdx = dayGroups.value.findIndex((g) => g.date === group.date)
  if (groupIdx === -1) return
  const entryIdx = dayGroups.value[groupIdx].entries.findIndex((e) => e.id === entry.id)
  if (entryIdx === -1) return

  const removed = dayGroups.value[groupIdx].entries.splice(entryIdx, 1)[0]
  let removedGroup: DiaryDayGroup | null = null
  if (dayGroups.value[groupIdx].entries.length === 0) {
    removedGroup = dayGroups.value.splice(groupIdx, 1)[0]
  }

  try {
    await deleteDiary(entry.id)
    ElMessage.success('已删除')
  } catch (e: any) {
    if (removedGroup) {
      dayGroups.value.splice(groupIdx, 0, removedGroup)
    } else {
      dayGroups.value[groupIdx].entries.splice(entryIdx, 0, removed)
    }
    const status = e?.code ?? e?.response?.status
    if (status === 405 || status === 404) {
      ElMessage.warning('删除功能还没准备好（后端 DELETE /diary 接口尚未上线）')
    } else if (status === 403) {
      ElMessage.error('只能删除自己写的日记')
    } else {
      ElMessage.error(e?.msg || '删除失败')
    }
  }
}

async function handleTogglePrivacy(entry: Diary) {
  if (entry.userId !== auth.currentUser?.id) return
  const next: 0 | 1 = entry.isPrivate ? 0 : 1

  // Optimistic flip; revert on failure.
  const prev = entry.isPrivate
  entry.isPrivate = next

  try {
    await updateDiaryPrivacy(entry.id, next)
    ElMessage.success(next ? '已设为仅自己可见' : '已设为对方也能看见')
  } catch (e: any) {
    entry.isPrivate = prev
    const status = e?.code ?? e?.response?.status
    if (status === 404 || status === 405) {
      ElMessage.warning('修改可见范围还没准备好（后端 PUT /diary/{id}/privacy 接口尚未上线）')
    } else if (status === 403) {
      ElMessage.error('只能修改自己写的日记')
    } else {
      ElMessage.error(e?.msg || '修改失败')
    }
  }
}

/** Calendar click: use /diary/day so the selected day works even if it
 * hasn't been included in the current paginated window yet. */
async function onDateSelect(dateKey: string) {
  selectedDate.value = dateKey
  showMobileCalendar.value = false

  let targetGroup = dayGroups.value.find((g) => g.date === dateKey)
  if (!targetGroup) {
    try {
      const res = await getDiaryDay({ scope: tab.value, date: dateKey })
      targetGroup = res.data
      if (targetGroup.entries.length > 0) {
        mergeDayGroups([targetGroup])
      }
    } catch {
      ElMessage.error('那天的日记加载失败')
      return
    }
  }

  if (!targetGroup || targetGroup.entries.length === 0) {
    ElMessage.info('那天还没有日记')
    return
  }

  await nextTick()
  const el = document.getElementById('day-' + dateKey)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  el.classList.add('flash')
  setTimeout(() => el.classList.remove('flash'), 1500)
}

function formatDayTitle(group: DiaryDayGroup) {
  const [y, m, d] = group.date.split('-')
  return `${y} 年 ${m} 月 ${d} 日 · ${group.weekday}`
}
function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}
function isOwned(d: Diary): boolean { return auth.currentUser?.id === d.userId }
</script>

<template>
  <div class="diary-page">
    <PullToRefresh @refresh="resetAndLoad" />
    <header class="page-head">
      <h1 class="title font-serif">日记本</h1>
      <p class="subtitle">每一天，都可以有很多句话</p>
      <div class="head-actions">
        <button class="btn-romance new-btn" @click="showCreate = true">写一篇</button>
      </div>
    </header>

    <div class="layout">
      <div class="list-col">
        <div class="tabs-row">
          <button
            class="tab-btn"
            :class="{ active: tab === 'all' }"
            @click="tab = 'all'; mineFilter = 'all'; onTabChange()"
          >全部</button>
          <button
            class="tab-btn"
            :class="{ active: tab === 'mine' }"
            @click="tab = 'mine'; onTabChange()"
          >只看我的</button>
        </div>

        <div v-if="tab === 'mine'" class="mine-filter">
          <button :class="{ active: mineFilter === 'all' }" @click="mineFilter = 'all'">全部</button>
          <button :class="{ active: mineFilter === 'public' }" @click="mineFilter = 'public'">公开</button>
          <button :class="{ active: mineFilter === 'private' }" @click="mineFilter = 'private'">仅自己可见</button>
        </div>

        <div v-loading="loading" class="diary-list">
          <p v-if="!loading && visibleDayGroups.length === 0" class="empty-hint">
            还是空的呢。<br />
            <span class="empty-cta" @click="showCreate = true">写下第一篇 →</span>
          </p>

          <article
            v-for="group in visibleDayGroups" :key="group.date"
            :id="'day-' + group.date"
            class="letter-day"
          >
            <div class="day-meta font-serif">
              <span>{{ formatDayTitle(group) }}</span>
              <span class="entry-count">{{ group.entries.length }} 篇</span>
            </div>

            <section
              v-for="entry in group.entries" :key="entry.id"
              class="diary-entry"
            >
              <div class="entry-meta">
                <span class="entry-time">{{ formatTime(entry.createTime) }}</span>
                <span v-if="entry.mood" :title="MOODS.find(m => m.value === entry.mood)?.label">{{ moodEmoji(entry.mood) }}</span>
                <span v-if="entry.weather" :title="WEATHERS.find(w => w.value === entry.weather)?.label">{{ weatherEmoji(entry.weather) }}</span>
                <span v-if="entry.isPrivate" title="只有自己能看">🔒</span>
                <el-dropdown
                  v-if="isOwned(entry)"
                  trigger="click"
                  placement="bottom-end"
                  class="entry-menu"
                >
                  <button class="menu-btn" type="button" aria-label="更多">⋮</button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item @click="handleTogglePrivacy(entry)">
                        <span>{{ entry.isPrivate ? '改为对方也能看' : '设为仅自己可见' }}</span>
                      </el-dropdown-item>
                      <el-dropdown-item @click="handleDelete(group, entry)">
                        <span class="danger-item">删除这一段</span>
                      </el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </div>
              <h2 class="entry-title font-serif">{{ entry.title }}</h2>
              <div class="entry-body font-serif">{{ entry.content }}</div>
            </section>

            <div class="letter-foot">
              <span class="letter-sign font-script">— {{ group.entries[0]?.userName || '' }}</span>
            </div>
          </article>

          <div ref="loadMoreEl" class="load-more">
            <span v-if="loadingMore">正在翻旧日记…</span>
            <span v-else-if="hasMore">继续往下，会看见更早的日子</span>
            <span v-else-if="dayGroups.length">已经到最早的日子了</span>
          </div>
        </div>
      </div>

      <aside class="cal-col desktop-only">
        <DiaryCalendar
          :diaries="diaryDateKeys"
          :selected="selectedDate"
          @select="onDateSelect"
        />
      </aside>
    </div>

    <div class="mobile-calendar-float mobile-only">
      <button
        type="button"
        class="calendar-fab"
        :class="{ active: showMobileCalendar }"
        aria-label="打开日历"
        @click="showMobileCalendar = !showMobileCalendar"
      >📅</button>

      <Transition name="calendar-pop">
        <div v-if="showMobileCalendar" class="calendar-popover">
          <DiaryCalendar
            :diaries="diaryDateKeys"
            :selected="selectedDate"
            compact
            @select="onDateSelect"
          />
        </div>
      </Transition>
    </div>

    <BackToTop />

    <el-dialog
      v-model="showCreate"
      width="600px"
      :close-on-click-modal="false"
      :show-close="false"
      :before-close="() => { handleCancelCompose() }"
      class="diary-compose-dialog"
    >
      <template #header>
        <div class="compose-head">
          <button type="button" class="head-btn" @click="handleCancelCompose">取消</button>
          <span class="head-title">写一篇日记</span>
          <button
            type="button"
            class="head-btn primary"
            :disabled="!createForm.title.trim() || !createForm.content.trim()"
            @click="handleCreate"
          >保存</button>
        </div>
      </template>

      <div class="compose-body">
        <input
          v-model="createForm.title"
          maxlength="100"
          placeholder="今天最想记下的一件事…"
          class="compose-title-input"
        />
        <textarea
          v-model="createForm.content"
          maxlength="2000"
          placeholder="慢慢说，没有人催你。"
          class="compose-textarea"
        ></textarea>

        <div class="compose-meta">
          <div class="meta-row">
            <span class="meta-label">心情</span>
            <div class="glyph-row">
              <button
                v-for="m in MOODS" :key="m.value"
                type="button"
                class="glyph-chip"
                :class="{ active: createForm.mood === m.value }"
                @click="createForm.mood = createForm.mood === m.value ? '' : m.value"
                :title="m.label"
              ><span class="g-emoji">{{ m.emoji }}</span></button>
            </div>
          </div>

          <div class="meta-row">
            <span class="meta-label">天气</span>
            <div class="glyph-row">
              <button
                v-for="w in WEATHERS" :key="w.value"
                type="button"
                class="glyph-chip"
                :class="{ active: createForm.weather === w.value }"
                @click="createForm.weather = createForm.weather === w.value ? '' : w.value"
                :title="w.label"
              ><span class="g-emoji">{{ w.emoji }}</span></button>
            </div>
          </div>

          <label class="private-row">
            <input type="checkbox" v-model="createForm.isPrivate" />
            <span>这一篇只想给自己看 🔒</span>
          </label>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<style scoped>
.diary-page {
  max-width: 1080px;
  margin: 0 auto;
  padding: var(--space-page-y) var(--space-page-x);
  padding-bottom: calc(var(--space-page-y) + var(--tab-bar-height));
}

.page-head { text-align: center; margin-bottom: 24px; position: relative; }
.title { font-size: 36px; font-weight: 600; color: var(--ink-warm); margin: 0 0 6px; letter-spacing: 4px; }
.subtitle { color: var(--ink-mute); font-size: 14px; margin: 0 0 16px; }
.head-actions { display: inline-flex; align-items: center; gap: 8px; }
.new-btn { padding: 10px 22px; font-size: 14px; }

.desktop-only { display: block; }
.mobile-only { display: none; }
@media (max-width: 960px) {
  .desktop-only { display: none; }
  .mobile-only { display: block; }
}

.mobile-calendar-float {
  position: fixed;
  right: 14px;
  bottom: calc(var(--tab-bar-height, 0px) + 68px);
  z-index: 82;
}
.calendar-fab {
  width: 38px; height: 38px;
  border-radius: 50%;
  border: 1px solid var(--pink-300);
  background: rgba(255, 255, 255, 0.94);
  backdrop-filter: blur(8px);
  color: var(--pink-700);
  box-shadow: 0 4px 16px rgba(255, 126, 182, 0.2);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  font-size: 18px;
}
.calendar-fab.active {
  background: linear-gradient(135deg, var(--pink-600), var(--rose-heart));
  color: #fff;
  border-color: transparent;
}
.calendar-fab:active { transform: scale(0.92); }
.calendar-popover {
  position: absolute;
  right: 0;
  bottom: 48px;
  width: min(320px, calc(100vw - 28px));
  max-height: min(58vh, 360px);
  overflow: auto;
  border-radius: 14px;
  box-shadow: 0 12px 36px rgba(92, 74, 82, 0.18);
  background: rgba(255, 248, 251, 0.96);
  backdrop-filter: blur(14px);
}
.calendar-pop-enter-active, .calendar-pop-leave-active { transition: opacity 0.18s, transform 0.18s; }
.calendar-pop-enter-from, .calendar-pop-leave-to { opacity: 0; transform: translateY(8px) scale(0.96); }

.layout { display: grid; grid-template-columns: 1fr 240px; gap: 32px; align-items: start; }
@media (max-width: 960px) { .layout { grid-template-columns: 1fr; gap: 0; } }
.list-col { min-width: 0; }
.cal-col { position: sticky; top: 76px; }

.tabs-row { display: flex; gap: 6px; justify-content: center; margin-bottom: 24px; }
.tab-btn {
  padding: 6px 18px; font-size: 13px;
  background: transparent; border: 1px solid var(--pink-300);
  border-radius: 999px; color: var(--ink-soft);
  cursor: pointer; transition: all 0.2s; min-height: 36px;
}
@media (hover: hover) { .tab-btn:hover { background: var(--pink-200); } }
.tab-btn.active { background: linear-gradient(135deg, var(--pink-600), var(--rose-heart)); color: #fff; border-color: transparent; }

.mine-filter {
  display: flex; gap: 6px; justify-content: center;
  margin: -8px 0 18px;
  font-size: 12px;
}
.mine-filter button {
  padding: 4px 12px;
  background: transparent;
  border: 1px solid var(--pink-300);
  border-radius: 999px;
  color: var(--ink-soft);
  cursor: pointer;
  min-height: 30px;
}
@media (hover: hover) { .mine-filter button:hover { background: var(--pink-200); } }
.mine-filter button.active {
  background: var(--pink-200);
  color: var(--pink-700);
  border-color: var(--pink-600);
}

.empty-hint { text-align: center; color: var(--ink-mute); font-size: 15px; line-height: 2; padding: 60px 0; }
.empty-cta { color: var(--pink-700); cursor: pointer; }

/* === Day letter paper === */
.letter-day {
  position: relative;
  background: #FFFCFD;
  background-image: repeating-linear-gradient(to bottom, transparent 0, transparent 31px, var(--pink-200) 31px, var(--pink-200) 32px);
  border-radius: 20px;
  border-left: 4px solid var(--pink-400);
  box-shadow: 0 8px 32px rgba(255, 126, 182, 0.12);
  padding: 30px 36px 26px;
  margin-bottom: 28px;
  animation: fade-up 0.5s ease;
  scroll-margin-top: 80px;
  transition: box-shadow 0.4s, transform 0.4s;
}
.letter-day.flash { box-shadow: 0 0 0 3px var(--pink-600), 0 12px 32px rgba(255, 77, 109, 0.25); transform: translateY(-2px); }

.day-meta {
  display: flex; align-items: center; gap: 12px;
  color: var(--ink-soft);
  font-size: 14px;
  margin-bottom: 18px;
  letter-spacing: 1px;
}
.entry-count {
  margin-left: auto;
  font-size: 12px;
  color: var(--pink-700);
  background: var(--pink-200);
  padding: 2px 8px;
  border-radius: 999px;
}

.diary-entry {
  position: relative;
  padding: 12px 0 18px;
  border-top: 1px dashed rgba(255, 196, 227, 0.8);
}
.diary-entry:first-of-type { border-top: none; padding-top: 0; }
.entry-meta {
  display: flex; align-items: center; gap: 8px;
  color: var(--ink-mute);
  font-size: 13px;
  margin-bottom: 8px;
}
.entry-time { color: var(--pink-700); font-weight: 500; letter-spacing: 0.5px; }
.entry-menu { margin-left: auto; }
.menu-btn {
  width: 28px; height: 28px;
  border: none; background: transparent;
  color: var(--ink-mute);
  font-size: 20px; line-height: 1;
  cursor: pointer;
  border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  padding-bottom: 4px;
}
@media (hover: hover) { .menu-btn:hover { background: var(--pink-200); color: var(--pink-700); } }
.danger-item { color: var(--rose-heart); }

.entry-title {
  margin: 0 0 8px;
  font-size: 20px; font-weight: 600;
  color: var(--ink-warm);
  letter-spacing: 1px;
  line-height: 1.5;
  word-break: break-word;
}
.entry-body {
  font-size: 16px;
  line-height: 32px;
  color: var(--ink-warm);
  white-space: pre-wrap;
  letter-spacing: 0.5px;
  word-break: break-word;
}
.letter-foot { display: flex; justify-content: flex-end; margin-top: 8px; padding-top: 12px; border-top: 1px dashed var(--pink-300); }
.letter-sign { font-size: 24px; color: var(--pink-700); letter-spacing: 1px; }

.load-more { text-align: center; color: var(--ink-mute); font-size: 13px; padding: 24px 0; }

/* === Compose dialog === */
:global(.diary-compose-dialog .el-dialog) { height: 80vh; height: 80dvh; max-height: 720px; display: flex; flex-direction: column; }
:global(.diary-compose-dialog .el-dialog__header) { padding: 0; margin-right: 0; border-bottom: 1px solid var(--pink-300); flex-shrink: 0; }
:global(.diary-compose-dialog .el-dialog__body) { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 0; overflow: hidden; }
@media (max-width: 600px) { :global(.diary-compose-dialog .el-dialog) { height: 100dvh; max-height: 100dvh; } }

.compose-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; }
.head-title { font-size: 15px; font-weight: 500; color: var(--ink-warm); }
.head-btn {
  background: none; border: none; padding: 6px 12px;
  font-size: 14px; color: var(--ink-soft); cursor: pointer;
  border-radius: 8px; min-height: 36px;
}
.head-btn:disabled { opacity: 0.4; cursor: not-allowed; }
@media (hover: hover) { .head-btn:hover:not(:disabled) { background: var(--pink-200); color: var(--pink-700); } }
.head-btn.primary { color: var(--pink-700); font-weight: 600; }

.compose-body { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 16px 20px 12px; gap: 12px; }
.compose-title-input {
  border: none; border-bottom: 1px solid var(--pink-300);
  padding: 8px 4px; font-size: 18px; font-weight: 500;
  font-family: var(--font-serif); color: var(--ink-warm);
  background: transparent; outline: none; flex-shrink: 0;
}
.compose-title-input::placeholder { color: var(--ink-faint); font-weight: 400; }
.compose-title-input:focus { border-bottom-color: var(--pink-600); }

.compose-textarea {
  flex: 1; min-height: 0; resize: none; border: none;
  padding: 8px 4px; font-size: 16px; font-family: var(--font-serif);
  line-height: 1.8; color: var(--ink-warm); background: transparent;
  outline: none; overflow-y: auto;
}
.compose-textarea::placeholder { color: var(--ink-faint); }

.compose-meta { flex-shrink: 0; border-top: 1px dashed var(--pink-300); padding-top: 12px; display: flex; flex-direction: column; gap: 10px; }
.meta-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.meta-label { font-size: 13px; color: var(--ink-soft); width: 36px; flex-shrink: 0; }
.glyph-row { display: flex; flex-wrap: wrap; gap: 6px; }
.glyph-chip {
  width: 36px; height: 36px;
  display: inline-flex; align-items: center; justify-content: center;
  background: #fff; border: 1px solid var(--pink-300);
  border-radius: 50%; cursor: pointer; transition: all 0.15s;
  font-size: 18px; padding: 0;
}
@media (hover: hover) { .glyph-chip:hover { background: var(--pink-200); } }
.glyph-chip.active { background: var(--pink-200); border-color: var(--pink-600); box-shadow: 0 0 0 2px rgba(255,126,182,0.2); }
.private-row { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--ink-soft); cursor: pointer; user-select: none; }
.private-row input { accent-color: var(--pink-600); width: 16px; height: 16px; }

@media (max-width: 960px) {
  .title { font-size: 28px; letter-spacing: 3px; }
  .letter-day { padding: 24px 22px 22px; margin-bottom: 20px; scroll-margin-top: 70px; }
  .entry-title { font-size: 18px; }
  .entry-body { font-size: 15px; line-height: 28px; }
  .day-meta { font-size: 13px; }
  .letter-sign { font-size: 20px; }
}
</style>
