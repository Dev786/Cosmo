import { makeHttpSTT, multipartWav, pick } from '../httpSTT';

// Sarvam (Indian languages) — multipart `file`, `api-subscription-key` auth. NOTE
// the transcript field is `transcript`, not `text`. Reuses the shared 'sarvam' key.
export const sarvamSTTProvider = makeHttpSTT({
  name: 'sarvam',
  apiKeyEnv: 'SARVAM_API_KEY',
  defaultModel: 'saarika:v2.5',
  build: ({ wav, model, key }) => ({
    url: 'https://api.sarvam.ai/speech-to-text',
    headers: { 'api-subscription-key': key },
    body: multipartWav(wav, { model }),
  }),
  decode: (p) => pick(p, 'transcript'),
});
