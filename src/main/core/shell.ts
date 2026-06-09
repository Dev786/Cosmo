import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export async function openUrl(url: string): Promise<void> {
  await execFileAsync('open', [url]);
}

export async function openApp(name: string): Promise<void> {
  await execFileAsync('open', ['-a', name]);
}

export async function runShortcut(name: string): Promise<void> {
  await execFileAsync('shortcuts', ['run', name]);
}
