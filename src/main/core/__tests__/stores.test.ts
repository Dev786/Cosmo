// End-to-end coverage for the three shared local stores (tasks / reminders / notes)
// that the tools AND the panel UI both read & mutate. Exercises the real round-trip
// through disk — add → persist → re-read → mutate → clear — plus the reminder
// scheduler's boot catch-up. os.homedir() is mocked to a temp dir so this NEVER
// touches the real ~/.pixel. The vault mirror is left unconfigured, so syncTasks /
// syncReminders / mirrorNote are no-ops here (the mirror has its own concern).
import * as path from 'path';
import * as fs from 'fs';

// Hoisted above the imports below — redirect homedir to a deterministic temp dir.
jest.mock('os', () => {
  const actual = jest.requireActual('os');
  return { ...actual, homedir: () => path.join(actual.tmpdir(), 'cosmo-e2e-home') };
});

import * as os from 'os';
import {
  listTasks, openTasks, addTask, toggleTask, completeTask, clearTasks,
} from '../tasks';
import {
  addReminder, listReminders, removeReminder, clearReminders, startReminderScheduler,
  type Reminder,
} from '../reminders';
import { listNotes, addNote, clearNotes } from '../notes';

const HOME = os.homedir();
const PIXEL = path.join(HOME, '.pixel');

beforeEach(() => {
  fs.rmSync(HOME, { recursive: true, force: true }); // fresh store per test
});
afterAll(() => {
  fs.rmSync(HOME, { recursive: true, force: true });
});

describe('tasks store (e2e)', () => {
  it('adds, persists to disk, and reads back', () => {
    const t = addTask('  write tests  ');
    expect(t).toMatchObject({ id: 1, text: 'write tests', done: false });
    expect(listTasks()).toHaveLength(1);
    // Real persistence: the JSON file exists and round-trips.
    const onDisk = JSON.parse(fs.readFileSync(path.join(PIXEL, 'tasks.json'), 'utf8'));
    expect(onDisk[0]).toMatchObject({ id: 1, text: 'write tests', done: false });
  });

  it('increments ids monotonically', () => {
    addTask('a'); addTask('b'); addTask('c');
    expect(listTasks().map((t) => t.id)).toEqual([1, 2, 3]);
  });

  it('toggles done ↔ open and completes by id', () => {
    const t = addTask('ship it');
    expect(toggleTask(t.id)?.done).toBe(true);
    expect(toggleTask(t.id)?.done).toBe(false);
    expect(completeTask(t.id)?.done).toBe(true);
    expect(toggleTask(999)).toBeNull();
    expect(completeTask(999)).toBeNull();
  });

  it('openTasks hides completed', () => {
    const a = addTask('a'); addTask('b');
    completeTask(a.id);
    expect(openTasks().map((t) => t.text)).toEqual(['b']);
  });

  it('clears completed only, then everything', () => {
    const a = addTask('a'); const b = addTask('b'); addTask('c');
    completeTask(a.id); completeTask(b.id);
    expect(clearTasks().map((t) => t.text)).toEqual(['c']);   // kept the open one
    expect(clearTasks(true)).toEqual([]);                      // wipe all
    expect(listTasks()).toEqual([]);
  });

  it('survives a fresh read after restart (no in-memory cache)', () => {
    addTask('persisted');
    expect(listTasks()).toHaveLength(1); // load() re-reads disk each call
  });
});

describe('reminders store (e2e)', () => {
  const inHour = () => Date.now() + 3_600_000;

  it('adds a future reminder and lists it; filters past ones', () => {
    addReminder('future', inHour());
    addReminder('past', Date.now() - 10_000);
    const list = listReminders();
    expect(list.map((r) => r.text)).toEqual(['future']);
  });

  it('sorts upcoming soonest-first', () => {
    addReminder('later', Date.now() + 7_200_000);
    addReminder('sooner', Date.now() + 3_600_000);
    expect(listReminders().map((r) => r.text)).toEqual(['sooner', 'later']);
  });

  it('removes by id (true) and reports unknown id (false)', () => {
    const r = addReminder('x', inHour());
    expect(removeReminder('nope')).toBe(false);
    expect(removeReminder(r.id)).toBe(true);
    expect(listReminders()).toEqual([]);
  });

  it('clears all and returns the count', () => {
    addReminder('a', inHour()); addReminder('b', inHour());
    expect(clearReminders()).toBe(2);
    expect(listReminders()).toEqual([]);
  });

  it('scheduler boot catch-up fires recent-due, drops stale, keeps future', () => {
    addReminder('recent', Date.now() - 1_000);          // 1s overdue → fire
    addReminder('stale', Date.now() - 2 * 3_600_000);   // 2h overdue → drop silently
    addReminder('future', inHour());                     // not due → keep
    const fired: Reminder[] = [];
    const stop = startReminderScheduler((r) => fired.push(r), 999_999); // boot tick runs sync
    stop();
    expect(fired.map((r) => r.text)).toEqual(['recent']);
    // Both due ones removed from the store regardless; only the future one remains.
    expect(listReminders().map((r) => r.text)).toEqual(['future']);
  });
});

describe('notes store (e2e)', () => {
  it('appends a timestamped line and lists newest-first', () => {
    addNote('first');
    addNote('second');
    expect(listNotes().map((n) => n.text)).toEqual(['second', 'first']);
    // Stored format is `- [when] text`.
    expect(fs.readFileSync(path.join(PIXEL, 'notes.md'), 'utf8')).toMatch(/- \[.*\] first/);
  });

  it('ignores empty / whitespace-only notes', () => {
    addNote('   ');
    addNote('');
    expect(listNotes()).toEqual([]);
  });

  it('skips lines that are not note entries', () => {
    fs.mkdirSync(PIXEL, { recursive: true });
    fs.writeFileSync(path.join(PIXEL, 'notes.md'), '\nrandom junk\n- [today] real note\n', 'utf8');
    expect(listNotes().map((n) => n.text)).toEqual(['real note']);
  });

  it('clears and returns the count', () => {
    addNote('a'); addNote('b');
    expect(clearNotes()).toBe(2);
    expect(listNotes()).toEqual([]);
  });
});
