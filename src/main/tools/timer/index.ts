import { z } from 'zod';
import { registerTool } from '../registry';

export function registerTimerTools(): void {
  registerTool({
    name: 'timer.set',
    description: 'Set a countdown timer with a spoken label when it expires',
    schema: z.object({
      minutes: z.number().positive(),
      label: z.string().default('Timer'),
    }),
    availableOffline: true,
    async execute(args, ctx) {
      const totalSec = Math.round(args.minutes * 60);
      ctx.setActivity({ type: 'timer', remainingSec: totalSec, label: args.label });

      // Update countdown every 5s
      let remaining = totalSec;
      const tick = setInterval(() => {
        remaining -= 5;
        if (remaining > 0) {
          ctx.setActivity({ type: 'timer', remainingSec: remaining, label: args.label });
        } else {
          clearInterval(tick);
        }
      }, 5000);

      setTimeout(() => {
        clearInterval(tick);
        ctx.setActivity(null);
        ctx.speak(`${args.label} complete!`);
        ctx.setMood('happy', 2000);
      }, totalSec * 1000);

      return { ok: true, summary: `Timer set for ${args.minutes} minute${args.minutes === 1 ? '' : 's'}: ${args.label}` };
    },
  });
}
