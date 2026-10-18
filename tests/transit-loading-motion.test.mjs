import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
test('planner and skeleton fade on entry while loop vehicles disappear before reset and respect reduced motion',async()=>{
 const css=await readFile(new URL('../app.css',import.meta.url),'utf8');
 assert.match(css,/\.transit-skeleton \{[^}]*animation: transitFadeIn 480ms/);assert.match(css,/\[data-transit='panel'\]:not\(\[hidden\]\) \{ animation: transitFadeIn/);
 const travel=css.slice(css.indexOf('@keyframes transitTravel'),css.indexOf('@keyframes transitStop'));assert.match(travel,/0%, 5% \{ left: 0; opacity: 0;/);assert.match(travel,/93%, 100% \{ left: 100%; opacity: 0;/);
 assert.match(css,/prefers-reduced-motion: reduce[^}]*animation: none !important/s);assert.match(css,/\.departure-board td:nth-child\(2\) \{[^}]*text-align: left/);
});