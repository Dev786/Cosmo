// The sources behind what Cosmo just told you about — right now that's news
// headlines (title + outlet + link). Rather than dumping them into the chat,
// they're recorded here so the panel's Sources tab can show the full list with
// clickable links. Newest first, deduped, capped — a rolling "where did that come
// from?" record, not an archive.
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface Source { title: string; source: string; url: string; when: number; }

const FILE = path.join(os.homedir(), '.pixel', 'sources.json');
const CAP = 40;

function load(): Source[] {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) as Source[]; } catch { return []; }
}

function persist(list: Source[]): void {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(list, null, 2), 'utf8');
  } catch { /* best-effort — a missing file just means an empty Sources tab */ }
}

// A single listener (the main window) is notified after sources actually change,
// so an already-open Sources tab refreshes live — mirroring how reminders/notes
// push `panel:changed`. The store stays decoupled from Electron/IPC.
let onChange: (() => void) | null = null;
export function onSourcesChanged(cb: () => void): void { onChange = cb; }

/** Recorded sources, newest first. */
export function listSources(): Source[] {
  return load();
}

/** Prepend a fresh batch (already in the order shown), skipping any we already
 *  have (by link, or title when there's no link), then cap the list. */
export function addSources(items: Array<{ title: string; source: string; url?: string }>): void {
  const existing = load();
  const seen = new Set(existing.map((s) => s.url || s.title));
  const now = Date.now();
  const fresh: Source[] = [];
  for (const it of items) {
    const key = it.url || it.title;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    fresh.push({ title: it.title, source: it.source, url: it.url ?? '', when: now });
  }
  if (fresh.length) {
    persist([...fresh, ...existing].slice(0, CAP));
    onChange?.();   // refresh an open Sources tab the moment a search lands results
  }
}

export function clearSources(): number {
  const n = load().length;
  persist([]);
  return n;
}
