import client from './client'

export type AnalyticsEventType =
  | 'session_start'
  | 'auth_seen'
  | 'login_success'
  | 'page_view'
  | 'ritual_open'
  | 'ritual_video_play'
  | 'ritual_video_end'
  | 'ritual_hand_view'
  | 'ritual_enter_click'

export interface AnalyticsEventPayload {
  visitorId: string
  eventType: AnalyticsEventType
  path?: string
  detail?: Record<string, unknown>
}

export interface AnalyticsRecentEvent {
  id: number
  userId: number | null
  visitorId: string | null
  eventType: AnalyticsEventType
  path: string | null
  detail: Record<string, unknown> | null
  ip: string | null
  userAgent: string | null
  createTime: string
}

export interface AnalyticsDailyPoint {
  date: string
  sessionStart: number
  authSeen: number
  loginSuccess: number
  pageView: number
  ritualOpen: number
}

export interface AnalyticsSummary {
  days: number
  totalEvents: number
  uniqueVisitors: number
  lastVisitAt: string | null
  byEventType: Partial<Record<AnalyticsEventType, number>>
  funnel: Partial<Record<AnalyticsEventType, number>>
  daily: AnalyticsDailyPoint[]
  recent: AnalyticsRecentEvent[]
}

const USE_MOCK = import.meta.env.VITE_ANALYTICS_MOCK === 'true'

export async function trackAnalyticsEvent(payload: AnalyticsEventPayload): Promise<void> {
  if (USE_MOCK) {
    pushMockEvent(payload)
    return
  }
  await client.post('/analytics/event', payload)
}

export type AnalyticsFilter = 'all' | 'me' | 'partner' | 'anonymous'

function filterParams(filter: AnalyticsFilter): Record<string, unknown> {
  if (filter === 'me') return { userId: 1 }
  if (filter === 'partner') return { userId: 2 }
  if (filter === 'anonymous') return { anonymous: true }
  return {}
}

export async function getAnalyticsSummary(days = 14, filter: AnalyticsFilter = 'all'): Promise<AnalyticsSummary> {
  if (USE_MOCK) return getMockSummary(days, filter)
  const res = await client.get<unknown, { data: AnalyticsSummary }>('/analytics/summary', {
    params: { days, ...filterParams(filter) },
  })
  return res.data
}

export async function getAnalyticsRecent(limit = 200, filter: AnalyticsFilter = 'all'): Promise<AnalyticsRecentEvent[]> {
  if (USE_MOCK) return getMockRecent(limit, filter)
  const res = await client.get<unknown, { data: AnalyticsRecentEvent[] }>('/analytics/recent', {
    params: { limit, ...filterParams(filter) },
  })
  return res.data
}

const MOCK_KEY = 'tml:analytics:mock-events'

function readMockEvents(): AnalyticsRecentEvent[] {
  try {
    return JSON.parse(localStorage.getItem(MOCK_KEY) || '[]')
  } catch {
    return []
  }
}

function writeMockEvents(events: AnalyticsRecentEvent[]) {
  try { localStorage.setItem(MOCK_KEY, JSON.stringify(events.slice(-500))) } catch { /* ignore */ }
}

function pushMockEvent(payload: AnalyticsEventPayload) {
  const events = readMockEvents()
  events.push({
    id: Date.now(),
    userId: null,
    visitorId: payload.visitorId,
    eventType: payload.eventType,
    path: payload.path || location.pathname,
    detail: payload.detail || null,
    ip: 'mock',
    userAgent: navigator.userAgent,
    createTime: formatLocalDateTime(new Date()),
  })
  writeMockEvents(events)
}

function getMockRecent(limit: number, filter: AnalyticsFilter): AnalyticsRecentEvent[] {
  return readMockEvents()
    .filter(e => matchesFilter(e, filter))
    .reverse()
    .slice(0, limit)
}

function matchesFilter(e: AnalyticsRecentEvent, filter: AnalyticsFilter): boolean {
  if (filter === 'me') return e.userId === 1
  if (filter === 'partner') return e.userId === 2
  if (filter === 'anonymous') return e.userId == null
  return true
}

function getMockSummary(days: number, filter: AnalyticsFilter): AnalyticsSummary {
  const now = new Date()
  const cutoff = new Date(now)
  cutoff.setDate(cutoff.getDate() - days + 1)
  cutoff.setHours(0, 0, 0, 0)

  const events = readMockEvents().filter((e) => matchesFilter(e, filter) && new Date(e.createTime.replace(' ', 'T')).getTime() >= cutoff.getTime())
  const byEventType: Partial<Record<AnalyticsEventType, number>> = {}
  for (const e of events) byEventType[e.eventType] = (byEventType[e.eventType] || 0) + 1

  const dayMap = new Map<string, AnalyticsDailyPoint>()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    dayMap.set(key, { date: key, sessionStart: 0, authSeen: 0, loginSuccess: 0, pageView: 0, ritualOpen: 0 })
  }
  for (const e of events) {
    const day = e.createTime.slice(0, 10)
    const p = dayMap.get(day)
    if (!p) continue
    if (e.eventType === 'session_start') p.sessionStart++
    if (e.eventType === 'auth_seen') p.authSeen++
    if (e.eventType === 'login_success') p.loginSuccess++
    if (e.eventType === 'page_view') p.pageView++
    if (e.eventType === 'ritual_open') p.ritualOpen++
  }

  const funnelTypes: AnalyticsEventType[] = [
    'ritual_open',
    'ritual_video_play',
    'ritual_video_end',
    'ritual_hand_view',
    'ritual_enter_click',
    'login_success',
  ]
  const funnel: Partial<Record<AnalyticsEventType, number>> = {}
  for (const t of funnelTypes) funnel[t] = byEventType[t] || 0

  return {
    days,
    totalEvents: events.length,
    uniqueVisitors: new Set(events.map(e => e.visitorId).filter(Boolean)).size,
    lastVisitAt: events[events.length - 1]?.createTime || null,
    byEventType,
    funnel,
    daily: [...dayMap.values()],
    recent: [...events].reverse().slice(0, 50),
  }
}

function formatLocalDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
