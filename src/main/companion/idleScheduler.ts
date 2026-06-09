import { screen } from 'electron';
import type { BrowserWindow } from 'electron';
import type { StateManager } from '../state';
import type { PulseEvent } from '../../shared/types';

// Phase A companion liveliness. Fires gentle "alive" micro-behaviours while
// Cosmo is just sitting in the neutral 'idle' mood, so it never looks frozen.
// Timing/physics live here (main), per the architecture rules — the pack only
// decides how each pulse looks. Coach moods (bored/annoyed/sleeping/listening/
// thinking/speaking) own their own expressions, so we stay out of their way.
//
// 'doze' is deliberately excluded: real dozing belongs to the long-idle
// 'sleeping' mood, not to an awake-but-still user who may be reading or typing.
const IDLE_BEHAVIORS: PulseEvent[] = ['lookAround', 'peek', 'lookAround', 'stretch', 'peek', 'yawn'];

export interface IdleSchedulerDeps {
  win: BrowserWindow;
  state: StateManager;
  dev: boolean;
}

/** Start the idle micro-behaviour loop. Returns a stop function. */
export function startIdleScheduler(deps: IdleSchedulerDeps): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const factor = deps.dev ? 0.4 : 1; // a touch livelier in dev so it's easy to see

  const next = (): void => {
    const delay = (6000 + Math.random() * 9000) * factor; // ~6–15s
    timer = setTimeout(() => {
      if (deps.state.getState() === 'idle') {
        const pick = IDLE_BEHAVIORS[Math.floor(Math.random() * IDLE_BEHAVIORS.length)];
        deps.state.pulse(pick, deps.win);
      }
      next();
    }, delay);
  };
  next();

  return () => { if (timer) { clearTimeout(timer); timer = null; } };
}

// ── Cursor-follow gaze (driven from main, so it's immune to drag regions) ────
// The renderer can't see the pointer when it's over an app-region:drag surface
// or outside the window, so we poll the GLOBAL cursor here and tell the renderer
// where to look. Eyes follow the cursor anywhere on screen. Only while 'idle'
// (other moods own their gaze). Returns a stop function.
export function startGazeTracking(win: BrowserWindow, state: StateManager): () => void {
  let last = { dx: 99, dy: 99 };
  const timer = setInterval(() => {
    if (win.isDestroyed() || state.getState() !== 'idle') return;
    const p = screen.getCursorScreenPoint();
    const b = win.getBounds();
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    // Normalise by ~1.2× the window size so the eyes hit full deflection a
    // little beyond the window edge, then saturate.
    const clamp = (v: number): number => Math.max(-1, Math.min(1, v));
    const dx = clamp((p.x - cx) / (b.width * 1.2));
    const dy = clamp((p.y - cy) / (b.height * 1.2));
    if (Math.abs(dx - last.dx) < 0.04 && Math.abs(dy - last.dy) < 0.04) return;
    last = { dx, dy };
    win.webContents.send('companion:gaze', { dx, dy });
  }, 60);
  return () => clearInterval(timer);
}

// ── Gesture reactions: shake / pick-up via the OS window move events ─────────
// The whole window is an app-region drag surface, so JS pointer events don't
// fire while it's being dragged — but BrowserWindow 'move' does. We watch the
// movement path: lots of direction reversals = a shake (dizzy); a big quick
// slide = being picked up (startle).
export function attachGestureReactions(win: BrowserWindow, state: StateManager): void {
  let moves: Array<{ t: number; x: number; y: number }> = [];
  let lastReactAt = 0;

  win.on('move', () => {
    const [x, y] = win.getPosition();
    const t = Date.now();
    moves.push({ t, x, y });
    moves = moves.filter((m) => t - m.t < 700);
    state.onInteraction(win); // touching the window counts as interaction

    if (moves.length < 3 || t - lastReactAt < 1500) return;

    let dist = 0;
    let reversals = 0;
    let lastDx = 0;
    for (let k = 1; k < moves.length; k++) {
      const dx = moves[k].x - moves[k - 1].x;
      const dy = moves[k].y - moves[k - 1].y;
      dist += Math.hypot(dx, dy);
      if (dx * lastDx < 0) reversals++;
      if (dx !== 0) lastDx = dx;
    }

    if (reversals >= 3 && dist > 240) { state.pulse('dizzy', win); lastReactAt = t; }
    else if (dist > 200) { state.pulse('startle', win); lastReactAt = t; }
  });
}
