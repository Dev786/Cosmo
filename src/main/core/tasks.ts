// Persistent to-do tasks: stored on disk so they survive restarts. Mirrors
// core/reminders.ts — the shared store the task tool AND the panel UI both read
// and mutate, so neither has to go through the other. save() keeps the Obsidian
// vault's Tasks.md in lock-step (best-effort).
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { syncTasks } from './vault';

export interface Task {
  id: number;
  text: string;
  done: boolean;
  created: number;
}

const FILE = path.join(os.homedir(), '.pixel', 'tasks.json');

function load(): Task[] {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8')) as Task[];
  } catch {
    return [];
  }
}

function save(list: Task[]): void {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2), 'utf8');
  // Routed through save() so the vault mirror stays accurate on add, toggle,
  // and clear alike.
  syncTasks(list);
}

/** All tasks, newest last (insertion order). */
export function listTasks(): Task[] {
  return load();
}

/** Just the not-yet-done tasks (what the tool's list/done logic operates on). */
export function openTasks(): Task[] {
  return load().filter((t) => !t.done);
}

export function addTask(text: string): Task {
  const list = load();
  const id = list.reduce((m, t) => Math.max(m, t.id), 0) + 1;
  const task: Task = { id, text: text.trim(), done: false, created: Date.now() };
  list.push(task);
  save(list);
  return task;
}

/** Flip a task's done flag (complete ↔ reopen). Returns the new state, or null if id unknown. */
export function toggleTask(id: number): Task | null {
  const list = load();
  const task = list.find((t) => t.id === id);
  if (!task) return null;
  task.done = !task.done;
  save(list);
  return task;
}

/** Mark a specific task complete. Returns it, or null if id unknown / already done. */
export function completeTask(id: number): Task | null {
  const list = load();
  const task = list.find((t) => t.id === id);
  if (!task) return null;
  task.done = true;
  save(list);
  return task;
}

/** Remove completed tasks, or every task when `allTasks` is true. Returns the kept list. */
export function clearTasks(allTasks = false): Task[] {
  const next = allTasks ? [] : load().filter((t) => !t.done);
  save(next);
  return next;
}
