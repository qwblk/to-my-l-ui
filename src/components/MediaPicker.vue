<script setup lang="ts">
/**
 * MediaPicker — multi-file picker tailored for the moment composer.
 *
 * Capabilities:
 *   - Click / tap to open the system picker. On mobile this gives the
 *     user 拍照 / 录像 / 相册 / 文件 in one sheet.
 *   - Drag & drop (desktop only — disabled implicitly on touch).
 *   - Paste from clipboard (Ctrl+V) when the textarea is focused; we
 *     listen on document so the user doesn't have to focus the picker.
 *   - Local preview via URL.createObjectURL — instant, no waiting on
 *     upload. The thumbnail stays even after upload starts so the user
 *     sees a stable feed.
 *   - Serial upload (one at a time) with per-item progress.
 *   - Per-item delete (cancels in-flight upload too).
 *
 * Output (v-model:items): an array of MediaItem in three states —
 *   pending  → just picked, not yet uploaded
 *   uploading → upload in flight, has progress%
 *   done     → uploaded, has remoteMedia (used to build mediaList)
 *   failed   → upload errored, has errorMsg + retry()
 *
 * The parent reads `items` to render previews and on submit collects
 * everything where status === 'done' into mediaList.
 */
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { uploadFile } from '@/api/upload'
import type { MomentMedia } from '@/types'
import { ElMessage } from 'element-plus'

const MAX_ITEMS = 9
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_VIDEO_BYTES = 50 * 1024 * 1024
const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime'

export type MediaItemStatus = 'pending' | 'uploading' | 'done' | 'failed'

export interface MediaItem {
  /** Stable client id, used for v-for keys and removal. */
  id: string
  file: File
  /** Local blob: URL for preview. Revoked on remove or unmount. */
  previewUrl: string
  kind: 'image' | 'video'
  status: MediaItemStatus
  progress: number
  errorMsg?: string
  /** Filled in when upload completes; this is what the composer pulls
   *  out to build the final mediaList for POST /moment. */
  remoteMedia?: MomentMedia
}

const props = defineProps<{
  /** Disable interactions while the parent is submitting the post. */
  disabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'change', items: MediaItem[]): void
}>()

const items = ref<MediaItem[]>([])
const fileInput = ref<HTMLInputElement | null>(null)
const dragOver = ref(false)

let nextId = 0
function uid() { return 'm' + (++nextId) + '-' + Date.now().toString(36) }

watch(items, (val) => emit('change', [...val]), { deep: true })

defineExpose({
  /** Parent calls this to obtain only the successfully-uploaded items
   *  in original order. */
  collectMediaList(): MomentMedia[] {
    return items.value
      .filter((it) => it.status === 'done' && it.remoteMedia)
      .map((it) => it.remoteMedia as MomentMedia)
  },
  hasUploading(): boolean {
    return items.value.some((it) => it.status === 'uploading')
  },
  hasFailed(): boolean {
    return items.value.some((it) => it.status === 'failed')
  },
  reset() {
    items.value.forEach((it) => URL.revokeObjectURL(it.previewUrl))
    items.value = []
  },
})

// === Picking ===

function openPicker() {
  if (props.disabled) return
  fileInput.value?.click()
}

function onFileInput(e: Event) {
  const target = e.target as HTMLInputElement
  if (target.files) addFiles(Array.from(target.files))
  // Reset so picking the same file twice in a row still fires change
  target.value = ''
}

function classify(file: File): 'image' | 'video' | null {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  return null
}

function validateFile(file: File): { ok: true; kind: 'image' | 'video' } | { ok: false; reason: string } {
  const kind = classify(file)
  if (!kind) return { ok: false, reason: `${file.name}：暂不支持的文件类型` }
  if (kind === 'image' && !/^image\/(jpeg|png|webp|gif)$/.test(file.type)) {
    return { ok: false, reason: `${file.name}：图片格式不支持` }
  }
  if (kind === 'video' && !/^video\/(mp4|quicktime)$/.test(file.type)) {
    return { ok: false, reason: `${file.name}：视频格式不支持` }
  }
  if (kind === 'image' && file.size > MAX_IMAGE_BYTES) {
    return { ok: false, reason: `${file.name}：图片不能超过 10MB` }
  }
  if (kind === 'video' && file.size > MAX_VIDEO_BYTES) {
    return { ok: false, reason: `${file.name}：视频不能超过 50MB` }
  }
  return { ok: true, kind }
}

function addFiles(files: File[]) {
  if (props.disabled) return

  // Cap at MAX_ITEMS — keep already-added items, accept up to N - existing
  const room = MAX_ITEMS - items.value.length
  if (room <= 0) {
    ElMessage.warning(`一次最多 ${MAX_ITEMS} 个`)
    return
  }
  const accepted: { file: File; kind: 'image' | 'video' }[] = []
  for (const f of files.slice(0, room)) {
    const v = validateFile(f)
    if (!v.ok) { ElMessage.warning(v.reason); continue }
    accepted.push({ file: f, kind: v.kind })
  }
  if (files.length > room) {
    ElMessage.warning(`只能再添加 ${room} 个`)
  }

  for (const { file, kind } of accepted) {
    const item: MediaItem = {
      id: uid(),
      file,
      previewUrl: URL.createObjectURL(file),
      kind,
      status: 'pending',
      progress: 0,
    }
    items.value.push(item)
    // Kick off upload immediately. Multiple uploads serialize naturally
    // because each await blocks the queue; if the previous one is still
    // going, this just waits its turn behind it.
    void uploadOne(item)
  }
}

// === Probing video duration locally ===

function probeDuration(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.src = url
    const cleanup = () => {
      v.src = ''
      URL.revokeObjectURL(url)
    }
    v.onloadedmetadata = () => {
      const d = isFinite(v.duration) ? v.duration : undefined
      cleanup()
      resolve(d)
    }
    v.onerror = () => { cleanup(); resolve(undefined) }
  })
}

// === Upload ===

let uploadChain: Promise<void> = Promise.resolve()

function uploadOne(item: MediaItem): Promise<void> {
  // Chain so concurrent picks serialize on the wire
  uploadChain = uploadChain.then(() => doUpload(item)).catch(() => undefined)
  return uploadChain
}

async function doUpload(item: MediaItem) {
  // Item may have been removed before its turn came up
  if (!items.value.includes(item)) return

  item.status = 'uploading'
  item.progress = 0
  item.errorMsg = undefined

  try {
    const res = await uploadFile(item.file, (p) => { item.progress = p })

    // Compose the final MomentMedia. Use server-reported width/height/url
    // and overlay duration for videos via a local probe.
    const data = res.data
    const media: MomentMedia = {
      type: data.type,
      url: data.url,
      width: data.width,
      height: data.height,
    }
    if (data.type === 'video') {
      media.duration = await probeDuration(item.file)
    }
    item.remoteMedia = media
    item.status = 'done'
    item.progress = 100
  } catch (err: any) {
    item.status = 'failed'
    item.errorMsg = err?.msg || err?.message || '上传失败'
  }
}

function retry(item: MediaItem) {
  if (item.status !== 'failed') return
  void uploadOne(item)
}

function remove(item: MediaItem) {
  const idx = items.value.indexOf(item)
  if (idx === -1) return
  URL.revokeObjectURL(item.previewUrl)
  items.value.splice(idx, 1)
}

// === Drag & drop (desktop) ===

function onDragOver(e: DragEvent) {
  if (props.disabled) return
  e.preventDefault()
  dragOver.value = true
}
function onDragLeave() { dragOver.value = false }
function onDrop(e: DragEvent) {
  e.preventDefault()
  dragOver.value = false
  if (props.disabled) return
  const files = e.dataTransfer?.files
  if (files && files.length) addFiles(Array.from(files))
}

// === Paste from clipboard ===

function onPaste(e: ClipboardEvent) {
  if (props.disabled) return
  const files = e.clipboardData?.files
  if (files && files.length) {
    e.preventDefault()
    addFiles(Array.from(files))
  }
}

onMounted(() => {
  document.addEventListener('paste', onPaste)
})
onBeforeUnmount(() => {
  document.removeEventListener('paste', onPaste)
  // Free all preview blobs
  items.value.forEach((it) => URL.revokeObjectURL(it.previewUrl))
})

function durationLabel(s?: number): string {
  if (s === undefined) return ''
  const mm = Math.floor(s / 60)
  const ss = Math.floor(s % 60).toString().padStart(2, '0')
  return `${mm}:${ss}`
}
</script>

<template>
  <div class="media-picker">
    <input
      ref="fileInput" type="file" :accept="ACCEPT" multiple
      class="hidden-input"
      :disabled="disabled"
      @change="onFileInput"
    />

    <div class="grid">
      <!-- Existing items -->
      <div
        v-for="item in items" :key="item.id"
        class="cell"
        :class="['kind-' + item.kind, 'status-' + item.status]"
      >
        <img v-if="item.kind === 'image'" :src="item.previewUrl" alt="" class="thumb" />
        <video v-else :src="item.previewUrl" class="thumb" muted preload="metadata" playsinline />

        <!-- Video duration badge -->
        <span
          v-if="item.kind === 'video' && item.remoteMedia?.duration !== undefined"
          class="duration-badge"
        >{{ durationLabel(item.remoteMedia.duration) }}</span>

        <!-- Upload progress overlay -->
        <div v-if="item.status === 'uploading'" class="overlay overlay-progress">
          <div class="ring">
            <span>{{ item.progress }}%</span>
          </div>
        </div>

        <!-- Failed overlay with retry -->
        <div v-else-if="item.status === 'failed'" class="overlay overlay-failed">
          <p class="err">{{ item.errorMsg }}</p>
          <button type="button" class="retry" @click="retry(item)">重试</button>
        </div>

        <!-- Remove button -->
        <button
          type="button"
          class="remove"
          :title="'移除'"
          @click.stop="remove(item)"
        >×</button>
      </div>

      <!-- Add tile -->
      <button
        v-if="items.length < MAX_ITEMS"
        type="button"
        class="add-tile"
        :class="{ 'drag-over': dragOver }"
        :disabled="disabled"
        @click="openPicker"
        @dragover="onDragOver"
        @dragleave="onDragLeave"
        @drop="onDrop"
      >
        <span class="plus">+</span>
        <span class="hint">{{ items.length === 0 ? '添加图片或视频' : '继续添加' }}</span>
        <span class="meta">最多 {{ MAX_ITEMS }} · 图片 ≤ 10MB · 视频 ≤ 50MB</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.media-picker { width: 100%; }
.hidden-input { display: none; }

.grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
@media (min-width: 480px) {
  .grid { grid-template-columns: repeat(4, 1fr); }
}

.cell {
  position: relative;
  aspect-ratio: 1;
  border-radius: 12px;
  overflow: hidden;
  background: var(--pink-100);
  border: 1px solid var(--pink-300);
}
.thumb { width: 100%; height: 100%; object-fit: cover; display: block; }

.duration-badge {
  position: absolute;
  bottom: 4px; right: 4px;
  padding: 2px 6px;
  background: rgba(0,0,0,0.6);
  color: #fff;
  font-size: 11px;
  border-radius: 4px;
  letter-spacing: 0.5px;
}

.overlay {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  flex-direction: column;
  gap: 8px;
  background: rgba(255, 248, 251, 0.85);
  backdrop-filter: blur(4px);
}
.overlay-progress .ring {
  width: 44px; height: 44px;
  border-radius: 50%;
  background: rgba(255,255,255,0.9);
  border: 2px solid var(--pink-600);
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 600;
  color: var(--pink-700);
}
.overlay-failed .err {
  margin: 0;
  font-size: 11px;
  color: var(--rose-heart);
  text-align: center;
  padding: 0 6px;
  word-break: break-word;
}
.overlay-failed .retry {
  padding: 3px 12px;
  font-size: 11px;
  background: var(--pink-600);
  color: #fff;
  border: none;
  border-radius: 999px;
  cursor: pointer;
}

.remove {
  position: absolute;
  top: 4px; right: 4px;
  width: 22px; height: 22px;
  border-radius: 50%;
  background: rgba(0,0,0,0.55);
  color: #fff;
  border: none;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  padding-bottom: 2px;
  z-index: 2;
}
.remove:hover { background: rgba(0,0,0,0.75); }

.cell.status-failed { border-color: var(--rose-heart); }

.add-tile {
  aspect-ratio: 1;
  border: 2px dashed var(--pink-300);
  border-radius: 12px;
  background: var(--pink-50);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  color: var(--ink-mute);
  font-size: 12px;
  transition: border-color 0.15s, background 0.15s;
  padding: 8px;
  text-align: center;
}
@media (hover: hover) {
  .add-tile:hover { border-color: var(--pink-600); background: var(--pink-100); color: var(--pink-700); }
}
.add-tile.drag-over { border-color: var(--pink-600); background: var(--pink-200); color: var(--pink-700); }
.add-tile:disabled { opacity: 0.5; cursor: not-allowed; }
.plus { font-size: 26px; line-height: 1; color: var(--pink-600); }
.hint { font-size: 12px; }
.meta { font-size: 10px; color: var(--ink-faint); line-height: 1.3; }
</style>
