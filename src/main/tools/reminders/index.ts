import { z } from 'zod';
import { registerTool } from '../registry';
import { addReminder, listReminders, clearReminders } from '../../core/reminders';
import { mirrorReminder } from '../../core/vault';

/**
 * Parse a reminder timestamp as a LOCAL wall-clock time.
 *
 * The model is given the local time and asked for a local wall-clock string, but
 * it often appends 'Z' (UTC) or a wrong offset — which `Date.parse` would honor,
 * shifting the reminder by the timezone offset (e.g. "5pm" → 22:30 in IST). A user
 * always means local time for a reminder, so we strip any zone designator and build
 * the Date from the wall-clock components in the local zone. Falls back to
 * `Date.parse` only for shapes we don't recognize.
 */
function parseLocalTime(s: string): number {
  const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return Date.parse(s);
  const [, y, mo, d, h, mi, se] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), se ? Number(se) : 0).getTime();
}

export function registerReminderTools(): void {
  // The LLM is given the current LOCAL time in the system prompt; it supplies either
  // a relative delay (inMinutes) or a local wall-clock timestamp (atISO).
  registerTool({
    name: 'reminder.set',
    description: 'Set a reminder. Provide inMinutes for a relative reminder, or atISO (a LOCAL wall-clock timestamp like "2026-06-08T17:00", no Z/offset) for a specific time. Compute from the current local time given above; a bare hour means today unless it already passed.',
    schema: z.object({
      text: z.string(),
      inMinutes: z.number().positive().optional(),
      atISO: z.string().optional(),
    }),
    availableOffline: true,
    async execute(args) {
      let fireAt: number;
      if (typeof args.inMinutes === 'number') {
        fireAt = Date.now() + args.inMinutes * 60_000;
      } else if (args.atISO) {
        fireAt = parseLocalTime(args.atISO);
        if (Number.isNaN(fireAt)) return { ok: false, error: 'bad-time', userMessage: "I couldn't understand that time." };
      } else {
        return { ok: false, error: 'no-time', userMessage: 'Tell me when — e.g. "in 20 minutes" or "at 3pm".' };
      }
      if (fireAt <= Date.now()) return { ok: false, error: 'past', userMessage: "That time's already passed." };

      addReminder(args.text, fireAt);
      mirrorReminder(args.text, fireAt); // also log it in today's daily note
      const when = new Date(fireAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
      return { ok: true, summary: `Reminder set for ${when}: "${args.text}"` };
    },
  });

  registerTool({
    name: 'reminder.list',
    description: 'List upcoming reminders',
    schema: z.object({}),
    availableOffline: true,
    async execute() {
      const list = listReminders();
      if (!list.length) return { ok: true, summary: 'No upcoming reminders.' };
      const lines = list.slice(0, 10).map((r) => {
        const when = new Date(r.fireAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
        return `• ${when} — ${r.text}`;
      });
      return { ok: true, summary: `Upcoming reminders:\n${lines.join('\n')}` };
    },
  });

  registerTool({
    name: 'reminder.clear',
    description: 'Clear all upcoming reminders',
    schema: z.object({}),
    availableOffline: true,
    async execute() {
      const n = clearReminders();
      return { ok: true, summary: n ? `Cleared ${n} reminder${n === 1 ? '' : 's'}.` : 'Nothing to clear.' };
    },
  });
}
