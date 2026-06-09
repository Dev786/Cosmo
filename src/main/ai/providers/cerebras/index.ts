import { createOpenAICompatProvider } from '../openaiCompat';

// Cerebras Inference — OpenAI-compatible. Free tier: 1M tokens/day, ~1,800+ tok/s
// (the fastest free option, good for voice latency). Key from https://cloud.cerebras.ai.
// OpenAI native tool-use (incl. multi-turn) is supported on the default llama-3.3-70b
// as well as gpt-oss-120b, qwen-3-235b and the GLM models — a Cerebras bug that
// previously blocked multi-turn tool calls on llama-3.3-70b is resolved per their
// change-log (inference-docs.cerebras.ai/support/change-log).
export const cerebrasProvider = createOpenAICompatProvider({
  name: 'cerebras',
  baseURL: 'https://api.cerebras.ai/v1',
  apiKeyEnv: 'CEREBRAS_API_KEY',
  defaultModel: 'llama-3.3-70b',
  nativeTools: true,
});
