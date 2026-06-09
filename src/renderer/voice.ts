// Renderer-side voice capture using Silero VAD (@ricky0123/vad-web).
//
// Always-on model: one MicVAD runs continuously. Each detected utterance is
// emitted as a 16kHz WAV; the main process decides (wake word + Smart Turn)
// what to do. The VAD is NOT torn down between utterances — main pauses it via
// pauseListening() while Cosmo speaks (echo control) and resumes after.
//
// A mic-dot click sets a one-shot flag so the next utterance is sent as an
// explicit command (bypasses the wake word) — a guaranteed manual entry point.

import { MicVAD } from '@ricky0123/vad-web';

let vad: MicVAD | null = null;
let running = false;
let forceCommandNext = false;
let onUtterance: ((wav: ArrayBuffer, mode: 'wake' | 'command') => void) | null = null;
let onState: ((state: 'listening' | 'idle') => void) | null = null;

export function isVoiceListening(): boolean { return running; }

/** Register the utterance/state callbacks WITHOUT opening the mic. Push-to-talk
 *  mode primes these at boot so a later mic-dot click can rebuild + arm the VAD
 *  on demand (triggerCommandCapture → restartListening needs the callbacks set),
 *  while the mic stays physically closed until the user actually taps it. */
export function primeVoice(
  utteranceCb: (wav: ArrayBuffer, mode: 'wake' | 'command') => void,
  stateCb: (state: 'listening' | 'idle') => void,
): void {
  onUtterance = utteranceCb;
  onState = stateCb;
}

/** Create a fresh MicVAD with the stored callbacks. Pulled out of startListening
 *  so we can REBUILD it after the audio context dies — a missing/disconnected
 *  output device can poison the renderer's audio stack, leaving a vad whose
 *  start() silently no-ops. Rebuilding gets a clean AudioContext. */
async function buildVad(): Promise<MicVAD> {
  return MicVAD.new({
    baseAssetPath: './',
    onnxWASMBasePath: './',
    model: 'v5',
    positiveSpeechThreshold: 0.6,   // higher bar → ignore ambient room noise
    negativeSpeechThreshold: 0.4,
    minSpeechFrames: 9,        // ~290ms minimum — rejects coughs, clicks, brief noise
    redemptionFrames: 18,      // ~0.58s trailing silence ends a segment (Smart Turn refines)
    preSpeechPadFrames: 8,     // keep audio just before onset

    onSpeechStart: () => { onState?.('listening'); },

    onSpeechEnd: (audio: Float32Array) => {
      const mode = forceCommandNext ? 'command' : 'wake';
      forceCommandNext = false;
      onState?.('idle');
      onUtterance?.(float32ToWav(audio, 16000), mode);
    },

    onVADMisfire: () => { forceCommandNext = false; onState?.('idle'); },
  });
}

/** Start the always-on listener. Safe to call once on boot. */
export async function startListening(
  utteranceCb: (wav: ArrayBuffer, mode: 'wake' | 'command') => void,
  stateCb: (state: 'listening' | 'idle') => void,
): Promise<void> {
  onUtterance = utteranceCb;
  onState = stateCb;
  if (vad) { resumeListening(); return; }

  try {
    vad = await buildVad();
    running = true;
    vad.start();
    console.log('[voice] listening started');
  } catch (e) {
    console.error('[voice] VAD init failed:', e);
    running = false;
    onState?.('idle');
  }
}

/** Tear down and recreate the VAD from scratch. Recovers from a dead audio
 *  context (the `device []` playback failure) that leaves the mic silently dead
 *  even though we think we're listening. */
export async function restartListening(): Promise<void> {
  console.warn('[voice] restarting VAD (recovering mic)');
  try { vad?.pause(); vad?.destroy(); } catch { /* ignore */ }
  vad = null;
  running = false;
  if (!onUtterance || !onState) return; // never started — nothing to restore
  try {
    vad = await buildVad();
    running = true;
    vad.start();
    console.log('[voice] listening restarted');
  } catch (e) {
    console.error('[voice] VAD restart failed:', e);
    running = false;
  }
}

/** Treat the next spoken utterance as an explicit command (skip wake word). This
 *  is the push-to-talk path and must ALWAYS work — if the VAD looks dead, rebuild
 *  it before arming, so a prior audio glitch can't kill the mic button too. */
export async function triggerCommandCapture(): Promise<void> {
  forceCommandNext = true;
  if (!vad) { await restartListening(); return; }
  resumeListening();
}

export function pauseListening(): void {
  if (vad && running) { try { vad.pause(); } catch { /* ignore */ } running = false; }
}

export function resumeListening(): void {
  if (!vad) { void restartListening(); return; }
  if (!running) {
    try { vad.start(); running = true; }
    catch (e) { console.error('[voice] resume failed, rebuilding:', e); void restartListening(); }
  }
}

export async function stopListening(): Promise<void> {
  forceCommandNext = false;
  running = false;
  if (vad) {
    try { vad.pause(); vad.destroy(); } catch { /* ignore */ }
    vad = null;
  }
}

// ─── WAV encoding (16-bit PCM) ───────────────────────────────────────────────

function float32ToWav(float32: Float32Array, sampleRate: number): ArrayBuffer {
  const n = float32.length;
  const buffer = new ArrayBuffer(44 + n * 2);
  const view = new DataView(buffer);
  const ws = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); view.setUint32(4, 36 + n * 2, true); ws(8, 'WAVE');
  ws(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true);
  view.setUint16(34, 16, true); ws(36, 'data'); view.setUint32(40, n * 2, true);
  let idx = 44;
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(idx, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    idx += 2;
  }
  return buffer;
}
