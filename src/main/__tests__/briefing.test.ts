import { decideBriefing, type BriefingState } from '../briefing';
import type { Config } from '../../shared/types';

// 2026-06-10 is a Wednesday (getDay() === 3). Tests build workHours.days relative to
// that so they assert "is / isn't the last work day" without depending on the real date.
const WED = 3;
const at = (h: number, m = 0): Date => new Date(2026, 5, 10, h, m, 0); // local
const fresh = (): BriefingState => ({ lastDailyDate: '', lastWeeklyDate: '' });

const cfg = (over: Record<string, unknown> = {}): Config => ({
  personality: 'coach',
  voice: { proactiveSpeech: true },
  activity: { recap: 'both' },
  workHours: { start: '09:00', end: '17:00', days: [1, 2, 3, 4, 5] },
  ...over,
} as unknown as Config);

describe('decideBriefing', () => {
  it('stays silent when proactive speech is off', () => {
    expect(decideBriefing(at(18), cfg({ voice: { proactiveSpeech: false } }), fresh())).toBeNull();
  });

  it('stays silent when recap is off', () => {
    expect(decideBriefing(at(18), cfg({ activity: { recap: 'off' } }), fresh())).toBeNull();
  });

  it('stays silent before the work day ends', () => {
    expect(decideBriefing(at(9), cfg(), fresh())).toBeNull();
  });

  it('stays silent on a non-work day', () => {
    expect(decideBriefing(at(18), cfg({ workHours: { start: '09:00', end: '17:00', days: [WED + 1] } }), fresh())).toBeNull();
  });

  it('fires a daily recap after end on a non-final work day', () => {
    // days end on Friday(5); Wed(3) is not the last → daily
    expect(decideBriefing(at(18), cfg({ workHours: { start: '09:00', end: '17:00', days: [3, 4, 5] } }), fresh())).toBe('daily');
  });

  it('fires a weekly recap on the last work day', () => {
    // Wed(3) is the max of [1,2,3] → last work day → weekly
    expect(decideBriefing(at(18), cfg({ workHours: { start: '09:00', end: '17:00', days: [1, 2, 3] } }), fresh())).toBe('weekly');
  });

  it('does not repeat a daily recap already fired today', () => {
    const state: BriefingState = { lastDailyDate: '2026-06-10', lastWeeklyDate: '' };
    expect(decideBriefing(at(18), cfg({ workHours: { start: '09:00', end: '17:00', days: [3, 4, 5] } }), state)).toBeNull();
  });

  it('recap=weekly is silent on a non-final work day', () => {
    expect(decideBriefing(at(18), cfg({ activity: { recap: 'weekly' }, workHours: { start: '09:00', end: '17:00', days: [3, 4, 5] } }), fresh())).toBeNull();
  });

  it('recap=daily still fires on the last work day', () => {
    expect(decideBriefing(at(18), cfg({ activity: { recap: 'daily' }, workHours: { start: '09:00', end: '17:00', days: [1, 2, 3] } }), fresh())).toBe('daily');
  });
});
