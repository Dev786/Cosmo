import { z } from 'zod';
import type { Config, MoodState, ActivityState, Logger } from '../../shared/types';

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  execute(args: any, ctx: ToolContext): Promise<ToolResult>;
}
