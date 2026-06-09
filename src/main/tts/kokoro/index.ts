import * as path from 'path';
import * as fs from 'fs';
import { fork, type ChildProcess } from 'child_process';
import type { TTSProvider } from '../types';
import { log } from '../../core/log';
import { resolveNodePath } from '../../core/systemNode';

// Kokoro voices (af_ = American Female, am_ = American Male, bf_ = British Female)
export const KOKORO_VOICES = {
  // American Female — recommended for Cosmo
  af_heart: 'af_heart',       // Grade A — warmest, most natural
  af_bella: 'af_bella',       // Grade A- — expressive
  af_nicole: 'af_nicole',     // Grade B- — clear, friendly
  af_sarah: 'af_sarah',       // natural
  af_sky: 'af_sky',           // bright
  af_nova: 'af_nova',
  af_kore: 'af_kore',
  af_alloy: 'af_alloy',
  // British Female
  bf_emma: 'bf_emma',
  bf_isabella: 'bf_isabella',
  // American Male (fallback)
  am_adam: 'am_adam',
  am_michael: 'am_michael',
} as const;

export type KokoroVoice = keyof typeof KOKORO_VOICES;
export const DEFAULT_VOICE: KokoroVoice = 'af_heart'; // Grade A — warmest, most natural

// ─── Forked synthesis worker ─────────────────────────────────────────────────
// Synthesis (model load + ONNX + phonemizer) runs in kokoroWorker.mjs under a real
// system node, NOT here. In-process it blocked Electron's main thread ~400ms per
// sentence (measured) and froze the face mid-"thinking". The main side now only
// spawns the worker, queues the WAV files it returns into afplay, and handles
// barge-in — never any ONNX. Mirrors the STT (whisperWorker) + embedder workers.

let worker: ChildProcess | null = null;
let ready = false;
let readyPromise: Promise<void> | null = null;
let nextId = 1;

interface Pending {
  onChunk: (file: string, durMs: number) => void;
  resolve: (spoke: boolean) => void;
  reject: (e: Error) => void;
}
const pending = new Map<number, Pending>();

function workerPath(): string {
  return path.join(__dirname, 'kokoroWorker.mjs');
}

function ensureWorker(): Promise<void> {
  if (ready) return Promise.resolve();
  if (readyPromise) return readyPromise;

  readyPromise = new Promise<void>((resolve, reject) => {
    const nodePath = resolveNodePath();
    log.info(`Spawning Kokoro TTS worker under node: ${nodePath} (first run downloads ~90MB model)...`);

    const childEnv = { ...process.env };
    delete childEnv.ELECTRON_RUN_AS_NODE;

    worker = fork(workerPath(), [], {
      execPath: nodePath,
      execArgv: [],
      serialization: 'advanced',
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: childEnv,
    });

    worker.stdout?.on('data', (d: Buffer) => log.debug('kokoro-worker:', d.toString().trim()));
    worker.stderr?.on('data', (d: Buffer) => {
      const s = d.toString().trim();
      if (!s.includes('CleanUnusedInitializers') && !s.includes('onnxruntime')) log.debug('kokoro-worker-err:', s);
    });

    worker.on('message', (msg: { type: string; id?: number; file?: string; durMs?: number; spoke?: boolean; message?: string }) => {
      switch (msg.type) {
        case 'ready':
          ready = true;
          log.info('Kokoro TTS worker ready.');
          resolve();
          break;
        case 'chunk':
          if (msg.id != null && msg.file) pending.get(msg.id)?.onChunk(msg.file, msg.durMs ?? 0);
          break;
        case 'done':
          if (msg.id != null) { pending.get(msg.id)?.resolve(msg.spoke ?? false); pending.delete(msg.id); }
          break;
        case 'error':
          // id >= 0 → a speak() request failed; id -1 (or no pending) → init failed.
          if (msg.id != null && msg.id >= 0 && pending.has(msg.id)) {
            pending.get(msg.id)!.reject(new Error(msg.message ?? 'kokoro synth error'));
            pending.delete(msg.id);
          } else {
            log.error('Kokoro worker init error:', msg.message);
            reject(new Error(msg.message ?? 'kokoro init failed'));
          }
          break;
      }
    });

    worker.on('exit', (code, signal) => {
      log.warn(`Kokoro worker exited (code ${code}, signal ${signal ?? 'none'})`);
      ready = false; worker = null; readyPromise = null;
      for (const p of pending.values()) p.reject(new Error('kokoro worker exited'));
      pending.clear();
    });

    worker.send({ type: 'init', dtype: 'fp32', device: 'cpu' });
  });

  return readyPromise;
}

// Play one finished WAV file: afplay + barge-in kill + a watchdog (a missing/
// disconnected output device can make afplay hang forever), then delete the temp
// file. This is the only audio work left on the main thread — and afplay is an
// external process, so it never blocks the event loop.
async function playFile(file: string, durMs: number, signal?: AbortSignal, onAudioStart?: () => void): Promise<void> {
  if (signal?.aborted) { fs.unlink(file, () => {}); return; }
  const { execFile } = await import('child_process');
  onAudioStart?.(); // this chunk is about to play — sync the talk animation to it
  await new Promise<void>((resolve) => {
    const child = execFile('afplay', [file], () => resolve());
    const onAbort = (): void => { try { child.kill('SIGKILL'); } catch { /* already gone */ } };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    const watchdog = setTimeout(() => {
      log.warn(`afplay overran (${Math.round(durMs)}ms clip) — killing to unblock speech`);
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      resolve();
    }, durMs + 4000);
    child.on('exit', () => { clearTimeout(watchdog); signal?.removeEventListener('abort', onAbort); });
  });
  fs.unlink(file, () => {});
}

export const kokoroTTSProvider: TTSProvider = {
  name: 'kokoro',
  offline: true,

  async init(): Promise<void> {
    await ensureWorker();
  },

  async speak(text, opts): Promise<void> {
    const signal = opts?.signal;
    let spoke = false; // declared outside try so the catch can avoid replaying audio
    try {
      await ensureWorker();
      if (!worker) throw new Error('Kokoro worker unavailable');

      const voice = (opts?.voice ?? DEFAULT_VOICE) as string;
      const speed = opts?.rate ? opts.rate / 175 : 1.1; // slightly faster = cuter
      const id = nextId++;

      // Barge-in: tell the worker to stop synthesizing ahead (playFile kills the
      // currently-playing afplay separately via the same signal).
      const onAbort = (): void => { try { worker?.send({ type: 'abort', id }); } catch { /* gone */ } };
      if (signal) signal.addEventListener('abort', onAbort, { once: true });

      // Play chunks strictly in order as they arrive, while the worker keeps
      // synthesizing the rest — first chunk starts the talk animation.
      let playChain: Promise<void> = Promise.resolve();
      const producedSpoke = await new Promise<boolean>((resolve, reject) => {
        pending.set(id, {
          onChunk: (file, durMs) => {
            const first = !spoke;
            spoke = true;
            playChain = playChain
              .then(() => playFile(file, durMs, signal, first ? opts?.onAudioStart : undefined))
              .catch((err) => log.debug('TTS chunk playback:', (err as Error).message));
          },
          resolve,
          reject,
        });
        worker!.send({ type: 'speak', id, text, voice, speed });
      });

      signal?.removeEventListener('abort', onAbort);
      await playChain; // let any queued chunks finish playing before we return
      if (!producedSpoke && !signal?.aborted) throw new Error('Kokoro produced no audio');
    } catch (e) {
      if (signal?.aborted) return;         // interrupted on purpose — don't fall back
      if (spoke) { log.error('Kokoro TTS errored mid-utterance:', (e as Error).message); return; } // don't replay
      log.error('Kokoro TTS failed, falling back to macOS say:', (e as Error).message);
      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      opts?.onAudioStart?.(); // the fallback voice is about to play
      await promisify(execFile)('say', ['-v', 'Samantha', text]).catch(() => {});
    }
  },

  dispose(): void {
    try { worker?.kill(); } catch { /* already gone */ }
    worker = null; ready = false; readyPromise = null; pending.clear();
  },
};
