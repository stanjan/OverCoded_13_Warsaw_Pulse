// Generates the PWA icons in icons/ (run: node scripts/icons.mjs). No image dependencies: draws and encodes PNGs directly.
import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

const navy = [9, 20, 38], blue = [49, 107, 243], white = [255, 255, 255];
// Pulse mark: solid dot with two rings, radii as fractions of the icon size (inside the 40% maskable safe zone).
const shapes = [
  { from: 0, to: 0.11, color: white },
  { from: 0.19, to: 0.235, color: blue },
  { from: 0.3, to: 0.335, color: blue, alpha: 0.55 },
];

function crcTable() { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; }
const table = crcTable();
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body)); return Buffer.concat([len, body, crc]); }

function render(size, { rounded }) {
  const ss = 4, raw = Buffer.alloc(size * (size * 4 + 1)), corner = rounded ? size * 0.22 : 0;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const px = x + (sx + 0.5) / ss, py = y + (sy + 0.5) / ss;
        const cx = Math.max(corner - px, 0, px - (size - corner)), cy = Math.max(corner - py, 0, py - (size - corner));
        if (corner && Math.hypot(cx, cy) > corner) continue;
        let color = navy;
        const d = Math.hypot(px - size / 2, py - size / 2) / size;
        for (const s of shapes) if (d >= s.from && d <= s.to) { const k = s.alpha ?? 1; color = color.map((v, i) => v * (1 - k) + s.color[i] * k); }
        r += color[0]; g += color[1]; b += color[2]; a += 255;
      }
      const n = ss * ss, o = y * (size * 4 + 1) + 1 + x * 4, cov = a / n / 255;
      raw[o] = cov ? r / n / cov : 0; raw[o + 1] = cov ? g / n / cov : 0; raw[o + 2] = cov ? b / n / cov : 0; raw[o + 3] = a / n;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

await mkdir('icons', { recursive: true });
await writeFile('icons/icon-192.png', render(192, { rounded: true }));
await writeFile('icons/icon-512.png', render(512, { rounded: true }));
await writeFile('icons/maskable-512.png', render(512, { rounded: false }));
await writeFile('icons/apple-touch-icon.png', render(180, { rounded: false }));
console.log('Wrote icons/ (192, 512, maskable 512, apple-touch 180).');
