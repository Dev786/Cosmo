import { makeHttpTTS, decodeBytes } from '../httpTTS';

// Deepgram Aura — raw MP3 bytes. Auth scheme is the literal word `Token`, NOT
// Bearer. The Aura "model" IS the voice (e.g. aura-2-thalia-en) and rides as a
// query param; text is the JSON body. Free: $200 signup credit, no card.
export const deepgramTTSProvider = makeHttpTTS({
  name: 'deepgram',
  apiKeyEnv: 'DEEPGRAM_API_KEY',
  defaultVoice: 'aura-2-thalia-en',
  defaultModel: 'aura-2-thalia-en',
  ext: 'mp3',
  build: ({ text, voice, key }) => ({
    url: `https://api.deepgram.com/v1/speak?model=${encodeURIComponent(voice)}`,
    headers: { authorization: `Token ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  }),
  decode: decodeBytes,
});
