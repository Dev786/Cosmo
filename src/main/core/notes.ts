// Quick notes captured to ~/.pixel/notes.md (one timestamped line each). The
// notes tool and the panel's Notes tab both go through here, so a note captured by
// voice and one typed in the panel share the same file + Obsidian mirror.
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { mirrorNote } from './vault';

export interface Note { id: number; text: string; when: string; }

const FILE = path.join(os.homedir(), '.pixel', 'notes.md');

function read(): string {
  try { return fs.readFileSync(FILE, 'utf8'); } catch { return ''; }
}

/** Captured notes, newest first. Each stored line is `- [timestamp] text`;
 *  anything that doesn't match (stray blank lines) is skipped. */
export function listNotes(): Note[] {
  const notes: Note[] = [];
  let id = 0;
  for (const line of read().split('\n')) {
    const m = line.match(/^-\s*\[([^\]]*)\]\s*(.*)$/);
    if (m && m[2].trim()) notes.push({ id: id++, text: m[2].trim(), when: m[1].trim() });
  }
  return notes.reverse();
}

export function addNote(text: string): void {
  const t = text.trim();
  if (!t) return;
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.appendFileSync(FILE, `\n- [${new Date().toLocaleString()}] ${t}`, 'utf8');
  mirrorNote(t); // project into the Obsidian vault too (best-effort)
}

export function clearNotes(): number {
  const n = listNotes().length;
  try { fs.writeFileSync(FILE, '', 'utf8'); } catch { /* best-effort */ }
  return n;
}
