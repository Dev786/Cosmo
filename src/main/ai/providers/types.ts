import type { ChatMessage } from '../../../shared/types';

/** A tool advertised to a NATIVE-tool-calling provider (OpenAI). `parameters` is
 *  a JSON Schema object derived from the tool's zod schema. Providers without
 *  native tools never see these — they get the fenced-JSON prompt instead. */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** A tool the model asked to call (native path). `id` links the call to its
 *  result message; `args` is the parsed arguments object. */
export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ChatRequest {
  system: string;
  messages: ChatMessage[];
  maxTokens?: number;
  /** Model id from config (config.llm.model). Falls back to the provider default. */
  model?: string;
  /** Tools to advertise. Only passed to providers whose `capabilities.nativeTools`
   *  is true; others ignore it and rely on the fenced-JSON tool protocol. */
  tools?: ToolSpec[];
}

export interface ChatResponse {
  text: string;
  /** Populated only by native-tool providers when the model requested calls.
   *  Empty/undefined means the text IS the answer (or fenced-JSON tools apply). */
  toolCalls?: ToolCall[];
}

export interface LLMProvider {
  readonly name: string;
  readonly capabilities: { nativeWebSearch: boolean; offline: boolean; nativeTools?: boolean };
  chat(req: ChatRequest): Promise<ChatResponse>;
  /** List the model ids the live endpoint actually exposes (OpenAI `/v1/models`).
   *  Optional — the setup screen calls it to fill the model dropdown with what's
   *  really available: installed Ollama models, the current cloud catalog. Falls
   *  back to the static catalog when absent or when it throws. */
  listModels?(): Promise<string[]>;
}

export class RetryableError extends Error {}
export class AuthError extends Error {}
/** The model emitted a malformed NATIVE tool call and the provider rejected the
 *  whole generation (e.g. Groq's HTTP 400 `tool_use_failed` — "Failed to call a
 *  function … failed_generation"). NOT retryable against a fallback provider: the
 *  cure is to re-ask the SAME provider WITHOUT tools so it answers in prose. The
 *  ReAct loop catches this and degrades gracefully instead of surfacing the error. */
export class ToolChoiceError extends Error {}
