import { z } from 'zod';
import { registerTool } from '../registry';
import { addNote } from '../../core/notes';

export function registerNotesTools(): void {
  registerTool({
    name: 'notes.capture',
    description: 'Append a quick note to ~/.pixel/notes.md with a timestamp',
    schema: z.object({ text: z.string() }),
    availableOffline: true,
    async execute(args) {
      addNote(args.text); // shared store — also mirrors into the Obsidian vault
      return { ok: true, summary: `Captured: "${args.text}"` };
    },
  });
}
