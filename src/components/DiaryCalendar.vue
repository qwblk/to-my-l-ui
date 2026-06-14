<script setup lang="ts">
/**
 * DiaryCalendar — month grid that highlights days with diary entries
 * and emits a date selection on click.
 *
 * Lightweight by design — no Element Plus calendar (overkill, hard to
 * theme to match). 6 rows × 7 cols, ~250 lines including style.
 *
 * Visual cues:
 *   - Today: pink ring outline
 *   - Day with diary: filled pink dot under the number
 *   - Day with selected diary: pink filled background
 *   - Day in adjacent months: faded
 *
 * Props:
 *   - diaries: array of yyyy-MM-dd strings (or any date-shaped strings
 *     parseable by Date) — every day with at least one entry.
 *   - selected: optional yyyy-MM-dd of the active day (for highlight).
 *
 * Emits:
 *   - select(yyyyMmDd): user clicked a day. Even days without entries
 *     emit; the parent decides whether scrolling to "no diary" is a
 *     no-op or a UX cue.
 */
import { computed, ref } from 'vue'

const props = defineProps<{
  /** ISO-like date strings, only the date portion is used. Duplicates ok. */
  diaries: string[]
  selected?: string
  /** Compact density for sticky mobile calendar. */
  compact?: boolean
}>()

const emit = defineEmits<{
  (e: 'select', date: string): void
}>()

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

// Cursor month, defaults to today's month
const today = new Date()
const cursor = ref<{ year: number; month: number }>({
  year: today.getFullYear(),
  month: today.getMonth(),
})

const todayKey = formatDateKey(today)

const diarySet = computed(() => {
  const s = new Set<string>()
  for (const d of props.diaries) s.add(d.slice(0, 10))
  return s
})

interface Cell {
  date: Date
  day: number
  key: string                  // yyyy-MM-dd
  inMonth: boolean
  isToday: boolean
  hasDiary: boolean
  isSelected: boolean
}

const grid = computed<Cell[]>(() => {
  const { year, month } = cursor.value
  const firstOfMonth = new Date(year, month, 1)
  // Monday-first grid: shift so Monday is column 0
  const dayOfWeek = (firstOfMonth.getDay() + 6) % 7
  const start = new Date(year, month, 1 - dayOfWeek)

  const cells: Cell[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    const key = formatDateKey(d)
    cells.push({
      date: d,
      day: d.getDate(),
      key,
      inMonth: d.getMonth() === month,
      isToday: key === todayKey,
      hasDiary: diarySet.value.has(key),
      isSelected: !!props.selected && key === props.selected,
    })
  }
  return cells
})

const monthLabel = computed(() => {
  return `${cursor.value.year} 年 ${String(cursor.value.month + 1).padStart(2, '0')} 月`
})

function prevMonth() {
  const { year, month } = cursor.value
  cursor.value = month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 }
}
function nextMonth() {
  const { year, month } = cursor.value
  cursor.value = month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 }
}
function jumpToday() {
  cursor.value = { year: today.getFullYear(), month: today.getMonth() }
}

function onClick(cell: Cell) {
  // If user clicks a day in adjacent month, also navigate the cursor
  if (!cell.inMonth) {
    cursor.value = { year: cell.date.getFullYear(), month: cell.date.getMonth() }
  }
  emit('select', cell.key)
}

function formatDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
</script>

<template>
  <div class="cal" :class="{ compact }">
    <header class="cal-head">
      <button type="button" class="nav" @click="prevMonth" aria-label="上个月">‹</button>
      <button type="button" class="month" @click="jumpToday" :title="'回到今天'">{{ monthLabel }}</button>
      <button type="button" class="nav" @click="nextMonth" aria-label="下个月">›</button>
    </header>

    <div class="weekdays">
      <span v-for="w in WEEKDAY_LABELS" :key="w">{{ w }}</span>
    </div>

    <div class="grid">
      <button
        v-for="cell in grid" :key="cell.key"
        type="button"
        class="cell"
        :class="{
          out: !cell.inMonth,
          today: cell.isToday,
          'has-diary': cell.hasDiary,
          selected: cell.isSelected,
        }"
        @click="onClick(cell)"
      >
        <span class="num">{{ cell.day }}</span>
        <span v-if="cell.hasDiary" class="diary-dot" aria-hidden="true"></span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.cal {
  background: #fff;
  border: 1px solid var(--pink-300);
  border-radius: 14px;
  padding: 12px;
  box-shadow: 0 2px 12px rgba(255, 126, 182, 0.06);
  user-select: none;
}

.cal-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 8px;
}
.nav {
  width: 28px; height: 28px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: var(--ink-soft);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
}
@media (hover: hover) {
  .nav:hover { background: var(--pink-200); color: var(--pink-700); }
}
.month {
  background: none; border: none;
  font-family: var(--font-serif);
  font-size: 14px; font-weight: 600;
  color: var(--ink-warm);
  letter-spacing: 1px;
  cursor: pointer;
  padding: 4px 10px;
  border-radius: 8px;
}
@media (hover: hover) {
  .month:hover { background: var(--pink-200); }
}

.weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  font-size: 11px;
  color: var(--ink-mute);
  text-align: center;
  margin-bottom: 4px;
  letter-spacing: 0.5px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}

.cell {
  position: relative;
  aspect-ratio: 1;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 8px;
  font-size: 12px;
  color: var(--ink-warm);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.cell .num { line-height: 1; }
.cell.out { color: var(--ink-faint); }

@media (hover: hover) {
  .cell:hover:not(.selected) { background: var(--pink-200); }
}

.cell.today { border-color: var(--pink-500); }

.diary-dot {
  position: absolute;
  bottom: 4px;
  left: 50%;
  transform: translateX(-50%);
  width: 4px; height: 4px;
  border-radius: 50%;
  background: var(--pink-600);
}

.cell.selected {
  background: linear-gradient(135deg, var(--pink-600), var(--rose-heart));
  color: #fff;
  border-color: transparent;
}
.cell.selected .diary-dot { background: #fff; }

/* === Compact mode for sticky mobile calendar === */
.cal.compact {
  padding: 8px 10px;
  border-radius: 12px;
  box-shadow: 0 4px 16px rgba(255, 126, 182, 0.10);
}
.cal.compact .cal-head { margin-bottom: 4px; }
.cal.compact .month { font-size: 13px; padding: 2px 8px; }
.cal.compact .nav { width: 24px; height: 24px; }
.cal.compact .weekdays { display: none; }
.cal.compact .grid { gap: 1px; }
.cal.compact .cell {
  border-radius: 6px;
  font-size: 11px;
  min-height: 26px;
}
.cal.compact .diary-dot {
  width: 3px; height: 3px;
  bottom: 3px;
}
</style>
