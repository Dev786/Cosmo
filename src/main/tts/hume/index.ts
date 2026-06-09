import { makeHttpTTS, decodeBase64Json } from '../httpTTS';

// Hume AI (Octave) — expressive TTS. Key in `X-Hume-Api-Key`. Returns base64 audio
// in JSON at `generations[0].audio`. Octave needs a voice OR a description; we
// always send a companion-flavoured description so it works even with no voice
// picked, and pass a Voice Library name when the user chooses one. Free: 10k
// chars/mo + $20 credits, no card.
export const humeTTSProvider = makeHttpTTS({
  name: 'hume',
  apiKeyEnv: 'HUME_API_KEY',
  defaultVoice: '', // none → Octave generates from the description below
  defaultModel: 'octave',
  ext: 'wav',
  build: ({ text, voice, key }) => ({
    url: 'https://api.hume.ai/v0/tts',
    headers: { 'x-hume-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({
      utterances: [{
        text,
        description: 'A warm, cheerful, slightly childlike companion voice — bright and friendly.',
        ...(voice ? { voice: { name: voice, provider: 'HUME_AI' } } : {}),
      }],
      format: { type: 'wav' },
    }),
  }),
  decode: decodeBase64Json('generations', 0, 'audio'),
});
