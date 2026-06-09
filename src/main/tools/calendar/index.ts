import { z } from 'zod';
import { registerTool } from '../registry';
import { runScript, PermissionError } from '../../core/osascript';
import type { ToolContext } from '../types';

// Read-only calendar via the native Calendar.app (osascript). This is the
// "native" auth path from the tool doc — zero keys, works with whatever accounts
// (incl. Google) the user has already added to macOS Calendar. No write actions.
//
// Calendar.app's `whose` filtering is the documented way to scope a date range;
// we keep the window tight (one day / next 7 days) so it stays well under the
// registry's 8s tool cap even on busy calendars. Each event read is wrapped in a
// `try` so one calendar without a summary can't abort the whole enumeration.

const NEEDS_PERMISSION =
  "I need permission to read Calendar — enable it under System Settings → Privacy & Security → Automation.";

function parseLines(out: string): { sort: number; summary: string; when: string }[] {
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [sort, summary, when] = l.split('\t');
      return { sort: Number(sort) || 0, summary: (summary || 'Untitled').trim(), when: (when || '').trim() };
    })
    .sort((a, b) => a.sort - b.sort);
}

async function readWindow(d1: string, d2: string): Promise<{ sort: number; summary: string; when: string }[]> {
  // d1/d2 are AppleScript date expressions. Output: `secondsFromNow\tsummary\ttimeString`.
  const script = `
set d1 to ${d1}
set d2 to ${d2}
set tab to ASCII character 9
set out to ""
tell application "Calendar"
  repeat with cal in calendars
    repeat with e in (every event of cal whose start date ≥ d1 and start date < d2)
      try
        set sd to start date of e
        set off to (sd - (current date))
        set out to out & off & tab & (summary of e) & tab & (time string of sd) & linefeed
      end try
    end repeat
  end repeat
end tell
return out`;
  return parseLines(await runScript(script, 15000));
}

function speakTime(when: string): string {
  // "2:00:00 PM" → "2:00 PM" (drop seconds for a natural spoken time).
  return when.replace(/:(\d{2}):\d{2}\s/, ':$1 ');
}

export function registerCalendarTools(): void {
  registerTool({
    name: 'calendar.today',
    description: "List today's calendar events (read-only, from macOS Calendar)",
    schema: z.object({}),
    availableOffline: false,
    async execute(_args, _ctx: ToolContext) {
      try {
        const evs = await readWindow('(current date) - (time of (current date))', '((current date) - (time of (current date))) + (1 * days)');
        const upcoming = evs.filter((e) => e.sort >= -3600); // include one just-started
        if (!upcoming.length) return { ok: true, summary: 'Nothing on your calendar today.' };
        const lines = upcoming.slice(0, 8).map((e) => `• ${speakTime(e.when)} — ${e.summary}`);
        const more = upcoming.length > 8 ? `\n…and ${upcoming.length - 8} more` : '';
        return { ok: true, summary: `${upcoming.length} event${upcoming.length === 1 ? '' : 's'} today:\n${lines.join('\n')}${more}` };
      } catch (e) {
        if (e instanceof PermissionError) return { ok: false, error: 'permission', userMessage: NEEDS_PERMISSION };
        return { ok: false, error: (e as Error).message, userMessage: `Couldn't read your calendar: ${(e as Error).message}` };
      }
    },
  });

  registerTool({
    name: 'calendar.next',
    description: 'Find your next upcoming meeting/event in the next 7 days (read-only)',
    schema: z.object({}),
    availableOffline: false,
    async execute(_args, _ctx: ToolContext) {
      try {
        const evs = await readWindow('(current date)', '(current date) + (7 * days)');
        const future = evs.filter((e) => e.sort > 0);
        if (!future.length) return { ok: true, summary: 'Nothing coming up in the next 7 days.' };
        const next = future[0];
        const mins = Math.round(next.sort / 60);
        const rel = mins < 60 ? `in ${mins} min` : mins < 1440 ? `in ${Math.round(mins / 60)}h` : `in ${Math.round(mins / 1440)} day(s)`;
        return { ok: true, summary: `Next up: "${next.summary}" at ${speakTime(next.when)} (${rel}).` };
      } catch (e) {
        if (e instanceof PermissionError) return { ok: false, error: 'permission', userMessage: NEEDS_PERMISSION };
        return { ok: false, error: (e as Error).message, userMessage: `Couldn't read your calendar: ${(e as Error).message}` };
      }
    },
  });
}
