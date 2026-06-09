import type { Watcher, WatcherContext } from '../types';
import { classifyHeuristic, categoryToClass, hostOf } from './classify';
import { cachedCategory, warmCategory } from './classifyLLM';
import { runScript } from '../../core/osascript';
import * as activityLog from '../../core/activityLog';
import { log } from '../../core/log';

const BROWSERS = ['google chrome', 'safari', 'arc', 'firefox', 'brave browser'];

export class FocusWatcher implements Watcher {
  readonly name = 'focus';
  private interval: ReturnType<typeof setInterval> | null = null;
  private ctx: WatcherContext | null = null;

  start(ctx: WatcherContext): void {
    this.ctx = ctx;
    const isDev = process.env.PIXEL_DEV === '1';
    const pollMs = isDev ? 5000 : 30_000;
    const pollSecs = Math.round(pollMs / 1000);

    this.interval = setInterval(async () => {
      if (!this.ctx) return;
      const config = this.ctx.config;

      try {
        const appName = (await runScript(`tell application "System Events" to get name of first process whose frontmost is true`)).trim();
        if (!appName) return;

        const isBrowser = BROWSERS.some(b => appName.toLowerCase().includes(b));
        let url: string | undefined;
        if (isBrowser) {
          try {
            url = (await runScript(
              appName.toLowerCase().includes('safari')
                ? `tell application "Safari" to get URL of current tab of front window`
                : `tell application "Google Chrome" to get URL of active tab of front window`
            )).trim();
          } catch { /* no active tab / permission */ }
        }

        // Window title — local only, used for activity history (and Smart Focus when
        // the user opts in). Empty when the app has no window or AX isn't permitted.
        let title: string | undefined;
        try {
          title = (await runScript(`tell application "System Events" to tell (first process whose frontmost is true) to get value of attribute "AXTitle" of front window`)).trim();
        } catch { /* no front window / accessibility not granted */ }

        const domain = hostOf(url);
        let category = classifyHeuristic(appName, title, domain, config);

        // Smart Focus (opt-in, default off): only when the heuristic can't tell (neutral),
        // use the configured LLM's cached label — or warm the cache async for next time.
        // This is the ONLY path that sends app context (app name + window title) to the LLM.
        if (config.activity?.smartFocus && category === 'neutral') {
          const llm = cachedCategory(appName, title, domain);
          if (llm) category = llm;
          else warmCategory(config, appName, title, domain);
        }

        // 1) Always-on activity tracking — independent of work hours, so we get a
        //    full-day picture for the insights buddy. Stays on disk; never sent out.
        if (config.activity?.track !== false) {
          activityLog.record({ ts: Date.now(), app: appName, title, domain, category, secs: pollSecs });
        }

        // 2) Report the instantaneous activity class as a fact. workSignal owns the
        //    distraction window, work-hours gating, meeting-quiet, and any scold —
        //    this watcher no longer judges or sets mood.
        this.ctx.report({ source: 'focus', cls: categoryToClass(category), secs: pollSecs });

      } catch (e) {
        log.debug('FocusWatcher poll error (likely permission not granted yet):', (e as Error).message);
      }
    }, pollMs);
  }

  stop(): void {
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
    this.ctx = null;
  }
}
