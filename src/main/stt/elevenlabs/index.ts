import { makeHttpSTT, multipartWav, pick } from '../httpSTT';

// ElevenLabs Scribe — multipart `file`, `xi-api-key` auth. NOTE the field is
// `model_id` (underscore), not `model`. Transcript at `text`. Reuses the shared
// 'elevenlabs' key (same one as ElevenLabs TTS).
export const elevenlabsSTTProvider = makeHttpSTT({
  name: 'elevenlabs',
  apiKeyEnv: 'ELEVENLABS_API_KEY',
  defaultModel: 'scribe_v2',
  build: ({ wav, model, key }) => ({
    url: 'https://api.elevenlabs.io/v1/speech-to-text',
    headers: { 'xi-api-key': key },
    body: multipartWav(wav, { model_id: model }),
  }),
  decode: (p) => pick(p, 'text'),
});
