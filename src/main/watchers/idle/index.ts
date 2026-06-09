import { powerMonitor } from 'electron';
import type { Watcher, WatcherContext } from '../types';

export class IdleWatcher implements Watcher {
  readonly name = 'idle';
  private interval: ReturnType<typeof setInterval> | null = null;
  private ctx: WatcherContext | null = null;

  start(ctx: WatcherContext): void {
    this.ctx = ctx;
    const isDev = process.env.PIXEL_DEV === '1';
    // In dev mode thresholds are in seconds, production in minutes
    const factor = isDev ? 1 : 60;
    const pollMs = isDev ? 2000 : 30_000;

    this.interval = setInterval(() => {
      if (!this.ctx) return;
      const idle = powerMonitor.getSystemIdleTime(); // seconds
      const { idleSoftMin, idleHardMin } = this.ctx.config;
      const softSec = idleSoftMin * factor;
      const hardSec = idleHardMin * factor;

      // Report the idle severity as a fact; workSignal maps it to mood/callout and
      // decides whether the escalation is appropriate (e.g. work-hours gating).
      if (idle >= 60 * factor) {
        this.ctx.report({ source: 'idle', grade: 'deep' });   // deep idle → sleeping
      } else if (idle >= hardSec) {
        this.ctx.report({ source: 'idle', grade: 'hard' });
      } else if (idle >= softSec) {
        this.ctx.report({ source: 'idle', grade: 'soft' });
      } else if (idle < 5) {
        this.ctx.report({ source: 'idle', grade: 'active' }); // user is back
      }
    }, pollMs);
  }

  stop(): void {
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
    this.ctx = null;
  }
}
