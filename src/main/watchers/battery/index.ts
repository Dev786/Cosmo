import { powerMonitor } from 'electron';
import type { Watcher, WatcherContext } from '../types';

export class BatteryWatcher implements Watcher {
  readonly name = 'battery';
  private interval: ReturnType<typeof setInterval> | null = null;

  start(ctx: WatcherContext): void {
    this.interval = setInterval(() => {
      // getSystemPowerState available in Electron
      const state = (powerMonitor as any).getSystemPowerState?.();
      if (!state || !state.isOnBatteryPower) return;

      const pct = state.percent ?? 100;
      // Report the drain level as a fact each sample; workSignal decides mood/speech and
      // calloutManager's cooldown rate-limits the spoken alert.
      if (pct <= 10) ctx.report({ source: 'battery', grade: 'critical' });
      else if (pct <= 20) ctx.report({ source: 'battery', grade: 'low' });
    }, 5 * 60_000);
  }

  stop(): void {
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
  }
}
