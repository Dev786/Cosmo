// Diagnostic: load small.en and run ONE inference on synthetic audio.
// Run two ways to localise the utilityProcess crash:
//   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/diag-whisper.mjs   (pure-Node Electron)
//   node scripts/diag-whisper.mjs                                                   (system node)
import { pipeline, env } from '@xenova/transformers';
import * as path from 'path';
import * as os from 'os';

const MODEL = 'Xenova/whisper-small.en';
env.cacheDir = path.join(os.homedir(), '.pixel', 'models');
env.allowLocalModels = true;

const t0 = Date.now();
console.log('[diag] node', process.versions.node, 'modules', process.versions.modules, 'electron', process.versions.electron ?? '(none)');
const asr = await pipeline('automatic-speech-recognition', MODEL);
console.log('[diag] pipeline loaded in', Date.now() - t0, 'ms');

// 2s of low white noise @16kHz — enough to exercise encoder+decoder run()
const pcm = new Float32Array(32000);
for (let i = 0; i < pcm.length; i++) pcm[i] = (Math.sin(i / 7) * 0.02);

const t1 = Date.now();
const out = await asr(pcm, { language: 'english', task: 'transcribe', chunk_length_s: 30, return_timestamps: false });
console.log('[diag] INFERENCE OK in', Date.now() - t1, 'ms →', JSON.stringify(out));
process.exit(0);
