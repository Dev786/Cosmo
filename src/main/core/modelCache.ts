// A tiny on-disk cache of each cloud vendor's `/v1/models` list, so the setup
// screen doesn't re-hit the network every time it opens, switches vendor, or the
// key field blurs. Persisted (not just in-memory) so the 24h TTL spans restarts.
//
// Local providers (Ollama) are NOT cached by callers — their /v1/models is an
// instant localhost call and a model you just `ollama pull`ed should appear at
// once, not up to a day later.
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const FILE = path.join(os.homedir(), '.pixel', 'modelCache.json');
const TTL_MS = 24 * 60 * 60 * 1000; // 24h

interface Entry { models: string[]; fetchedAt: number; }
type Cache = Record<string, Entry>;

function load(): Cache {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) as Cache; } catch { return {}; }
}

function persist(c: Cache): void {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(c, null, 2), 'utf8');
  } catch { /* best-effort — a missing cache just means a refetch */ }
}

/** Cached models for a provider, or null if absent / past the 24h TTL. Pass
 *  `allowStale` to return an expired list anyway (used as a fallback when a live
 *  refetch fails — a day-old list beats no list). */
export function getCachedModels(id: string, allowStale = false): string[] | null {
  const e = load()[id];
  if (!e) return null;
  if (!allowStale && Date.now() - e.fetchedAt > TTL_MS) return null;
  return e.models;
}

export function setCachedModels(id: string, models: string[]): void {
  const c = load();
  c[id] = { models, fetchedAt: Date.now() };
  persist(c);
}
