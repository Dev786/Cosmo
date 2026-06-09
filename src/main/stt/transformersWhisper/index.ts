import * as path from 'path';
import * as os from 'os';
import { fork, type ChildProcess } from 'child_process';
import type { STTProvider } from '../types';
import { log } from '../../core/log';
import { resolveNodePath } from '../../core/systemNode';

// Default: Moonshine base (fast local ASR). Overridden from config via
// configureStt() before warmUpWhisper()/first transcription.
let MODEL = 'onnx-community/moonshine-base-ONNX';
let DTYPE: string | undefined = 'q8';
const CACHE_DIR = path.join(os.homedir(), '.pixel', 'models');

/** Set the ASR model + quantization from config. Must be called before the
 *  worker is spawned (i.e. before warmUpWhisper / the first transcribe). */
export function configureStt(model?: string, dtype?: string): void {
  if (model) MODEL = model;
  if (dtype !== undefined) DTYPE = dtype;
}

const SMART_TURN = {
  path: path.join(CACHE_DIR, 'smart-turn', 'smart-turn-v3.0.onnx'),
  url: 'https://huggingface.co/pipecat-ai/smart-turn-v3/resolve/main/smart-turn-v3.0.onnx',
};

let worker: ChildProcess | null = null;
let ready = false;
let readyPromise: Promise<void> | null = null;
let nextId = 1;

let turnReady = false;
let turnReadyResolve: (() => void) | null = null;
const turnReadyPromise = new Promise<void>((r) => { turnReadyResolve = r; });

const pendingText = new Map<number, { resolve: (text: string) => void; reject: (e: Error) => void }>();
const pendingTurn = new Map<number, (prob: number | null) => void>();

function workerPath(): string {
  return path.join(__dirname, '..', 'whisperWorker.mjs');
}

function ensureWorker(): Promise<void> {
  if (ready) return Promise.resolve();
  if (readyPromise) return readyPromise;

  readyPromise = new Promise<void>((resolve, reject) => {
    const nodePath = resolveNodePath();
    log.info(`Spawning voice worker (${MODEL} [${DTYPE ?? 'default'}] + Smart Turn v3) under node: ${nodePath}`);

    const childEnv = { ...process.env };
    delete childEnv.ELECTRON_RUN_AS_NODE;

    worker = fork(workerPath(), [], {
      execPath: nodePath,
      execArgv: [],
      serialization: 'advanced',
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: childEnv,
    });

    worker.stdout?.on('data', (d: Buffer) => log.debug('voice-worker:', d.toString().trim()));
    worker.stderr?.on('data', (d: Buffer) => {
      const s = d.toString().trim();
      if (!s.includes('CleanUnusedInitializers') && !s.includes('onnxruntime')) {
        log.debug('voice-worker-err:', s);
      }
    });

    worker.on('message', (msg: { type: string; id?: number; text?: string; prob?: number | null; message?: string }) => {
      switch (msg.type) {
        case 'ready':
          ready = true;
          log.info('Voice worker ready (STT).');
          resolve();
          break;
        case 'turnReady':
          turnReady = true;
          log.info('Smart Turn v3 ready (semantic end-of-turn).');
          turnReadyResolve?.();
          break;
        case 'turnUnavailable':
          turnReady = false;
          log.warn('Smart Turn unavailable, falling back to VAD silence:', msg.message);
          turnReadyResolve?.(); // unblock boot — we degrade gracefully
          break;
        case 'result':
          if (msg.id != null) { pendingText.get(msg.id)?.resolve(msg.text ?? ''); pendingText.delete(msg.id); }
          break;
        case 'turnResult':
          if (msg.id != null) { pendingTurn.get(msg.id)?.(msg.prob ?? null); pendingTurn.delete(msg.id); }
          break;
        case 'error':
          if (msg.id != null && pendingText.has(msg.id)) {
            pendingText.get(msg.id)!.reject(new Error(msg.message ?? 'whisper error'));
            pendingText.delete(msg.id);
          } else {
            log.error('Voice worker init error:', msg.message);
            reject(new Error(msg.message ?? 'whisper init failed'));
          }
          break;
      }
    });

    worker.on('exit', (code, signal) => {
      log.warn(`Voice worker exited (code ${code}, signal ${signal ?? 'none'})`);
      ready = false; turnReady = false; worker = null; readyPromise = null;
      for (const p of pendingText.values()) p.reject(new Error('voice worker exited'));
      pendingText.clear();
      for (const cb of pendingTurn.values()) cb(null);
      pendingTurn.clear();
    });

    worker.send({ type: 'init', model: MODEL, dtype: DTYPE, cacheDir: CACHE_DIR, smartTurn: SMART_TURN });
  });

  return readyPromise;
}

function transcribePcm(pcm: Float32Array): Promise<string> {
  if (!worker) return Promise.reject(new Error('Voice worker unavailable'));
  const id = nextId++;
  return new Promise<string>((resolve, reject) => {
    pendingText.set(id, { resolve, reject });
    worker!.send({ type: 'transcribe', id, pcm });
    setTimeout(() => {
      if (pendingText.has(id)) { pendingText.delete(id); reject(new Error('transcription timed out')); }
    }, 30_000);
  });
}

export const transformersWhisperProvider: STTProvider = {
  name: 'whisperLocal',
  offline: true,
  async transcribe(audioBuffer: Buffer): Promise<string> {
    await ensureWorker();
    return transcribePcm(pcm16ToFloat32(audioBuffer));
  },
};

/** Transcribe 16kHz mono Float32 PCM directly (main accumulates turns as Float32). */
export async function transcribeAudio(pcm: Float32Array): Promise<string> {
  await ensureWorker();
  return transcribePcm(pcm);
}

/** Is semantic turn detection available yet? */
export function isTurnDetectionReady(): boolean { return turnReady; }
export function whenTurnReady(): Promise<void> { return turnReadyPromise; }

/**
 * Smart Turn v3 probability that the speaker has finished their turn, for the
 * given 16kHz mono PCM (Float32, -1..1). Returns null if unavailable (caller
 * should fall back to VAD silence).
 */
export function detectEndOfTurn(pcm: Float32Array): Promise<number | null> {
  if (!worker || !turnReady) return Promise.resolve(null);
  const id = nextId++;
  return new Promise<number | null>((resolve) => {
    pendingTurn.set(id, resolve);
    worker!.send({ type: 'turn', id, pcm });
    setTimeout(() => {
      if (pendingTurn.has(id)) { pendingTurn.delete(id); resolve(null); }
    }, 5_000);
  });
}

/** Convert a 16-bit PCM WAV Buffer to Float32 mono samples. */
export function wavToFloat32(wavBuffer: Buffer): Float32Array {
  return pcm16ToFloat32(wavBuffer);
}

function pcm16ToFloat32(wavBuffer: Buffer): Float32Array {
  let offset = 0;
  if (wavBuffer.slice(0, 4).toString() === 'RIFF') offset = 44;
  const numSamples = Math.floor((wavBuffer.length - offset) / 2);
  const float32 = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    float32[i] = wavBuffer.readInt16LE(offset + i * 2) / 32768.0;
  }
  return float32;
}

/**
 * Spawn + load both models, then run one synthetic STT inference to prove the
 * path works without the mic and warm the graph. Non-fatal on failure.
 */
export async function warmUpWhisper(): Promise<void> {
  try {
    await ensureWorker();
    const t0 = Date.now();
    await transcribePcm(new Float32Array(16000)); // 1s silence
    log.info(`ASR warmup inference OK (${Date.now() - t0}ms) — STT path is live (${MODEL}).`);
  } catch (e) {
    log.warn('ASR warmup failed:', (e as Error).message);
  }
}
