import { createOpenAICompatProvider } from '../openaiCompat';

// 127.0.0.1, NOT "localhost": on macOS "localhost" can resolve to IPv6 ::1 first,
// where Ollama is NOT listening (it binds 127.0.0.1 only) — that resolves as a
// connection refused and looks like "Ollama isn't running". The literal IPv4
// address sidesteps the resolver entirely. The model dropdown is filled live from
// this endpoint's /models, so `defaultModel` is only a last-resort fallback.
// nativeTools stays OFF (the default). Ollama's /v1 endpoint ignores tool_choice,
// and small local models (7B) hallucinate fabricated tool *output* as plain text
// instead of emitting a real tool_call — native parsing would surface that as a
// confident wrong answer with no tool ever run. The fenced-JSON path degrades
// safely (dispatcher: malformed/unknown call → plain answer), so local models keep
// it. See ollama/ollama#7445.
export const ollamaProvider = createOpenAICompatProvider({
  name: 'ollama',
  baseURL: 'http://127.0.0.1:11434/v1',
  apiKeyEnv: '',
  defaultModel: 'llama3.2',
  offline: true,
});
