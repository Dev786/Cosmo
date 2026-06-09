// Validate Smart Turn v3 end-to-end in JS before integrating.
// Replicates pipecat's preprocessing exactly:
//   truncate_audio_to_last_n_seconds(audio, 8)  -> left-pad zeros to 128000
//   WhisperFeatureExtractor(chunk_length=8) with do_normalize=True
//   ONNX run -> logits -> sigmoid -> >0.5 == turn complete
// Test inputs are REAL speech from macOS `say`, so we can check the model
// separates a finished sentence from one cut off mid-word.
import ort from 'onnxruntime-node';
import { WhisperFeatureExtractor } from '@xenova/transformers';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const SR = 16000;
const N = 8 * SR; // 128000
const MODEL = path.join(os.homedir(), '.pixel/models/smart-turn/smart-turn-v3.0.onnx');

// WhisperFeatureExtractor configured for 8s like pipecat's WhisperFeatureExtractor(chunk_length=8)
const fe = new WhisperFeatureExtractor({
  feature_size: 80, sampling_rate: SR, hop_length: 160, n_fft: 400,
  chunk_length: 8, n_samples: N, nb_max_frames: 800, padding_value: 0.0,
});

function sayWav(text) {
  const f = path.join(os.tmpdir(), 'st-' + text.replace(/\W+/g, '_').slice(0, 20) + '.wav');
  execFileSync('say', ['-o', f, '--file-format=WAVE', '--data-format=LEI16@16000', text]);
  return f;
}
function wavToFloat32(file) {
  const buf = fs.readFileSync(file);
  let off = buf.slice(0, 4).toString() === 'RIFF' ? 44 : 0;
  const n = Math.floor((buf.length - off) / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(off + i * 2) / 32768;
  return out;
}
// truncate_audio_to_last_n_seconds + left-pad to N
function fitLast(audio) {
  if (audio.length >= N) return audio.slice(audio.length - N);
  const out = new Float32Array(N);
  out.set(audio, N - audio.length); // audio at the END, zeros at the start
  return out;
}
// do_normalize=True: zero-mean unit-var over the (padded) waveform
function zmuv(x) {
  let sum = 0; for (let i = 0; i < x.length; i++) sum += x[i];
  const mean = sum / x.length;
  let v = 0; for (let i = 0; i < x.length; i++) v += (x[i] - mean) ** 2;
  const std = Math.sqrt(v / x.length + 1e-7);
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = (x[i] - mean) / std;
  return out;
}

const session = await ort.InferenceSession.create(MODEL);

async function prob(audio) {
  const norm = zmuv(fitLast(audio));
  const { input_features } = await fe._call(norm); // [1,80,800]
  const t = new ort.Tensor('float32', input_features.data, input_features.dims);
  const out = await session.run({ input_features: t });
  const logit = out.logits.data[0];
  return 1 / (1 + Math.exp(-logit));
}

const full = wavToFloat32(sayWav('what is the weather in San Francisco today'));
const completeP = await prob(full);                       // ends at sentence boundary + trailing silence
const cutP = await prob(full.slice(0, Math.floor(full.length * 0.5))); // cut mid-sentence
const silenceP = await prob(new Float32Array(SR));        // 1s silence

console.log('complete sentence  prob =', completeP.toFixed(4), completeP > 0.5 ? '✓ COMPLETE' : '✗ (expected complete)');
console.log('cut mid-sentence   prob =', cutP.toFixed(4), cutP < 0.5 ? '✓ INCOMPLETE' : '✗ (expected incomplete)');
console.log('pure silence       prob =', silenceP.toFixed(4));
console.log('feature dims:', (await fe._call(zmuv(fitLast(full)))).input_features.dims.join('x'));
