<script setup lang="ts">
/**
 * FirstWelcomeModal — shown exactly once after backend reports firstLogin.
 *
 * Payload is read from sessionStorage because the login page redirects to
 * home after receiving LoginResponse; the modal lives in App.vue. This
 * avoids passing route query params with long text/media paths.
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { FIRST_WELCOME_STORAGE_KEY, type FirstWelcomeContent } from '@/config/firstWelcome'

const STORAGE_KEY = FIRST_WELCOME_STORAGE_KEY
const visible = ref(false)
const content = ref<FirstWelcomeContent | null>(null)
const audioRef = ref<HTMLAudioElement | null>(null)
const audioPlaying = ref(false)

function openFromStorage() {
  const raw = sessionStorage.getItem(STORAGE_KEY)
  if (!raw) return
  try {
    content.value = JSON.parse(raw) as FirstWelcomeContent
    visible.value = true
  } catch {
    sessionStorage.removeItem(STORAGE_KEY)
  }
}

onMounted(() => {
  openFromStorage()
  // LoginView writes the payload after this component has already mounted
  // on /login. Listen for a one-shot event so the modal opens immediately
  // after successful first login instead of waiting for a page refresh.
  window.addEventListener('tml:first-welcome-ready', openFromStorage)
})
onUnmounted(() => {
  window.removeEventListener('tml:first-welcome-ready', openFromStorage)
})

const hasAudio = computed(() => !!content.value?.audio)

function close() {
  visible.value = false
  sessionStorage.removeItem(STORAGE_KEY)
  audioRef.value?.pause()
}

async function toggleAudio() {
  const audio = audioRef.value
  if (!audio) return
  if (!audio.paused) {
    audio.pause()
    audioPlaying.value = false
    return
  }
  try {
    await audio.play()
    audioPlaying.value = true
  } catch {
    // Browser blocked autoplay/user gesture weirdness; keep button usable.
    audioPlaying.value = false
  }
}
</script>

<template>
  <el-dialog
    v-model="visible"
    width="620px"
    :close-on-click-modal="false"
    :show-close="false"
    custom-class="first-welcome-dialog"
  >
    <div v-if="content" class="welcome">
      <h2 class="font-serif">{{ content.title }}</h2>

      <video
        v-if="content.video"
        class="video"
        :src="content.video"
        controls
        playsinline
        preload="metadata"
      />

      <div class="letter font-serif">
        <p v-for="(p, idx) in content.paragraphs" :key="idx">{{ p }}</p>
      </div>

      <div v-if="hasAudio" class="audio-row">
        <audio ref="audioRef" :src="content.audio" @ended="audioPlaying = false" />
        <button type="button" class="audio-btn" @click="toggleAudio">
          {{ audioPlaying ? '暂停音乐' : '播放音乐' }}
        </button>
        <span class="audio-title">{{ content.audioTitle || '一段小音乐' }}</span>
      </div>

      <button type="button" class="btn-romance confirm" @click="close">
        {{ content.confirmText }}
      </button>
    </div>
  </el-dialog>
</template>

<style scoped>
.welcome { text-align: center; }
.eyebrow { margin: 0; color: var(--pink-700); font-size: 22px; }
h2 { margin: 2px 0 18px; color: var(--ink-warm); font-size: 24px; letter-spacing: 2px; }
.video {
  width: 100%;
  max-height: 320px;
  border-radius: 16px;
  background: #000;
  margin-bottom: 16px;
  box-shadow: 0 8px 22px rgba(255,126,182,0.14);
}
.letter {
  text-align: left;
  background: #FFFCFD;
  background-image: repeating-linear-gradient(
    to bottom,
    transparent 0,
    transparent 31px,
    var(--pink-200) 31px,
    var(--pink-200) 32px
  );
  border-left: 4px solid var(--pink-400);
  border-radius: 16px;
  padding: 20px 24px;
  color: var(--ink-warm);
  line-height: 32px;
  font-size: 15px;
  /* Long first-login letters must never be clipped by the modal; scroll
   * only the letter body, not the whole page behind it. */
  max-height: min(52vh, 430px);
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.letter p { margin: 0 0 12px; }
.letter p:last-child { margin-bottom: 0; }
.audio-row {
  margin-top: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--ink-soft);
  font-size: 13px;
}
.audio-btn {
  border: 1px solid var(--pink-300);
  border-radius: 999px;
  background: #fff;
  color: var(--pink-700);
  padding: 6px 14px;
  cursor: pointer;
}
.confirm { margin-top: 22px; min-width: 140px; }

:global(.first-welcome-dialog) { border-radius: 22px !important; }
:global(.first-welcome-dialog .el-dialog__body) { padding: 28px; }

@media (max-width: 600px) {
  h2 { font-size: 20px; }
  .letter { padding: 16px 18px; font-size: 14px; line-height: 28px; }
  :global(.first-welcome-dialog .el-dialog__body) { padding: 22px 18px; }
}
</style>
