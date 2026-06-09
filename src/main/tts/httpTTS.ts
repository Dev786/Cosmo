import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { execFile } from 'child_process';
import type { TTSProvider } from './types';
import { getApiKey } from '../core/secrets';
import { log } from '../core/log';

// Generic factory for cloud TTS providers that speak over a single HTTP POST —
// the TTS analogue of ai/providers/openaiCompat.ts. Each vendor differs only in
// (a) how the request is built (URL/headers/body shape) and (b) how the audio is
// pulled out of the response (raw bytes vs base64-in-JSON). Everything shared —
// key resolution, error wrapping, writing a temp file, afplay playback with a
// watchdog + barge-in abort, graceful fallback to `say` — lives here so a new
// provider is ~15 lines, matching the project's "thin preset" boundary rule.

export interface HttpTTSRequest {
  text: string;
  voice: string;
  model: string;
  key: string;
}

export interface HttpRequestSpec {
  url: string;
  method?: string;            // default POST
  headers: Record<string, string>;
  body: string;
}

export interface HttpTTSOpts {
  name: string;
  /** Env-var fallback for the key (legacy .env path); user-entered key wins. */
  apiKeyEnv?: string;
  /** Secret id to resolve the key under. Defaults to `name`; set when a TTS
   *  provider reuses an LLM vendor's key (e.g. Groq/OpenAI TTS → 'groq'/'openai'). */
  keyId?: string;
  needsKey?: boolean;         // default true
  defaultVoice: string;
  defaultModel: string;
  /** Container the bytes come back in — drives the temp-file extension afplay reads. */
  ext: 'mp3' | 'wav';
  build(req: HttpTTSRequest): HttpRequestSpec;
  decode(res: Response): Promise<Buffer>;
}

/** Response is raw audio bytes (ElevenLabs, Groq, Deepgram, OpenAI). */
export async function decodeBytes(res: Response): Promise<Buffer> {
  return Buffer.from(await res.arrayBuffer());
}

/** Response is JSON with base64 audio at `path` (Sarvam: `audios[0]`). */
export function decodeBase64Json(...path: (string | number)[]): (res: Response) => Promise<Buffer> {
  return async (res: Response): Promise<Buffer> => {
    const json = await res.json() as unknown;
    let cur: unknown = json;
    for (const k of path) cur = (cur as Record<string | number, unknown>)?.[k];
    if (typeof cur !== 'string' || !cur) {
      throw new Error(`no base64 audio at ${path.join('.')} in response`);
    }
    return Buffer.from(cur, 'base64');
  };
}

// Play already-encoded audio bytes via afplay. Mirrors kokoro's playback: write a
// temp file, spawn afplay, kill on barge-in (signal) AND on a watchdog timeout so
// a dead output device can't wedge the speech queue forever. Compressed audio has
// no cheaply-known duration, so the watchdog is sized off the text length.
async function playBytes(bytes: Buffer, ext: string, text: string, signal?: AbortSignal, onAudioStart?: () => void): Promise<void> {
  if (signal?.aborted) return;
  if (!bytes.length) throw new Error('empty audio');
  const tmpFile = path.join(os.tmpdir(), `cosmo-tts-${Date.now()}-${bytes.length}.${ext}`);
  await fs.promises.writeFile(tmpFile, bytes);
  if (signal?.aborted) { fs.unlink(tmpFile, () => {}); return; }

  onAudioStart?.(); // sound is about to play — start the talk animation now, not at enqueue
  await new Promise<void>((resolve) => {
    const child = execFile('afplay', [tmpFile], () => resolve());
    const onAbort = (): void => { try { child.kill('SIGKILL'); } catch { /* already gone */ } };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    // ~12 chars/sec of speech is slow; cap generously then kill so a hung afplay
    // (missing output device) never traps the queue. Min 15s for short clips.
    const capMs = Math.max(15_000, Math.ceil(text.length / 8) * 1000) + 5_000;
    const watchdog = setTimeout(() => {
      log.warn(`afplay overran (~${text.length} chars) — killing to unblock speech`);
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      resolve();
    }, capMs);
    child.on('exit', () => { clearTimeout(watchdog); signal?.removeEventListener('abort', onAbort); });
  });
  fs.unlink(tmpFile, () => {});
}

export function makeHttpTTS(opts: HttpTTSOpts): TTSProvider {
  const needsKey = opts.needsKey ?? true;

  // The strict synth path — fetch → decode → play. Throws on any failure (bad key,
  // wrong voice id, network). `speak` wraps this with a graceful fallback; `preview`
  // lets it throw so the setup screen can show the real error.
  async function synth(text: string, voice: string, signal?: AbortSignal, onAudioStart?: () => void): Promise<void> {
    if (signal?.aborted) return;
    const key = getApiKey(opts.keyId ?? opts.name, opts.apiKeyEnv);
    if (needsKey && !key) throw new Error(`no API key for ${opts.name}`);

    const spec = opts.build({ text, voice, model: opts.defaultModel, key });
    const res = await fetch(spec.url, {
      method: spec.method ?? 'POST',
      headers: spec.headers,
      body: spec.body,
      signal,
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.text()).slice(0, 200); } catch { /* ignore */ }
      throw new Error(`${opts.name} TTS HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
    }
    const bytes = await opts.decode(res);
    await playBytes(bytes, opts.ext, text, signal, onAudioStart);
  }

  return {
    name: opts.name,
    offline: false,

    async speak(text, callOpts): Promise<void> {
      const signal = callOpts?.signal;
      try {
        await synth(text, callOpts?.voice || opts.defaultVoice, signal, callOpts?.onAudioStart);
      } catch (e) {
        if (signal?.aborted || (e as Error)?.name === 'AbortError') return; // barge-in — don't fall back
        log.error(`${opts.name} TTS failed, falling back to macOS say:`, (e as Error).message);
        const { promisify } = await import('util');
        callOpts?.onAudioStart?.(); // the fallback voice is about to play
        await promisify(execFile)('say', ['-v', 'Samantha', text]).catch(() => {});
      }
    },

    async preview(text, callOpts): Promise<void> {
      await synth(text, callOpts?.voice || opts.defaultVoice); // rethrows → setup shows it
    },
  };
}
