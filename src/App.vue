<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useChatStore } from '@/stores/chat'
import AppHeader from '@/components/AppHeader.vue'
import MobileTabBar from '@/components/MobileTabBar.vue'
import FloatingHearts from '@/components/FloatingHearts.vue'
import FirstWelcomeModal from '@/components/FirstWelcomeModal.vue'
import { useGlobalEvents } from '@/ws/useGlobalEvents'
import { registerHearts } from '@/composables/useHeartBurst'
import { useOfflineCatchup } from '@/composables/useOfflineCatchup'
import { useBreakpoint } from '@/composables/useBreakpoint'
import { useRoute, useRouter } from 'vue-router'

const auth = useAuthStore()
const chat = useChatStore()
const heartsRef = ref<InstanceType<typeof FloatingHearts> | null>(null)
const catchup = useOfflineCatchup()
const { isSmall } = useBreakpoint()
const router = useRouter()
const route = useRoute()
const coverNav = computed(() => !!route.meta.coverNav)
const hideChrome = computed(() => coverNav.value && isSmall.value)

/**
 * Per-route slide direction for the phone navigation.
 *
 * Tabs sit in a fixed visual order: 首页 / 晚安 / 日记 / 翻翻 / 我的, plus
 * `/discover/*` children which sit "deeper" than 翻翻. We compute a numeric
 * depth for each path and slide left when going deeper, right when going
 * shallower. Replaces the abrupt cut between tabs with a directional swipe.
 */
function depthOf(path: string): number {
  if (path === '/' || path === '/login') return 0
  if (path === '/chat') return 1
  if (path === '/diary') return 2
  if (path === '/discover') return 3
  if (path.startsWith('/discover/')) return 4
  if (path === '/mine') return 5
  if (path.startsWith('/mine/')) return 6
  return 3
}
const slideName = ref<'slide-left' | 'slide-right' | 'slide-soft'>('slide-soft')
router.afterEach((to, from) => {
  const d1 = depthOf(from.path)
  const d2 = depthOf(to.path)
  // On phones we keep a strong directional slide for navigation depth.
  // On desktop we still want a *visible* transition (not just a fade —
  // a fade alone reads as "no animation at all"), so we use a softer
  // slide that's directionally consistent but smaller in travel.
  if (isSmall.value) {
    if (d2 > d1) slideName.value = 'slide-left'
    else if (d2 < d1) slideName.value = 'slide-right'
    else slideName.value = 'slide-soft'
  } else {
    slideName.value = 'slide-soft'
  }

  // The app-level scroll lives in .route-frame (not body) to prevent
  // scrollbar pop-in during transitions. That means route changes would
  // otherwise inherit the previous page's scrollTop. Reset here so each
  // page feels independent.
  requestAnimationFrame(() => {
    document.querySelector('.route-frame')?.scrollTo({ top: 0, left: 0 })
  })
})

onMounted(async () => {
  if (auth.isLoggedIn) {
    // fetchCurrentUser populates auth.currentUser, which fires the
    // `watch(() => auth.currentUser?.id)` below — that's the single
    // entry point for catchup.run(). Don't call it manually here, or
    // we'll race ourselves and replay the same events twice.
    await auth.fetchCurrentUser()
  }
})

// Single source of truth for triggering catch-up: any time currentUser
// transitions from null/missing to a real user (refresh, fresh login,
// or partner switch — though there's only ever the one user per session).
// Also forwards the id to the chat store so presence frames can be
// self-identified by stable user id rather than fragile name strings.
watch(() => auth.currentUser?.id, (id, oldId) => {
  chat.setMyUserId(id ?? null)
  if (id && id !== oldId) catchup.run()
}, { immediate: true })

// Register the singleton hearts overlay so any view can trigger effects
watch(heartsRef, (el) => {
  if (el) registerHearts({
    burst: el.burst,
    rain: el.rain,
    corners: el.corners,
  })
}, { immediate: true })

// Heartbeat: while the tab is visible, keep the "lastSeenAt" bookmark
// fresh. Next time we come back, only events strictly after this moment
// will be replayed.
let heartbeatTimer: number | null = null
function startHeartbeat() {
  stopHeartbeat()
  heartbeatTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible' && auth.isLoggedIn) {
      catchup.markSeen()
    }
  }, 30_000)
}
function stopHeartbeat() {
  if (heartbeatTimer != null) { window.clearInterval(heartbeatTimer); heartbeatTimer = null }
}

onMounted(startHeartbeat)
// We deliberately do NOT call markSeen() in beforeunload — the request is
// racing the unload and almost always cancelled, which would either (a)
// fail silently with no anchor advance, or (b) write a too-recent local
// anchor that swallows events arriving after the user actually left. The
// 30s heartbeat is enough to keep server lastSeenAt within ~30s of truth.

// When the tab comes back to foreground after being hidden long enough,
// we may have missed events. Re-run catch-up; the run() implementation
// itself bookmarks lastSeenAt at the end, so we don't double-mark here.
const REFOCUS_THRESHOLD_MS = 60_000
let lastHidAt = 0
document.addEventListener('visibilitychange', () => {
  if (!auth.isLoggedIn) return
  if (document.visibilityState === 'hidden') {
    lastHidAt = Date.now()
    return
  }
  if (document.visibilityState === 'visible') {
    const away = lastHidAt > 0 ? Date.now() - lastHidAt : 0
    if (away > REFOCUS_THRESHOLD_MS) {
      catchup.run()
    } else {
      catchup.markSeen()
    }
  }
})

useGlobalEvents()
</script>

<template>
  <FloatingHearts ref="heartsRef" />
  <FirstWelcomeModal />
  <AppHeader v-if="auth.isLoggedIn && !hideChrome" />
  <div class="route-frame" :class="{ covered: hideChrome }">
    <router-view v-slot="{ Component }">
      <Transition :name="slideName">
        <component :is="Component" />
      </Transition>
    </router-view>
  </div>
  <MobileTabBar v-if="auth.isLoggedIn && isSmall && !hideChrome" />
</template>

<style>
/* Slide-left: new view enters from the right; old view leaves to the left.
 * Slide-right is the mirror. Both lean on the GPU translate3d so phones
 * stay smooth. The wrapper hides overflow so a half-slid sibling can't
 * show outside the viewport.
 *
 * No `mode="out-in"` — leaving pages are absolutely positioned out of
 * flow so the entering page can render in parallel. Without this trick
 * a fast tap on Home → Chat → Home would queue full leave→enter cycles
 * and feel laggy. */
/* The route-frame is the *one* scrollable region of the app. html and
 * body are locked to overflow:hidden; this container fills the gap
 * between AppHeader (top) and MobileTabBar (bottom on small screens)
 * and owns the scrollbar. Confining scroll here means route changes
 * cannot make a body scrollbar pop in/out and shift the whole layout
 * sideways. */
.route-frame {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
}
.route-frame.covered {
  /* Covered child pages hide AppHeader/MobileTabBar; remove the content
   * padding reserve normally used for the bottom tab bar. */
  --tab-bar-height: 0px;
}
.route-frame > .slide-left-leave-active,
.route-frame > .slide-right-leave-active,
.route-frame > .slide-soft-leave-active {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.slide-left-enter-active,
.slide-left-leave-active,
.slide-right-enter-active,
.slide-right-leave-active {
  transition: transform 0.2s cubic-bezier(0.22, 0.61, 0.36, 1), opacity 0.18s ease;
  will-change: transform, opacity;
}
.slide-left-enter-from   { transform: translate3d( 22%, 0, 0); opacity: 0; }
.slide-left-leave-to     { transform: translate3d(-22%, 0, 0); opacity: 0; }
.slide-right-enter-from  { transform: translate3d(-22%, 0, 0); opacity: 0; }
.slide-right-leave-to    { transform: translate3d( 22%, 0, 0); opacity: 0; }

/* Soft slide — visible motion without much travel, used on desktop and
 * on same-depth phone transitions. Translates ~8% so users feel the
 * change happening rather than seeing a "snap + crossfade". */
.slide-soft-enter-active,
.slide-soft-leave-active {
  transition: transform 0.22s cubic-bezier(0.22, 0.61, 0.36, 1), opacity 0.18s ease;
  will-change: transform, opacity;
}
.slide-soft-enter-from { transform: translate3d(0, 8px, 0); opacity: 0; }
.slide-soft-leave-to   { transform: translate3d(0, -8px, 0); opacity: 0; }

/* Don't animate when the user prefers reduced motion. */
@media (prefers-reduced-motion: reduce) {
  .slide-left-enter-active,
  .slide-left-leave-active,
  .slide-right-enter-active,
  .slide-right-leave-active,
  .slide-soft-enter-active,
  .slide-soft-leave-active { transition: none; }
}
</style>
