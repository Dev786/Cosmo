import { makeHttpSTT, multipartWav, pick } from '../httpSTT';

// OpenAI transcription — identical wire format to Groq (multipart `file`+`model`,
// Bearer, transcript at `text`). Reuses the shared 'openai' key. Paid (no free tier).
export const openaiSTTProvider = makeHttpSTT({
  name: 'openai',
  keyId: 'openai',
  apiKeyEnv: 'OPENAI_API_KEY',
  defaultModel: 'gpt-4o-mini-transcribe',
  build: ({ wav, model, key }) => ({
    url: 'https://api.openai.com/v1/audio/transcriptions',
    headers: { authorization: `Bearer ${key}` },
    body: multipartWav(wav, { model, response_format: 'json' }),
  }),
  decode: (p) => pick(p, 'text'),
});
