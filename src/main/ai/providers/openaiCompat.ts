import type { LLMProvider, ChatRequest, ChatResponse, ToolCall } from './types';
import { RetryableError, AuthError, ToolChoiceError } from './types';
import type { ChatMessage, NativeToolCall } from '../../../shared/types';
import { getApiKey } from '../../core/secrets';

/** One chat message in OpenAI wire shape. `tool_calls` (assistant) and
 *  `tool_call_id` (tool result) only appear on the native-tool path — every
 *  fenced-JSON vendor sends plain {role, content}. `content` may be null on an
 *  assistant turn that is purely a tool call. */
export interface WireMessage {
  role: string;
  content: string | null;
  tool_calls?: NativeToolCall[];
  tool_call_id?: string;
}

/** The standard pieces of an OpenAI-compatible chat request. A vendor's
 *  `buildBody` hook turns these into the actual JSON body, so vendor-specific
 *  parameter names live in the vendor's own folder — never here. */
export interface CompatBody {
  model: string;
  messages: WireMessage[];
  maxTokens: number;
}

export interface OpenAICompatOpts {
  name: string;
  baseURL: string;
  apiKeyEnv: string;
  defaultModel: string;
  offline?: boolean;
  /** When true, this vendor speaks OpenAI native function-calling: requests carry
   *  a `tools` array + `tool_choice:'auto'` and responses are parsed for
   *  `message.tool_calls`. Off → the model only ever sees the fenced-JSON tool
   *  protocol (small local models, which hallucinate native calls unsafely). The
   *  wire format is identical across every OpenAI-compatible cloud vendor, so the
   *  whole native path lives here once and is flipped per vendor by this flag. */
  nativeTools?: boolean;
  /** Per-vendor request-body shaping. Override ONLY to honour a vendor's API
   *  quirks (e.g. OpenAI's o-series/GPT-5 reject `max_tokens` and require
   *  `max_completion_tokens`) without leaking them into this shared transport or
   *  any other vendor. Defaults to standard OpenAI-compatible `max_tokens`. */
  buildBody?: (b: CompatBody) => Record<string, unknown>;
}

/** Plain OpenAI-compatible body — what every vendor except OpenAI itself uses. */
const defaultBuildBody = (b: CompatBody): Record<string, unknown> => ({
  model: b.model,
  messages: b.messages,
  max_tokens: b.maxTokens,
  stream: false,
});

/** OpenAI (and every OpenAI-compatible vendor) restricts a tool's function name to
 *  `^[a-zA-Z0-9_-]+$` — but our canonical tool names use dots ("weather.today"),
 *  which OpenAI rejects outright with "Invalid 'tools[0].function.name'". Map dots
 *  (and any other illegal char) to '_' on the wire; the returned call name is mapped
 *  back to the dotted original so the dispatcher still finds the real tool. The
 *  full vendor rule is `^[a-zA-Z0-9_-]{1,64}$`, so cap length too (our names are
 *  far shorter, but an over-long one would 400 the whole request). */
const sanitizeToolName = (n: string): string => n.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);

/** A ChatMessage → OpenAI wire message. Carries the native-tool fields through
 *  when present; an assistant turn that is only a tool call sends content:null. */
function toWire(m: ChatMessage): WireMessage {
  const w: WireMessage = { role: m.role, content: m.content ?? '' };
  if (m.tool_calls?.length) {
    // The echoed assistant turn holds the canonical dotted name — sanitise it here
    // too, or the vendor rejects the message history on the very next request.
    w.tool_calls = m.tool_calls.map(tc => ({ ...tc, function: { ...tc.function, name: sanitizeToolName(tc.function.name) } }));
    if (!m.content) w.content = null;
  }
  if (m.tool_call_id) w.tool_call_id = m.tool_call_id;
  return w;
}

/** OpenAI returns tool-call arguments as a JSON STRING. Parse defensively — a
 *  malformed/empty string becomes {} so the tool's zod schema reports the real
 *  problem instead of the dispatcher crashing. */
function parseToolArgs(s: string | undefined): Record<string, unknown> {
  if (!s) return {};
  try {
    const v = JSON.parse(s) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch { return {}; }
}

export function createOpenAICompatProvider(opts: OpenAICompatOpts): LLMProvider {
  // Monotonic across this provider's lifetime — used only to backfill a synthetic
  // id when a vendor returns a tool_call with an empty `id`. Gemini's OpenAI-compat
  // layer does exactly this, and echoing an empty id back 400s the next turn; a
  // unique non-empty id keeps the assistant/tool linkage valid for every vendor.
  let callSeq = 0;

  return {
    name: opts.name,
    capabilities: { nativeWebSearch: false, offline: opts.offline ?? false, nativeTools: opts.nativeTools ?? false },

    async chat(req: ChatRequest): Promise<ChatResponse> {
      // User-entered key (setup screen) wins; fall back to the env var (.env).
      const apiKey = getApiKey(opts.name, opts.apiKeyEnv);
      const model = req.model || opts.defaultModel;

      const messages: WireMessage[] = [
        { role: 'system', content: req.system },
        ...req.messages.map(toWire),
      ];
      const base = (opts.buildBody ?? defaultBuildBody)({
        model,
        messages,
        maxTokens: req.maxTokens ?? 1024,
      });
      // Advertise tools only when this vendor does native calling AND the caller
      // passed some this turn (the forced final-answer pass omits them so the model
      // must answer in prose). The wire format is identical for every compat vendor.
      const body = (opts.nativeTools && req.tools?.length)
        ? {
            ...base,
            tools: req.tools.map(t => ({ type: 'function', function: { name: sanitizeToolName(t.name), description: t.description, parameters: t.parameters } })),
            tool_choice: 'auto',
          }
        : base;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);

      try {
        const res = await fetch(`${opts.baseURL}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (res.status === 401) throw new AuthError(`Check your ${opts.apiKeyEnv}`);
        if (res.status === 429 || res.status >= 500) throw new RetryableError(`${opts.name} returned ${res.status}`);

        const data = await res.json() as {
          choices?: Array<{ message?: {
            content?: string | null;
            tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
          } }>;
          error?: { message?: string; code?: string };
        };

        if (data.error) {
          const msg = data.error.message ?? 'Unknown API error';
          // The model tried a native tool call and produced arguments the vendor's
          // tool grammar rejected (Groq returns 400 `tool_use_failed`). Surface a
          // typed error so the ReAct loop retries WITHOUT tools instead of showing
          // the raw "Failed to call a function" to the user.
          if (data.error.code === 'tool_use_failed' || /failed to call a function|failed_generation|tool[_ ]use[_ ]failed/i.test(msg)) {
            throw new ToolChoiceError(msg);
          }
          throw new Error(msg);
        }

        // Reverse the wire sanitisation: "weather_today" → "weather.today", so the
        // dispatcher resolves the real tool. Built from the tools we advertised.
        const nameBack = new Map<string, string>();
        for (const t of req.tools ?? []) nameBack.set(sanitizeToolName(t.name), t.name);

        const msg = data.choices?.[0]?.message;
        const rawCalls = msg?.tool_calls ?? [];
        const toolCalls: ToolCall[] = rawCalls
          .map(tc => ({
            id: tc.id && tc.id.length ? tc.id : `call_${++callSeq}`,
            name: nameBack.get(tc.function?.name ?? '') ?? tc.function?.name ?? '',
            args: parseToolArgs(tc.function?.arguments),
          }))
          .filter(c => c.name);

        return { text: msg?.content ?? '', toolCalls: toolCalls.length ? toolCalls : undefined };
      } finally {
        clearTimeout(timeout);
      }
    },

    // GET /models — Ollama exposes its installed models here too, so the same call
    // serves both local and cloud. Short timeout: this only feeds a dropdown.
    async listModels(): Promise<string[]> {
      const apiKey = getApiKey(opts.name, opts.apiKeyEnv);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8_000);
      try {
        const res = await fetch(`${opts.baseURL}/models`, {
          headers: { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
          signal: controller.signal,
        });
        if (res.status === 401) throw new AuthError(`Check your ${opts.apiKeyEnv}`);
        if (!res.ok) throw new Error(`${opts.name} models returned ${res.status}`);
        const data = await res.json() as { data?: Array<{ id?: string }> };
        return (data.data ?? []).map(m => m.id).filter((id): id is string => !!id);
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
