import type { Config } from '../../../shared/types';
import type { PromptBuilder } from './types';
import { buildContext } from './context';
import { defaultPrompt } from './default';
import { nativePrompt } from './native';
import { qwenPrompt } from './qwen2.5-7b';

/** Per-MODEL prompts. Keyed by the exact config.llm.model id. A model listed
 *  here gets its own prompt folder (e.g. ./qwen2.5-7b) and is fully isolated —
 *  editing it affects only that model. */
const BY_MODEL: Record<string, PromptBuilder> = {
  'qwen2.5:7b': qwenPrompt,
};

/** Per-PROVIDER fallback, used when the model has no folder of its own. Lets a
 *  whole provider share a prompt (e.g. every local Ollama model defaults to the
 *  strict small-model prompt until it earns its own folder). */
const BY_PROVIDER: Record<string, PromptBuilder> = {
  ollama: qwenPrompt,
};

/** Resolution order: exact model → provider → global default. */
export function resolvePrompt(provider: string, model?: string): PromptBuilder {
  return (model && BY_MODEL[model]) || BY_PROVIDER[provider] || defaultPrompt;
}

/** Public entry: pick the right prompt for the active model and build it with
 *  the shared (tool list / memory / time) context. Pass the user's message as
 *  `query` to gate the advertised tool list down to what's relevant this turn.
 *
 *  `native` (provider.capabilities.nativeTools) routes to the function-calling
 *  prompt, which omits the fenced-JSON instructions/examples — those models get
 *  their tools through the API `tools` field instead. It overrides per-model
 *  selection: a native provider never wants the fenced prompt. */
export async function buildSystemPrompt(config: Config, query?: string, native = false): Promise<string> {
  const builder = native ? nativePrompt : resolvePrompt(config.llm.provider, config.llm.model);
  // Tool gating (advertising only a query-relevant subset) now applies ONLY to the
  // small local-model prompt — those reason worse over ~28 tools at once. Capable
  // models (and native providers, which get the full tool list via the API) get
  // every tool so the ReAct agent can always reach any capability (web search, add
  // sources, …) instead of being blinded when the gating regex misses the tool.
  const gate = builder === qwenPrompt;
  return builder(config, await buildContext(config, gate ? query : undefined));
}
