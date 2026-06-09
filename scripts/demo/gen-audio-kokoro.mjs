/* Render the demo voiceover with the REAL Kokoro TTS (kokoro-js), so the video
   sounds exactly like the app. Cosmo + narration = Bella (af_bella); the human
   "user" lines use a distinct Kokoro voice so the two are easy to tell apart.
   Outputs scripts/demo/out/audio/<id>.wav + durations.json.

   Run under system node (onnxruntime), e.g.:  node scripts/demo/gen-audio-kokoro.mjs */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { KokoroTTS } from 'kokoro-js';
import { BEATS } from './timeline.mjs';

const root = process.cwd();
const outDir = path.join(root, 'scripts/demo/out/audio');
fs.mkdirSync(outDir, { recursive: true });

const VOICE = { cosmo: 'af_bella', narrator: 'af_bella', user: 'af_nova' };

const dur = (f) => parseFloat(
  execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', f]).toString().trim()
) || 0;

console.log('loading Kokoro (downloads ~80MB on first run)…');
const tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'cpu' });
console.log('Kokoro ready. Rendering…');

const durations = {};
for (const b of BEATS) {
  if (!b.speaker || !b.text) continue;
  const dest = path.join(outDir, `${b.id}.wav`);
  const audio = await tts.generate(b.text, { voice: VOICE[b.speaker] });
  await audio.save(dest);                       // 24kHz wav
  durations[b.id] = dur(dest);
  console.log(`  ${b.id.padEnd(10)} ${VOICE[b.speaker].padEnd(9)} ${durations[b.id].toFixed(2)}s  "${b.text.slice(0, 42)}"`);
}

fs.writeFileSync(path.join(root, 'scripts/demo/out/durations.json'), JSON.stringify(durations, null, 2));
console.log('\nwrote', Object.keys(durations).length, 'Kokoro clips → out/audio/  (Cosmo/narration = af_bella)');
