import type { STTProvider } from './types';
import { getApiKey } from '../core/secrets';
import { log } from '../core/log';

// Generic factory for cloud speech-to-text providers — the STT analogue of
// tts/httpTTS.ts and ai/providers/openaiCompat.ts. Vendors differ only in how the
// WAV is uploaded (multipart `file`, raw binary body, or base64-in-JSON), the auth
// header, and where the transcript sits in the response. Everything shared (key
// resolution, the request, error wrapping, JSON/text decoding) lives here, so a
// new STT vendor is a ~12-line preset behind the same boundary as the others.

export interface HttpSTTRequest { wav: Buffer; model: string; key: string; }
export interface HttpSTTSpec {
  url: string;
  method?: string;                 // default POST
  headers: Record<string, string>; // omit content-type for multipart — fetch sets the boundary
  body: FormData | Uint8Array | string;
}
export interface HttpSTTOpts {
  name: string;
  apiKeyEnv?: string;
  /** Secret id to resolve the key under. Defaults to `name`; set when reusing a
   *  vendor's key already entered for LLM/TTS (groq/openai/elevenlabs/…). */
  keyId?: string;
  needsKey?: boolean;              // default true
  defaultModel: string;
  build(req: HttpSTTRequest): HttpSTTSpec;
  /** Pull the transcript out of the parsed response (JSON object or raw string). */
  decode(payload: unknown): string;
}

/** Multipart body with the audio as `file` plus extra string fields (model, etc).
 *  Used by the OpenAI-compatible vendors (Groq/OpenAI), ElevenLabs, Sarvam. */
export function multipartWav(wav: Buffer, fields: Record<string, string>): FormData {
  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'audio.wav');
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

/** Safe nested read: pick('results', 'channels', 0, 'alternatives', 0, 'transcript'). */
export function pick(obj: unknown, ...path: (string | number)[]): string {
  let cur: unknown = obj;
  for (const k of path) cur = (cur as Record<string | number, unknown> | undefined)?.[k];
  return typeof cur === 'string' ? cur : '';
}

export function makeHttpSTT(opts: HttpSTTOpts): STTProvider {
  const needsKey = opts.needsKey ?? true;
  return {
    name: opts.name,
    offline: false,
    async transcribe(wav: Buffer, callOpts): Promise<string> {
      const key = getApiKey(opts.keyId ?? opts.name, opts.apiKeyEnv);
      if (needsKey && !key) throw new Error(`no API key for ${opts.name}`);

      const spec = opts.build({ wav, model: callOpts?.model || opts.defaultModel, key });
      const res = await fetch(spec.url, {
        method: spec.method ?? 'POST',
        headers: spec.headers,
        body: spec.body,
      });
      if (!res.ok) {
        let detail = '';
        try { detail = (await res.text()).slice(0, 200); } catch { /* ignore */ }
        throw new Error(`${opts.name} STT HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
      }
      const ct = res.headers.get('content-type') ?? '';
      const payload: unknown = ct.includes('json') ? await res.json() : await res.text();
      const text = opts.decode(payload).trim();
      log.debug(`${opts.name} STT → "${text.slice(0, 60)}"`);
      return text;
    },
  };
}
