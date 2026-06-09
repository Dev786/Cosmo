import type { CharacterManifest, Gender } from './types';
import { cosmo } from './characters/cosmo';
import { bulma } from './characters/bulma';
import { luffy } from './characters/luffy';

// The character roster — the single source of truth for who Cosmo can be.
// Add a character: create characters/<id>.ts exporting a CharacterManifest,
// then add it to ORDER below. Everything else (rendering, voice, switching)
// is automatic. A character can use the chibi face, a pre-drawn image, or the
// original ClassicPack (pack: 'classic') — see CharacterManifest.
const ORDER: CharacterManifest[] = [cosmo, bulma, luffy];

const CHARACTERS: Record<string, CharacterManifest> = Object.fromEntries(
  ORDER.map((c) => [c.id, c]),
);

export const DEFAULT_CHARACTER = cosmo.id;

export function getCharacter(id?: string): CharacterManifest {
  return (id && CHARACTERS[id]) || CHARACTERS[DEFAULT_CHARACTER];
}

export function listCharacters(): Array<{ id: string; name: string; gender: Gender }> {
  return ORDER.map((c) => ({ id: c.id, name: c.name, gender: c.gender }));
}

/** Id of the character after `id` in roster order (wraps around). */
export function nextCharacterId(id: string): string {
  const idx = ORDER.findIndex((c) => c.id === id);
  return ORDER[(idx + 1) % ORDER.length]?.id ?? DEFAULT_CHARACTER;
}
