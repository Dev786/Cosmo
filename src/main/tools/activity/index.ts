import { z } from 'zod';
import { registerTool } from '../registry';
import { todaySummary, rangeSummary, phraseToday, phraseWeek, flushActivity } from '../../core/activityLog';

// activity.summary — tells the user how they've spent time on their Mac (which apps,
// focus vs distraction) for today or the past week, from LOCAL aggregates only. The
// LLM only sees the already-phrased `summary` string (the dispatcher feeds that back),
// never the raw per-app rows — so usage history is never dumped into a model request.
export function registerActivityTools(): void {
  registerTool({
    name: 'activity.summary',
    description:
      "Summarize how the user has spent time on their Mac — top apps, focused work vs distraction, deepest focus stretch — for 'today' or the past 'week'. Uses only local on-device data.",
    schema: z.object({
      range: z.enum(['today', 'week']).optional().describe("'today' (default) or 'week'"),
    }),
    availableOffline: true,
    async execute(args: { range?: 'today' | 'week' }) {
      const range = args.range === 'week' ? 'week' : 'today';
      const summary = range === 'week' ? phraseWeek(rangeSummary(7)) : phraseToday(todaySummary());
      flushActivity(); // refresh the Obsidian Activity.md while we're here (best-effort)
      return { ok: true, summary };
    },
  });
}
