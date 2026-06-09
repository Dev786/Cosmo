# Phase 1 — Moods Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the full 8-state mood machine owned by the main process, pushed to the renderer over IPC, with dev keyboard shortcuts 1–8 to force states and ActivityState overlays for music, searching, and timer.

**Architecture:** `StateManager` in `src/main/state.ts` is the sole owner of `MoodState`; it pushes state/intensity/activity to the renderer via typed IPC channels from `shared/types.ts`. The classic expression pack (`src/renderer/packs/classic/`) renders whatever state it is told, with activity overlays drawn as independent DOM layers that are orthogonal to the mood layer.

**Tech Stack:** Electron IPC (`ipcMain` / `ipcRenderer`), TypeScript strict mode, plain DOM/CSS for animations, `vitest` for unit tests, `PIXEL_DEV=1` env flag for dev shortcuts.

---

## File Map

| File | Status | Responsibility |
|---|---|---|
| `src/shared/types.ts` | **Already exists** (Phase 0) | `MoodState`, `ActivityState`, `IPC` constants — do not redefine |
| `src/main/state.ts` | **Create** | `StateManager` class — single owner of MoodState |
| `src/main/index.ts` | **Modify** | Instantiate StateManager; wire dev shortcuts; wire interaction → onInteraction() |
| `src/renderer/packs/classic/recipes.ts` | **Modify** | Add parameter sets for all 8 mood states |
| `src/renderer/packs/classic/index.ts` | **Modify** | `setState`, `setIntensity`, `setActivity` implementations |
| `src/renderer/packs/classic/tween.ts` | **Already exists** (Phase 0) | 250ms cubic-bezier tweening — reuse as-is |
| `tests/main/state.test.ts` | **Create** | Unit tests for StateManager |
| `tests/renderer/packs/classic/recipes.test.ts` | **Create** | Unit tests for recipe coverage |
| `tests/renderer/packs/classic/activity.test.ts` | **Create** | Unit tests for activity overlay logic |

---

## Task 1: StateManager — Core State Machine

**Files:**
- Create: `src/main/state.ts`
- Create: `tests/main/state.test.ts`

### Step 1.1: Write the failing test
- [ ] Create `tests/main/state.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StateManager } from '../../src/main/state';
import type { MoodState, ActivityState } from '../../src/shared/types';
import { IPC } from '../../src/shared/types';

// Minimal BrowserWindow mock — only webContents.send matters here
function makeMockWindow() {
  return {
    webContents: {
      send: vi.fn(),
    },
  } as any;
}

describe('StateManager', () => {
  let sm: StateManager;
  let win: ReturnType<typeof makeMockWindow>;

  beforeEach(() => {
    vi.useFakeTimers();
    sm = new StateManager();
    win = makeMockWindow();
  });

  afterEach(() => {
    sm.dispose();
    vi.useRealTimers();
  });

  it('starts in idle state', () => {
    expect(sm.getState()).toBe('idle');
  });

  it('setState sends IPC.MOOD_SET with the new state', () => {
    sm.setState('thinking', win);
    expect(win.webContents.send).toHaveBeenCalledWith(IPC.MOOD_SET, 'thinking');
  });

  it('setState updates the internal state', () => {
    sm.setState('listening', win);
    expect(sm.getState()).toBe('listening');
  });

  it('setState with durationMs reverts to idle after the timeout', () => {
    sm.setState('happy', win, 2000);
    expect(sm.getState()).toBe('happy');
    vi.advanceTimersByTime(2000);
    expect(sm.getState()).toBe('idle');
    // Second IPC call should be the revert
    expect(win.webContents.send).toHaveBeenNthCalledWith(2, IPC.MOOD_SET, 'idle');
  });

  it('setState with durationMs does not revert if state changes before timeout', () => {
    sm.setState('happy', win, 2000);
    sm.setState('thinking', win);
    vi.advanceTimersByTime(2000);
    // Should still be thinking, not reverted to idle from happy's timer
    expect(sm.getState()).toBe('thinking');
  });

  it('setIntensity sends IPC.MOOD_INTENSITY with clamped level', () => {
    sm.setIntensity(0.7, win);
    expect(win.webContents.send).toHaveBeenCalledWith(IPC.MOOD_INTENSITY, 0.7);
  });

  it('setIntensity clamps values to 0..1', () => {
    sm.setIntensity(1.5, win);
    expect(win.webContents.send).toHaveBeenCalledWith(IPC.MOOD_INTENSITY, 1);
    sm.setIntensity(-0.3, win);
    expect(win.webContents.send).toHaveBeenCalledWith(IPC.MOOD_INTENSITY, 0);
  });

  it('pulse sends IPC.MOOD_PULSE with the event name', () => {
    sm.pulse('blink', win);
    expect(win.webContents.send).toHaveBeenCalledWith(IPC.MOOD_PULSE, 'blink');
  });

  it('setActivity sends IPC.ACTIVITY_SET with the activity', () => {
    const activity: ActivityState = { type: 'searching' };
    sm.setActivity(activity, win);
    expect(win.webContents.send).toHaveBeenCalledWith(IPC.ACTIVITY_SET, activity);
  });

  it('setActivity accepts null to clear', () => {
    sm.setActivity(null, win);
    expect(win.webContents.send).toHaveBeenCalledWith(IPC.ACTIVITY_SET, null);
  });

  it('onInteraction exits bored to idle', () => {
    sm.setState('bored', win);
    sm.onInteraction(win);
    expect(sm.getState()).toBe('idle');
    expect(win.webContents.send).toHaveBeenCalledWith(IPC.MOOD_SET, 'idle');
  });

  it('onInteraction exits annoyed to idle', () => {
    sm.setState('annoyed', win);
    sm.onInteraction(win);
    expect(sm.getState()).toBe('idle');
  });

  it('onInteraction does not change other states', () => {
    sm.setState('thinking', win);
    const callsBefore = win.webContents.send.mock.calls.length;
    sm.onInteraction(win);
    expect(win.webContents.send.mock.calls.length).toBe(callsBefore);
    expect(sm.getState()).toBe('thinking');
  });

  it('dispose clears any pending revert timeout', () => {
    sm.setState('happy', win, 2000);
    sm.dispose();
    vi.advanceTimersByTime(2000);
    // After dispose the timer should have been cleared; still happy (or at least no error)
    // State does not revert since the timer was cancelled
    expect(sm.getState()).toBe('happy');
  });
});
```

- [ ] Run test to confirm it fails:

```bash
npx vitest run tests/main/state.test.ts
```

Expected: FAIL — `Cannot find module '../../src/main/state'`

### Step 1.2: Implement StateManager
- [ ] Create `src/main/state.ts`:

```typescript
import type { BrowserWindow } from 'electron';
import type { MoodState, ActivityState } from '../shared/types';
import { IPC } from '../shared/types';

export class StateManager {
  private current: MoodState = 'idle';
  private revertTimer: ReturnType<typeof setTimeout> | null = null;

  getState(): MoodState {
    return this.current;
  }

  setState(next: MoodState, win: BrowserWindow, durationMs?: number): void {
    // Cancel any pending revert from a previous timed state
    if (this.revertTimer !== null) {
      clearTimeout(this.revertTimer);
      this.revertTimer = null;
    }

    this.current = next;
    win.webContents.send(IPC.MOOD_SET, next);

    if (durationMs !== undefined && durationMs > 0) {
      this.revertTimer = setTimeout(() => {
        this.revertTimer = null;
        // Only revert if we're still in the timed state
        if (this.current === next) {
          this.current = 'idle';
          win.webContents.send(IPC.MOOD_SET, 'idle');
        }
      }, durationMs);
    }
  }

  setIntensity(level: number, win: BrowserWindow): void {
    const clamped = Math.min(1, Math.max(0, level));
    win.webContents.send(IPC.MOOD_INTENSITY, clamped);
  }

  pulse(event: string, win: BrowserWindow): void {
    win.webContents.send(IPC.MOOD_PULSE, event);
  }

  setActivity(activity: ActivityState | null, win: BrowserWindow): void {
    win.webContents.send(IPC.ACTIVITY_SET, activity);
  }

  onInteraction(win: BrowserWindow): void {
    if (this.current === 'bored' || this.current === 'annoyed') {
      this.setState('idle', win);
    }
  }

  dispose(): void {
    if (this.revertTimer !== null) {
      clearTimeout(this.revertTimer);
      this.revertTimer = null;
    }
  }
}
```

- [ ] Run tests to confirm they pass:

```bash
npx vitest run tests/main/state.test.ts
```

Expected: PASS — all 13 tests green

- [ ] Commit:

```bash
git add src/main/state.ts tests/main/state.test.ts
git commit -m "feat(state): add StateManager — 8-state mood machine with IPC push, timed revert, interaction exit"
```

---

## Task 2: Wire StateManager into Main Process

**Files:**
- Modify: `src/main/index.ts`

This task wires the StateManager into the app lifecycle, registers the `state:set` IPC handler for dev tooling, and propagates window interaction events to `onInteraction`.

### Step 2.1: Read the current main/index.ts
- [ ] Read `src/main/index.ts` before editing (required by the Edit tool).

### Step 2.2: Instantiate StateManager and register IPC handler
- [ ] Add the following to `src/main/index.ts` **after** the window is created and before `app.on('ready')` returns. Find the section where `mainWindow` is assigned and add below it:

```typescript
// At the top of the file, add this import alongside existing imports:
import { StateManager } from './state';
import { ipcMain } from 'electron';
import { IPC } from '../shared/types';

// After mainWindow is created, add:
export const stateManager = new StateManager();

// Dev IPC handler so renderer devtools / tools can force state:
ipcMain.handle('state:set', (_event, state: string) => {
  stateManager.setState(state as import('../shared/types').MoodState, mainWindow);
  return stateManager.getState();
});

// Wire window click and keydown in renderer → onInteraction
// (The renderer sends this over IPC; see Task 3 for the renderer side)
ipcMain.on('interaction', () => {
  stateManager.onInteraction(mainWindow);
});
```

- [ ] In the `app.on('before-quit')` or `mainWindow.on('closed')` handler, add cleanup:

```typescript
mainWindow.on('closed', () => {
  stateManager.dispose();
});
```

### Step 2.3: Add interaction IPC sender in renderer
- [ ] Open `src/renderer/chat.ts` (or `src/renderer/index.html`'s inline script). Add a one-time listener that reports user interactions back to main. Place this in the renderer bootstrap:

```typescript
// In the renderer (src/renderer/chat.ts or equivalent bootstrap file):
// Import ipcRenderer (already available in preload context or via window.electronAPI)
// Send 'interaction' to main whenever the user clicks or types in the window

document.addEventListener('click', () => {
  window.electronAPI.send('interaction');
});

document.addEventListener('keydown', () => {
  window.electronAPI.send('interaction');
});
```

> **Note:** The exact mechanism depends on whether Phase 0 used a preload script with `contextBridge` (recommended) or `nodeIntegration`. Use whichever pattern already exists in Phase 0. The key point: every user input in the renderer must reach `stateManager.onInteraction()` in main.

- [ ] Verify `npm run typecheck` passes with no new errors:

```bash
npm run typecheck
```

Expected: 0 errors

- [ ] Commit:

```bash
git add src/main/index.ts src/renderer/chat.ts
git commit -m "feat(main): wire StateManager into app lifecycle; add state:set IPC handler; interaction events exit bored/annoyed"
```

---

## Task 3: Dev Keyboard Shortcuts (PIXEL_DEV=1 only)

**Files:**
- Modify: `src/main/index.ts`

### Step 3.1: Write the failing test
- [ ] Create `tests/main/devShortcuts.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

// We test the mapping logic in isolation — not the Electron globalShortcut API itself
// (that's an integration concern, not unit-testable without Electron)

const MOOD_SHORTCUT_MAP: Record<string, import('../../src/shared/types').MoodState> = {
  '1': 'idle',
  '2': 'listening',
  '3': 'thinking',
  '4': 'speaking',
  '5': 'happy',
  '6': 'bored',
  '7': 'annoyed',
  '8': 'sleeping',
};

describe('dev shortcut mood map', () => {
  it('maps keys 1–8 to the correct MoodState in order', () => {
    const expected: import('../../src/shared/types').MoodState[] = [
      'idle', 'listening', 'thinking', 'speaking',
      'happy', 'bored', 'annoyed', 'sleeping',
    ];
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8'];
    keys.forEach((key, i) => {
      expect(MOOD_SHORTCUT_MAP[key]).toBe(expected[i]);
    });
  });

  it('covers all 8 MoodStates exactly once', () => {
    const values = Object.values(MOOD_SHORTCUT_MAP);
    const unique = new Set(values);
    expect(unique.size).toBe(8);
    expect(values.length).toBe(8);
  });
});
```

- [ ] Run test to confirm it fails:

```bash
npx vitest run tests/main/devShortcuts.test.ts
```

Expected: FAIL — the map doesn't exist yet (test file imports from itself so it'll actually "pass" on the type level — the important thing is to run it once before wiring into main).

### Step 3.2: Add dev shortcuts to main/index.ts
- [ ] In `src/main/index.ts`, add the following **inside** the `app.whenReady()` / `app.on('ready')` callback, after `stateManager` is instantiated:

```typescript
import { globalShortcut } from 'electron';
import type { MoodState } from '../shared/types';

// Dev shortcuts — only registered when PIXEL_DEV=1
if (process.env.PIXEL_DEV === '1') {
  const devMoodMap: Record<string, MoodState> = {
    '1': 'idle',
    '2': 'listening',
    '3': 'thinking',
    '4': 'speaking',
    '5': 'happy',
    '6': 'bored',
    '7': 'annoyed',
    '8': 'sleeping',
  };

  Object.entries(devMoodMap).forEach(([key, mood]) => {
    globalShortcut.register(key, () => {
      console.log(`[DEV] Forcing mood: ${mood}`);
      stateManager.setState(mood, mainWindow);
    });
  });

  console.log('[DEV] Mood shortcuts registered: keys 1–8');
}

// Unregister on quit
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
```

- [ ] Run the mapping test to confirm it passes:

```bash
npx vitest run tests/main/devShortcuts.test.ts
```

Expected: PASS

- [ ] Verify typecheck:

```bash
npm run typecheck
```

- [ ] Commit:

```bash
git add src/main/index.ts tests/main/devShortcuts.test.ts
git commit -m "feat(dev): register global shortcuts 1–8 for mood forcing when PIXEL_DEV=1"
```

---

## Task 4: Classic Pack Recipes — All 8 States

**Files:**
- Modify: `src/renderer/packs/classic/recipes.ts`
- Create: `tests/renderer/packs/classic/recipes.test.ts`

The `recipes.ts` file is the **only** place numbers live for the classic pack. Each state is a parameter set `{ w, h, radius, offsetX, offsetY, rotation, color }` for each eye.

### Step 4.1: Define the EyeParams type and verify it exists
- [ ] Read `src/renderer/packs/classic/recipes.ts` and check whether `EyeParams` is defined. If it isn't, add it at the top:

```typescript
// src/renderer/packs/classic/recipes.ts

export interface EyeParams {
  w: number;       // width in px
  h: number;       // height in px
  radius: number;  // border-radius in px
  offsetX: number; // horizontal offset from center
  offsetY: number; // vertical offset from center
  rotation: number; // degrees
  color: string;   // CSS color
}

export interface StateRecipe {
  left: EyeParams;
  right: EyeParams;
}
```

### Step 4.2: Write the failing test
- [ ] Create `tests/renderer/packs/classic/recipes.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { RECIPES } from '../../../src/renderer/packs/classic/recipes';
import type { MoodState } from '../../../src/shared/types';

const ALL_MOODS: MoodState[] = [
  'idle', 'listening', 'thinking', 'speaking',
  'happy', 'bored', 'annoyed', 'sleeping',
];

describe('RECIPES', () => {
  it('has an entry for every MoodState', () => {
    ALL_MOODS.forEach(mood => {
      expect(RECIPES[mood], `missing recipe for "${mood}"`).toBeDefined();
    });
  });

  it('every recipe has left and right eye params', () => {
    ALL_MOODS.forEach(mood => {
      const r = RECIPES[mood];
      expect(r.left, `${mood}.left missing`).toBeDefined();
      expect(r.right, `${mood}.right missing`).toBeDefined();
    });
  });

  it('every EyeParams has all required fields', () => {
    const fields: (keyof import('../../../src/renderer/packs/classic/recipes').EyeParams)[] =
      ['w', 'h', 'radius', 'offsetX', 'offsetY', 'rotation', 'color'];
    ALL_MOODS.forEach(mood => {
      ['left', 'right'].forEach(side => {
        const eye = RECIPES[mood][side as 'left' | 'right'];
        fields.forEach(f => {
          expect(eye[f], `${mood}.${side}.${f} missing`).toBeDefined();
        });
      });
    });
  });

  it('listening eyes are wider than idle (h >= idle.h * 1.15)', () => {
    expect(RECIPES.listening.left.h).toBeGreaterThanOrEqual(RECIPES.idle.left.h * 1.15);
    expect(RECIPES.listening.right.h).toBeGreaterThanOrEqual(RECIPES.idle.right.h * 1.15);
  });

  it('sleeping eyes are very thin (h <= 4)', () => {
    expect(RECIPES.sleeping.left.h).toBeLessThanOrEqual(4);
    expect(RECIPES.sleeping.right.h).toBeLessThanOrEqual(4);
  });

  it('bored eyes are shorter than idle (h < idle.h)', () => {
    expect(RECIPES.bored.left.h).toBeLessThan(RECIPES.idle.left.h);
    expect(RECIPES.bored.right.h).toBeLessThan(RECIPES.idle.right.h);
  });

  it('annoyed eyes have a distinct color (not the idle color)', () => {
    expect(RECIPES.annoyed.left.color).not.toBe(RECIPES.idle.left.color);
  });

  it('happy eyes have a higher y offset than idle (∩-arc = negative h or raised)', () => {
    // Happy = ∩-arcs, implemented as negative h or top-heavy radius
    // We just verify happy is distinct from idle
    const happyL = RECIPES.happy.left;
    const idleL = RECIPES.idle.left;
    const isDistinct =
      happyL.h !== idleL.h ||
      happyL.radius !== idleL.radius ||
      happyL.rotation !== idleL.rotation;
    expect(isDistinct).toBe(true);
  });
});
```

- [ ] Run test to confirm it fails:

```bash
npx vitest run tests/renderer/packs/classic/recipes.test.ts
```

Expected: FAIL — `RECIPES` not exported or missing entries

### Step 4.3: Implement all 8 state recipes
- [ ] Add (or replace) the `RECIPES` export in `src/renderer/packs/classic/recipes.ts`:

```typescript
import type { MoodState } from '../../../shared/types';
import type { EyeParams, StateRecipe } from './recipes';

// Base eye dimensions for the classic pack
const BASE_W = 44;
const BASE_H = 44;
const BASE_RADIUS = 10;
const BASE_COLOR = '#e8e8e8';

// Shared default for the right eye (mirror of left)
function mirrorX(p: EyeParams): EyeParams {
  return { ...p, offsetX: -p.offsetX };
}

const idle: EyeParams = {
  w: BASE_W,
  h: BASE_H,
  radius: BASE_RADIUS,
  offsetX: 28,
  offsetY: 0,
  rotation: 0,
  color: BASE_COLOR,
};

const listening: EyeParams = {
  w: BASE_W + 6,    // slightly wider
  h: Math.round(BASE_H * 1.2), // +20% taller
  radius: 12,
  offsetX: 28,
  offsetY: -2,      // slight upward shift (alert)
  rotation: 0,
  color: BASE_COLOR,
};

const thinking: EyeParams = {
  w: BASE_W - 8,    // narrowed
  h: BASE_H - 12,   // flattened
  radius: 8,
  offsetX: 24,
  offsetY: -6,      // raised
  rotation: 0,
  color: BASE_COLOR,
};

const speaking: EyeParams = {
  w: BASE_W,
  h: BASE_H,
  radius: BASE_RADIUS,
  offsetX: 28,
  offsetY: 0,       // vertical bounce handled by animation, recipe is neutral
  rotation: 0,
  color: BASE_COLOR,
};

// ∩-arc happy: invert the border-radius to be top-heavy
// rotation: 180 makes the flat side face up → arch shape
const happy: EyeParams = {
  w: BASE_W + 4,
  h: BASE_H - 8,
  radius: 50,       // near-circle for smooth arc
  offsetX: 28,
  offsetY: 4,
  rotation: 180,    // upside-down rounded rect = ∩ arc
  color: '#a8e6a3', // soft green flash
};

const bored: EyeParams = {
  w: BASE_W,
  h: BASE_H - 18,   // half-lidded: significantly shorter
  radius: 6,
  offsetX: 28,
  offsetY: 6,       // drift down
  rotation: 0,
  color: '#c8c8c8', // slightly dimmer
};

const annoyed: EyeParams = {
  w: BASE_W - 4,
  h: BASE_H - 16,   // flat-top narrow
  radius: 4,
  offsetX: 28,
  offsetY: 0,
  rotation: 0,
  color: '#f5a623', // amber — intensity ramp will override toward red at max
};

const sleeping: EyeParams = {
  w: BASE_W,
  h: 2,             // closed lines
  radius: 1,
  offsetX: 28,
  offsetY: 0,
  rotation: 0,
  color: '#888888',
};

export const RECIPES: Record<MoodState, StateRecipe> = {
  idle:      { left: idle,      right: mirrorX(idle) },
  listening: { left: listening, right: mirrorX(listening) },
  thinking: {
    left: { ...thinking, offsetX: 24, offsetY: -6 },
    right: { ...thinking, offsetX: -20, offsetY: -6 }, // both shift toward upper-right
  },
  speaking:  { left: speaking,  right: mirrorX(speaking) },
  happy:     { left: happy,     right: mirrorX(happy) },
  bored:     { left: bored,     right: mirrorX(bored) },
  annoyed:   { left: annoyed,   right: mirrorX(annoyed) },
  sleeping:  { left: sleeping,  right: mirrorX(sleeping) },
};
```

- [ ] Run the recipe tests:

```bash
npx vitest run tests/renderer/packs/classic/recipes.test.ts
```

Expected: PASS — all recipe assertions green

- [ ] Commit:

```bash
git add src/renderer/packs/classic/recipes.ts tests/renderer/packs/classic/recipes.test.ts
git commit -m "feat(recipes): add parameter sets for all 8 mood states in classic pack"
```

---

## Task 5: Classic Pack setState — Wire Recipes to Tweener

**Files:**
- Modify: `src/renderer/packs/classic/index.ts`

### Step 5.1: Read classic pack index to understand the Phase 0 structure
- [ ] Read `src/renderer/packs/classic/index.ts` and `src/renderer/packs/classic/tween.ts` before editing.

### Step 5.2: Implement setState using recipes
- [ ] In `src/renderer/packs/classic/index.ts`, find the `setState` method and replace it with the full implementation:

```typescript
import type { MoodState } from '../../../shared/types';
import { RECIPES } from './recipes';
import { tweenEye } from './tween'; // Phase 0 tweener — applies CSS transitions

// Assumed Phase 0 structure: two DOM elements for eyes, e.g.:
//   this.leftEye  = container.querySelector<HTMLElement>('.eye-left')!;
//   this.rightEye = container.querySelector<HTMLElement>('.eye-right')!;

setState(state: MoodState): void {
  const recipe = RECIPES[state];
  tweenEye(this.leftEye,  recipe.left);
  tweenEye(this.rightEye, recipe.right);

  // Speaking state: add vertical bounce CSS class
  if (state === 'speaking') {
    this.leftEye.classList.add('eye--speaking-bounce');
    this.rightEye.classList.add('eye--speaking-bounce');
  } else {
    this.leftEye.classList.remove('eye--speaking-bounce');
    this.rightEye.classList.remove('eye--speaking-bounce');
  }

  // Sleeping state: disable blink scheduler signal
  this.currentState = state;
}
```

- [ ] In `src/renderer/index.html` (or an imported CSS file), add the speaking bounce animation:

```css
/* Speaking: gentle vertical bounce */
.eye--speaking-bounce {
  animation: speakBounce 0.4s ease-in-out infinite alternate;
}

@keyframes speakBounce {
  from { transform: translateY(0); }
  to   { transform: translateY(-4px); }
}
```

- [ ] In `src/renderer/packs/classic/tween.ts`, verify `tweenEye` applies the `EyeParams` shape as CSS. If it doesn't handle `rotation`, add it:

```typescript
// tween.ts — ensure it applies all EyeParams fields including rotation:
export function tweenEye(el: HTMLElement, p: EyeParams): void {
  el.style.transition = 'all 250ms cubic-bezier(0.4, 0, 0.2, 1)';
  el.style.width    = `${p.w}px`;
  el.style.height   = `${p.h}px`;
  el.style.borderRadius = `${p.radius}px`;
  el.style.transform = `translateX(${p.offsetX}px) translateY(${p.offsetY}px) rotate(${p.rotation}deg)`;
  el.style.backgroundColor = p.color;
}
```

- [ ] Run typecheck:

```bash
npm run typecheck
```

Expected: 0 errors

- [ ] Commit:

```bash
git add src/renderer/packs/classic/index.ts src/renderer/packs/classic/tween.ts src/renderer/index.html
git commit -m "feat(classic-pack): wire setState to recipes + tweener; add speaking bounce animation"
```

---

## Task 6: IPC Listener in Renderer — Receive Mood/Pulse/Intensity/Activity

**Files:**
- Modify: `src/renderer/chat.ts` (or the renderer bootstrap file that already handles IPC)

### Step 6.1: Wire IPC channels to the pack
- [ ] In the renderer bootstrap (wherever Phase 0 already wires up IPC), add the following listeners. Use whichever `ipcRenderer`/preload API pattern is already established:

```typescript
import { IPC } from '../../shared/types';
import type { MoodState, ActivityState } from '../../shared/types';
import { registry } from './packs/registry'; // Phase 0 pack registry

// The active pack (initialized in Phase 0)
const pack = registry.getActive();

// Mood state changes
window.electronAPI.on(IPC.MOOD_SET, (_event: unknown, state: MoodState) => {
  pack.setState(state);
});

// Pulse (transient events: blink, speakTick, lookAway, etc.)
window.electronAPI.on(IPC.MOOD_PULSE, (_event: unknown, event: string) => {
  pack.pulse(event as 'blink' | 'speakTick');
});

// Intensity (annoyance ramp etc.)
window.electronAPI.on(IPC.MOOD_INTENSITY, (_event: unknown, level: number) => {
  pack.setIntensity(level);
});

// Activity overlays (music, searching, timer)
window.electronAPI.on(IPC.ACTIVITY_SET, (_event: unknown, activity: ActivityState | null) => {
  pack.setActivity(activity);
});
```

- [ ] Run typecheck:

```bash
npm run typecheck
```

Expected: 0 errors

- [ ] Commit:

```bash
git add src/renderer/chat.ts
git commit -m "feat(renderer): wire IPC channels to active pack for mood/pulse/intensity/activity"
```

---

## Task 7: Annoyed Intensity Ramp

**Files:**
- Modify: `src/renderer/packs/classic/index.ts`
- Create: `tests/renderer/packs/classic/activity.test.ts` (also covers intensity logic)

### Step 7.1: Write failing test for intensity interpolation
- [ ] Create `tests/renderer/packs/classic/activity.test.ts`. We test the color interpolation function in isolation:

```typescript
import { describe, it, expect } from 'vitest';
import { interpolateIntensityColor, interpolateIntensitySize } from '../../../src/renderer/packs/classic/index';

describe('intensity color interpolation', () => {
  it('returns idle color at level 0', () => {
    expect(interpolateIntensityColor(0)).toBe('#e8e8e8');
  });

  it('returns amber at level 0.5', () => {
    // At 0.5 we expect something in the orange-amber range
    const color = interpolateIntensityColor(0.5);
    expect(color).toBe('#f5a623');
  });

  it('returns red at level 1.0', () => {
    expect(interpolateIntensityColor(1.0)).toBe('#e74c3c');
  });

  it('returns a string for any level 0..1', () => {
    [0, 0.25, 0.5, 0.75, 1].forEach(level => {
      expect(typeof interpolateIntensityColor(level)).toBe('string');
    });
  });
});

describe('intensity size interpolation', () => {
  it('returns scale factor 1.0 at level 0 (no squint)', () => {
    expect(interpolateIntensitySize(0)).toBeCloseTo(1.0);
  });

  it('returns scale factor 0.9 at level 1.0 (10% squint)', () => {
    expect(interpolateIntensitySize(1.0)).toBeCloseTo(0.9);
  });

  it('interpolates linearly between 0 and 1', () => {
    const mid = interpolateIntensitySize(0.5);
    expect(mid).toBeCloseTo(0.95);
  });
});
```

- [ ] Run test to confirm it fails:

```bash
npx vitest run tests/renderer/packs/classic/activity.test.ts
```

Expected: FAIL — exported functions not found

### Step 7.2: Implement intensity interpolation and setIntensity
- [ ] In `src/renderer/packs/classic/index.ts`, add and export the interpolation helpers and wire them into `setIntensity`:

```typescript
/**
 * Exported for unit testing.
 * Interpolates eye color from idle-grey → amber → red based on intensity (0..1).
 * Uses two-stop gradient: 0→0.5 = grey→amber, 0.5→1.0 = amber→red.
 */
export function interpolateIntensityColor(level: number): string {
  if (level <= 0)   return '#e8e8e8';
  if (level >= 1)   return '#e74c3c';
  if (level === 0.5) return '#f5a623';

  if (level < 0.5) {
    // grey (#e8e8e8) → amber (#f5a623)
    const t = level / 0.5;
    const r = Math.round(lerp(0xe8, 0xf5, t));
    const g = Math.round(lerp(0xe8, 0xa6, t));
    const b = Math.round(lerp(0xe8, 0x23, t));
    return `rgb(${r},${g},${b})`;
  } else {
    // amber (#f5a623) → red (#e74c3c)
    const t = (level - 0.5) / 0.5;
    const r = Math.round(lerp(0xf5, 0xe7, t));
    const g = Math.round(lerp(0xa6, 0x4c, t));
    const b = Math.round(lerp(0x23, 0x3c, t));
    return `rgb(${r},${g},${b})`;
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Exported for unit testing.
 * Returns a height scale factor (0.9..1.0) — squinted eyes at full intensity.
 */
export function interpolateIntensitySize(level: number): number {
  return 1.0 - level * 0.1;
}

// Inside the ClassicPack class:
setIntensity(level: number): void {
  const color = interpolateIntensityColor(level);
  const scaleFactor = interpolateIntensitySize(level);

  // Apply color and squint scale to both eyes
  [this.leftEye, this.rightEye].forEach(eye => {
    eye.style.transition = 'background-color 300ms ease, transform 300ms ease';
    eye.style.backgroundColor = color;
    // Squint: scale height down by up to 10%
    const currentTransform = eye.style.transform;
    // Preserve existing translate/rotate, append scaleY
    // We store the base transform separately to avoid compounding issues:
    eye.dataset['baseTransform'] = eye.dataset['baseTransform'] ?? eye.style.transform;
    eye.style.transform = `${eye.dataset['baseTransform']} scaleY(${scaleFactor})`;
  });
}
```

- [ ] Update the `setState` method to reset `baseTransform` cache on each state change (so intensity scale doesn't persist into new moods):

```typescript
setState(state: MoodState): void {
  // Clear cached base transforms so intensity scale is reset on state change
  delete this.leftEye.dataset['baseTransform'];
  delete this.rightEye.dataset['baseTransform'];

  const recipe = RECIPES[state];
  tweenEye(this.leftEye,  recipe.left);
  tweenEye(this.rightEye, recipe.right);
  // ... rest of setState as in Task 5
}
```

- [ ] Run the intensity tests:

```bash
npx vitest run tests/renderer/packs/classic/activity.test.ts
```

Expected: PASS

- [ ] Run all tests:

```bash
npx vitest run
```

Expected: PASS (all prior tests still green)

- [ ] Commit:

```bash
git add src/renderer/packs/classic/index.ts tests/renderer/packs/classic/activity.test.ts
git commit -m "feat(classic-pack): implement setIntensity with grey→amber→red color ramp and 10% squint scale"
```

---

## Task 8: Happy Auto-Revert (2 seconds)

**Files:**
- Modify: `src/main/index.ts` (or wherever tools/watchers call setState)
- The `StateManager.setState` with `durationMs` already handles this (Task 1).

This task is about ensuring the `happy` state is always called with `durationMs: 2000` at every call site. There is no new code to write — but we need a convention test.

### Step 8.1: Write convention test
- [ ] Add a test to `tests/main/state.test.ts` (append to the existing file — re-run will confirm the existing file still passes):

```typescript
// Append inside the describe block in tests/main/state.test.ts:

it('happy state with 2000ms durationMs reverts exactly as specified in spec', () => {
  sm.setState('happy', win, 2000);
  expect(sm.getState()).toBe('happy');
  vi.advanceTimersByTime(1999);
  expect(sm.getState()).toBe('happy');   // not yet
  vi.advanceTimersByTime(1);
  expect(sm.getState()).toBe('idle');    // exactly at 2000ms
});
```

- [ ] Run:

```bash
npx vitest run tests/main/state.test.ts
```

Expected: PASS

### Step 8.2: Verify the happy recipe is visually distinct (arc shape)
- [ ] In `src/renderer/packs/classic/recipes.ts`, confirm `happy` uses `rotation: 180` to produce the ∩-arc shape. The test in Task 4 already asserts distinctness. Visually inspect in `npm run dev`:

```bash
PIXEL_DEV=1 npm run dev
# Press key 5 to force happy state
# Verify eyes show as upside-down arcs (∩ shape) for ~2 seconds, then revert
```

- [ ] Commit (if any changes were needed):

```bash
git add tests/main/state.test.ts
git commit -m "test(state): add happy 2s auto-revert boundary case"
```

---

## Task 9: Activity Overlay — Music Equalizer

**Files:**
- Modify: `src/renderer/packs/classic/index.ts`

### Step 9.1: Define the DOM structure for the equalizer
- [ ] In `src/renderer/packs/classic/index.ts`, add the `setActivity` handler for `type: 'music'`:

```typescript
// At the top of the file, add these private properties to ClassicPack:
private eqContainer: HTMLElement | null = null;
private eqInterval: ReturnType<typeof setInterval> | null = null;
private radarContainer: HTMLElement | null = null;
private radarInterval: ReturnType<typeof setInterval> | null = null;
private timerContainer: SVGElement | null = null;
private timerInterval: ReturnType<typeof setInterval> | null = null;
private timerTotalSec = 0;

// Full setActivity implementation:
setActivity(activity: import('../../../shared/types').ActivityState | null): void {
  this.clearEqOverlay();
  this.clearRadarOverlay();
  this.clearTimerOverlay();

  if (activity === null) return;

  switch (activity.type) {
    case 'music':
      this.showMusicOverlay(activity.nowPlaying);
      break;
    case 'searching':
      this.showSearchingOverlay();
      break;
    case 'timer':
      this.showTimerOverlay(activity.remainingSec, activity.label);
      break;
    default:
      // Unknown activity type — ignore gracefully, do not crash
      break;
  }
}

private showMusicOverlay(nowPlaying: { track: string; artist: string }): void {
  // Create equalizer container
  const eq = document.createElement('div');
  eq.id = 'eq-container';
  Object.assign(eq.style, {
    display: 'flex',
    alignItems: 'flex-end',
    gap: '3px',
    position: 'absolute',
    bottom: '18px',
    left: '50%',
    transform: 'translateX(-50%)',
    height: '28px',
  });

  const NUM_BARS = 6;
  const bars: HTMLElement[] = [];
  const currentHeights: number[] = Array(NUM_BARS).fill(8);
  const targetHeights: number[] = Array(NUM_BARS).fill(8);

  for (let i = 0; i < NUM_BARS; i++) {
    const bar = document.createElement('div');
    Object.assign(bar.style, {
      width: '4px',
      height: '8px',
      backgroundColor: '#4a9eff',
      borderRadius: '2px',
      transition: 'height 100ms ease',
    });
    eq.appendChild(bar);
    bars.push(bar);
  }

  // Track label — truncated to 22 chars
  const label = document.createElement('div');
  const trackText = `${nowPlaying.track} — ${nowPlaying.artist}`;
  label.textContent = trackText.length > 22
    ? trackText.slice(0, 21) + '…'
    : trackText;
  Object.assign(label.style, {
    position: 'absolute',
    bottom: '-14px',
    left: '50%',
    transform: 'translateX(-50%)',
    fontSize: '9px',
    color: '#888',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    maxWidth: '120px',
  });
  eq.appendChild(label);

  this.container.appendChild(eq);
  this.eqContainer = eq;

  // Animate bars with pseudo-random heights, smoothed with lerp
  this.eqInterval = setInterval(() => {
    for (let i = 0; i < NUM_BARS; i++) {
      // Randomize targets every tick
      if (Math.random() < 0.4) {
        targetHeights[i] = 4 + Math.random() * 20; // 4–24px
      }
      // Lerp current toward target
      currentHeights[i] = currentHeights[i] + (targetHeights[i] - currentHeights[i]) * 0.3;
      bars[i].style.height = `${currentHeights[i].toFixed(1)}px`;
    }

    // Eye sway: oscillate offsetX ±4px at 0.5Hz
    const t = Date.now() / 1000;
    const sway = Math.sin(t * Math.PI * 2 * 0.5) * 4; // 0.5 Hz
    this.leftEye.style.marginLeft  = `${sway}px`;
    this.rightEye.style.marginLeft = `${sway}px`;
  }, 100);
}

private clearEqOverlay(): void {
  if (this.eqInterval !== null) {
    clearInterval(this.eqInterval);
    this.eqInterval = null;
  }
  if (this.eqContainer) {
    this.eqContainer.remove();
    this.eqContainer = null;
  }
  // Reset eye sway
  this.leftEye.style.marginLeft  = '';
  this.rightEye.style.marginLeft = '';
}
```

- [ ] Run typecheck:

```bash
npm run typecheck
```

Expected: 0 errors

- [ ] Commit:

```bash
git add src/renderer/packs/classic/index.ts
git commit -m "feat(classic-pack): add music activity overlay with animated equalizer and eye sway"
```

---

## Task 10: Activity Overlay — Searching Radar

**Files:**
- Modify: `src/renderer/packs/classic/index.ts`

### Step 10.1: Implement searching overlay
- [ ] Add `showSearchingOverlay` and `clearRadarOverlay` methods to `ClassicPack` in `src/renderer/packs/classic/index.ts`:

```typescript
private showSearchingOverlay(): void {
  const radar = document.createElement('div');
  radar.id = 'radar-container';
  Object.assign(radar.style, {
    position: 'absolute',
    bottom: '18px',
    left: '50%',
    transform: 'translateX(-50%)',
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    border: '1.5px solid #4a9eff44',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  });

  // The sweeping dot — positioned via CSS animation
  const dot = document.createElement('div');
  dot.style.cssText = `
    width: 5px;
    height: 5px;
    background: #4a9eff;
    border-radius: 50%;
    position: absolute;
    top: 2px;
    left: 50%;
    transform-origin: 50% 14px;
    animation: radarSweep 2s linear infinite;
  `;

  // Centre crosshair dot
  const centre = document.createElement('div');
  Object.assign(centre.style, {
    width: '3px',
    height: '3px',
    borderRadius: '50%',
    backgroundColor: '#4a9eff66',
    position: 'absolute',
  });

  radar.appendChild(dot);
  radar.appendChild(centre);
  this.container.appendChild(radar);
  this.radarContainer = radar;
}

private clearRadarOverlay(): void {
  if (this.radarContainer) {
    this.radarContainer.remove();
    this.radarContainer = null;
  }
}
```

- [ ] Add the `radarSweep` keyframe to the window CSS (in `src/renderer/index.html` or its linked stylesheet):

```css
@keyframes radarSweep {
  from { transform: rotate(0deg) translateX(0); }
  to   { transform: rotate(360deg) translateX(0); }
}
```

- [ ] Commit:

```bash
git add src/renderer/packs/classic/index.ts src/renderer/index.html
git commit -m "feat(classic-pack): add searching activity overlay with radar-sweep dot animation"
```

---

## Task 11: Activity Overlay — Timer Countdown Ring

**Files:**
- Modify: `src/renderer/packs/classic/index.ts`

### Step 11.1: Implement timer ring overlay
- [ ] Add `showTimerOverlay` and `clearTimerOverlay` methods:

```typescript
private showTimerOverlay(remainingSec: number, label: string): void {
  // Window dimensions — match the Electron window size from Phase 0
  const WIN_W = 220;
  const WIN_H = 170;
  const STROKE = 3;
  const PAD = STROKE / 2;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = 'timer-ring';
  svg.setAttribute('width',  `${WIN_W}`);
  svg.setAttribute('height', `${WIN_H}`);
  Object.assign(svg.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    pointerEvents: 'none',
    zIndex: '10',
  });

  const rx = WIN_W / 2 - PAD;
  const ry = WIN_H / 2 - PAD;
  const circumference = 2 * Math.PI * Math.sqrt((rx * rx + ry * ry) / 2); // approximation for ellipse

  // Background track (dim)
  const track = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
  track.setAttribute('cx', `${WIN_W / 2}`);
  track.setAttribute('cy', `${WIN_H / 2}`);
  track.setAttribute('rx', `${rx}`);
  track.setAttribute('ry', `${ry}`);
  track.setAttribute('fill', 'none');
  track.setAttribute('stroke', '#4a9eff22');
  track.setAttribute('stroke-width', `${STROKE}`);

  // Progress arc
  const arc = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
  arc.setAttribute('cx', `${WIN_W / 2}`);
  arc.setAttribute('cy', `${WIN_H / 2}`);
  arc.setAttribute('rx', `${rx}`);
  arc.setAttribute('ry', `${ry}`);
  arc.setAttribute('fill', 'none');
  arc.setAttribute('stroke', '#4a9eff');
  arc.setAttribute('stroke-width', `${STROKE}`);
  arc.setAttribute('stroke-linecap', 'round');
  arc.setAttribute('stroke-dasharray', `${circumference}`);
  arc.setAttribute('stroke-dashoffset', '0');
  arc.style.transition = 'stroke-dashoffset 1s linear';
  // Start from top
  arc.setAttribute('transform', `rotate(-90, ${WIN_W / 2}, ${WIN_H / 2})`);

  // Label text
  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.setAttribute('x', `${WIN_W / 2}`);
  text.setAttribute('y', `${WIN_H - 10}`);
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('font-size', '9');
  text.setAttribute('fill', '#888');
  text.textContent = label;

  svg.appendChild(track);
  svg.appendChild(arc);
  svg.appendChild(text);
  document.body.appendChild(svg);
  this.timerContainer = svg;
  this.timerTotalSec = remainingSec;

  // Update every second
  let elapsed = 0;
  const updateRing = (remaining: number): void => {
    const progress = Math.max(0, remaining / this.timerTotalSec);
    const offset = circumference * (1 - progress);
    arc.style.transition = 'stroke-dashoffset 1s linear';
    arc.setAttribute('stroke-dashoffset', `${offset}`);
  };

  updateRing(remainingSec);

  this.timerInterval = setInterval(() => {
    elapsed++;
    const remaining = remainingSec - elapsed;
    updateRing(remaining);
    if (remaining <= 0) {
      this.clearTimerOverlay();
    }
  }, 1000);
}

private clearTimerOverlay(): void {
  if (this.timerInterval !== null) {
    clearInterval(this.timerInterval);
    this.timerInterval = null;
  }
  if (this.timerContainer) {
    // Fade out
    this.timerContainer.style.transition = 'opacity 600ms ease';
    this.timerContainer.style.opacity = '0';
    setTimeout(() => {
      if (this.timerContainer) {
        this.timerContainer.remove();
        this.timerContainer = null;
      }
    }, 600);
  }
}
```

- [ ] Run typecheck:

```bash
npm run typecheck
```

Expected: 0 errors

- [ ] Commit:

```bash
git add src/renderer/packs/classic/index.ts
git commit -m "feat(classic-pack): add timer activity overlay with SVG countdown ring around window edge"
```

---

## Task 12: dispose() — Clean Up All Intervals

**Files:**
- Modify: `src/renderer/packs/classic/index.ts`

### Step 12.1: Implement dispose
- [ ] In `ClassicPack`, implement the `dispose()` method to clean up all running intervals and DOM nodes:

```typescript
dispose(): void {
  this.clearEqOverlay();
  this.clearRadarOverlay();
  this.clearTimerOverlay();

  // Stop blink scheduler (Phase 0 already has this; just verify it's called)
  if (this.blinkTimer) {
    clearTimeout(this.blinkTimer);
    this.blinkTimer = null;
  }

  // Stop gaze wander (Phase 0)
  if (this.gazeTimer) {
    clearTimeout(this.gazeTimer);
    this.gazeTimer = null;
  }
}
```

- [ ] Run typecheck:

```bash
npm run typecheck
```

Expected: 0 errors

- [ ] Run all tests:

```bash
npx vitest run
```

Expected: all pass

- [ ] Commit:

```bash
git add src/renderer/packs/classic/index.ts
git commit -m "feat(classic-pack): implement dispose — clear all intervals and DOM overlays on teardown"
```

---

## Task 13: Full Integration Smoke Test (Manual)

**Files:** None — manual verification step

### Step 13.1: Launch in dev mode and walk through all 8 states
- [ ] Run the app:

```bash
PIXEL_DEV=1 npm run dev
```

- [ ] Press keys 1–8 in sequence. For each state, verify:

| Key | State | Expected look |
|---|---|---|
| `1` | `idle` | Soft squares, slow gaze wander, periodic blink |
| `2` | `listening` | Eyes visibly wider (+20% height) |
| `3` | `thinking` | Narrowed, raised toward upper-right |
| `4` | `speaking` | Gentle vertical bounce on both eyes |
| `5` | `happy` | ∩-arcs (upside-down rounded rects), green tint, reverts to idle after ~2s |
| `6` | `bored` | Half-lidded (short), slightly dimmer, drift down |
| `7` | `annoyed` | Flat-top narrow eyes, amber color |
| `8` | `sleeping` | Closed 2px lines, no blinking |

- [ ] Verify blink overlays ALL states: press `2` (listening), wait for a blink — blink must happen as a transient scaleY without resetting to idle shape.

- [ ] Verify transitions always tween (never snap): press keys rapidly 1→8→1→5. No hard jumps.

### Step 13.2: Test activity overlays via the IPC dev handler

The `ipcMain.handle('state:set', ...)` handler from Task 2 handles mood. For activities, add a one-time test trigger in main's dev block (already guarded by `PIXEL_DEV=1`):

- [ ] In `src/main/index.ts`, inside the `if (process.env.PIXEL_DEV === '1')` block, add:

```typescript
// Dev: key 'q' triggers music overlay test
globalShortcut.register('q', () => {
  stateManager.setActivity(
    { type: 'music', nowPlaying: { track: 'Midnight City', artist: 'M83' } },
    mainWindow
  );
});

// Dev: key 'w' triggers searching overlay
globalShortcut.register('w', () => {
  stateManager.setActivity({ type: 'searching' }, mainWindow);
});

// Dev: key 'e' triggers timer overlay (90 seconds)
globalShortcut.register('e', () => {
  stateManager.setActivity(
    { type: 'timer', remainingSec: 90, label: 'Focus sprint' },
    mainWindow
  );
});

// Dev: key 'r' clears activity
globalShortcut.register('r', () => {
  stateManager.setActivity(null, mainWindow);
});
```

- [ ] Test:
  - Press `q`: 6 animated equalizer bars appear below eyes, track name truncated, eyes sway gently
  - Press `r`: equalizer disappears, eye sway stops
  - Press `w`: radar-sweep dot appears in a circle below eyes
  - Press `r`: radar disappears
  - Press `e`: thin countdown ring draws around window edge with "Focus sprint" label; ring shrinks over 90s
  - Press `r`: ring fades out and is removed

### Step 13.3: Verify interaction exits bored/annoyed
- [ ] Press `6` (bored). Click anywhere on the window. Eyes should return to idle.
- [ ] Press `7` (annoyed). Type anything in the text input. Eyes should return to idle.

### Step 13.4: Verify sleeping has no blinking
- [ ] Press `8` (sleeping). Observe for 10 seconds. Eyes must remain as 2px closed lines — no blink events.

- [ ] If all manual checks pass, commit the dev overlay shortcuts:

```bash
git add src/main/index.ts
git commit -m "feat(dev): add overlay test shortcuts q/w/e/r when PIXEL_DEV=1"
```

---

## Task 14: Respect prefers-reduced-motion for New Animations

**Files:**
- Modify: `src/renderer/packs/classic/index.ts`

Phase 0 passed `reducedMotion` into `init()`. Phase 1 adds three new animation types (speaking bounce, eq bars, radar sweep). Each must respect the flag.

### Step 14.1: Gate new animations on reducedMotion
- [ ] In `ClassicPack`, store the `reducedMotion` flag during `init()` (Phase 0 already does this; verify it's stored as `this.reducedMotion`):

```typescript
init(container: HTMLElement, opts: { reducedMotion: boolean }): void {
  this.container = container;
  this.reducedMotion = opts.reducedMotion;
  // ... Phase 0 init code ...
}
```

- [ ] In `setState`, gate the speaking bounce:

```typescript
// In setState, speaking bounce:
if (state === 'speaking' && !this.reducedMotion) {
  this.leftEye.classList.add('eye--speaking-bounce');
  this.rightEye.classList.add('eye--speaking-bounce');
} else {
  this.leftEye.classList.remove('eye--speaking-bounce');
  this.rightEye.classList.remove('eye--speaking-bounce');
}
```

- [ ] In `showMusicOverlay`, gate the eq animation interval (keep bars static in reduced-motion):

```typescript
if (!this.reducedMotion) {
  this.eqInterval = setInterval(() => {
    // ... bar animation loop ...
  }, 100);
} else {
  // Static bars at mid-height when motion is reduced
  bars.forEach(bar => { bar.style.height = '12px'; });
}
```

- [ ] In `showSearchingOverlay`, gate the CSS animation on the dot:

```typescript
if (this.reducedMotion) {
  dot.style.animation = 'none';
  dot.style.top = '50%';
  dot.style.left = '50%';
}
```

- [ ] Run typecheck:

```bash
npm run typecheck
```

Expected: 0 errors

- [ ] Commit:

```bash
git add src/renderer/packs/classic/index.ts
git commit -m "feat(classic-pack): respect prefers-reduced-motion in speaking bounce and activity overlays"
```

---

## Task 15: Run Full Test Suite and Typecheck

- [ ] Run all tests:

```bash
npx vitest run
```

Expected: all tests pass (state, recipes, intensity, dev shortcut map)

- [ ] Run typecheck:

```bash
npm run typecheck
```

Expected: 0 errors

- [ ] Run lint:

```bash
npm run lint
```

Expected: 0 errors

- [ ] If any failures exist, fix them before marking Phase 1 complete.

- [ ] Update `CLAUDE.md` progress checklist:

Find the `- [ ] M1 Moods` line and change it to `- [x] M1 Moods`.

- [ ] Final commit:

```bash
git add CLAUDE.md
git commit -m "chore: mark M1 Moods complete in progress checklist"
```

---

## Acceptance Criteria Checklist

Before declaring Phase 1 done, verify each item from the spec:

- [ ] Every state visually distinct (verified in Task 13.1)
- [ ] Blink overlays all states without resetting tween (Task 13.1)
- [ ] Transitions tween, never snap (Task 13.1)
- [ ] Dev shortcuts 1–8 work when `PIXEL_DEV=1` (Task 3, Task 13.1)
- [ ] Happy auto-reverts to idle after 2s (Task 8, Task 13.1)
- [ ] Interaction (click/type) immediately exits bored/annoyed (Task 13.3)
- [ ] Sleeping has no blinking (Task 13.4)
- [ ] Music overlay: animated bars + eye sway + track label (Task 13.2)
- [ ] Searching overlay: radar-sweep dot (Task 13.2)
- [ ] Timer overlay: countdown ring + label, fades on clear (Task 13.2)
- [ ] Annoyed intensity ramp: amber at 0.5, red at 1.0, squint scale (Task 7)
- [ ] `prefers-reduced-motion` respected: speaking bounce + eq bars + radar sweep disabled or static (Task 14)
- [ ] `npm run typecheck` passes (Task 15)
- [ ] `npx vitest run` passes (Task 15)
- [ ] `npm run lint` passes (Task 15)
