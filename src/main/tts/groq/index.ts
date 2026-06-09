import { makeHttpTTS, decodeBytes } from '../httpTTS';

// Groq TTS via Canopy Labs Orpheus (the old playai-tts models were deprecated).
// OpenAI-compatible shape: text in `input`, Bearer auth. Reuses the SAME Groq key
// as the LLM provider (keyId 'groq'), so a Groq-brain user needs no extra key.
// Free tier is rate-limited only (no credit cap, no card) — ideal for testing.
export const groqTTSProvider = makeHttpTTS({
  name: 'groq',
  keyId: 'groq',
  apiKeyEnv: 'GROQ_API_KEY',
  defaultVoice: 'hannah',
  defaultModel: 'canopylabs/orpheus-v1-english',
  ext: 'wav',
  build: ({ text, voice, model, key }) => ({
    url: 'https://api.groq.com/openai/v1/audio/speech',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, input: text, voice, response_format: 'wav' }),
  }),
  decode: decodeBytes,
});
