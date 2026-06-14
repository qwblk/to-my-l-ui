<script setup lang="ts">
/**
 * Bottom tab bar — mobile / tablet only (≤ 960px).
 *
 * Five primary destinations, sized for thumb reach. The middle slot is
 * deliberately the "compose diary" affordance because writing a diary
 * is the project's central daily habit — surfacing it as a primary tab
 * reduces it to one thumb-tap.
 *
 * Secondary entries (Timeline) stay accessible from the home page links
 * so they don't crowd the tab bar.
 */
import { useRouter, useRoute } from 'vue-router'
import { useMessagesStore } from '@/stores/messages'
import { useChatStore } from '@/stores/chat'

const router = useRouter()
const route = useRoute()
const messages = useMessagesStore()
const chat = useChatStore()

interface Tab {
  to: string
  label: string
  iconActive: string
  iconIdle: string
  /** Special "primary action" styling for the diary compose tab. */
  primary?: boolean
  /** Show partner unread badge (漂流瓶 only). */
  showUnread?: boolean
}

// Inline SVG icons keep the bundle slim and let us stroke-color the
// active state with currentColor. All viewBox 0 0 24 24.
const ICON = {
  homeIdle:    'M3 12 12 4l9 8v8a2 2 0 0 1-2 2h-4v-6h-6v6H5a2 2 0 0 1-2-2z',
  homeActive:  'M3 12 12 4l9 8v8a2 2 0 0 1-2 2h-4v-6h-6v6H5a2 2 0 0 1-2-2z',
  bookIdle:    'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z',
  pencil:      'M12 19l7-7 3 3-7 7-3-3z M18 13l-1.5-7.5L2 2l3.5 14.5L13 18zM2 2l7.586 7.586 M11 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  cameraIdle:  'M3 7h3l2-3h8l2 3h3v13H3z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  envelopeIdle:'M4 4h16v16H4z M4 4l8 8 8-8',
  compass:     'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z M16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88z',
  userIdle:    'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  moonIdle:    'M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z',
} as const

const tabs: Tab[] = [
  { to: '/',         label: '首页',   iconActive: ICON.homeIdle,     iconIdle: ICON.homeIdle },
  { to: '/chat',     label: '晚安',   iconActive: ICON.moonIdle,     iconIdle: ICON.moonIdle, showUnread: true },
  { to: '/diary',    label: '日记',   iconActive: ICON.bookIdle,     iconIdle: ICON.bookIdle },
  { to: '/discover', label: '翻翻',   iconActive: ICON.compass,      iconIdle: ICON.compass, showUnread: true },
  { to: '/mine',     label: '我的',   iconActive: ICON.userIdle,     iconIdle: ICON.userIdle },
]

function isActive(to: string): boolean {
  if (to === '/') return route.path === '/'
  return route.path.startsWith(to)
}

function unreadFor(to: string): number {
  if (to === '/discover') return messages.unreadCount
  if (to === '/chat') return chat.chatUnread
  return 0
}

function go(to: string) {
  if (route.path !== to) router.push(to)
}
</script>

<template>
  <nav class="mobile-tab-bar" role="navigation" aria-label="主导航">
    <button
      v-for="tab in tabs" :key="tab.to"
      class="tab"
      :class="{ active: isActive(tab.to), primary: tab.primary }"
      :aria-current="isActive(tab.to) ? 'page' : undefined"
      @click="go(tab.to)"
    >
      <span class="icon-wrap">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path :d="isActive(tab.to) ? tab.iconActive : tab.iconIdle" />
        </svg>
        <span v-if="tab.showUnread && unreadFor(tab.to) > 0" class="badge">{{ unreadFor(tab.to) > 99 ? '99+' : unreadFor(tab.to) }}</span>
      </span>
      <span class="label">{{ tab.label }}</span>
    </button>
  </nav>
</template>

<style scoped>
.mobile-tab-bar {
  position: fixed;
  left: 0; right: 0; bottom: 0;
  z-index: 90;
  display: flex;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border-top: 1px solid var(--pink-300);
  /* iOS home-indicator safe area */
  padding-bottom: var(--safe-bottom, 0);
  height: var(--tab-bar-height);
  /* On wider screens this nav is hidden by App.vue's v-if. We still
   * defend with display:none here for any unexpected mount. */
}

.tab {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 7px 2px;
  background: none;
  border: none;
  color: var(--ink-mute);
  cursor: pointer;
  transition: color 0.15s;
  -webkit-tap-highlight-color: transparent;
  min-height: 44px;
}
.tab:active { transform: scale(0.95); }
.tab.active { color: var(--pink-700); }

.icon-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.label {
  font-size: 10px;
  letter-spacing: 0;
  line-height: 1;
  white-space: nowrap;
}

.badge {
  position: absolute;
  top: -4px; right: -8px;
  min-width: 16px; height: 16px;
  padding: 0 4px;
  background: var(--rose-heart);
  color: #fff;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  line-height: 16px;
  text-align: center;
  box-shadow: 0 0 0 2px #fff;
}

/* Active state pill: subtle background under the icon */
.tab.active .icon-wrap::before {
  content: '';
  position: absolute;
  inset: -5px -8px;
  background: var(--pink-200);
  border-radius: 999px;
  z-index: -1;
}
</style>
