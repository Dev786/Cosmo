import type { STTProvider } from './types';

const providers = new Map<string, STTProvider>();
let active: STTProvider | null = null;

export function registerSTT(p: STTProvider): void {
  providers.set(p.name, p);
}

export function setActiveSTT(name: string): void {
  const p = providers.get(name);
  if (!p) throw new Error(`Unknown STT provider '${name}'. Valid: ${[...providers.keys()].join(', ')}`);
  active = p;
}

export function getActiveSTT(): STTProvider {
  if (!active) throw new Error('No STT provider configured');
  return active;
}

export function getRegisteredSTT(): string[] {
  return [...providers.keys()];
}
