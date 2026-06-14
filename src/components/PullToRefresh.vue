<script setup lang="ts">
/**
 * PullToRefresh — touch-only "pull down to reload" wrapper.
 *
 * Gesture rules:
 *   - Only activates when the user starts the gesture at scrollTop = 0
 *     (otherwise pull-down is normal scroll).
 *   - Only triggered by touch input. Mouse drag is intentionally not
 *     wired up; desktop users have F5 / browser refresh.
 *   - Ignored if the gesture is mostly horizontal (avoid hijacking
 *     swipe interactions in nested components).
 *
 * Visual:
 *   A small pill with a spinner / arrow / text appears above the
 *   page, pulled down with the finger. Releasing past the threshold
 *   fires `@refresh`; the parent should resolve the returned promise
 *   when its data is ready, then we slide the pill back up.
 */
import { ref, onMounted, onBeforeUnmount } from 'vue'

const props = withDefaults(defineProps<{
  /** Distance in px the user must drag before release triggers refresh. */
  threshold?: number
  /** Maximum visual translation; the pill stops moving past this. */
  maxPull?: number
  /** Disable the entire gesture (e.g. while a dialog is open). */
  disabled?: boolean
}>(), {
  threshold: 64,
  maxPull: 120,
  disabled: false,
})

const emit = defineEmits<{
  (e: 'refresh'): Promise<void> | void
}>()

type Phase = 'idle' | 'pulling' | 'ready' | 'refreshing'
const phase = ref<Phase>('idle')
const pullDistance = ref(0)

let startY = 0
let startX = 0
let tracking = false

/** Resolve the actual scroll container.
 *
 * The app's primary scroll surface used to be the document itself, but
 * we've moved page-level scrolling into a `.route-frame` element so route
 * transitions don't toggle the body scrollbar. PTR therefore needs to
 * read scrollTop off that element instead of the window. Falls back to
 * the document if the marker class isn't present (e.g. when rendered in
 * isolation in tests). */
function getScrollEl(): HTMLElement | Window {
  return (document.querySelector('.route-frame') as HTMLElement | null) || window
}
function getScrollTop(): number {
  const target = getScrollEl()
  if (target instanceof Window) {
    return window.scrollY || document.documentElement.scrollTop
  }
  return target.scrollTop
}

function onTouchStart(e: TouchEvent) {
  if (props.disabled) return
  if (phase.value === 'refreshing') return
  // Only engage when the page is already at the top — otherwise we're
  // intercepting a normal scroll-up gesture.
  if (getScrollTop() > 0) return

  const t = e.touches[0]
  startY = t.clientY
  startX = t.clientX
  tracking = true
  pullDistance.value = 0
}

function onTouchMove(e: TouchEvent) {
  if (!tracking) return
  const t = e.touches[0]
  const dy = t.clientY - startY
  const dx = t.clientX - startX

  // Reject if user is mostly swiping sideways (carousel etc.)
  if (Math.abs(dx) > Math.abs(dy) + 6) {
    tracking = false
    pullDistance.value = 0
    phase.value = 'idle'
    return
  }
  if (dy <= 0) {
    pullDistance.value = 0
    phase.value = 'idle'
    return
  }

  // Apply rubber-band damping so the pill never feels like it's being
  // physically yanked at 1:1.
  const eased = dampen(dy, props.maxPull)
  pullDistance.value = eased
  phase.value = eased >= props.threshold ? 'ready' : 'pulling'

  // Once the user has clearly decided to pull, prevent the page from
  // scrolling further (Safari's overscroll otherwise flashes white).
  if (eased > 4 && e.cancelable) e.preventDefault()
}

function onTouchEnd() {
  if (!tracking) return
  tracking = false
  if (phase.value === 'ready') {
    triggerRefresh()
  } else {
    relax()
  }
}

function dampen(raw: number, max: number): number {
  // Asymptotic toward `max * 1.4` so even hard pulls stay finite-ish.
  return max * (1 - Math.exp(-raw / max))
}

async function triggerRefresh() {
  phase.value = 'refreshing'
  pullDistance.value = props.threshold
  try {
    const r = emit('refresh') as unknown as Promise<void> | void
    if (r && typeof (r as Promise<void>).then === 'function') {
      await r
    } else {
      // No promise returned; give a brief visual cue regardless
      await new Promise((res) => setTimeout(res, 450))
    }
  } finally {
    relax()
  }
}

function relax() {
  pullDistance.value = 0
  // Wait one frame for transition styles to apply before flipping phase
  requestAnimationFrame(() => { phase.value = 'idle' })
}

onMounted(() => {
  // Touch listeners on window so children with their own scroll containers
  // can still trigger PTR when the page itself is at top.
  window.addEventListener('touchstart', onTouchStart, { passive: true })
  window.addEventListener('touchmove', onTouchMove, { passive: false })
  window.addEventListener('touchend', onTouchEnd, { passive: true })
  window.addEventListener('touchcancel', onTouchEnd, { passive: true })
})
onBeforeUnmount(() => {
  window.removeEventListener('touchstart', onTouchStart)
  window.removeEventListener('touchmove', onTouchMove)
  window.removeEventListener('touchend', onTouchEnd)
  window.removeEventListener('touchcancel', onTouchEnd)
})
</script>

<template>
  <Transition name="ptr-fade">
    <div
      v-if="phase !== 'idle'"
      class="ptr"
      :style="{
        transform: `translate3d(-50%, ${Math.max(pullDistance - 40, 0)}px, 0)`,
        transition: phase === 'refreshing' ? 'transform 0.25s ease' : 'none',
      }"
    >
      <span class="spinner" :class="{ active: phase === 'refreshing' }"></span>
      <span class="label">
        <template v-if="phase === 'refreshing'">正在刷新…</template>
        <template v-else-if="phase === 'ready'">松开就刷新</template>
        <template v-else>下拉刷新</template>
      </span>
    </div>
  </Transition>
</template>

<style scoped>
.ptr {
  position: fixed;
  top: 0;
  left: 50%;
  z-index: 95;
  display: flex; align-items: center; gap: 8px;
  padding: 8px 16px;
  background: rgba(255, 255, 255, 0.94);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid var(--pink-300);
  border-radius: 999px;
  box-shadow: 0 4px 14px rgba(255, 126, 182, 0.25);
  color: var(--pink-700);
  font-size: 13px;
  letter-spacing: 0.5px;
  pointer-events: none;
  white-space: nowrap;
}

.spinner {
  width: 14px; height: 14px;
  border-radius: 50%;
  border: 2px solid var(--pink-300);
  border-top-color: var(--rose-heart);
}
.spinner.active { animation: ptr-spin 0.8s linear infinite; }

@keyframes ptr-spin {
  to { transform: rotate(360deg); }
}

.ptr-fade-enter-active, .ptr-fade-leave-active { transition: opacity 0.18s; }
.ptr-fade-enter-from, .ptr-fade-leave-to { opacity: 0; }

/* Don't show on desktop — the gesture isn't useful there */
@media (min-width: 961px) {
  .ptr { display: none; }
}
</style>
