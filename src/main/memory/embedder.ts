import * as path from 'path';
import * as os from 'os';
import { fork, type ChildProcess } from 'child_process';
import { resolveNodePath } from '../core/systemNode';
import { log } from '../core/log';

// Main-side client for the forked embedding worker (embedWorker.mjs). Mirrors the
// STT worker's fork mechanics: spawn under a real system node, talk over IPC,
// degrade gracefully if the worker can't load (no system node, offline first-run,
// etc.) — callers treat a null result as "no embeddings available" and fall back.

export const EMBED_MODEL = 'Xenova/all-MiniLM-L6-v2'; // 384-dim sentence embeddings
const CACHE_DIR = path.join(os.homedir(), '.pixel', 'models');

let worker: ChildProcess | null = null;
let ready = false;
let readyPromise: Promise<void> | null = null;
let failed = false; // a hard load failure — stop retrying for this process lifetime
let dim = 0;
let nextId = 1;
const pending = new Map<number, { resolve: (v: number[][]) => void; reject: (e: Error) => void }>();

function workerPath(): string {
  return path.join(__dirname, 'embedWorker.mjs');
}

function spawn(): Promise<void> {
  if (ready) return Promise.resolve();
  if (failed) return Promise.reject(new Error('embedder previously failed to load'));
  if (readyPromise) return readyPromise;

  readyPromise = new Promise<void>((resolve, reject) => {
    const nodePath = resolveNodePath();
    log.info(`Spawning embedding worker (${EMBED_MODEL}) under node: ${nodePath}`);

    const childEnv = { ...process.env };
    delete childEnv.ELECTRON_RUN_AS_NODE;

    worker = fork(workerPath(), [], {
      execPath: nodePath,
      execArgv: [],
      serialization: 'advanced',
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: childEnv,
    });

    worker.stdout?.on('data', (d: Buffer) => log.debug('embed-worker:', d.toString().trim()));
    worker.stderr?.on('data', (d: Buffer) => {
      const s = d.toString().trim();
      if (!s.includes('CleanUnusedInitializers') && !s.includes('onnxruntime')) log.debug('embed-worker-err:', s);
    });

    worker.on('message', (msg: { type: string; id?: number; dim?: number; vectors?: number[][]; message?: string }) => {
      switch (msg.type) {
        case 'ready':
          ready = true;
          dim = msg.dim ?? 0;
          log.info(`Embedding worker ready (dim ${dim}).`);
          resolve();
          break;
        case 'embedded':
          if (msg.id != null) { pending.get(msg.id)?.resolve(msg.vectors ?? []); pending.delete(msg.id); }
          break;
        case 'error':
          if (msg.id != null && pending.has(msg.id)) {
            pending.get(msg.id)!.reject(new Error(msg.message ?? 'embed error'));
            pending.delete(msg.id);
          } else {
            log.warn('Embedding worker init error:', msg.message);
            failed = true;
            reject(new Error(msg.message ?? 'embedder init failed'));
          }
          break;
      }
    });

    worker.on('exit', (code, signal) => {
      log.warn(`Embedding worker exited (code ${code}, signal ${signal ?? 'none'})`);
      ready = false; worker = null; readyPromise = null;
      for (const p of pending.values()) p.reject(new Error('embedding worker exited'));
      pending.clear();
    });

    worker.send({ type: 'init', model: EMBED_MODEL, cacheDir: CACHE_DIR });
  });

  return readyPromise;
}

/** Spawn + load the model ahead of first use (called in the background at boot).
 *  Resolves true if the embedder is live, false if it failed to load. */
export async function warmEmbedder(): Promise<boolean> {
  try {
    await spawn();
    return true;
  } catch (e) {
    log.warn('Embedder warmup failed (semantic recall disabled this session):', (e as Error).message);
    return false;
  }
}

export function isEmbedderReady(): boolean { return ready; }
export function embedDim(): number { return dim; }

/** Embed a batch of texts. Returns one vector per input, or null if the embedder
 *  is unavailable / errored — callers fall back to non-semantic behavior. */
export async function embed(texts: string[]): Promise<number[][] | null> {
  if (!texts.length) return [];
  if (failed) return null;
  try {
    await spawn();
  } catch {
    return null;
  }
  if (!worker) return null;
  const id = nextId++;
  return new Promise<number[][] | null>((resolve) => {
    pending.set(id, { resolve, reject: () => resolve(null) });
    worker!.send({ type: 'embed', id, texts });
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); resolve(null); }
    }, 30_000);
  });
}

/** Embed a single string → one vector (or null). Convenience for query embedding. */
export async function embedOne(text: string): Promise<number[] | null> {
  const v = await embed([text]);
  return v && v[0] ? v[0] : null;
}
