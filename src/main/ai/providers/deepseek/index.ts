import { createOpenAICompatProvider } from '../openaiCompat';

// DeepSeek supports OpenAI native function-calling (api-docs.deepseek.com/guides/function_calling).
// Model: the legacy `deepseek-chat` alias is deprecated 2026-07-24 (it maps to the
// non-thinking mode of deepseek-v4-flash) — pin deepseek-v4-flash directly. Note
// DeepSeek's FC is documented as occasionally unstable (looping / empty replies);
// it does NOT emit Groq's `tool_use_failed`, so our safety net there is the ReAct
// step cap + dup-guard in brain.ts, not the tool_use_failed path.
export const deepseekProvider = createOpenAICompatProvider({
  name: 'deepseek',
  baseURL: 'https://api.deepseek.com/v1',
  apiKeyEnv: 'DEEPSEEK_API_KEY',
  defaultModel: 'deepseek-v4-flash',
  nativeTools: true,
});
