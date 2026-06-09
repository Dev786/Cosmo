import { log } from '../core/log';

export class WakeWordNotConfigured extends Error {}
export class WakeWordInitFailed extends Error {}

interface WakeWordHandle {
  destroy(): void;
}

let handle: WakeWordHandle | null = null;
let detectedCallback: (() => void) | null = null;

export function onWakeWordDetected(cb: () => void): void {
  detectedCallback = cb;
}

export async function initWakeWord(accessKey: string): Promise<void> {
  if (!accessKey) throw new WakeWordNotConfigured('No PICOVOICE_ACCESS_KEY set');

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Porcupine, BuiltinKeyword } = require('@picovoice/porcupine-node');

    const porcupine = new Porcupine(accessKey, [BuiltinKeyword.BUMBLEBEE], [0.7]);
    // TODO: wire up microphone stream to porcupine.process()
    // Full implementation requires a PCM microphone stream (node-record-lpcm16 or similar)
    // For now the mic dot fallback is the primary entry point

    handle = {
      destroy() {
        try { porcupine.release(); } catch { /* ignore */ }
      },
    };

    log.info('Porcupine wake word ready');
  } catch (e: unknown) {
    throw new WakeWordInitFailed(`Porcupine init failed: ${(e as Error).message}`);
  }
}

export function destroyWakeWord(): void {
  handle?.destroy();
  handle = null;
}

export function _triggerDetected(): void {
  detectedCallback?.();
}
