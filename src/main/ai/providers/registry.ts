import type { LLMProvider } from './types';
import type { Config } from '../../../shared/types';

const providers = new Map<string, LLMProvider>();

export function registerProvider(p: LLMProvider): void {
  providers.set(p.name, p);
}

export function getProvider(name: string): LLMProvider | undefined {
  return providers.get(name);
}

export function getActiveProvider(config: Config): LLMProvider {
  const name = config.llm.provider;
  const p = providers.get(name);
  if (!p) {
    const valid = [...providers.keys()].join(', ');
    throw new Error(`Unknown LLM provider '${name}'. Valid: ${valid || '(none registered)'}`);
  }
  return p;
}

export function getRegisteredNames(): string[] {
  return [...providers.keys()];
}
