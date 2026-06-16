/**
 * Environment-backed project configuration.
 *
 * Vite exposes only variables prefixed with VITE_. Defaults are safe for
 * local dev (Vite proxies /api and /ws to localhost:8081) and production
 * Docker (nginx proxies /api, /ws, /static/uploads to BACKEND_ORIGIN).
 */
export const API_BASE = import.meta.env.VITE_API_BASE || '/api'
export const WS_BASE = import.meta.env.VITE_WS_BASE || ''

export const CURRENT_USER_ID = Number(import.meta.env.VITE_CURRENT_USER_ID || 1)
export const PARTNER_USER_ID = Number(import.meta.env.VITE_PARTNER_USER_ID || 2)
export const CURRENT_USER_NAME = import.meta.env.VITE_CURRENT_USER_NAME || '王水群'
export const PARTNER_USER_NAME = import.meta.env.VITE_PARTNER_USER_NAME || '潘佩雪'

export const SINCE_DATE_ENV = import.meta.env.VITE_SINCE_DATE || '2026-05-24'
export const PARTNER_BIRTHDAY_MMDD = import.meta.env.VITE_PARTNER_BIRTHDAY_MMDD || '03-22'
