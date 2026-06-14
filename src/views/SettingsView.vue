<script setup lang="ts">
import { ref, watch } from 'vue'
import BackButton from '@/components/BackButton.vue'
import { useSettings, resetSettings, type HeartIntensity } from '@/composables/useSettings'
import { ElMessage, ElMessageBox } from 'element-plus'

const settings = useSettings()
const justSaved = ref(false)
let saveTimer: ReturnType<typeof setTimeout> | null = null

const HEART_LABELS: Record<HeartIntensity, string> = {
  off: '关闭',
  subtle: '克制',
  normal: '默认',
  lavish: '热烈',
}
const HEART_OPTIONS: HeartIntensity[] = ['off', 'subtle', 'normal', 'lavish']

watch(settings, () => {
  justSaved.value = true
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => { justSaved.value = false }, 1200)
}, { deep: true })

async function clearOfflineCache() {
  try {
    await ElMessageBox.confirm('清空本地缓存？这不会删除任何日记、瞬间或漂流瓶。', '清空本地缓存', {
      confirmButtonText: '清空',
      cancelButtonText: '取消',
      type: 'warning',
      customClass: 'pink-message-box',
    })
  } catch { return }
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i)
    if (k && (k.startsWith('to-my-l:') || k.startsWith('tml:settings'))) localStorage.removeItem(k)
  }
  ElMessage.success('已清空')
}

async function doResetSettings() {
  try {
    await ElMessageBox.confirm('把所有设置恢复默认？', '重置设置', {
      confirmButtonText: '重置',
      cancelButtonText: '取消',
      type: 'warning',
      customClass: 'pink-message-box',
    })
  } catch { return }
  resetSettings()
  ElMessage.success('已恢复默认')
}
</script>

<template>
  <div class="settings-page">
    <header class="page-head">
      <BackButton to="/mine" label="我的" />
      <h1 class="title font-serif">设置</h1>
      <span v-if="justSaved" class="saved-tip">已保存</span>
    </header>

    <section class="card">
      <h2>爱心特效</h2>
      <p class="desc">控制点赞、特殊日期、聊天心动时的飘心强度。</p>
      <div class="seg">
        <button v-for="opt in HEART_OPTIONS" :key="opt" :class="{ active: settings.heartIntensity === opt }" @click="settings.heartIntensity = opt">
          {{ HEART_LABELS[opt] }}
        </button>
      </div>
    </section>

    <section class="card">
      <h2>站内提醒</h2>
      <label class="row"><span>新日记</span><el-switch v-model="settings.toastNewDiary" /></label>
      <label class="row"><span>新瞬间 / 点赞 / 评论</span><el-switch v-model="settings.toastNewMoment" /></label>
      <label class="row"><span>新漂流瓶</span><el-switch v-model="settings.toastNewMessage" /></label>
      <label class="row"><span>已读回执</span><el-switch v-model="settings.toastReadReceipt" /></label>
      <label class="row"><span>上线 / 离线</span><el-switch v-model="settings.toastPresence" /></label>
    </section>

    <section class="card">
      <h2>写作与确认</h2>
      <label class="row"><span>删除前先确认</span><el-switch v-model="settings.confirmDelete" /></label>
      <div class="setting-block">
        <p class="desc">日记本默认打开范围</p>
        <div class="seg">
          <button :class="{ active: settings.diaryDefaultScope === 'all' }" @click="settings.diaryDefaultScope = 'all'">全部</button>
          <button :class="{ active: settings.diaryDefaultScope === 'mine' }" @click="settings.diaryDefaultScope = 'mine'">只看我的</button>
        </div>
      </div>
      <label class="row"><span>特殊日期提示与爱心雨</span><el-switch v-model="settings.showSpecialDateHint" /></label>
    </section>

    <section class="card danger-zone">
      <h2>维护</h2>
      <button class="row-btn" @click="clearOfflineCache">清空本地缓存</button>
      <button class="row-btn" @click="doResetSettings">恢复默认设置</button>
    </section>
  </div>
</template>

<style scoped>
.settings-page {
  max-width: 680px;
  margin: 0 auto;
  padding: var(--space-page-y) var(--space-page-x);
  padding-bottom: calc(var(--space-page-y) + var(--tab-bar-height));
}
.page-head { position: relative; text-align: center; margin-bottom: 22px; }
.title { margin: 0; color: var(--ink-warm); font-size: 28px; letter-spacing: 4px; }
.saved-tip { display: inline-block; margin-top: 8px; color: var(--pink-700); font-size: 12px; }
.card {
  background: #fff;
  border: 1px solid var(--pink-300);
  border-radius: 18px;
  padding: 18px 20px;
  margin-bottom: 14px;
  box-shadow: 0 4px 16px rgba(255,126,182,0.06);
}
.card h2 { margin: 0 0 12px; color: var(--ink-warm); font-family: var(--font-serif); font-size: 16px; }
.desc { margin: 0 0 10px; color: var(--ink-mute); font-size: 13px; line-height: 1.7; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 10px 0; border-top: 1px dashed var(--pink-300); color: var(--ink-soft); font-size: 14px; }
.row:first-of-type { border-top: none; }
.seg { display: flex; flex-wrap: wrap; gap: 8px; }
.seg button { min-height: 36px; padding: 6px 16px; border-radius: 999px; border: 1px solid var(--pink-300); background: transparent; color: var(--ink-soft); cursor: pointer; }
.seg button.active { background: linear-gradient(135deg, var(--pink-600), var(--rose-heart)); border-color: transparent; color: #fff; }
.setting-block { padding: 10px 0; border-top: 1px dashed var(--pink-300); }
.row-btn { width: 100%; min-height: 44px; text-align: left; background: transparent; border: none; border-top: 1px dashed var(--pink-300); color: var(--ink-warm); cursor: pointer; }
.row-btn:first-of-type { border-top: none; }
@media (max-width: 600px) { .title { font-size: 24px; } }
</style>
