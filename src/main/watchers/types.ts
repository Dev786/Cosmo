import type { Config, Logger } from '../../shared/types';
import type { WorkSignal } from '../workSignal';

export interface WatcherContext {
  config: Readonly<Config>;
  /** Report an observed fact. The judge (workSignal) — not the watcher — decides the
   *  resulting mood and whether anything is spoken. Watchers never set mood directly. */
  report(signal: WorkSignal): void;
  log: Logger;
}

export interface Watcher {
  readonly name: string;
  start(ctx: WatcherContext): void;
  stop(): void;
  resetWindow?(): void;
}
