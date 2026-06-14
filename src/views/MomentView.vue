<script setup lang="ts">
/**
 * 我们的瞬间 — small everyday moments shared between two.
 *
 * Composer flow:
 *   1. User picks files via MediaPicker (uploads happen in background).
 *   2. User types content (required, ≥ 1 char after trim).
 *   3. On 发布, we wait for any in-flight uploads to finish, collect the
 *      MomentMedia[] from the picker, and POST /moment.
 *   4. Backend returns the created Moment; we prepend it to the feed
 *      optimistically without a refetch.
 *
 * Like animation: 3-glyph cycle (❤️ → 💖 → 💕) + a 6-heart upward burst
 * from the button position, via useHeartBurst.
 */
import { ref, onMounted, watch, computed, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useChatStore } from '@/stores/chat'
import {
  createMoment, getAllMoments, toggleLike, createComment, deleteMoment,
} from '@/api/moment'
import type { Moment } from '@/types'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useHeartBurst } from '@/composables/useHeartBurst'
import MediaPicker from '@/components/MediaPicker.vue'
import MediaGrid from '@/components/MediaGrid.vue'
import Lightbox from '@/components/Lightbox.vue'
import BackToTop from '@/components/BackToTop.vue'
import BackButton from '@/components/BackButton.vue'
import PullToRefresh from '@/components/PullToRefresh.vue'
import { useSettings } from '@/composables/useSettings'

const route = useRoute()
const auth = useAuthStore()
const chat = useChatStore()
const hearts = useHeartBurst()
const settings = useSettings()

const moments = ref<Moment[]>([])
const loading = ref(false)
const highlightedMomentId = ref<number | null>(null)
const newContent = ref('')
const posting = ref(false)
const showCompose = ref(false)
const commentText = ref<Record<number, string>>({})
const showComments = ref<Record<number, boolean>>({})
const likeAnim = ref<Record<number, number>>({})

const mediaPickerRef = ref<InstanceType<typeof MediaPicker> | null>(null)
const pickerHasItems = ref(false)
const pickerHasUploading = ref(false)

// Lightbox state
const lightboxOpen = ref(false)
const lightboxList = ref<Moment['mediaList']>([])
const lightboxIndex = ref(0)

const canPost = computed(() =>
  !posting.value
  && newContent.value.trim().length > 0
  && !pickerHasUploading.value,
)

/**
 * Closing the composer mid-draft would be annoying for the user, so we
 * confirm before discarding non-empty work. "Empty" = no text and no
 * picked media items.
 */
async function handleCancelCompose() {
  const hasDraft = newContent.value.trim().length > 0 || pickerHasItems.value
  if (hasDraft) {
    try {
      await ElMessageBox.confirm('放弃这条瞬间吗？', '提示', {
        confirmButtonText: '放弃',
        cancelButtonText: '继续编辑',
        type: 'warning',
        customClass: 'pink-message-box',
      })
    } catch { return }
  }
  showCompose.value = false
  newContent.value = ''
  mediaPickerRef.value?.reset()
  pickerHasItems.value = false
}

function openCompose() {
  showCompose.value = true
}

onMounted(async () => {
  await fetchMoments()
  const q = typeof route.query.momentId === 'string' ? Number(route.query.momentId) : NaN
  if (Number.isFinite(q)) highlightMoment(q)
})

watch(() => chat.lastEventTime, (t, old) => {
  if (!t || t === old) return
  // Refresh on any moment-shaped change. moment_delete events also drop
  // the deleted row out of /moment/all on the server side.
  if (['moment', 'like', 'comment', 'moment_delete'].includes(chat.lastEventType)) {
    fetchMoments()
  }
})

async function fetchMoments() {
  loading.value = true
  try {
    const res = await getAllMoments()
    moments.value = res.data
  } catch {
    ElMessage.error('瞬间加载失败')
  } finally {
    loading.value = false
  }
}

function onPickerChange(items: { status: string }[]) {
  pickerHasItems.value = items.length > 0
  pickerHasUploading.value = items.some((it) => it.status === 'uploading')
}

async function handlePost() {
  const content = newContent.value.trim()
  if (!content) {
    ElMessage.warning('随便说一句什么吧')
    return
  }
  if (mediaPickerRef.value?.hasUploading()) {
    ElMessage.info('媒体还在上传，等一下')
    return
  }
  if (mediaPickerRef.value?.hasFailed()) {
    ElMessage.warning('有上传失败的项，先重试或移除')
    return
  }

  const mediaList = mediaPickerRef.value?.collectMediaList() ?? []
  posting.value = true

  // Two paths can resolve a successful post:
  //   (A) HTTP response — normal happy path
  //   (B) WS broadcast — backend signals the moment was committed even
  //       if the HTTP response is still trundling back through the wire
  // Whichever arrives first unsticks the UI. The other one is allowed to
  // settle in the background — its result is silently coerced to null so
  // it can never trigger an unhandledrejection warning.
  type HttpOk = { kind: 'http'; moment: Moment }
  type WsOk   = { kind: 'ws' }
  type Fail   = { kind: 'fail'; err: any }

  const httpPromise: Promise<HttpOk | Fail> = createMoment({
    content,
    mediaList: mediaList.length ? mediaList : undefined,
  })
    .then<HttpOk | Fail>((r) => ({ kind: 'http', moment: r.data }))
    .catch((err) => ({ kind: 'fail', err }))

  // Holder pattern — TS 5's narrow-on-assignment inside the Promise
  // constructor infers `let unwatch: ... | null` as `never` in the
  // outer scope. Wrapping it in an object sidesteps the analysis.
  const wsHandle: { stop: (() => void) | null } = { stop: null }
  const wsPromise: Promise<WsOk> = new Promise<WsOk>((resolve) => {
    wsHandle.stop = chat.onEvent((msg) => {
      if (msg.type === 'moment' && msg.data?.userId === auth.currentUser?.id) {
        resolve({ kind: 'ws' })
      }
    })
  })

  try {
    const first = await Promise.race([httpPromise, wsPromise])

    if (first.kind === 'http') {
      moments.value.unshift(first.moment)
    } else if (first.kind === 'ws') {
      // HTTP still in flight; rely on the feed refetch to materialize
      // the new row. Don't wait for HTTP — it'll settle on its own.
      await fetchMoments()
    } else {
      // first === 'fail': HTTP errored before WS could rescue. Wait up
      // to 5 more seconds for the WS event in case the server actually
      // committed the row but the HTTP response was lost.
      const rescued = await Promise.race([
        wsPromise.then(() => true),
        new Promise<boolean>((r) => setTimeout(() => r(false), 5000)),
      ])
      if (rescued) {
        await fetchMoments()
      } else {
        ElMessage.error(first.err?.msg || '发布失败')
        return // skip the success-path cleanup below
      }
    }

    ElMessage.success('记下来了')
    newContent.value = ''
    mediaPickerRef.value?.reset()
    pickerHasItems.value = false
    showCompose.value = false
  } finally {
    wsHandle.stop?.()
    posting.value = false
  }
}

async function handleLike(moment: Moment, ev: MouseEvent) {
  const btn = ev.currentTarget as HTMLElement
  try {
    const res = await toggleLike(moment.id)
    if (res.data) {
      moment.likeCount++
      if (auth.currentUser) {
        moment.likes.push({
          id: Date.now(), momentId: moment.id,
          userId: auth.currentUser.id, userName: auth.currentUser.name,
          createTime: new Date().toISOString(),
        })
      }
      likeAnim.value[moment.id] = (likeAnim.value[moment.id] || 0) + 1
      hearts.burstFrom(btn, 6)
      const stamp = likeAnim.value[moment.id]
      setTimeout(() => {
        if (likeAnim.value[moment.id] === stamp) delete likeAnim.value[moment.id]
      }, 700)
    } else {
      moment.likeCount = Math.max(0, moment.likeCount - 1)
      if (auth.currentUser) {
        moment.likes = moment.likes.filter(l => l.userId !== auth.currentUser!.id)
      }
    }
  } catch {
    ElMessage.error('操作失败')
  }
}

function isLiked(moment: Moment): boolean {
  return auth.currentUser ? moment.likes.some(l => l.userId === auth.currentUser!.id) : false
}
function isOwned(moment: Moment): boolean {
  return auth.currentUser?.id === moment.userId
}

async function handleComment(moment: Moment) {
  const text = (commentText.value[moment.id] || '').trim()
  if (!text) return
  try {
    await createComment(moment.id, { content: text })
    commentText.value[moment.id] = ''
    await fetchMoments()
  } catch {
    ElMessage.error('评论失败')
  }
}

function toggleCommentArea(momentId: number) {
  showComments.value[momentId] = !showComments.value[momentId]
}

function openLightbox(moment: Moment, idx: number) {
  lightboxList.value = moment.mediaList
  lightboxIndex.value = idx
  lightboxOpen.value = true
}

async function highlightMoment(id: number) {
  highlightedMomentId.value = id
  await nextTick()
  const el = document.getElementById('moment-' + id)
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  setTimeout(() => {
    if (highlightedMomentId.value === id) highlightedMomentId.value = null
  }, 1800)
}

/**
 * Delete one of my own moments. Two-step confirmation because this is
 * a one-way action from the user's perspective even though the server
 * keeps the row (soft-delete).
 *
 * Optimistic UI: drop the row immediately, restore on failure. The
 * common error path is "backend hasn't shipped DELETE yet" → surfaces
 * a friendly hint.
 */
async function handleDelete(moment: Moment) {
  if (moment.userId !== auth.currentUser?.id) return // defensive

  if (settings.value.confirmDelete) {
    try {
      await ElMessageBox.confirm('确定要删除这条瞬间吗？', '删除', {
        confirmButtonText: '删除',
        cancelButtonText: '再想想',
        type: 'warning',
        customClass: 'pink-message-box',
        confirmButtonClass: 'el-button--danger',
      })
    } catch {
      return // user clicked 再想想
    }
  }

  // Optimistic remove
  const idx = moments.value.findIndex((m) => m.id === moment.id)
  if (idx === -1) return
  const removed = moments.value.splice(idx, 1)[0]

  try {
    await deleteMoment(moment.id)
    ElMessage.success('已删除')
  } catch (e: any) {
    // Restore on failure
    moments.value.splice(idx, 0, removed)
    const status = e?.code ?? e?.response?.status
    if (status === 405 || status === 404) {
      // Endpoint not yet implemented on the server
      ElMessage.warning('删除功能还没准备好（后端 DELETE /moment 接口尚未上线）')
    } else if (status === 403) {
      ElMessage.error('只能删除自己发的瞬间')
    } else {
      ElMessage.error(e?.msg || '删除失败')
    }
  }
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr)
  const now = new Date()
  if (now.getTime() - d.getTime() < 86400000 && now.getDate() === d.getDate()) {
    return '今天 ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <div class="moment-page">
    <PullToRefresh @refresh="fetchMoments" />
    <header class="page-head">
      <BackButton class="page-back" />
      <h1 class="title font-serif">我们的瞬间</h1>
      <p class="subtitle">记录每一个小确幸</p>
      <button class="btn-romance new-btn" @click="openCompose">写一条瞬间 +</button>
    </header>

    <div v-loading="loading" class="moment-list">
      <p v-if="!loading && moments.length === 0" class="empty">
        还没有瞬间。<br />分享第一件让你开心的小事吧。
      </p>

      <article
        v-for="m in moments"
        :id="'moment-' + m.id"
        :key="m.id"
        class="moment-card"
        :class="{ highlight: highlightedMomentId === m.id }"
      >
        <div class="moment-top">
          <span class="user-name">{{ m.userName }}</span>
          <span class="moment-date">{{ formatDate(m.createTime) }}</span>
          <!-- Owner-only menu in top-right corner. Element Plus dropdown
               handles the click-outside-to-close + keyboard a11y bits. -->
          <el-dropdown
            v-if="isOwned(m)"
            trigger="click"
            placement="bottom-end"
            class="moment-menu"
          >
            <button class="menu-btn" type="button" aria-label="更多">⋮</button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="handleDelete(m)">
                  <span class="danger-item">删除</span>
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
        <p class="moment-content">{{ m.content }}</p>

        <MediaGrid
          v-if="m.mediaList && m.mediaList.length"
          :list="m.mediaList"
          @open-lightbox="(idx: number) => openLightbox(m, idx)"
        />

        <div class="actions">
          <button
            class="action-btn like-btn"
            :class="{ liked: isLiked(m), disabled: isOwned(m), 'just-liked': likeAnim[m.id] }"
            :disabled="isOwned(m)"
            :title="isOwned(m) ? '不能给自己点赞呀' : ''"
            @click="(e: MouseEvent) => handleLike(m, e)"
          >
            <span class="like-glyph">
              <span class="g g1">❤️</span>
              <span class="g g2">💖</span>
              <span class="g g3">💕</span>
            </span>
            <span class="like-count" v-if="m.likeCount > 0">{{ m.likeCount }}</span>
          </button>
          <button class="action-btn" @click="toggleCommentArea(m.id)">
            💬<span v-if="m.comments.length > 0" class="cnum">{{ m.comments.length }}</span>
          </button>
        </div>

        <div v-if="showComments[m.id] || m.comments.length > 0" class="comments-section">
          <div v-for="c in m.comments" :key="c.id" class="comment-item">
            <span class="comment-user">{{ c.userName }}</span>
            <span class="comment-text">{{ c.content }}</span>
          </div>
          <div v-if="showComments[m.id]" class="comment-input-row">
            <el-input
              v-model="commentText[m.id]" size="small"
              placeholder="说点什么…"
              @keyup.enter="handleComment(m)"
            />
            <el-button size="small" type="primary" @click="handleComment(m)">发送</el-button>
          </div>
        </div>
      </article>
    </div>

    <Lightbox
      v-model="lightboxOpen"
      :list="lightboxList"
      :index="lightboxIndex"
    />

    <BackToTop />

    <!-- Compose dialog. Phone gets the global fullscreen treatment via
         style.css; desktop sees a centered 560px modal. -->
    <el-dialog
      v-model="showCompose"
      width="560px"
      :close-on-click-modal="false"
      :show-close="false"
      :before-close="() => { handleCancelCompose() }"
      class="compose-dialog"
    >
      <template #header>
        <div class="compose-head">
          <button type="button" class="head-btn" :disabled="posting" @click="handleCancelCompose">取消</button>
          <span class="head-title">写一条瞬间</span>
          <button
            type="button"
            class="head-btn primary"
            :disabled="!canPost"
            @click="handlePost"
          >{{ posting ? '发布中…' : '发布' }}</button>
        </div>
      </template>

      <div class="compose-body">
        <el-input
          v-model="newContent"
          type="textarea"
          :autosize="{ minRows: 4, maxRows: 8 }"
          maxlength="500"
          show-word-limit
          placeholder="今天发生了什么有意思的事？"
          class="compose-textarea"
        />
        <div class="picker-wrap">
          <MediaPicker
            ref="mediaPickerRef"
            :disabled="posting"
            @change="onPickerChange"
          />
        </div>
        <p v-if="pickerHasUploading" class="hint">媒体上传中…</p>
      </div>
    </el-dialog>
  </div>
</template>

<style scoped>
.moment-page {
  max-width: 640px;
  margin: 0 auto;
  padding: var(--space-page-y) var(--space-page-x);
  padding-bottom: calc(var(--space-page-y) + var(--tab-bar-height));
}

.page-head { text-align: center; margin-bottom: 28px; position: relative; }
.title { font-size: 32px; font-weight: 600; color: var(--ink-warm); margin: 0 0 4px; letter-spacing: 4px; }
.subtitle { font-size: 13px; color: var(--ink-mute); margin: 0 0 16px; }
.new-btn { padding: 10px 22px; font-size: 14px; }

/* === Compose dialog === */
:global(.compose-dialog .el-dialog__header) {
  padding: 0;
  margin-right: 0;
  border-bottom: 1px solid var(--pink-300);
}
:global(.compose-dialog .el-dialog__body) {
  padding: 18px 20px 20px;
}
.compose-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px;
}
.head-title { font-size: 15px; font-weight: 500; color: var(--ink-warm); }
.head-btn {
  background: none; border: none;
  padding: 6px 12px;
  font-size: 14px;
  color: var(--ink-soft);
  cursor: pointer;
  border-radius: 8px;
  min-height: 36px;
}
.head-btn:disabled { opacity: 0.4; cursor: not-allowed; }
@media (hover: hover) {
  .head-btn:hover:not(:disabled) { background: var(--pink-200); color: var(--pink-700); }
}
.head-btn.primary {
  color: var(--pink-700);
  font-weight: 600;
}

.compose-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.compose-textarea :deep(.el-textarea__inner) {
  border-radius: 12px;
  resize: none;
}
.picker-wrap { /* spacing handled by gap */ }
.hint { margin: 0; font-size: 12px; color: var(--ink-mute); text-align: right; }

.empty {
  text-align: center; padding: 80px 0;
  color: var(--ink-mute); font-size: 14px; line-height: 2;
}

.moment-card {
  background: #fff;
  border-radius: 18px;
  padding: 20px 24px;
  margin-bottom: 16px;
  border: 1px solid var(--pink-300);
  box-shadow: 0 4px 16px rgba(255,126,182,0.06);
  transition: box-shadow 0.2s, transform 0.2s;
  animation: fade-up 0.4s ease;
  scroll-margin-top: 80px;
}
.moment-card.highlight {
  box-shadow: 0 0 0 3px var(--pink-600), 0 12px 32px rgba(255,77,109,0.22);
  transform: translateY(-2px);
}
@media (hover: hover) {
  .moment-card:hover { box-shadow: 0 8px 24px rgba(255,126,182,0.12); }
}

.moment-top {
  display: flex; align-items: baseline; gap: 12px;
  margin-bottom: 10px;
}
.user-name { font-weight: 600; font-size: 15px; color: var(--pink-700); }
.moment-date { font-size: 12px; color: var(--ink-mute); }

.moment-menu { margin-left: auto; }
.menu-btn {
  width: 28px; height: 28px;
  border: none; background: transparent;
  color: var(--ink-mute);
  font-size: 20px; line-height: 1;
  cursor: pointer;
  border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  padding-bottom: 4px;
  transition: background 0.15s, color 0.15s;
}
@media (hover: hover) {
  .menu-btn:hover { background: var(--pink-200); color: var(--pink-700); }
}
.danger-item { color: var(--rose-heart); }

.moment-content {
  font-size: 15px;
  color: var(--ink-warm);
  line-height: 1.7;
  margin: 0 0 4px;
  white-space: pre-wrap;
  word-break: break-word;
}

.actions {
  display: flex; gap: 16px;
  border-top: 1px dashed var(--pink-300);
  padding-top: 10px; margin-top: 8px;
}
.action-btn {
  display: inline-flex; align-items: center; gap: 6px;
  background: none; border: none; cursor: pointer;
  color: var(--ink-soft); font-size: 14px;
  padding: 4px 10px; border-radius: 999px;
  transition: all 0.2s;
}
@media (hover: hover) {
  .action-btn:hover:not(:disabled) { background: var(--pink-200); color: var(--pink-700); }
}
.action-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.cnum { font-size: 13px; }

/* === Like button: three-glyph crossfade === */
.like-glyph {
  position: relative;
  display: inline-block;
  width: 18px; height: 18px;
  font-size: 16px; line-height: 18px;
  text-align: center;
}
.like-glyph .g {
  position: absolute; inset: 0;
  opacity: 0; transition: opacity 0.15s;
  transform-origin: center;
}
.like-btn .g1 { opacity: 0; }
.like-btn:not(.liked) .like-glyph::before {
  content: '🤍';
  position: absolute; inset: 0;
  filter: grayscale(0.4);
}
.like-btn.liked .g1 { opacity: 1; }
.like-btn.just-liked .g1 { animation: cyc1 0.6s ease both; }
.like-btn.just-liked .g2 { animation: cyc2 0.6s ease both; }
.like-btn.just-liked .g3 { animation: cyc3 0.6s ease both; }

@keyframes cyc1 { 0%,33% { opacity: 1; transform: scale(1.4); } 34%,100% { opacity: 0; } }
@keyframes cyc2 { 0%,33% { opacity: 0; } 34%,66% { opacity: 1; transform: scale(1.5); } 67%,100% { opacity: 0; } }
@keyframes cyc3 {
  0%,66% { opacity: 0; }
  67%,99% { opacity: 1; transform: scale(1.3); }
  100% { opacity: 1; transform: scale(1); }
}

.like-count { font-size: 13px; color: var(--ink-soft); }
.like-btn.liked .like-count { color: var(--rose-heart); font-weight: 600; }

.comments-section {
  margin-top: 10px; padding-top: 10px;
  border-top: 1px dashed var(--pink-300);
}
.comment-item {
  padding: 4px 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--ink-soft);
}
.comment-user { font-weight: 600; color: var(--pink-700); margin-right: 6px; }

.comment-input-row { display: flex; gap: 8px; margin-top: 8px; }

@media (max-width: 960px) {
  .title { font-size: 26px; letter-spacing: 3px; }
  .moment-card { padding: 16px 18px; }
  .moment-content { font-size: 14px; }
}
</style>
