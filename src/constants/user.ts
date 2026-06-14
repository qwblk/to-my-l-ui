// User display name mapping
export const USER_NAMES: Record<number, string> = {
  1: '王水群',
  2: '潘佩雪',
}

export function getUserDisplayName(id: number): string {
  return USER_NAMES[id] || `User ${id}`
}

export function getPartnerDisplayName(myId: number): string {
  return myId === 1 ? '潘佩雪' : '王水群'
}

// The day they first met / first spoke — anchor for "第 N 天" counters across the app
export const SINCE_DATE = '2026-05-24'

// Special dates that trigger heart-rain on the home page
// Format: 'MM-DD' (year-agnostic, fires every year)
export const SPECIAL_DATES: Record<string, string> = {
  '05-24': '是我们认识的日子',
  '03-22': '是属于你的日子', // 潘佩雪的生日
}