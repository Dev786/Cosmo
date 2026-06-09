import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { log } from '../core/log';

interface RecorderHandle {
  stop(): Promise<Buffer>;
}

const SILENCE_THRESHOLD = 0.015;
const SILENCE_DURATION_MS = 1200;

export function startRecording(): RecorderHandle {
  const tmpFile = path.join(os.tmpdir(), `cosmo-rec-${Date.now()}.wav`);

  // Record via sox (brew install sox) or afrecord
  let proc: ReturnType<typeof execFile> | null = null;
  let stopped = false;

  const trySOX = () => new Promise<void>((resolve, reject) => {
    proc = execFile('sox', [
      '-d',                    // default input device
      '-r', '16000',           // 16kHz — whisper expects this
      '-c', '1',               // mono
      '-b', '16',              // 16-bit
      tmpFile,
      'silence', '1', '0.1', `${SILENCE_THRESHOLD * 100}%`,  // start on sound
      '1', `${SILENCE_DURATION_MS / 1000}`, `${SILENCE_THRESHOLD * 100}%`,   // stop after silence
    ], (err) => {
      if (err && !stopped) reject(err);
      else resolve();
    });
  });

  const tryAFRecord = () => new Promise<void>((resolve, reject) => {
    // macOS afrecord fallback — records for max 10s
    proc = execFile('afrecord', [
      '-f', 'WAVE',
      '-d', 'LEI16@16000',
      tmpFile,
    ], (err) => {
      if (err && !stopped) reject(err);
      else resolve();
    });
  });

  // Start recording in background
  const recordPromise = trySOX().catch(() => tryAFRecord()).catch(e => {
    log.error('Recording failed:', e.message);
  });

  return {
    async stop(): Promise<Buffer> {
      stopped = true;
      if (proc) {
        try { proc.kill('SIGTERM'); } catch { /* already stopped */ }
      }
      await recordPromise;
      try {
        const buf = fs.readFileSync(tmpFile);
        fs.unlink(tmpFile, () => {});
        return buf;
      } catch {
        return Buffer.alloc(0);
      }
    },
  };
}
