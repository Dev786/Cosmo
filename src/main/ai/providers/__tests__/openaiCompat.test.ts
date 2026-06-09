import { createOpenAICompatProvider } from '../openaiCompat';
import { ToolChoiceError } from '../types';
import type { ToolSpec } from '../types';

// No real key needed — the transport just puts it in a header.
jest.mock('../../../core/secrets', () => ({ getApiKey: (): string => 'test-key' }));

interface CapturedRequest { url: string; body: Record<string, unknown>; }
let captured: CapturedRequest;

function mockFetchOnce(responseJson: unknown): void {
  (global as unknown as { fetch: jest.Mock }).fetch = jest.fn(
    (url: string, init: { body: string }) => {
      captured = { url, body: JSON.parse(init.body) as Record<string, unknown> };
      return Promise.resolve({ status: 200, ok: true, json: async () => responseJson });
    },
  );
}

const TOOLS: ToolSpec[] = [{
  name: 'search.web',
  description: 'Search the web',
  parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
}];

const native = createOpenAICompatProvider({
  name: 'openai', baseURL: 'https://api.openai.com/v1', apiKeyEnv: 'OPENAI_API_KEY',
  defaultModel: 'gpt-4o-mini', nativeTools: true,
});
const fenced = createOpenAICompatProvider({
  name: 'ollama', baseURL: 'http://127.0.0.1:11434/v1', apiKeyEnv: '',
  defaultModel: 'llama3.2',
});

describe('openaiCompat — native tool-calling', () => {
  it('advertises tools + tool_choice when the vendor is native and tools are passed', async () => {
    mockFetchOnce({ choices: [{ message: { content: 'hi' } }] });
    await native.chat({ system: 's', messages: [{ role: 'user', content: 'hi' }], tools: TOOLS });
    expect(captured.body.tools).toEqual([
      // dotted name "search.web" is sanitised to the OpenAI-legal "search_web"
      { type: 'function', function: { name: 'search_web', description: 'Search the web', parameters: TOOLS[0].parameters } },
    ]);
    expect(captured.body.tool_choice).toBe('auto');
  });

  it('maps a returned (sanitised) tool name back to the canonical dotted name', async () => {
    mockFetchOnce({ choices: [{ message: { content: '', tool_calls: [
      { id: 'c1', type: 'function', function: { name: 'search_web', arguments: '{"query":"llms"}' } },
    ] } }] });
    const res = await native.chat({ system: 's', messages: [{ role: 'user', content: 'find' }], tools: TOOLS });
    expect(res.toolCalls).toEqual([{ id: 'c1', name: 'search.web', args: { query: 'llms' } }]);
  });

  it('parses message.tool_calls into ChatResponse.toolCalls (args JSON-decoded)', async () => {
    mockFetchOnce({ choices: [{ message: { content: '', tool_calls: [
      { id: 'call_abc', type: 'function', function: { name: 'search.web', arguments: '{"query":"llms"}' } },
    ] } }] });
    const res = await native.chat({ system: 's', messages: [{ role: 'user', content: 'find llm papers' }], tools: TOOLS });
    expect(res.toolCalls).toEqual([{ id: 'call_abc', name: 'search.web', args: { query: 'llms' } }]);
    expect(res.text).toBe('');
  });

  it('backfills a non-empty id when the vendor returns an empty one (Gemini compat quirk)', async () => {
    mockFetchOnce({ choices: [{ message: { tool_calls: [
      { id: '', function: { name: 'search.web', arguments: '{"query":"x"}' } },
    ] } }] });
    const res = await native.chat({ system: 's', messages: [{ role: 'user', content: 'x' }], tools: TOOLS });
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls![0].id).toBeTruthy();   // synthetic, never ''
    expect(res.toolCalls![0].name).toBe('search.web');
  });

  it('returns undefined toolCalls for a plain text answer', async () => {
    mockFetchOnce({ choices: [{ message: { content: 'The answer is 42.' } }] });
    const res = await native.chat({ system: 's', messages: [{ role: 'user', content: 'q' }], tools: TOOLS });
    expect(res.toolCalls).toBeUndefined();
    expect(res.text).toBe('The answer is 42.');
  });

  it('falls back to {} args when the vendor returns malformed argument JSON', async () => {
    mockFetchOnce({ choices: [{ message: { tool_calls: [
      { id: 'c1', function: { name: 'search.web', arguments: 'not-json' } },
    ] } }] });
    const res = await native.chat({ system: 's', messages: [{ role: 'user', content: 'x' }], tools: TOOLS });
    expect(res.toolCalls![0].args).toEqual({});
  });

  it('throws ToolChoiceError on a tool_use_failed rejection (so the loop can retry tool-free)', async () => {
    // Groq's 400 when the model emits a malformed native tool call.
    mockFetchOnce({ error: { code: 'tool_use_failed', message: "Failed to call a function. Please adjust your prompt. See 'failed_generation' for more details." } });
    await expect(
      native.chat({ system: 's', messages: [{ role: 'user', content: 'how are you' }], tools: TOOLS }),
    ).rejects.toBeInstanceOf(ToolChoiceError);
  });

  it('throws a plain Error (not ToolChoiceError) on an unrelated API error', async () => {
    mockFetchOnce({ error: { message: 'context length exceeded' } });
    const p = native.chat({ system: 's', messages: [{ role: 'user', content: 'x' }], tools: TOOLS });
    await expect(p).rejects.toThrow('context length exceeded');
    await expect(p).rejects.not.toBeInstanceOf(ToolChoiceError);
  });

  it('serialises assistant tool_calls + tool replies back to the wire on the next turn', async () => {
    mockFetchOnce({ choices: [{ message: { content: 'done' } }] });
    await native.chat({
      system: 's',
      tools: TOOLS,
      messages: [
        { role: 'user', content: 'find llms' },
        { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search.web', arguments: '{"query":"llms"}' } }] },
        { role: 'tool', tool_call_id: 'c1', content: 'search.web → found 3 results' },
      ],
    });
    const msgs = captured.body.messages as Array<Record<string, unknown>>;
    const assistant = msgs.find(m => m.role === 'assistant')!;
    expect(assistant.tool_calls).toBeDefined();
    // the echoed name must also be sanitised, or the vendor 400s the history
    expect((assistant.tool_calls as Array<{ function: { name: string } }>)[0].function.name).toBe('search_web');
    expect(assistant.content).toBeNull();   // pure tool-call turn → content null
    const tool = msgs.find(m => m.role === 'tool')!;
    expect(tool.tool_call_id).toBe('c1');
  });
});

describe('openaiCompat — fenced (non-native) vendor', () => {
  it('never sends tools, even when tools are passed', async () => {
    mockFetchOnce({ choices: [{ message: { content: 'hi' } }] });
    await fenced.chat({ system: 's', messages: [{ role: 'user', content: 'hi' }], tools: TOOLS });
    expect(captured.body.tools).toBeUndefined();
    expect(captured.body.tool_choice).toBeUndefined();
    expect(captured.body.max_tokens).toBeDefined();   // standard body, max_tokens
  });

  it('reports nativeTools:false in capabilities', () => {
    expect(fenced.capabilities.nativeTools).toBe(false);
    expect(native.capabilities.nativeTools).toBe(true);
  });
});
