import type { Config } from '../../../shared/types';

/** Shared, model-agnostic data injected into every prompt. Building these (tool
 *  list, memory, current time) is identical across models, so it lives once in
 *  context.ts — only the persona/instruction TEXT differs per model. */
export interface PromptContext {
  name: string;
  /** Personality / voice, from the editable workspace SOUL.md. */
  soul: string;
  /** Operating rules (when to use tools, output contract), from AGENTS.md. */
  agents: string;
  /** One line per registered tool: "- name: description (args: {...})". */
  toolLines: string;
  /** "## What I know about you" block (USER.md + MEMORY.md + recent daily notes), or '' if empty. */
  memoryBlock: string;
  /** Current-time line + reminder-timing instruction. */
  nowLine: string;
}

/** A prompt builder owns the persona and instruction text for one model (or a
 *  provider/default fallback). It composes the shared PromptContext data into a
 *  full system prompt. Editing one builder never touches another. */
export type PromptBuilder = (config: Config, ctx: PromptContext) => string;
