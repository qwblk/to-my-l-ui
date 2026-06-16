import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getMe } from '@/api/user'
import type { User } from '@/types'

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(localStorage.getItem('token'))
  const currentUser = ref<User | null>(null)

  const isLoggedIn = computed(() => !!token.value)
  const partnerId = computed(() => (currentUser.value?.id === 1 ? 2 : 1))

  function setToken(t: string) {
    token.value = t
    localStorage.setItem('token', t)
  }

  function clearToken() {
    token.value = null
    localStorage.removeItem('token')
  }

  async function fetchCurrentUser() {
    try {
      const res = await getMe()
      currentUser.value = res.data
    } catch {
      // /user/me failing means the local token is no longer trustworthy.
      // We don't navigate here ourselves — the axios interceptor in
      // client.ts already shows the "登录已过期" prompt and the user
      // confirms when to leave. Just clear local state so other watchers
      // don't keep firing on a half-dead session.
      currentUser.value = null
    }
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
    logout,
  }
})
