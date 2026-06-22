import axios from 'axios'
import { API_BASE } from '@/config/env'

export { API_BASE }

const client = axios.create({
  baseURL: API_BASE,
  timeout: 10000,
})

/**
 * Resolve a server-relative URL (e.g. "/static/uploads/...") to a full
 * absolute URL the browser can load. Returns absolute/data/blob URLs
 * unchanged so it's safe to wrap any media URL.
 */
export function resolveAssetUrl(url: string | null | undefined): string {
  if (!url) return ''
  if (/^(https?:|data:|blob:)/.test(url)) return url
  return API_BASE + url
}

client.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    // SaToken reads from Authorization (custom) or satoken (native) header
    config.headers.Authorization = token
    config.headers.satoken = token
  }
  console.log(
    `%c[REQUEST] %c${config.method?.toUpperCase()} %c${config.url}`,
    'color: #f472b6; font-weight: bold;',
    'color: #ec4899;',
    'color: #831843;',
    config.data || '',
  )
  return config
})

/**
 * Force the client back to the login page and drop any stored token.
 * Idempotent — multiple parallel 401s during the same tick will only
 * navigate once. `reason` is shown as a toast so the user understands
 * why they were sent back; the empty default suppresses the toast for
 * silent expirations.
 *
 * `forceImmediate` is for the rare cases where it's already certain the
 * session is dead AND user-blocking confirmation would be annoying
 * (e.g. partner-kicked-me 4012). Otherwise we surface a non-blocking
 * dialog and let the user click before navigating, so anything they
 * had typed isn't lost the moment a background heartbeat 401s.
 */
let kickingOut = false
let promptShown = false
function kickToLogin(reason = '', forceImmediate = false) {
  if (kickingOut) return
  if (forceImmediate) {
    kickingOut = true
    if (reason) {
      import('element-plus').then(({ ElMessage }) => {
        ElMessage.warning(reason)
      }).catch(() => undefined)
    }
    localStorage.removeItem('token')
    window.location.replace('/login')
    return
  }
  // Soft path: don't navigate yet; show a confirmation. Anything that
  // ran into 401 (e.g. heartbeat) can keep failing in the background —
  // the dialog freezes that out by deduping further triggers.
  if (promptShown) return
  promptShown = true
  import('element-plus').then(({ ElMessageBox }) => {
    ElMessageBox.confirm(
      reason || '当前登录已过期，需要重新登录。',
      '登录过期',
      {
        confirmButtonText: '重新登录',
        cancelButtonText: '稍后',
        type: 'warning',
        customClass: 'pink-message-box',
      },
    ).then(() => {
      kickingOut = true
      localStorage.removeItem('token')
      window.location.replace('/login')
    }).catch(() => {
      // user clicked 稍后 — keep them where they are. The next click on
      // any action will re-trigger this prompt.
      promptShown = false
    })
  }).catch(() => {
    // ElMessageBox failed to import (very unlikely) — fall back to hard
    // redirect so they don't stay in a broken session forever.
    kickingOut = true
    localStorage.removeItem('token')
    window.location.replace('/login')
  })
}

/** Heuristic: any backend error that *smells* like an auth failure should
 *  send the user to /login. Backend has migrated to (200 + code 401), but
 *  older builds and SaToken edge cases still emit 500/403 + "token" msgs.
 *  Catching all of these saves the user from an unnoticed dead session. */
function looksLikeAuthFailure(code: unknown, msg: unknown): boolean {
  if (code === 401 || code === 4012) return true
  if (typeof msg !== 'string') return false
  const low = msg.toLowerCase()
  return low.includes('login') || low.includes('token') || msg.includes('登录') || msg.includes('未登录')
}

client.interceptors.response.use(
  (res) => {
    console.log(
      `%c[RESPONSE] %c${res.config.method?.toUpperCase()} %c${res.config.url}`,
      'color: #10b981; font-weight: bold;',
      'color: #ec4899;',
      'color: #831843;',
      res.data,
    )
    const body = res.data
    if (body && typeof body === 'object' && 'code' in body) {
      const code = (body as { code: number; msg?: string }).code
      const msg = (body as { code: number; msg?: string }).msg
      if (code === 4012) {
        kickToLogin('账号已在其他设备登录，请重新登录', true)
        return Promise.reject(body)
      }
      if (code === 401) {
        kickToLogin('登录已过期，请重新登录')
        return Promise.reject(body)
      }
      // Non-success body — if it smells like auth (401, "token" / "login"
      // in msg, etc.), kick out. Plain business failures still propagate
      // to the caller's catch().
      if (code !== 200 && code !== 0) {
        if (looksLikeAuthFailure(code, msg)) {
          kickToLogin('登录已过期，请重新登录')
          return Promise.reject(body)
        }
        return Promise.reject(body)
      }
    }
    return body
  },
  (err) => {
    const status = err.response?.status
    const url = err.config?.url
    const data = err.response?.data

    console.error(
      `%c[ERROR ${status}] %c${url}`,
      'color: #f43f5e; font-weight: bold;',
      'color: #831843;',
      data || err.message,
    )

    const code = (data && typeof data === 'object' && 'code' in data)
      ? (data as { code: number; msg?: string }).code
      : undefined
    const msg = (data && typeof data === 'object' && 'msg' in data)
      ? (data as { code: number; msg?: string }).msg
      : err.message

    if (code === 4012) {
      kickToLogin('账号已在其他设备登录，请重新登录', true)
    } else if (status === 401 || looksLikeAuthFailure(code, msg)) {
      // 403 is usually a real permission failure (e.g. /analytics is only
      // visible to userId=1), not an expired login. Don't clear a valid
      // token or bounce the user to /login just because they lack access
      // to one protected admin-style page.
      kickToLogin('登录已过期，请重新登录')
    }
    return Promise.reject(data || err)
  },
)

export default client