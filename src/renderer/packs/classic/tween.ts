import type { EyeParams } from './recipes';

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpHex(colorA: string, colorB: string, t: number): string {
  const parse = (hex: string): [number, number, number] => {
    const c = hex.replace('#', '');
    const len = c.length === 3 ? 1 : 2;
    return [
      parseInt(c.slice(0, len).padEnd(2, c[0]), 16),
      parseInt(c.slice(len, len * 2).padEnd(2, c[len]), 16),
      parseInt(c.slice(len * 2).padEnd(2, c[len * 2]), 16),
    ];
  };
  try {
    const [ar, ag, ab] = parse(colorA);
    const [br, bg, bb] = parse(colorB);
    const r = Math.round(lerp(ar, br, t));
    const g = Math.round(lerp(ag, bg, t));
    const b = Math.round(lerp(ab, bb, t));
    return `rgb(${r},${g},${b})`;
  } catch {
    return colorB;
  }
}

function cubicEaseInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function lerpParams(from: EyeParams, to: EyeParams, t: number): EyeParams {
  const e = cubicEaseInOut(Math.max(0, Math.min(1, t)));
  return {
    scleraW: lerp(from.scleraW, to.scleraW, e),
    scleraH: lerp(from.scleraH, to.scleraH, e),
    scleraRadius: t < 0.5 ? from.scleraRadius : to.scleraRadius,
    scleraColor: from.scleraColor,
    irisFraction: lerp(from.irisFraction, to.irisFraction, e),
    irisColor: t < 0.5 ? from.irisColor : to.irisColor,
    pupilFraction: lerp(from.pupilFraction, to.pupilFraction, e),
    pupilColor: t < 0.5 ? from.pupilColor : to.pupilColor,
    pupilOffsetX: lerp(from.pupilOffsetX, to.pupilOffsetX, e),
    pupilOffsetY: lerp(from.pupilOffsetY, to.pupilOffsetY, e),
    eyelidTopPct: lerp(from.eyelidTopPct, to.eyelidTopPct, e),
    offsetX: lerp(from.offsetX, to.offsetX, e),
    offsetY: lerp(from.offsetY, to.offsetY, e),
    rotation: lerp(from.rotation, to.rotation, e),
    opacity: lerp(from.opacity, to.opacity, e),
  };
}

export function tweenParams(
  from: EyeParams,
  to: EyeParams,
  durationMs: number,
  onUpdate: (p: EyeParams) => void,
  onComplete: () => void
): () => void {
  let cancelled = false;
  const start = performance.now();

  function frame(now: number) {
    if (cancelled) return;
    const t = Math.min(1, (now - start) / durationMs);
    onUpdate(lerpParams(from, to, t));
    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      onComplete();
    }
  }

  requestAnimationFrame(frame);
  return () => { cancelled = true; };
}
