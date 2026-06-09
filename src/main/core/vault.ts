import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { log } from './log';

// Obsidian vault mirror. An Obsidian vault is just a folder of markdown files, so
// we keep a plain-text copy of everything Cosmo captures — notes, tasks, reminders
// — in a real vault the user can open in Obsidian. The canonical stores stay where
// they are (~/.pixel/notes.md, tasks.json, reminders.json); this is a redundant,
// human-browsable projection that's safe to fall behind or be regenerated.
//
// Two shapes, both intentionally redundant (per the user — redundancy is fine):
//   • Daily/YYYY-MM-DD.md — an append-only journal: what you noted / planned / were
//     reminded about THAT day, grouped under ## Notes / ## Tasks / ## Reminders.
//   • Tasks.md, Reminders.md — running aggregates, fully regenerated from the
//     source-of-truth JSON on every change, so checkboxes + removals stay accurate.
//
// Everything is best-effort: a write failure logs and is swallowed so a tool never
// breaks because the vault folder is missing or read-only.

// Fallback default until configureVault runs at boot. os.homedir()/Documents is a
// reasonable guess, but configureVault is passed Electron's real documents path
// (app.getPath('documents')) so we don't assume Documents lives under the home dir.
let VAULT_DIR = path.join(os.homedir(), 'Documents', 'Cosmo Vault');
let enabled = true;

/** Apply config (called once at boot, before ensureVault). Precedence: an explicit
 *  configured `path` wins; otherwise we default to `<documentsDir>/Cosmo Vault`
 *  (the OS's real Documents folder, passed in by the caller); otherwise the
 *  home-dir fallback above. No absolute path is ever hardcoded. */
export function configureVault(opts?: { path?: string; enabled?: boolean }, documentsDir?: string): void {
  if (opts?.path && opts.path.trim()) VAULT_DIR = opts.path.trim();
  else if (documentsDir && documentsDir.trim()) VAULT_DIR = path.join(documentsDir.trim(), 'Cosmo Vault');
  if (opts?.enabled === false) enabled = false;
}

export function vaultPath(): string { return VAULT_DIR; }

const dailyDir = (): string => path.join(VAULT_DIR, 'Daily');
const dailyFile = (now: Date): string => path.join(dailyDir(), `${slug(now)}.md`);
const tasksFile = (): string => path.join(VAULT_DIR, 'Tasks.md');
const remindersFile = (): string => path.join(VAULT_DIR, 'Reminders.md');
const activityFile = (): string => path.join(VAULT_DIR, 'Activity.md');

function slug(d: Date): string { return d.toISOString().slice(0, 10); }
function hhmm(d: Date): string { return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }
function whenLabel(d: Date): string {
  return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function seedIfMissing(file: string, content: string): void {
  if (!fs.existsSync(file)) fs.writeFileSync(file, content, 'utf8');
}

/** Create the vault skeleton. Safe to call every boot — never overwrites. Returns
 *  the vault path (for logging), or null if disabled / creation failed. */
export function ensureVault(): string | null {
  if (!enabled) return null;
  try {
    fs.mkdirSync(dailyDir(), { recursive: true });
    // A (minimal) .obsidian/ folder makes Obsidian recognize this as a vault and
    // open it without the "is this a vault?" prompt.
    const obs = path.join(VAULT_DIR, '.obsidian');
    if (!fs.existsSync(obs)) { fs.mkdirSync(obs, { recursive: true }); fs.writeFileSync(path.join(obs, 'app.json'), '{}', 'utf8'); }
    seedIfMissing(tasksFile(), '# Tasks\n\n');
    seedIfMissing(remindersFile(), '# Reminders\n\n');
    seedIfMissing(activityFile(), '# Activity\n\n');
    ensureDaily(new Date()); // today's journal exists from boot, not just on first capture
    return VAULT_DIR;
  } catch (e) {
    log.warn('Vault init failed (Obsidian mirror disabled this session):', (e as Error).message);
    return null;
  }
}

/** Ensure today's daily note exists with the three section headers. */
function ensureDaily(now: Date): string {
  const file = dailyFile(now);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(dailyDir(), { recursive: true });
    fs.writeFileSync(file, `# ${slug(now)}\n\n## Notes\n\n## Tasks\n\n## Reminders\n`, 'utf8');
  }
  return file;
}

/** Insert a line at the end of a `## <section>` block (creates the section if absent). */
function appendUnderSection(file: string, section: string, line: string): void {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const hIdx = lines.findIndex((l) => l.trim() === `## ${section}`);
  if (hIdx === -1) { fs.appendFileSync(file, `\n## ${section}\n${line}\n`, 'utf8'); return; }
  let end = lines.length;
  for (let i = hIdx + 1; i < lines.length; i++) { if (lines[i].startsWith('## ')) { end = i; break; } }
  let at = end;
  while (at > hIdx + 1 && lines[at - 1].trim() === '') at--; // sit above trailing blank lines
  lines.splice(at, 0, line);
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
}

function mirror(section: string, line: string, now: Date): void {
  if (!enabled) return;
  try { appendUnderSection(ensureDaily(now), section, line); }
  catch (e) { log.debug('Vault daily mirror failed:', (e as Error).message); }
}

/** A captured note → today's daily note. */
export function mirrorNote(text: string, now: Date = new Date()): void {
  mirror('Notes', `- [${hhmm(now)}] ${text.trim()}`, now);
}

/** A newly added task → today's daily note (the running Tasks.md is synced separately). */
export function mirrorTaskAdded(text: string, now: Date = new Date()): void {
  mirror('Tasks', `- [ ] ${text.trim()}`, now);
}

/** A newly set reminder → today's daily note. */
export function mirrorReminder(text: string, fireAt: number, now: Date = new Date()): void {
  mirror('Reminders', `- [ ] ${whenLabel(new Date(fireAt))} — ${text.trim()}`, now);
}

/** Regenerate Tasks.md from the full task list (open first, then completed). */
export function syncTasks(tasks: Array<{ text: string; done: boolean }>): void {
  if (!enabled) return;
  try {
    const open = tasks.filter((t) => !t.done).map((t) => `- [ ] ${t.text}`);
    const done = tasks.filter((t) => t.done).map((t) => `- [x] ${t.text}`);
    const body = [...open, ...done].join('\n');
    fs.mkdirSync(VAULT_DIR, { recursive: true });
    fs.writeFileSync(tasksFile(), `# Tasks\n\n${body}${body ? '\n' : ''}`, 'utf8');
  } catch (e) { log.debug('Vault tasks sync failed:', (e as Error).message); }
}

/** Regenerate Reminders.md from the upcoming-reminder list (soonest first). */
export function syncReminders(items: Array<{ text: string; fireAt: number }>): void {
  if (!enabled) return;
  try {
    const body = [...items]
      .sort((a, b) => a.fireAt - b.fireAt)
      .map((r) => `- [ ] ${whenLabel(new Date(r.fireAt))} — ${r.text}`)
      .join('\n');
    fs.mkdirSync(VAULT_DIR, { recursive: true });
    fs.writeFileSync(remindersFile(), `# Reminders\n\n${body}${body ? '\n' : ''}`, 'utf8');
  } catch (e) { log.debug('Vault reminders sync failed:', (e as Error).message); }
}

/** Regenerate Activity.md from a pre-rendered markdown body (activityLog owns the
 *  formatting; this just writes). Fully regenerated each time, like Tasks/Reminders. */
export function syncActivity(markdown: string): void {
  if (!enabled) return;
  try {
    fs.mkdirSync(VAULT_DIR, { recursive: true });
    fs.writeFileSync(activityFile(), markdown.endsWith('\n') ? markdown : `${markdown}\n`, 'utf8');
  } catch (e) { log.debug('Vault activity sync failed:', (e as Error).message); }
}
