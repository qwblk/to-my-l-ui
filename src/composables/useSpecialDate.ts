/**
 * Detect "special days" — anniversary of SINCE_DATE, partner's birthday, etc.
 * Triggers heart-rain on the home page when active.
 */
import { computed } from 'vue'
import { SPECIAL_DATES, SINCE_DATE } from '@/constants/user'

function pad(n: number) { return n < 10 ? '0' + n : '' + n }

export function useSpecialDate() {
  const today = new Date()
  const mmdd = `${pad(today.getMonth() + 1)}-${pad(today.getDate())}`

  const note = computed(() => SPECIAL_DATES[mmdd] || '')
  const isSpecial = computed(() => !!note.value)
  const sinceMmdd = SINCE_DATE.slice(5) // "MM-DD"
  const isAnniversary = computed(() => mmdd === sinceMmdd)

  return { isSpecial, note, isAnniversary, mmdd }
}

/** Days elapsed since SINCE_DATE (inclusive of today). Always >= 1 once active. */
export function daysSince(): number {
  const start = new Date(SINCE_DATE + 'T00:00:00')
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  start.setHours(0, 0, 0, 0)
  const diff = Math.floor((today.getTime() - start.getTime()) / 86_400_000)
  return Math.max(1, diff + 1)
}
