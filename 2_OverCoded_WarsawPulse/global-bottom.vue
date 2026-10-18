<script setup lang="ts">
// Warstwa pikseli wspólna dla całej prezentacji. Slidev ładuje global-bottom.vue na każdym slajdzie,
// POD treścią slajdu, więc klocki przesuwają się pod telefonem, tekstem i kafelkami.
// 16 niebieskich kwadratów: na każdym slajdzie układają się w dwie grupy w wolnych miejscach,
// a przy zmianie slajdu płynnie przesuwają się w nowe pozycje.
// Układy zmieniasz w `layouts` (numer slajdu -> dwie grupy). Slajdy bez wpisu dostają `fallback`.
import { computed } from 'vue'
import { useNav } from '@slidev/client'

const { currentSlideNo } = useNav()

const SIZE = 20
const GAP = 8
const STEP = SIZE + GAP
const W = 980 // szerokość slajdu w Slidev
const H = 552 // wysokość slajdu
const SIDE = 56 // margines boczny slajdów
const EDGE = 34 // odstęp od górnej/dolnej krawędzi

type Pattern = [number, number][]
// podstawowy kształt w siatce 7 x 3 (schodki jak w grafikach hackathonu)
const base: Pattern = [[5, 0], [2, 1], [4, 1], [0, 2], [1, 2], [2, 2], [3, 2], [6, 2]]
const mirror = (p: Pattern): Pattern => p.map(([x, y]) => [6 - x, y])
const flip = (p: Pattern): Pattern => p.map(([x, y]) => [x, 2 - y])
const vertical = (p: Pattern): Pattern => p.map(([x, y]) => [y, x]) // 3 x 7, pionowo

const HW = 7 * STEP - GAP // szerokość grupy poziomej
const HH = 3 * STEP - GAP // wysokość grupy poziomej
const right = W - SIDE - HW
const bottom = H - EDGE - HH
const rightV = W - SIDE - HH // grupa pionowa przy prawej krawędzi
const bottomV = H - EDGE - HW

type Group = [Pattern, number, number] // kształt, x, y lewego górnego rogu
const fallback: Group[] = [[flip(base), right, EDGE], [base, SIDE, bottom]]
const layouts: Record<number, Group[]> = {
  1: [[base, right, bottom], [flip(mirror(base)), SIDE, EDGE]], // tytuł
  2: [[flip(base), right, EDGE], [base, SIDE, bottom]], // problem
  3: [[base, right, bottom], [flip(mirror(base)), SIDE, EDGE]], // dla kogo
  4: [[base, right, bottom], [flip(mirror(base)), right, EDGE]], // rozwiązanie
  5: [[vertical(base), rightV, EDGE], [vertical(flip(base)), rightV, bottomV]], // demo 1: wydarzenia
  6: [[vertical(flip(base)), rightV, EDGE], [vertical(base), rightV, bottomV]], // demo 2: dojazd
  7: [[vertical(mirror(base)), rightV, EDGE], [vertical(flip(mirror(base))), rightV, bottomV]], // demo 3: ulubione
  8: [[vertical(flip(base)), rightV, EDGE], [base, SIDE, bottom]], // demo na żywo
  9: [[flip(base), right, EDGE - 6], [flip(mirror(base)), right - HW - GAP, EDGE - 6]], // otwarte dane
  10: [[flip(base), right, EDGE], [base, SIDE, bottom + 16]], // jak to działa
  11: [[mirror(base), SIDE, bottom], [flip(base), right, EDGE]], // podziękowanie
}

const cells = computed(() => {
  const groups = layouts[currentSlideNo.value] ?? fallback
  return groups.flatMap(([pattern, gx, gy]) =>
    pattern.map(([x, y]) => [gx + x * STEP, gy + y * STEP] as [number, number]),
  )
})
</script>

<template>
  <div class="wp-flow" aria-hidden="true">
    <span
      v-for="(c, i) in cells"
      :key="i"
      class="wp-tile"
      :style="{ transform: `translate(${c[0]}px, ${c[1]}px)`, transitionDelay: `${i * 28}ms` }"
    />
  </div>
</template>

<style scoped>
.wp-flow {
  position: absolute;
  inset: 0;
  background: var(--bg, #030a26); /* tło slajdu pod klockami */
  pointer-events: none;
  overflow: hidden;
}

.wp-tile {
  position: absolute;
  left: 0;
  top: 0;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  background: var(--blue, #4b6cf0);
  transition: transform 0.9s cubic-bezier(0.65, 0, 0.35, 1);
}

@media (prefers-reduced-motion: reduce) {
  .wp-tile {
    transition: none;
  }
}
</style>
