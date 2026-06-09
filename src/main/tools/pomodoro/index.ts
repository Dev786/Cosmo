import { z } from 'zod';
import { registerTool } from '../registry';
import type { ToolContext } from '../types';

// Module-level so pomodoro.stop (a separate tool call) can cancel a session
// started by pomodoro.start.
let session: { tick: ReturnType<typeof setInterval>; end: ReturnType<typeof setTimeout>; label: string; endAt: number } | null = null;

function cancel(ctx: ToolContext): void {
  if (!session) return;
  clearInterval(session.tick);
  clearTimeout(session.end);
  session = null;
  ctx.setActivity(null);
}

export function registerPomodoroTools(): void {
  registerTool({
    name: 'pomodoro.start',
    description: 'Start a Pomodoro focus session (default 25 min). Speaks when it ends.',
    schema: z.object({ minutes: z.number().positive().max(120).default(25) }),
    availableOffline: true,
    async execute(args, ctx) {
      cancel(ctx);
      const label = `Focus 🍅`;
      const totalSec = Math.round(args.minutes * 60);
      let remaining = totalSec;
      ctx.setActivity({ type: 'timer', remainingSec: remaining, label });

      const tick = setInterval(() => {
        remaining -= 5;
        if (remaining > 0) ctx.setActivity({ type: 'timer', remainingSec: remaining, label });
      }, 5000);

      const end = setTimeout(() => {
        if (session) { clearInterval(session.tick); session = null; }
        ctx.setActivity(null);
        ctx.setMood('happy', 4000);
        ctx.speak(`Nice ${args.minutes}-minute focus session! Time for a quick break.`);
      }, totalSec * 1000);

      session = { tick, end, label, endAt: Date.now() + totalSec * 1000 };
      return { ok: true, summary: `Focus session started — ${args.minutes} min. Heads down! 🍅` };
    },
  });

  registerTool({
    name: 'pomodoro.stop',
    description: 'Stop the current Pomodoro focus session',
    schema: z.object({}),
    availableOffline: true,
    async execute(_args, ctx) {
      if (!session) return { ok: true, summary: 'No focus session running.' };
      cancel(ctx);
      return { ok: true, summary: 'Focus session stopped.' };
    },
  });

  registerTool({
    name: 'pomodoro.status',
    description: 'Check how much time is left in the current Pomodoro focus session.',
    schema: z.object({}),
    availableOffline: true,
    async execute() {
      if (!session) return { ok: true, summary: 'No focus session is running right now.' };
      const remaining = Math.max(0, Math.round((session.endAt - Date.now()) / 1000));
      const m = Math.floor(remaining / 60);
      const s = remaining % 60;
      const left = m > 0
        ? `${m} minute${m === 1 ? '' : 's'}${s ? ` ${s} second${s === 1 ? '' : 's'}` : ''}`
        : `${s} second${s === 1 ? '' : 's'}`;
      return { ok: true, summary: `${left} left in your focus session.` };
    },
  });
}
