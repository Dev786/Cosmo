import { makeHttpSTT, multipartWav, pick } from '../httpSTT';

// Groq Whisper — OpenAI-compatible multipart (`file` + `model`), Bearer auth,
// transcript at `text`. Reuses the shared 'groq' key. Free, no card, rate-limited
// only — the easiest cloud STT for daily testing.
export const groqSTTProvider = makeHttpSTT({
  name: 'groq',
  keyId: 'groq',
  apiKeyEnv: 'GROQ_API_KEY',
  defaultModel: 'whisper-large-v3-turbo',
  build: ({ wav, model, key }) => ({
    url: 'https://api.groq.com/openai/v1/audio/transcriptions',
    headers: { authorization: `Bearer ${key}` },
    body: multipartWav(wav, { model, response_format: 'json' }),
  }),
  decode: (p) => pick(p, 'text'),
});
