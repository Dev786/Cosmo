import { execFile } from 'child_process';

export class OsaError extends Error {
  constructor(msg: string, public readonly stderr: string) { super(msg); }
}
export class PermissionError extends OsaError {}

function toError(err: Error, stderr: string): OsaError {
  const s = stderr.toLowerCase();
  if (
    s.includes('not allowed assistive access') ||
    s.includes('erraeeventnotpermitted') ||
    s.includes('is not allowed to send keystrokes') ||
    s.includes('not authorized to send apple events') ||  // macOS Automation (TCC) denial, e.g. for Mail
    stderr.includes('-1743')                                // errAEEventNotPermitted, numeric form
  ) {
    return new PermissionError('Automation permission denied', stderr);
  }
  return new OsaError(err.message, stderr);
}

function run(argv: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('osascript', argv, { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) return reject(toError(err, stderr));
      resolve(stdout.trim());
    });
  });
}

export function runScript(script: string, timeoutMs = 5000): Promise<string> {
  return run(['-e', script], timeoutMs);
}

/** Run an AppleScript that reads its inputs from `on run argv`, passing `args` as
 *  argv entries. Use this whenever a value is USER-CONTROLLED (e.g. a search query):
 *  argv values are handed to osascript as separate process arguments and are NEVER
 *  parsed as script, so they can't break out of a string literal or inject
 *  AppleScript — the safe equivalent of parameterized queries. */
export function runScriptWithArgs(script: string, args: string[], timeoutMs = 5000): Promise<string> {
  return run(['-e', script, ...args], timeoutMs);
}

/** Bring a macOS app to the front (launching it if needed) via LaunchServices `open -a`.
 *  This is NOT an Apple Event, so it works even when the target app's AppleScript bridge
 *  is wedged — exactly when you most want to surface it. `appName` is caller-fixed, never
 *  user input; execFile with an argument array means no shell, no interpolation. */
export function openApp(appName: string, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('open', ['-a', appName], { timeout: timeoutMs }, (err) => (err ? reject(err) : resolve()));
  });
}
