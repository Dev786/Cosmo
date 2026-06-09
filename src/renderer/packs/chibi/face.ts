import type { CharacterManifest, Palette } from './types';
import { CHIBI_VIEWBOX } from './types';

// Shared face geometry — the SAME for every character so every chibi reacts
// with the same emotion states. Characters differ only by palette (eye/skin/
// line colours) and the hair/body silhouette they supply.

const v = (name: string, inner: string): string => `<g data-v="${name}" style="display:none">${inner}</g>`;

const L = 76, R = 124, EY = 112;   // eye centres
const MX = 100, MY = 150;          // mouth centre

function openEye(p: Palette, cx: number, cy: number, irisDy = 0): string {
  return `
    <ellipse cx="${cx}" cy="${cy}" rx="13" ry="16.5" fill="#fff" stroke="${p.line}" stroke-width="2.5"/>
    <circle cx="${cx + 2}" cy="${cy + 2 + irisDy}" r="9.5" fill="${p.iris}"/>
    <circle cx="${cx + 2}" cy="${cy + 2 + irisDy}" r="5" fill="${p.irisDark}"/>
    <circle cx="${cx - 2.5}" cy="${cy - 3 + irisDy}" r="3.6" fill="#fff"/>
    <circle cx="${cx + 5}" cy="${cy + 6 + irisDy}" r="1.8" fill="#fff" opacity="0.8"/>`;
}

function eyesLayer(p: Palette): string {
  return [
    v('open', openEye(p, L, EY) + openEye(p, R, EY)),
    v('lookup', openEye(p, L, EY, -5) + openEye(p, R, EY, -5)),
    v('happy',
      `<path d="M${L - 13} ${EY + 2} Q${L} ${EY - 16} ${L + 13} ${EY + 2}" fill="none" stroke="${p.line}" stroke-width="3.5" stroke-linecap="round"/>
       <path d="M${R - 13} ${EY + 2} Q${R} ${EY - 16} ${R + 13} ${EY + 2}" fill="none" stroke="${p.line}" stroke-width="3.5" stroke-linecap="round"/>`),
    v('closed',
      `<path d="M${L - 13} ${EY} Q${L} ${EY + 13} ${L + 13} ${EY}" fill="none" stroke="${p.line}" stroke-width="3.5" stroke-linecap="round"/>
       <path d="M${R - 13} ${EY} Q${R} ${EY + 13} ${R + 13} ${EY}" fill="none" stroke="${p.line}" stroke-width="3.5" stroke-linecap="round"/>`),
    v('half',
      openEye(p, L, EY) + openEye(p, R, EY) +
      `<rect x="${L - 15}" y="${EY - 18}" width="30" height="15" rx="5" fill="${p.skin}"/>
       <rect x="${R - 15}" y="${EY - 18}" width="30" height="15" rx="5" fill="${p.skin}"/>`),
  ].join('');
}

function browsLayer(p: Palette): string {
  return [
    v('neutral',
      `<path d="M${L - 12} ${EY - 24} L${L + 12} ${EY - 27}" stroke="${p.line}" stroke-width="3" stroke-linecap="round" fill="none"/>
       <path d="M${R - 12} ${EY - 27} L${R + 12} ${EY - 24}" stroke="${p.line}" stroke-width="3" stroke-linecap="round" fill="none"/>`),
    v('raised',
      `<path d="M${L - 12} ${EY - 30} Q${L} ${EY - 36} ${L + 12} ${EY - 30}" stroke="${p.line}" stroke-width="3" stroke-linecap="round" fill="none"/>
       <path d="M${R - 12} ${EY - 30} Q${R} ${EY - 36} ${R + 12} ${EY - 30}" stroke="${p.line}" stroke-width="3" stroke-linecap="round" fill="none"/>`),
    v('angry',
      `<path d="M${L - 12} ${EY - 30} L${L + 12} ${EY - 20}" stroke="${p.line}" stroke-width="3.4" stroke-linecap="round" fill="none"/>
       <path d="M${R - 12} ${EY - 20} L${R + 12} ${EY - 30}" stroke="${p.line}" stroke-width="3.4" stroke-linecap="round" fill="none"/>`),
    v('flat',
      `<path d="M${L - 11} ${EY - 25} Q${L} ${EY - 27} ${L + 11} ${EY - 25}" stroke="${p.line}" stroke-width="2.6" stroke-linecap="round" fill="none"/>
       <path d="M${R - 11} ${EY - 25} Q${R} ${EY - 27} ${R + 11} ${EY - 25}" stroke="${p.line}" stroke-width="2.6" stroke-linecap="round" fill="none"/>`),
  ].join('');
}

function mouthLayer(p: Palette): string {
  return [
    v('smile', `<path d="M${MX - 12} ${MY - 4} Q${MX} ${MY + 9} ${MX + 12} ${MY - 4}" fill="none" stroke="${p.line}" stroke-width="3" stroke-linecap="round"/>`),
    v('big', `<path d="M${MX - 14} ${MY - 5} Q${MX} ${MY + 18} ${MX + 14} ${MY - 5} Z" fill="#a83e4a"/><path d="M${MX - 9} ${MY + 6} Q${MX} ${MY + 13} ${MX + 9} ${MY + 6}" fill="#ff7a8a"/>`),
    v('small', `<ellipse cx="${MX}" cy="${MY}" rx="4" ry="3" fill="#a83e4a"/>`),
    v('frown', `<path d="M${MX - 11} ${MY + 5} Q${MX} ${MY - 6} ${MX + 11} ${MY + 5}" fill="none" stroke="${p.line}" stroke-width="3" stroke-linecap="round"/>`),
    v('line', `<line x1="${MX - 9}" y1="${MY}" x2="${MX + 9}" y2="${MY}" stroke="${p.line}" stroke-width="2.6" stroke-linecap="round"/>`),
    v('talkA', `<ellipse cx="${MX}" cy="${MY + 1}" rx="7" ry="9" fill="#a83e4a"/><ellipse cx="${MX}" cy="${MY + 4}" rx="4" ry="4" fill="#ff7a8a"/>`),
    v('talkB', `<path d="M${MX - 11} ${MY - 3} Q${MX} ${MY + 7} ${MX + 11} ${MY - 3}" fill="none" stroke="${p.line}" stroke-width="3" stroke-linecap="round"/>`),
  ].join('');
}

function extraLayer(): string {
  return [
    v('none', ''),
    v('sweat', `<path d="M150 92 q-6 11 0 16 q6 -5 0 -16 Z" fill="#7fd4ff" opacity="0.9"/>`),
    v('zzz', `<text x="146" y="64" font-family="system-ui,sans-serif" font-weight="700" font-size="16" fill="#8aa0c8">z</text>
              <text x="158" y="50" font-family="system-ui,sans-serif" font-weight="700" font-size="13" fill="#8aa0c8">z</text>
              <text x="168" y="40" font-family="system-ui,sans-serif" font-weight="700" font-size="10" fill="#8aa0c8">z</text>`),
    v('sparkle', `<path d="M44 70 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3 Z" fill="#ffe27a"/>
                  <path d="M156 78 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2 Z" fill="#ffe27a"/>`),
    v('dots', `<text x="150" y="92" font-family="system-ui,sans-serif" font-weight="700" font-size="20" fill="#9a8">…</text>`),
  ].join('');
}

function lids(p: Palette): string {
  return `
    <rect data-lid="L" x="${L - 15}" y="${EY - 18}" width="30" height="0" rx="6" fill="${p.skin}"/>
    <rect data-lid="R" x="${R - 15}" y="${EY - 18}" width="30" height="0" rx="6" fill="${p.skin}"/>`;
}

export function buildCharacterSVG(c: CharacterManifest): string {
  const p = c.palette;
  // SVG mode requires a palette + silhouette. Image-mode characters have none —
  // they're rendered by buildImageAvatar instead, so this draws nothing.
  if (!p || !c.hairBack || !c.body || !c.hairFront) return '';
  return `
<svg viewBox="${CHIBI_VIEWBOX}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;overflow:visible;">
  <g data-tilt>
    <g data-breathe>
      ${c.hairBack(p)}
      ${c.body(p)}
      <rect x="90" y="166" width="20" height="18" rx="6" fill="${p.skinShade}"/>
      <circle cx="100" cy="112" r="62" fill="${p.skin}"/>
      <ellipse cx="100" cy="150" rx="40" ry="22" fill="${p.skinShade}" opacity="0.25"/>
      <g data-blush>
        <ellipse cx="58" cy="132" rx="11" ry="6.5" fill="${p.blush}" opacity="0.6"/>
        <ellipse cx="142" cy="132" rx="11" ry="6.5" fill="${p.blush}" opacity="0.6"/>
      </g>
      <g id="eyes">${eyesLayer(p)}</g>
      <g id="brows">${browsLayer(p)}</g>
      <g id="mouth">${mouthLayer(p)}</g>
      <g data-lids>${lids(p)}</g>
      ${c.hairFront(p)}
      <g id="extra">${extraLayer()}</g>
    </g>
  </g>
</svg>`;
}

export const CHIBI_CSS = `
@keyframes chibi-breathe { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-2.5px); } }
[data-breathe] { animation: chibi-breathe 3.4s ease-in-out infinite; transform-box: fill-box; transform-origin: center bottom; }
[data-lid] { transition: height 60ms ease; }

/* Status/timer line (pomodoro countdown, now-playing, searching). A dark pill at
   the bottom-center of the face column — high-contrast so it's legible over the
   near-white panel (white-on-white was the original "can't see the timer" bug),
   and mounted on the UNSCALED column so it renders at full size. */
.cosmo-status {
  position: absolute; bottom: 14px; left: 50%; transform: translateX(-50%);
  max-width: 132px; padding: 3px 10px; border-radius: 12px;
  font: 700 12px ui-monospace, system-ui; letter-spacing: 0.3px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  color: #fff; background: rgba(28,28,40,0.9);
  box-shadow: 0 2px 9px rgba(0,0,0,0.3); pointer-events: none; z-index: 15;
}
`;

// ── Image-mode avatar ────────────────────────────────────────────────────────
// A pre-drawn artwork shown big in the card. Reuses the same data-tilt/
// data-breathe hooks so motion is shared with SVG characters. Mood is applied
// as a CSS filter on the <img>, plus a small corner badge.
export function buildImageAvatar(c: CharacterManifest): string {
  const src = c.image ?? '';
  return `
    <div class="chibi-img-stage" data-tilt>
      <div class="chibi-img-breathe" data-breathe>
        <img class="chibi-img" src="${src}" alt="${c.name}" draggable="false" />
      </div>
      <div class="chibi-img-badge" data-badge></div>
    </div>`;
}

export const CHIBI_IMG_CSS = `
.chibi-img-stage {
  position: relative; width: 100%; height: 100%;
  display: flex; align-items: center; justify-content: center;
  transition: transform 180ms ease;
}
.chibi-img-breathe {
  width: 100%; height: 100%;
  display: flex; align-items: flex-end; justify-content: center;
  animation: chibi-breathe 3.6s ease-in-out infinite;
}
.chibi-img {
  width: 100%; height: 100%;
  object-fit: cover; object-position: center 18%;
  -webkit-user-drag: none; user-select: none; pointer-events: none;
  filter: none; transition: filter 260ms ease;
}
.chibi-img-badge {
  position: absolute; top: 8px; left: 10px;
  font-size: 18px; line-height: 1;
  opacity: 0; transform: scale(0.6); transform-origin: center;
  transition: opacity 200ms ease, transform 200ms ease;
  text-shadow: 0 1px 3px rgba(0,0,0,0.25);
  pointer-events: none;
}
.chibi-img-badge.show { opacity: 1; transform: scale(1); }
@keyframes chibi-img-bob { 0%,100% { transform: translateY(0) scale(1); } 50% { transform: translateY(-3px) scale(1.012); } }
.chibi-img-stage.talking .chibi-img-breathe { animation: chibi-img-bob 320ms ease-in-out infinite; }
/* Thinking: a slow head sway + a pulsing thought badge while waiting on the LLM,
   so the wait reads as active work rather than a freeze. */
@keyframes chibi-img-think { 0%,100% { transform: translateY(0) rotate(0deg); } 25% { transform: translateY(-1px) rotate(-1.6deg); } 75% { transform: translateY(-1px) rotate(1.6deg); } }
@keyframes chibi-think-badge { 0%,100% { opacity: 0.55; transform: scale(0.92); } 50% { opacity: 1; transform: scale(1.12); } }
.chibi-img-stage.thinking .chibi-img-breathe { animation: chibi-img-think 2s ease-in-out infinite; }
.chibi-img-stage.thinking .chibi-img-badge.show { animation: chibi-think-badge 1.3s ease-in-out infinite; }
`;
