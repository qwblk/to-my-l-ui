<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useChatStore } from '@/stores/chat'
import client from '@/api/client'
import { getUser } from '@/api/user'
import type { Result, LoginResponse, User } from '@/types'
import { ElMessage } from 'element-plus'
import { SINCE_DATE } from '@/constants/user'
import { useHeartBurst } from '@/composables/useHeartBurst'
import { track } from '@/composables/useAnalytics'
import {
  DEFAULT_FIRST_WELCOME,
  FIRST_WELCOME_BY_USERNAME,
  FIRST_WELCOME_STORAGE_KEY,
} from '@/config/firstWelcome'

// Resolve the illustration at build time. Vite's `import.meta.glob` lets
// us reference an asset *if it exists* without breaking the build when
// it doesn't — we fall back to the SVG heart placeholder until the user
// drops the real artwork into src/assets/login-illustration.{png,jpg,webp}.
const matches = import.meta.glob('@/assets/login-illustration.{png,jpg,jpeg,webp}', {
  eager: true,
  import: 'default',
  query: '?url',
}) as Record<string, string>
const loginIllustration: string = Object.values(matches)[0] || '/icons/heart.svg'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()
const chat = useChatStore()
const hearts = useHeartBurst()

const formRef = ref()
const loading = ref(false)
const serverError = ref('')

const presetUsername = typeof route.query.u === 'string' ? route.query.u : ''
const form = reactive({ username: presetUsername, password: '' })
const rules = {
  username: [{ required: true, message: '请输入账号', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
}

// "Since 2026.05.24" — display dots, not dashes
const sinceDisplay = SINCE_DATE.replace(/-/g, '.')

function profileTextOf(u: User | null | undefined): string {
  return u?.profileText || u?.bio || ''
}
function splitProfileText(text: string): string[] {
  // Preserve intentional blank-line paragraphing if present; otherwise
  // each non-empty line becomes a paragraph. If it's one long paragraph,
  // it stays one paragraph exactly as written.
  return text
    .split(/\n{2,}|\r?\n/)
    .map(s => s.trim())
    .filter(Boolean)
}

async function handleLogin() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  loading.value = true
  serverError.value = ''

  try {
    // Switching accounts in the same browser must not carry the previous
    // SaToken cookie into the login request. Clear both local and cookie
    // state before asking the backend for a fresh token.
    auth.clearToken()
    const res = await client.post<unknown, Result<LoginResponse>>('/user/login', {
      username: form.username.trim(),
      password: form.password,
    })

    auth.setToken(res.data.token)
    chat.partnerOnline = res.data.partnerOnline

    // Reset the per-session "home intro animation already played" flag
    // so a fresh login replays the soft fade-up on /home once.
    try { sessionStorage.removeItem('tml-home-intro-played') } catch { /* ignore */ }

    await auth.fetchCurrentUser()
    track('login_success', { firstLogin: res.data.firstLogin, userId: auth.currentUser?.id })

    if (res.data.firstLogin) {
      const username = form.username.trim().toLowerCase()
      let payload = FIRST_WELCOME_BY_USERNAME[username] || DEFAULT_FIRST_WELCOME

      // For the receiver's first login, prefer the *other user's* profile
      // text (profileText/bio). This lets the owner edit the welcome letter
      // from "我的" → profile text, and the first-login card always shows
      // the current stored wording rather than a hardcoded frontend copy.
      try {
        const partnerId = auth.currentUser?.id === 1 ? 2 : 1
        const partner = await getUser(partnerId)
        const text = profileTextOf(partner.data)
        if (text) {
          payload = {
            title: '写给你的话',
            paragraphs: splitProfileText(text),
            confirmText: '我慢慢看',
          }
        }
      } catch {
        // If partner profile lookup fails, fall back to local configured text.
      }

      sessionStorage.removeItem('tml:first-welcome')
      sessionStorage.setItem(FIRST_WELCOME_STORAGE_KEY, JSON.stringify(payload))
      window.dispatchEvent(new CustomEvent('tml:first-welcome-ready'))
    }
    ElMessage.success(res.data.firstLogin ? '欢迎来到 To My L' : '欢迎回来')
    // Celebrate the moment of arrival — four-corner sparkle
    setTimeout(() => hearts.corners(), 80)
    router.push('/')
  } catch (e: unknown) {
    const err = e as Result<unknown>
    const msg = err?.msg || '登录失败，请重试'
    const errorMessages: Record<string, string> = {
      'Please login first': '请先登录',
      'No permission': '没有权限',
      'Server busy, try later': '服务器繁忙，请稍后重试',
    }
    serverError.value = errorMessages[msg] || msg
    ElMessage.error(serverError.value)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <!-- Left: Illustration -->
    <div class="illustration">
      <img :src="loginIllustration" alt="Two of us" class="illustration-img" />
      <p class="illustration-caption font-script">two of us, with all the best wishes.</p>
    </div>

    <!-- Right: Login card -->
    <div class="login-side">
      <div class="login-card">
        <p class="welcome font-script">Welcome Back</p>
        <h1 class="brand font-script">To My L</h1>
        <p class="subtitle">有些话，等以后慢慢告诉你。</p>

        <el-form ref="formRef" :model="form" :rules="rules" @submit.prevent="handleLogin" class="login-form">
          <el-form-item prop="username">
            <el-input v-model="form.username" placeholder="账号" size="large" autocomplete="username">
              <template #prefix>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#C9A8B8" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              </template>
            </el-input>
          </el-form-item>

          <el-form-item prop="password">
            <el-input v-model="form.password" type="password" placeholder="密码" size="large" show-password autocomplete="current-password">
              <template #prefix>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#C9A8B8" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              </template>
            </el-input>
          </el-form-item>

          <p v-if="serverError" class="error-msg">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
            {{ serverError }}
          </p>

          <el-button type="primary" size="large" :loading="loading" class="login-btn" @click="handleLogin">
            {{ loading ? '正在进入...' : '进入我们的世界' }}
          </el-button>
        </el-form>

        <p class="since font-script">Since {{ sinceDisplay }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
/*
 * Login page: never scrolls.
 *
 * Rationale: a login screen with a vertical scrollbar feels broken on
 * every form factor. We lock the viewport with `height: 100dvh` (the
 * "dynamic viewport" unit, which automatically excludes the iOS Safari
 * address bar / Android URL bar) and `overflow: hidden`. On really
 * cramped viewports (e.g. iPhone SE landscape with the keyboard up) the
 * illustration shrinks first; the form is the priority.
 *
 * 100dvh has wide support since 2022 (Safari 15.4 / Chrome 108 / Firefox
 * 101). Older browsers fall back to 100vh — which leaves a small chrome
 * gap at the bottom but still doesn't introduce a scrollbar.
 */
.login-page {
  display: flex;
  height: 100vh;       /* fallback */
  height: 100dvh;
  overflow: hidden;
  background: var(--pink-50);
}

.illustration {
  flex: 1; display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  padding: 40px;
  background: linear-gradient(180deg, #FFE4F2 0%, #FFF0F7 60%, #FFF8FB 100%);
  /* Allow the illustration column to shrink to nothing if the form
   * column needs every available pixel (very narrow / very short
   * viewports), instead of forcing the page to scroll. */
  min-width: 0;
  min-height: 0;
}
.illustration-img {
  width: 100%;
  max-width: 480px;
  /* Cap the illustration so the form column always has at least 360px on
   * desktop. `min(...)` is supported everywhere we care about. */
  max-height: min(80vh, 560px);
  height: auto;
  object-fit: contain;
  filter: drop-shadow(0 8px 24px rgba(255, 126, 182, 0.18));
  user-select: none;
  pointer-events: none;
}
.illustration-caption {
  margin-top: 12px;
  font-size: 22px;
  color: var(--ink-mute);
  letter-spacing: 0.5px;
}

.login-side {
  flex: 1;
  display: flex; align-items: center; justify-content: center;
  padding: 40px;
  background: var(--pink-50);
  /* Inside the locked-no-scroll page, this column itself can scroll if
   * the keyboard pushes content up — but only inside this column, never
   * the whole page. Keeps the illustration locked in place. */
  overflow-y: auto;
  min-height: 0;
}
.login-card { width: 360px; max-width: 100%; animation: fade-up 0.8s ease-out; }

.welcome { font-size: 22px; color: var(--pink-700); margin: 0 0 4px; letter-spacing: 0.5px; }
.brand {
  font-size: 56px; font-weight: 700; margin: 0 0 12px;
  background: linear-gradient(135deg, var(--pink-600), var(--rose-heart));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  letter-spacing: 1px;
  line-height: 1.05;
}
.subtitle { font-size: 15px; color: var(--ink-mute); margin: 0 0 36px; line-height: 1.6; }

.login-form { display: flex; flex-direction: column; gap: 4px; }
:deep(.el-form-item) { margin-bottom: 14px; }
:deep(.el-input__wrapper) { border-radius: 10px; background: #FFF; box-shadow: 0 0 0 1px var(--pink-300); padding: 8px 12px; }
:deep(.el-input__inner) { color: var(--ink-warm); }
:deep(.el-input__inner::placeholder) { color: var(--ink-faint); }

.error-msg {
  display: flex; align-items: center; gap: 6px;
  color: var(--pink-700); font-size: 13px; margin: 4px 0 8px;
  animation: shake 0.3s;
}
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-4px); }
  75% { transform: translateX(4px); }
}

.login-btn {
  width: 100%; margin-top: 8px; height: 48px; font-size: 16px; font-weight: 500;
  letter-spacing: 1px;
  background: linear-gradient(135deg, var(--pink-600), var(--rose-heart)) !important;
  border: none !important; border-radius: 12px !important; transition: all 0.3s;
  box-shadow: 0 8px 18px rgba(255,77,109,0.18);
}
@media (hover: hover) {
  .login-btn:hover { box-shadow: 0 12px 26px rgba(255,77,109,0.32); transform: translateY(-1px); }
}

.since {
  text-align: center; margin-top: 32px;
  font-size: 20px; color: var(--ink-mute);
  letter-spacing: 1px;
}

@media (max-width: 768px) {
  .login-page { flex-direction: column; }
  .illustration {
    /* On phones the illustration becomes a fixed-height banner up top.
     * Sized as a fraction of the viewport so 200px iPhone SE landscape
     * still has room for the form. */
    flex: 0 0 auto;
    padding: 16px 24px 0;
    height: 28dvh;
    max-height: 240px;
  }
  .illustration-img {
    max-height: 100%;
    width: auto;
    max-width: min(70vw, 240px);
  }
  .illustration-caption { display: none; }
  .login-side {
    flex: 1;
    padding: 20px 24px 24px;
    align-items: flex-start;
  }
  .login-card { width: 100%; }
  .welcome { font-size: 18px; }
  .brand { font-size: 38px; margin-bottom: 8px; }
  .subtitle { font-size: 14px; margin-bottom: 24px; }
  .since { margin-top: 20px; font-size: 16px; }
}

/* Extra-short viewports (e.g. landscape phones, ~320-400px tall) —
 * collapse the illustration further so the form is always reachable
 * without scrolling. */
@media (max-height: 560px) and (max-width: 768px) {
  .illustration { display: none; }
  .login-side { padding: 16px 24px; align-items: center; }
  .since { margin-top: 12px; }
}
</style>
