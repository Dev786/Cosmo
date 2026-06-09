import type { ExpressionPack, MoodState, ActivityState, PulseEvent } from '../../../shared/types';
import { RECIPES, type EyeParams } from './recipes';
import { lerp } from './tween';

interface EyeEl {
  wrap: HTMLElement;    // outer dark circle
  inner: HTMLElement;   // white inner area
  hl1: HTMLElement;     // main highlight
  hl2: HTMLElement;     // small secondary highlight
  lid: HTMLElement;     // top eyelid overlay
}

export class ClassicPack implements ExpressionPack {
  readonly name = 'classic';

  private container: HTMLElement | null = null;
  private reducedMotion = false;
  private left: EyeEl | null = null;
  private right: EyeEl | null = null;
  private blushL: HTMLElement | null = null;
  private blushR: HTMLElement | null = null;
  private mouth: HTMLElement | null = null;
  private eyeRow: HTMLElement | null = null;
  private activityWrap: HTMLElement | null = null;
  private eqBars: HTMLElement[] = [];
  private eqInterval: ReturnType<typeof setInterval> | null = null;
  private blinkTimer: ReturnType<typeof setTimeout> | null = null;
  private gazeTimer: ReturnType<typeof setTimeout> | null = null;
  private rafId: number | null = null;
  private currentParams: EyeParams = { ...RECIPES.idle };
  private targetParams: EyeParams = { ...RECIPES.idle };
  private tweenStart = 0;
  private tweenDuration = 0;
  private tweening = false;
  private currentMood: MoodState = 'idle';
  private lastGazeAt = 0;
  private dizzyTimer: ReturnType<typeof setInterval> | null = null;
  private talkTimer: ReturnType<typeof setInterval> | null = null;
  private zzzTimer: ReturnType<typeof setInterval> | null = null;
  private zzzBig = false;
  private listenWaves: HTMLElement | null = null;
  private thinkDots: HTMLElement | null = null;
  private thinkTimer: ReturnType<typeof setInterval> | null = null;
  private thinkPhase = 0;
  private listenTimer: ReturnType<typeof setInterval> | null = null;
  private listenPhase = 0;

  // ── init ─────────────────────────────────────────────────────────────────

  init(container: HTMLElement, opts: { reducedMotion: boolean }): void {
    this.container = container;
    this.reducedMotion = opts.reducedMotion;
    container.style.cssText = 'position:relative;display:flex;flex-direction:column;align-items:center;';

    // Eye row (position:relative so the cheek blush can anchor to the eyes themselves)
    this.eyeRow = document.createElement('div');
    this.eyeRow.style.cssText = 'position:relative;display:flex;align-items:center;justify-content:center;';
    this.left = this.mkEye();
    this.right = this.mkEye();
    this.eyeRow.appendChild(this.left.wrap);
    this.eyeRow.appendChild(this.right.wrap);

    // Cheek blush — soft pink hugging the lower-outer of each eye, peeking just
    // below it. Anchored to the eye row (not the whole face) so it sits on the
    // cheeks across every mood instead of drifting down toward the mouth.
    this.blushL = this.mkBlush();
    this.blushR = this.mkBlush();
    this.blushL.style.cssText += 'position:absolute;bottom:-5px;left:6px;pointer-events:none;';
    this.blushR.style.cssText += 'position:absolute;bottom:-5px;right:6px;pointer-events:none;';
    this.eyeRow.appendChild(this.blushL);
    this.eyeRow.appendChild(this.blushR);

    container.appendChild(this.eyeRow);

    // Cute small mouth
    this.mouth = document.createElement('div');
    this.mouth.style.cssText = `
      margin-top:6px;
      width:20px;height:8px;
      border-bottom:3px solid #2d2d3e;
      border-left:3px solid #2d2d3e;
      border-right:3px solid #2d2d3e;
      border-radius:0 0 12px 12px;
      opacity:0.85;
      transition:all 0.25s ease;
    `;
    container.appendChild(this.mouth);

    this.applyParams(this.currentParams, true);
    if (!opts.reducedMotion) {
      this.startBlink();
      this.startGaze();
      this.startRaf();
    }
  }

  // ── DOM factories ─────────────────────────────────────────────────────────

  private mkEye(): EyeEl {
    const wrap = document.createElement('div');
    wrap.style.cssText = `
      position:relative;
      border-radius:50%;
      background:#1e1e2e;
      flex-shrink:0;
      overflow:hidden;
      filter:drop-shadow(0 3px 8px rgba(0,0,0,0.35));
      transition:transform 0.08s ease;
    `;

    // White inner area
    const inner = document.createElement('div');
    inner.style.cssText = `
      position:absolute;
      border-radius:50%;
      background:#ffffff;
      pointer-events:none;
    `;

    // Subtle shadow crescent at bottom of inner (makes it look glossy)
    const shadow = document.createElement('div');
    shadow.style.cssText = `
      position:absolute;
      width:100%;height:50%;
      bottom:0;left:0;
      background:radial-gradient(ellipse at bottom, rgba(0,0,0,0.18) 0%, transparent 70%);
      pointer-events:none;
      z-index:2;
    `;

    // Main highlight (large oval, top-right of dark area)
    const hl1 = document.createElement('div');
    hl1.style.cssText = `
      position:absolute;
      border-radius:50%;
      background:rgba(255,255,255,0.9);
      pointer-events:none;
      z-index:5;
    `;

    // Secondary small highlight dot
    const hl2 = document.createElement('div');
    hl2.style.cssText = `
      position:absolute;
      border-radius:50%;
      background:rgba(255,255,255,0.75);
      pointer-events:none;
      z-index:5;
    `;

    // Eyelid overlay (descends from top)
    const lid = document.createElement('div');
    lid.style.cssText = `
      position:absolute;
      top:0;left:0;right:0;
      background:#1e1e2e;
      z-index:10;
      height:0;
    `;

    wrap.appendChild(inner);
    wrap.appendChild(shadow);
    wrap.appendChild(hl1);
    wrap.appendChild(hl2);
    wrap.appendChild(lid);
    return { wrap, inner, hl1, hl2, lid };
  }

  private mkBlush(): HTMLElement {
    const el = document.createElement('div');
    el.style.cssText = `
      width:28px;height:11px;
      border-radius:50%;
      background:rgba(255,160,160,0.55);
      transition:opacity 0.4s ease;
      opacity:0.6;
    `;
    return el;
  }

  // ── applyParams ───────────────────────────────────────────────────────────

  private applyParams(p: EyeParams, immediate = false): void {
    this.currentParams = p;
    if (this.eyeRow) {
      this.eyeRow.style.gap = `${p.gap}px`;
    }

    for (const eye of [this.left, this.right]) {
      if (!eye) continue;

      eye.wrap.style.width = `${p.outerSize}px`;
      eye.wrap.style.height = `${p.outerSize}px`;
      eye.wrap.style.background = p.outerColor;
      eye.wrap.style.opacity = String(p.opacity);
      eye.wrap.style.transform = `scaleY(${p.scaleY}) rotate(${p.rotation}deg)`;
      if (immediate) eye.wrap.style.transition = 'none';
      else eye.wrap.style.transition = '';

      // Inner white circle
      if (p.innerSize > 0) {
        eye.inner.style.display = 'block';
        eye.inner.style.width = `${p.innerSize}px`;
        eye.inner.style.height = `${p.innerSize}px`;
        // Center + offset
        const cx = (p.outerSize - p.innerSize) / 2 + p.innerOffsetX;
        const cy = (p.outerSize - p.innerSize) / 2 + p.innerOffsetY;
        eye.inner.style.left = `${cx}px`;
        eye.inner.style.top = `${cy}px`;
      } else {
        eye.inner.style.display = 'none';
      }

      // Main highlight
      if (p.hl1Size > 0) {
        eye.hl1.style.display = 'block';
        eye.hl1.style.width = `${p.hl1Size}px`;
        eye.hl1.style.height = `${p.hl1Size}px`;
        eye.hl1.style.left = p.hl1X;
        eye.hl1.style.top = p.hl1Y;
      } else {
        eye.hl1.style.display = 'none';
      }

      // Secondary highlight (always bottom-right of hl1)
      if (p.hl2Size > 0) {
        eye.hl2.style.display = 'block';
        eye.hl2.style.width = `${p.hl2Size}px`;
        eye.hl2.style.height = `${p.hl2Size}px`;
        eye.hl2.style.left = `calc(${p.hl1X} + ${p.hl1Size - 2}px)`;
        eye.hl2.style.top = `calc(${p.hl1Y} + ${p.hl1Size - 2}px)`;
      } else {
        eye.hl2.style.display = 'none';
      }

      // Eyelid
      eye.lid.style.height = `${p.outerSize * p.eyelidPct}px`;
    }

    // Mouth expression per mood
    if (this.mouth) {
      this.updateMouth(this.currentMood);
    }

    // Blush
    if (this.blushL && this.blushR) {
      const op = this.currentMood === 'happy' ? '0.85' : this.currentMood === 'annoyed' ? '0' : '0.6';
      this.blushL.style.opacity = op;
      this.blushR.style.opacity = op;
    }
  }

  private updateMouth(mood: MoodState): void {
    if (!this.mouth) return;
    const s = this.mouth.style;
    if (mood === 'happy') {
      s.width = '24px'; s.height = '10px';
      s.borderBottom = '3px solid #1e1e2e';
      s.borderLeft = '3px solid #1e1e2e';
      s.borderRight = '3px solid #1e1e2e';
      s.borderTop = 'none';
      s.borderRadius = '0 0 14px 14px';
      s.opacity = '0.8';
    } else if (mood === 'annoyed') {
      s.width = '18px'; s.height = '6px';
      s.borderTop = '3px solid #1e1e2e';
      s.borderLeft = '3px solid #1e1e2e';
      s.borderRight = '3px solid #1e1e2e';
      s.borderBottom = 'none';
      s.borderRadius = '10px 10px 0 0';
      s.opacity = '0.7';
    } else if (mood === 'sleeping' || mood === 'bored') {
      s.width = '14px'; s.height = '4px';
      s.borderBottom = '2px solid #1e1e2e';
      s.borderLeft = 'none';
      s.borderRight = 'none';
      s.borderTop = 'none';
      s.borderRadius = '0';
      s.opacity = '0.5';
    } else {
      s.width = '20px'; s.height = '8px';
      s.borderBottom = '3px solid #1e1e2e';
      s.borderLeft = '3px solid #1e1e2e';
      s.borderRight = '3px solid #1e1e2e';
      s.borderTop = 'none';
      s.borderRadius = '0 0 12px 12px';
      s.opacity = '0.7';
    }
  }

  // ── RAF tween loop ────────────────────────────────────────────────────────

  private startRaf(): void {
    const tick = (now: number) => {
      if (this.tweening) {
        const t = Math.min(1, (now - this.tweenStart) / this.tweenDuration);
        const e = t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2; // cubic ease in-out
        const p = this.lerpParams(this.currentParams, this.targetParams, e);
        this.applyParams(p);
        if (t >= 1) {
          this.tweening = false;
          this.applyParams(this.targetParams);
        }
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private lerpParams(a: EyeParams, b: EyeParams, t: number): EyeParams {
    return {
      outerSize: lerp(a.outerSize, b.outerSize, t),
      innerSize: lerp(a.innerSize, b.innerSize, t),
      innerOffsetX: lerp(a.innerOffsetX, b.innerOffsetX, t),
      innerOffsetY: lerp(a.innerOffsetY, b.innerOffsetY, t),
      outerColor: t < 0.5 ? a.outerColor : b.outerColor,
      innerColor: a.innerColor,
      hl1Size: lerp(a.hl1Size, b.hl1Size, t),
      hl1X: a.hl1X,
      hl1Y: a.hl1Y,
      hl2Size: lerp(a.hl2Size, b.hl2Size, t),
      eyelidPct: lerp(a.eyelidPct, b.eyelidPct, t),
      scaleY: lerp(a.scaleY, b.scaleY, t),
      offsetX: lerp(a.offsetX, b.offsetX, t),
      offsetY: lerp(a.offsetY, b.offsetY, t),
      rotation: lerp(a.rotation, b.rotation, t),
      opacity: lerp(a.opacity, b.opacity, t),
      gap: lerp(a.gap, b.gap, t),
    };
  }

  // ── setState ──────────────────────────────────────────────────────────────

  setState(state: MoodState): void {
    this.currentMood = state;
    this.targetParams = { ...RECIPES[state] };
    if (this.reducedMotion) {
      this.applyParams(this.targetParams, true);
      return;
    }
    this.tweenStart = performance.now();
    this.tweenDuration = 280;
    this.tweening = true;
    // Blush + mouth update immediately
    this.updateMouth(state);
    if (this.blushL && this.blushR) {
      const op = state === 'happy' ? '0.85' : state === 'annoyed' ? '0' : '0.6';
      this.blushL.style.opacity = op;
      this.blushR.style.opacity = op;
    }
    // Lip-sync-ish talking animation while speaking.
    if (state === 'speaking') this.startTalk(); else this.stopTalk();
    // Drifting z Z z Z sleep bubbles while sleeping.
    if (state === 'sleeping') this.startZzz(); else this.stopZzz();
    // Curious head-tilt + sound-wave arcs while actively listening to a command,
    // plus a gentle gaze lean toward the viewer ("I'm looking right at you").
    if (state === 'listening') { this.startListenAnim(); this.startListenDrift(); }
    else { this.stopListenAnim(); this.stopListenDrift(); }
    // Pulsing "• • •" + a slow side-to-side gaze drift while thinking (mic off →
    // reply). Both stop the instant he leaves the thinking state.
    if (state === 'thinking') { this.startThinkAnim(); this.startThinkDrift(); }
    else { this.stopThinkAnim(); this.stopThinkDrift(); }
  }

  // ── listening: curious head-tilt + sound waves ───────────────────────────
  // While Cosmo is in the wake → command listen window, he tilts his whole face
  // ~8° (puppy "hmm?") and three ')' arcs ripple outward from his ear side, so
  // it's obvious he's hearing you. Pure CSS loop; cleared the moment he leaves
  // the listening state (answers, times out, or is interrupted).
  private ensureListenCss(): void {
    if (document.getElementById('bk-listen-css')) return;
    const s = document.createElement('style'); s.id = 'bk-listen-css';
    s.textContent = '@keyframes bk-wave{0%{opacity:0;transform:translateX(-3px) scale(0.55)}35%{opacity:0.95}100%{opacity:0;transform:translateX(11px) scale(1.05)}}';
    document.head.appendChild(s);
  }

  private startListenAnim(): void {
    if (this.reducedMotion || !this.container) return;
    this.ensureListenCss();
    // curious head-tilt
    this.container.style.transition = 'transform 260ms ease';
    this.container.style.transform = 'rotate(-8deg)';
    // sound-wave arcs emanating from his right
    if (!this.listenWaves) {
      const w = document.createElement('div');
      w.style.cssText = 'position:absolute;right:-24px;top:50%;transform:translateY(-50%);display:flex;align-items:center;gap:2px;pointer-events:none;z-index:18;';
      for (let i = 0; i < 3; i++) {
        const arc = document.createElement('div');
        arc.textContent = ')';
        arc.style.cssText = `font:800 ${13 + i * 3}px system-ui;color:#9bb0d6;line-height:1;animation:bk-wave 1.3s ease-out ${i * 0.16}s infinite;`;
        w.appendChild(arc);
      }
      this.listenWaves = w;
    }
    if (!this.listenWaves.parentElement) this.container.appendChild(this.listenWaves);
    this.listenWaves.style.display = 'flex';
  }

  private stopListenAnim(): void {
    if (this.container) this.container.style.transform = '';
    if (this.listenWaves) this.listenWaves.style.display = 'none';
  }

  // While listening, the gaze stays centered on the viewer and gently bobs
  // down/forward — leaning in to listen to you. (The avatar sits above you, so
  // "toward you" is centered-X + slightly-down-Y.) Owns the gaze for the duration,
  // so the cursor-follow and idle wander are paused (see setGaze / startGaze).
  private startListenDrift(): void {
    if (this.reducedMotion) return;
    this.stopListenDrift();
    this.listenPhase = 0;
    this.listenTimer = setInterval(() => {
      if (this.currentMood !== 'listening') return;
      const leanIn = this.listenPhase % 2 === 0; // toward you ↔ settle
      this.listenPhase++;
      this.tweenTo({ ...RECIPES.listening, innerOffsetX: 0, innerOffsetY: leanIn ? 4 : -1 }, 1100);
    }, 1400);
  }

  private stopListenDrift(): void {
    if (this.listenTimer) { clearInterval(this.listenTimer); this.listenTimer = null; }
  }

  // ── thinking: pulsing dots + drifting gaze ───────────────────────────────
  // While Cosmo is working out a reply (mic off until he speaks), three dots above
  // his eyes pulse in sequence and his gaze slowly sways up-left ↔ up-right, the
  // universal "hmm, let me think" cue. Both are pure renderer loops, cleared the
  // moment he leaves the thinking state (answers, errors, or is interrupted).
  private ensureThinkCss(): void {
    if (document.getElementById('bk-think-css')) return;
    const s = document.createElement('style'); s.id = 'bk-think-css';
    s.textContent = '@keyframes bk-think{0%,100%{opacity:0.25;transform:translateY(1px)}50%{opacity:1;transform:translateY(-2px)}}';
    document.head.appendChild(s);
  }

  private startThinkAnim(): void {
    if (this.reducedMotion || !this.container) return;
    this.ensureThinkCss();
    if (!this.thinkDots) {
      const d = document.createElement('div');
      d.style.cssText = 'position:absolute;top:-16px;left:50%;transform:translateX(-50%);display:flex;gap:5px;pointer-events:none;z-index:18;';
      for (let i = 0; i < 3; i++) {
        const dot = document.createElement('div');
        dot.style.cssText = `width:6px;height:6px;border-radius:50%;background:#9bb0d6;animation:bk-think 1.4s ease-in-out ${i * 0.22}s infinite;`;
        d.appendChild(dot);
      }
      this.thinkDots = d;
    }
    if (!this.thinkDots.parentElement) this.container.appendChild(this.thinkDots);
    this.thinkDots.style.display = 'flex';
  }

  private stopThinkAnim(): void {
    if (this.thinkDots) this.thinkDots.style.display = 'none';
  }

  private startThinkDrift(): void {
    if (this.reducedMotion) return;
    this.stopThinkDrift();
    this.thinkPhase = 0;
    // First sway is one interval in, so the eyes settle into the thinking pose
    // before they start drifting. Stays up (innerOffsetY from the recipe), only X moves.
    this.thinkTimer = setInterval(() => {
      if (this.currentMood !== 'thinking') return;
      const base = RECIPES.thinking;
      const dx = this.thinkPhase % 2 === 0 ? -11 : 4; // up-left ↔ up-right
      this.thinkPhase++;
      this.tweenTo({ ...base, innerOffsetX: base.innerOffsetX + dx }, 1000);
    }, 1300);
  }

  private stopThinkDrift(): void {
    if (this.thinkTimer) { clearInterval(this.thinkTimer); this.thinkTimer = null; }
  }

  // ── sleep z Z z Z bubbles ────────────────────────────────────────────────
  // A slow stream of alternating small/large 'z' glyphs that drift up-right from
  // above his head — the universal "asleep" cue. Lives here (a renderer-side
  // looping animation tied to the sleeping mood) rather than as a one-shot
  // pulse, since sleeping is a sustained state, not an event.
  private startZzz(): void {
    this.stopZzz();
    if (this.reducedMotion) return;
    this.zzzBig = false;
    const tick = (): void => { this.spawnSleepZ(this.zzzBig); this.zzzBig = !this.zzzBig; };
    tick();
    this.zzzTimer = setInterval(tick, 1100);
  }

  private stopZzz(): void {
    if (this.zzzTimer) { clearInterval(this.zzzTimer); this.zzzTimer = null; }
  }

  private spawnSleepZ(big: boolean): void {
    if (!this.container || this.reducedMotion) return;
    if (!document.getElementById('bk-zzz-css')) {
      const s = document.createElement('style'); s.id = 'bk-zzz-css';
      s.textContent = '@keyframes bk-zzz{0%{transform:translate(0,0) scale(0.5);opacity:0}25%{opacity:0.95}100%{transform:translate(16px,-40px) scale(1);opacity:0}}';
      document.head.appendChild(s);
    }
    const el = document.createElement('div');
    el.textContent = 'z';
    el.style.cssText = `position:absolute;top:-2px;left:58%;font:800 ${big ? '20' : '13'}px system-ui;color:#9bb0d6;pointer-events:none;animation:bk-zzz 2.4s ease-out forwards;z-index:20;`;
    this.container.appendChild(el);
    setTimeout(() => el.remove(), 2450);
  }

  // ── cute talking animation ───────────────────────────────────────────────────
  // A soft filled little mouth that opens/closes through a few rounded shapes
  // (smoothly tweened), a gentle whole-face bob, and a bit more blush — instead
  // of a hard 2-frame flip + eye squish, which looked twitchy.
  private ensureTalkCss(): void {
    if (document.getElementById('bk-talk-css')) return;
    const s = document.createElement('style');
    s.id = 'bk-talk-css';
    s.textContent = '@keyframes bk-talkbob{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}';
    document.head.appendChild(s);
  }

  private startTalk(): void {
    this.stopTalk();
    if (this.reducedMotion || !this.mouth) return;
    this.ensureTalkCss();

    // gentle bob of the whole face (eyes + mouth + blush ride along)
    if (this.container) this.container.style.animation = 'bk-talkbob 0.66s ease-in-out infinite';
    // a little extra blush while chatting = cuter
    if (this.blushL && this.blushR) { this.blushL.style.opacity = '0.8'; this.blushR.style.opacity = '0.8'; }

    // turn the mouth into a soft filled oval and tween its size smoothly
    const m = this.mouth.style;
    m.border = 'none';
    m.background = '#46313c';
    m.borderRadius = '50%';
    m.opacity = '0.92';
    m.transition = 'width 95ms ease, height 95ms ease';

    // sizes that read like cheerful chatter: small → open → mid → wide → mid …
    const frames = [
      { w: 8, h: 5 }, { w: 13, h: 12 }, { w: 11, h: 8 }, { w: 15, h: 15 }, { w: 11, h: 7 },
    ];
    let i = 0;
    this.talkTimer = setInterval(() => {
      if (!this.mouth) return;
      const f = frames[i % frames.length];
      i++;
      this.mouth.style.width = `${f.w}px`;
      this.mouth.style.height = `${f.h}px`;
    }, 115);
  }

  private stopTalk(): void {
    if (this.talkTimer) { clearInterval(this.talkTimer); this.talkTimer = null; }
    if (this.container) this.container.style.animation = '';
    if (this.mouth) {
      const m = this.mouth.style;
      m.transition = 'all 0.2s ease';
      m.background = '';
      m.width = ''; m.height = '';
    }
    this.updateMouth(this.currentMood);
    if (this.blushL && this.blushR) {
      const op = this.currentMood === 'happy' ? '0.85' : this.currentMood === 'annoyed' ? '0' : '0.6';
      this.blushL.style.opacity = op; this.blushR.style.opacity = op;
    }
  }

  // ── pulse ─────────────────────────────────────────────────────────────────

  pulse(event: PulseEvent): void {
    switch (event) {
      case 'blink': this.doBlink(); break;
      case 'lookAway': this.doLookAway(); break;
      case 'speakTick': this.doSpeakTick(); break;
      case 'lookAround': this.doLookAround(); break;
      case 'yawn': this.doYawn(); break;
      case 'stretch': this.doStretch(); break;
      case 'doze': this.doDoze(); break;
      case 'peek': this.doPeek(); break;
      case 'giggle': this.doGiggle(); break;
      case 'heart': this.spawnFloater('❤'); break;
      case 'startle': this.doStartle(); break;
      case 'dizzy': this.doDizzy(); break;
      default: break; // sound* pulses have no eye animation
    }
  }

  // ── cursor-follow gaze ──────────────────────────────────────────────────────

  setGaze(dx: number, dy: number): void {
    if (this.reducedMotion) return;
    // While thinking he's in his head, and while listening he's locked on you —
    // in both, a scripted drift owns the gaze, so don't let the cursor pull it.
    if (this.currentMood === 'thinking' || this.currentMood === 'listening') return;
    this.lastGazeAt = performance.now();
    const base = RECIPES[this.currentMood];
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    this.tweenTo({
      ...this.baseline(),
      innerOffsetX: base.innerOffsetX + clamp(dx) * 13,
      innerOffsetY: base.innerOffsetY + clamp(dy) * 8,
    }, 140);
  }

  // ── companion micro-behaviours + reactions ──────────────────────────────────

  private baseline(): EyeParams { return { ...RECIPES[this.currentMood] }; }

  private tweenTo(p: EyeParams, dur: number): void {
    if (this.reducedMotion) { this.applyParams(p, true); return; }
    this.targetParams = { ...p };
    this.tweenStart = performance.now();
    this.tweenDuration = dur;
    this.tweening = true;
  }

  private doLookAround(): void {
    if (this.reducedMotion) return;
    const base = this.baseline();
    const look = (dx: number): EyeParams => ({ ...base, innerOffsetX: base.innerOffsetX + dx });
    this.tweenTo(look(-13), 320);
    setTimeout(() => this.tweenTo(look(13), 380), 520);
    setTimeout(() => this.tweenTo(base, 360), 1100);
  }

  private doYawn(): void {
    if (this.reducedMotion) return;
    const base = this.baseline();
    this.tweenTo({ ...base, eyelidPct: 0.55, scaleY: base.scaleY * 0.9 }, 280);
    if (this.mouth) {
      const m = this.mouth.style;
      m.width = '16px'; m.height = '14px'; m.borderRadius = '50%';
      m.borderTop = '3px solid #2d2d3e'; m.borderBottom = '3px solid #2d2d3e';
      m.borderLeft = '3px solid #2d2d3e'; m.borderRight = '3px solid #2d2d3e';
      m.opacity = '0.8';
    }
    setTimeout(() => { this.updateMouth(this.currentMood); this.tweenTo(this.baseline(), 360); }, 760);
  }

  private doStretch(): void {
    if (this.reducedMotion) return;
    const base = this.baseline();
    this.tweenTo({ ...base, scaleY: base.scaleY * 1.12, outerSize: base.outerSize * 1.05 }, 300);
    setTimeout(() => this.tweenTo(base, 340), 360);
  }

  private doDoze(): void {
    if (this.reducedMotion) return;
    const base = this.baseline();
    this.tweenTo({ ...base, eyelidPct: 0.8 }, 500);
    this.spawnFloater('z', true);
    setTimeout(() => this.spawnFloater('z', true), 700);
    setTimeout(() => this.tweenTo(base, 600), 1900);
  }

  private doPeek(): void {
    if (this.reducedMotion) return;
    for (const eye of [this.left, this.right]) {
      if (!eye) continue;
      const size = this.currentParams.outerSize;
      eye.lid.style.transition = 'height 220ms ease';
      eye.lid.style.height = `${size * 0.85}px`;
      setTimeout(() => {
        if (eye) { eye.lid.style.transition = 'height 260ms ease'; eye.lid.style.height = `${size * this.currentParams.eyelidPct}px`; }
      }, 460);
    }
  }

  private doGiggle(): void {
    if (this.reducedMotion) return;
    if (this.blushL && this.blushR) { this.blushL.style.opacity = '0.95'; this.blushR.style.opacity = '0.95'; }
    this.updateMouth('happy');
    const sy = this.currentParams.scaleY;
    const bob = (): void => {
      for (const eye of [this.left, this.right]) if (eye) { eye.wrap.style.transition = 'transform 80ms ease'; eye.wrap.style.transform = `scaleY(${sy * 0.82})`; }
      setTimeout(() => { for (const eye of [this.left, this.right]) if (eye) eye.wrap.style.transform = `scaleY(${sy})`; }, 90);
    };
    bob(); setTimeout(bob, 210);
    this.spawnFloater('❤');
    setTimeout(() => {
      this.updateMouth(this.currentMood);
      if (this.blushL && this.blushR) {
        const op = this.currentMood === 'happy' ? '0.85' : this.currentMood === 'annoyed' ? '0' : '0.6';
        this.blushL.style.opacity = op; this.blushR.style.opacity = op;
      }
    }, 720);
  }

  private doStartle(): void {
    if (this.reducedMotion) return;
    const base = this.baseline();
    this.tweenTo({ ...base, scaleY: 1.2, innerSize: base.innerSize * 1.12, eyelidPct: 0 }, 90);
    setTimeout(() => this.tweenTo(base, 220), 280);
  }

  private doDizzy(): void {
    if (this.reducedMotion || this.dizzyTimer) return;
    const base = this.baseline();
    this.tweening = false; // take manual control of the eyes during the spin
    let t = 0;
    this.dizzyTimer = setInterval(() => {
      this.applyParams({ ...base, innerOffsetX: base.innerOffsetX + Math.cos(t) * 10, innerOffsetY: base.innerOffsetY + Math.sin(t) * 6 });
      t += 0.9;
      if (t > 7) {
        if (this.dizzyTimer) { clearInterval(this.dizzyTimer); this.dizzyTimer = null; }
        this.tweenTo(base, 260);
      }
    }, 60);
  }

  private spawnFloater(glyph: string, mono = false): void {
    if (!this.container || this.reducedMotion) return;
    if (!document.getElementById('bk-floater-css')) {
      const s = document.createElement('style'); s.id = 'bk-floater-css';
      s.textContent = '@keyframes bk-float{0%{transform:translateY(0) scale(0.6);opacity:0}20%{opacity:1}100%{transform:translate(6px,-34px) scale(1);opacity:0}}';
      document.head.appendChild(s);
    }
    const el = document.createElement('div');
    el.textContent = glyph;
    el.style.cssText = `position:absolute;top:2px;left:54%;font:700 ${mono ? '15' : '18'}px system-ui;color:${glyph === '❤' ? '#ff6b8a' : '#8aa0c8'};pointer-events:none;animation:bk-float 1.3s ease-out forwards;z-index:20;`;
    this.container.appendChild(el);
    setTimeout(() => el.remove(), 1350);
  }

  private doBlink(): void {
    for (const eye of [this.left, this.right]) {
      if (!eye) continue;
      const size = this.currentParams.outerSize;
      eye.lid.style.transition = 'height 55ms ease-in';
      eye.lid.style.height = `${size}px`;
      setTimeout(() => {
        if (eye) {
          eye.lid.style.transition = 'height 75ms ease-out';
          eye.lid.style.height = `${size * this.currentParams.eyelidPct}px`;
        }
      }, 110);
    }
  }

  private doLookAway(): void {
    if (this.reducedMotion) return;
    const saved = { ...this.currentParams };
    const away = { ...saved, innerOffsetX: 20 };
    this.targetParams = away;
    this.tweenStart = performance.now();
    this.tweenDuration = 350;
    this.tweening = true;
    setTimeout(() => {
      this.targetParams = saved;
      this.tweenStart = performance.now();
      this.tweenDuration = 350;
      this.tweening = true;
    }, 2500);
  }

  private doSpeakTick(): void {
    if (this.reducedMotion) return;
    for (const eye of [this.left, this.right]) {
      if (!eye) continue;
      eye.wrap.style.transition = 'transform 70ms ease';
      eye.wrap.style.transform = `scaleY(${this.currentParams.scaleY * 0.9})`;
      setTimeout(() => {
        if (eye) eye.wrap.style.transform = `scaleY(${this.currentParams.scaleY})`;
      }, 100);
    }
  }

  // ── setIntensity ──────────────────────────────────────────────────────────

  setIntensity(level: number): void {
    // Tint outer eye from dark-neutral → dark-red as annoyance increases
    const r = Math.round(lerp(30, 60, level));
    const g = Math.round(lerp(30, 15, level));
    const b = Math.round(lerp(46, 15, level));
    for (const eye of [this.left, this.right]) {
      if (eye) eye.wrap.style.background = `rgb(${r},${g},${b})`;
    }
  }

  // ── setActivity ───────────────────────────────────────────────────────────

  setActivity(activity: ActivityState | null): void {
    this.clearActivity();
    if (!activity || !this.container) return;
    if (activity.type === 'music') this.startMusicOverlay(activity.nowPlaying);
    else if (activity.type === 'searching') this.startSearchOverlay();
    else if (activity.type === 'timer') this.startTimerOverlay(activity.remainingSec, activity.label);
  }

  private clearActivity(): void {
    if (this.activityWrap) { this.activityWrap.remove(); this.activityWrap = null; }
    if (this.eqInterval) { clearInterval(this.eqInterval); this.eqInterval = null; }
    this.eqBars = [];
  }

  // The status overlay (timer / now-playing / searching) mounts on the UNSCALED
  // face column (#cosmo-col), not the scale(0.58) avatar container — otherwise an
  // 11px label renders at ~6px. It sits bottom-center as a dark pill so it's legible
  // over the near-white panel (white-on-white was the original "can't see the timer"
  // bug) and is position:absolute so it never reflows the eyes/mouth (the "mouth
  // jumps up" bug, which the old in-flow overlay caused).
  private statusHost(): HTMLElement | null {
    return (this.container?.closest('#cosmo-col') as HTMLElement | null) ?? this.container;
  }

  private startMusicOverlay(nowPlaying: { track: string; artist: string }): void {
    const host = this.statusHost();
    if (!host) return;
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:absolute;left:50%;bottom:12px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:3px;padding:4px 10px;border-radius:12px;background:rgba(28,28,40,0.9);box-shadow:0 2px 9px rgba(0,0,0,0.3);pointer-events:none;z-index:15;';
    const barRow = document.createElement('div');
    barRow.style.cssText = 'display:flex;align-items:flex-end;gap:3px;height:18px;';
    this.eqBars = Array.from({ length: 6 }, () => {
      const b = document.createElement('div');
      b.style.cssText = 'width:4px;border-radius:2px;background:#6fb1ff;height:4px;transition:height 0.1s ease;';
      barRow.appendChild(b); return b;
    });
    const label = document.createElement('div');
    label.textContent = `${nowPlaying.track} — ${nowPlaying.artist}`.slice(0, 22);
    label.style.cssText = 'font-size:9.5px;color:rgba(255,255,255,0.8);font-family:system-ui;white-space:nowrap;';
    wrap.appendChild(barRow); wrap.appendChild(label);
    this.activityWrap = wrap;
    host.appendChild(wrap);
    const targets = this.eqBars.map(() => 4);
    this.eqInterval = setInterval(() => {
      this.eqBars.forEach((bar, i) => {
        targets[i] = lerp(targets[i], 4 + Math.random() * 14, 0.3);
        bar.style.height = `${Math.round(targets[i])}px`;
      });
    }, 100);
  }

  private startSearchOverlay(): void {
    const host = this.statusHost();
    if (!host) return;
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:absolute;left:50%;bottom:12px;transform:translateX(-50%);display:flex;justify-content:center;align-items:center;padding:6px;border-radius:50%;background:rgba(28,28,40,0.85);box-shadow:0 2px 9px rgba(0,0,0,0.3);pointer-events:none;z-index:15;';
    const ring = document.createElement('div');
    ring.style.cssText = 'width:22px;height:22px;border-radius:50%;border:2px solid rgba(120,170,255,0.35);position:relative;';
    const dot = document.createElement('div');
    dot.style.cssText = 'position:absolute;width:5px;height:5px;border-radius:50%;background:#6fb1ff;top:50%;left:50%;margin:-2.5px;';
    dot.style.animation = 'radar 1.8s linear infinite';
    if (!document.getElementById('bk-radar')) {
      const s = document.createElement('style'); s.id = 'bk-radar';
      s.textContent = '@keyframes radar{from{transform:rotate(0)translateX(8px)}to{transform:rotate(360deg)translateX(8px)}}';
      document.head.appendChild(s);
    }
    ring.appendChild(dot); wrap.appendChild(ring);
    this.activityWrap = wrap;
    host.appendChild(wrap);
  }

  private startTimerOverlay(remainingSec: number, label: string): void {
    const host = this.statusHost();
    if (!host) return;
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:absolute;left:50%;bottom:14px;transform:translateX(-50%);display:flex;align-items:center;gap:5px;padding:3px 10px;border-radius:12px;background:rgba(28,28,40,0.9);white-space:nowrap;box-shadow:0 2px 9px rgba(0,0,0,0.3);pointer-events:none;z-index:15;';
    const lbl = document.createElement('div');
    lbl.style.cssText = 'font-size:11px;color:rgba(255,255,255,0.72);font-family:system-ui;';
    lbl.textContent = label;
    const timeEl = document.createElement('div');
    timeEl.style.cssText = 'font-size:13px;color:#fff;font-weight:700;font-family:ui-monospace,monospace;letter-spacing:0.3px;';
    const fmt = (s: number) => `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
    timeEl.textContent = fmt(remainingSec);
    wrap.appendChild(lbl); wrap.appendChild(timeEl);
    // Stop control — the one interactive bit on the otherwise click-through pill.
    // Emits an intent event; the renderer wires it to the pomodoro.stop tool.
    const stop = document.createElement('div');
    stop.textContent = '✕';
    stop.title = 'End focus session';
    stop.style.cssText = 'margin-left:3px;width:15px;height:15px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(255,255,255,0.18);color:#fff;font-size:9px;line-height:1;cursor:pointer;pointer-events:auto;';
    stop.addEventListener('click', (e) => { e.stopPropagation(); document.dispatchEvent(new CustomEvent('cosmo:timer-stop')); });
    wrap.appendChild(stop);
    this.activityWrap = wrap;
    host.appendChild(wrap);
    let rem = remainingSec;
    this.eqInterval = setInterval(() => {
      rem--; timeEl.textContent = fmt(Math.max(0, rem));
      if (rem <= 0) { clearInterval(this.eqInterval!); this.eqInterval = null; }
    }, 1000);
  }

  // ── Idle animations ───────────────────────────────────────────────────────

  private startBlink(): void {
    const next = () => {
      const delay = 3500 + Math.random() * 3000;
      this.blinkTimer = setTimeout(() => { this.doBlink(); next(); }, delay);
    };
    next();
  }

  private startGaze(): void {
    const next = () => {
      const delay = 2200 + Math.random() * 2500;
      this.gazeTimer = setTimeout(() => {
        // Don't wander randomly while the cursor is actively being followed, or
        // while thinking / listening (a scripted drift owns the gaze then).
        if (this.currentMood === 'thinking' || this.currentMood === 'listening') { next(); return; }
        if (performance.now() - this.lastGazeAt < 1600) { next(); return; }
        if (!this.tweening) {
          const dx = (Math.random() - 0.5) * 10;
          const dy = (Math.random() - 0.5) * 6 - 3;
          this.targetParams = { ...this.currentParams, innerOffsetX: RECIPES.idle.innerOffsetX + dx, innerOffsetY: RECIPES.idle.innerOffsetY + dy };
          this.tweenStart = performance.now();
          this.tweenDuration = 700;
          this.tweening = true;
        }
        next();
      }, delay);
    };
    next();
  }

  // ── dispose ───────────────────────────────────────────────────────────────

  dispose(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    if (this.blinkTimer) clearTimeout(this.blinkTimer);
    if (this.gazeTimer) clearTimeout(this.gazeTimer);
    if (this.dizzyTimer) clearInterval(this.dizzyTimer);
    if (this.talkTimer) clearInterval(this.talkTimer);
    if (this.zzzTimer) clearInterval(this.zzzTimer);
    if (this.thinkTimer) clearInterval(this.thinkTimer);
    if (this.listenTimer) clearInterval(this.listenTimer);
    this.clearActivity();
    if (this.container) this.container.innerHTML = '';
    this.left = this.right = null;
  }
}
