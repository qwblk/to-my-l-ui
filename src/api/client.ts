import axios from 'axios'

export const API_BASE = 'http://localhost:8081'

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

client.interceptors.response.use(
  (res) => {
    console.log(
      `%c[RESPONSE] %c${res.config.method?.toUpperCase()} %c${res.config.url}`,
      'color: #10b981; font-weight: bold;',
      'color: #ec4899;',
      'color: #831843;',
      res.data,
    )
    return res.data
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

    if (status === 401) {
      localStorage.removeItem('token')
      window.location.href = '/login'
    }
    return Promise.reject(data || err)
  },
)

export default client