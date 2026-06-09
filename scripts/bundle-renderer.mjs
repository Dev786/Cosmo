import { build } from 'esbuild';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

fs.mkdirSync(path.join(root, 'dist/renderer/renderer'), { recursive: true });

await build({
  entryPoints: [path.join(root, 'src/renderer/main.ts')],
  bundle: true,
  outfile: path.join(root, 'dist/renderer/renderer/main.js'),
  platform: 'browser',
  target: 'chrome120',   // Electron 31 ships Chromium ~128, be safe
  format: 'iife',        // no import/export — works directly in <script>
  sourcemap: true,
  external: ['electron'],
  tsconfig: path.join(root, 'tsconfig.renderer.json'),
  logLevel: 'info',
});

console.log('Renderer bundled OK → dist/renderer/renderer/main.js');

// ─── Copy VAD + ONNX runtime assets (loaded at runtime via file://) ──────────
const outDir = path.join(root, 'dist/renderer/renderer');
const copies = [
  ['node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js', 'vad.worklet.bundle.min.js'],
  ['node_modules/@ricky0123/vad-web/dist/silero_vad_v5.onnx', 'silero_vad_v5.onnx'],
  ['node_modules/@ricky0123/vad-web/dist/silero_vad_legacy.onnx', 'silero_vad_legacy.onnx'],
];
// onnxruntime-web wasm + mjs loader files
const ortDir = path.join(root, 'node_modules/onnxruntime-web/dist');
for (const f of fs.readdirSync(ortDir)) {
  if (/^ort-.*\.(wasm|mjs)$/.test(f)) copies.push([`node_modules/onnxruntime-web/dist/${f}`, f]);
}
for (const [src, dest] of copies) {
  const from = path.join(root, src);
  if (fs.existsSync(from)) fs.copyFileSync(from, path.join(outDir, dest));
  else console.warn('  ⚠ missing asset:', src);
}
console.log(`Copied ${copies.length} VAD/ONNX assets → dist/renderer/renderer/`);

// ─── Copy character artwork → app://bundle/characters/ (image-mode chibis) ───
const charSrc = path.join(root, 'assets/characters');
if (fs.existsSync(charSrc)) {
  const charOut = path.join(outDir, 'characters');
  fs.mkdirSync(charOut, { recursive: true });
  let n = 0;
  for (const f of fs.readdirSync(charSrc)) {
    if (/\.(png|jpe?g|webp|svg)$/i.test(f)) { fs.copyFileSync(path.join(charSrc, f), path.join(charOut, f)); n++; }
  }
  console.log(`Copied ${n} character image(s) → dist/renderer/renderer/characters/`);
}
