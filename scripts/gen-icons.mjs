// Generates the PWA app icons as PNGs (no external deps).
// Brand: indigo #4f46e5 background, white "module card" with indigo text lines.
// Run once: node scripts/gen-icons.mjs  (outputs into public/)
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(here, "..", "public");
mkdirSync(PUBLIC, { recursive: true });

const INDIGO = [0x4f, 0x46, 0xe5];
const WHITE = [0xff, 0xff, 0xff];

function inRound(x, y, w, h, r) {
  if (r <= 0) return x >= 0 && x <= w && y >= 0 && y <= h;
  if (x < 0 || x > w || y < 0 || y > h) return false;
  if (x < r && y < r) return (x - r) ** 2 + (y - r) ** 2 <= r * r;
  if (x > w - r && y < r) return (x - (w - r)) ** 2 + (y - r) ** 2 <= r * r;
  if (x < r && y > h - r) return (x - r) ** 2 + (y - (h - r)) ** 2 <= r * r;
  if (x > w - r && y > h - r) return (x - (w - r)) ** 2 + (y - (h - r)) ** 2 <= r * r;
  return true;
}

function buildIcon(size, opts = {}) {
  const roundedCorners = opts.roundedCorners !== false;
  const outerRadius = opts.outerRadius ?? size * 0.18;
  const cardX = size * 0.26;
  const cardY = size * 0.3;
  const cardW = size * 0.48;
  const cardH = size * 0.4;
  const cardR = size * 0.08;
  // White card with indigo "text" lines (a study module / flashcard motif).
  const lines = [
    { y: cardY + cardH * 0.2, h: size * 0.05, inset: size * 0.07 },
    { y: cardY + cardH * 0.46, h: size * 0.035, inset: size * 0.07 },
    { y: cardY + cardH * 0.64, h: size * 0.035, inset: size * 0.07 },
  ];
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = INDIGO[0], g = INDIGO[1], b = INDIGO[2];
      let a = 255;
      if (roundedCorners && !inRound(x, y, size, size, outerRadius)) {
        a = 0;
      }
      const cx = x - cardX;
      const cy = y - cardY;
      if (inRound(cx, cy, cardW, cardH, cardR)) {
        r = WHITE[0]; g = WHITE[1]; b = WHITE[2];
        for (const ln of lines) {
          if (y >= ln.y && y <= ln.y + ln.h) {
            const lx0 = cardX + ln.inset;
            const lx1 = cardX + cardW - ln.inset;
            if (x >= lx0 && x <= lx1) {
              r = INDIGO[0]; g = INDIGO[1]; b = INDIGO[2];
            }
          }
        }
      }
      const i = (y * size + x) * 4;
      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = b;
      buf[i + 3] = a;
    }
  }
  return encodePNG(size, size, buf);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0, 0);
  return Buffer.concat([len, t, data, crc]);
}

function encodePNG(w, h, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, y * w * 4 + w * 4);
  }
  const idat = deflateSync(raw);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

writeFileSync(join(PUBLIC, "icon-192.png"), buildIcon(192, { roundedCorners: true }));
writeFileSync(join(PUBLIC, "icon-512.png"), buildIcon(512, { roundedCorners: true }));
// Maskable: full-bleed background (no transparent corners) so platforms can crop
// to the safe zone; motif already sits inside the central ~80%.
writeFileSync(join(PUBLIC, "icon-maskable-512.png"), buildIcon(512, { roundedCorners: false }));
// apple-touch-icon: 180x180, full square (iOS masks corners itself).
writeFileSync(join(PUBLIC, "apple-touch-icon.png"), buildIcon(180, { roundedCorners: false }));
console.log("icons generated -> public/");
