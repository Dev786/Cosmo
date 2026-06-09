import type { MoodState } from '../../../shared/types';

// ── Shared chibi contract ────────────────────────────────────────────────────
// Every character shares the SAME emotion states and the SAME face geometry.
// A character only supplies a palette + hair/body silhouette + a voice. That
// makes adding a character a tiny file and switching a one-liner.

export interface Palette {
  hair: string; hairDark: string; hairShine: string;
  skin: string; skinShade: string;
  band: string; bandDark: string;
  dress: string; dressDark: string;
  line: string; iris: string; irisDark: string;
  blush: string;
}

export type Gender = 'male' | 'female' | 'neutral';

export interface CharacterManifest {
  readonly id: string;
  readonly name: string;
  readonly gender: Gender;
  readonly voice: string;                 // Kokoro voice id
  /** Which expression pack renders this character. Defaults to 'chibi'.
   *  'classic' = the original animated-eyes mascot face. */
  readonly pack?: 'chibi' | 'classic';

  // ── Two rendering modes — a character uses ONE of these ──────────────────
  // (A) Image mode: a pre-drawn artwork (URL relative to app://bundle/). The
  //     pack shows it with motion + per-mood colour filters + a mood badge.
  //     A flat raster can't blink or lip-sync, so those are skipped.
  readonly image?: string;
  // (B) SVG mode: the shared face geometry rendered from a palette + silhouette.
  //     Fully articulated (blink, lip-sync, every emote). Used when `image` is
  //     absent. All four fields are required together in this mode.
  readonly palette?: Palette;
  /** Hair drawn BEHIND the head. */
  hairBack?(p: Palette): string;
  /** Bangs + accessories (headband, etc.) drawn IN FRONT of the face. */
  hairFront?(p: Palette): string;
  /** Torso / outfit below the head. */
  body?(p: Palette): string;
}

export interface Emote {
  eyes: string;   // variant id in #eyes
  brows: string;  // variant id in #brows
  mouth: string;  // variant id in #mouth
  extra: string;  // variant id in #extra
  blush: number;  // 0..1 opacity
  tilt: number;   // head tilt degrees
}

// The one emotion table every character shares.
export const EMOTES: Record<MoodState, Emote> = {
  idle:      { eyes: 'open',   brows: 'neutral', mouth: 'smile', extra: 'none',    blush: 0.5,  tilt: 0 },
  listening: { eyes: 'open',   brows: 'raised',  mouth: 'small', extra: 'none',    blush: 0.5,  tilt: -4 },
  thinking:  { eyes: 'lookup', brows: 'raised',  mouth: 'small', extra: 'dots',    blush: 0.4,  tilt: 4 },
  speaking:  { eyes: 'open',   brows: 'neutral', mouth: 'talkA', extra: 'none',    blush: 0.5,  tilt: 0 },
  happy:     { eyes: 'happy',  brows: 'flat',    mouth: 'big',   extra: 'sparkle', blush: 0.95, tilt: 0 },
  bored:     { eyes: 'half',   brows: 'flat',    mouth: 'small', extra: 'none',    blush: 0.3,  tilt: -2 },
  annoyed:   { eyes: 'open',   brows: 'angry',   mouth: 'frown', extra: 'sweat',   blush: 0.0,  tilt: 0 },
  sleeping:  { eyes: 'closed', brows: 'flat',    mouth: 'line',  extra: 'zzz',     blush: 0.4,  tilt: 6 },
};

export const CHIBI_VIEWBOX = '0 0 200 260';

// ── Image-mode emotion table ─────────────────────────────────────────────────
// A pre-drawn artwork can't re-articulate its face, so image characters express
// mood through colour grading (CSS filter), head tilt, and a small corner badge.
// Same MoodState keys → switching between SVG and image characters stays seamless.
export interface ImageEmote {
  filter: string;  // CSS filter applied to the artwork
  tilt: number;    // head tilt degrees
  badge: string;   // tiny mood glyph (''= none)
}

export const IMAGE_EMOTES: Record<MoodState, ImageEmote> = {
  idle:      { filter: 'none',                                            tilt: 0,  badge: '' },
  listening: { filter: 'saturate(1.12) brightness(1.02)',                 tilt: -3, badge: '👂' },
  thinking:  { filter: 'saturate(0.92) brightness(0.99)',                 tilt: 3,  badge: '💭' },
  speaking:  { filter: 'saturate(1.08) brightness(1.04)',                 tilt: 0,  badge: '💬' },
  happy:     { filter: 'saturate(1.28) brightness(1.07)',                 tilt: 0,  badge: '✨' },
  bored:     { filter: 'saturate(0.62) brightness(0.95)',                 tilt: -2, badge: '…' },
  annoyed:   { filter: 'saturate(1.25) hue-rotate(-12deg) brightness(0.96)', tilt: 0,  badge: '💢' },
  sleeping:  { filter: 'grayscale(0.5) brightness(0.82)',                 tilt: 5,  badge: '💤' },
};
