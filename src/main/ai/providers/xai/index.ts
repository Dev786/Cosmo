import { createOpenAICompatProvider } from '../openaiCompat';

// Grok speaks OpenAI native function-calling at full parity (docs.x.ai function-calling).
// Model: grok-3-mini was RETIRED 2026-05-15 — the slug now silently redirects to
// grok-4.3 and bills at grok-4.3 rates, so pin grok-4.3 explicitly. Verify the
// current catalog at https://docs.x.ai/developers/models.
export const xaiProvider = createOpenAICompatProvider({
  name: 'xai',
  baseURL: 'https://api.x.ai/v1',
  apiKeyEnv: 'XAI_API_KEY',
  defaultModel: 'grok-4.3',
  nativeTools: true,
});
