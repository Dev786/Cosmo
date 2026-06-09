import type { CharacterManifest } from '../types';

// The original cute mascot — Cosmo's glossy animated eyes, blush and little
// mouth. Rendered by the ClassicPack (not the chibi face), so it has no palette
// or silhouette here; it just declares pack: 'classic'. Lives in the same
// roster as the anime characters so switching is uniform.

export const cosmo: CharacterManifest = {
  id: 'cosmo',         // internal id stays 'cosmo' (the classic mascot pack)
  name: 'Cosmo',        // display name — renamed from Cosmo (STT-friendly wake word)
  gender: 'neutral',
  voice: 'af_bella',   // Kokoro "Bella" — Cosmo's default voice (warm, bright)
  pack: 'classic',
};
