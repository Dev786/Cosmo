import { execFile } from 'child_process';
import type { TTSProvider } from '../types';

export const macosTTSProvider: TTSProvider = {
  name: 'macos',
  offline: true,

  async speak(text, opts): Promise<void> {
    const args: string[] = [];
    if (opts?.voice) args.push('-v', opts.voice);
    if (opts?.rate) args.push('-r', String(opts.rate));
    args.push(text);

    opts?.onAudioStart?.(); // `say` plays immediately — start the talk animation now
    return new Promise((resolve, reject) => {
      execFile('say', args, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  },
};
