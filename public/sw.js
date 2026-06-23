/**
 * To My L — minimal service worker.
 *
 * Rule of thumb after the HTTPS / analytics rollout:
 *   - Never cache API data. The production API path is `/api/...`, and
 *     caching it once caused stale diary/message state after deploys.
 *   - Navigation HTML is network-first so a fresh deploy wins quickly.
 *   - Hashed Vite assets under `/assets/` are cache-first; their file names
 *     change on every build, so this is safe.
 *   - Private ritual media is runtime-mounted and may be replaced without a
 *     rebuild, so keep `/ritual/...` network-first as well.
 */

const CACHE = 'tml-shell-v2'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).catch(() => undefined))
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
  if (url.origin !== self.location.origin) return

  // Backend/API and runtime media — network only. This includes the real
  // production paths (`/api/...`) and older direct paths kept for safety.
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/user') ||
    url.pathname.startsWith('/diary') ||
    url.pathname.startsWith('/moment') ||
    url.pathname.startsWith('/message') ||
    url.pathname.startsWith('/upload') ||
    url.pathname.startsWith('/analytics') ||
    url.pathname.startsWith('/ws') ||
    url.pathname.startsWith('/ritual/')
  ) {
    return
  }

  // Vite hashed assets are immutable and safe to cache aggressively.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(req))
    return
  }

  // SPA navigations / HTML: prefer network so direct entry to /for-xue,
  // /analytics, /diary etc. doesn't get an old cached index.html after a
  // deploy. Fall back to cached / only when genuinely offline.
  if (req.mode === 'navigate' || req.headers.get('accept')?.includes('text/html')) {
    event.respondWith(networkFirst(req))
  }
})

async function cacheFirst(req) {
  const cached = await caches.match(req)
  if (cached) return cached
  const res = await fetch(req)
  if (res.ok) {
    const cache = await caches.open(CACHE)
    cache.put(req, res.clone())
  }
  return res
}

async function networkFirst(req) {
  try {
    const res = await fetch(req)
    if (res.ok) {
      const cache = await caches.open(CACHE)
      cache.put(req, res.clone())
      if (new URL(req.url).pathname !== '/') {
        const home = await fetch('/')
        if (home.ok) cache.put('/', home.clone())
      }
    }
    return res
  } catch (e) {
    const cached = await caches.match(req)
    if (cached) return cached
    const home = await caches.match('/')
    if (home) return home
    throw e
  }
}
