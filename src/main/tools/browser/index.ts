import { z } from 'zod';
import { registerTool } from '../registry';
import { openUrl } from '../../core/shell';

export function registerBrowserTools(): void {
  registerTool({
    name: 'browser.open',
    description: 'Open a URL in the default browser (only when user explicitly asks)',
    schema: z.object({ url: z.string().url() }),
    availableOffline: false,
    async execute(args) {
      try {
        await openUrl(args.url);
        return { ok: true, summary: `Opened ${args.url}` };
      } catch (e: unknown) {
        return { ok: false, error: (e as Error).message, userMessage: `Couldn't open browser: ${(e as Error).message}` };
      }
    },
  });
}
