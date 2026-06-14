<script setup lang="ts">
/**
 * 发现 — secondary entry hub.
 *
 * Mirrors WeChat's "发现" tab: this page itself is light, mostly serving
 * as a launching pad for things that aren't part of the daily writing
 * flow. Two row entries today (瞬间 / 时间轴), room to grow later.
 */
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useMessagesStore } from '@/stores/messages'

const router = useRouter()
const messages = useMessagesStore()

interface Row {
  to: string
  emoji: string
  title: string
  hint: string
  /** Optional unread count badge. */
  unread?: () => number
}
const rows = computed<Row[]>(() => [
  { to: '/discover/moment',   emoji: '📷', title: '我们的瞬间', hint: '记录每一个小确幸' },
  { to: '/discover/message',  emoji: '💌', title: '漂流瓶',     hint: '把现在的话扔进时间的海里', unread: () => messages.unreadCount },
  { to: '/discover/timeline', emoji: '🕰️', title: '时间轴',     hint: '把那些日子串起来' },
])

function go(to: string) { router.push(to) }
</script>

<template>
  <div class="discover-page">
    <header class="page-head">
      <h1 class="title font-serif">翻翻</h1>
      <p class="subtitle">那些没有每天看的小角落</p>
    </header>

    <div class="rows">
      <button
        v-for="row in rows" :key="row.to"
        class="row" type="button"
        @click="go(row.to)"
      >
        <span class="row-emoji">{{ row.emoji }}</span>
        <div class="row-text">
          <strong>{{ row.title }}</strong>
          <em>{{ row.hint }}</em>
        </div>
        <span v-if="row.unread && row.unread() > 0" class="row-badge">{{ row.unread() }}</span>
        <span class="chev">›</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.discover-page {
  max-width: 720px;
  margin: 0 auto;
  padding: var(--space-page-y) var(--space-page-x);
  padding-bottom: calc(var(--space-page-y) + var(--tab-bar-height));
}
.page-head { text-align: center; margin-bottom: 22px; }
.title { font-size: 28px; font-weight: 600; color: var(--ink-warm); letter-spacing: 4px; margin: 0 0 4px; }
.subtitle { font-size: 13px; color: var(--ink-mute); margin: 0; }

.rows {
  background: #fff;
  border-radius: 18px;
  border: 1px solid var(--pink-300);
  overflow: hidden;
  box-shadow: 0 4px 16px rgba(255,126,182,0.06);
}
.row {
  display: flex; align-items: center; gap: 14px;
  width: 100%;
  background: transparent; border: none;
  padding: 16px 18px;
  text-align: left;
  cursor: pointer;
  border-bottom: 1px solid var(--pink-200);
}
.row:last-child { border-bottom: none; }
@media (hover: hover) { .row:hover { background: var(--pink-50); } }
.row-emoji { font-size: 22px; flex-shrink: 0; }
.row-text { flex: 1; min-width: 0; }
.row-text strong { display: block; color: var(--ink-warm); font-size: 15px; }
.row-text em { display: block; font-style: normal; color: var(--ink-mute); font-size: 12px; margin-top: 2px; }
.row-badge {
  min-width: 18px; height: 18px; padding: 0 6px;
  border-radius: 999px;
  background: var(--rose-heart);
  color: #fff;
  font-size: 11px; font-weight: 600; line-height: 18px;
  text-align: center;
  margin-right: 4px;
}
.chev { color: var(--ink-mute); font-size: 22px; line-height: 1; }
</style>
