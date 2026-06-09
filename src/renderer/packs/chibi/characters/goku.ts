import type { CharacterManifest, Palette } from '../types';

// Original stylized chibi: a spiky-haired shonen-fighter archetype in an orange
// martial-arts gi with a blue belt. Hand-authored vector shapes (not derived
// from any external/official artwork) — an original "male fighter" design that
// you can rename to taste locally. Demonstrates a second character on the same
// shared emotion system.

export const goku: CharacterManifest = {
  id: 'goku',
  name: 'Goku',
  gender: 'male',
  voice: 'am_michael',
  palette: {
    hair: '#23232e', hairDark: '#111119', hairShine: '#46465a',
    skin: '#ffd7ab', skinShade: '#e8b486',
    band: '#2f63c8', bandDark: '#1d4391',
    dress: '#f59334', dressDark: '#cf6f1c',
    line: '#3a2a20', iris: '#5b3a26', irisDark: '#160d07',
    blush: '#ff9a8a',
  },

  hairBack(p: Palette): string {
    return `
      <path d="M100 28 C58 28 42 70 44 120 C46 156 62 190 100 190 C138 190 154 156 156 120 C158 70 142 28 100 28 Z" fill="${p.hairDark}"/>
      <path d="M44 112 L28 96 L48 82 Z" fill="${p.hairDark}"/>
      <path d="M156 112 L172 96 L152 82 Z" fill="${p.hairDark}"/>`;
  },

  body(p: Palette): string {
    return `
      <path d="M76 176 L124 176 L146 246 Q100 256 54 246 Z" fill="${p.dress}"/>
      <path d="M86 176 L100 198 L114 176 Z" fill="${p.dressDark}"/>
      <rect x="60" y="206" width="80" height="13" rx="2" fill="${p.band}"/>
      <rect x="60" y="206" width="80" height="4" rx="2" fill="${p.bandDark}" opacity="0.6"/>`;
  },

  hairFront(p: Palette): string {
    return `
      <path d="M62 40 L70 6 L84 38 Z" fill="${p.hair}"/>
      <path d="M88 34 L100 2 L114 38 Z" fill="${p.hair}"/>
      <path d="M118 38 L132 8 L140 44 Z" fill="${p.hair}"/>
      <path d="M38 90 L48 66 L58 86 L70 58 L82 84 L100 54 L118 84 L130 58 L142 86 L152 66 L162 90 C160 48 132 30 100 30 C68 30 40 48 38 90 Z" fill="${p.hair}"/>
      <path d="M70 58 L82 84 L100 54 L118 84 L130 58 C120 70 108 72 100 72 C92 72 80 70 70 58 Z" fill="${p.hairShine}" opacity="0.28"/>`;
  },
};
