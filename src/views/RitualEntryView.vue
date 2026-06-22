<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { track } from '@/composables/useAnalytics'

const router = useRouter()
const step = ref<1 | 2 | 3>(1)

const progressText = computed(() => `${step.value} / 3`)

onMounted(() => {
  track('ritual_open', { step: 1 })
})

function next() {
  if (step.value >= 3) return
  step.value = (step.value + 1) as 1 | 2 | 3
  if (step.value === 2) track('ritual_hand_view', { step: 2 })
}

function onVideoPlay() {
  track('ritual_video_play', { step: 1 })
}
function onVideoEnded() {
  track('ritual_video_end', { step: 1 })
}

function enter() {
  track('ritual_enter_click', { step: 3 })
  router.push({ path: '/login', query: { u: 'panpeixue' } })
}
</script>

<template>
  <main class="ritual-page">
    <div class="ritual-card">
      <p class="eyebrow">To My L · {{ progressText }}</p>

      <section v-if="step === 1" class="stage stage-video">
        <div class="copy">
          <h1 class="font-serif">先听一小段</h1>
          <p>不是正式演出，也不是想证明什么。</p>
          <p>只是那天，我真的很认真地唱完了。</p>
        </div>
        <video
          class="media video"
          src="/ritual/song.mp4"
          controls
          playsinline
          preload="metadata"
          @play="onVideoPlay"
          @ended="onVideoEnded"
        />
        <button class="primary" type="button" @click="next">听完了，继续</button>
      </section>

      <section v-else-if="step === 2" class="stage stage-image">
        <div class="copy">
          <h1 class="font-serif">还有这一张</h1>
          <p>弹完琴之后，手有点不太听话。</p>
          <p>那一段录了四个小时，反复停下，又反复从头来。</p>
          <p>不想让你心疼，只是想让你知道：这件小事，我没有敷衍。</p>
        </div>
        <img class="media hand" src="/ritual/hand.jpg" alt="弹完琴之后的手" />
        <button class="primary" type="button" @click="next">我看到了</button>
      </section>

      <section v-else class="stage stage-door">
        <div class="copy">
          <h1 class="font-serif">这里有一枚小入口</h1>
          <p>不是要你立刻回应什么。</p>
          <p>只是把一些没说出口的日子，安静地放在这里。</p>
          <p class="hint">账号我已经写好了，密码是 <strong>123456</strong>。</p>
        </div>
        <button class="door" type="button" @click="enter">
          <span>打开这枚胶囊</span>
          <small>点进去之后，输下那串数字就好</small>
        </button>
      </section>
    </div>
  </main>
</template>

<style scoped>
.ritual-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 28px 16px;
  background:
    radial-gradient(circle at 20% 18%, rgba(255,126,182,0.22), transparent 32%),
    radial-gradient(circle at 82% 78%, rgba(255,77,109,0.14), transparent 30%),
    linear-gradient(180deg, #fff8fb 0%, #fff 100%);
}

.ritual-card {
  width: min(680px, 100%);
  min-height: min(720px, calc(100vh - 56px));
  border-radius: 28px;
  border: 1px solid rgba(255, 126, 182, 0.24);
  background: rgba(255, 255, 255, 0.78);
  box-shadow: 0 24px 80px rgba(255, 126, 182, 0.18);
  backdrop-filter: blur(10px);
  padding: 28px;
  display: flex;
  flex-direction: column;
}

.eyebrow {
  margin: 0 0 18px;
  color: var(--pink-700);
  font-size: 12px;
  letter-spacing: 1px;
  text-transform: uppercase;
}

.stage {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.copy h1 {
  margin: 0 0 10px;
  color: var(--ink-warm);
  font-size: clamp(28px, 6vw, 42px);
  font-weight: 600;
  letter-spacing: 1px;
}
.copy p {
  margin: 6px 0;
  color: var(--ink-soft);
  line-height: 1.8;
  font-size: 15px;
}
.copy .hint {
  display: inline-block;
  margin-top: 12px;
  padding: 8px 12px;
  border-radius: 999px;
  background: var(--pink-100);
  color: var(--ink-warm);
}
.copy .hint strong {
  color: var(--rose-heart);
  letter-spacing: 1px;
}

.media {
  width: 100%;
  border-radius: 22px;
  border: 1px solid rgba(255, 126, 182, 0.24);
  background: #fff;
  box-shadow: 0 12px 38px rgba(92, 74, 82, 0.10);
}
.video {
  aspect-ratio: 16 / 9;
  object-fit: cover;
}
.hand {
  max-height: 420px;
  object-fit: cover;
}

.primary,
.door {
  border: none;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.primary {
  align-self: flex-end;
  padding: 12px 22px;
  border-radius: 999px;
  color: #fff;
  background: linear-gradient(135deg, var(--pink-600), var(--rose-heart));
  box-shadow: 0 10px 24px rgba(255, 77, 109, 0.25);
  font-weight: 600;
}

.stage-door {
  justify-content: center;
}
.door {
  margin-top: 18px;
  width: 100%;
  padding: 24px 18px;
  border-radius: 24px;
  color: #fff;
  background: linear-gradient(135deg, var(--pink-600), var(--rose-heart));
  box-shadow: 0 18px 42px rgba(255, 77, 109, 0.26);
  display: grid;
  gap: 6px;
}
.door span {
  font-size: 20px;
  font-weight: 700;
}
.door small {
  color: rgba(255,255,255,0.84);
  font-size: 12px;
}

@media (max-width: 640px) {
  .ritual-page { padding: 14px; align-items: stretch; }
  .ritual-card { min-height: calc(100vh - 28px); padding: 22px; border-radius: 24px; }
  .hand { max-height: 50vh; }
  .primary { width: 100%; }
}
</style>
