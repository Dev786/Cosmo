import { z } from 'zod';
import { registerTool } from '../registry';
import { speechQueue } from '../../core/speechQueue';

export function registerSpeechTools(): void {
  registerTool({
    name: 'speech.say',
    description: 'Speak text aloud using macOS TTS',
    schema: z.object({ text: z.string() }),
    availableOffline: true,
    async execute(args, ctx) {
      ctx.speak(args.text);
      return { ok: true, summary: args.text };
    },
  });
}
