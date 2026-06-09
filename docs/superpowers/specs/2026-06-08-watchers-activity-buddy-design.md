# Activity-aware Watchers + Insights Buddy — Design

**Date:** 2026-06-08
**Status:** Implemented — all 6 slices complete (2026-06-08). Verified by `tsc --noEmit` + 115 unit tests; live E2E deferred to the integration-test pass.

## Goal
Turn the focus watcher from a crude static-list scolder into (1) an accurate, LLM-assisted
focus classifier and (2) a background activity tracker that gives the user real, buddy-style
insights about how they spend their day — plus consolidate mood judgment into one `workSignal.ts`.

## Problems with today's watchers (grounded in code)
- `focus/classify.ts` uses static substring lists (`workApps`=9 dev tools, `workDomains`,
  `distractionDomains`). Anything unknown → `neutral` → ignored. Binary, context-blind
  (`youtube.com` is always "distraction"), reads app+domain but **not the window title**.
- The 30-min distraction window is computed only to scold, then **discarded** — no history,
  no insights.
- Focus runs **only during work hours**, so no full-day usage picture.
- No `workSignal.ts`: `idle` and `focus` both call `setMood` directly → double-scold risk,
  idle escalation ignores work hours.

## Decisions (from the user)
- Classifier: **use the configured LLM** (`config.llm`), cached per distinct context.
- Insights: **proactive recaps + weekly trends** (gated by the proactive-speech opt-in).
- Privacy: **Smart Focus is opt-in (default off)**. Default stays heuristic-only/local. When on,
  app name + window title are sent to the configured model for one-time (cached) classification.
  Privacy copy on the site updated to disclose this.

## Architecture

```
focus/idle/battery/eyeStrain  ──facts──►  workSignal.ts (the judge)  ──►  setMood / requestCallout
            │
   focus sample {app,title,domain,category}
            ▼
   core/activityLog.ts  ──►  ~/.pixel/activity/YYYY-MM-DD.jsonl  +  Obsidian Activity.md
            │
   aggregates (today / range / weekly trends)
            ▼
   tools/activity (activity.summary)  +  proactive recaps (briefing)
```

### Modules
1. **`core/activityLog.ts`** (new) — append `ActivitySample` to a per-day JSONL; in-memory
   aggregator with `todaySummary()`, `rangeSummary(days)`, `weeklyTrends()`. `record()` collapses
   consecutive identical samples into durations. `track` toggle disables it entirely. Mirrors a
   regenerated `Activity.md` to the vault (reuse the vault sink pattern).
2. **`watchers/focus/classify.ts`** (upgrade) — `classifyHeuristic()` (instant fallback, expanded
   categories) + `classifyWithLLM()` (configured provider, tiny one-word prompt) + a JSON cache
   keyed by `app|normTitle|domain`. Categories: `dev|comms|design|research|social|entertainment|meeting|neutral`.
   work/distraction is a mapping over categories.
3. **`watchers/focus/index.ts`** (upgrade) — also read the window **title**; record every poll to
   activityLog (always, if `track`); report a `focus` fact to workSignal instead of `setMood`.
4. **`main/workSignal.ts`** (new) — receives facts from all watchers, owns mood/callout rules
   (work-hours, cooldowns, no double-scold, meeting-quiet). Watchers call `workSignal.report(fact)`.
5. **`tools/activity/index.ts`** (new) — `activity.summary` ({range:'today'|'week'}) returns a
   spoken-friendly summary built from local aggregates (the LLM only phrases the tool's summary
   string; raw usage isn't dumped to it).
6. **`main/briefing.ts`** (new/where recaps live) — end-of-day recap + weekly trend, gated by
   `voice.proactiveSpeech`, scheduled off `workHours.end` / a weekly day.

### Config additions (`shared/types.ts` + CONFIG_DEFAULTS, backfilled for existing users)
```ts
activity: {
  track: boolean;        // record usage at all (default true)
  smartFocus: boolean;   // LLM classification via configured model (default FALSE — opt-in)
  recap: 'off' | 'daily' | 'weekly' | 'both';  // proactive recaps (default 'both', still gated by proactiveSpeech)
}
```

### Data shapes
```ts
interface ActivitySample { ts: number; app: string; title?: string; domain?: string; category: Category; secs: number; }
type Category = 'dev'|'comms'|'design'|'research'|'social'|'entertainment'|'meeting'|'neutral';
interface DaySummary { date: string; totalSecs: number; byApp: {app:string;secs:number;category:Category}[]; byCategory: Record<Category,number>; peakFocus?: {start:string;end:string}; }
```

## Build order (slices)
1. **activityLog core + title capture + config** — tracking foundation. ✅ first.
2. **`activity.summary` tool + Activity.md vault mirror** — on-demand insights.
3. **LLM classification + cache + `smartFocus` toggle** — accuracy (opt-in).
4. **`workSignal.ts`** — consolidate judgment (refactor watchers to emit facts).
5. **Proactive recaps + weekly trends** (`briefing.ts`).
6. **Privacy copy** on site/architecture for Smart Focus.

## Privacy invariants
- Default (smartFocus off): app/title/domain stay **local**; nothing implicit reaches the LLM —
  the existing promise holds.
- smartFocus on: only **app name + window title** (not full URLs/content) sent to the configured
  model, cached so it's rare; disclosed in setup + site.
- Activity history is local + vault-mirrored only; never sent anywhere by default.
```
