<script setup lang="ts">
/**
 * Controlled floating-hearts overlay.
 *
 * Mounted once at the App root; emits no hearts by default — call the
 * exposed `burst` / `rain` methods (or use `useHeartBurst()`) to spawn them.
 *
 * Design principle: hearts are precious. Never autoplay. Triggered only by
 * meaningful user moments (login success, like, special anniversaries).
 */
import { ref } from 'vue'

interface Heart {
  id: number
  x: number          // viewport X in px
  y: number          // viewport Y in px
  size: number
  duration: number
  drift: number
  rotation: number
  glyph: string
  delay: number
}

const hearts = ref<Heart[]>([])
let nextId = 0

const GLYPHS = ['❤', '💕', '💖', '💗', '✨']

function spawn(opts: Partial<Heart> & { x: number; y: number }) {
  const heart: Heart = {
    id: nextId++,
    x: opts.x,
    y: opts.y,
    size: opts.size ?? 14 + Math.random() * 16,
    duration: opts.duration ?? 1.4 + Math.random() * 1.0,
    drift: opts.drift ?? (Math.random() - 0.5) * 140,
    rotation: opts.rotation ?? (Math.random() - 0.5) * 80,
    glyph: opts.glyph ?? GLYPHS[Math.floor(Math.random() * GLYPHS.length)],
    delay: opts.delay ?? 0,
  }
  hearts.value.push(heart)
  setTimeout(() => {
    hearts.value = hearts.value.filter((h) => h.id !== heart.id)
  }, (heart.duration + heart.delay) * 1000 + 200)
}

/** Burst N hearts upward from screen-coords (x, y). Tight, expressive. */
function burst(x: number, y: number, count = 6) {
  for (let i = 0; i < count; i++) {
    spawn({
      x: x + (Math.random() - 0.5) * 24,
      y,
      delay: i * 0.04,
      drift: (Math.random() - 0.5) * 160,
      duration: 1.3 + Math.random() * 0.8,
    })
  }
}

/** A one-shot rain across the viewport — reserved for special dates. */
function rain(count = 32) {
  const w = window.innerWidth
  const h = window.innerHeight
  for (let i = 0; i < count; i++) {
    spawn({
      x: Math.random() * w,
      y: h + 20,
      delay: Math.random() * 1.5,
      duration: 3 + Math.random() * 2,
      drift: (Math.random() - 0.5) * 200,
      size: 18 + Math.random() * 22,
    })
  }
}

/** Quick four-corner sparkle, used on login success. */
function corners() {
  const w = window.innerWidth
  const h = window.innerHeight
  const points: Array<[number, number]> = [
    [80, 80], [w - 80, 80], [80, h - 80], [w - 80, h - 80],
  ]
  points.forEach(([x, y], idx) => {
    for (let i = 0; i < 5; i++) {
      spawn({
        x, y,
        delay: idx * 0.08 + i * 0.05,
        drift: (Math.random() - 0.5) * 120,
        duration: 1.4 + Math.random() * 0.6,
      })
    }
  })
}

defineExpose({ burst, rain, corners })
</script>

<template>
  <div class="hearts-container" aria-hidden="true">
    <span
      v-for="h in hearts"
      :key="h.id"
      class="floating-heart"
      :style="{
        left: h.x + 'px',
        top: h.y + 'px',
        fontSize: h.size + 'px',
        animationDuration: h.duration + 's',
        animationDelay: h.delay + 's',
        '--bx': h.drift + 'px',
        '--by': '-180px',
        '--rot': h.rotation + 'deg',
      }"
    >{{ h.glyph }}</span>
  </div>
</template>

<style scoped>
.hearts-container {
  position: fixed;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 9999;
}

.floating-heart {
  position: absolute;
  transform: translate(-50%, -50%);
  color: var(--rose-heart);
  filter: drop-shadow(0 2px 6px rgba(255, 77, 109, 0.35));
  animation: heart-burst ease-out forwards;
  will-change: transform, opacity;
}

@keyframes heart-burst {
  0%   { transform: translate(-50%, -50%) scale(0.4) rotate(0); opacity: 0; }
  20%  { opacity: 1; transform: translate(calc(-50% + var(--bx) * 0.2), calc(-50% - 30px)) scale(1.1) rotate(var(--rot)); }
  100% { transform: translate(calc(-50% + var(--bx)), calc(-50% + var(--by))) scale(0.5) rotate(calc(var(--rot) * 2)); opacity: 0; }
}
</style>
