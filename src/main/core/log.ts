import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { Logger } from '../../shared/types';

const LOG_DIR = path.join(os.homedir(), '.pixel', 'logs');
const RETENTION_DAYS = 7;

function dayKey(): string { return new Date().toISOString().slice(0, 10); }
function getLogPath(day: string): string { return path.join(LOG_DIR, `${day}.log`); }

let dirReady = false;
function ensureLogDir(): void {
  if (dirReady) return;
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); dirReady = true; } catch { /* best-effort */ }
}

// One append stream for the current day, reopened only when the date rolls over.
// Write streams are asynchronous + OS-buffered and preserve write order, so logging
// never blocks the main thread. (The old logger did a synchronous mkdir + appendFileSync
// on EVERY line — and logging fires constantly from watchers, IPC, and voice events.)
let stream: fs.WriteStream | null = null;
let streamDay = '';
function currentStream(day: string): fs.WriteStream | null {
  if (stream && streamDay === day) return stream;
  if (stream) { try { stream.end(); } catch { /* ignore */ } stream = null; }
  ensureLogDir();
  try {
    const s = fs.createWriteStream(getLogPath(day), { flags: 'a' });
    s.on('error', () => { if (stream === s) stream = null; });   // never let logging crash the app
    stream = s;
    streamDay = day;
  } catch { stream = null; }
  return stream;
}

function pruneOldLogs(): void {
  try {
    const files = fs.readdirSync(LOG_DIR);
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    for (const file of files) {
      const filePath = path.join(LOG_DIR, file);
      try { if (fs.statSync(filePath).mtimeMs < cutoff) fs.unlinkSync(filePath); } catch { /* skip one */ }
    }
  } catch {
    // non-fatal
  }
}

function write(level: string, msg: string, args: unknown[]): void {
  try {
    const extra = args.length ? ' ' + args.map(a => (a instanceof Error ? a.stack ?? a.message : JSON.stringify(a))).join(' ') : '';
    const line = `${new Date().toISOString()} [${level}] ${msg}${extra}\n`;
    currentStream(dayKey())?.write(line);
    if (level === 'ERROR' || level === 'WARN') process.stderr.write(line);
    else if (process.env.PIXEL_DEV) process.stdout.write(line);
  } catch {
    // never let logging crash the app
  }
}

export const log: Logger = {
  info: (msg, ...args) => write('INFO', msg, args),
  warn: (msg, ...args) => write('WARN', msg, args),
  error: (msg, ...args) => write('ERROR', msg, args),
  debug: (msg, ...args) => { if (process.env.PIXEL_DEV) write('DEBUG', msg, args); },
};

// Run pruning once at startup (boot-time sync I/O is fine — the boot overlay is up).
pruneOldLogs();

export { pruneOldLogs as _pruneOldLogs };
