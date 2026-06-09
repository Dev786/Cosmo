#!/usr/bin/env node
// Optional warm-up: pre-download Cosmo's local models so the FIRST launch is
// instant instead of a cold ~400MB fetch while the user waits. Invoked by
// setup.sh behind a y/N prompt; safe to run standalone (`node scripts/prefetch-models.mjs`).
//
// Each download MIRRORS the corresponding worker's load call exactly — same model
// id, same dtype, same cache directory — so the bytes land precisely where the
// runtime reads them. If you change a worker's model/dtype/cache, change it here too.
//   • STT  (Moonshine)   → src/main/stt/transformersWhisper/index.ts + whisperWorker.mjs
//   • Turn (Smart Turn)  → src/main/stt/transformersWhisper/index.ts (SMART_TURN)
//   • TTS  (Kokoro)      → src/main/tts/kokoro/kokoroWorker.mjs
//   • Memory (MiniLM)    → src/main/memory/embedder.ts + embedWorker.mjs
//
// Paths are DERIVED from os.homedir() (never hardcoded), identical to the app's
// CACHE_DIR = path.join(os.homedir(), '.pixel', 'models'). Best-effort: a model that
// fails here just downloads on first launch instead, so we log and continue, exit 0.

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

const CACHE_DIR = path.join(os.homedir(), '.pixel', 'models'); // === app CACHE_DIR

const BLUE = process.stdout.isTTY ? '\x1b[34m' : '';
const GREEN = process.stdout.isTTY ? '\x1b[32m' : '';
const YELLOW = process.stdout.isTTY ? '\x1b[33m' : '';
const RESET = process.stdout.isTTY ? '\x1b[0m' : '';
const say = (m) => console.log(`${BLUE}▸${RESET} ${m}`);
const ok = (m) => console.log(`${GREEN}✓${RESET} ${m}`);
const warn = (m) => console.log(`${YELLOW}!${RESET} ${m}`);

/** Run one warm-up step, timing it; never throws (logs a warning instead). */
async function step(label, fn) {
  const t0 = Date.now();
  try {
    say(`${label}…`);
    const note = await fn();
    ok(`${label} ready${note ? ` (${note})` : ''} — ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (e) {
    warn(`${label} skipped (${e?.message || e}); it'll download on first launch instead.`);
  }
}

// 1 + 2. Transformers.js models (Moonshine STT + MiniLM embedder) share one env.
async function prefetchTransformers() {
  const { pipeline, env } = await import('@huggingface/transformers');
  env.cacheDir = CACHE_DIR; // mirror whisperWorker.mjs / embedWorker.mjs
  env.allowLocalModels = true;

  await step('Speech-to-text (Moonshine base, q8)', async () => {
    const asr = await pipeline('automatic-speech-recognition', 'onnx-community/moonshine-base-ONNX', { dtype: 'q8' });
    await asr?.dispose?.();
  });

  await step('Memory embedder (MiniLM-L6-v2)', async () => {
    const ex = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    await ex?.dispose?.();
  });
}

// 3. Smart Turn v3 — a single .onnx file fetched to a fixed path under CACHE_DIR.
async function prefetchSmartTurn() {
  await step('Turn detection (Smart Turn v3)', async () => {
    const dest = path.join(CACHE_DIR, 'smart-turn', 'smart-turn-v3.0.onnx');
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return 'cached';
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const url = 'https://huggingface.co/pipecat-ai/smart-turn-v3/resolve/main/smart-turn-v3.0.onnx';
    const res = await fetch(url, { headers: { 'User-Agent': 'cosmo' } }); // Node 20+ global fetch, follows redirects
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const tmp = `${dest}.part`;
    fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
    fs.renameSync(tmp, dest); // atomic: never leave a half-written model the runtime would trust
    return `${(fs.statSync(dest).size / 1e6).toFixed(0)}MB`;
  });
}

// 4. Kokoro TTS — mirror kokoroWorker.mjs EXACTLY (no cacheDir override, so it lands
//    in kokoro-js's own cache, which the worker reads from the same node_modules).
async function prefetchKokoro() {
  await step('Voice (Kokoro-82M, fp32)', async () => {
    const { KokoroTTS } = await import('kokoro-js');
    await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-ONNX', { dtype: 'fp32', device: 'cpu' });
  });
}

async function main() {
  console.log(`\nPre-downloading Cosmo's local models into ${CACHE_DIR} …\n`);
  await prefetchTransformers();
  await prefetchSmartTurn();
  await prefetchKokoro();
  console.log('\nDone. First launch will use these cached models.\n');
}

main().catch((e) => warn(`Prefetch aborted: ${e?.message || e}`)).finally(() => process.exit(0));
