import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/for-xue', name: 'RitualEntry', component: () => import('@/views/RitualEntryView.vue'), meta: { coverNav: true, standalone: true } },
    { path: '/login', name: 'Login', component: () => import('@/views/LoginView.vue'), meta: { guest: true } },
    { path: '/', name: 'Home', component: () => import('@/views/HomeView.vue'), meta: { requiresAuth: true } },
    { path: '/diary', name: 'Diary', component: () => import('@/views/DiaryView.vue'), meta: { requiresAuth: true } },

    // === 翻翻 (Discover) ===
    // True nested routes via DiscoverLayout. Vue-router only treats a
    // <router-link> as active when its `path` is a prefix of the current
    // path, so visiting /discover/moment keeps "翻翻" highlighted in
    // AppHeader / MobileTabBar without us doing anything special.
    //
    // Old top-level paths /moment, /timeline, /message remain as ALIAS
    // entries on the children so old bookmarks / WS deep links / external
    // share links don't 404. Internal navigation always uses the nested
    // form.
    {
      path: '/discover',
      component: () => import('@/views/DiscoverLayout.vue'),
      meta: { requiresAuth: true },
      children: [
        { path: '', name: 'Discover', component: () => import('@/views/DiscoverView.vue') },
        {
          path: 'moment',
          name: 'Moment',
          component: () => import('@/views/MomentView.vue'),
          alias: '/moment',
          meta: { coverNav: true },
        },
        {
          path: 'timeline',
          name: 'Timeline',
          component: () => import('@/views/TimelineView.vue'),
          alias: '/timeline',
          meta: { coverNav: true },
        },
        {
          path: 'message',
          name: 'Message',
          component: () => import('@/views/MessageView.vue'),
          alias: '/message',
          meta: { coverNav: true },
        },
      ],
    },

    { path: '/chat', name: 'Chat', component: () => import('@/views/ChatView.vue'), meta: { requiresAuth: true } },
    { path: '/analytics', name: 'Analytics', component: () => import('@/views/AnalyticsView.vue'), meta: { coverNav: true, standalone: true } },
    { path: '/mine', name: 'Mine', component: () => import('@/views/MineView.vue'), meta: { requiresAuth: true } },
    { path: '/mine/settings', name: 'Settings', component: () => import('@/views/SettingsView.vue'), meta: { requiresAuth: true, coverNav: true } },
  ],
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  if (!to.meta.requiresAuth) return true

  const ok = await auth.ensureCurrentUser()
  if (!ok) return '/login'
  return true
})

export default router
