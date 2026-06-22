import { trackAnalyticsEvent, type AnalyticsEventType } from '@/api/analytics'

const VISITOR_KEY = 'tml:visitor-id'
const SESSION_KEY = 'tml:analytics:session-started'

export function getVisitorId(): string {
  let id = localStorage.getItem(VISITOR_KEY)
  if (!id) {
    id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`
    localStorage.setItem(VISITOR_KEY, id)
  }
  return id
}

export function track(
  eventType: AnalyticsEventType,
  detail?: Record<string, unknown>,
  path = location.pathname,
) {
  trackAnalyticsEvent({
    visitorId: getVisitorId(),
    eventType,
    path,
    detail,
  }).catch((err) => {
    // Analytics should never affect the product flow.
    console.warn('[analytics] track failed', eventType, err)
  })
}

export function trackSessionStartOnce() {
  if (sessionStorage.getItem(SESSION_KEY)) return
  sessionStorage.setItem(SESSION_KEY, '1')
  track('session_start', { referrer: document.referrer || '' })
}
