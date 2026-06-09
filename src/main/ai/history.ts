import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ChatMessage } from '../../shared/types';

const HISTORY_PATH = path.join(os.homedir(), '.pixel', 'history.json');
// Hard ceiling on verbatim messages persisted — a backstop so the file (and the
// per-turn context) can't grow without bound if compaction hasn't run or failed.
// Older context isn't dropped blindly: the compactor folds it into `summary`.
const HARD_MAX = 40;

interface Store { summary: string; messages: ChatMessage[] }

function load(): Store {
  try {
    const raw = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
    if (Array.isArray(raw)) return { summary: '', messages: raw };   // migrate legacy bare-array files
    return { summary: typeof raw.summary === 'string' ? raw.summary : '', messages: Array.isArray(raw.messages) ? raw.messages : [] };
  } catch { return { summary: '', messages: [] }; }
}

function save(store: Store): void {
  fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(store, null, 2), 'utf8');
}

export function append(role: 'user' | 'assistant', content: string): void {
  const s = load();
  s.messages.push({ role, content });
  if (s.messages.length > HARD_MAX) s.messages = s.messages.slice(-HARD_MAX);
  save(s);
}

/** Recent verbatim messages. The running summary of older turns is separate
 *  (see getSummary) so the caller can decide how to inject it. */
export function getMessages(): ChatMessage[] { return load().messages; }

/** Compact running memory of older, already-folded conversation ('' if none). */
export function getSummary(): string { return load().summary; }

/** Replace the running summary AND the verbatim tail in one write — used by the
 *  compactor after it folds older turns into `summary`. */
export function compactInto(summary: string, keep: ChatMessage[]): void {
  save({ summary, messages: keep });
}

export function clear(): void { save({ summary: '', messages: [] }); }
