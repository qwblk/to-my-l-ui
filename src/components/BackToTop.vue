<script setup lang="ts">
/**
 * BackToTop — floating "↑" button.
 *
 * Appears after the page has scrolled past `threshold` pixels and
 * smooth-scrolls back to the top on click.
 *
 * Positioning:
 *   - Bottom-right of the viewport
 *   - Above the mobile tab bar (uses --tab-bar-height var, which is 0
 *     on desktop and 56px+safe-area on phone)
 *   - Above iOS home-indicator safe area
 *
 * Defaults to listening on `window` (the page itself scrolls). Pass
 * `:target="someEl"` to listen on a specific scroll container instead.
 */
import { onMounted, onBeforeUnmount, ref } from 'vue'

const props = withDefaults(defineProps<{
  /** Show button only after scrolling past this many pixels. */
  threshold?: number
  /** Optional custom scroll container; defaults to window. */
  target?: HTMLElement | null
}>(), {
  threshold: 600,
  target: null,
})

const visible = ref(false)

/** Resolve the actual scroll surface. The app's primary scrolling
 * container is `.route-frame`; the document itself is locked to
 * overflow:hidden to keep route changes from toggling a body
 * scrollbar. Falls back to window if the marker class isn't mounted. */
function resolveTarget(): HTMLElement | Window {
  if (props.target) return props.target
  return (document.querySelector('.route-frame') as HTMLElement | null) || window
}

function getScrollTop(): number {
  const t = resolveTarget()
  if (t instanceof Window) return window.scrollY || document.documentElement.scrollTop
  return t.scrollTop
}

function onScroll() {
  visible.value = getScrollTop() > props.threshold
}

function scrollToTop() {
  const t = resolveTarget()
  if (t instanceof Window) window.scrollTo({ top: 0, behavior: 'smooth' })
  else t.scrollTo({ top: 0, behavior: 'smooth' })
}

let listenedTarget: HTMLElement | Window | null = null
onMounted(() => {
  listenedTarget = resolveTarget()
  listenedTarget.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
})
onBeforeUnmount(() => {
  listenedTarget?.removeEventListener('scroll', onScroll)
  listenedTarget = null
})
</script>

<template>
  <Transition name="btt-fade">
    <button
      v-if="visible"
      type="button"
      class="back-to-top"
      aria-label="回到顶部"
      @click="scrollToTop"
    >
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 19V5" />
        <path d="M5 12l7-7 7 7" />
      </svg>
    </button>
  </Transition>
</template>

<style scoped>
.back-to-top {
  position: fixed;
  right: 20px;
  /* Float above the bottom tab bar (var resolves to 0 on desktop, 56+ on phone)
   * plus 16px breathing room above the bar. */
  bottom: calc(var(--tab-bar-height, 0px) + 20px);
  width: 42px;
  height: 42px;
  border: 1px solid var(--pink-300);
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border-radius: 50%;
  color: var(--pink-700);
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(255, 126, 182, 0.2);
  display: flex; align-items: center; justify-content: center;
  z-index: 80;
  transition: transform 0.15s, box-shadow 0.15s;
}
@media (hover: hover) {
  .back-to-top:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 22px rgba(255, 126, 182, 0.32);
  }
}
.back-to-top:active { transform: scale(0.92); }

@media (max-width: 600px) {
  .back-to-top {
    right: 14px;
    width: 38px; height: 38px;
  }
}

.btt-fade-enter-active, .btt-fade-leave-active { transition: opacity 0.2s, transform 0.2s; }
.btt-fade-enter-from, .btt-fade-leave-to { opacity: 0; transform: translateY(8px); }
</style>
