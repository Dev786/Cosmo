import { z } from 'zod';
import { registerTool } from '../registry';
import { runScript } from '../../core/osascript';

export function registerSystemTools(): void {
  registerTool({
    name: 'system.volume',
    description: 'Set system output volume (0-100)',
    schema: z.object({ level: z.number().min(0).max(100) }),
    availableOffline: true,
    async execute(args) {
      try {
        await runScript(`set volume output volume ${args.level}`);
        return { ok: true, summary: `Volume set to ${args.level}%` };
      } catch (e: unknown) {
        return { ok: false, error: (e as Error).message, userMessage: `Couldn't set volume: ${(e as Error).message}` };
      }
    },
  });

  registerTool({
    name: 'system.mute',
    description: 'Mute or unmute system audio',
    schema: z.object({ mute: z.boolean().default(true) }),
    availableOffline: true,
    async execute(args) {
      try {
        await runScript(`set volume ${args.mute ? 'with output muted' : 'without output muted'}`);
        return { ok: true, summary: args.mute ? 'Muted.' : 'Unmuted.' };
      } catch (e: unknown) {
        return { ok: false, error: (e as Error).message, userMessage: `Couldn't change mute: ${(e as Error).message}` };
      }
    },
  });

  registerTool({
    name: 'system.displaySleep',
    description: 'Put the display to sleep immediately',
    schema: z.object({}),
    availableOffline: true,
    async execute() {
      try {
        await runScript(`tell application "System Events" to sleep`);
        return { ok: true, summary: 'Display sleeping.' };
      } catch (e: unknown) {
        return { ok: false, error: (e as Error).message, userMessage: `Couldn't sleep display: ${(e as Error).message}` };
      }
    },
  });
}
