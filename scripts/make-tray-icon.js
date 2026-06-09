// Generates assets/tray-icon.png (16x16) + tray-icon@2x.png (32x32):
// Cosmo's two eyes as a macOS *template* image — pure black shape in the alpha
// channel, transparent elsewhere. macOS recolors template images for light/dark
// menu bars automatically, so we only encode coverage (alpha), never colour.
// Run once: `node scripts/make-tray-icon.js`. Re-run if the glyph changes.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ── tiny PNG (RGBA, 8-bit) encoder ───────────────────────────────────────────
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type RGBA
  // 10,11,12 = compression/filter/interlace = 0
  // scanlines, each prefixed with filter byte 0
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ── draw two eyes, anti-aliased via 4x4 supersampling ────────────────────────
function drawEyes(S) {
  const SS = 4;                       // supersample factor
  const rgba = Buffer.alloc(S * S * 4); // zero = transparent black
  const eyes = [
    { cx: 0.34 * S, cy: 0.5 * S },
    { cx: 0.66 * S, cy: 0.5 * S },
  ];
  const rx = 0.135 * S, ry = 0.2 * S;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          for (const e of eyes) {
            const dx = (px - e.cx) / rx, dy = (py - e.cy) / ry;
            if (dx * dx + dy * dy <= 1) { hits++; break; }
          }
        }
      }
      const a = Math.round((hits / (SS * SS)) * 255);
      const i = (y * S + x) * 4;
      rgba[i] = 0; rgba[i + 1] = 0; rgba[i + 2] = 0; rgba[i + 3] = a;
    }
  }
  return encodePng(S, S, rgba);
}

const outDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'tray-icon.png'), drawEyes(16));
fs.writeFileSync(path.join(outDir, 'tray-icon@2x.png'), drawEyes(32));
console.log('Wrote assets/tray-icon.png (16) + tray-icon@2x.png (32)');
