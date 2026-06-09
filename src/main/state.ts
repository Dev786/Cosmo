import type { BrowserWindow } from 'electron';
import { IPC, type MoodState, type ActivityState } from '../shared/types';

export class StateManager {
  private current: MoodState = 'idle';
  private revertTimer: ReturnType<typeof setTimeout> | null = null;
  private intensityLevel = 0;
  private currentActivity: ActivityState | null = null;

  setState(state: MoodState, win: BrowserWindow, durationMs?: number): void {
    if (this.revertTimer) {
      clearTimeout(this.revertTimer);
      this.revertTimer = null;
    }

    this.current = state;
    win.webContents.send(IPC.MOOD_SET, { state });

    if (durationMs) {
      this.revertTimer = setTimeout(() => {
        this.revertTimer = null;
        this.setState('idle', win);
      }, durationMs);
    }
  }

  getState(): MoodState {
    return this.current;
  }

  /** Called on any user interaction — wakes him from any idle-escalation mood
   *  (bored/annoyed/sleeping) immediately. Sleeping was previously excluded, which
   *  left him stuck flat-eyed with no way back to wide eyes. */
  onInteraction(win: BrowserWindow): void {
    if (this.current === 'bored' || this.current === 'annoyed' || this.current === 'sleeping') {
      this.setState('idle', win);
    }
  }

  setIntensity(level: number, win: BrowserWindow): void {
    this.intensityLevel = Math.max(0, Math.min(1, level));
    win.webContents.send(IPC.MOOD_INTENSITY, { level: this.intensityLevel });
  }

  getIntensity(): number {
    return this.intensityLevel;
  }

  pulse(event: string, win: BrowserWindow): void {
    win.webContents.send(IPC.MOOD_PULSE, { event });
  }

  setActivity(activity: ActivityState | null, win: BrowserWindow): void {
    this.currentActivity = activity;
    win.webContents.send(IPC.ACTIVITY_SET, { activity });
  }

  getActivity(): ActivityState | null {
    return this.currentActivity;
  }

  dispose(): void {
    if (this.revertTimer) clearTimeout(this.revertTimer);
  }
}
