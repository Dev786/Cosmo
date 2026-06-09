// workSignal — the single judge.
//
// Watchers report FACTS, never moods. This file is the only place that translates
// combined watcher output into mood changes and spoken callouts. Keeping all the
// judgment here (work-hours gating, mood precedence, meeting-quiet, no double-scold)
// makes the behaviour tunable in one spot and stops two watchers from scolding at
// once. See CLAUDE.md "Watcher → workSignal separation".
//
// Anti-spam is owned downstream by calloutManager's single cooldown — every callout
// from every source flows through it, so two sources can't double-speak.
import type { AppClass, Config, Logger, MoodState } from '../shared/types';
import { calloutManager } from './watchers/calloutManager';
import { getCalloutSet, pickCallout } from './watchers/callouts';

/** A fact reported by a watcher. The judge — not the watcher — decides the resulting
 *  mood and whether anything is spoken. */
export type WorkSignal =
  // idle: severity of system idle time. 'active' = user came back.
  | { source: 'idle'; grade: 'active' | 'soft' | 'hard' | 'deep' }
  // focus: the instantaneous class of the focused app, plus how long this sample covers.
  | { source: 'focus'; cls: AppClass; secs: number }
  // battery: drained while on battery power.
  | { source: 'battery'; grade: 'low' | 'critical' }
  // eyeStrain: a long unbroken stretch of active use is due for a break.
  | { source: 'eyeStrain' };

export interface WorkSignalDeps {
  setMood(mood: MoodState): void;
  getMood(): MoodState;
  getConfig(): Config;
  log: Logger;
}

// Moods the judge owns. It only ever transitions among these — it never stomps an
// interaction mood (listening/thinking/speaking/happy) the user/AI is driving.
const IDLE_FAMILY: ReadonlyArray<MoodState> = ['idle', 'bored', 'annoyed', 'sleeping'];

let deps: WorkSignalDeps | null = null;
// Rolling window of distraction-seconds, capped to the last 30 real minutes.
let distractWindow: number[] = [];

export function configureWorkSignal(d: WorkSignalDeps): void {
  deps = d;
}

/** Clear transient judgment state (e.g. on user interaction / wake-from-sleep). */
export function resetWorkSignal(): void {
  distractWindow = [];
  calloutManager.setMeetingQuiet(false);
}

export function reportSignal(sig: WorkSignal): void {
  if (!deps) return;
  try {
    switch (sig.source) {
      case 'idle': return handleIdle(sig.grade);
      case 'focus': return handleFocus(sig.cls, sig.secs);
      case 'battery': return handleBattery(sig.grade);
      case 'eyeStrain': return handleEyeStrain();
    }
  } catch (e) {
    deps.log.debug('workSignal: report failed:', (e as Error).message);
  }
}

// ─── mood + speech helpers ────────────────────────────────────────────────────

/** Apply a watcher-driven mood only if we're not interrupting an interaction mood. */
function expressMood(mood: MoodState): void {
  if (deps && IDLE_FAMILY.includes(deps.getMood())) deps.setMood(mood);
}

/** Route a callout through calloutManager, which owns proactive-opt-in, pause,
 *  meeting-quiet, personality, and the single anti-double-scold cooldown. */
function speak(text: string | undefined): void {
  if (deps && text) calloutManager.requestCallout(text, deps.getConfig());
}

function workHours(): boolean {
  if (!deps) return false;
  const { start, end, days } = deps.getConfig().workHours;
  const now = new Date();
  if (!days.includes(now.getDay())) return false;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const cur = now.getHours() * 60 + now.getMinutes();
  return cur >= sh * 60 + sm && cur < eh * 60 + em;
}

// ─── per-source judgment ──────────────────────────────────────────────────────

function handleIdle(grade: 'active' | 'soft' | 'hard' | 'deep'): void {
  if (!deps) return;
  const personality = deps.getConfig().personality;
  switch (grade) {
    case 'active': {
      // User returned — wake from any idle-escalation mood (but leave interaction moods).
      const m = deps.getMood();
      if (m === 'bored' || m === 'annoyed' || m === 'sleeping') deps.setMood('idle');
      return;
    }
    case 'soft':
      // Gentle liveliness — fine any time of day.
      return expressMood('bored');
    case 'hard':
      // The escalated "you've wandered off" scold is productivity nagging → work hours
      // only. Outside work hours it stays the gentler bored.
      if (workHours()) {
        expressMood('annoyed');
        speak(pickCallout(getCalloutSet(personality).idle));
      } else {
        expressMood('bored');
      }
      return;
    case 'deep':
      // Deep idle = rest, not a scold; the sleepy eyes are welcome any time.
      return expressMood('sleeping');
  }
}

function handleFocus(cls: AppClass, secs: number): void {
  if (!deps) return;
  const cfg = deps.getConfig();

  // Meeting-quiet is owned here: tell calloutManager whenever the focused context is
  // (or stops being) a meeting, so every source stays silent during calls.
  calloutManager.setMeetingQuiet(cls === 'meeting');

  // Maintain a rolling window of the last 30 real minutes of distraction time. Capping
  // by seconds (not sample count) keeps it accurate under dev-mode's faster polling.
  distractWindow.push(cls === 'distraction' ? secs : 0);
  const cap = Math.max(1, Math.ceil((30 * 60) / Math.max(1, secs)));
  while (distractWindow.length > cap) distractWindow.shift();

  if (cls === 'meeting') return;           // never scold mid-meeting
  if (!workHours()) return;                // distraction scold is work-hours only

  const distractedSec = distractWindow.reduce((a, b) => a + b, 0);
  if (distractedSec >= (cfg.distractionMin ?? 15) * 60) {
    expressMood('annoyed');
    speak(pickCallout(getCalloutSet(cfg.personality).distraction));
  }
}

function handleBattery(grade: 'low' | 'critical'): void {
  if (!deps) return;
  // Battery is a safety alert, not a productivity nag → not gated by work hours.
  const texts = getCalloutSet(deps.getConfig().personality).battery;
  if (grade === 'critical') {
    expressMood('annoyed');
    speak(texts[1] ?? texts[0] ?? 'Critical battery. Plug in now.');
  } else {
    speak(pickCallout(texts));
  }
}

function handleEyeStrain(): void {
  if (!deps) return;
  // Health nudge — relevant whenever you've been staring, work hours or not.
  speak(pickCallout(getCalloutSet(deps.getConfig().personality).eyeStrain));
}
