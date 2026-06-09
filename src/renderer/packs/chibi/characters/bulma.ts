import type { CharacterManifest, Palette } from '../types';

// Image-mode character: shows a user-supplied chibi artwork. The SVG palette +
// silhouette below remain as a fallback for SVG mode (used only if `image` is
// removed). To add a character, copy this file, swap the `image`/voice, and
// register it in ../registry.ts.

export const bulma: CharacterManifest = {
  id: 'bulma',
  name: 'Bulma',
  gender: 'female',
  voice: 'af_bella',
  image: 'characters/bulma.png',   // served from app://bundle/characters/bulma.png
  palette: {
    hair: '#3fc6cf', hairDark: '#2aa6b0', hairShine: '#9bf0f4',
    skin: '#ffe1c4', skinShade: '#f3c49d',
    band: '#ff5d7e', bandDark: '#e23e62',
    dress: '#ff8fb0', dressDark: '#ef6f96',
    line: '#4a342c', iris: '#2f9bd6', irisDark: '#16263a',
    blush: '#ff8f8f',
  },

  hairBack(p: Palette): string {
    return `<path d="M100 24 C50 24 36 70 38 116 C40 158 58 196 100 196 C142 196 160 158 162 116 C164 70 150 24 100 24 Z" fill="${p.hairDark}"/>`;
  },

  body(p: Palette): string {
    return `
      <path d="M78 176 L122 176 L150 244 Q100 256 50 244 Z" fill="${p.dress}"/>
      <path d="M78 176 L122 176 L128 196 Q100 204 72 196 Z" fill="${p.dressDark}"/>`;
  },

  hairFront(p: Palette): string {
    return `
      <path d="M40 104 C40 56 64 28 100 28 C136 28 160 56 160 104 C150 78 132 64 116 70 C120 84 112 92 100 92 C88 92 80 84 84 70 C66 64 50 80 40 104 Z" fill="${p.hair}"/>
      <path d="M84 70 C92 74 108 74 116 70 C120 80 112 88 100 88 C88 88 80 80 84 70 Z" fill="${p.hairShine}" opacity="0.5"/>
      <path d="M40 104 C34 130 36 158 46 176 C40 150 44 122 52 108 Z" fill="${p.hair}"/>
      <path d="M160 104 C166 130 164 158 154 176 C160 150 156 122 148 108 Z" fill="${p.hair}"/>
      <path d="M44 86 Q100 66 156 86 L154 96 Q100 78 46 96 Z" fill="${p.band}"/>
      <path d="M150 78 l14 -8 4 14 -12 6 Z" fill="${p.bandDark}"/>`;
  },
};
