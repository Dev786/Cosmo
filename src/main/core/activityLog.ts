// Local-only record of how the day was spent. The focus watcher drops one sample
// per poll here; nothing else writes. Each day is an append-only JSONL file under
// ~/.pixel/activity/ — append-only is crash-safe and dead simple, and we merge /
// aggregate at READ time (a day is at most a few thousand 30s lines).
//
// PRIVACY: this stays on disk. App name + window title + domain never leave the
// machine from here. The only path that sends app/title to the LLM is the opt-in
// Smart Focus classifier (default off) — and even that sends just app+title, not
// this history. Activity.md is mirrored to the user's own Obsidian vault only.
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { log } from './log';

export type Category =
  | 'dev' | 'comms' | 'design' | 'research'
  | 'social' | 'entertainment' | 'meeting' | 'neutral';

export const CATEGORIES: readonly Category[] = [
  'dev', 'comms', 'design', 'research', 'social', 'entertainment', 'meeting', 'neutral',
];

/** Categories that count as heads-down focus (for the peak-focus stretch). */
const FOCUS_CATS: readonly Category[] = ['dev', 'design', 'research'];

export interface ActivitySample {
  /** Epoch ms at the start of the sampled window. */
  ts: number;
  app: string;
  title?: string;
  domain?: string;
  category: Category;
  /** Seconds this sample stands for (the poll interval). */
  secs: number;
}

export interface AppUsage { app: string; secs: number; category: Category; }

export interface DaySummary {
  date: string;                                  // local YYYY-MM-DD
  totalSecs: number;
  byApp: AppUsage[];                             // descending by secs
  byCategory: Record<Category, number>;
  /** Longest heads-down stretch (≥15min), local HH:MM. */
  peakFocus?: { start: string; end: string; secs: number };
}

const ACTIVITY_DIR = path.join(os.homedir(), '.pixel', 'activity');
const TITLE_CAP = 256;

let dirReady = false;
function ensureDir(): boolean {
  if (dirReady) return true;
  try { fs.mkdirSync(ACTIVITY_DIR, { recursive: true }); dirReady = true; }
  catch (e) { log.debug('activityLog: mkdir failed:', (e as Error).message); }
  return dirReady;
}

/** Local calendar day (a user's "today" is local, not UTC). */
function localDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dayFile(date: string): string { return path.join(ACTIVITY_DIR, `${date}.jsonl`); }
function hhmm(d: Date): string { return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }

export function activityDir(): string { return ACTIVITY_DIR; }
export function today(): string { return localDay(new Date()); }

/** Append one sample to its day's file. Best-effort: a write failure is swallowed
 *  (a gap in history, never a crash). Caller decides whether tracking is on. */
export function record(sample: ActivitySample): void {
  if (!ensureDir()) return;
  const clean: ActivitySample = {
    ts: sample.ts,
    app: sample.app.trim().slice(0, 120),
    category: sample.category,
    secs: Math.max(0, Math.round(sample.secs)),
  };
  const title = sample.title?.replace(/\s+/g, ' ').trim().slice(0, TITLE_CAP);
  if (title) clean.title = title;
  if (sample.domain) clean.domain = sample.domain.slice(0, 120);
  try {
    // JSON.stringify escapes any newline in the title, so the line stays intact.
    fs.appendFileSync(dayFile(localDay(new Date(sample.ts))), JSON.stringify(clean) + '\n', 'utf8');
  } catch (e) { log.debug('activityLog: append failed:', (e as Error).message); }
  maybeFlush();   // throttled Activity.md vault regeneration (no-op until a sink is wired)
}

function readDay(date: string): ActivitySample[] {
  let raw: string;
  try { raw = fs.readFileSync(dayFile(date), 'utf8'); } catch { return []; }
  const out: ActivitySample[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const s = JSON.parse(line) as ActivitySample;
      if (s && typeof s.ts === 'number' && typeof s.app === 'string' && typeof s.secs === 'number') out.push(s);
    } catch { /* skip a torn line */ }
  }
  return out;
}

function emptyByCategory(): Record<Category, number> {
  return CATEGORIES.reduce((acc, c) => { acc[c] = 0; return acc; }, {} as Record<Category, number>);
}

/** Longest heads-down focus stretch, tolerating brief (≤5min) interruptions. */
function computePeakFocus(samples: ActivitySample[]): DaySummary['peakFocus'] {
  const GAP_MS = 5 * 60 * 1000;
  const sorted = [...samples].sort((a, b) => a.ts - b.ts);
  let bestStart = 0, bestEnd = 0, bestSecs = 0;
  let curStart = 0, curSecs = 0, lastFocusEnd = 0;
  for (const s of sorted) {
    if (!FOCUS_CATS.includes(s.category)) continue;   // ignore non-focus; gap logic spans it
    if (curSecs === 0 || s.ts - lastFocusEnd > GAP_MS) { curStart = s.ts; curSecs = 0; }
    curSecs += s.secs;
    lastFocusEnd = s.ts + s.secs * 1000;
    if (curSecs > bestSecs) { bestSecs = curSecs; bestStart = curStart; bestEnd = lastFocusEnd; }
  }
  if (bestSecs < 15 * 60) return undefined;
  return { start: hhmm(new Date(bestStart)), end: hhmm(new Date(bestEnd)), secs: bestSecs };
}

// Browser time is far more useful attributed to the SITE than collapsed under the
// browser app — "Prime Video 30m" tells you what you actually did; "Google Chrome 3h"
// hides it. A sample carries a `domain` ONLY when it came from a browser tab (the focus
// watcher reads the URL for browsers alone — focus/index.ts), so domain-presence is our
// reliable "this is a website" signal. Known hosts get a clean name; the rest show the
// bare host, still far better than the browser name.
const SITE_NAMES: Record<string, string> = {
  'primevideo.com': 'Prime Video', 'youtube.com': 'YouTube', 'youtu.be': 'YouTube',
  'netflix.com': 'Netflix', 'hotstar.com': 'Hotstar', 'disneyplus.com': 'Disney+',
  'twitch.tv': 'Twitch', 'spotify.com': 'Spotify',
  'github.com': 'GitHub', 'gitlab.com': 'GitLab', 'stackoverflow.com': 'Stack Overflow',
  'mail.google.com': 'Gmail', 'gmail.com': 'Gmail', 'docs.google.com': 'Google Docs',
  'calendar.google.com': 'Google Calendar', 'notion.so': 'Notion', 'figma.com': 'Figma',
  'linkedin.com': 'LinkedIn', 'x.com': 'X', 'twitter.com': 'X', 'reddit.com': 'Reddit',
  'instagram.com': 'Instagram', 'tiktok.com': 'TikTok', 'chatgpt.com': 'ChatGPT',
  'openai.com': 'ChatGPT', 'claude.ai': 'Claude',
};

/** Friendly label for a browser sample's domain (already a `www.`-stripped host).
 *  Used for the LOCAL vault (Activity.md), where full hosts are allowed — the file
 *  never leaves the machine. The LLM-facing path uses {@link llmSafeLabel} instead. */
export function siteLabel(domain: string): string {
  const d = domain.replace(/^www\./, '').toLowerCase();
  if (d === '127.0.0.1' || d === 'localhost') return 'localhost';
  if (d === 'newtab' || d === '') return 'New Tab';
  for (const key of Object.keys(SITE_NAMES)) {
    if (d === key || d.endsWith('.' + key)) return SITE_NAMES[key];
  }
  return d;
}

const FRIENDLY_SITES = new Set(Object.values(SITE_NAMES));

/** Privacy filter for any label that will reach the LLM (the spoken/chat summary).
 *  The invariant: raw URLs/domains never go to a model. Known service NAMES (Prime
 *  Video, GitHub…) are service-level, app-equivalent, and pass; plain app names pass;
 *  but an unrecognized bare host (e.g. a job board) collapses to a generic so it can't
 *  leak. The full host still shows in the local Activity.md vault. */
export function llmSafeLabel(label: string): string {
  if (FRIENDLY_SITES.has(label)) return label;
  if (label === 'localhost' || label === 'New Tab') return label;
  return /\.[a-z]{2,}$/i.test(label) ? 'a website' : label;   // looks like a host → hide it
}

export function summarize(date: string, samples = readDay(date)): DaySummary {
  const byCategory = emptyByCategory();
  const appMap = new Map<string, AppUsage>();
  let totalSecs = 0;
  for (const s of samples) {
    const cat = (CATEGORIES as readonly string[]).includes(s.category) ? s.category : 'neutral';
    totalSecs += s.secs;
    byCategory[cat] += s.secs;
    // Browser samples bucket by site ("Prime Video"); everything else by app name.
    const label = s.domain ? siteLabel(s.domain) : s.app;
    const cur = appMap.get(label);
    if (cur) { cur.secs += s.secs; }
    else appMap.set(label, { app: label, secs: s.secs, category: cat });
  }
  const byApp = [...appMap.values()].sort((a, b) => b.secs - a.secs);
  return { date, totalSecs, byApp, byCategory, peakFocus: computePeakFocus(samples) };
}

/** Today's usage, aggregated. */
export function todaySummary(): DaySummary { return summarize(localDay(new Date())); }

/** Per-day summaries for the last `days` calendar days (oldest → newest, today last). */
export function rangeSummary(days: number): DaySummary[] {
  const n = Math.max(1, Math.min(days, 31));
  const out: DaySummary[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    out.push(summarize(localDay(d)));
  }
  return out;
}

// ── Presentation: human-readable digests (pure; the tool + vault mirror reuse these) ──

/** Seconds → "2h 10m" / "45m" / "<1m". */
export function fmtDur(secs: number): string {
  const m = Math.round(secs / 60);
  if (m < 1) return secs > 0 ? '<1m' : '0m';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

const WORK_CATS: readonly Category[] = ['dev', 'design', 'research'];
const DISTRACT_CATS: readonly Category[] = ['social', 'entertainment'];

const sumCats = (by: Record<Category, number>, cats: readonly Category[]): number =>
  cats.reduce((n, c) => n + (by[c] || 0), 0);

/** Categories with time, biggest first, as "dev 2h · research 45m". */
function catBreakdown(by: Record<Category, number>): string {
  const parts = CATEGORIES
    .map((c) => [c, by[c] || 0] as const)
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([c, s]) => `${c} ${fmtDur(s)}`);
  return parts.length ? parts.join(' · ') : 'nothing yet';
}

/** The single biggest category, or null if the day is empty. */
function topCategory(by: Record<Category, number>): Category | null {
  let best: Category | null = null;
  let bestSecs = 0;
  for (const c of CATEGORIES) { if ((by[c] || 0) > bestSecs) { bestSecs = by[c]; best = c; } }
  return best;
}

/** "Mon 06-02" from a YYYY-MM-DD key (parsed as local). */
function dayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: '2-digit', day: '2-digit' });
}

const escapePipe = (s: string): string => s.replace(/\|/g, '/');

/** A spoken-friendly digest of one day. Fed to the LLM to phrase — never the raw rows. */
export function phraseToday(s: DaySummary): string {
  if (s.totalSecs === 0) return "I haven't tracked any activity yet today.";
  const top = s.byApp.slice(0, 3).map((a) => `${llmSafeLabel(a.app)} ${fmtDur(a.secs)}`).join(', ');
  const work = sumCats(s.byCategory, WORK_CATS);
  const distract = sumCats(s.byCategory, DISTRACT_CATS);
  const peak = s.peakFocus ? ` Deepest focus ${s.peakFocus.start} to ${s.peakFocus.end}.` : '';
  return `Today so far: ${fmtDur(s.totalSecs)} tracked. Top apps & sites: ${top}. Focused work ${fmtDur(work)}, distractions ${fmtDur(distract)}.${peak}`;
}

/** A spoken-friendly digest of a multi-day range (newest day last). */
export function phraseWeek(days: DaySummary[]): string {
  const active = days.filter((d) => d.totalSecs > 0);
  if (active.length === 0) return "I haven't tracked any activity this week yet.";
  const total = active.reduce((n, d) => n + d.totalSecs, 0);
  const byCat = emptyByCategory();
  for (const d of active) for (const c of CATEGORIES) byCat[c] += d.byCategory[c] || 0;
  const work = sumCats(byCat, WORK_CATS);
  const distract = sumCats(byCat, DISTRACT_CATS);
  const topCats = CATEGORIES
    .map((c) => [c, byCat[c]] as const).filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1]).slice(0, 2).map(([c]) => c).join(' and ');
  let bestDay: DaySummary | null = null;
  for (const d of active) {
    if (d.peakFocus && (!bestDay?.peakFocus || d.peakFocus.secs > bestDay.peakFocus.secs)) bestDay = d;
  }
  const best = bestDay?.peakFocus
    ? ` Best focus day ${dayLabel(bestDay.date)} with ${fmtDur(bestDay.peakFocus.secs)} heads-down.` : '';
  return `This week: ${fmtDur(total)} tracked across ${active.length} ${active.length === 1 ? 'day' : 'days'} (about ${fmtDur(Math.round(total / active.length))} a day). Mostly ${topCats}. Focused work ${fmtDur(work)}, distractions ${fmtDur(distract)}.${best}`;
}

// ── Weekly trend: this week vs the one before (for proactive recaps) ──

interface WeekTotals { activeDays: number; total: number; work: number; distract: number; }

function weekTotals(days: DaySummary[]): WeekTotals {
  const active = days.filter((d) => d.totalSecs > 0);
  const byCat = emptyByCategory();
  for (const d of active) for (const c of CATEGORIES) byCat[c] += d.byCategory[c] || 0;
  return {
    activeDays: active.length,
    total: active.reduce((n, d) => n + d.totalSecs, 0),
    work: sumCats(byCat, WORK_CATS),
    distract: sumCats(byCat, DISTRACT_CATS),
  };
}

/** "up 33%" / "down 12%" / "about the same" / "up from nothing". */
function pctDelta(now: number, prev: number): string {
  if (prev === 0) return now > 0 ? 'up from nothing' : 'flat';
  const d = Math.round(((now - prev) / prev) * 100);
  if (d === 0) return 'about the same';
  return d > 0 ? `up ${d}%` : `down ${Math.abs(d)}%`;
}

/** Spoken-friendly week-over-week trend. Pure: pass this week then last week
 *  (each oldest→newest). Degrades gracefully when there's no prior history. */
export function phraseTrend(thisWeek: DaySummary[], lastWeek: DaySummary[]): string {
  const cur = weekTotals(thisWeek);
  if (cur.activeDays === 0) return "I haven't tracked enough this week to spot a trend yet.";
  const prev = weekTotals(lastWeek);
  if (prev.activeDays === 0) {
    return `This week I tracked ${fmtDur(cur.total)} over ${cur.activeDays} ${cur.activeDays === 1 ? 'day' : 'days'} — focused work ${fmtDur(cur.work)}, distractions ${fmtDur(cur.distract)}. I'll compare week-over-week once there's more history.`;
  }
  return `Week over week: focused work ${fmtDur(cur.work)} (${pctDelta(cur.work, prev.work)} from ${fmtDur(prev.work)}), distractions ${fmtDur(cur.distract)} (${pctDelta(cur.distract, prev.distract)} from ${fmtDur(prev.distract)}).`;
}

/** This week's trend vs the prior week, read from disk. */
export function weeklyTrends(): string {
  const days = rangeSummary(14);   // oldest → newest, today last
  return phraseTrend(days.slice(7), days.slice(0, 7));
}

/** Regenerate the full Activity.md body (today detail + 7-day table). */
export function renderMarkdown(days: DaySummary[]): string {
  const today = days[days.length - 1];
  const out: string[] = [
    '# Activity', '',
    '_Local only — regenerated from `~/.pixel/activity`. Cosmo never sends this anywhere._', '',
    `## Today — ${today.date}`, '',
  ];
  if (today.totalSecs === 0) {
    out.push('_Nothing tracked yet today._');
  } else {
    const peak = today.peakFocus ? ` · deepest focus ${today.peakFocus.start}–${today.peakFocus.end}` : '';
    out.push(`**${fmtDur(today.totalSecs)} tracked**${peak}`, '', '| App / Site | Time | Category |', '|---|---|---|');
    for (const a of today.byApp.slice(0, 12)) out.push(`| ${escapePipe(a.app)} | ${fmtDur(a.secs)} | ${a.category} |`);
    out.push('', `By category: ${catBreakdown(today.byCategory)}`);
  }
  out.push('', '## Last 7 days', '', '| Day | Tracked | Top category |', '|---|---|---|');
  for (const d of days) {
    const tc = topCategory(d.byCategory);
    out.push(`| ${dayLabel(d.date)} | ${d.totalSecs ? fmtDur(d.totalSecs) : '—'} | ${tc ?? '—'} |`);
  }
  out.push('');
  return out.join('\n');
}

// ── Vault mirror: throttled regeneration of Activity.md via an injected sink ──
// Decoupled like sources.ts — activityLog never imports vault; index.ts wires them.
let mirrorSink: ((markdown: string) => void) | null = null;
let lastFlush = 0;
const FLUSH_MS = 5 * 60 * 1000;

/** Register the Activity.md writer (wired once at boot). */
export function onActivityFlush(cb: (markdown: string) => void): void { mirrorSink = cb; }

/** Render + write the mirror now, bypassing the throttle (e.g. when asked for a summary). */
export function flushActivity(): void {
  if (!mirrorSink) return;
  lastFlush = Date.now();
  try { mirrorSink(renderMarkdown(rangeSummary(7))); }
  catch (e) { log.debug('activityLog: mirror failed:', (e as Error).message); }
}

function maybeFlush(): void {
  if (!mirrorSink || Date.now() - lastFlush < FLUSH_MS) return;
  flushActivity();
}
