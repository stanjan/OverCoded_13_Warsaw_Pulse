<script setup lang="ts">
// Niebieskie "piksele" w stylu grafik Warsaw Open Data Hackathon.
// Pozycję ustawiasz klasą na slajdzie, np. <PixelSteps class="px-br" />, a wielkość: size="16".
const props = withDefaults(defineProps<{ size?: number }>(), { size: 22 })
const gap = 8
// [kolumna, wiersz] w siatce 7 x 3
const cells: [number, number][] = [
  [5, 0],
  [2, 1], [4, 1],
  [0, 2], [1, 2], [2, 2], [3, 2], [6, 2],
]
const step = () => props.size + gap
</script>

<template>
  <div
    class="pixels"
    aria-hidden="true"
    :style="{ width: 7 * step() - gap + 'px', height: 3 * step() - gap + 'px' }"
  >
    <span
      v-for="(c, i) in cells"
      :key="i"
      :style="{ left: c[0] * step() + 'px', top: c[1] * step() + 'px', width: props.size + 'px', height: props.size + 'px' }"
    />
  </div>
</template>

<style scoped>
.pixels {
  position: absolute;
  pointer-events: none;
}

.pixels span {
  position: absolute;
  border-radius: 4px;
  background: var(--blue, #4b6cf0);
}
</style>
