import { z } from 'zod';
import { clipboard } from 'electron';
import { registerTool } from '../registry';

export function registerClipboardTools(): void {
  registerTool({
    name: 'clipboard.get',
    description: "Read the current clipboard text (use when the user says 'what did I copy', 'read my clipboard', etc.)",
    schema: z.object({}),
    availableOffline: true,
    async execute() {
      const text = clipboard.readText();
      if (!text.trim()) return { ok: true, summary: 'Clipboard is empty.' };
      const preview = text.length > 600 ? text.slice(0, 600) + '…' : text;
      return { ok: true, summary: `Clipboard:\n${preview}`, data: { text } };
    },
  });

  registerTool({
    name: 'clipboard.set',
    description: 'Copy the given text to the clipboard',
    schema: z.object({ text: z.string() }),
    availableOffline: true,
    async execute(args) {
      clipboard.writeText(args.text);
      return { ok: true, summary: 'Copied to clipboard.' };
    },
  });
}
