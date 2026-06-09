import { powerMonitor } from 'electron';
import type { Watcher, WatcherContext } from '../types';

export class EyeStrainWatcher implements Watcher {
  readonly name = 'eyeStrain';
  private interval: ReturnType<typeof setInterval> | null = null;
  private activeMinutes = 0;
  private idleSeconds = 0;

  start(ctx: WatcherContext): void {
    // Sample every 60s
    this.interval = setInterval(() => {
      const idle = powerMonitor.getSystemIdleTime();

      if (idle < 60) {
        this.activeMinutes++;
        this.idleSeconds = 0;
      } else {
        this.idleSeconds += 60;
        if (this.idleSeconds >= 60) {
          this.activeMinutes = 0; // reset on real break
          this.idleSeconds = 0;
        }
      }

      const TRIGGER_MIN = 20;
      if (this.activeMinutes >= TRIGGER_MIN) {
        // Resetting the counter is the rate limit — another unbroken 20 min must pass
        // before we nudge again. workSignal owns the actual callout.
        this.activeMinutes = 0;
        ctx.report({ source: 'eyeStrain' });
      }
    }, 60_000);
  }

  stop(): void {
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
  }

  resetWindow(): void {
    this.activeMinutes = 0;
    this.idleSeconds = 0;
  }
}
