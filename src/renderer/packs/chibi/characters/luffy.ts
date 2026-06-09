import type { CharacterManifest } from '../types';

// Image-mode character: shows a user-supplied chibi artwork. No SVG silhouette
// needed — image mode expresses mood through motion + colour grading + a badge.
// An energetic young-male voice from Kokoro.

export const luffy: CharacterManifest = {
  id: 'luffy',
  name: 'Luffy',
  gender: 'male',
  voice: 'am_adam',
  image: 'characters/luffy.png',   // served from app://bundle/characters/luffy.png
};
