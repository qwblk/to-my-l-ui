<script setup lang="ts">
/**
 * MediaGrid — display the mediaList of an existing Moment in the feed.
 *
 * Layout rules (mirrors WeChat / Instagram conventions):
 *   1 item     → full width, max-height-capped, aspect-ratio preserved
 *   2 items    → 2 columns, 1:1 squares
 *   3 items    → 3 columns, 1:1 squares
 *   4 items    → 2x2 grid
 *   5–6 items  → 3 columns
 *   7–9 items  → 3 columns, third row fills bottom
 *
 * Videos render as inline <video> with controls. The first frame is
 * loaded via preload="metadata" so the user sees a poster, not a black
 * box. A play overlay icon hints it's a video before any interaction.
 *
 * Clicking an image emits @open-lightbox (parent wires up the lightbox).
 */
import { computed } from 'vue'
import type { MomentMedia } from '@/types'
import { resolveAssetUrl } from '@/api/client'

const props = defineProps<{
  list: MomentMedia[]
}>()

const emit = defineEmits<{
  (e: 'open-lightbox', index: number): void
}>()

/** Layout class buckets: "single" / "two" / "three" / "four" / "many" */
const layout = computed(() => {
  const n = props.list.length
  if (n <= 1) return 'single'
  if (n === 2) return 'two'
  if (n === 3) return 'three'
  if (n === 4) return 'four'
  return 'many'
})

function clickItem(idx: number, item: MomentMedia) {
  // Videos handle their own clicks via native controls; only images
  // open the lightbox.
  if (item.type === 'image') emit('open-lightbox', idx)
}

/** For a single image, derive an aspect-ratio inline style so the
 *  rendered element matches the source image and doesn't flash a wrong
 *  shape during load. */
function singleStyle(m: MomentMedia): Record<string, string> {
  if (m.width && m.height) {
    return { aspectRatio: `${m.width} / ${m.height}` }
  }
  // Unknown — let the image natural size win, capped by max-height
  return {}
}
</script>

<template>
  <div v-if="list.length" class="media-grid" :class="['layout-' + layout]">
    <div
      v-for="(m, idx) in list" :key="idx"
      class="media-cell"
      :class="['kind-' + m.type]"
      @click="clickItem(idx, m)"
    >
      <template v-if="m.type === 'image'">
        <img
          :src="resolveAssetUrl(m.url)"
          :style="layout === 'single' ? singleStyle(m) : undefined"
          alt=""
          loading="lazy"
          decoding="async"
          class="media-img"
        />
      </template>
      <template v-else>
        <video
          :src="resolveAssetUrl(m.url)"
          controls
          preload="metadata"
          playsinline
          class="media-video"
        />
        <!-- Play hint shown when controls are hidden -->
        <div class="play-hint" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="34" height="34" fill="rgba(255,255,255,0.92)">
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.media-grid {
  display: grid;
  gap: 4px;
  margin: 8px 0 10px;
  border-radius: 12px;
  overflow: hidden;
}

/* Single — natural aspect ratio, capped height */
.layout-single { display: block; }
.layout-single .media-cell { width: 100%; max-height: 480px; }
.layout-single .media-img { max-height: 480px; height: auto; object-fit: contain; background: var(--pink-50); }

/* 2 / 3 — single row of square tiles */
.layout-two   { grid-template-columns: repeat(2, 1fr); }
.layout-three { grid-template-columns: repeat(3, 1fr); }
/* 4 — 2x2 */
.layout-four  { grid-template-columns: repeat(2, 1fr); }
/* 5-9 — 3 columns, rows naturally fill */
.layout-many  { grid-template-columns: repeat(3, 1fr); }

/* All multi-cell layouts force square thumbnails */
.layout-two .media-cell,
.layout-three .media-cell,
.layout-four .media-cell,
.layout-many .media-cell {
  aspect-ratio: 1;
}

.media-cell {
  position: relative;
  background: var(--pink-100);
  cursor: pointer;
  overflow: hidden;
}
.media-cell.kind-video { cursor: default; } /* native controls take over */

.media-img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
  transition: transform 0.3s;
}
@media (hover: hover) {
  .media-cell.kind-image:hover .media-img { transform: scale(1.04); }
}

.media-video {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
  background: #000;
}

.play-hint {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  pointer-events: none;
  background: linear-gradient(180deg, transparent 60%, rgba(0,0,0,0.25) 100%);
  opacity: 1;
  transition: opacity 0.2s;
}
/* Once the video is playing the native controls suffice — fade the hint */
.media-cell.kind-video video[controls]:not([paused]) ~ .play-hint { opacity: 0; }
</style>
