/* Génère build/icon.png, build/icon.ico et build/icon.icns sans dépendance. */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT = path.join(ROOT, 'build');
fs.mkdirSync(OUT, { recursive: true });

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  return Buffer.concat([length, name, data, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function inRoundedBox(x, y, half, radius) {
  if (Math.abs(x) > half || Math.abs(y) > half) return false;
  const dx = Math.abs(x) - (half - radius);
  const dy = Math.abs(y) - (half - radius);
  if (dx <= 0 || dy <= 0) return true;
  return dx * dx + dy * dy <= radius * radius;
}

function sample(x, y) {
  // Coordonnées centrées -1..1.
  const nx = x * 2 - 1;
  const ny = y * 2 - 1;
  if (!inRoundedBox(nx, ny, 0.94, 0.24)) return [0, 0, 0, 0];

  let color = [20, 20, 19, 255];

  // Halo interne discret.
  const glow = Math.max(0, 1 - Math.hypot(nx, ny) / 1.05);
  color = [
    Math.round(20 + 16 * glow),
    Math.round(20 + 9 * glow),
    Math.round(19 + 5 * glow),
    255,
  ];

  // Anneau incliné.
  const angle = (24 * Math.PI) / 180;
  const rx = nx * Math.cos(angle) + ny * Math.sin(angle);
  const ry = -nx * Math.sin(angle) + ny * Math.cos(angle);
  const distance = Math.hypot(rx / 0.74, ry / 0.34);
  const ring = Math.abs(distance - 1) < 0.075;
  if (ring) color = [224, 122, 82, 255];

  // Petit arc supérieur, plus doux.
  const arc = Math.abs(distance - 0.99) < 0.035 && ry < -0.04;
  if (arc) color = [244, 164, 130, 255];

  // Coeur.
  if (Math.hypot(nx, ny) < 0.125) color = [224, 122, 82, 255];

  // Éclats diagonaux.
  const spark = (px, py) => Math.abs(px - py) < 0.025 && Math.hypot(px, py) > 0.55 && Math.hypot(px, py) < 0.86;
  if (spark(nx, ny)) color = [224, 122, 82, 255];
  if (Math.abs(nx + ny) < 0.018 && Math.hypot(nx, ny) > 0.58 && Math.hypot(nx, ny) < 0.8) {
    color = [224, 122, 82, 170];
  }

  return color;
}

function drawIcon(size) {
  const supersample = size <= 64 ? 4 : 2;
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let alpha = 0;
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let sy = 0; sy < supersample; sy += 1) {
        for (let sx = 0; sx < supersample; sx += 1) {
          const px = (x + (sx + 0.5) / supersample) / size;
          const py = (y + (sy + 0.5) / supersample) / size;
          const [r, g, b, a] = sample(px, py);
          alpha += a;
          red += r * a;
          green += g * a;
          blue += b * a;
        }
      }
      const samples = supersample * supersample;
      const offset = (y * size + x) * 4;
      const a = alpha / samples;
      if (a > 0) {
        rgba[offset] = Math.round(red / alpha);
        rgba[offset + 1] = Math.round(green / alpha);
        rgba[offset + 2] = Math.round(blue / alpha);
        rgba[offset + 3] = Math.round(a);
      }
    }
  }
  return encodePng(size, size, rgba);
}

const SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const images = new Map(SIZES.map((size) => [size, drawIcon(size)]));

fs.writeFileSync(path.join(OUT, 'icon.png'), images.get(1024));

/* ICO : PNG compressés, accepté depuis Windows Vista. */
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const icoHeader = Buffer.alloc(6);
icoHeader.writeUInt16LE(0, 0);
icoHeader.writeUInt16LE(1, 2);
icoHeader.writeUInt16LE(icoSizes.length, 4);
let offset = 6 + icoSizes.length * 16;
const entries = [];
for (const size of icoSizes) {
  const data = images.get(size);
  const entry = Buffer.alloc(16);
  entry[0] = size >= 256 ? 0 : size;
  entry[1] = size >= 256 ? 0 : size;
  entry[2] = 0;
  entry[3] = 0;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(data.length, 8);
  entry.writeUInt32LE(offset, 12);
  entries.push(entry);
  offset += data.length;
}
fs.writeFileSync(
  path.join(OUT, 'icon.ico'),
  Buffer.concat([icoHeader, ...entries, ...icoSizes.map((size) => images.get(size))])
);

/* ICNS : chunks PNG standard. */
const icnsSpecs = [
  [16, 'icp4'],
  [32, 'icp5'],
  [64, 'icp6'],
  [128, 'ic07'],
  [256, 'ic08'],
  [512, 'ic09'],
  [1024, 'ic10'],
];
const icnsChunks = icnsSpecs.map(([size, type]) => {
  const data = images.get(size);
  const header = Buffer.alloc(8);
  header.write(type, 0, 4, 'ascii');
  header.writeUInt32BE(data.length + 8, 4);
  return Buffer.concat([header, data]);
});
const icnsBody = Buffer.concat(icnsChunks);
const icnsHeader = Buffer.alloc(8);
icnsHeader.write('icns', 0, 4, 'ascii');
icnsHeader.writeUInt32BE(icnsBody.length + 8, 4);
fs.writeFileSync(path.join(OUT, 'icon.icns'), Buffer.concat([icnsHeader, icnsBody]));

console.log('Icônes générées : build/icon.png, build/icon.ico, build/icon.icns');
