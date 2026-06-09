import { z } from 'zod';
import { registerTool } from '../registry';
import { openApp, runShortcut } from '../../core/shell';

export function registerLauncherTools(): void {
  registerTool({
    name: 'launcher.open',
    description: 'Open an app or run a macOS Shortcut by name',
    schema: z.object({ name: z.string() }),
    availableOffline: true,
    async execute(args) {
      try {
        await openApp(args.name);
        return { ok: true, summary: `Opened ${args.name}` };
      } catch {
        try {
          await runShortcut(args.name);
          return { ok: true, summary: `Ran shortcut: ${args.name}` };
        } catch (e: unknown) {
          return { ok: false, error: (e as Error).message, userMessage: `Couldn't find app or shortcut: "${args.name}"` };
        }
      }
    },
  });
}
