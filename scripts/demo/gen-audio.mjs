/* Render every spoken line to a WAV using real TTS.
   Primary: Groq PlayAI TTS (key from repo .env). Fallback: macOS `say`.
   Outputs scripts/demo/out/audio/<id>.wav and durations.json. */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { BEATS } from './timeline.mjs';

const root = process.cwd();
const outDir = path.join(root, 'scripts/demo/out/audio');
fs.mkdirSync(outDir, { recursive: true });

// --- read GROQ key from .env (no printing) ---
let GROQ = '';
try {
  const env = fs.readFileSync(path.join(root, '.env'), 'utf8');
  const m = env.match(/^\s*GROQ_API_KEY\s*=\s*(.+)\s*$/m);
  if (m) GROQ = m[1].trim().replace(/^["']|["']$/g, '');
} catch {}

const GROQ_VOICE = { narrator: 'Atlas-PlayAI', user: 'Quinn-PlayAI', cosmo: 'Celeste-PlayAI' };
const SAY_VOICE  = { narrator: 'Daniel',       user: 'Alex',         cosmo: 'Samantha' };

function dur(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]).toString().trim();
  return parseFloat(out) || 0;
}

async function groqTTS(text, voice, dest) {
  const r = await fetch('https://api.groq.com/openai/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${GROQ}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'playai-tts', input: text, voice, response_format: 'wav' }),
  });
  if (!r.ok) throw new Error(`groq ${r.status}: ${(await r.text()).slice(0, 120)}`);
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
}

function sayTTS(text, voice, dest) {
  const aiff = dest.replace(/\.wav$/, '.aiff');
  try { execFileSync('say', ['-v', voice, '-o', aiff, text]); }
  catch { execFileSync('say', ['-o', aiff, text]); }   // default voice if named one missing
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', aiff, '-ar', '24000', '-ac', '1', dest]);
  fs.rmSync(aiff, { force: true });
}

const durations = {};
let engine = GROQ ? 'groq' : 'say';
for (const b of BEATS) {
  if (!b.speaker || !b.text) continue;
  const dest = path.join(outDir, `${b.id}.wav`);
  let used = engine;
  try {
    if (engine === 'groq') await groqTTS(b.text, GROQ_VOICE[b.speaker], dest);
    else sayTTS(b.text, SAY_VOICE[b.speaker], dest);
  } catch (e) {
    console.log(`  ${b.id}: ${engine} failed (${e.message}) → say`);
    used = 'say'; engine = 'say'; // stick to say once groq is unavailable
    sayTTS(b.text, SAY_VOICE[b.speaker], dest);
  }
  durations[b.id] = dur(dest);
  console.log(`  ${b.id.padEnd(10)} ${used.padEnd(4)} ${durations[b.id].toFixed(2)}s  "${b.text.slice(0, 40)}"`);
}

fs.writeFileSync(path.join(root, 'scripts/demo/out/durations.json'), JSON.stringify(durations, null, 2));
console.log('\naudio engine:', engine, '· wrote', Object.keys(durations).length, 'clips → out/audio/');
