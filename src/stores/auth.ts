import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getMe } from '@/api/user'
import type { User } from '@/types'

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(localStorage.getItem('token'))
  const currentUser = ref<User | null>(null)

  const isLoggedIn = computed(() => !!token.value)
  const partnerId = computed(() => (currentUser.value?.id === 1 ? 2 : 1))
  let fetchingMe: Promise<boolean> | null = null

  function setToken(t: string) {
    token.value = t
    localStorage.setItem('token', t)
  }

  function clearToken() {
    token.value = null
    localStorage.removeItem('token')
    // Backend also sets an Authorization cookie on login. If we only clear
    // localStorage, the browser may keep sending the old cookie and the
    // server can still identify the previous account after a logout/switch.
    // Expire both common path variants defensively.
    document.cookie = 'Authorization=; Max-Age=0; Path=/'
    document.cookie = 'Authorization=; Max-Age=0; Path=/; SameSite=Lax'
  }

  async function fetchCurrentUser(): Promise<boolean> {
    try {
      const res = await getMe()
      currentUser.value = res.data
      return true
    } catch {
      // /user/me failing means the local token is no longer trustworthy.
      currentUser.value = null
      clearToken()
      return false
    }
  }

  async function ensureCurrentUser(): Promise<boolean> {
    if (currentUser.value) return true
    if (!token.value) return false
    if (!fetchingMe) {
      fetchingMe = fetchCurrentUser().finally(() => { fetchingMe = null })
    }
    return fetchingMe
  }

  function logout() {
    clearToken()
    currentUser.value = null
  }

  return {
    token,
    currentUser,
    isLoggedIn,
    partnerId,
    setToken,
    clearToken,
    fetchCurrentUser,
    ensureCurrentUser,
    logout,
  }
})
