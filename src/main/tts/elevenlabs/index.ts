import { makeHttpTTS, decodeBytes } from '../httpTTS';

// ElevenLabs — raw MP3 bytes, key in `xi-api-key` (NOT Bearer). voice_id is in the
// path; output_format is a query param. Free tier: ~10k credits/mo, no card.
export const elevenlabsTTSProvider = makeHttpTTS({
  name: 'elevenlabs',
  apiKeyEnv: 'ELEVENLABS_API_KEY',
  defaultVoice: '21m00Tcm4TlvDq8ikWAM', // Rachel — warm female preset
  defaultModel: 'eleven_flash_v2_5',    // low-latency, best for a live companion
  ext: 'mp3',
  build: ({ text, voice, model, key }) => ({
    url: `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`,
    headers: { 'xi-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({ text, model_id: model }),
  }),
  decode: decodeBytes,
});
