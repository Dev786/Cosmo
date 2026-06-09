import { createOpenAICompatProvider } from '../openaiCompat';

// Gemini's OpenAI-compat layer supports function-calling (ai.google.dev/gemini-api/docs/openai).
// It returns an EMPTY tool_call id, which would 400 the next turn — openaiCompat
// backfills a synthetic id (callSeq) so the assistant/tool linkage stays valid.
// Model: gemini-2.0-flash was SHUT DOWN 2026-06-01 and gemini-2.5-flash retires
// 2026-10-16; gemini-3.5-flash (current, no announced shutdown) is the durable pick.
export const googleProvider = createOpenAICompatProvider({
  name: 'google',
  baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
  apiKeyEnv: 'GOOGLE_API_KEY',
  defaultModel: 'gemini-3.5-flash',
  nativeTools: true,
});
