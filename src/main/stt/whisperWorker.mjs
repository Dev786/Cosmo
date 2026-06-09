// Voice worker — runs as a child_process.fork under the SYSTEM node binary
// (NOT Electron: onnxruntime-node inference crashes under Electron's bundled
// runtime — verified code 5 / SIGTRAP — but runs cleanly under real node).
//
// Two capabilities, both local:
//   • Whisper STT      via transformers.js (onnxruntime-node 1.14, nested in
//                        @xenova/transformers)
//   • Smart Turn v3    semantic end-of-turn detection. Its ONNX is opset 20,
//                        which the nested 1.14 can't load, so we run it on
//                        onnxruntime-web (WASM 1.26). WASM and native ORT don't
//                        share symbols, so the two runtimes coexist in one
//                        process. Mel features come from transformers.js's
//                        WhisperFeatureExtractor (pure JS — no ORT).
//
// Hand-authored ESM (.mjs) so `import` is native — no tsc CommonJS rewrite.
//
// Protocol (child_process IPC, 'advanced'/v8 serialization → Float32Array survives):
//   in:  { type:'init', model, cacheDir, smartTurn:{path,url} }
//   in:  { type:'transcribe', id, pcm:Float32Array }
//   in:  { type:'turn', id, pcm:Float32Array }
//   out: { type:'ready' } | { type:'turnReady' } | { type:'turnUnavailable', message }
//        { type:'result', id, text } | { type:'turnResult', id, prob }
//        { type:'error', id, message }

import { pipeline, env, WhisperFeatureExtractor } from '@huggingface/transformers';
import * as ortweb from 'onnxruntime-web';
import * as fs from 'fs';
import * as https from 'https';

const SR = 16000;
const TURN_SAMPLES = 8 * SR; // Smart Turn looks at the last 8s

let asr = null;
let asrLoad = null;
let asrModel = '';      // current ASR model id — decides transcribe options
let turnSession = null;
let turnLoad = null;
let featureExtractor = null;

// ─── Local ASR (Moonshine or Whisper, via transformers.js v3) ─────────────────

async function ensureASR(model, cacheDir, dtype) {
  if (asr) return;
  if (asrLoad) return asrLoad;
  asrLoad = (async () => {
    env.cacheDir = cacheDir;
    env.allowLocalModels = true;
    asrModel = model;
    asr = await pipeline('automatic-speech-recognition', model, dtype ? { dtype } : undefined);
    process.send({ type: 'ready' });
  })();
  return asrLoad;
}

// ─── Smart Turn v3 (semantic end-of-turn) ────────────────────────────────────

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const tmp = dest + '.part';
    const file = fs.createWriteStream(tmp);
    https.get(url, { headers: { 'User-Agent': 'cosmo' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close(); fs.rmSync(tmp, { force: true });
        return downloadFile(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) { file.close(); fs.rmSync(tmp, { force: true }); return reject(new Error('HTTP ' + res.statusCode)); }
      res.pipe(file);
      file.on('finish', () => file.close(() => { fs.renameSync(tmp, dest); resolve(); }));
    }).on('error', (e) => { file.close(); fs.rmSync(tmp, { force: true }); reject(e); });
  });
}

async function ensureTurn(cfg) {
  if (turnSession) return;
  if (turnLoad) return turnLoad;
  turnLoad = (async () => {
    if (!fs.existsSync(cfg.path)) {
      fs.mkdirSync(cfg.path.replace(/\/[^/]+$/, ''), { recursive: true });
      await downloadFile(cfg.url, cfg.path);
    }
    // Whisper-tiny mel frontend, configured for 8s (= 800 frames) like pipecat's
    // WhisperFeatureExtractor(chunk_length=8).
    featureExtractor = new WhisperFeatureExtractor({
      feature_size: 80, sampling_rate: SR, hop_length: 160, n_fft: 400,
      chunk_length: 8, n_samples: TURN_SAMPLES, nb_max_frames: 800, padding_value: 0.0,
    });
    ortweb.env.wasm.numThreads = 1;
    ortweb.env.logLevel = 'error';
    turnSession = await ortweb.InferenceSession.create(cfg.path);
    process.send({ type: 'turnReady' });
  })();
  return turnLoad;
}

// truncate to last 8s, else left-pad with zeros (audio at the END)
function fitLast(audio) {
  if (audio.length >= TURN_SAMPLES) return audio.slice(audio.length - TURN_SAMPLES);
  const out = new Float32Array(TURN_SAMPLES);
  out.set(audio, TURN_SAMPLES - audio.length);
  return out;
}
// do_normalize=True: zero-mean unit-variance over the padded waveform
function zeroMeanUnitVar(x) {
  let sum = 0; for (let i = 0; i < x.length; i++) sum += x[i];
  const mean = sum / x.length;
  let v = 0; for (let i = 0; i < x.length; i++) v += (x[i] - mean) ** 2;
  const std = Math.sqrt(v / x.length + 1e-7);
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = (x[i] - mean) / std;
  return out;
}

async function turnProbability(pcm) {
  const { input_features } = await featureExtractor._call(zeroMeanUnitVar(fitLast(pcm)));
  const tensor = new ortweb.Tensor('float32', input_features.data, input_features.dims);
  const out = await turnSession.run({ input_features: tensor });
  const logit = out.logits.data[0];
  return 1 / (1 + Math.exp(-logit)); // sigmoid → P(turn complete)
}

// ─── Message loop ────────────────────────────────────────────────────────────

process.on('message', async (msg) => {
  if (msg.type === 'init') {
    try {
      await ensureASR(msg.model, msg.cacheDir, msg.dtype);
    } catch (err) {
      process.send({ type: 'error', id: -1, message: String(err?.message ?? err) });
    }
    if (msg.smartTurn) {
      ensureTurn(msg.smartTurn).catch((err) =>
        process.send({ type: 'turnUnavailable', message: String(err?.message ?? err) }));
    }
    return;
  }

  if (msg.type === 'transcribe') {
    try {
      if (!asr) throw new Error('ASR not initialised');
      // Whisper needs the language/task/30s-chunk options; Moonshine is English-
      // only, has no forced decoder ids, and processes the clip as-is (its whole
      // speed advantage), so it gets none of them.
      const isWhisper = /whisper/i.test(asrModel);
      const opts = isWhisper
        ? { language: 'english', task: 'transcribe', chunk_length_s: 30, return_timestamps: false }
        : { return_timestamps: false };
      const result = await asr(msg.pcm, opts);
      process.send({ type: 'result', id: msg.id, text: (result?.text ?? '').trim() });
    } catch (err) {
      process.send({ type: 'error', id: msg.id, message: String(err?.message ?? err) });
    }
    return;
  }

  if (msg.type === 'turn') {
    try {
      if (!turnSession) await turnLoad; // may still be loading
      if (!turnSession) throw new Error('Smart Turn unavailable');
      const prob = await turnProbability(msg.pcm);
      process.send({ type: 'turnResult', id: msg.id, prob });
    } catch (err) {
      process.send({ type: 'turnResult', id: msg.id, prob: null, message: String(err?.message ?? err) });
    }
  }
});

process.on('disconnect', () => process.exit(0));
