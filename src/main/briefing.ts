// Proactive recaps — the buddy's voluntary "here's how your day went" moment.
//
// Two kinds: a daily recap after the work day ends, and a week-over-week trend on the
// last work day of the week. Both are gated by the proactive-speech opt-in (so they're
// silent unless the user invited Cosmo to speak), respect meeting-quiet + silent
// personality, and fire at most once per day each. The decision is a pure function so
// it can be tested without mocking the clock.
import type { Config } from '../shared/types';
import { phraseToday, todaySummary, weeklyTrends } from './core/activityLog';
import { calloutManager } from './watchers/calloutManager';
import { log } from './core/log';

export type BriefingKind = 'daily' | 'weekly' | null;

export interface BriefingState {
  lastDailyDate: string;   // local YYYY-MM-DD the daily recap last fired
  lastWeeklyDate: string;  // local YYYY-MM-DD the weekly recap last fired
}

function localDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Decide whether a recap is due right now. Pure — pass the clock and current state in.
 *  Returns the kind to speak, or null. Weekly wins on the last work day; daily otherwise. */
export function decideBriefing(now: Date, cfg: Config, state: BriefingState): BriefingKind {
  if (!cfg.voice?.proactiveSpeech) return null;          // proactive speech is opt-in
  const recap = cfg.activity?.recap ?? 'both';
  if (recap === 'off') return null;

  const { days, end } = cfg.workHours;
  if (!days.length || !days.includes(now.getDay())) return null;   // only on work days

  const [eh, em] = end.split(':').map(Number);
  if (now.getHours() * 60 + now.getMinutes() < eh * 60 + em) return null;  // day not over

  const todayKey = localDayKey(now);
  const isLastWorkDay = now.getDay() === Math.max(...days);

  if ((recap === 'weekly' || recap === 'both') && isLastWorkDay) {
    return state.lastWeeklyDate === todayKey ? null : 'weekly';
  }
  if (recap === 'daily' || recap === 'both') {
    return state.lastDailyDate === todayKey ? null : 'daily';
  }
  return null;
}

let timer: ReturnType<typeof setInterval> | null = null;
const state: BriefingState = { lastDailyDate: '', lastWeeklyDate: '' };

/** Start the recap scheduler. Checks every 5 min whether a recap is due. */
export function startBriefing(getConfig: () => Config): void {
  const tick = (): void => {
    try {
      const cfg = getConfig();
      const kind = decideBriefing(new Date(), cfg, state);
      if (!kind) return;
      const key = localDayKey(new Date());
      if (kind === 'weekly') {
        // Mark daily fired too so we don't double-speak on the last work day.
        state.lastWeeklyDate = key;
        state.lastDailyDate = key;
        calloutManager.announce(weeklyTrends(), cfg);
      } else {
        state.lastDailyDate = key;
        calloutManager.announce(phraseToday(todaySummary()), cfg);
      }
    } catch (e) {
      log.debug('briefing tick failed:', (e as Error).message);
    }
  };
  timer = setInterval(tick, 5 * 60_000);
}

export function stopBriefing(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
