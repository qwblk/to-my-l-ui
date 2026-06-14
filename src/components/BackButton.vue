<script setup lang="ts">
/**
 * BackButton — pill-shaped "back to parent" affordance.
 *
 * Visible on every device. Phone users need it because the bottom tab
 * doesn't include moment / timeline; desktop users benefit because the
 * top nav highlights "翻翻" but doesn't itself act as a back action.
 *
 * Smart navigation: if there's an in-app history entry, browser back
 * preserves scroll/state. Otherwise we fall back to the configured
 * `to` (defaults to /discover, with the matching label "翻翻").
 */
import { useRouter } from 'vue-router'

const props = withDefaults(defineProps<{
  /** Fallback route when there's no in-app history. */
  to?: string
  /** Label shown in the pill. Defaults to "翻翻". */
  label?: string
}>(), {
  to: '/discover',
  label: '翻翻',
})

const router = useRouter()

function goBack() {
  if (window.history.length > 1) {
    router.back()
  } else {
    router.replace(props.to)
  }
}
</script>

<template>
  <Teleport to="body">
    <button
      type="button"
      class="back-pill"
      :aria-label="`返回${label}`"
      @click="goBack"
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M15 18l-6-6 6-6" />
      </svg>
      <span>{{ label }}</span>
    </button>
  </Teleport>
</template>

<style scoped>
.back-pill {
  position: fixed;
  /* Desktop: AppHeader (56px) is still visible — sit just below it so we
   * don't collide with the brand logo. Mobile: AppHeader is hidden on
   * coverNav pages, so the pill lives directly at the top (overridden in
   * the @media block below). */
  top: 72px;
  left: 18px;
  z-index: 120;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px 6px 10px;
  height: 32px;
  border-radius: 999px;
  border: 1px solid var(--pink-300);
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  color: var(--pink-700);
  font-size: 13px;
  letter-spacing: 0.5px;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(255, 126, 182, 0.18);
  transition: background 0.15s, transform 0.1s, border-color 0.15s;
  -webkit-tap-highlight-color: transparent;
}
.back-pill:active { transform: scale(0.96); }
@media (hover: hover) {
  .back-pill:hover {
    background: var(--pink-200);
    border-color: var(--pink-600);
  }
}
@media (max-width: 960px) {
  .back-pill {
    top: calc(env(safe-area-inset-top, 0px) + 12px);
    left: 12px;
    height: 30px;
    font-size: 12px;
    padding: 5px 12px 5px 9px;
  }
}
</style>
