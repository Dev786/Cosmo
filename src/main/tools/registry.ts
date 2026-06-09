import type { Tool, ToolContext, ToolResult } from './types';

const tools = new Map<string, Tool>();

export function registerTool(tool: Tool): void {
  tools.set(tool.name, tool);
}

export function getTool(name: string): Tool | undefined {
  return tools.get(name);
}

export function getAllTools(): Tool[] {
  return [...tools.values()];
}

export async function executeTool(name: string, args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const tool = tools.get(name);
  if (!tool) return { ok: false, error: 'not-found', userMessage: `Unknown tool: ${name}` };

  const parsed = (tool.schema as import('zod').ZodType).safeParse(args);
  if (!parsed.success) {
    return { ok: false, error: 'validation', userMessage: `Invalid args for ${name}: ${parsed.error.message}` };
  }

  // 8s, not 5: network tools (weather geocode+forecast, search) need a couple of
  // round trips and were occasionally tripping a too-tight 5s cap on a slow first call.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<ToolResult>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), 8000);
  });

  try {
    return await Promise.race([
      tool.execute(parsed.data, ctx),
      timeoutPromise,
    ]);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg, userMessage: `${name} failed: ${msg}` };
  } finally {
    // Clear the loser of the race so a fast tool doesn't leave a dangling 5s timer.
    if (timer) clearTimeout(timer);
  }
}
