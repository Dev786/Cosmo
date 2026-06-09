import { execFileSync } from 'child_process';
import * as fs from 'fs';
import { log } from './log';

// Resolve an absolute path to a REAL system node binary (not Electron's bundled
// runtime). transformers.js / onnxruntime-node inference crashes under Electron
// (code 5 in utilityProcess, SIGTRAP under ELECTRON_RUN_AS_NODE) but runs cleanly
// under system node — so every forked ML worker (STT, Smart Turn, embeddings) is
// launched with `fork(..., { execPath: resolveNodePath() })`.
//
// Must survive both terminal launches (node on PATH) and Finder launches (PATH is
// minimal), hence the explicit candidate sweep. COSMO_NODE_PATH overrides for tests.
export function resolveNodePath(): string {
  const override = process.env.COSMO_NODE_PATH;
  if (override && fs.existsSync(override)) return override;
  try {
    const p = execFileSync('/usr/bin/which', ['node'], { encoding: 'utf8' }).trim();
    if (p && fs.existsSync(p)) return p;
  } catch {
    /* node not on PATH (Finder launch) — fall through to the candidate sweep */
  }
  for (const candidate of ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node']) {
    if (fs.existsSync(candidate)) return candidate;
  }
  log.warn('No system node found — falling back to Electron runtime (ML inference will likely fail).');
  return process.execPath;
}
