import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { appendUserFact, removeUserFact, writeUserFacts } from './workspace';

// User-memory commands. Durable facts now live in the editable workspace USER.md
// (OpenClaw style) rather than a JSON blob — this module is a thin command shim
// plus a one-time migration off the legacy ~/.pixel/memory.json.

const LEGACY_PATH = path.join(os.homedir(), '.pixel', 'memory.json');

/** One-time: fold legacy memory.json facts into USER.md, then retire the old file.
 *  No-op when there's nothing to migrate. Call once at boot (after the workspace
 *  is seeded). */
export function migrateLegacyMemory(): void {
  try {
    if (!fs.existsSync(LEGACY_PATH)) return;
    const raw = JSON.parse(fs.readFileSync(LEGACY_PATH, 'utf8')) as Array<{ value?: string }>;
    const facts = Array.isArray(raw) ? raw.map((e) => e.value ?? '').filter(Boolean) : [];
    for (const f of facts) appendUserFact(f);
    fs.renameSync(LEGACY_PATH, `${LEGACY_PATH}.migrated`);
  } catch { /* best-effort — a bad legacy file shouldn't block boot */ }
}

/** Detect and handle memory commands in user text. Returns true if handled. */
export function handleMemoryCommand(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t === 'forget everything' || t === 'clear your memory') { writeUserFacts([]); return true; }
  const remMatch = text.match(/^remember\s+(?:that\s+)?(.+)/i);
  if (remMatch) { appendUserFact(remMatch[1].trim()); return true; }
  const forgetMatch = text.match(/^forget\s+(.+)/i);
  if (forgetMatch) { removeUserFact(forgetMatch[1].trim()); return true; }
  return false;
}
