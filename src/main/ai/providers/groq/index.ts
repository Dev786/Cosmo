import { createOpenAICompatProvider } from '../openaiCompat';

// Verify current model IDs at https://console.groq.com/docs/models
// All Groq-hosted chat models support OpenAI native tool-use (console.groq.com/docs/tool-use).
// The default, llama-3.3-70b-versatile, is Groq's recommended tool-use model.
export const groqProvider = createOpenAICompatProvider({
  name: 'groq',
  baseURL: 'https://api.groq.com/openai/v1',
  apiKeyEnv: 'GROQ_API_KEY',
  defaultModel: 'llama-3.3-70b-versatile',
  nativeTools: true,
});
