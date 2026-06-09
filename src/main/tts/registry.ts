import type { TTSProvider } from './types';
import { log } from '../core/log';

const providers = new Map<string, TTSProvider>();
let active: TTSProvider | null = null;

export function registerTTSProvider(p: TTSProvider): void {
  providers.set(p.name, p);
}

export function setActiveTTSProvider(name: string): void {
  const p = providers.get(name);
  if (!p) throw new Error(`Unknown TTS provider '${name}'. Valid: ${[...providers.keys()].join(', ')}`);
  active = p;
}

export function getActiveTTSProvider(): TTSProvider {
  if (!active) throw new Error('No TTS provider set');
  return active;
}

export async function speak(text: string, opts?: { voice?: string; rate?: number; signal?: AbortSignal; onAudioStart?: () => void }): Promise<void> {
  if (!active) { log.warn('No TTS provider active, skipping speech'); return; }
  if (opts?.signal?.aborted) return;
  try {
    await active.speak(text, opts);
  } catch (e) {
    log.error('TTS speak error:', (e as Error).message);
    // Silent fail — speech is non-critical
  }
}

export function getRegisteredProviders(): string[] {
  return [...providers.keys()];
}

/** Look up a registered provider by name (used to preview a voice without
 *  changing the active provider). */
export function getTTSProvider(name: string): TTSProvider | undefined {
  return providers.get(name);
}
