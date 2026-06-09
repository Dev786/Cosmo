import { makeHttpSTT, pick } from '../httpSTT';

// Deepgram (pre-recorded) — RAW binary body (not multipart), `Token` auth (not
// Bearer), model + options in the query string. Transcript is deeply nested.
// Reuses the shared 'deepgram' key. $200 free credit, no card.
export const deepgramSTTProvider = makeHttpSTT({
  name: 'deepgram',
  apiKeyEnv: 'DEEPGRAM_API_KEY',
  defaultModel: 'nova-3',
  build: ({ wav, model, key }) => ({
    url: `https://api.deepgram.com/v1/listen?model=${encodeURIComponent(model)}&smart_format=true&punctuate=true`,
    headers: { authorization: `Token ${key}`, 'content-type': 'audio/wav' },
    body: new Uint8Array(wav),
  }),
  decode: (p) => pick(p, 'results', 'channels', 0, 'alternatives', 0, 'transcript'),
});
