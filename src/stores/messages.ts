/**
 * Single source of truth for messages (漂流瓶).
 *
 * MessageView uses cursor pagination. HomeView still reads the most recent
 * received letter from this store; the first received page is enough for
 * that, and refreshLatest() can cheaply update it after WS events.
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  getReceivedMessages,
  getSentMessages,
  getReceivedMessagesPage,
  getSentMessagesPage,
  markRead as apiMarkRead,
} from '@/api/message'
import type { Message } from '@/types'

const PAGE_SIZE = 20

export const useMessagesStore = defineStore('messages', () => {
  const received = ref<Message[]>([])
  const sent = ref<Message[]>([])
  const loading = ref(false)
  const loadingReceived = ref(false)
  const loadingSent = ref(false)
  const receivedCursor = ref<string | null>(null)
  const receivedCursorId = ref<number | null>(null)
  const sentCursor = ref<string | null>(null)
  const sentCursorId = ref<number | null>(null)
  const receivedHasMore = ref(true)
  const sentHasMore = ref(true)
  /** Ids currently visually expanded. Independent from isRead. */
  const expandedIds = ref<Set<number>>(new Set())

  const sortedReceived = computed(() => received.value)
  const sortedSent = computed(() => sent.value)
  const unreadCount = computed(() => received.value.filter(m => !m.isRead).length)
  const latestReceived = computed<Message | null>(() => received.value[0] || null)

  function isExpanded(m: Message): boolean { return expandedIds.value.has(m.id) }

  function dedupeAppend(target: Message[], list: Message[]) {
    const ids = new Set(target.map((m) => m.id))
    for (const m of list) if (!ids.has(m.id)) target.push(m)
  }

  /** Legacy full refresh — kept for HomeView / compatibility. */
  async function refresh() {
    loading.value = true
    try {
      const [r, s] = await Promise.all([getReceivedMessages(), getSentMessages()])
      received.value = r.data.sort(sortMessageDesc)
      sent.value = s.data.sort(sortMessageDesc)
      // This full refresh has all data, so no more pages for current store
      receivedHasMore.value = false
      sentHasMore.value = false
      receivedCursor.value = null
      receivedCursorId.value = null
      sentCursor.value = null
      sentCursorId.value = null
    } catch {
      // silent
    } finally {
      loading.value = false
    }
  }

  /** Cheap first-page refresh for "latest letter" and unread badges. */
  async function refreshLatest() {
    try {
      const [r, s] = await Promise.all([
        getReceivedMessagesPage({ size: PAGE_SIZE }),
        getSentMessagesPage({ size: PAGE_SIZE }),
      ])
      received.value = r.data.list
      sent.value = s.data.list
      receivedCursor.value = r.data.nextCursor
      receivedCursorId.value = r.data.nextCursorId ?? null
      sentCursor.value = s.data.nextCursor
      sentCursorId.value = s.data.nextCursorId ?? null
      receivedHasMore.value = r.data.hasMore
      sentHasMore.value = s.data.hasMore
    } catch {
      // fallback to old endpoints if backend pagination isn't up yet
      await refresh()
    }
  }

  async function resetReceived() {
    received.value = []
    receivedCursor.value = null
    receivedCursorId.value = null
    receivedHasMore.value = true
    await loadMoreReceived()
  }
  async function resetSent() {
    sent.value = []
    sentCursor.value = null
    sentCursorId.value = null
    sentHasMore.value = true
    await loadMoreSent()
  }

  async function loadMoreReceived() {
    if (loadingReceived.value || !receivedHasMore.value) return
    loadingReceived.value = true
    try {
      const res = await getReceivedMessagesPage({ cursor: receivedCursor.value, cursorId: receivedCursorId.value, size: PAGE_SIZE })
      dedupeAppend(received.value, res.data.list)
      receivedCursor.value = res.data.nextCursor
      receivedCursorId.value = res.data.nextCursorId ?? null
      receivedHasMore.value = res.data.hasMore
    } finally {
      loadingReceived.value = false
    }
  }

  async function loadMoreSent() {
    if (loadingSent.value || !sentHasMore.value) return
    loadingSent.value = true
    try {
      const res = await getSentMessagesPage({ cursor: sentCursor.value, cursorId: sentCursorId.value, size: PAGE_SIZE })
      dedupeAppend(sent.value, res.data.list)
      sentCursor.value = res.data.nextCursor
      sentCursorId.value = res.data.nextCursorId ?? null
      sentHasMore.value = res.data.hasMore
    } finally {
      loadingSent.value = false
    }
  }

  /** Toggle visual expansion; first expansion marks unread as read. */
  async function toggle(m: Message) {
    const next = new Set(expandedIds.value)
    if (next.has(m.id)) {
      next.delete(m.id)
      expandedIds.value = next
      return
    }
    next.add(m.id)
    expandedIds.value = next
    if (m.isRead) return
    try {
      await apiMarkRead(m.id)
      m.isRead = 1
    } catch {
      const revert = new Set(expandedIds.value)
      revert.delete(m.id)
      expandedIds.value = revert
    }
  }

  function sortMessageDesc(a: Message, b: Message) {
    const t = new Date(b.createTime).getTime() - new Date(a.createTime).getTime()
    if (t !== 0) return t
    return b.id - a.id
  }

  return {
    received, sent, loading,
    loadingReceived, loadingSent,
    receivedHasMore, sentHasMore,
    expandedIds,
    sortedReceived, sortedSent, unreadCount, latestReceived,
    isExpanded,
    refresh, refreshLatest,
    resetReceived, resetSent,
    loadMoreReceived, loadMoreSent,
    toggle,
  }
})
