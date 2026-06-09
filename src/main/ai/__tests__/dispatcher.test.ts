import { z } from 'zod';
import { parseToolCalls, extractToolCalls, dispatch } from '../dispatcher';
import { registerTool } from '../../tools/registry';
import type { ToolContext, ToolResult } from '../../tools/types';

// Register a couple of stub tools so registry-gated paths (unfenced scan,
// execution) have something real to resolve against.
let lastCall: { name: string; args: unknown } | null = null;
beforeAll(() => {
  const mk = (name: string): void => registerTool({
    name,
    description: `stub ${name}`,
    schema: z.object({ query: z.string().optional(), level: z.number().optional() }),
    availableOffline: true,
    async execute(args): Promise<ToolResult> {
      lastCall = { name, args };
      return { ok: true, summary: `did ${name}` };
    },
  });
  mk('music.play');
  mk('system.volume');
  mk('music.next');
});

const ctx = {} as ToolContext;

describe('parseToolCalls — fence shapes', () => {
  it('canonical ```tool block', () => {
    const calls = parseToolCalls('Sure!\n```tool\n{"name":"music.play","args":{"query":"jazz"}}\n```');
    expect(calls).toEqual([{ name: 'music.play', args: { query: 'jazz' } }]);
  });

  it('tool name as the fence language (the real-world leak)', () => {
    const calls = parseToolCalls('```music.play\n{"query":"jazz"}\n```');
    expect(calls).toEqual([{ name: 'music.play', args: { query: 'jazz' } }]);
  });

  it('any lang, name carried in the JSON body (```json)', () => {
    const calls = parseToolCalls('```json\n{"name":"system.volume","args":{"level":50}}\n```');
    expect(calls).toEqual([{ name: 'system.volume', args: { level: 50 } }]);
  });

  it('flat args inlined alongside name', () => {
    const calls = parseToolCalls('```tool\n{"name":"system.volume","level":50}\n```');
    expect(calls).toEqual([{ name: 'system.volume', args: { level: 50 } }]);
  });

  it('bare tool name, no args', () => {
    const calls = parseToolCalls('```tool\n{"name":"music.next"}\n```');
    expect(calls).toEqual([{ name: 'music.next', args: {} }]);
  });

  it('single-line fence ```music.play {json}```', () => {
    const calls = parseToolCalls('```music.play {"query":"lofi"}```');
    expect(calls).toEqual([{ name: 'music.play', args: { query: 'lofi' } }]);
  });
});

describe('parseToolCalls — unfenced (registry-gated)', () => {
  it('strips a bare `tool.name {json}` for a registered tool', () => {
    const calls = parseToolCalls('music.play {"query":"jazz"}');
    expect(calls).toEqual([{ name: 'music.play', args: { query: 'jazz' } }]);
  });

  it('ignores dotted prose that is not a registered tool', () => {
    const calls = parseToolCalls('Use array.map {"x":1} to transform.');
    expect(calls).toEqual([]);
  });
});

describe('parseToolCalls — bare inline JSON (no fence, name inside)', () => {
  it('strips a bare `{"name","args"}` object after prose (the groq leak)', () => {
    const { calls, text } = extractToolCalls('On it! {"name":"music.play","args":{"query":"Bad Day"}}');
    expect(calls).toEqual([{ name: 'music.play', args: { query: 'Bad Day' } }]);
    expect(text).toBe('On it!');
  });

  it('handles flat inlined args in a bare object', () => {
    const calls = parseToolCalls('{"name":"system.volume","level":40}');
    expect(calls).toEqual([{ name: 'system.volume', args: { level: 40 } }]);
  });

  it('ignores a bare JSON object whose name is not a registered tool', () => {
    const { calls, text } = extractToolCalls('Here is data: {"name":"Alice","age":30}');
    expect(calls).toEqual([]);
    expect(text).toBe('Here is data: {"name":"Alice","age":30}');
  });
});

describe('extractToolCalls — text handling', () => {
  it('leaves ordinary prose untouched', () => {
    const { calls, text } = extractToolCalls('Just a normal reply, no tools here.');
    expect(calls).toEqual([]);
    expect(text).toBe('Just a normal reply, no tools here.');
  });

  it('does not eat a real (non-tool) code block', () => {
    const src = 'Here:\n```js\nconst x = 1;\n```';
    const { calls, text } = extractToolCalls(src);
    expect(calls).toEqual([]);
    expect(text).toBe(src);
  });

  it('keeps surrounding prose and removes the tool block', () => {
    const { calls, text } = extractToolCalls('Playing now 🎵\n```music.play\n{"query":"jazz"}\n```');
    expect(calls).toHaveLength(1);
    expect(text).toBe('Playing now 🎵');
  });
});

describe('dispatch — execute + strip + append', () => {
  beforeEach(() => { lastCall = null; });

  it('executes the call and appends its summary', async () => {
    const out = await dispatch('On it.\n```music.play\n{"query":"jazz"}\n```', ctx);
    expect(lastCall).toEqual({ name: 'music.play', args: { query: 'jazz' } });
    expect(out).toBe('On it.\n\ndid music.play');
  });

  it('returns plain text untouched when there are no calls', async () => {
    const out = await dispatch('Hello there.', ctx);
    expect(out).toBe('Hello there.');
    expect(lastCall).toBeNull();
  });

  it('reports unknown tools instead of leaking raw JSON', async () => {
    const out = await dispatch('```tool\n{"name":"bogus.tool","args":{}}\n```', ctx);
    expect(out).toContain('Unknown tool: bogus.tool');
    expect(out).not.toContain('{');
  });
});
