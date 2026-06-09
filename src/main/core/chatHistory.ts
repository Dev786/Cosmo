import { promises as fsp } from 'fs';
import * as path from 'path';
import * as os from 'os';

// Durable chat transcript. Every message shown in the chat window (typed, spoken,
// or Cosmo's replies) is appended here as one JSON object per line (JSONL), so the
// log survives restarts. The renderer shows only the last few on open and lazily
// pulls older batches as the user scrolls up — so we never dump the whole history
// into the DOM. Stored under ~/.pixel alongside logs/ and workspace/.

export interface ChatMsg { text: string; type: 'user' | 'bot'; }
interface Entry { t: string; r: 'user' | 'bot'; m: string }

const FILE = path.join(os.homedir(), '.pixel', 'chat-history.jsonl');
const MAX = 1000; // keep the transcript bounded; oldest lines are trimmed past this

function parse(line: string): Entry | null {
  try {
    const e = JSON.parse(line) as Entry;
    return e && typeof e.m === 'string' && (e.r === 'user' || e.r === 'bot') ? e : null;
  } catch { return null; }
}

async function readAll(): Promise<Entry[]> {
  try {
    const raw = await fsp.readFile(FILE, 'utf8');
    return raw.split('\n').map(parse).filter((e): e is Entry => e !== null);
  } catch { return []; } // missing file ⇒ empty history
}

const toMsg = (e: Entry): ChatMsg => ({ text: e.m, type: e.r });

/** Append one message. Empty/whitespace text is ignored. Best-effort: never throws. */
export async function appendChat(type: 'user' | 'bot', text: string): Promise<void> {
  const m = (text ?? '').trim();
  if (!m) return;
  const all = await readAll();
  all.push({ t: new Date().toISOString(), r: type, m });
  const kept = all.length > MAX ? all.slice(all.length - MAX) : all;
  try {
    await fsp.mkdir(path.dirname(FILE), { recursive: true });
    await fsp.writeFile(FILE, kept.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
  } catch { /* best-effort */ }
}

/** The most recent `limit` messages, plus the index of the first returned message
 *  (`start`) and the total count — the renderer uses `start` as the cursor for the
 *  next, older batch. */
export async function recentChat(limit: number): Promise<{ items: ChatMsg[]; start: number; total: number }> {
  const all = await readAll();
  const start = Math.max(0, all.length - Math.max(0, limit));
  return { items: all.slice(start).map(toMsg), start, total: all.length };
}

/** The batch of `limit` messages ending just BEFORE index `before` (exclusive).
 *  Returns the new `start` index; when `start` is 0 there is nothing older left. */
export async function olderChat(before: number, limit: number): Promise<{ items: ChatMsg[]; start: number }> {
  const all = await readAll();
  const end = Math.max(0, Math.min(before, all.length));
  const start = Math.max(0, end - Math.max(0, limit));
  return { items: all.slice(start, end).map(toMsg), start };
}

/** Wipe the transcript (the "clear conversation" action). */
export async function clearChat(): Promise<void> {
  try { await fsp.writeFile(FILE, '', 'utf8'); } catch { /* best-effort */ }
}
