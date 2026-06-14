<script setup lang="ts">
/**
 * 我的 — profile, settings, and project hub.
 *
 * Layout shape (intentionally not a uniform grid):
 *   - Hero with avatar + day count
 *   - "Stat strip" of three numbers (diary days / moments / messages)
 *   - Two-up identity cards: 我 / 对方 (separate cards so they have
 *     individual visual weight, not just rows in a table)
 *   - Settings (heart intensity, per-type toasts, delete confirm,
 *     diary default scope, special-date hint)
 *   - About + version + API + a logout button
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useChatStore } from '@/stores/chat'
import { getUser, updateMyProfile } from '@/api/user'
import { getPartnerDisplayName, SINCE_DATE } from '@/constants/user'
import { daysSince, useSpecialDate } from '@/composables/useSpecialDate'
import { API_BASE } from '@/api/client'
import type { User } from '@/types'
import { ElMessage } from 'element-plus'

const router = useRouter()
const auth = useAuthStore()
const chat = useChatStore()
const special = useSpecialDate()

const partner = ref<User | null>(null)
const partnerLoading = ref(false)

const me = computed(() => auth.currentUser)
const partnerName = computed(() => me.value?.id ? getPartnerDisplayName(me.value.id) : '')
const sinceDisplay = SINCE_DATE.replace(/-/g, '.')
const dayCount = computed(() => daysSince())

onMounted(async () => {
  if (!me.value) return
  partnerLoading.value = true
  try {
    const partnerId = me.value.id === 1 ? 2 : 1
    const res = await getUser(partnerId)
    partner.value = res.data
  } catch {
    // silent — fallback uses partnerName from constants
  } finally {
    partnerLoading.value = false
  }
})

function genderLabel(g: number | undefined): string {
  if (g === 1) return '男'
  if (g === 0) return '女'
  return '—'
}

/** Days until next birthday for a user. Returns null if no birthday. */
function daysUntilBirthday(birthday: string | undefined): number | null {
  if (!birthday) return null
  const [, m, d] = birthday.split('-').map(Number)
  if (!m || !d) return null
  const now = new Date()
  const thisYear = new Date(now.getFullYear(), m - 1, d)
  const target = thisYear.getTime() < new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    ? new Date(now.getFullYear() + 1, m - 1, d)
    : thisYear
  return Math.ceil((target.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86_400_000)
}

function formatBirthday(b: string | undefined): string {
  if (!b) return '—'
  const [y, m, d] = b.split('-')
  return `${y} 年 ${m} 月 ${d} 日`
}

const meBirthdayCountdown = computed(() => daysUntilBirthday(me.value?.birthday))
const partnerBirthdayCountdown = computed(() => daysUntilBirthday(partner.value?.birthday))

// === Edit profile dialog ===
const showEdit = ref(false)
const saving = ref(false)
interface EditForm {
  name: string
  gender: number
  birthday: string
}
const editForm = reactive<EditForm>({ name: '', gender: 0, birthday: '' })

function openEdit() {
  if (!me.value) return
  editForm.name = me.value.name ?? ''
  editForm.gender = me.value.gender ?? 0
  editForm.birthday = me.value.birthday ?? ''
  showEdit.value = true
}

async function saveProfile() {
  if (!editForm.name.trim()) {
    ElMessage.warning('名字不能为空')
    return
  }
  saving.value = true
  try {
    const res = await updateMyProfile({
      name: editForm.name.trim(),
      gender: editForm.gender,
      birthday: editForm.birthday || undefined,
    })
    if (res.data && auth.currentUser) {
      // Patch the in-memory user. Don't replace the whole object so other
      // bound refs (lastSeenAt etc.) survive.
      auth.currentUser.name = res.data.name
      auth.currentUser.gender = res.data.gender
      auth.currentUser.birthday = res.data.birthday
      auth.currentUser.age = res.data.age
    }
    ElMessage.success('保存成功')
    showEdit.value = false
  } catch (e: any) {
    const status = e?.code ?? e?.response?.status
    if (status === 404 || status === 405) {
      ElMessage.warning('修改资料还没准备好（后端 PUT /user/me 接口尚未上线）')
    } else {
      ElMessage.error(e?.msg || '保存失败')
    }
  } finally {
    saving.value = false
  }
}

function logout() {
  chat.disconnect()
  auth.logout()
  router.push('/login')
}
</script>

<template>
  <div class="mine-page selectable-content">
    <!-- Hero -->
    <section class="hero">
      <div class="avatar">{{ me?.name?.slice(0, 1) || '我' }}</div>
      <div class="hero-text">
        <p class="eyebrow font-script">To My L</p>
        <h1>{{ me?.name || '我' }}</h1>
        <p class="hero-sub">和 {{ partnerName }} 认识的第 <strong>{{ dayCount }}</strong> 天</p>
        <p v-if="special.isSpecial.value" class="hero-tag">✨ 今天{{ special.note.value }}</p>
      </div>
    </section>

    <!-- Identity: two cards side-by-side -->
    <section class="people">
      <article class="person me-card">
        <header>
          <span class="role">我</span>
          <span v-if="meBirthdayCountdown !== null" class="countdown">
            生日还有 {{ meBirthdayCountdown }} 天
          </span>
          <button class="edit-btn" type="button" aria-label="编辑" @click="openEdit">✎</button>
        </header>
        <h2>{{ me?.name }}</h2>
        <p class="line"><span>账号</span><strong>{{ me?.username }}</strong></p>
        <p class="line"><span>性别</span><strong>{{ genderLabel(me?.gender) }}</strong></p>
        <p class="line"><span>生日</span><strong>{{ formatBirthday(me?.birthday) }}</strong></p>
        <p class="line"><span>年龄</span><strong>{{ me?.age ?? '—' }}</strong></p>
      </article>

      <article class="person partner-card" v-loading="partnerLoading">
        <header>
          <span class="role">对方</span>
          <span class="presence" :class="{ on: chat.partnerOnline }">
            {{ chat.partnerOnline ? '在线' : '离线' }}
          </span>
        </header>
        <h2>{{ partner?.name || partnerName }}</h2>
        <p class="line"><span>账号</span><strong>{{ partner?.username || '—' }}</strong></p>
        <p class="line"><span>性别</span><strong>{{ genderLabel(partner?.gender) }}</strong></p>
        <p class="line"><span>生日</span><strong>{{ formatBirthday(partner?.birthday) }}</strong></p>
        <p class="line"><span>距生日</span>
          <strong v-if="partnerBirthdayCountdown !== null">{{ partnerBirthdayCountdown }} 天</strong>
          <strong v-else>—</strong>
        </p>
      </article>
    </section>

    <!-- Anchor card -->
    <section class="anchor">
      <p class="anchor-line font-serif">
        从 <span>{{ sinceDisplay }}</span> 起，
        这里安静地记录着每一天。
      </p>
    </section>

    <!-- Settings entry -->
    <button
      type="button"
      class="settings-entry"
      @click="router.push('/mine/settings')"
    >
      <span class="se-icon">⚙</span>
      <span class="se-text">
        <strong>设置</strong>
        <em>通知、爱心特效、删除确认、本地缓存</em>
      </span>
      <span class="se-chev">›</span>
    </button>

    <!-- About -->
    <section class="card about-card">
      <h2>关于</h2>
      <p>这是一个把暗恋认真保存下来的小项目。</p>
      <p class="muted-text">它不是社交平台，也不是后台系统。它只是把一些日子、一些话、一些瞬间，安静地放在这里。</p>
      <p class="meta-line"><span>API</span><strong>{{ API_BASE }}</strong></p>
    </section>

    <button class="logout" @click="logout">退出登录</button>

    <!-- Edit profile dialog -->
    <el-dialog
      v-model="showEdit"
      width="460px"
      :close-on-click-modal="false"
      :show-close="!saving"
      title="编辑基础信息"
    >
      <div class="edit-body">
        <label class="field">
          <span>名字</span>
          <input v-model="editForm.name" maxlength="40" placeholder="想让对方怎么称呼你" />
        </label>

        <label class="field">
          <span>性别</span>
          <div class="seg-inline">
            <button type="button" :class="{ active: editForm.gender === 1 }" @click="editForm.gender = 1">男</button>
            <button type="button" :class="{ active: editForm.gender === 0 }" @click="editForm.gender = 0">女</button>
          </div>
        </label>

        <label class="field">
          <span>生日</span>
          <input type="date" v-model="editForm.birthday" />
        </label>
      </div>
      <template #footer>
        <el-button @click="showEdit = false" :disabled="saving">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveProfile">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.mine-page {
  max-width: 760px;
  margin: 0 auto;
  padding: var(--space-page-y) var(--space-page-x);
  padding-bottom: calc(var(--space-page-y) + var(--tab-bar-height));
}

/* Hero */
.hero {
  position: relative;
  display: flex; align-items: center; gap: 18px;
  padding: 26px 24px;
  border-radius: 24px;
  background:
    radial-gradient(circle at 100% 0%, rgba(255,77,109,0.18), transparent 60%),
    linear-gradient(135deg, #fff, var(--pink-100));
  border: 1px solid var(--pink-300);
  box-shadow: 0 10px 32px rgba(255,126,182,0.14);
  margin-bottom: 18px;
  overflow: hidden;
}
.hero::after {
  content: '❤';
  position: absolute;
  right: 18px; bottom: 12px;
  font-size: 56px;
  color: var(--rose-heart);
  opacity: 0.08;
  pointer-events: none;
  font-family: var(--font-script);
}
.avatar {
  width: 76px; height: 76px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--pink-600), var(--rose-heart));
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 30px; font-weight: 600;
  box-shadow: 0 6px 18px rgba(255,77,109,0.25);
  flex-shrink: 0;
}
.hero-text { min-width: 0; flex: 1; }
.eyebrow { margin: 0; color: var(--pink-700); font-size: 22px; }
.hero-text h1 { margin: 0 0 4px; font-size: 26px; color: var(--ink-warm); }
.hero-sub { margin: 0; color: var(--ink-soft); font-size: 14px; }
.hero-sub strong { color: var(--rose-heart); font-family: var(--font-script); font-size: 22px; }
.hero-tag {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--pink-700);
  background: var(--pink-200);
  display: inline-block;
  padding: 2px 10px;
  border-radius: 999px;
}

/* Two-up people */
.people {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 14px;
}
.person {
  background: #fff;
  border: 1px solid var(--pink-300);
  border-radius: 18px;
  padding: 16px 18px;
  box-shadow: 0 4px 14px rgba(255,126,182,0.06);
  position: relative;
}
.person.partner-card {
  background: linear-gradient(140deg, #fff, var(--pink-50));
}
.person header {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 6px;
  font-size: 12px;
}
.role {
  color: var(--pink-700);
  background: var(--pink-200);
  padding: 2px 10px;
  border-radius: 999px;
}
.edit-btn {
  margin-left: auto;
  width: 26px; height: 26px;
  border: 1px solid var(--pink-300);
  border-radius: 50%;
  background: transparent;
  color: var(--pink-700);
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  display: inline-flex; align-items: center; justify-content: center;
}
@media (hover: hover) {
  .edit-btn:hover { background: var(--pink-200); }
}
.countdown { color: var(--rose-heart); }
.presence { color: var(--ink-mute); }
.presence.on { color: var(--el-color-success); }
.person h2 {
  margin: 4px 0 10px;
  font-size: 18px;
  font-family: var(--font-serif);
  color: var(--ink-warm);
  letter-spacing: 1px;
}
.line {
  display: flex; justify-content: space-between; align-items: baseline;
  margin: 4px 0;
  font-size: 13px;
}
.line span { color: var(--ink-mute); }
.line strong { color: var(--ink-warm); font-weight: 500; }

/* Anchor */
.anchor {
  background: #fff;
  border: 1px solid var(--pink-300);
  border-radius: 18px;
  padding: 16px 20px;
  text-align: center;
  margin-bottom: 14px;
  box-shadow: 0 4px 14px rgba(255,126,182,0.06);
}
.anchor-line { margin: 0; color: var(--ink-soft); line-height: 1.8; }
.anchor-line span { color: var(--pink-700); }

/* Cards */
.card {
  background: #fff;
  border: 1px solid var(--pink-300);
  border-radius: 18px;
  padding: 18px 20px;
  margin-bottom: 14px;
  box-shadow: 0 4px 16px rgba(255,126,182,0.06);
}
.card h2 {
  margin: 0 0 12px;
  font-size: 16px;
  color: var(--ink-warm);
  font-family: var(--font-serif);
  letter-spacing: 1px;
}
.card-head {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 6px;
}
.card-head h2 { margin: 0; }
.saved-tip { color: var(--pink-700); font-size: 12px; }

/* Settings */
.setting-block {
  border-top: 1px dashed var(--pink-300);
  padding-top: 12px;
  margin-top: 12px;
}
.setting-block:first-of-type { border-top: none; padding-top: 0; margin-top: 0; }
.setting-label { margin-bottom: 8px; }
.setting-label strong { display: block; font-size: 14px; color: var(--ink-warm); }
.setting-label em { display: block; font-style: normal; font-size: 12px; color: var(--ink-mute); margin-top: 2px; }

.row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 0;
  font-size: 13px;
  color: var(--ink-soft);
}
.row + .row { border-top: 1px dotted var(--pink-200); }

.seg {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.seg button {
  padding: 6px 14px;
  border: 1px solid var(--pink-300);
  border-radius: 999px;
  background: transparent;
  color: var(--ink-soft);
  font-size: 12px;
  cursor: pointer;
  min-height: 36px;
}
.seg button.active {
  background: linear-gradient(135deg, var(--pink-600), var(--rose-heart));
  color: #fff;
  border-color: transparent;
}

/* Maintenance */
.maint-card { display: flex; flex-direction: column; gap: 0; }
.row-btn {
  width: 100%;
  text-align: left;
  background: transparent;
  border: none;
  border-top: 1px dashed var(--pink-300);
  padding: 12px 0;
  cursor: pointer;
  color: var(--ink-warm);
  font-size: 14px;
  min-height: 44px;
}
.row-btn:first-of-type { border-top: none; }
@media (hover: hover) { .row-btn:hover { color: var(--pink-700); } }

/* Settings entry — full-width pill row, mirrors the discover list cards
 * but standalone so it has its own visual gravity. */
.settings-entry {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 16px 20px;
  margin-bottom: 14px;
  background: linear-gradient(135deg, #fff, var(--pink-50));
  border: 1px solid var(--pink-300);
  border-radius: 18px;
  box-shadow: 0 4px 16px rgba(255,126,182,0.08);
  cursor: pointer;
  text-align: left;
  transition: transform 0.15s, border-color 0.15s, box-shadow 0.15s;
  -webkit-tap-highlight-color: transparent;
}
@media (hover: hover) {
  .settings-entry:hover {
    border-color: var(--pink-600);
    transform: translateY(-1px);
    box-shadow: 0 8px 22px rgba(255,77,109,0.16);
  }
}
.settings-entry:active { transform: scale(0.99); }
.se-icon {
  flex-shrink: 0;
  width: 38px; height: 38px;
  border-radius: 12px;
  background: linear-gradient(135deg, var(--pink-600), var(--rose-heart));
  color: #fff;
  font-size: 20px;
  display: inline-flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 10px rgba(255,77,109,0.25);
}
.se-text { flex: 1; min-width: 0; }
.se-text strong {
  display: block;
  color: var(--ink-warm);
  font-size: 15px;
  letter-spacing: 0.5px;
}
.se-text em {
  display: block;
  font-style: normal;
  color: var(--ink-mute);
  font-size: 12px;
  margin-top: 2px;
}
.se-chev {
  color: var(--ink-faint);
  font-size: 22px;
  line-height: 1;
}

/* About */
.about-card p { margin: 0 0 8px; color: var(--ink-soft); line-height: 1.8; }
.muted-text { font-size: 13px; color: var(--ink-mute) !important; }
.meta-line {
  display: flex; justify-content: space-between; align-items: baseline;
  margin-top: 12px !important;
  border-top: 1px dashed var(--pink-300);
  padding-top: 10px;
  font-size: 12px;
}
.meta-line span { color: var(--ink-mute); }
.meta-line strong { color: var(--ink-warm); font-weight: 500; word-break: break-all; }

.logout {
  width: 100%;
  min-height: 44px;
  border: 1px solid var(--pink-300);
  border-radius: 999px;
  background: transparent;
  color: var(--ink-soft);
  cursor: pointer;
  font-size: 14px;
  margin-top: 6px;
}
@media (hover: hover) {
  .logout:hover { background: var(--pink-200); color: var(--pink-700); }
}

@media (max-width: 600px) {
  .hero { padding: 20px; gap: 14px; }
  .avatar { width: 60px; height: 60px; font-size: 24px; }
  .hero-text h1 { font-size: 22px; }
  .people { grid-template-columns: 1fr; }
}

/* Edit dialog */
.edit-body { display: flex; flex-direction: column; gap: 14px; }
.field { display: flex; flex-direction: column; gap: 6px; }
.field > span { font-size: 12px; color: var(--ink-mute); }
.field input {
  padding: 10px 12px;
  border: 1px solid var(--pink-300);
  border-radius: 10px;
  font-size: 15px;
  color: var(--ink-warm);
  background: #fff;
  outline: none;
}
.field input:focus { border-color: var(--pink-600); }
.seg-inline { display: flex; gap: 8px; }
.seg-inline button {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--pink-300);
  border-radius: 10px;
  background: transparent;
  color: var(--ink-soft);
  cursor: pointer;
  min-height: 40px;
  font-size: 14px;
}
.seg-inline button.active {
  background: linear-gradient(135deg, var(--pink-600), var(--rose-heart));
  color: #fff;
  border-color: transparent;
}
</style>
