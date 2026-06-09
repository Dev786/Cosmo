import type { MoodState } from '../../../shared/types';

export interface EyeParams {
  outerSize: number;      // diameter of the dark outer circle (px)
  innerSize: number;      // diameter of the white inner area (px)
  innerOffsetX: number;   // white area offset from center (negative = left)
  innerOffsetY: number;   // white area offset from center (negative = up)
  outerColor: string;     // dark eye color
  innerColor: string;     // inner white/bright color
  hl1Size: number;        // main highlight dot (px)
  hl1X: string;           // CSS left position of highlight 1
  hl1Y: string;           // CSS top position of highlight 1
  hl2Size: number;        // small secondary highlight (px)
  eyelidPct: number;      // 0..1 — top eyelid coverage fraction
  scaleY: number;         // vertical squish (1 = normal, <1 = squished)
  offsetX: number;        // eye container horizontal offset
  offsetY: number;        // eye container vertical offset
  rotation: number;       // degrees
  opacity: number;
  gap: number;            // gap between the two eyes (px)
}

// Shared defaults
const D: EyeParams = {
  outerSize: 58,
  innerSize: 28,
  innerOffsetX: -3,
  innerOffsetY: -4,
  outerColor: '#1e1e2e',
  innerColor: '#ffffff',
  hl1Size: 10,
  hl1X: '58%',
  hl1Y: '12%',
  hl2Size: 5,
  eyelidPct: 0,
  scaleY: 1,
  offsetX: 0,
  offsetY: 0,
  rotation: 0,
  opacity: 1,
  gap: 24,
};

export const RECIPES: Record<MoodState, EyeParams> = {
  idle: {
    ...D,
    outerSize: 58,
    innerSize: 28,
    innerOffsetX: -3,
    innerOffsetY: -4,
  },

  listening: {
    ...D,
    outerSize: 70,          // eyes pop open — wide awake, engaged
    innerSize: 34,
    innerOffsetX: 0,        // centered on the viewer — looking right at you
    innerOffsetY: -1,       // near-level forward gaze (the listen-drift leans it in)
    hl1Size: 13,            // brighter catch-light = alert/curious
    scaleY: 1.04,
  },

  thinking: {
    ...D,
    outerSize: 56,
    innerSize: 24,
    innerOffsetX: 5,        // gaze shifts right
    innerOffsetY: -6,       // looking up
    hl1X: '65%',
  },

  speaking: {
    ...D,
    outerSize: 58,
    innerSize: 26,
    scaleY: 1.08,           // slightly taller = animated lively feel
  },

  happy: {
    ...D,
    outerSize: 62,
    innerSize: 0,
    scaleY: 0.32,           // squished into happy crescent arc
    outerColor: '#1e1e2e',
    eyelidPct: 0,
    hl1Size: 0,
    hl2Size: 0,
    innerOffsetX: 0,
    innerOffsetY: 0,
    gap: 26,
  },

  bored: {
    ...D,
    outerSize: 58,
    innerSize: 26,
    innerOffsetX: -3,
    innerOffsetY: 4,        // gaze slightly down
    eyelidPct: 0.35,        // half-lidded
    scaleY: 1,
  },

  annoyed: {
    ...D,
    outerSize: 58,
    innerSize: 22,
    innerOffsetX: 0,
    innerOffsetY: 2,
    outerColor: '#2e1e1e',  // hint of red-dark
    eyelidPct: 0.18,
    rotation: 6,            // inner brow tilt implied
    scaleY: 0.88,
  },

  sleeping: {
    ...D,
    outerSize: 58,
    innerSize: 0,
    scaleY: 0.12,           // near-flat closed line
    outerColor: '#2a2a3e',
    hl1Size: 0,
    hl2Size: 0,
    opacity: 0.7,
  },
};
