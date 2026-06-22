/**
 * To My L — minimal service worker.
 *
 * Strategy:
 *   - **App shell** (HTML + JS + CSS bundles): cache-first, so the
 *     home screen icon opens instantly even on a flaky connection.
 *     The shell is invalidated on each deploy via the CACHE version
 *     bump; on activate, old caches are deleted.
 *   - **Backend data** (every /user, /diary, /moment, /message, /upload
 *     request, plus the WS handshake): network-only. We never serve
 *     stale messages or stale lastSeenAt; that would corrupt the
 *     offline catch-up logic and put the wrong "is read" badge on the
 *     UI.
 *   - **Static media** (uploaded photos under /static/uploads/...):
 *     cache-first with a stale-while-revalidate flavour, so scrolling
 *     back in the moment feed is fast.
 *
 * This is intentionally simple — no Workbox, no precache manifest. The
 * project has 2 users and a single deploy target; over-engineering the
 * SW just adds failure modes.
 */

const CACHE = 'tml-shell-v1'
const SHELL = [
  '/',
  '/manifest.webmanifest',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => undefined),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)

  // 1. Backend API and WebSocket — network only, never cache
  if (
    url.pathname.startsWith('/user') ||
    url.pathname.startsWith('/diary') ||
    url.pathname.startsWith('/moment') ||
    url.pathname.startsWith('/message') ||
    url.pathname.startsWith('/upload') ||
    url.pathname.startsWith('/analytics') ||
    url.pathname.startsWith('/ws')
  ) {
    return // let the browser do its thing
  }

  // 2. User-uploaded media — cache-first with background revalidation
  if (url.pathname.startsWith('/static/uploads/')) {
    event.respondWith(staleWhileRevalidate(req))
    return
  }

  // 3. App shell (same-origin) — cache-first
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(req))
    return
  }

  // 4. Cross-origin (Google Fonts etc) — let browser cache handle it
})

async function cacheFirst(req) {
  const cached = await caches.match(req)
  if (cached) return cached
  try {
    const res = await fetch(req)
    if (res.ok) {
      const cache = await caches.open(CACHE)
      cache.put(req, res.clone())
    }
    return res
  } catch (e) {
    // Last resort: serve the cached homepage so the SPA shell can
    // boot, then it'll fail gracefully on data fetches.
    const home = await caches.match('/')
    if (home) return home
    throw e
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE)
  const cached = await cache.match(req)
  const fetched = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone())
      return res
    })
    .catch(() => cached)
  return cached || fetched
}
