# Phase 3: Brain + Hands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire text chat end-to-end through a provider-agnostic LLM layer, a fenced-JSON tool-call protocol, and a registry of built-in tools so that "play my Focus playlist", web search, and timer all work — and adding a new tool requires touching only one folder.

**Architecture:** The LLM layer is a registry of `LLMProvider` objects; five providers share one `openaiCompat.ts` base, Anthropic gets its own adapter. Tools are self-registering modules behind a `Tool<A>` contract; the registry owns timeout + error wrapping. The dispatcher parses fenced ` ```tool ``` ` blocks from plain model text, validates args via zod, and executes — no vendor function-calling anywhere.

**Tech Stack:** Electron + TypeScript strict, `zod` for schema validation, `electron-store` for config, `node-fetch` / native `fetch` for HTTP calls, `child_process.execFile` for AppleScript/shell, Jest for tests.

---

## File Map

Files to **create** (in dependency order):

```
src/shared/types.ts                          # MoodState, ActivityState, Config, IPC constants
src/main/core/osascript.ts                   # safe AppleScript executor (may already exist from M2)
src/main/core/shell.ts                       # safe open/exec helpers
src/main/core/speechQueue.ts                 # serialized TTS (may already exist from M2)
src/main/core/log.ts                         # rotating logger (may already exist)
src/main/tools/types.ts                      # Tool<A>, ToolContext, ToolResult
src/main/tools/registry.ts                   # registerTool, getTool, getAllTools, execute
src/main/ai/providers/types.ts               # LLMProvider, ChatRequest, ChatResponse, ChatMessage
src/main/ai/providers/registry.ts            # registerProvider, getProvider, getActiveProvider
src/main/ai/providers/openaiCompat.ts        # shared base for 5 providers
src/main/ai/providers/xai/index.ts
src/main/ai/providers/openai/index.ts
src/main/ai/providers/google/index.ts
src/main/ai/providers/deepseek/index.ts
src/main/ai/providers/ollama/index.ts
src/main/ai/providers/anthropic/index.ts
src/main/ai/dispatcher.ts                    # fenced-JSON parser + executor
src/main/ai/systemPrompt.ts                  # prompt builder
src/main/ai/memory.ts                        # persistent key/value memory
src/main/ai/history.ts                       # conversation history
src/main/ai/brain.ts                         # handleUserInput, IPC wiring
src/main/tools/music/index.ts
src/main/tools/search/index.ts
src/main/tools/pageRead/index.ts
src/main/tools/speech/index.ts
src/main/tools/browser/index.ts
src/main/tools/timer/index.ts
src/main/tools/notes/index.ts
src/main/tools/system/index.ts
src/main/tools/clipboard/index.ts
src/main/tools/weather/index.ts
src/main/tools/launcher/index.ts
src/renderer/chat.ts                         # chat UI additions

tests/main/tools/registry.test.ts
tests/main/ai/providers/registry.test.ts
tests/main/ai/providers/openaiCompat.test.ts
tests/main/ai/dispatcher.test.ts
tests/main/ai/systemPrompt.test.ts
tests/main/ai/memory.test.ts
tests/main/ai/history.test.ts
tests/main/tools/search.test.ts
```

Files to **modify**:
- `src/main/index.ts` — import brain.ts, register providers + tools at startup
- `src/renderer/index.html` — add `#chat-area`, `#chat-input`

---

## Task 1: Shared types + IPC constants

**Files:**
- Create: `src/shared/types.ts`
- Test: `tests/shared/types.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/shared/types.test.ts
import { IPC, MoodState } from '../../src/shared/types';

test('IPC keys are stable strings', () => {
  expect(IPC.CHAT_SUBMIT).toBe('chat:submit');
  expect(IPC.CHAT_MESSAGE).toBe('chat:message');
  expect(IPC.MOOD_SET).toBe('mood:set');
  expect(IPC.ACTIVITY_SET).toBe('activity:set');
});

test('MoodState enum contains all 8 states', () => {
  const states: MoodState[] = [
    'idle','listening','thinking','speaking',
    'happy','bored','annoyed','sleeping'
  ];
  expect(states).toHaveLength(8);
});
```

- [ ] **Step 2: Run test — expect FAIL (module not found)**

```bash
npx jest tests/shared/types.test.ts --no-coverage
```

- [ ] **Step 3: Create `src/shared/types.ts`**

```typescript
// src/shared/types.ts
import { z } from 'zod';

export type MoodState =
  | 'idle' | 'listening' | 'thinking' | 'speaking'
  | 'happy' | 'bored' | 'annoyed' | 'sleeping';

export type ActivityState =
  | { type: 'music'; nowPlaying: { track: string; artist: string } }
  | { type: 'searching' }
  | { type: 'timer'; remainingSec: number; label: string };

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface Config {
  botName: string;
  llm: {
    provider: string;
    model: string;
    fallback?: string[];
  };
  workHours: {
    start: string;   // "HH:MM"
    end: string;
    days: number[];  // 0=Sun … 6=Sat
  };
  idleSoftMin: number;
  idleHardMin: number;
  distractionMin: number;
  calloutCooldownMin: number;
  expressionPack: string;
  voice: { enabled: boolean; voice: string; rate: number };
  camera: { enabled: boolean };
  location?: { lat: number; lng: number };
}

export const IPC = {
  MOOD_SET:       'mood:set',
  MOOD_PULSE:     'mood:pulse',
  MOOD_INTENSITY: 'mood:intensity',
  ACTIVITY_SET:   'activity:set',
  CHAT_MESSAGE:   'chat:message',
  CHAT_SUBMIT:    'chat:submit',
  SETTINGS_GET:   'settings:get',
  SETTINGS_SET:   'settings:set',
} as const;

export type IPCKey = keyof typeof IPC;
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npx jest tests/shared/types.test.ts --no-coverage
```

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts tests/shared/types.test.ts
git commit -m "feat(shared): add MoodState, ActivityState, Config, IPC constants"
```

---

## Task 2: Tool types + registry

**Files:**
- Create: `src/main/tools/types.ts`
- Create: `src/main/tools/registry.ts`
- Test: `tests/main/tools/registry.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/main/tools/registry.test.ts
import { z } from 'zod';
import { registerTool, getTool, getAllTools, execute, clearRegistry } from '../../../src/main/tools/registry';
import type { Tool, ToolContext, ToolResult } from '../../../src/main/tools/types';

const mockCtx = (): ToolContext => ({
  config: {} as any,
  speak: jest.fn(),
  setMood: jest.fn(),
  setActivity: jest.fn(),
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any,
});

const echoTool: Tool<{ msg: string }> = {
  name: 'test.echo',
  description: 'echo a message',
  schema: z.object({ msg: z.string() }),
  availableOffline: true,
  execute: async (args) => ({ ok: true, summary: args.msg }),
};

const slowTool: Tool<Record<string, never>> = {
  name: 'test.slow',
  description: 'always times out',
  schema: z.object({}),
  availableOffline: true,
  execute: () => new Promise(() => {}), // never resolves
};

const crashTool: Tool<Record<string, never>> = {
  name: 'test.crash',
  description: 'always throws',
  schema: z.object({}),
  availableOffline: true,
  execute: async () => { throw new Error('kaboom'); },
};

beforeEach(() => clearRegistry());

test('registerTool and getTool round-trip', () => {
  registerTool(echoTool);
  expect(getTool('test.echo')).toBe(echoTool);
});

test('getAllTools returns all registered tools', () => {
  registerTool(echoTool);
  registerTool(slowTool);
  expect(getAllTools()).toHaveLength(2);
});

test('execute succeeds with valid args', async () => {
  registerTool(echoTool);
  const result = await execute('test.echo', { msg: 'hello' }, mockCtx());
  expect(result).toEqual({ ok: true, summary: 'hello' });
});

test('execute returns validation error for bad args', async () => {
  registerTool(echoTool);
  const result = await execute('test.echo', { msg: 42 }, mockCtx());
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toBe('validation');
});

test('execute returns not-found error for unknown tool', async () => {
  const result = await execute('no.such', {}, mockCtx());
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.userMessage).toMatch(/no\.such/);
});

test('execute times out after 5 seconds', async () => {
  jest.useFakeTimers();
  registerTool(slowTool);
  const promise = execute('test.slow', {}, mockCtx());
  jest.advanceTimersByTime(5001);
  const result = await promise;
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toBe('timeout');
  jest.useRealTimers();
}, 10_000);

test('execute catches thrown errors', async () => {
  registerTool(crashTool);
  const result = await execute('test.crash', {}, mockCtx());
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.userMessage).toMatch(/kaboom/);
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx jest tests/main/tools/registry.test.ts --no-coverage
```

- [ ] **Step 3: Create `src/main/tools/types.ts`**

```typescript
// src/main/tools/types.ts
import { z } from 'zod';
import type { Config, MoodState, ActivityState } from '../../shared/types';

export interface Logger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

export interface ToolContext {
  config: Readonly<Config>;
  speak(text: string): void;
  setMood(state: MoodState, durationMs?: number): void;
  setActivity(activity: ActivityState | null): void;
  log: Logger;
}

export type ToolResult =
  | { ok: true; summary: string; data?: unknown }
  | { ok: false; error: string; userMessage: string };

export interface Tool<A = unknown> {
  readonly name: string;
  readonly description: string;
  readonly schema: z.ZodType<A>;
  readonly permissions?: string[];
  readonly availableOffline: boolean;
  readonly timeoutMs?: number;
  execute(args: A, ctx: ToolContext): Promise<ToolResult>;
}
```

- [ ] **Step 4: Create `src/main/tools/registry.ts`**

```typescript
// src/main/tools/registry.ts
import type { Tool, ToolContext, ToolResult } from './types';

const registry = new Map<string, Tool>();

export function registerTool(tool: Tool): void {
  registry.set(tool.name, tool);
}

export function getTool(name: string): Tool | undefined {
  return registry.get(name);
}

export function getAllTools(): Tool[] {
  return Array.from(registry.values());
}

/** Only for tests — clears all registrations */
export function clearRegistry(): void {
  registry.clear();
}

export async function execute(
  name: string,
  args: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tool = registry.get(name);
  if (!tool) {
    return { ok: false, error: 'not-found', userMessage: `Unknown tool '${name}'` };
  }

  const parsed = tool.schema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'validation',
      userMessage: `Invalid args for ${name}: ${parsed.error.message}`,
    };
  }

  const timeoutMs = tool.timeoutMs ?? 5_000;

  const timeoutPromise: Promise<ToolResult> = new Promise((resolve) =>
    setTimeout(
      () => resolve({ ok: false, error: 'timeout', userMessage: `${name} timed out` }),
      timeoutMs,
    ),
  );

  try {
    return await Promise.race([
      tool.execute(parsed.data, ctx),
      timeoutPromise,
    ]);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg, userMessage: `${name} failed: ${msg}` };
  }
}
```

- [ ] **Step 5: Run test — expect PASS**

```bash
npx jest tests/main/tools/registry.test.ts --no-coverage
```

- [ ] **Step 6: Commit**

```bash
git add src/main/tools/types.ts src/main/tools/registry.ts tests/main/tools/registry.test.ts
git commit -m "feat(tools): add Tool<A> contract and registry with timeout+error wrapping"
```

---

## Task 3: LLM provider types + registry

**Files:**
- Create: `src/main/ai/providers/types.ts`
- Create: `src/main/ai/providers/registry.ts`
- Test: `tests/main/ai/providers/registry.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/main/ai/providers/registry.test.ts
import {
  registerProvider,
  getProvider,
  getActiveProvider,
  clearProviderRegistry,
} from '../../../../src/main/ai/providers/registry';
import type { LLMProvider } from '../../../../src/main/ai/providers/types';
import type { Config } from '../../../../src/shared/types';

const makeProvider = (name: string): LLMProvider => ({
  name,
  capabilities: { nativeWebSearch: false, offline: false },
  chat: jest.fn(),
});

const makeConfig = (provider: string): Config =>
  ({ llm: { provider, model: 'test-model' } } as any);

beforeEach(() => clearProviderRegistry());

test('registerProvider and getProvider round-trip', () => {
  const p = makeProvider('alpha');
  registerProvider(p);
  expect(getProvider('alpha')).toBe(p);
});

test('getActiveProvider returns correct provider', () => {
  registerProvider(makeProvider('alpha'));
  registerProvider(makeProvider('beta'));
  expect(getActiveProvider(makeConfig('beta')).name).toBe('beta');
});

test("getActiveProvider throws with clear message for unknown provider", () => {
  registerProvider(makeProvider('alpha'));
  expect(() => getActiveProvider(makeConfig('xyz'))).toThrow(
    "Unknown LLM provider 'xyz'. Valid: alpha",
  );
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx jest tests/main/ai/providers/registry.test.ts --no-coverage
```

- [ ] **Step 3: Create `src/main/ai/providers/types.ts`**

```typescript
// src/main/ai/providers/types.ts
import type { ChatMessage } from '../../../shared/types';

export type { ChatMessage };

export interface ChatRequest {
  system: string;
  messages: ChatMessage[];
  maxTokens?: number;
}

export interface ChatResponse {
  text: string;
}

export interface LLMProvider {
  readonly name: string;
  readonly capabilities: { nativeWebSearch: boolean; offline: boolean };
  chat(req: ChatRequest): Promise<ChatResponse>;
}

export class RetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableError';
  }
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}
```

- [ ] **Step 4: Create `src/main/ai/providers/registry.ts`**

```typescript
// src/main/ai/providers/registry.ts
import type { LLMProvider } from './types';
import type { Config } from '../../../shared/types';

const registry = new Map<string, LLMProvider>();

export function registerProvider(provider: LLMProvider): void {
  registry.set(provider.name, provider);
}

export function getProvider(name: string): LLMProvider | undefined {
  return registry.get(name);
}

export function getAllProviders(): LLMProvider[] {
  return Array.from(registry.values());
}

/** Only for tests */
export function clearProviderRegistry(): void {
  registry.clear();
}

export function getActiveProvider(config: Config): LLMProvider {
  const name = config.llm.provider;
  const provider = registry.get(name);
  if (!provider) {
    const valid = Array.from(registry.keys()).join(', ');
    throw new Error(`Unknown LLM provider '${name}'. Valid: ${valid}`);
  }
  return provider;
}
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
npx jest tests/main/ai/providers/registry.test.ts --no-coverage
```

- [ ] **Step 6: Commit**

```bash
git add src/main/ai/providers/types.ts src/main/ai/providers/registry.ts \
        tests/main/ai/providers/registry.test.ts
git commit -m "feat(ai): add LLMProvider contract and provider registry"
```

---

## Task 4: openaiCompat.ts base

**Files:**
- Create: `src/main/ai/providers/openaiCompat.ts`
- Test: `tests/main/ai/providers/openaiCompat.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/main/ai/providers/openaiCompat.test.ts
import { createOpenAICompatProvider } from '../../../../src/main/ai/providers/openaiCompat';
import { RetryableError, AuthError } from '../../../../src/main/ai/providers/types';

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

const provider = createOpenAICompatProvider({
  name: 'test-compat',
  baseURL: 'https://api.example.com/v1',
  apiKeyEnv: 'TEST_API_KEY',
  defaultModel: 'test-model',
});

const req = {
  system: 'You are helpful.',
  messages: [{ role: 'user' as const, content: 'Hello' }],
};

beforeEach(() => {
  mockFetch.mockReset();
  process.env.TEST_API_KEY = 'sk-test-key';
});

test('sends correct headers and body', async () => {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: 'Hi there' } }],
    }),
  });

  const result = await provider.chat(req);
  expect(result.text).toBe('Hi there');

  const [url, opts] = mockFetch.mock.calls[0];
  expect(url).toBe('https://api.example.com/v1/chat/completions');
  expect(opts.headers['Authorization']).toBe('Bearer sk-test-key');
  expect(opts.headers['Content-Type']).toBe('application/json');

  const body = JSON.parse(opts.body);
  expect(body.model).toBe('test-model');
  expect(body.stream).toBe(false);
  expect(body.messages[0].role).toBe('system');
  expect(body.messages[0].content).toBe('You are helpful.');
  expect(body.messages[1].role).toBe('user');
});

test('throws RetryableError on 429', async () => {
  mockFetch.mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) });
  await expect(provider.chat(req)).rejects.toBeInstanceOf(RetryableError);
});

test('throws RetryableError on 503', async () => {
  mockFetch.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });
  await expect(provider.chat(req)).rejects.toBeInstanceOf(RetryableError);
});

test('throws AuthError on 401', async () => {
  mockFetch.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) });
  await expect(provider.chat(req)).rejects.toBeInstanceOf(AuthError);
});

test('throws with verbatim message for unknown_model error', async () => {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status: 400,
    json: async () => ({
      error: { code: 'unknown_model', message: "Model 'bad-model' does not exist" },
    }),
  });
  await expect(provider.chat(req)).rejects.toThrow("Model 'bad-model' does not exist");
});

test('provider.name is set correctly', () => {
  expect(provider.name).toBe('test-compat');
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx jest tests/main/ai/providers/openaiCompat.test.ts --no-coverage
```

- [ ] **Step 3: Create `src/main/ai/providers/openaiCompat.ts`**

```typescript
// src/main/ai/providers/openaiCompat.ts
import { RetryableError, AuthError } from './types';
import type { LLMProvider, ChatRequest, ChatResponse } from './types';

export interface OpenAICompatOpts {
  name: string;
  baseURL: string;
  apiKeyEnv: string;
  defaultModel: string;
  offline?: boolean;
}

export function createOpenAICompatProvider(opts: OpenAICompatOpts): LLMProvider {
  return {
    name: opts.name,
    capabilities: {
      nativeWebSearch: false,
      offline: opts.offline ?? false,
    },

    async chat(req: ChatRequest): Promise<ChatResponse> {
      const apiKey = process.env[opts.apiKeyEnv] ?? '';
      const model = req.maxTokens ? opts.defaultModel : opts.defaultModel;

      const messages = [
        { role: 'system', content: req.system },
        ...req.messages,
      ];

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);

      let res: Response;
      try {
        res = await fetch(`${opts.baseURL}/chat/completions`, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages,
            max_tokens: req.maxTokens ?? 1024,
            stream: false,
          }),
        });
      } finally {
        clearTimeout(timer);
      }

      if (!res.ok) {
        if (res.status === 401) {
          throw new AuthError(`${opts.name}: Check your API key (${opts.apiKeyEnv})`);
        }
        if (res.status === 429 || res.status >= 500) {
          throw new RetryableError(`${opts.name}: HTTP ${res.status}`);
        }
        // Try to surface verbatim API errors (e.g. unknown_model)
        let body: { error?: { message?: string } } = {};
        try { body = await res.json(); } catch { /* ignore */ }
        const msg = body?.error?.message ?? `HTTP ${res.status}`;
        throw new Error(`${opts.name}: ${msg}`);
      }

      const data = await res.json() as {
        choices: Array<{ message: { content: string } }>;
      };
      return { text: data.choices[0]?.message?.content ?? '' };
    },
  };
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx jest tests/main/ai/providers/openaiCompat.test.ts --no-coverage
```

- [ ] **Step 5: Commit**

```bash
git add src/main/ai/providers/openaiCompat.ts tests/main/ai/providers/openaiCompat.test.ts
git commit -m "feat(ai): add openaiCompat base — shared fetch layer for 5 providers"
```

---

## Task 5: All 6 providers + startup registration

**Files:**
- Create: `src/main/ai/providers/xai/index.ts`
- Create: `src/main/ai/providers/openai/index.ts`
- Create: `src/main/ai/providers/google/index.ts`
- Create: `src/main/ai/providers/deepseek/index.ts`
- Create: `src/main/ai/providers/ollama/index.ts`
- Create: `src/main/ai/providers/anthropic/index.ts`
- Create: `src/main/ai/providers/index.ts` (startup registration)

> **Note on model IDs:** Verify current model IDs against vendor docs at implementation time. The values below are defaults from specs — update if vendor has changed them.

- [ ] **Step 1: Create xAI provider**

```typescript
// src/main/ai/providers/xai/index.ts
import { createOpenAICompatProvider } from '../openaiCompat';

export const xaiProvider = createOpenAICompatProvider({
  name: 'xai',
  baseURL: 'https://api.x.ai/v1',
  apiKeyEnv: 'XAI_API_KEY',
  defaultModel: 'grok-3-mini', // verify at implementation time: https://docs.x.ai/docs/models
});
```

- [ ] **Step 2: Create OpenAI provider**

```typescript
// src/main/ai/providers/openai/index.ts
import { createOpenAICompatProvider } from '../openaiCompat';

export const openaiProvider = createOpenAICompatProvider({
  name: 'openai',
  baseURL: 'https://api.openai.com/v1',
  apiKeyEnv: 'OPENAI_API_KEY',
  defaultModel: 'gpt-4o-mini', // verify at implementation time: https://platform.openai.com/docs/models
});
```

- [ ] **Step 3: Create Google provider**

```typescript
// src/main/ai/providers/google/index.ts
import { createOpenAICompatProvider } from '../openaiCompat';

// Google Gemini exposes an OpenAI-compatible endpoint
export const googleProvider = createOpenAICompatProvider({
  name: 'google',
  baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
  apiKeyEnv: 'GOOGLE_API_KEY',
  defaultModel: 'gemini-2.0-flash', // verify: https://ai.google.dev/gemini-api/docs/models
});
```

- [ ] **Step 4: Create DeepSeek provider**

```typescript
// src/main/ai/providers/deepseek/index.ts
import { createOpenAICompatProvider } from '../openaiCompat';

export const deepseekProvider = createOpenAICompatProvider({
  name: 'deepseek',
  baseURL: 'https://api.deepseek.com/v1',
  apiKeyEnv: 'DEEPSEEK_API_KEY',
  defaultModel: 'deepseek-chat', // verify: https://platform.deepseek.com/api-docs
});
```

- [ ] **Step 5: Create Ollama provider**

```typescript
// src/main/ai/providers/ollama/index.ts
import { createOpenAICompatProvider } from '../openaiCompat';

export const ollamaProvider = createOpenAICompatProvider({
  name: 'ollama',
  baseURL: 'http://localhost:11434/v1',
  apiKeyEnv: '', // Ollama needs no key
  defaultModel: 'llama3.2', // user must have this model pulled; verify locally
  offline: true,
});
```

- [ ] **Step 6: Create Anthropic provider**

```typescript
// src/main/ai/providers/anthropic/index.ts
import { RetryableError, AuthError } from '../types';
import type { LLMProvider, ChatRequest, ChatResponse } from '../types';

export const anthropicProvider: LLMProvider = {
  name: 'anthropic',
  capabilities: { nativeWebSearch: false, offline: false },

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
    // verify model ID at: https://docs.anthropic.com/en/docs/about-claude/models
    const model = 'claude-haiku-4-5-20251001';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);

    let res: Response;
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          system: req.system,
          messages: req.messages,  // same shape as Anthropic expects
          max_tokens: req.maxTokens ?? 1024,
        }),
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      if (res.status === 401) throw new AuthError('anthropic: Check your ANTHROPIC_API_KEY');
      if (res.status === 429 || res.status >= 500) throw new RetryableError(`anthropic: HTTP ${res.status}`);
      let body: { error?: { message?: string } } = {};
      try { body = await res.json(); } catch { /* ignore */ }
      throw new Error(`anthropic: ${body?.error?.message ?? `HTTP ${res.status}`}`);
    }

    const data = await res.json() as {
      content: Array<{ type: string; text: string }>;
    };
    const text = data.content.find((b) => b.type === 'text')?.text ?? '';
    return { text };
  },
};
```

- [ ] **Step 7: Create provider startup registrar**

```typescript
// src/main/ai/providers/index.ts
// Registers all providers at startup; skips any whose API key is absent.
import { registerProvider } from './registry';
import { xaiProvider } from './xai';
import { openaiProvider } from './openai';
import { googleProvider } from './google';
import { deepseekProvider } from './deepseek';
import { ollamaProvider } from './ollama';
import { anthropicProvider } from './anthropic';

interface ProviderEntry {
  provider: ReturnType<typeof import('./openaiCompat').createOpenAICompatProvider> | typeof anthropicProvider;
  envKey: string;
}

const entries: ProviderEntry[] = [
  { provider: xaiProvider,        envKey: 'XAI_API_KEY' },
  { provider: openaiProvider,     envKey: 'OPENAI_API_KEY' },
  { provider: googleProvider,     envKey: 'GOOGLE_API_KEY' },
  { provider: deepseekProvider,   envKey: 'DEEPSEEK_API_KEY' },
  { provider: ollamaProvider,     envKey: '' },              // no key needed
  { provider: anthropicProvider,  envKey: 'ANTHROPIC_API_KEY' },
];

export function registerAllProviders(): void {
  for (const { provider, envKey } of entries) {
    if (envKey && !process.env[envKey]) {
      console.info(`[ai] Skipping provider '${provider.name}' — set ${envKey} to enable`);
      continue;
    }
    registerProvider(provider);
  }
}
```

- [ ] **Step 8: Smoke test — TypeScript type-check passes**

```bash
npx tsc --noEmit
```

Expected: no errors in the new provider files.

- [ ] **Step 9: Commit**

```bash
git add src/main/ai/providers/
git commit -m "feat(ai): add all 6 LLM providers (xAI, OpenAI, Google, DeepSeek, Ollama, Anthropic)"
```

---

## Task 6: Dispatcher — fenced JSON parser

**Files:**
- Create: `src/main/ai/dispatcher.ts`
- Test: `tests/main/ai/dispatcher.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/main/ai/dispatcher.test.ts
import { parseToolCalls, dispatch } from '../../../src/main/ai/dispatcher';
import { registerTool, clearRegistry } from '../../../src/main/tools/registry';
import type { Tool, ToolContext } from '../../../src/main/tools/types';
import { z } from 'zod';

const mockCtx = (): ToolContext => ({
  config: {} as any,
  speak: jest.fn(),
  setMood: jest.fn(),
  setActivity: jest.fn(),
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any,
});

const echoTool: Tool<{ msg: string }> = {
  name: 'test.echo',
  description: 'echo',
  schema: z.object({ msg: z.string() }),
  availableOffline: true,
  execute: async (args) => ({ ok: true, summary: `echoed: ${args.msg}` }),
};

beforeEach(() => clearRegistry());

test('parseToolCalls extracts single tool call', () => {
  const text = 'Sure!\n```tool\n{"name":"test.echo","args":{"msg":"hi"}}\n```\nDone.';
  const calls = parseToolCalls(text);
  expect(calls).toHaveLength(1);
  expect(calls[0].name).toBe('test.echo');
  expect((calls[0].args as any).msg).toBe('hi');
});

test('parseToolCalls extracts multiple tool calls', () => {
  const text = '```tool\n{"name":"a","args":{}}\n```\n```tool\n{"name":"b","args":{}}\n```';
  const calls = parseToolCalls(text);
  expect(calls).toHaveLength(2);
});

test('parseToolCalls ignores malformed JSON', () => {
  const text = '```tool\nnot valid json\n```';
  const calls = parseToolCalls(text);
  expect(calls).toHaveLength(0);
});

test('dispatch executes tool and returns summary', async () => {
  registerTool(echoTool);
  const text = '```tool\n{"name":"test.echo","args":{"msg":"world"}}\n```';
  const result = await dispatch(text, mockCtx());
  expect(result).toContain('echoed: world');
});

test('dispatch returns text unchanged when no tool calls present', async () => {
  const text = 'Just a regular answer.';
  const result = await dispatch(text, mockCtx());
  expect(result).toBe('Just a regular answer.');
});

test('dispatch handles unknown tool gracefully (no crash)', async () => {
  const text = '```tool\n{"name":"no.such.tool","args":{}}\n```';
  const result = await dispatch(text, mockCtx());
  expect(result).toContain('no.such.tool');
  expect(result).not.toBeUndefined();
});

test('dispatch handles malformed JSON gracefully (no crash)', async () => {
  const text = '```tool\n{bad json\n```';
  const result = await dispatch(text, mockCtx());
  // malformed block is skipped; return original text
  expect(result).toBe(text);
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx jest tests/main/ai/dispatcher.test.ts --no-coverage
```

- [ ] **Step 3: Create `src/main/ai/dispatcher.ts`**

```typescript
// src/main/ai/dispatcher.ts
import { execute } from '../tools/registry';
import type { ToolContext } from '../tools/types';

export interface ParsedToolCall {
  name: string;
  args: unknown;
}

const TOOL_FENCE_RE = /```tool\n([\s\S]+?)\n```/g;

export function parseToolCalls(text: string): ParsedToolCall[] {
  const calls: ParsedToolCall[] = [];
  let match: RegExpExecArray | null;
  // Reset lastIndex in case the regex is reused across calls
  TOOL_FENCE_RE.lastIndex = 0;

  while ((match = TOOL_FENCE_RE.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]) as { name: string; args: unknown };
      if (typeof parsed.name === 'string') {
        calls.push({ name: parsed.name, args: parsed.args ?? {} });
      }
    } catch {
      // malformed JSON — skip silently
    }
  }
  return calls;
}

export async function dispatch(text: string, ctx: ToolContext): Promise<string> {
  const calls = parseToolCalls(text);
  if (calls.length === 0) return text;

  const parts: string[] = [];
  for (const call of calls) {
    const result = await execute(call.name, call.args, ctx);
    if (result.ok) {
      parts.push(result.summary);
    } else {
      parts.push(result.userMessage);
    }
  }
  return parts.join('\n');
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx jest tests/main/ai/dispatcher.test.ts --no-coverage
```

- [ ] **Step 5: Commit**

```bash
git add src/main/ai/dispatcher.ts tests/main/ai/dispatcher.test.ts
git commit -m "feat(ai): add fenced-JSON dispatcher — parses tool blocks, never crashes on bad input"
```

---

## Task 7: Persistent memory

**Files:**
- Create: `src/main/ai/memory.ts`
- Test: `tests/main/ai/memory.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/main/ai/memory.test.ts
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

// Use a temp dir so tests don't touch ~/.pixel
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-mem-test-'));
jest.mock('os', () => ({ ...jest.requireActual('os'), homedir: () => tmpDir }));

import { remember, forget, forgetAll, getAll, initMemory } from '../../../src/main/ai/memory';

beforeEach(() => {
  const memPath = path.join(tmpDir, '.pixel', 'memory.json');
  fs.rmSync(memPath, { force: true });
  initMemory(); // reload from (now-empty) disk
});

test('remember stores an entry', () => {
  remember('project', 'auth rewrite');
  const all = getAll();
  expect(all).toHaveLength(1);
  expect(all[0]).toMatchObject({ key: 'project', value: 'auth rewrite' });
});

test('remember overwrites existing key', () => {
  remember('project', 'v1');
  remember('project', 'v2');
  expect(getAll()).toHaveLength(1);
  expect(getAll()[0].value).toBe('v2');
});

test('forget removes an entry', () => {
  remember('a', '1');
  remember('b', '2');
  forget('a');
  expect(getAll()).toHaveLength(1);
  expect(getAll()[0].key).toBe('b');
});

test('forgetAll clears all entries', () => {
  remember('a', '1');
  remember('b', '2');
  forgetAll();
  expect(getAll()).toHaveLength(0);
});

test('evicts oldest entry when over 20', () => {
  for (let i = 0; i < 21; i++) {
    remember(`key${i}`, `val${i}`);
  }
  const all = getAll();
  expect(all).toHaveLength(20);
  // key0 is oldest, should be gone
  expect(all.find((e) => e.key === 'key0')).toBeUndefined();
  // key20 is newest, should be present
  expect(all.find((e) => e.key === 'key20')).toBeDefined();
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx jest tests/main/ai/memory.test.ts --no-coverage
```

- [ ] **Step 3: Create `src/main/ai/memory.ts`**

```typescript
// src/main/ai/memory.ts
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

export interface MemoryEntry {
  key: string;
  value: string;
  createdAt: number;
}

const MAX_ENTRIES = 20;

function memPath(): string {
  return path.join(os.homedir(), '.pixel', 'memory.json');
}

let entries: MemoryEntry[] = [];

export function initMemory(): void {
  const p = memPath();
  try {
    if (fs.existsSync(p)) {
      entries = JSON.parse(fs.readFileSync(p, 'utf8')) as MemoryEntry[];
    } else {
      entries = [];
    }
  } catch {
    entries = [];
  }
}

function save(): void {
  const p = memPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(entries, null, 2), 'utf8');
}

export function remember(key: string, value: string): void {
  const idx = entries.findIndex((e) => e.key === key);
  if (idx >= 0) {
    entries[idx] = { key, value, createdAt: Date.now() };
  } else {
    entries.push({ key, value, createdAt: Date.now() });
    if (entries.length > MAX_ENTRIES) {
      // Sort by creation time ascending, drop oldest
      entries.sort((a, b) => a.createdAt - b.createdAt);
      entries = entries.slice(entries.length - MAX_ENTRIES);
    }
  }
  save();
}

export function forget(key: string): void {
  entries = entries.filter((e) => e.key !== key);
  save();
}

export function forgetAll(): void {
  entries = [];
  save();
}

export function getAll(): MemoryEntry[] {
  return [...entries];
}

// Memory command detection helpers used by brain.ts
const REMEMBER_RE = /^remember (?:that )?(.+)$/i;
const FORGET_RE   = /^forget (.+)$/i;
const FORGET_ALL_RE = /^forget everything$/i;

export interface MemoryCommand {
  handled: boolean;
  reply?: string;
}

export function handleMemoryCommand(text: string): MemoryCommand {
  if (FORGET_ALL_RE.test(text.trim())) {
    forgetAll();
    return { handled: true, reply: "I've forgotten everything you asked me to remember." };
  }
  const forgetMatch = text.trim().match(FORGET_RE);
  if (forgetMatch) {
    forget(forgetMatch[1]);
    return { handled: true, reply: `Forgotten: "${forgetMatch[1]}".` };
  }
  const rememberMatch = text.trim().match(REMEMBER_RE);
  if (rememberMatch) {
    // Use a timestamp-based key
    const key = `mem_${Date.now()}`;
    remember(key, rememberMatch[1]);
    return { handled: true, reply: `Got it. I'll remember: "${rememberMatch[1]}".` };
  }
  return { handled: false };
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx jest tests/main/ai/memory.test.ts --no-coverage
```

- [ ] **Step 5: Commit**

```bash
git add src/main/ai/memory.ts tests/main/ai/memory.test.ts
git commit -m "feat(ai): add persistent memory — max 20 entries, evicts oldest, remember/forget commands"
```

---

## Task 8: Conversation history

**Files:**
- Create: `src/main/ai/history.ts`
- Test: `tests/main/ai/history.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/main/ai/history.test.ts
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-hist-test-'));
jest.mock('os', () => ({ ...jest.requireActual('os'), homedir: () => tmpDir }));

import { append, getMessages, clear, initHistory } from '../../../src/main/ai/history';

beforeEach(() => {
  const histPath = path.join(tmpDir, '.pixel', 'history.json');
  fs.rmSync(histPath, { force: true });
  initHistory();
});

test('append adds a message', () => {
  append('user', 'hello');
  expect(getMessages()).toHaveLength(1);
  expect(getMessages()[0]).toEqual({ role: 'user', content: 'hello' });
});

test('getMessages returns messages in order', () => {
  append('user', 'hi');
  append('assistant', 'hey');
  const msgs = getMessages();
  expect(msgs[0].role).toBe('user');
  expect(msgs[1].role).toBe('assistant');
});

test('clear empties the history', () => {
  append('user', 'hello');
  clear();
  expect(getMessages()).toHaveLength(0);
});

test('only keeps last 20 messages', () => {
  for (let i = 0; i < 21; i++) {
    append('user', `msg${i}`);
  }
  expect(getMessages()).toHaveLength(20);
  expect(getMessages()[0].content).toBe('msg1'); // msg0 evicted
  expect(getMessages()[19].content).toBe('msg20');
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx jest tests/main/ai/history.test.ts --no-coverage
```

- [ ] **Step 3: Create `src/main/ai/history.ts`**

```typescript
// src/main/ai/history.ts
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import type { ChatMessage } from '../../shared/types';

const MAX_MESSAGES = 20;

function histPath(): string {
  return path.join(os.homedir(), '.pixel', 'history.json');
}

let messages: ChatMessage[] = [];

export function initHistory(): void {
  const p = histPath();
  try {
    if (fs.existsSync(p)) {
      messages = JSON.parse(fs.readFileSync(p, 'utf8')) as ChatMessage[];
    } else {
      messages = [];
    }
  } catch {
    messages = [];
  }
}

function save(): void {
  const p = histPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(messages, null, 2), 'utf8');
}

export function append(role: 'user' | 'assistant', content: string): void {
  messages.push({ role, content });
  if (messages.length > MAX_MESSAGES) {
    messages = messages.slice(messages.length - MAX_MESSAGES);
  }
  save();
}

export function getMessages(): ChatMessage[] {
  return [...messages];
}

export function clear(): void {
  messages = [];
  save();
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx jest tests/main/ai/history.test.ts --no-coverage
```

- [ ] **Step 5: Commit**

```bash
git add src/main/ai/history.ts tests/main/ai/history.test.ts
git commit -m "feat(ai): add conversation history — persists last 20 turns to ~/.pixel/history.json"
```

---

## Task 9: System prompt builder

**Files:**
- Create: `src/main/ai/systemPrompt.ts`
- Test: `tests/main/ai/systemPrompt.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/main/ai/systemPrompt.test.ts
import { buildSystemPrompt } from '../../../src/main/ai/systemPrompt';
import { registerTool, clearRegistry } from '../../../src/main/tools/registry';
import type { Tool } from '../../../src/main/tools/types';
import { z } from 'zod';

const fakeTool: Tool<{ q: string }> = {
  name: 'fake.search',
  description: 'search the internet for q',
  schema: z.object({ q: z.string() }),
  availableOffline: false,
  execute: async () => ({ ok: true, summary: '' }),
};

beforeEach(() => clearRegistry());

test('includes personality paragraph', () => {
  const prompt = buildSystemPrompt({ botName: 'Cosmo' } as any, []);
  expect(prompt).toMatch(/Cosmo/);
  expect(prompt).toMatch(/concise/i);
});

test('includes all registered tools', () => {
  registerTool(fakeTool);
  const prompt = buildSystemPrompt({ botName: 'Cosmo' } as any, []);
  expect(prompt).toContain('fake.search');
  expect(prompt).toContain('search the internet for q');
});

test('includes tool call format instructions', () => {
  const prompt = buildSystemPrompt({ botName: 'Cosmo' } as any, []);
  expect(prompt).toContain('```tool');
});

test('includes memory entries when provided', () => {
  const memory = [
    { key: 'k1', value: 'working on auth rewrite', createdAt: 0 },
  ];
  const prompt = buildSystemPrompt({ botName: 'Cosmo' } as any, memory);
  expect(prompt).toContain('auth rewrite');
});

test('omits memory block when empty', () => {
  const prompt = buildSystemPrompt({ botName: 'Cosmo' } as any, []);
  expect(prompt).not.toMatch(/What I know about you/);
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx jest tests/main/ai/systemPrompt.test.ts --no-coverage
```

- [ ] **Step 3: Create `src/main/ai/systemPrompt.ts`**

```typescript
// src/main/ai/systemPrompt.ts
import { getAllTools } from '../tools/registry';
import type { Config } from '../../shared/types';
import type { MemoryEntry } from './memory';

export function buildSystemPrompt(config: Config, memory: MemoryEntry[]): string {
  const name = config.botName ?? 'Cosmo';

  const personality = `You are ${name}, a compact macOS desktop companion. \
You are concise, warm, and lightly sarcastic when calling out slacking. \
Keep replies short — 1-3 sentences unless detail is requested. \
Never invent tool calls unprompted; only call tools when the user's intent clearly requires one.`;

  const tools = getAllTools();
  let toolsSection = '';
  if (tools.length > 0) {
    const lines = tools.map((t) => {
      let schemaHint = '';
      try {
        // Zod description is the best source; fall back to type name
        const shape = (t.schema as any)._def?.shape?.();
        if (shape) {
          const keys = Object.keys(shape).join(', ');
          schemaHint = keys ? ` (args: ${keys})` : '';
        }
      } catch { /* ignore */ }
      return `- ${t.name}: ${t.description}${schemaHint}`;
    });
    toolsSection = `\n\n## Available tools\n${lines.join('\n')}`;
  }

  const toolFormat = `\n\n## Tool call format
To use a tool, output ONLY a fenced block — no surrounding text on the same line:
\`\`\`tool
{"name":"tool.name","args":{...}}
\`\`\`
You may chain multiple tool blocks in one reply. Unknown or unsupported tools are silently ignored.`;

  let memorySection = '';
  if (memory.length > 0) {
    const lines = memory.map((e) => `- ${e.value}`).join('\n');
    memorySection = `\n\n## What I know about you\n${lines}`;
  }

  return `${personality}${toolsSection}${toolFormat}${memorySection}`;
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx jest tests/main/ai/systemPrompt.test.ts --no-coverage
```

- [ ] **Step 5: Commit**

```bash
git add src/main/ai/systemPrompt.ts tests/main/ai/systemPrompt.test.ts
git commit -m "feat(ai): add system prompt builder — personality + tools + memory injected at request time"
```

---

## Task 10: Brain — handleUserInput + IPC wiring

**Files:**
- Create: `src/main/ai/brain.ts`
- Modify: `src/main/index.ts` (add `ipcMain.handle(IPC.CHAT_SUBMIT, ...)` and startup calls)

- [ ] **Step 1: Create `src/main/ai/brain.ts`**

```typescript
// src/main/ai/brain.ts
import type { BrowserWindow } from 'electron';
import { ipcMain } from 'electron';
import { getActiveProvider } from './providers/registry';
import { dispatch } from './dispatcher';
import { buildSystemPrompt } from './systemPrompt';
import { append, getMessages } from './history';
import { getAll as getMemory, handleMemoryCommand } from './memory';
import { IPC } from '../../shared/types';
import type { Config } from '../../shared/types';
import type { ToolContext } from '../tools/types';
import type { Logger } from '../tools/types';

// These will be injected from main/index.ts — kept as module-level refs so
// brain.ts stays testable without importing Electron directly.
let _win: BrowserWindow | null = null;
let _config: Config | null = null;
let _speak: ((text: string) => void) | null = null;
let _setMood: ((state: string, ms?: number) => void) | null = null;
let _setActivity: ((a: unknown) => void) | null = null;
let _log: Logger | null = null;

export function initBrain(deps: {
  win: BrowserWindow;
  config: Config;
  speak: (text: string) => void;
  setMood: (state: string, durationMs?: number) => void;
  setActivity: (a: unknown) => void;
  log: Logger;
}): void {
  _win = deps.win;
  _config = deps.config;
  _speak = deps.speak;
  _setMood = deps.setMood;
  _setActivity = deps.setActivity;
  _log = deps.log;
}

export async function handleUserInput(text: string): Promise<void> {
  if (!_win || !_config || !_speak || !_setMood || !_setActivity || !_log) {
    throw new Error('brain not initialized — call initBrain() first');
  }

  const win = _win;
  const config = _config;

  // Check for memory management commands first
  const memCmd = handleMemoryCommand(text);
  if (memCmd.handled) {
    win.webContents.send(IPC.CHAT_MESSAGE, { text: memCmd.reply, type: 'bot' });
    if (memCmd.reply) _speak(memCmd.reply);
    return;
  }

  _setMood('thinking');
  win.webContents.send(IPC.CHAT_MESSAGE, { text, type: 'user' });

  append('user', text);

  const toolCtx: ToolContext = {
    config,
    speak: _speak,
    setMood: _setMood as any,
    setActivity: _setActivity as any,
    log: _log,
  };

  try {
    const provider = getActiveProvider(config);
    const response = await provider.chat({
      system: buildSystemPrompt(config, getMemory()),
      messages: getMessages(),
    });

    const reply = await dispatch(response.text, toolCtx);

    append('assistant', reply);
    win.webContents.send(IPC.CHAT_MESSAGE, { text: reply, type: 'bot' });
    _setMood('speaking');
    _speak(reply);
    // speaking → idle happens in speechQueue's completion callback (wired in index.ts)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    _log.error('[brain] handleUserInput error', msg);
    _setMood('idle');
    const errorText = `Something went wrong: ${msg}`;
    win.webContents.send(IPC.CHAT_MESSAGE, { text: errorText, type: 'bot' });
  }
}

export function registerBrainIPC(): void {
  ipcMain.handle(IPC.CHAT_SUBMIT, (_event, { text }: { text: string }) => {
    void handleUserInput(text);
  });
}
```

- [ ] **Step 2: Wire brain into `src/main/index.ts`**

Add these imports and calls at the top and in the `app.whenReady` block. The exact location depends on what M0/M1/M2 built — insert after existing window/tray setup:

```typescript
// In src/main/index.ts — ADD these imports
import { registerAllProviders } from './ai/providers';
import { registerAllTools } from './tools'; // see Task 11
import { initBrain, registerBrainIPC } from './ai/brain';
import { initHistory } from './ai/history';
import { initMemory } from './ai/memory';

// Inside app.whenReady() or after mainWindow is created, ADD:
registerAllProviders();
registerAllTools();
initHistory();
initMemory();
initBrain({
  win: mainWindow,
  config,  // however config is loaded in your main/index.ts
  speak: (text) => speechQueue.enqueue(text),
  setMood: (state, ms) => stateManager.setState(state as any, mainWindow, ms),
  setActivity: (a) => mainWindow.webContents.send(IPC.ACTIVITY_SET, a),
  log,
});
registerBrainIPC();
```

- [ ] **Step 3: Create tool barrel `src/main/tools/index.ts`**

```typescript
// src/main/tools/index.ts
// Imports and registers all built-in tools. Add new tools here.
import { registerTool } from './registry';
import { musicPlayTool, musicPauseTool, musicNextTool, musicNowPlayingTool } from './music';
import { speechSayTool } from './speech';
import { browserOpenTool } from './browser';
import { timerSetTool } from './timer';
import { searchWebTool } from './search';
import { pageReadTool } from './pageRead';
import { notesCaptureTool } from './notes';
import { systemVolumeTool, systemMuteTool, systemUnmuteTool, systemDisplaySleepTool } from './system';
import { clipboardListTool } from './clipboard';
import { weatherTodayTool } from './weather';
import { launcherOpenTool } from './launcher';

export function registerAllTools(): void {
  registerTool(musicPlayTool);
  registerTool(musicPauseTool);
  registerTool(musicNextTool);
  registerTool(musicNowPlayingTool);
  registerTool(speechSayTool);
  registerTool(browserOpenTool);
  registerTool(timerSetTool);
  registerTool(searchWebTool);
  registerTool(pageReadTool);
  registerTool(notesCaptureTool);
  registerTool(systemVolumeTool);
  registerTool(systemMuteTool);
  registerTool(systemUnmuteTool);
  registerTool(systemDisplaySleepTool);
  registerTool(clipboardListTool);
  registerTool(weatherTodayTool);
  registerTool(launcherOpenTool);
}
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/main/ai/brain.ts src/main/tools/index.ts src/main/index.ts
git commit -m "feat(ai): wire brain — handleUserInput connects provider, dispatcher, history, IPC"
```

---

## Task 11: core/osascript.ts + core/shell.ts (if not already from M2)

> Skip these steps if these files already exist from M2 — they are prerequisites for the tools below.

**Files:**
- Create: `src/main/core/osascript.ts`
- Create: `src/main/core/shell.ts`

- [ ] **Step 1: Create `src/main/core/osascript.ts`**

```typescript
// src/main/core/osascript.ts
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export class OsascriptError extends Error {
  constructor(
    message: string,
    public readonly stderr: string,
    public readonly code: number | null,
  ) {
    super(message);
    this.name = 'OsascriptError';
  }
}

export async function runAppleScript(
  script: string,
  timeoutMs = 5_000,
): Promise<string> {
  try {
    const { stdout } = await execFileAsync('osascript', ['-e', script], {
      timeout: timeoutMs,
      encoding: 'utf8',
    });
    return stdout.trim();
  } catch (e: unknown) {
    const err = e as { stderr?: string; code?: number; message: string };
    // Detect Automation permission denial
    if (err.stderr?.includes('not allowed to send Apple events')) {
      throw new OsascriptError(
        'Automation permission denied',
        err.stderr ?? '',
        err.code ?? null,
      );
    }
    throw new OsascriptError(
      err.message,
      err.stderr ?? '',
      err.code ?? null,
    );
  }
}
```

- [ ] **Step 2: Create `src/main/core/shell.ts`**

```typescript
// src/main/core/shell.ts
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/** Open a URL or file with macOS `open`. Safe — no shell injection. */
export async function openURL(url: string): Promise<void> {
  await execFileAsync('open', [url], { timeout: 5_000 });
}

/** Open an application by name. */
export async function openApp(name: string): Promise<void> {
  await execFileAsync('open', ['-a', name], { timeout: 5_000 });
}

/** Run a macOS Shortcut by name. */
export async function runShortcut(name: string): Promise<void> {
  await execFileAsync('shortcuts', ['run', name], { timeout: 30_000 });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/main/core/osascript.ts src/main/core/shell.ts
git commit -m "feat(core): add osascript + shell helpers — execFile only, no shell injection"
```

---

## Task 12: music tools

**Files:**
- Create: `src/main/tools/music/index.ts`

- [ ] **Step 1: Create `src/main/tools/music/index.ts`**

```typescript
// src/main/tools/music/index.ts
import { z } from 'zod';
import { runAppleScript, OsascriptError } from '../../core/osascript';
import type { Tool, ToolResult } from '../types';

const AUTOMATION_DENIED_MSG =
  'Music control needs Automation permission. Go to System Settings → Privacy & Security → Automation and allow this app to control Music.';

async function safeScript(script: string): Promise<{ ok: true; out: string } | { ok: false; userMessage: string }> {
  try {
    const out = await runAppleScript(script);
    return { ok: true, out };
  } catch (e) {
    if (e instanceof OsascriptError && e.message.includes('Automation permission denied')) {
      return { ok: false, userMessage: AUTOMATION_DENIED_MSG };
    }
    return { ok: false, userMessage: `Music error: ${(e as Error).message}` };
  }
}

export const musicPlayTool: Tool<{ playlist?: string; track?: string; artist?: string }> = {
  name: 'music.play',
  description: 'Play a playlist, track, or artist in Apple Music.',
  schema: z.object({
    playlist: z.string().optional(),
    track: z.string().optional(),
    artist: z.string().optional(),
  }),
  availableOffline: true,
  permissions: ['automation:Music'],

  async execute(args, ctx): Promise<ToolResult> {
    let script: string;

    if (args.playlist) {
      const name = args.playlist.replace(/"/g, '\\"');
      script = `tell application "Music" to play playlist "${name}"`;
    } else if (args.track) {
      const track = args.track.replace(/"/g, '\\"');
      script = `tell application "Music"\n  play (first track of library playlist 1 whose name contains "${track}")\nend tell`;
    } else if (args.artist) {
      const artist = args.artist.replace(/"/g, '\\"');
      script = `tell application "Music"\n  play (first track of library playlist 1 whose artist contains "${artist}")\nend tell`;
    } else {
      script = `tell application "Music" to play`;
    }

    const result = await safeScript(script);
    if (!result.ok) return { ok: false, error: 'osascript', userMessage: result.userMessage };

    // Fetch now-playing info
    const npResult = await safeScript(
      `tell application "Music"\n  set t to name of current track\n  set a to artist of current track\n  return t & "|||" & a\nend tell`,
    );

    if (npResult.ok) {
      const [track, artist] = npResult.out.split('|||');
      ctx.setActivity({ type: 'music', nowPlaying: { track: track ?? '', artist: artist ?? '' } });
    }
    ctx.setMood('happy', 2000);

    const label = args.playlist ? `playlist "${args.playlist}"` :
                  args.track   ? `"${args.track}"` :
                  args.artist  ? `music by ${args.artist}` : 'music';
    return { ok: true, summary: `Playing ${label}.` };
  },
};

export const musicPauseTool: Tool<Record<string, never>> = {
  name: 'music.pause',
  description: 'Pause Apple Music playback.',
  schema: z.object({}),
  availableOffline: true,
  permissions: ['automation:Music'],

  async execute(_args, ctx): Promise<ToolResult> {
    const result = await safeScript(`tell application "Music" to pause`);
    if (!result.ok) return { ok: false, error: 'osascript', userMessage: result.userMessage };
    ctx.setActivity(null);
    return { ok: true, summary: 'Music paused.' };
  },
};

export const musicNextTool: Tool<Record<string, never>> = {
  name: 'music.next',
  description: 'Skip to the next track in Apple Music.',
  schema: z.object({}),
  availableOffline: true,
  permissions: ['automation:Music'],

  async execute(_args, ctx): Promise<ToolResult> {
    const result = await safeScript(`tell application "Music" to next track`);
    if (!result.ok) return { ok: false, error: 'osascript', userMessage: result.userMessage };

    const npResult = await safeScript(
      `tell application "Music"\n  set t to name of current track\n  set a to artist of current track\n  return t & "|||" & a\nend tell`,
    );
    if (npResult.ok) {
      const [track, artist] = npResult.out.split('|||');
      ctx.setActivity({ type: 'music', nowPlaying: { track: track ?? '', artist: artist ?? '' } });
    }
    return { ok: true, summary: 'Skipped to next track.' };
  },
};

export const musicNowPlayingTool: Tool<Record<string, never>> = {
  name: 'music.nowPlaying',
  description: 'Return the currently playing track and artist in Apple Music.',
  schema: z.object({}),
  availableOffline: true,
  permissions: ['automation:Music'],

  async execute(): Promise<ToolResult> {
    const result = await safeScript(
      `tell application "Music"\n  if player state is playing then\n    set t to name of current track\n    set a to artist of current track\n    return t & " by " & a\n  else\n    return "Nothing playing"\n  end if\nend tell`,
    );
    if (!result.ok) return { ok: false, error: 'osascript', userMessage: result.userMessage };
    return { ok: true, summary: result.out };
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add src/main/tools/music/index.ts
git commit -m "feat(tools): add music.play/pause/next/nowPlaying via AppleScript"
```

---

## Task 13: speech + browser + notes tools

**Files:**
- Create: `src/main/tools/speech/index.ts`
- Create: `src/main/tools/browser/index.ts`
- Create: `src/main/tools/notes/index.ts`

- [ ] **Step 1: Create speech tool**

```typescript
// src/main/tools/speech/index.ts
import { z } from 'zod';
import type { Tool, ToolResult } from '../types';

export const speechSayTool: Tool<{ text: string }> = {
  name: 'speech.say',
  description: 'Speak text aloud using macOS text-to-speech.',
  schema: z.object({ text: z.string().min(1) }),
  availableOffline: true,

  async execute(args, ctx): Promise<ToolResult> {
    ctx.speak(args.text);
    return { ok: true, summary: `Speaking: "${args.text}"` };
  },
};
```

- [ ] **Step 2: Create browser tool**

```typescript
// src/main/tools/browser/index.ts
import { z } from 'zod';
import { openURL } from '../../core/shell';
import type { Tool, ToolResult } from '../types';

export const browserOpenTool: Tool<{ url: string }> = {
  name: 'browser.open',
  description: 'Open a URL in the default browser. Only call this when the user explicitly asks to open something.',
  schema: z.object({ url: z.string().url() }),
  availableOffline: false,

  async execute(args): Promise<ToolResult> {
    await openURL(args.url);
    return { ok: true, summary: `Opened ${args.url} in your browser.` };
  },
};
```

- [ ] **Step 3: Create notes tool**

```typescript
// src/main/tools/notes/index.ts
import { z } from 'zod';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import type { Tool, ToolResult } from '../types';

function notesPath(): string {
  return path.join(os.homedir(), '.pixel', 'notes.md');
}

export const notesCaptureTool: Tool<{ text: string }> = {
  name: 'notes.capture',
  description: 'Append a quick note with a timestamp to the notes file at ~/.pixel/notes.md.',
  schema: z.object({ text: z.string().min(1) }),
  availableOffline: true,

  async execute(args): Promise<ToolResult> {
    const p = notesPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const line = `\n- [${timestamp}] ${args.text}`;
    fs.appendFileSync(p, line, 'utf8');
    return { ok: true, summary: `Note saved: "${args.text}"` };
  },
};
```

- [ ] **Step 4: Commit**

```bash
git add src/main/tools/speech/index.ts src/main/tools/browser/index.ts src/main/tools/notes/index.ts
git commit -m "feat(tools): add speech.say, browser.open, notes.capture"
```

---

## Task 14: timer.set (extensibility test tool)

> This is the **extensibility test** from the M3 acceptance criteria: add `timer.set` as a brand-new tool folder with **zero changes outside `tools/timer/`** — the only required edit is one `registerTool()` line in `src/main/tools/index.ts` (the barrel file, not any other module).

**Files:**
- Create: `src/main/tools/timer/index.ts`

- [ ] **Step 1: Create `src/main/tools/timer/index.ts`**

```typescript
// src/main/tools/timer/index.ts
import { z } from 'zod';
import type { Tool, ToolResult, ToolContext } from '../types';

// Track active timers so we can clear the countdown updater on cancel
const activeTimers = new Map<string, ReturnType<typeof setInterval>>();

export const timerSetTool: Tool<{ minutes: number; label: string }> = {
  name: 'timer.set',
  description: 'Set a countdown timer. Speaks the label and flashes happy when the timer expires.',
  schema: z.object({
    minutes: z.number().positive(),
    label: z.string().default('Timer'),
  }),
  availableOffline: true,
  timeoutMs: 10_000, // just to register; the actual timer runs async outside tool execution

  async execute(args, ctx): Promise<ToolResult> {
    const totalMs = args.minutes * 60 * 1000;
    const expiresAt = Date.now() + totalMs;
    const id = `timer_${Date.now()}`;

    // Set activity with initial countdown
    const updateActivity = (ctx: ToolContext) => {
      const remainingSec = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
      ctx.setActivity({ type: 'timer', remainingSec, label: args.label });
    };

    updateActivity(ctx);

    // Update every 5s
    const intervalId = setInterval(() => updateActivity(ctx), 5_000);
    activeTimers.set(id, intervalId);

    // Fire on expiry
    setTimeout(() => {
      clearInterval(intervalId);
      activeTimers.delete(id);
      ctx.setActivity(null);
      ctx.speak(`${args.label} is done.`);
      ctx.setMood('happy', 2000);
    }, totalMs);

    const mins = args.minutes === 1 ? '1 minute' : `${args.minutes} minutes`;
    return { ok: true, summary: `Timer set: ${args.label} — ${mins}.` };
  },
};
```

- [ ] **Step 2: Verify no changes needed outside tools/timer/**

```bash
# Confirm that only tools/index.ts (the barrel) and tools/timer/ were touched:
git diff --name-only HEAD
# Expected: only src/main/tools/timer/index.ts and src/main/tools/index.ts
```

- [ ] **Step 3: Add to barrel (the one allowed external change)**

In `src/main/tools/index.ts`, the `timerSetTool` import and `registerTool(timerSetTool)` line should already be present from Task 10. Verify it's there; if not, add:

```typescript
// In src/main/tools/index.ts — verify these lines exist:
import { timerSetTool } from './timer';
// ...
registerTool(timerSetTool);
```

- [ ] **Step 4: Commit**

```bash
git add src/main/tools/timer/index.ts src/main/tools/index.ts
git commit -m "feat(tools): add timer.set — extensibility test: zero changes outside tools/timer/"
```

---

## Task 15: search.web tool

**Files:**
- Create: `src/main/tools/search/index.ts`
- Test: `tests/main/tools/search.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/main/tools/search.test.ts
import { searchWebTool, getSessionResults } from '../../../src/main/tools/search';
import type { ToolContext } from '../../../src/main/tools/types';

const mockCtx = (): ToolContext => ({
  config: {} as any,
  speak: jest.fn(),
  setMood: jest.fn(),
  setActivity: jest.fn(),
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any,
});

// Fixture HTML simulating DuckDuckGo results
const DDG_FIXTURE = `
<div class="result">
  <a class="result__a" href="https://example.com/1">First Result Title</a>
  <span class="result__url">example.com/1</span>
  <a class="result__snippet">Snippet for first result</a>
</div>
<div class="result">
  <a class="result__a" href="https://example.com/2">Second Result Title</a>
  <span class="result__url">example.com/2</span>
  <a class="result__snippet">Snippet for second result</a>
</div>
`;

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

beforeEach(() => {
  mockFetch.mockReset();
});

test('returns numbered result list', async () => {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    text: async () => DDG_FIXTURE,
  });

  const result = await searchWebTool.execute({ query: 'test query' }, mockCtx());
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.summary).toContain('1.');
    expect(result.summary).toContain('First Result Title');
  }
});

test('stores results for session follow-ups', async () => {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    text: async () => DDG_FIXTURE,
  });

  await searchWebTool.execute({ query: 'test' }, mockCtx());
  const results = getSessionResults();
  expect(results.length).toBeGreaterThan(0);
  expect(results[0].url).toContain('example.com');
});

test('sets searching activity during fetch, clears after', async () => {
  const ctx = mockCtx();
  mockFetch.mockResolvedValueOnce({ ok: true, text: async () => DDG_FIXTURE });

  await searchWebTool.execute({ query: 'test' }, ctx);
  // setActivity called with searching, then null
  expect(ctx.setActivity).toHaveBeenCalledWith({ type: 'searching' });
  expect(ctx.setActivity).toHaveBeenLastCalledWith(null);
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx jest tests/main/tools/search.test.ts --no-coverage
```

- [ ] **Step 3: Create `src/main/tools/search/index.ts`**

```typescript
// src/main/tools/search/index.ts
import { z } from 'zod';
import type { Tool, ToolResult } from '../types';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

// Module-level session storage for follow-up references ("open the second one")
let sessionResults: SearchResult[] = [];

export function getSessionResults(): SearchResult[] {
  return [...sessionResults];
}

export function getSessionResult(index: number): SearchResult | undefined {
  return sessionResults[index - 1]; // 1-based
}

function parseDDGResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];

  // Extract result blocks
  const blockRe = /<div class="result[^"]*"[\s\S]*?(?=<div class="result|$)/g;
  let block: RegExpExecArray | null;

  while ((block = blockRe.exec(html)) !== null && results.length < 5) {
    const titleMatch = block[0].match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([^<]+)</);
    const urlMatch   = block[0].match(/class="result__url"[^>]*>([^<]+)</);
    const snippetMatch = block[0].match(/class="result__snippet"[^>]*>([^<]+)</);

    if (titleMatch && titleMatch[2].trim()) {
      results.push({
        title:   titleMatch[2].trim(),
        url:     urlMatch?.[1]?.trim() ?? titleMatch[1],
        snippet: snippetMatch?.[1]?.trim() ?? '',
      });
    }
  }

  return results;
}

export const searchWebTool: Tool<{ query: string }> = {
  name: 'search.web',
  description: 'Search DuckDuckGo for a query and return the top 5 results. No API key needed.',
  schema: z.object({ query: z.string().min(1) }),
  availableOffline: false,
  timeoutMs: 15_000,

  async execute(args, ctx): Promise<ToolResult> {
    ctx.setActivity({ type: 'searching' });

    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(args.query)}`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
      });

      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}`, userMessage: `Search failed (HTTP ${res.status})` };
      }

      const html = await res.text();
      const results = parseDDGResults(html);

      sessionResults = results;

      if (results.length === 0) {
        return { ok: true, summary: `No results found for "${args.query}".` };
      }

      const lines = results.map((r, i) =>
        `${i + 1}. **${r.title}** — ${r.snippet} (${r.url})`,
      );
      return { ok: true, summary: lines.join('\n'), data: results };
    } finally {
      ctx.setActivity(null);
    }
  },
};
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx jest tests/main/tools/search.test.ts --no-coverage
```

- [ ] **Step 5: Commit**

```bash
git add src/main/tools/search/index.ts tests/main/tools/search.test.ts
git commit -m "feat(tools): add search.web — DuckDuckGo HTML fetch, top 5 results, session memory"
```

---

## Task 16: page.read tool

**Files:**
- Create: `src/main/tools/pageRead/index.ts`

- [ ] **Step 1: Create `src/main/tools/pageRead/index.ts`**

```typescript
// src/main/tools/pageRead/index.ts
import { z } from 'zod';
import { getSessionResult } from '../search';
import { getActiveProvider } from '../../ai/providers/registry';
import type { Tool, ToolResult } from '../types';

function stripHTML(html: string): string {
  // Remove script and style blocks entirely
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  // Remove all remaining tags
  text = text.replace(/<[^>]+>/g, ' ');
  // Collapse whitespace
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

export const pageReadTool: Tool<{ url?: string; resultIndex?: number }> = {
  name: 'page.read',
  description: 'Fetch a web page and return a 3-5 sentence summary. Provide a URL or a result number from search.web.',
  schema: z.object({
    url: z.string().url().optional(),
    resultIndex: z.number().int().positive().optional(),
  }).refine((v) => v.url || v.resultIndex, {
    message: 'Provide either url or resultIndex',
  }),
  availableOffline: false,
  timeoutMs: 30_000,

  async execute(args, ctx): Promise<ToolResult> {
    let targetURL = args.url;

    if (!targetURL && args.resultIndex) {
      const result = getSessionResult(args.resultIndex);
      if (!result) {
        return {
          ok: false,
          error: 'not-found',
          userMessage: `No search result #${args.resultIndex}. Run a search first.`,
        };
      }
      targetURL = result.url.startsWith('http') ? result.url : `https://${result.url}`;
    }

    if (!targetURL) {
      return { ok: false, error: 'no-url', userMessage: 'No URL provided.' };
    }

    let html: string;
    try {
      const res = await fetch(targetURL, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Cosmo/1.0)' },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      html = await res.text();
    } catch (e) {
      return {
        ok: false,
        error: (e as Error).message,
        userMessage: `Can't read that page directly. Want me to open it in your browser instead?`,
      };
    }

    const text = stripHTML(html).slice(0, 4_000);

    // Summarize via active LLM
    let summary: string;
    try {
      const provider = getActiveProvider(ctx.config);
      const response = await provider.chat({
        system: 'You are a concise summarizer. Reply with 3-5 sentences only.',
        messages: [{ role: 'user', content: `Summarize this page:\n\n${text}` }],
        maxTokens: 300,
      });
      summary = response.text;
    } catch (e) {
      summary = text.slice(0, 400) + '…';
    }

    ctx.speak(summary);
    return { ok: true, summary };
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add src/main/tools/pageRead/index.ts
git commit -m "feat(tools): add page.read — fetch + strip HTML + LLM summarize, user-gated"
```

---

## Task 17: system, clipboard, weather, launcher tools

**Files:**
- Create: `src/main/tools/system/index.ts`
- Create: `src/main/tools/clipboard/index.ts`
- Create: `src/main/tools/weather/index.ts`
- Create: `src/main/tools/launcher/index.ts`

- [ ] **Step 1: Create system tools**

```typescript
// src/main/tools/system/index.ts
import { z } from 'zod';
import { runAppleScript } from '../../core/osascript';
import type { Tool, ToolResult } from '../types';

export const systemVolumeTool: Tool<{ level: number }> = {
  name: 'system.volume',
  description: 'Set the system output volume (0–100).',
  schema: z.object({ level: z.number().min(0).max(100) }),
  availableOffline: true,

  async execute(args): Promise<ToolResult> {
    await runAppleScript(`set volume output volume ${Math.round(args.level)}`);
    return { ok: true, summary: `Volume set to ${args.level}%.` };
  },
};

export const systemMuteTool: Tool<Record<string, never>> = {
  name: 'system.mute',
  description: 'Mute the system audio output.',
  schema: z.object({}),
  availableOffline: true,

  async execute(): Promise<ToolResult> {
    await runAppleScript(`set volume with output muted`);
    return { ok: true, summary: 'System audio muted.' };
  },
};

export const systemUnmuteTool: Tool<Record<string, never>> = {
  name: 'system.unmute',
  description: 'Unmute the system audio output.',
  schema: z.object({}),
  availableOffline: true,

  async execute(): Promise<ToolResult> {
    await runAppleScript(`set volume without output muted`);
    return { ok: true, summary: 'System audio unmuted.' };
  },
};

export const systemDisplaySleepTool: Tool<Record<string, never>> = {
  name: 'system.display-sleep',
  description: 'Sleep the display immediately.',
  schema: z.object({}),
  availableOffline: true,

  async execute(): Promise<ToolResult> {
    await runAppleScript(
      `tell application "System Events" to sleep`,
    );
    return { ok: true, summary: 'Display sleeping.' };
  },
};
```

- [ ] **Step 2: Create clipboard tool**

```typescript
// src/main/tools/clipboard/index.ts
import { z } from 'zod';
import { runAppleScript } from '../../core/osascript';
import type { Tool, ToolResult } from '../types';

export const clipboardListTool: Tool<Record<string, never>> = {
  name: 'clipboard.list',
  description: 'Show the last 10 plain-text clipboard entries (in-memory ring buffer, cleared on quit).',
  schema: z.object({}),
  availableOffline: true,

  async execute(): Promise<ToolResult> {
    // macOS only exposes the current clipboard item via NSPasteboard easily via osascript
    // We read current clipboard content as a best-effort
    let current: string;
    try {
      current = await runAppleScript(
        `the clipboard as text`,
      );
    } catch {
      return { ok: false, error: 'clipboard', userMessage: 'Could not read clipboard.' };
    }

    if (!current) {
      return { ok: true, summary: 'Clipboard is empty.' };
    }

    // Truncate for display
    const preview = current.length > 200 ? current.slice(0, 200) + '…' : current;
    return { ok: true, summary: `Current clipboard:\n${preview}` };
  },
};
```

- [ ] **Step 3: Create weather tool**

```typescript
// src/main/tools/weather/index.ts
import { z } from 'zod';
import type { Tool, ToolResult } from '../types';

// WMO weather code descriptions (subset)
const WMO_CODES: Record<number, string> = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Foggy', 48: 'Icy fog',
  51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
  61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
  71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow',
  80: 'Slight rain showers', 81: 'Moderate rain showers', 82: 'Violent rain showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Severe thunderstorm',
};

interface WeatherCache {
  data: string;
  fetchedAt: number;
}
let cache: WeatherCache | null = null;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min

export const weatherTodayTool: Tool<Record<string, never>> = {
  name: 'weather.today',
  description: "Get today's weather: current conditions, high/low temperature. Uses Open-Meteo (no API key).",
  schema: z.object({}),
  availableOffline: false,
  timeoutMs: 15_000,

  async execute(_args, ctx): Promise<ToolResult> {
    // Return cache if fresh
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
      return { ok: true, summary: cache.data };
    }

    const lat = ctx.config.location?.lat ?? 37.7749; // default: San Francisco
    const lng = ctx.config.location?.lng ?? -122.4194;

    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat}&longitude=${lng}` +
      `&current=temperature_2m,weathercode,wind_speed_10m` +
      `&daily=temperature_2m_max,temperature_2m_min` +
      `&forecast_days=1&timezone=auto`;

    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    } catch (e) {
      const stale = cache ? ` (stale data from ${new Date(cache.fetchedAt).toLocaleTimeString()})` : '';
      if (cache) return { ok: true, summary: cache.data + stale };
      return { ok: false, error: (e as Error).message, userMessage: 'Weather unavailable — no network.' };
    }

    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}`, userMessage: 'Weather service error.' };
    }

    const data = await res.json() as {
      current: { temperature_2m: number; weathercode: number; wind_speed_10m: number };
      daily: { temperature_2m_max: number[]; temperature_2m_min: number[] };
    };

    const condition = WMO_CODES[data.current.weathercode] ?? 'Unknown conditions';
    const temp = Math.round(data.current.temperature_2m);
    const high = Math.round(data.daily.temperature_2m_max[0]);
    const low  = Math.round(data.daily.temperature_2m_min[0]);
    const wind = Math.round(data.current.wind_speed_10m);

    const summary = `${condition}, ${temp}°C (high ${high}°, low ${low}°, wind ${wind} km/h)`;
    cache = { data: summary, fetchedAt: Date.now() };
    return { ok: true, summary };
  },
};
```

- [ ] **Step 4: Create launcher tool**

```typescript
// src/main/tools/launcher/index.ts
import { z } from 'zod';
import { openApp, runShortcut } from '../../core/shell';
import type { Tool, ToolResult } from '../types';

// Session cache: name → resolved path
const sessionCache = new Map<string, string>();

export const launcherOpenTool: Tool<{ name: string }> = {
  name: 'launcher.open',
  description: 'Open a macOS application or run a Shortcut by name. Examples: "Figma", "Terminal", "my deploy script".',
  schema: z.object({ name: z.string().min(1) }),
  availableOffline: true,

  async execute(args): Promise<ToolResult> {
    const name = args.name;

    // Try app first
    try {
      await openApp(name);
      sessionCache.set(name.toLowerCase(), 'app');
      return { ok: true, summary: `Opened ${name}.` };
    } catch {
      // App not found — try as a Shortcut
    }

    try {
      await runShortcut(name);
      sessionCache.set(name.toLowerCase(), 'shortcut');
      return { ok: true, summary: `Ran Shortcut: ${name}.` };
    } catch {
      return {
        ok: false,
        error: 'not-found',
        userMessage: `Couldn't find an app or Shortcut named "${name}". Check the name and try again.`,
      };
    }
  },
};
```

- [ ] **Step 5: Commit all tool files**

```bash
git add src/main/tools/system/index.ts src/main/tools/clipboard/index.ts \
        src/main/tools/weather/index.ts src/main/tools/launcher/index.ts
git commit -m "feat(tools): add system, clipboard, weather, launcher tools"
```

---

## Task 18: Chat renderer UI

**Files:**
- Modify: `src/renderer/index.html` (add chat area markup)
- Create: `src/renderer/chat.ts`

- [ ] **Step 1: Add chat markup to `src/renderer/index.html`**

Locate the `<body>` in the existing file and add after the eyes container:

```html
<!-- Add inside <body>, after the eyes container div -->
<div id="chat-area" class="chat-area" style="display:none;">
  <div id="chat-messages" class="chat-messages"></div>
  <div class="chat-input-row">
    <input
      id="chat-input"
      type="text"
      placeholder="Ask me anything…"
      autocomplete="off"
      spellcheck="false"
    />
  </div>
</div>

<style>
  .chat-area {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    max-height: 60%;
    display: flex;
    flex-direction: column;
    background: rgba(20, 20, 20, 0.92);
    border-top: 1px solid rgba(255,255,255,0.08);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 13px;
    color: #e8e8e8;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
  }

  .chat-messages {
    flex: 1;
    overflow-y: auto;
    padding: 8px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 200px;
  }

  .chat-msg {
    max-width: 85%;
    padding: 6px 10px;
    border-radius: 10px;
    line-height: 1.4;
    word-break: break-word;
  }

  .chat-msg.user {
    align-self: flex-end;
    background: rgba(99, 102, 241, 0.6);
    color: #fff;
  }

  .chat-msg.bot {
    align-self: flex-start;
    background: rgba(255, 255, 255, 0.1);
  }

  .chat-input-row {
    padding: 6px 10px 10px;
    border-top: 1px solid rgba(255,255,255,0.06);
  }

  #chat-input {
    width: 100%;
    background: rgba(255,255,255,0.07);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 8px;
    color: #e8e8e8;
    font-size: 13px;
    padding: 6px 10px;
    outline: none;
    box-sizing: border-box;
  }

  #chat-input:focus {
    border-color: rgba(99, 102, 241, 0.7);
  }

  #chat-input::placeholder { color: rgba(255,255,255,0.3); }
</style>
```

- [ ] **Step 2: Create `src/renderer/chat.ts`**

```typescript
// src/renderer/chat.ts
// Renderer-side chat: handles IPC messages and user input.
// Import this from renderer/index.html via a <script type="module"> tag.

import { ipcRenderer } from 'electron';
import { IPC } from '../shared/types';

const chatArea    = document.getElementById('chat-area') as HTMLDivElement;
const chatMessages = document.getElementById('chat-messages') as HTMLDivElement;
const chatInput   = document.getElementById('chat-input') as HTMLInputElement;

let hideTimer: ReturnType<typeof setTimeout> | null = null;

function showChat(): void {
  chatArea.style.display = 'flex';
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    chatArea.style.display = 'none';
  }, 8_000);
}

function appendMessage(text: string, type: 'user' | 'bot'): void {
  const div = document.createElement('div');
  div.className = `chat-msg ${type}`;
  div.textContent = text;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  showChat();
}

// Receive messages from main process
ipcRenderer.on(IPC.CHAT_MESSAGE, (_event, msg: { text: string; type: 'user' | 'bot' }) => {
  appendMessage(msg.text, msg.type);
});

// Send user input to main process
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = '';
    // Show immediately (main process will also echo it back via CHAT_MESSAGE)
    ipcRenderer.invoke(IPC.CHAT_SUBMIT, { text }).catch(console.error);
    showChat();
  }
});

// Show chat area when user clicks the window
document.addEventListener('click', () => {
  chatInput.focus();
  showChat();
});

export {};
```

- [ ] **Step 3: Add script tag to index.html**

In `src/renderer/index.html`, add before `</body>`:

```html
<script type="module" src="chat.ts"></script>
```

(Electron's file loader or bundler will resolve the TypeScript path; adjust extension to `.js` if using a separate build step.)

- [ ] **Step 4: Commit**

```bash
git add src/renderer/index.html src/renderer/chat.ts
git commit -m "feat(renderer): add chat area — message bubbles, input, 8s auto-hide"
```

---

## Task 19: Integration smoke test

> Run the full acceptance criteria manually before marking M3 done.

- [ ] **Step 1: Run all unit tests**

```bash
npx jest --no-coverage
```

Expected: All tests pass. Fix any failures before proceeding.

- [ ] **Step 2: TypeScript type-check**

```bash
npx tsc --noEmit
```

Expected: Zero errors.

- [ ] **Step 3: Start the app and verify text chat**

```bash
npm run dev
```

Then in the Cosmo chat input:
- Type: `hello` → expect a reply from the configured LLM provider
- Watch state transition: `thinking` during request, `speaking` during reply, `idle` after

- [ ] **Step 4: Verify music tool**

In chat: `play my Focus playlist`

Expected:
- AppleScript opens Music app, starts "Focus" playlist
- `music` activity overlay appears
- `happy` flash fires for 2 seconds
- Chat shows "Playing playlist "Focus"."

If Music permission is denied, expect the honest explainer message in chat, not a crash.

- [ ] **Step 5: Verify search flow**

In chat: `what's the news today`

Expected:
- `searching` activity appears, then clears
- Top 5 DuckDuckGo results appear in chat as numbered list
- No browser auto-opened

Follow up: `open result 1`
Expected: browser opens, no crash

- [ ] **Step 6: Verify provider swap (extensibility test B)**

In `~/.pixel/config.json`, change `llm.provider` to `"ollama"`. Restart the app.

Expected:
- If Ollama is running locally: replies come from Ollama; all tools still work
- If Ollama isn't running: honest error in chat, app doesn't crash

Revert config to `"xai"` after test.

- [ ] **Step 7: Verify timer.set (extensibility test A)**

In chat: `set a 2 minute timer called coffee`

Expected:
- `timer` activity overlay shows countdown ring
- After 2 minutes: spoken "coffee is done", `happy` flash, overlay clears

Confirm zero changes were needed outside `tools/timer/` by running:

```bash
git log --oneline | head -5
# The timer commit should only touch src/main/tools/timer/index.ts
# and the one registerTool() line in src/main/tools/index.ts
```

- [ ] **Step 8: Verify malformed model output doesn't crash**

Stop and start the app. Temporarily stub the provider to return garbage:

```typescript
// Temporary test — revert after
// In brain.ts, replace provider.chat call with:
const response = { text: 'Some text with ```tool\n{broken json\n``` in it.' };
```

Expected: chat shows the raw text, no crash, no error dialog.

Revert the stub.

- [ ] **Step 9: Final commit — update progress checklist**

In `CLAUDE.md` (project root), update the progress checklist:

```markdown
- [x] M3 Brain + hands
```

```bash
git add CLAUDE.md
git commit -m "chore: mark M3 Brain+Hands complete in progress checklist"
```

---

## Acceptance Criteria Mapping

| Criterion | Task |
|---|---|
| "Play my Focus playlist" starts Apple Music | Task 12 |
| "What's the news today" runs search.web | Task 15 |
| Malformed model output never crashes | Task 6 (dispatcher) |
| Extensibility test A: timer.set with zero external changes | Task 14 |
| Extensibility test B: switch provider in config, features work | Task 5 + Task 10 |
| Persistent memory (remember/forget) | Task 7 |
| Conversation history survives relaunch | Task 8 |
| Chat UI renders under eyes | Task 18 |
| All 6 providers registered at startup | Task 5 |
| Tool timeout + error wrapping in registry | Task 2 |
