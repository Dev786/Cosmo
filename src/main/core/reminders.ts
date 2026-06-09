// Persistent reminders: stored on disk so they survive restarts, checked by a
// scheduler in the main process that fires due ones (speak + chat bubble).
// Tools mutate the store; index.ts owns the scheduler + fire side effects.
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { log } from './log';
import { syncReminders } from './vault';

export interface Reminder {
  id: string;
  text: string;
  fireAt: number; // epoch ms
  created: number;
}

const FILE = path.join(os.homedir(), '.pixel', 'reminders.json');

function load(): Reminder[] {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8')) as Reminder[];
  } catch {
    return [];
  }
}

function save(list: Reminder[]): void {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2), 'utf8');
  // Mirror upcoming reminders into the Obsidian vault's Reminders.md (best-effort).
  // Routed through save() so it stays accurate on add, remove, clear, AND when the
  // scheduler fires and removes due ones.
  syncReminders(list.filter((r) => r.fireAt > Date.now()));
}

function makeId(fireAt: number): string {
  // No Math.random per env constraints elsewhere; fireAt + length is unique enough.
  return `r${fireAt.toString(36)}${load().length}`;
}

export function addReminder(text: string, fireAt: number): Reminder {
  const list = load();
  const r: Reminder = { id: makeId(fireAt), text, fireAt, created: Date.now() };
  list.push(r);
  save(list);
  return r;
}

export function listReminders(): Reminder[] {
  return load().filter((r) => r.fireAt > Date.now()).sort((a, b) => a.fireAt - b.fireAt);
}

export function removeReminder(id: string): boolean {
  const list = load();
  const next = list.filter((r) => r.id !== id);
  if (next.length === list.length) return false;
  save(next);
  return true;
}

export function clearReminders(): number {
  const n = load().length;
  save([]);
  return n;
}

/**
 * Poll for due reminders and fire them. Returns a stop function. `onFire` is
 * given the reminder so the caller can speak it / show a bubble.
 */
export function startReminderScheduler(onFire: (r: Reminder) => void, intervalMs = 15_000): () => void {
  // On boot we fire reminders that came due while the app was closed — but only if
  // they're RECENT. One that's hours/days overdue (the app was off) shouldn't pop up
  // "a day later"; it's removed silently instead. Regular ticks run every intervalMs,
  // so a freshly-due reminder is at most that late and always within grace. Either
  // way, a fired reminder is removed from the store, so it can never repeat.
  const CATCHUP_GRACE_MS = 60 * 60_000; // 1 hour
  const tick = (catchUp: boolean): void => {
    const now = Date.now();
    const list = load();
    const due = list.filter((r) => r.fireAt <= now);
    if (!due.length) return;
    save(list.filter((r) => r.fireAt > now)); // due ones removed regardless — never re-fire
    for (const r of due) {
      if (catchUp && now - r.fireAt > CATCHUP_GRACE_MS) {
        log.info(`Dropping stale reminder (${Math.round((now - r.fireAt) / 60_000)}m overdue): ${r.text}`);
        continue;
      }
      try { onFire(r); } catch (e) { log.error('reminder fire:', (e as Error).message); }
    }
  };
  tick(true); // boot catch-up — recent only
  const handle = setInterval(() => tick(false), intervalMs);
  return () => clearInterval(handle);
}
