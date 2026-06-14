<script setup lang='ts'>
import { ref, onUnmounted, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useChatStore } from '@/stores/chat'
import { getUnreadCount } from '@/api/message'
import { getPartnerDisplayName } from '@/constants/user'

const router = useRouter()
const auth = useAuthStore()
const chat = useChatStore()

const unreadCount = ref(0)
const myOnline = ref(false)
let unreadTimer: ReturnType<typeof setInterval> | null = null

const partnerName = computed(() => auth.currentUser?.id ? getPartnerDisplayName(auth.currentUser.id) : '')

watch(
  () => auth.currentUser,
  (user) => {
    if (!user) return
    chat.connect(user.username, user.name)
    myOnline.value = true
    refreshUnread()
    unreadTimer = setInterval(refreshUnread, 15000)
  },
  { immediate: true },
)

// Refresh unread badge whenever a message-related WS event fires (instant feedback)
const stopMsgWatch = watch(
  () => chat.lastEventTime,
  () => {
    if (chat.lastEventType === 'message' || chat.lastEventType === 'read') refreshUnread()
  },
)

onUnmounted(() => {
  if (unreadTimer) clearInterval(unreadTimer)
  stopMsgWatch()
})

async function refreshUnread() {
  try { const res = await getUnreadCount(); unreadCount.value = res.data } catch {}
}

function handleLogout() {
  myOnline.value = false
  chat.disconnect()
  auth.logout()
  router.push('/login')
}
</script>

<template>
  <header class="app-header">
    <router-link to="/" class="brand">
      <svg class="brand-mark" viewBox="0 0 24 24"><path fill="url(#bg)" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF7EB6"/><stop offset="1" stop-color="#FF4D6D"/></linearGradient></defs></svg>
      <span class="brand-name">To My L</span>
    </router-link>

    <nav class="nav">
      <router-link to="/" exact-active-class="is-active">首页</router-link>
      <router-link to="/chat" class="with-badge">
        晚安
        <span v-if="chat.chatUnread > 0" class="badge">{{ chat.chatUnread > 99 ? '99+' : chat.chatUnread }}</span>
      </router-link>
      <router-link to="/diary">日记本</router-link>
      <router-link to="/discover" class="with-badge">
        翻翻
        <span v-if="unreadCount > 0" class="badge">{{ unreadCount }}</span>
      </router-link>
      <router-link to="/mine">我的</router-link>
    </nav>

    <div class="user-section">
      <div class="status-item" :title="chat.partnerOnline ? (partnerName + ' 在线') : (partnerName + ' 离线')">
        <span class="status-label">{{ partnerName }}</span>
        <span class="online-dot" :class="{ active: chat.partnerOnline }"></span>
      </div>
      <div class="status-item me">
        <span class="online-dot me-dot" :class="{ active: myOnline }"></span>
        <span class="username">{{ auth.currentUser?.name }}</span>
      </div>
      <button class="logout-btn" @click="handleLogout">退出</button>
    </div>
  </header>
</template>

<style scoped>
.app-header {
  display: flex; align-items: center; gap: 24px;
  padding: 0 24px; height: 56px;
  background: rgba(255,255,255,0.85);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--pink-300);
  position: sticky; top: 0; z-index: 100;
}

.brand { display: flex; align-items: center; gap: 8px; text-decoration: none; }
.brand-mark { width: 22px; height: 22px; filter: drop-shadow(0 2px 4px rgba(255,77,109,0.25)); }
.brand-name {
  font-family: var(--font-script);
  font-size: 22px; font-weight: 700;
  background: linear-gradient(135deg, var(--pink-600), var(--rose-heart));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  letter-spacing: 0.5px;
}

.nav { display: flex; gap: 4px; flex: 1; }
.nav a {
  position: relative;
  text-decoration: none;
  color: var(--ink-mute);
  font-size: 14px;
  padding: 6px 14px;
  border-radius: 999px;
  transition: all 0.2s;
}
@media (hover: hover) {
  .nav a:hover { background: var(--pink-200); color: var(--pink-700); }
}
.nav a.router-link-active,
.nav a.is-active { background: var(--pink-200); color: var(--pink-700); font-weight: 500; }

.with-badge { padding-right: 18px; }
.badge {
  position: absolute; top: 2px; right: 4px;
  min-width: 16px; height: 16px; padding: 0 4px;
  background: var(--rose-heart); color: #fff;
  border-radius: 999px;
  font-size: 10px; font-weight: 600; line-height: 16px;
  text-align: center;
  box-shadow: 0 0 0 2px #fff;
  animation: fade-in 0.2s ease;
}

.user-section { display: flex; align-items: center; gap: 14px; }
.status-item { display: flex; align-items: center; gap: 6px; cursor: default; }
.status-label { font-size: 12px; color: var(--ink-mute); }
.online-dot { width: 8px; height: 8px; border-radius: 50%; background: #d1d5db; transition: background 0.3s, box-shadow 0.3s; }
.online-dot.active { background: var(--el-color-success); box-shadow: 0 0 6px rgba(16,185,129,0.5); }
.online-dot.me-dot { width: 7px; height: 7px; }
.username { font-size: 13px; color: var(--ink-soft); font-weight: 500; }
.logout-btn {
  padding: 4px 12px; font-size: 12px;
  border: 1px solid var(--pink-300); border-radius: 999px;
  background: transparent; cursor: pointer; color: var(--ink-mute);
  transition: all 0.2s;
}
@media (hover: hover) {
  .logout-btn:hover { background: var(--pink-200); color: var(--pink-700); }
}

/* === Small screen: hide top nav (replaced by bottom tab bar),
 *    compact header === */
@media (max-width: 960px) {
  .app-header {
    padding: 0 16px;
    height: 52px;
    gap: 12px;
  }
  .nav { display: none; }
  /* Brand pushed left, status pushed right, no middle nav */
  .brand { flex: 1; }
  /* Hide the partner online label in the corner — too cramped on phone.
   * The tab bar / pages still convey presence where it matters. */
  .status-item:not(.me) { display: none; }
  .status-label { display: none; }
  .username { font-size: 12px; }
  .logout-btn { font-size: 11px; padding: 4px 10px; }
}
</style>
