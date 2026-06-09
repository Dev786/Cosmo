// E2E for the Obsidian vault mirror — the human-browsable projection of notes /
// tasks / reminders. Points the vault at a temp dir via configureVault (no os mock
// needed) so it never touches the real ~/Documents/Cosmo Vault.
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
  configureVault, ensureVault, vaultPath,
  mirrorNote, mirrorTaskAdded, mirrorReminder, syncTasks, syncReminders,
} from '../vault';

const VAULT = path.join(os.tmpdir(), 'cosmo-e2e-vault');
const read = (rel: string): string => fs.readFileSync(path.join(VAULT, rel), 'utf8');

// configureVault only flips `enabled` off, never back on, and module state is shared
// within this file — so set the path once up front and exercise the enabled path.
beforeAll(() => { configureVault({ path: VAULT, enabled: true }); });
beforeEach(() => { fs.rmSync(VAULT, { recursive: true, force: true }); });
afterAll(() => { fs.rmSync(VAULT, { recursive: true, force: true }); });

const NOON = new Date('2026-06-09T12:00:00Z'); // slug → 2026-06-09
const DAILY = 'Daily/2026-06-09.md';

describe('vault skeleton', () => {
  it('creates Tasks.md, Reminders.md, Daily/, and an .obsidian marker', () => {
    expect(vaultPath()).toBe(VAULT);
    expect(ensureVault()).toBe(VAULT);
    expect(read('Tasks.md')).toBe('# Tasks\n\n');
    expect(read('Reminders.md')).toBe('# Reminders\n\n');
    expect(fs.existsSync(path.join(VAULT, 'Daily'))).toBe(true);
    expect(read('.obsidian/app.json')).toBe('{}');
  });

  it('never overwrites an existing seeded file', () => {
    ensureVault();
    fs.writeFileSync(path.join(VAULT, 'Tasks.md'), '# Tasks\n\n- [x] keep me\n', 'utf8');
    ensureVault(); // second boot
    expect(read('Tasks.md')).toContain('keep me');
  });
});

describe('daily-note mirror', () => {
  it('files a note under ## Notes in today\'s daily note', () => {
    mirrorNote('buy milk', NOON);
    const daily = read(DAILY);
    expect(daily).toContain('## Notes');
    expect(daily).toMatch(/## Notes\n- \[.*\] buy milk/);
  });

  it('files tasks and reminders under their own sections, in order', () => {
    mirrorTaskAdded('ship it', NOON);
    mirrorTaskAdded('write docs', NOON);
    mirrorReminder('standup', NOON.getTime() + 3_600_000, NOON);
    const daily = read(DAILY);
    expect(daily).toMatch(/## Tasks\n- \[ \] ship it\n- \[ \] write docs/);
    expect(daily).toMatch(/## Reminders\n- \[ \] .* — standup/);
    // Sections stay separate — a task line never lands under Notes.
    expect(daily.indexOf('## Notes')).toBeLessThan(daily.indexOf('## Tasks'));
  });
});

describe('aggregate regeneration', () => {
  it('syncTasks lists open ([ ]) before done ([x])', () => {
    syncTasks([
      { text: 'open one', done: false },
      { text: 'finished', done: true },
      { text: 'open two', done: false },
    ]);
    expect(read('Tasks.md')).toBe('# Tasks\n\n- [ ] open one\n- [ ] open two\n- [x] finished\n');
  });

  it('syncReminders sorts upcoming soonest-first', () => {
    const base = NOON.getTime();
    syncReminders([
      { text: 'later', fireAt: base + 7_200_000 },
      { text: 'sooner', fireAt: base + 3_600_000 },
    ]);
    const md = read('Reminders.md');
    expect(md.indexOf('sooner')).toBeLessThan(md.indexOf('later'));
    expect(md).toMatch(/^# Reminders\n/);
  });

  it('regenerates (does not append) — a shrinking list overwrites cleanly', () => {
    syncTasks([{ text: 'a', done: false }, { text: 'b', done: false }]);
    syncTasks([{ text: 'a', done: false }]); // b removed
    expect(read('Tasks.md')).toBe('# Tasks\n\n- [ ] a\n');
  });
});
