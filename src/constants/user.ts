import {
  CURRENT_USER_ID,
  CURRENT_USER_NAME,
  PARTNER_BIRTHDAY_MMDD,
  PARTNER_USER_ID,
  PARTNER_USER_NAME,
  SINCE_DATE_ENV,
} from '@/config/env'

export const USER_NAMES: Record<number, string> = {
  [CURRENT_USER_ID]: CURRENT_USER_NAME,
  [PARTNER_USER_ID]: PARTNER_USER_NAME,
}

export function getUserDisplayName(id: number): string {
  return USER_NAMES[id] || `User ${id}`
}

export function getPartnerDisplayName(myId: number): string {
  return myId === CURRENT_USER_ID ? PARTNER_USER_NAME : CURRENT_USER_NAME
}

// The day they first met / first spoke — anchor for "第 N 天" counters across the app
export const SINCE_DATE = SINCE_DATE_ENV

// Special dates that trigger heart-rain on the home page
// Format: 'MM-DD' (year-agnostic, fires every year)
export const SPECIAL_DATES: Record<string, string> = {
  [SINCE_DATE.slice(5)]: '是我们认识的日子',
  [PARTNER_BIRTHDAY_MMDD]: '是属于你的日子',
}
