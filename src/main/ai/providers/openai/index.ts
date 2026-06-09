import { createOpenAICompatProvider } from '../openaiCompat';

// OpenAI's o-series (o1/o3/o4) and GPT-5 family REJECT `max_tokens` and require
// `max_completion_tokens` ("Unsupported parameter: 'max_tokens'…"). gpt-4o / 4o-mini
// also accept `max_completion_tokens`, so we always send it — one body works across
// every current OpenAI model. Those reasoning models also reject a non-default
// `temperature`/`top_p`, so we deliberately send neither. This quirk lives ONLY in
// this vendor folder; no other vendor (which all still use `max_tokens`) is touched.
export const openaiProvider = createOpenAICompatProvider({
  name: 'openai',
  baseURL: 'https://api.openai.com/v1',
  apiKeyEnv: 'OPENAI_API_KEY',
  // gpt-4o-mini still works, but gpt-5.4-mini is the current-gen cheap default and
  // matches the setup catalog's lead option. (GPT-5 family requires the
  // max_completion_tokens we already send.)
  defaultModel: 'gpt-5.4-mini',
  // OpenAI models follow the fenced-JSON protocol unreliably (they narrate "let me
  // search…" without emitting the block), so we use real function-calling here.
  nativeTools: true,
  buildBody: (b) => ({
    model: b.model,
    messages: b.messages,
    max_completion_tokens: b.maxTokens,
    stream: false,
  }),
});
