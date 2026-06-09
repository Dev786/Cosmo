import type { ExpressionPack, MoodState, ActivityState, PulseEvent } from '../../../shared/types';
import { EMOTES, IMAGE_EMOTES } from './types';
import type { CharacterManifest } from './types';
import { buildCharacterSVG, buildImageAvatar, CHIBI_CSS, CHIBI_IMG_CSS } from './face';
import { getCharacter } from './registry';

// A chibi anime-style character pack. Two rendering modes share the SAME emotion
// states (see ./types): SVG characters are fully articulated (blink, lip-sync);
// image characters are pre-drawn artwork expressed through motion + colour
// grading + a mood badge. Switching characters = pass a different id.
export class ChibiPack implements ExpressionPack {
  readonly name = 'chibi';

  private character: CharacterManifest;
  private imageMode = false;

  private container: HTMLElement | null = null;
  private reducedMotion = false;

  // SVG-mode refs
  private root: SVGSVGElement | null = null;
  private layers: Record<string, SVGGElement | null> = { eyes: null, brows: null, mouth: null, extra: null };
  private tilt: SVGGElement | null = null;
  private blush: SVGGElement | null = null;
  private lids: SVGRectElement[] = [];

  // Image-mode refs
  private imgStage: HTMLElement | null = null;
  private imgEl: HTMLImageElement | null = null;
  private badgeEl: HTMLElement | null = null;

  private activityEl: HTMLElement | null = null;

  private currentMood: MoodState = 'idle';
  private blinkTimer: ReturnType<typeof setTimeout> | null = null;
  private talkTimer: ReturnType<typeof setInterval> | null = null;
  private activityTimer: ReturnType<typeof setInterval> | null = null;
  private bounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(characterId?: string) {
    this.character = getCharacter(characterId);
    this.imageMode = !!this.character.image;
  }

  init(container: HTMLElement, opts: { reducedMotion: boolean }): void {
    this.container = container;
    this.reducedMotion = opts.reducedMotion;

    if (!document.getElementById('chibi-css')) {
      const style = document.createElement('style');
      style.id = 'chibi-css';
      style.textContent = CHIBI_CSS + CHIBI_IMG_CSS;
      document.head.appendChild(style);
    }

    container.style.cssText = 'position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;height:100%;';

    if (this.imageMode) {
      this.initImage(container);
    } else {
      this.initSvg(container);
    }

    this.applyEmote('idle');
    if (!this.imageMode && !this.reducedMotion) this.startBlink();
  }

  private initImage(container: HTMLElement): void {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;';
    wrap.innerHTML = buildImageAvatar(this.character);
    container.appendChild(wrap);

    this.imgStage = wrap.querySelector('[data-tilt]');
    this.imgEl = wrap.querySelector('.chibi-img');
    this.badgeEl = wrap.querySelector('[data-badge]');

    if (this.reducedMotion) {
      const b = wrap.querySelector('[data-breathe]') as HTMLElement | null;
      if (b) b.style.animation = 'none';
    }
  }

  private initSvg(container: HTMLElement): void {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'width:96%;max-width:210px;display:flex;align-items:center;justify-content:center;';
    wrap.innerHTML = buildCharacterSVG(this.character);
    container.appendChild(wrap);

    this.root = wrap.querySelector('svg');
    this.tilt = this.root?.querySelector('[data-tilt]') ?? null;
    this.blush = this.root?.querySelector('[data-blush]') ?? null;
    for (const k of Object.keys(this.layers)) this.layers[k] = this.root?.querySelector(`#${k}`) ?? null;
    this.lids = Array.from(this.root?.querySelectorAll('[data-lid]') ?? []) as SVGRectElement[];

    if (this.reducedMotion) {
      const b = this.root?.querySelector('[data-breathe]') as SVGGElement | null;
      if (b) b.style.animation = 'none';
    }
  }

  // ── variant toggling (SVG mode) ─────────────────────────────────────────────
  private showVariant(layer: string, name: string): void {
    const g = this.layers[layer];
    if (!g) return;
    for (const child of Array.from(g.children) as SVGElement[]) {
      child.style.display = child.getAttribute('data-v') === name ? '' : 'none';
    }
  }

  private applyEmote(mood: MoodState): void {
    if (this.imageMode) { this.applyImageEmote(mood); return; }
    const e = EMOTES[mood] ?? EMOTES.idle;
    this.showVariant('eyes', e.eyes);
    this.showVariant('brows', e.brows);
    this.showVariant('extra', e.extra);
    if (mood !== 'speaking') this.showVariant('mouth', e.mouth);
    if (this.blush) this.blush.style.opacity = String(e.blush);
    if (this.tilt) this.tilt.setAttribute('transform', `rotate(${e.tilt}, 100, 150)`);
  }

  private applyImageEmote(mood: MoodState): void {
    const e = IMAGE_EMOTES[mood] ?? IMAGE_EMOTES.idle;
    if (this.imgEl) this.imgEl.style.filter = e.filter;
    if (this.imgStage && !this.reducedMotion) this.imgStage.style.transform = `rotate(${e.tilt}deg)`;
    if (this.badgeEl) {
      if (e.badge) {
        this.badgeEl.textContent = e.badge;
        this.badgeEl.classList.add('show');
      } else {
        this.badgeEl.classList.remove('show');
      }
    }
  }

  // ── ExpressionPack ──────────────────────────────────────────────────────────
  setState(state: MoodState): void {
    this.currentMood = state;
    this.applyEmote(state);
    // Image chars get a gentle "thinking" sway + pulsing 💭 while waiting on the
    // LLM, so the wait reads as active work, not a freeze. (SVG chars already show
    // the animated 'dots' + look-up eyes via EMOTES.)
    if (this.imgStage) this.imgStage.classList.toggle('thinking', state === 'thinking' && !this.reducedMotion);
    if (state === 'speaking' && !this.reducedMotion) this.startTalk();
    else this.stopTalk();
  }

  pulse(event: PulseEvent): void {
    switch (event) {
      case 'blink': this.doBlink(); break;
      case 'speakTick': case 'lookAway': case 'lookAround': case 'stretch': case 'peek':
        this.bounce(); break;
      case 'startle': this.popScale(1.08, 220); break;
      case 'dizzy': this.wobble(); break;
      case 'giggle': this.flashBadge('❤', 800); this.pulseFilter('saturate(1.3) brightness(1.08)', 700); this.bounce(); break;
      case 'heart': this.flashBadge('❤', 900); break;
      case 'yawn': case 'doze': this.flashBadge('💤', 1200); this.pulseFilter('brightness(0.9)', 1100); break;
      default: break; // sound* pulses have no visual on the chibi
    }
  }

  // ── cursor-follow gaze (image mode leans; a flat image can't move its eyes) ──
  setGaze(dx: number, _dy: number): void {
    if (this.reducedMotion || !this.imageMode || !this.imgStage) return;
    const base = IMAGE_EMOTES[this.currentMood]?.tilt ?? 0;
    const lean = Math.max(-1, Math.min(1, dx)) * 3;
    this.imgStage.style.transform = `rotate(${base + lean}deg)`;
  }

  // ── image-mode flourish helpers ─────────────────────────────────────────────
  private popScale(scale: number, ms: number): void {
    if (this.reducedMotion || !this.imgStage) return;
    const base = IMAGE_EMOTES[this.currentMood]?.tilt ?? 0;
    this.imgStage.style.transform = `rotate(${base}deg) scale(${scale})`;
    setTimeout(() => { if (this.imgStage) this.imgStage.style.transform = `rotate(${base}deg)`; }, ms);
  }

  private wobble(): void {
    if (this.reducedMotion || !this.imgStage) return;
    const stage = this.imgStage;
    const base = IMAGE_EMOTES[this.currentMood]?.tilt ?? 0;
    let t = 0;
    const id = setInterval(() => {
      stage.style.transform = `rotate(${base + Math.sin(t) * 7}deg)`;
      t += 0.8;
      if (t > 8) { clearInterval(id); stage.style.transform = `rotate(${base}deg)`; }
    }, 55);
  }

  private flashBadge(glyph: string, ms: number): void {
    if (!this.badgeEl) return;
    this.badgeEl.textContent = glyph;
    this.badgeEl.classList.add('show');
    setTimeout(() => {
      if (!this.badgeEl) return;
      const e = IMAGE_EMOTES[this.currentMood] ?? IMAGE_EMOTES.idle;
      if (e.badge) { this.badgeEl.textContent = e.badge; this.badgeEl.classList.add('show'); }
      else this.badgeEl.classList.remove('show');
    }, ms);
  }

  private pulseFilter(filter: string, ms: number): void {
    if (!this.imgEl) return;
    this.imgEl.style.filter = filter;
    setTimeout(() => { if (this.imgEl) this.imgEl.style.filter = (IMAGE_EMOTES[this.currentMood] ?? IMAGE_EMOTES.idle).filter; }, ms);
  }

  setIntensity(level: number): void {
    if (this.imageMode) return; // no blush layer on a flat artwork
    if (this.blush) this.blush.style.opacity = String(Math.max(0, 0.5 - level * 0.5));
    if (level > 0.6 && this.currentMood !== 'annoyed') this.showVariant('extra', 'sweat');
  }

  setActivity(activity: ActivityState | null): void {
    this.clearActivity();
    if (!activity || !this.container) return;
    const el = document.createElement('div');
    // Subtle by default (keeps the face uncluttered); the whole chip lights up into a
    // high-contrast pill on hover — see `.cosmo-status` in face.ts. The 0.97 panel
    // already makes the resting text legible at a glance; hover makes it pop.
    el.className = 'cosmo-status';
    this.activityEl = el;
    // Mount on the UNSCALED face column, not the scale(0.58) avatar — else the pill
    // renders at ~6px. Falls back to the container if the host isn't found.
    const host = (this.container.closest('#cosmo-col') as HTMLElement | null) ?? this.container;
    host.appendChild(el);
    if (activity.type === 'timer') {
      let rem = activity.remainingSec;
      const fmt = (s: number) => `${activity.label} ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      const txt = document.createElement('span');
      txt.textContent = fmt(rem);
      // Stop control — emits an intent the renderer wires to the pomodoro.stop tool.
      const stop = document.createElement('span');
      stop.textContent = '✕';
      stop.title = 'End focus session';
      stop.style.cssText = 'margin-left:6px;cursor:pointer;pointer-events:auto;opacity:0.8;font-weight:700;';
      stop.addEventListener('click', (e) => { e.stopPropagation(); document.dispatchEvent(new CustomEvent('cosmo:timer-stop')); });
      el.append(txt, stop);
      this.activityTimer = setInterval(() => { rem--; txt.textContent = fmt(Math.max(0, rem)); if (rem <= 0) this.clearActivity(); }, 1000);
    } else if (activity.type === 'music') {
      el.textContent = `♪ ${activity.nowPlaying.track}`.slice(0, 26);
    } else if (activity.type === 'searching') {
      el.textContent = '🔍 searching…';
    }
  }

  dispose(): void {
    if (this.blinkTimer) clearTimeout(this.blinkTimer);
    if (this.bounceTimer) clearTimeout(this.bounceTimer);
    this.stopTalk();
    this.clearActivity();
    if (this.container) this.container.innerHTML = '';
    this.root = null;
    this.imgStage = this.imgEl = this.badgeEl = null;
  }

  // ── animations ──────────────────────────────────────────────────────────────
  private startBlink(): void {
    const next = () => {
      const delay = 3200 + Math.random() * 3200;
      this.blinkTimer = setTimeout(() => { this.doBlink(); next(); }, delay);
    };
    next();
  }

  private doBlink(): void {
    if (this.imageMode) return; // a flat raster can't blink
    if (this.currentMood === 'sleeping' || this.currentMood === 'happy') return; // already shut
    for (const lid of this.lids) lid.style.height = '36';
    setTimeout(() => { for (const lid of this.lids) lid.style.height = '0'; }, 105);
  }

  private startTalk(): void {
    this.stopTalk();
    if (this.imageMode) { this.imgStage?.classList.add('talking'); return; }
    let open = true;
    this.talkTimer = setInterval(() => {
      this.showVariant('mouth', open ? 'talkA' : 'talkB');
      open = !open;
    }, 130);
  }

  private stopTalk(): void {
    if (this.talkTimer) { clearInterval(this.talkTimer); this.talkTimer = null; }
    if (this.imageMode) { this.imgStage?.classList.remove('talking'); return; }
    if (this.currentMood !== 'speaking') this.showVariant('mouth', (EMOTES[this.currentMood] ?? EMOTES.idle).mouth);
  }

  private bounce(): void {
    if (this.reducedMotion) return;
    if (this.imageMode) {
      if (!this.imgStage) return;
      const base = IMAGE_EMOTES[this.currentMood]?.tilt ?? 0;
      this.imgStage.style.transform = `rotate(${base}deg) translateY(2px)`;
      if (this.bounceTimer) clearTimeout(this.bounceTimer);
      this.bounceTimer = setTimeout(() => { if (this.imgStage) this.imgStage.style.transform = `rotate(${base}deg)`; }, 120);
      return;
    }
    if (!this.tilt) return;
    const base = EMOTES[this.currentMood]?.tilt ?? 0;
    this.tilt.setAttribute('transform', `rotate(${base}, 100, 150) translate(0, 1.5)`);
    setTimeout(() => { this.tilt?.setAttribute('transform', `rotate(${base}, 100, 150)`); }, 110);
  }

  private clearActivity(): void {
    if (this.activityTimer) { clearInterval(this.activityTimer); this.activityTimer = null; }
    if (this.activityEl) { this.activityEl.remove(); this.activityEl = null; }
  }
}
