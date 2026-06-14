/**
 * Timeline aggregator — "回忆年表".
 *
 * Stage A implementation: pure frontend aggregation from existing APIs:
 *   - /diary/days?size=30  (recent day-grouped diary entries)
 *   - /moment/all
 *   - /message/received + /message/sent
 *
 * Produces month groups → day groups → type sections.
 *
 * This is intentionally not a backend timeline API yet. The project is
 * only two users, so a frontend composition layer is fine and gives us
 * flexibility to refine the emotional layout before locking backend shape.
 */
import { ref, computed } from 'vue'
import { getDiaryDays } from '@/api/diary'
import { getAllMoments } from '@/api/moment'
import { getReceivedMessages, getSentMessages } from '@/api/message'
import { SINCE_DATE } from '@/constants/user'
import type { Diary, DiaryDayGroup, Moment, Message } from '@/types'

export type TimelineFilter = 'all' | 'diary' | 'moment' | 'message'

export interface TimelineMilestone {
  id: string
  title: string
  emoji: string
  date: string // yyyy-MM-dd
  kind: 'anchor' | 'first_diary' | 'first_moment' | 'first_message' | 'special'
}

export interface TimelineDay {
  date: string          // yyyy-MM-dd
  displayDate: string   // MM.DD
  weekday: string
  diaries: Diary[]
  moments: Moment[]
  messages: Message[]
  milestones: TimelineMilestone[]
}

export interface TimelineMonth {
  monthKey: string       // yyyy-MM
  title: string          // 2026 年 06 月
  days: TimelineDay[]
}

export interface TimelineStats {
  sinceDays: number
  diaryCount: number
  momentCount: number
  messageCount: number
  recordedDayCount: number
}

const loading = ref(false)
const error = ref<string | null>(null)
const filter = ref<TimelineFilter>('all')
const collapsedMonths = ref<Set<string>>(new Set())

const diaryDays = ref<DiaryDayGroup[]>([])
const moments = ref<Moment[]>([])
const received = ref<Message[]>([])
const sent = ref<Message[]>([])

function dateKeyOf(s: string): string {
  return s.slice(0, 10)
}
function monthKeyOf(date: string): string { return date.slice(0, 7) }
function displayDate(date: string): string { return date.slice(5).replace('-', '.') }
function weekdayOf(date: string): string {
  const d = new Date(date + 'T00:00:00')
  return '星期' + ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
}
function monthTitle(monthKey: string): string {
  const [y, m] = monthKey.split('-')
  return `${y} 年 ${m} 月`
}
function daysSinceStart(): number {
  const start = new Date(SINCE_DATE + 'T00:00:00')
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  start.setHours(0, 0, 0, 0)
  return Math.max(1, Math.floor((today.getTime() - start.getTime()) / 86_400_000) + 1)
}

async function load() {
  loading.value = true
  error.value = null
  try {
    const [diaryRes, momentRes, recvRes, sentRes] = await Promise.all([
      // 30 days is enough for the "overview" timeline. DiaryView has
      // true infinite loading for full archive reading.
      getDiaryDays({ scope: 'all', size: 30 }),
      getAllMoments(),
      getReceivedMessages(),
      getSentMessages(),
    ])
    diaryDays.value = diaryRes.data.list
    moments.value = momentRes.data
    received.value = recvRes.data
    sent.value = sentRes.data

    // Collapse older months by default; keep the latest/current month open.
    const months = buildMonths(diaryDays.value, moments.value, [...received.value, ...sent.value])
    const first = months[0]?.monthKey
    collapsedMonths.value = new Set(months.slice(1).map((m) => m.monthKey).filter((k) => k !== first))
  } catch (e: any) {
    error.value = e?.msg || '时间轴加载失败'
  } finally {
    loading.value = false
  }
}

function toggleMonth(monthKey: string) {
  const next = new Set(collapsedMonths.value)
  if (next.has(monthKey)) next.delete(monthKey)
  else next.add(monthKey)
  collapsedMonths.value = next
}

function setFilter(v: TimelineFilter) { filter.value = v }

const allMessages = computed(() => [...received.value, ...sent.value])

const stats = computed<TimelineStats>(() => {
  const days = new Set<string>()
  for (const d of diaryDays.value) if (d.entries.length) days.add(d.date)
  for (const m of moments.value) days.add(dateKeyOf(m.createTime))
  for (const m of allMessages.value) days.add(dateKeyOf(m.createTime))
  days.add(SINCE_DATE)
  return {
    sinceDays: daysSinceStart(),
    diaryCount: diaryDays.value.reduce((n, d) => n + d.entries.length, 0),
    momentCount: moments.value.length,
    messageCount: allMessages.value.length,
    recordedDayCount: days.size,
  }
})

const months = computed<TimelineMonth[]>(() => {
  return buildMonths(diaryDays.value, moments.value, allMessages.value)
})

const filteredMonths = computed<TimelineMonth[]>(() => {
  if (filter.value === 'all') return months.value
  const f = filter.value as Exclude<TimelineFilter, 'all'>
  return months.value
    .map((m) => ({
      ...m,
      days: m.days
        .map((d) => filterDay(d, f))
        .filter(dayHasContent),
    }))
    .filter((m) => m.days.length > 0)
})

function filterDay(day: TimelineDay, f: Exclude<TimelineFilter, 'all'>): TimelineDay {
  return {
    ...day,
    diaries: f === 'diary' ? day.diaries : [],
    moments: f === 'moment' ? day.moments : [],
    messages: f === 'message' ? day.messages : [],
    milestones: f === 'diary' ? day.milestones.filter(m => m.kind === 'first_diary' || m.kind === 'anchor') : [],
  }
}

function dayHasContent(d: TimelineDay): boolean {
  return d.diaries.length > 0 || d.moments.length > 0 || d.messages.length > 0 || d.milestones.length > 0
}

function buildMonths(
  diaryGroups: DiaryDayGroup[],
  momentList: Moment[],
  messageList: Message[],
): TimelineMonth[] {
  const dayMap = new Map<string, TimelineDay>()

  function ensureDay(date: string): TimelineDay {
    let d = dayMap.get(date)
    if (!d) {
      d = {
        date,
        displayDate: displayDate(date),
        weekday: weekdayOf(date),
        diaries: [],
        moments: [],
        messages: [],
        milestones: [],
      }
      dayMap.set(date, d)
    }
    return d
  }

  // Diary groups already come as days with entries sorted ASC
  for (const g of diaryGroups) {
    ensureDay(g.date).diaries.push(...g.entries)
  }
  for (const m of momentList) ensureDay(dateKeyOf(m.createTime)).moments.push(m)
  for (const msg of messageList) ensureDay(dateKeyOf(msg.createTime)).messages.push(msg)

  // Fixed anchor: the day they met
  ensureDay(SINCE_DATE).milestones.push({
    id: 'anchor-since',
    date: SINCE_DATE,
    emoji: '✨',
    title: '我们认识的那天',
    kind: 'anchor',
  })

  // Automatic first-event milestones
  const allDiaries = diaryGroups.flatMap((g) => g.entries)
  const firstDiary = oldestByTime(allDiaries)
  if (firstDiary) {
    const date = dateKeyOf(firstDiary.createTime)
    ensureDay(date).milestones.push({ id: 'first-diary', date, emoji: '📖', title: '第一篇日记', kind: 'first_diary' })
  }
  const firstMoment = oldestByTime(momentList)
  if (firstMoment) {
    const date = dateKeyOf(firstMoment.createTime)
    ensureDay(date).milestones.push({ id: 'first-moment', date, emoji: '📷', title: '第一条瞬间', kind: 'first_moment' })
  }
  const firstMsg = oldestByTime(messageList)
  if (firstMsg) {
    const date = dateKeyOf(firstMsg.createTime)
    ensureDay(date).milestones.push({ id: 'first-message', date, emoji: '💌', title: '第一封漂流瓶', kind: 'first_message' })
  }

  // Sort content inside days
  for (const day of dayMap.values()) {
    day.diaries.sort((a, b) => new Date(a.createTime).getTime() - new Date(b.createTime).getTime())
    day.moments.sort((a, b) => new Date(a.createTime).getTime() - new Date(b.createTime).getTime())
    day.messages.sort((a, b) => new Date(a.createTime).getTime() - new Date(b.createTime).getTime())
  }

  const days = Array.from(dayMap.values()).filter(dayHasContent).sort((a, b) => b.date.localeCompare(a.date))
  const monthMap = new Map<string, TimelineDay[]>()
  for (const d of days) {
    const key = monthKeyOf(d.date)
    if (!monthMap.has(key)) monthMap.set(key, [])
    monthMap.get(key)!.push(d)
  }
  return Array.from(monthMap.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([monthKey, days]) => ({ monthKey, title: monthTitle(monthKey), days }))
}

function oldestByTime<T extends { createTime: string }>(list: T[]): T | undefined {
  return [...list].sort((a, b) => new Date(a.createTime).getTime() - new Date(b.createTime).getTime())[0]
}

export function useTimeline() {
  return {
    loading,
    error,
    filter,
    stats,
    months,
    filteredMonths,
    collapsedMonths,
    load,
    toggleMonth,
    setFilter,
  }
}
