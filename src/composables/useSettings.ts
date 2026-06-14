/**
 * useSettings — single source of truth for client-side preferences.
 *
 * Each setting is read from localStorage with a fallback default, exposed
 * as a Vue ref, and persisted on every change. Other parts of the app
 * import `settings` directly to react to the user's preferences.
 *
 * Settings here are intentionally local-only. Cross-device sync would
 * require a backend table; for two users this isn't worth it yet.
 */
import { ref, watch } from 'vue'

const KEY = 'tml:settings'

export type HeartIntensity = 'off' | 'subtle' | 'normal' | 'lavish'
export type DiaryDefaultScope = 'all' | 'mine'

interface SettingsShape {
  heartIntensity: HeartIntensity
  toastNewMoment: boolean
  toastNewDiary: boolean
  toastNewMessage: boolean
  toastReadReceipt: boolean
  toastPresence: boolean
  confirmDelete: boolean
  diaryDefaultScope: DiaryDefaultScope
  showSpecialDateHint: boolean
}

const DEFAULTS: SettingsShape = {
  heartIntensity: 'normal',
  toastNewMoment: true,
  toastNewDiary: true,
  toastNewMessage: true,
  toastReadReceipt: true,
  toastPresence: true,
  confirmDelete: true,
  diaryDefaultScope: 'all',
  showSpecialDateHint: true,
}

function load(): SettingsShape {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw)
    return { ...DEFAULTS, ...parsed }
  } catch {
    return { ...DEFAULTS }
  }
}

const state = ref<SettingsShape>(load())

watch(state, (v) => {
  try { localStorage.setItem(KEY, JSON.stringify(v)) } catch { /* quota / private mode */ }
}, { deep: true })

/** Cross-tab sync: another tab on the same browser updates → reflect here. */
window.addEventListener('storage', (ev) => {
  if (ev.key !== KEY || !ev.newValue) return
  try { state.value = { ...DEFAULTS, ...JSON.parse(ev.newValue) } } catch { /* ignore */ }
})

/** Multiplier applied to the count of hearts spawned by burst/rain. */
function heartMultiplier(intensity: HeartIntensity): number {
  switch (intensity) {
    case 'off':    return 0
    case 'subtle': return 0.5
    case 'normal': return 1
    case 'lavish': return 1.6
  }
}

export function useSettings() {
  return state
}

/** Imperative read for non-component code (e.g. event listeners). */
export function getSettings(): SettingsShape {
  return state.value
}

export function getHeartMultiplier(): number {
  return heartMultiplier(state.value.heartIntensity)
}

/** Reset everything back to defaults. */
export function resetSettings() {
  state.value = { ...DEFAULTS }
}
