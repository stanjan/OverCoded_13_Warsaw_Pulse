<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import PhoneFrame from './PhoneFrame.vue'
import { createSlideDemoController, demoPrompts } from './live-demo-controller.mjs'

const phone = ref<InstanceType<typeof PhoneFrame> | null>(null)
const state = ref({ ready: false, pending: null as string | null, selected: null as string | null, error: '' })
const icons = { calendar: 'i-carbon-calendar', family: 'i-carbon-pedestrian-family', walk: 'i-carbon-pedestrian', ball: 'i-carbon-basketball', toilet: 'i-ph-toilet', heart: 'i-ph-heartbeat' }
const appOrigin = 'http://localhost:5173'
let controller: ReturnType<typeof createSlideDemoController> | undefined
onMounted(() => {
  controller = createSlideDemoController({ getFrame: () => phone.value?.frame?.contentWindow, appOrigin, onChange: value => { state.value = value } })
})
onBeforeUnmount(() => controller?.stop())
</script>

<template>
  <div class="demo live-demo">
    <div class="demo-text">
      <div class="eyebrow">Demo na żywo</div>
      <h1>A teraz prawdziwa strona.</h1>
      <div class="prompt-grid" aria-label="Wyślij pytanie do aplikacji">
        <button v-for="tile in demoPrompts" :key="tile.id" type="button"
          :class="{ selected: state.selected === tile.id, sending: state.pending === tile.id }"
          :aria-pressed="state.selected === tile.id" :aria-label="tile.prompt"
          :disabled="!state.ready || !!state.pending"
          @pointerdown.stop @keydown.stop @click.stop.prevent="controller?.send(tile)">
          <span :class="icons[tile.icon]" class="tile-icon" aria-hidden="true" />
          <span class="tile-title">{{ tile.title }}</span>
          <span class="tile-prompt">{{ tile.prompt }}</span>
        </button>
      </div>
      <p class="connection" role="status" :class="{ error: state.error }">
        {{ state.error || (state.pending ? 'Asystent odpowiada…' : state.ready ? 'Kliknij propozycję' : 'Łączę z aplikacją…') }}
      </p>
    </div>
    <PhoneFrame ref="phone" :src="`${appOrigin}/?safeTop=35&safeBottom=0&presentationDemo=1`" @load="controller?.reset()" />
  </div>
</template>

<style scoped>
.live-demo .demo-text { gap: 12px; }
.live-demo h1 { font-size: 2.15rem; line-height: 1.08; }
.prompt-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; margin-top: 5px; }
.prompt-grid button { position: relative; display: grid; grid-template-columns: 25px 1fr; gap: 5px 8px; align-content: start; min-height: 105px; padding: 12px; border: 1px solid #2b3865; border-radius: 12px; background: #0a1438; color: #fff; text-align: left; font: inherit; cursor: pointer; transition: background .2s, border-color .2s, color .2s, transform .2s, box-shadow .2s; }
.prompt-grid button:hover:not(:disabled) { border-color: #ccf460; transform: translateY(-2px); }
.prompt-grid button:focus-visible { outline: 2px solid #ccf460; outline-offset: 3px; }
.prompt-grid button.selected { background: #ccf460; border-color: #ccf460; color: #030a26; box-shadow: 0 4px 18px #ccf46020; }
.prompt-grid button:disabled { cursor: default; }
.tile-icon { display: block; width: 23px; height: 23px; color: #ccf460; }
.selected .tile-icon { color: #030a26; }
.tile-title { font-size: 13px; line-height: 1.7; font-weight: 750; }
.tile-prompt { grid-column: 1 / -1; font-size: 10.5px; line-height: 1.35; color: #dce2f5; }
.selected .tile-prompt { color: #172337; }
.sending::after { content: ''; position: absolute; width: 5px; height: 5px; right: 9px; top: 9px; background: currentColor; border-radius: 50%; animation: demo-pulse 1s ease-in-out infinite; }
.live-demo .connection { font-size: 11px; line-height: 1.3; color: #aab8df; min-height: 15px; }
.live-demo .connection.error { color: #ffd7b2; }
@keyframes demo-pulse { 50% { opacity: .25; } }
@media (prefers-reduced-motion: reduce) { .prompt-grid button { transition: none; } .sending::after { animation: none; } }
</style>
