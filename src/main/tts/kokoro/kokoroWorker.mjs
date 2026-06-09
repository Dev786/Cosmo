// Kokoro TTS worker — runs as a child_process.fork under the SYSTEM node binary
// (NOT Electron), exactly like the STT (whisperWorker) and embedder workers.
//
// WHY THIS EXISTS: kokoro-js synthesis runs ONNX + the phonemizer on the calling
// JS thread. In-process that blocked Electron's main thread ~400ms PER SENTENCE
// (measured), and because 'speaking' mood is only set when real audio starts, the
// face froze while still showing "thinking". Moving synthesis here keeps every
// heavy step (model load, ONNX inference, phonemization, WAV encode) OFF the main
// thread — main only afplay's the finished WAV files this worker hands back.
// (Bonus: like the STT worker, real node sidesteps the ONNX-threading crashes that
// forced fp32 in-process.)
//
// Hand-authored ESM (.mjs) so `import` is native — no tsc CommonJS rewrite.
//
// Protocol (child_process IPC):
//   in:  { type:'init', dtype, device }
//   in:  { type:'speak', id, text, voice, speed }
//   in:  { type:'abort', id }                       (barge-in: stop synthesizing ahead)
//   out: { type:'ready' } | { type:'error', id:-1, message }
//        { type:'chunk', id, file, durMs } (×N, in order)
//        { type:'done', id, spoke } | { type:'error', id, message }

import { KokoroTTS, TextSplitterStream } from 'kokoro-js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let tts = null;
let initPromise = null;
const aborted = new Set(); // ids barge-in cancelled mid-stream

async function ensureInit(dtype, device) {
  if (tts) return;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    // fp32 was forced in-process because q8 crashed under Electron's ONNX threading;
    // off Electron that may no longer hold, but keep fp32 here for parity until re-tested.
    tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-ONNX', {
      dtype: dtype || 'fp32',
      device: device || 'cpu',
    });
  })();
  return initPromise;
}

// Encode one synthesized chunk as a mono IEEE-float WAV → temp file path. Float32
// is little-endian on macOS, exactly what WAV IEEE-float wants, so we view the
// samples directly (no per-sample write loop).
function writeWav(audio, sampleRate) {
  const numChannels = 1, bitsPerSample = 32;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = audio.length * (bitsPerSample / 8);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(3, 20); // IEEE float PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  const pcm = Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength);
  const file = path.join(os.tmpdir(), `cosmo-tts-${process.pid}-${Date.now()}-${audio.length}.wav`);
  fs.writeFileSync(file, Buffer.concat([header, pcm]));
  return file;
}

// Stream sentence-by-sentence so main can start playing the first sentence while we
// synthesize the rest. A plain string never closes the splitter → hangs, so we
// drive it explicitly with push()+close() (same as the old in-process path).
async function speak(id, text, voice, speed) {
  if (!tts) throw new Error('Kokoro not initialised');
  const splitter = new TextSplitterStream();
  const stream = tts.stream(splitter, { voice, speed });
  splitter.push(text);
  splitter.close();
  let spoke = false;
  for await (const chunk of stream) {
    if (aborted.has(id)) break;
    const audio = chunk?.audio?.audio;
    const sampleRate = chunk?.audio?.sampling_rate ?? 24000;
    if (!audio || !audio.length) continue;
    const file = writeWav(audio, sampleRate);
    const durMs = (audio.length / sampleRate) * 1000;
    spoke = true;
    process.send({ type: 'chunk', id, file, durMs });
  }
  aborted.delete(id);
  return spoke;
}

process.on('message', async (msg) => {
  if (msg.type === 'init') {
    try { await ensureInit(msg.dtype, msg.device); process.send({ type: 'ready' }); }
    catch (err) { process.send({ type: 'error', id: -1, message: String(err?.message ?? err) }); }
    return;
  }
  if (msg.type === 'abort') { aborted.add(msg.id); return; }
  if (msg.type === 'speak') {
    try {
      await ensureInit(msg.dtype, msg.device);
      const spoke = await speak(msg.id, msg.text, msg.voice ?? 'af_heart', msg.speed ?? 1.1);
      process.send({ type: 'done', id: msg.id, spoke });
    } catch (err) {
      process.send({ type: 'error', id: msg.id, message: String(err?.message ?? err) });
    }
  }
});

process.on('disconnect', () => process.exit(0));
