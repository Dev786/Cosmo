import { speechQueue } from '../core/speechQueue';
import { log } from '../core/log';

export class CalloutManager {
  private lastCalloutAt = 0;
  private paused = false;
  private pauseTimer: ReturnType<typeof setTimeout> | null = null;
  private meetingQuiet = false;
  private onSpeak: ((text: string) => void) | null = null;

  /** Optional hook fired whenever a proactive callout/announce actually speaks (after
   *  all gates). Main wires this to the nudge — a visual heads-up (bounce / native
   *  banner) so an internal update isn't missed when Cosmo is off-screen or muted. */
  setOnSpeak(cb: (text: string) => void): void { this.onSpeak = cb; }

  requestCallout(
    text: string,
    config: { calloutCooldownMin: number; personality: string; voice: { proactiveSpeech: boolean } },
  ): void {
    if (!text) return;
    // Cosmo only speaks when spoken to. Idle/work/eye-strain/battery nudges show
    // through expression (the watchers set mood directly); they never speak unless
    // the user has explicitly opted into proactive speech.
    if (!config.voice.proactiveSpeech) { log.debug('Callout suppressed (proactive speech off)'); return; }
    if (this.paused) { log.debug('Callout suppressed (paused)'); return; }
    if (this.meetingQuiet) { log.debug('Callout suppressed (meeting)'); return; }
    if (config.personality === 'silent') return;

    const cooldownMs = config.calloutCooldownMin * 60_000;
    if (Date.now() - this.lastCalloutAt < cooldownMs) {
      log.debug('Callout suppressed (cooldown)');
      return;
    }

    this.lastCalloutAt = Date.now();
    speechQueue.enqueue(text);
    this.onSpeak?.(text);
  }

  /** Speak a scheduled, self-rate-limited message (daily/weekly recap). Honours the same
   *  gates as a callout — proactive opt-in, pause, meeting-quiet, silent personality — but
   *  NOT the nag cooldown (recaps fire at most once a day, so a recent nudge mustn't eat
   *  them) and it doesn't touch the cooldown clock. */
  announce(text: string, config: { personality: string; voice: { proactiveSpeech: boolean } }): void {
    if (!text) return;
    if (!config.voice.proactiveSpeech) { log.debug('Announce suppressed (proactive speech off)'); return; }
    if (this.paused) { log.debug('Announce suppressed (paused)'); return; }
    if (this.meetingQuiet) { log.debug('Announce suppressed (meeting)'); return; }
    if (config.personality === 'silent') return;
    speechQueue.enqueue(text);
    this.onSpeak?.(text);
  }

  pauseWatching(durationMs: number): void {
    this.paused = true;
    if (this.pauseTimer) clearTimeout(this.pauseTimer);
    this.pauseTimer = setTimeout(() => {
      this.paused = false;
      this.pauseTimer = null;
    }, durationMs);
  }

  resume(): void {
    this.paused = false;
    if (this.pauseTimer) { clearTimeout(this.pauseTimer); this.pauseTimer = null; }
  }

  setMeetingQuiet(quiet: boolean): void {
    this.meetingQuiet = quiet;
  }

  isMeetingQuiet(): boolean {
    return this.meetingQuiet;
  }

  isPaused(): boolean {
    return this.paused;
  }

  resetLastCalloutTime(): void {
    this.lastCalloutAt = 0;
  }
}

export const calloutManager = new CalloutManager();
