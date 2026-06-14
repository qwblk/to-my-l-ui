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
