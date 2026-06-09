import type { Watcher, WatcherContext } from './types';

const watchers: Watcher[] = [];

export function registerWatcher(w: Watcher): void {
  watchers.push(w);
}

export function startAll(ctx: WatcherContext): void {
  for (const w of watchers) {
    try { w.start(ctx); } catch (e) { ctx.log.error(`Watcher ${w.name} failed to start:`, e); }
  }
}

export function stopAll(): void {
  for (const w of watchers) {
    try { w.stop(); } catch { /* ignore */ }
  }
}

export function resetAllWindows(): void {
  for (const w of watchers) {
    try { w.resetWindow?.(); } catch { /* ignore */ }
  }
}
