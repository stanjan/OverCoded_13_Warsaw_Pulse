<script setup lang="ts">
import { ref, watch } from 'vue'
import { useIsSlideActive } from '@slidev/client'

// Ramka telefonu. Podaj `src` (adres żywej strony) albo `video` (nagranie z public/).
// Strona wypełnia cały ekran. Odstęp pod wyspą robi sama aplikacja na podstawie
// parametrów w adresie, np. src="http://localhost:5173?safeTop=59&safeBottom=34".
const props = defineProps<{ src?: string; video?: string }>()

const failed = ref(false)
const player = ref<HTMLVideoElement | null>(null)
const frame = ref<HTMLIFrameElement | null>(null)
defineExpose({ frame })
const emit = defineEmits<{ load: [] }>()

// Nagranie startuje od początku, gdy slajd się pojawia, i zatrzymuje po wyjściu ze slajdu.
const active = useIsSlideActive()
watch([active, player], ([on, v]) => {
  if (!v) return
  if (on) {
    v.currentTime = 0
    v.play().catch(() => {})
  }
  else v.pause()
}, { immediate: true })

function toggle() {
  const v = player.value
  if (!v) return
  if (v.paused) v.play()
  else v.pause()
}
</script>

<template>
  <div class="phone">
    <div class="screen">
      <template v-if="props.src">
        <iframe ref="frame" :src="props.src" title="Demo strony" allow="geolocation" @load="emit('load')" />
        <div class="island" />
      </template>
      <template v-else-if="props.video">
        <video
          v-if="!failed"
          ref="player"
          :src="props.video"
          muted
          loop
          playsinline
          @click="toggle"
          @error="failed = true"
        />
        <div v-else class="empty">
          Wstaw nagranie jako<br /><code>public{{ props.video }}</code>
        </div>
        <div class="island" />
      </template>
    </div>
  </div>
</template>

<style scoped>
/* Ekran ma 226x490 px: to prawdziwy rozmiar telefonu (390x844) w skali 58%,
   więc strona mobilna układa się tak jak na urządzeniu. */
.phone {
  position: relative;
  flex: none;
  width: 246px;
  height: 510px;
  padding: 10px;
  border-radius: 38px;
  background: #000;
  /* jasna krawędź obudowy odcina telefon od granatowego tła */
  box-shadow: 0 0 0 3px #5a6aa0, 0 0 0 4px #2a355e, 0 18px 50px rgba(0, 0, 0, 0.6);
}

.screen {
  position: relative;
  width: 226px;
  height: 490px;
  border-radius: 29px;
  /* Clipping must not create a scroll container: app scrollIntoView() can
     otherwise scroll the larger, scaled iframe out of the phone screen. */
  overflow: clip;
  background: #fff;
}

iframe {
  display: block;
  width: 390px;
  height: 844px;
  border: 0;
  background: #fff;
  transform: scale(0.58);
  transform-origin: 0 0;
}

video {
  display: block;
  width: 226px;
  height: 490px;
  object-fit: cover;
  background: #000;
  cursor: pointer;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: 16px;
  text-align: center;
  font-size: 12px;
  line-height: 1.5;
  color: #dce2f5;
  background: #0a1438;
}

.island {
  position: absolute;
  top: 8px;
  left: 50%;
  width: 64px;
  height: 16px;
  margin-left: -32px;
  border-radius: 8px;
  background: #000;
  pointer-events: none;
  z-index: 2;
}
</style>
