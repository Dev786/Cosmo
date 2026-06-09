import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { STTProvider } from '../types';
import { log } from '../../core/log';

const execFileAsync = promisify(execFile);

// TODO: Replace stub with real whisper.cpp binding when available
// Research best Node.js whisper.cpp binding at implementation time:
// Options: nodejs-whisper, @xenova/transformers whisper, whisper-node
export const whisperLocalProvider: STTProvider = {
  name: 'whisperLocal',
  offline: true,

  async transcribe(audioBuffer: Buffer): Promise<string> {
    const tmpWav = path.join(os.tmpdir(), `cosmo-stt-${Date.now()}.wav`);
    try {
      fs.writeFileSync(tmpWav, audioBuffer);

      // Try nodejs-whisper if installed
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { whisper } = require('nodejs-whisper');
        const result = await whisper(tmpWav, {
          modelName: 'base.en',
          autoDownloadModelName: 'base.en',
          verbose: false,
        });
        return result?.[0]?.speech ?? '';
      } catch {
        // Fallback: use whisper CLI if installed
        try {
          const { stdout } = await execFileAsync('whisper', [tmpWav, '--model', 'base', '--output_format', 'txt', '--output_dir', os.tmpdir()]);
          return stdout.trim();
        } catch {
          log.warn('whisperLocal: no whisper binding found — install nodejs-whisper or whisper CLI');
          return '';
        }
      }
    } finally {
      fs.unlink(tmpWav, () => {});
    }
  },
};
