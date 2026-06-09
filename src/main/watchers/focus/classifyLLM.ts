// Smart Focus (opt-in): when the cheap heuristic can't tell what an app is, ask the
// CONFIGURED LLM to label it — once per distinct context, cached on disk so it runs
// rarely. This is the ONLY path that sends app context to the model, and only when
// config.activity.smartFocus is on (default off). It sends app name + window title
// ONLY — never URLs, never the activity history.
import type { Config } from '../../../shared/types';
import { getActiveProvider } from '../../ai/providers/registry';
import { CATEGORIES, type Category } from '../../core/activityLog';
import { log } from '../../core/log';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const CACHE_FILE = path.join(os.homedir(), '.pixel', 'activity', 'focus-cache.json');

type Cache = Record<string, Category>;
let cache: Cache | null = null;
const inflight = new Set<string>();

function load(): Cache {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) as Cache; }
  catch { cache = {}; }
  return cache;
}

function persist(): void {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache ?? {}), 'utf8');
  } catch (e) { log.debug('smartFocus: cache persist failed:', (e as Error).message); }
}

/** Cache key: app + a normalized title (digits collapsed, capped) + domain. Normalizing
 *  the title keeps per-document / per-tab variants from exploding the cache. */
export function focusKey(app: string, title?: string, domain?: string): string {
  const t = (title ?? '').toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().slice(0, 80);
  return `${app.toLowerCase()}|${t}|${domain ?? ''}`;
}

/** Parse the model's reply into a known Category, or null if it didn't comply. */
export function parseCategory(text: string): Category | null {
  const word = (text || '').toLowerCase().match(/[a-z]+/)?.[0];
  return word && (CATEGORIES as readonly string[]).includes(word) ? (word as Category) : null;
}

/** Cached LLM label for this context, if known. Synchronous, no network. */
export function cachedCategory(app: string, title?: string, domain?: string): Category | undefined {
  return load()[focusKey(app, title, domain)];
}

const CAT_LIST = CATEGORIES.join(', ');

async function classify(config: Config, app: string, title?: string): Promise<Category | null> {
  const provider = getActiveProvider(config);
  const system =
    `You label the user's currently focused Mac app into exactly ONE category. ` +
    `Reply with only one word from this list and nothing else: ${CAT_LIST}.`;
  const user = `App: ${app}\nWindow title: ${title || '(none)'}\nCategory:`;
  const res = await provider.chat({
    system,
    model: config.llm.model,
    messages: [{ role: 'user', content: user }],
    maxTokens: 16,
  });
  return parseCategory(res.text);
}

/** Fire-and-forget: if this context isn't cached or already in flight, ask the LLM and
 *  cache the result for future polls. Never throws (failure → stays heuristic). Sends
 *  app name + window title ONLY. */
export function warmCategory(config: Config, app: string, title?: string, domain?: string): void {
  const k = focusKey(app, title, domain);
  const c = load();
  if (c[k] || inflight.has(k)) return;
  inflight.add(k);
  void classify(config, app, title)
    .then((cat) => { if (cat) { c[k] = cat; persist(); } })
    .catch((e) => log.debug('smartFocus classify failed:', (e as Error).message))
    .finally(() => inflight.delete(k));
}
