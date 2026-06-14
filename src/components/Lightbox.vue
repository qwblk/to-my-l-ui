<script setup lang="ts">
/**
 * Lightbox — full-screen image viewer.
 *
 * Lifecycle: parent toggles `modelValue` (boolean) to show/hide; passes
 * the full `list` of media and an initial `index`. Internal index state
 * is owned by this component so the user can navigate without round-
 * tripping back to the parent.
 *
 * Interactions:
 *   - Click backdrop / close button / press Esc → close
 *   - Click left / right arrow / press ← →    → navigate
 *   - Touch swipe left / right                 → navigate
 *   - Pinch / scroll                          → not implemented (kept
 *     intentionally simple; the photos are personal, not a gallery)
 *
 * The component skips video items in navigation — a lightbox isn't the
 * right surface for inline video. Videos play in the feed via
 * <video controls>.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import type { MomentMedia } from '@/types'
import { resolveAssetUrl } from '@/api/client'

const props = defineProps<{
  modelValue: boolean
  list: MomentMedia[]
  index: number
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
}>()

/** Visible images only — videos are excluded. We map external `index`
 *  to a position within this filtered list. */
const imageList = computed(() => props.list.filter((m) => m.type === 'image'))

const cursor = ref(0)

watch(
  () => [props.modelValue, props.index] as const,
  ([open, externalIdx]) => {
    if (!open) return
    // Find the index inside imageList that corresponds to the external item
    const target = props.list[externalIdx]
    if (!target || target.type !== 'image') {
      cursor.value = 0
      return
    }
    const innerIdx = imageList.value.indexOf(target)
    cursor.value = innerIdx >= 0 ? innerIdx : 0
  },
  { immediate: true },
)

const current = computed(() => imageList.value[cursor.value])
const canPrev = computed(() => cursor.value > 0)
const canNext = computed(() => cursor.value < imageList.value.length - 1)

function close() { emit('update:modelValue', false) }
function prev() { if (canPrev.value) cursor.value-- }
function next() { if (canNext.value) cursor.value++ }

// === Keyboard ===
function onKey(e: KeyboardEvent) {
  if (!props.modelValue) return
  if (e.key === 'Escape') close()
  else if (e.key === 'ArrowLeft') prev()
  else if (e.key === 'ArrowRight') next()
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

// === Touch swipe ===
let touchStartX = 0
let touchStartY = 0
function onTouchStart(e: TouchEvent) {
  touchStartX = e.touches[0].clientX
  touchStartY = e.touches[0].clientY
}
function onTouchEnd(e: TouchEvent) {
  const t = e.changedTouches[0]
  const dx = t.clientX - touchStartX
  const dy = t.clientY - touchStartY
  // Reject mostly-vertical swipes (probably scroll attempts)
  if (Math.abs(dy) > Math.abs(dx)) return
  if (Math.abs(dx) < 40) return
  if (dx > 0) prev(); else next()
}

// === Body scroll lock while open ===
watch(() => props.modelValue, (open) => {
  if (open) document.body.style.overflow = 'hidden'
  else document.body.style.overflow = ''
})
onBeforeUnmount(() => { document.body.style.overflow = '' })
</script>

<template>
  <Teleport to="body">
    <Transition name="lb-fade">
      <div
        v-if="modelValue && current"
        class="lightbox"
        role="dialog"
        aria-modal="true"
        @click.self="close"
        @touchstart.passive="onTouchStart"
        @touchend.passive="onTouchEnd"
      >
        <button class="close" type="button" @click="close" aria-label="关闭">×</button>

        <button
          v-if="canPrev"
          class="nav nav-prev" type="button" @click.stop="prev" aria-label="上一张"
        >‹</button>

        <img
          :key="current.url"
          :src="resolveAssetUrl(current.url)"
          alt=""
          class="lb-img"
          @click.stop
        />

        <button
          v-if="canNext"
          class="nav nav-next" type="button" @click.stop="next" aria-label="下一张"
        >›</button>

        <div v-if="imageList.length > 1" class="counter">
          {{ cursor + 1 }} / {{ imageList.length }}
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.lightbox {
  position: fixed;
  inset: 0;
  z-index: 9000;
  background: rgba(20, 10, 16, 0.94);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  overflow: hidden;
}

.lb-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 4px;
  user-select: none;
  -webkit-user-drag: none;
  box-shadow: 0 20px 60px rgba(0,0,0,0.5);
}

.close {
  position: absolute;
  top: 16px; right: 16px;
  width: 40px; height: 40px;
  border-radius: 50%;
  background: rgba(255,255,255,0.15);
  color: #fff;
  border: none;
  font-size: 26px;
  line-height: 1;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  padding-bottom: 3px;
  transition: background 0.15s;
}
.close:hover { background: rgba(255,255,255,0.25); }

.nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 48px; height: 48px;
  border-radius: 50%;
  background: rgba(255,255,255,0.15);
  color: #fff;
  border: none;
  font-size: 36px;
  line-height: 1;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  padding-bottom: 4px;
  transition: background 0.15s;
}
.nav:hover { background: rgba(255,255,255,0.25); }
.nav-prev { left: 16px; }
.nav-next { right: 16px; }

.counter {
  position: absolute;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  padding: 4px 14px;
  background: rgba(0,0,0,0.5);
  color: #fff;
  border-radius: 999px;
  font-size: 13px;
  letter-spacing: 1px;
}

/* Mobile: hide nav arrows (swipe takes over), shrink close button */
@media (max-width: 600px) {
  .nav { display: none; }
  .lightbox { padding: 0; }
  .close { top: env(safe-area-inset-top, 16px); right: 12px; width: 36px; height: 36px; font-size: 22px; }
}

/* Transition */
.lb-fade-enter-active, .lb-fade-leave-active { transition: opacity 0.2s; }
.lb-fade-enter-from, .lb-fade-leave-to { opacity: 0; }
</style>
