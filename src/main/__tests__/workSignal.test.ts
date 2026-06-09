import { configureWorkSignal, reportSignal, resetWorkSignal } from '../workSignal';
import { calloutManager } from '../watchers/calloutManager';
import type { Config, MoodState } from '../../shared/types';

// A config exposing only the fields workSignal reads. proactiveSpeech is OFF so callouts
// are suppressed at calloutManager (no TTS side-effects); we assert the judge's mood and
// meeting-quiet decisions, which is where the judgment lives.
function makeConfig(overrides: Partial<{ alwaysWork: boolean; distractionMin: number }> = {}): Config {
  const days = overrides.alwaysWork === false ? [] : [0, 1, 2, 3, 4, 5, 6];
  return {
    personality: 'coach',
    distractionMin: overrides.distractionMin ?? 1,
    calloutCooldownMin: 20,
    voice: { proactiveSpeech: false },
    workHours: { start: '00:00', end: '23:59', days },
  } as unknown as Config;
}

let mood: MoodState;
const setMood = jest.fn((m: MoodState) => { mood = m; });

function wire(cfg: Config, startMood: MoodState = 'idle'): void {
  mood = startMood;
  setMood.mockClear();
  configureWorkSignal({
    setMood,
    getMood: () => mood,
    getConfig: () => cfg,
    log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as never,
  });
  resetWorkSignal();
}

describe('workSignal — idle grades', () => {
  it('soft → bored, deep → sleeping (any time of day)', () => {
    wire(makeConfig({ alwaysWork: false }));
    reportSignal({ source: 'idle', grade: 'soft' });
    expect(setMood).toHaveBeenLastCalledWith('bored');
    reportSignal({ source: 'idle', grade: 'deep' });
    expect(setMood).toHaveBeenLastCalledWith('sleeping');
  });

  it('hard → annoyed during work hours', () => {
    wire(makeConfig({ alwaysWork: true }));
    reportSignal({ source: 'idle', grade: 'hard' });
    expect(setMood).toHaveBeenLastCalledWith('annoyed');
  });

  it('hard → only bored outside work hours (no escalation scold)', () => {
    wire(makeConfig({ alwaysWork: false }));
    reportSignal({ source: 'idle', grade: 'hard' });
    expect(setMood).toHaveBeenLastCalledWith('bored');
    expect(setMood).not.toHaveBeenCalledWith('annoyed');
  });

  it('active → wakes from an idle-escalation mood', () => {
    wire(makeConfig(), 'annoyed');
    reportSignal({ source: 'idle', grade: 'active' });
    expect(setMood).toHaveBeenLastCalledWith('idle');
  });
});

describe('workSignal — mood precedence', () => {
  it('never stomps an interaction mood (speaking)', () => {
    wire(makeConfig({ alwaysWork: true }), 'speaking');
    reportSignal({ source: 'idle', grade: 'hard' });
    reportSignal({ source: 'battery', grade: 'critical' });
    expect(setMood).not.toHaveBeenCalled();
  });
});

describe('workSignal — focus / meeting-quiet', () => {
  it('sets meeting-quiet while focused on a meeting, clears it otherwise', () => {
    wire(makeConfig());
    reportSignal({ source: 'focus', cls: 'meeting', secs: 30 });
    expect(calloutManager.isMeetingQuiet()).toBe(true);
    reportSignal({ source: 'focus', cls: 'work', secs: 30 });
    expect(calloutManager.isMeetingQuiet()).toBe(false);
  });

  it('scolds (annoyed) once distraction crosses the threshold in work hours', () => {
    wire(makeConfig({ alwaysWork: true, distractionMin: 1 })); // 1 min = 60s = 2×30s samples
    reportSignal({ source: 'focus', cls: 'distraction', secs: 30 });
    expect(setMood).not.toHaveBeenCalled();          // 30s < 60s
    reportSignal({ source: 'focus', cls: 'distraction', secs: 30 });
    expect(setMood).toHaveBeenLastCalledWith('annoyed'); // 60s ≥ 60s
  });

  it('does not scold for distraction outside work hours', () => {
    wire(makeConfig({ alwaysWork: false, distractionMin: 1 }));
    reportSignal({ source: 'focus', cls: 'distraction', secs: 30 });
    reportSignal({ source: 'focus', cls: 'distraction', secs: 30 });
    expect(setMood).not.toHaveBeenCalled();
  });

  it('never scolds during a meeting even with distraction accrued', () => {
    wire(makeConfig({ alwaysWork: true, distractionMin: 1 }));
    reportSignal({ source: 'focus', cls: 'distraction', secs: 30 });
    reportSignal({ source: 'focus', cls: 'meeting', secs: 30 });
    expect(setMood).not.toHaveBeenCalled();
    expect(calloutManager.isMeetingQuiet()).toBe(true);
  });
});

describe('workSignal — battery (safety, not work-hours gated)', () => {
  it('critical → annoyed even outside work hours', () => {
    wire(makeConfig({ alwaysWork: false }));
    reportSignal({ source: 'battery', grade: 'critical' });
    expect(setMood).toHaveBeenLastCalledWith('annoyed');
  });

  it('low → no mood change', () => {
    wire(makeConfig({ alwaysWork: false }));
    reportSignal({ source: 'battery', grade: 'low' });
    expect(setMood).not.toHaveBeenCalled();
  });
});
