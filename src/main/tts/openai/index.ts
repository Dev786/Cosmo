import { makeHttpTTS, decodeBytes } from '../httpTTS';

// OpenAI TTS — raw MP3 bytes, Bearer auth, text in `input`. Reuses the SAME OpenAI
// key as the LLM provider (keyId 'openai'). No free tier (billing required), but
// included because it's widely used and the voices are strong.
export const openaiTTSProvider = makeHttpTTS({
  name: 'openai',
  keyId: 'openai',
  apiKeyEnv: 'OPENAI_API_KEY',
  defaultVoice: 'nova',
  defaultModel: 'gpt-4o-mini-tts',
  ext: 'mp3',
  build: ({ text, voice, model, key }) => ({
    url: 'https://api.openai.com/v1/audio/speech',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, input: text, voice, response_format: 'mp3' }),
  }),
  decode: decodeBytes,
});
