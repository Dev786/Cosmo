import { makeHttpTTS, decodeBase64Json } from '../httpTTS';

// Sarvam AI (Indian languages + Indian-English). Key in `api-subscription-key`.
// Unlike the others it returns base64 audio in JSON at `audios[0]`. Speaker names
// are lowercase, case-sensitive. Free trial credits on signup.
export const sarvamTTSProvider = makeHttpTTS({
  name: 'sarvam',
  apiKeyEnv: 'SARVAM_API_KEY',
  defaultVoice: 'anushka',
  defaultModel: 'bulbul:v2',
  ext: 'wav',
  build: ({ text, voice, model, key }) => ({
    url: 'https://api.sarvam.ai/text-to-speech',
    headers: { 'api-subscription-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({ text, target_language_code: 'en-IN', speaker: voice, model }),
  }),
  decode: decodeBase64Json('audios', 0),
});
