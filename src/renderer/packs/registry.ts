import type { ExpressionPack } from '../../shared/types';
import { getCharacter } from './chibi/registry';

let _activePackName = '';
let _activePack: ExpressionPack | null = null;

// Load the expression pack for a character. The character's manifest decides
// which pack renders it: pack:'classic' → the original animated-eyes mascot,
// otherwise the chibi pack (image- or SVG-based). When no characterId is given,
// `name` selects a pack directly (legacy path).
export async function loadPack(
  name: string,
  container: HTMLElement,
  reducedMotion: boolean,
  characterId?: string,
): Promise<ExpressionPack> {
  let pack: ExpressionPack;
  let resolvedName = name;

  // Character-first: a roster character knows its own pack.
  if (characterId) {
    const char = getCharacter(characterId);
    resolvedName = char.pack ?? 'chibi';
  }

  try {
    if (resolvedName === 'classic') {
      const mod = await import('./classic/index');
      pack = new mod.ClassicPack();
    } else if (resolvedName === 'chibi') {
      const mod = await import('./chibi/index');
      pack = new mod.ChibiPack(characterId);
    } else {
      console.warn(`Unknown expression pack "${resolvedName}", falling back to classic`);
      const mod = await import('./classic/index');
      pack = new mod.ClassicPack();
    }
  } catch (e) {
    console.warn(`Failed to load pack "${resolvedName}", falling back to classic:`, e);
    const mod = await import('./classic/index');
    pack = new mod.ClassicPack();
  }

  if (_activePack) {
    _activePack.dispose();
    _activePack = null;
  }

  pack.init(container, { reducedMotion });
  _activePack = pack;
  _activePackName = resolvedName;
  return pack;
}

export function getActivePack(): ExpressionPack | null {
  return _activePack;
}

export function getActivePackName(): string {
  return _activePackName;
}
