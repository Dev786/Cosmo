// Generate the REAL Cosmo voice(s) for the website demo (demos.php).
//
// Cosmo speaks with Kokoro (onnx-community/Kokoro-82M-ONNX) at speed 1.1 — exactly
// the defaults the shipping app uses (src/shared/types CONFIG_DEFAULTS + kokoro/
// index.ts). So these clips are genuinely how Cosmo sounds on a Mac — no stand-in
// browser voice, no bluff.
//
// The demo lets a visitor switch voices live, so we record the SAME line set in a
// few good LOCAL voices. The picks (by the grades in kokoro/index.ts, all American
// Female so Cosmo still reads as one small kid, just different timbres):
//   af_heart  — Grade A,  warmest/most natural (the shipping default)
//   af_bella  — Grade A-, expressive/animated
//   af_nicole — Grade B-, clear & friendly
//
// We synthesize each line the same way kokoroWorker.mjs does, write a mono IEEE-float
// WAV, transcode to a small web MP3, and emit a manifest the demo loads to build the
// voice dropdown.
//
// Run once (downloads the ~300MB model on first run):  node scripts/gen-demo-voice.mjs

import { KokoroTTS, TextSplitterStream } from 'kokoro-js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const SPEED = 1.1; // kokoro/index.ts: "slightly faster = cuter"
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'cosmo-site', 'assets', 'media', 'voice');

// Voices offered in the demo dropdown. `default` marks the shipping voice.
const VOICES = [
  { id: 'af_heart',  label: 'Heart — warm',             default: true },
  { id: 'af_bella',  label: 'Bella — expressive' },
  { id: 'af_nicole', label: 'Nicole — clear & friendly' },
];

// The lines Cosmo says in the demo. Each obeys SOUL.md: one short happy sentence,
// plain spoken words, no URLs/symbols/markdown, childlike and bright. `text` is BOTH
// what he says (audio) and what the bubble shows.
const LINES = [
  { id: 'search',     text: 'Okay! I looked it up and found some good papers. I popped them in your sources!' },
  { id: 'greet',      text: 'Hi! Yay, you are here!' },
  { id: 'whatareyou', text: 'I am Cosmo, your little desktop buddy! I hear you and I talk back.' },
  { id: 'timer',      text: 'Okay! Your timer is set. I will tell you when it is done!' },
  { id: 'note',       text: 'Got it! I will remember that for you.' },
  { id: 'fallback',   text: 'Ooh! On your Mac I can really do that. Here I only know a few tricks!' },
];

function writeWav(samples, sampleRate) {
  const numChannels = 1, bitsPerSample = 32;
  const dataSize = samples.length * (bitsPerSample / 8);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(3, 20); // IEEE float PCM (matches kokoroWorker.mjs)
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
  header.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  const pcm = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  const file = path.join(os.tmpdir(), `cosmo-demo-${Date.now()}-${samples.length}.wav`);
  fs.writeFileSync(file, Buffer.concat([header, pcm]));
  return file;
}

// Synthesize one line the same way kokoroWorker.mjs does (stream + concat chunks).
async function synth(tts, text, voice) {
  const splitter = new TextSplitterStream();
  const stream = tts.stream(splitter, { voice, speed: SPEED });
  splitter.push(text);
  splitter.close();
  const chunks = [];
  let sampleRate = 24000;
  for await (const chunk of stream) {
    const audio = chunk?.audio?.audio;
    if (chunk?.audio?.sampling_rate) sampleRate = chunk.audio.sampling_rate;
    if (audio?.length) chunks.push(audio);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const all = new Float32Array(total);
  let off = 0;
  for (const c of chunks) { all.set(c, off); off += c.length; }
  return { samples: all, sampleRate };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Loading Kokoro @ ${SPEED}x — first run downloads ~300MB…`);
  const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-ONNX', { dtype: 'fp32', device: 'cpu' });

  const clips = {};
  for (const v of VOICES) {
    fs.mkdirSync(path.join(OUT_DIR, v.id), { recursive: true });
    clips[v.id] = {};
    console.log(`\n${v.id} (${v.label})`);
    for (const { id, text } of LINES) {
      process.stdout.write(`  synth ${id}… `);
      const { samples, sampleRate } = await synth(tts, text, v.id);
      const wav = writeWav(samples, sampleRate);
      const rel = `assets/media/voice/${v.id}/${id}.mp3`;
      const mp3 = path.join(ROOT, 'cosmo-site', rel);
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-codec:a', 'libmp3lame', '-qscale:a', '5', mp3]);
      fs.unlinkSync(wav);
      const durMs = Math.round((samples.length / sampleRate) * 1000);
      clips[v.id][id] = { file: rel, durMs };
      console.log(`${(fs.statSync(mp3).size / 1024).toFixed(0)}KB · ${durMs}ms`);
    }
  }

  const manifest = {
    note: 'Real Cosmo voices — Kokoro-82M, generated by scripts/gen-demo-voice.mjs',
    speed: SPEED,
    defaultVoice: VOICES.find((v) => v.default).id,
    voices: VOICES.map((v) => ({ id: v.id, label: v.label, default: !!v.default })),
    lines: Object.fromEntries(LINES.map((l) => [l.id, l.text])),
    clips,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`\nDone → ${OUT_DIR}\n${VOICES.length} voices × ${LINES.length} lines (Cosmo's real Kokoro voices @ ${SPEED}x).`);
}

main().catch((e) => { console.error('gen-demo-voice failed:', e); process.exit(1); });
