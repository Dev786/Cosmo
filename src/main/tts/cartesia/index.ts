import { makeHttpTTS, decodeBytes } from '../httpTTS';

// Cartesia (Sonic) — low-latency raw bytes. Key in `X-API-Key`, plus a MANDATORY
// dated `Cartesia-Version` header on every call. Note the field is `transcript`
// (not text/input) and voice/output_format are nested objects. Voice ids are
// account-specific UUIDs — the default is an example; paste your own via the
// "custom voice" field. Free: ~20k credits on signup.
export const cartesiaTTSProvider = makeHttpTTS({
  name: 'cartesia',
  apiKeyEnv: 'CARTESIA_API_KEY',
  defaultVoice: '694f9389-aac1-45b6-b726-9d9369183238',
  defaultModel: 'sonic-2',
  ext: 'wav',
  build: ({ text, voice, model, key }) => ({
    url: 'https://api.cartesia.ai/tts/bytes',
    headers: {
      'x-api-key': key,
      'cartesia-version': '2025-04-16',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model_id: model,
      transcript: text,
      voice: { mode: 'id', id: voice },
      output_format: { container: 'wav', encoding: 'pcm_s16le', sample_rate: 44100 },
    }),
  }),
  decode: decodeBytes,
});
