# Phase 6: Vision & Work-Signal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace direct watcher→mood wiring with a scored fusion module and add opt-in camera presence detection.

**Architecture:** cadenceWatcher + focusWatcher + presenceWatcher each report facts to workSignalRunner every 30s; workSignalRunner calls computeFocusScore() and detectEvent() to decide moods and callouts. Camera pipeline lives entirely in renderer — only PresenceFact (present/attention/confidence) crosses IPC, never pixels. The Phase 2 watcher→mood direct wiring is removed and replaced by workSignalRunner as the sole arbiter of observation-driven moods.

**Tech Stack:** @mediapipe/tasks-vision (verify best binding at impl time), Electron powerMonitor, AppleScript via osascript.ts, Jest + ts-jest, TypeScript strict mode.

---

## Prerequisites

- Phase 2 complete: idleWatcher, focusWatcher, calloutManager, watcher registry all exist and pass tests.
- Phase 3 complete: Tool registry, brain, IPC constants in `src/shared/types.ts`.
- `src/shared/types.ts` contains `MoodState`, `Config`, `WatcherContext`, `Watcher`, `ActivityState`, `IPC`.
- `src/main/core/osascript.ts` exists with `runScript()`.
- `src/main/watchers/registry.ts` exists with `registerWatcher`, `startAll`, `stopAll`, `resetAllWindows`.
- `src/main/calloutManager.ts` exists with `requestCallout`, `pauseWatching`, `setMeetingQuiet`.

---

## Shared Types Reference

These types must exist in `src/shared/types.ts` before any task below compiles. Verify they are present or add them:

```typescript
// src/shared/types.ts — additions for Phase 6

export type InputCadence = 'none' | 'sporadic' | 'steady';
export type AttentionState = 'screen' | 'away' | 'down';
export type AppClass = 'work' | 'distraction' | 'neutral' | 'meeting';

export interface PresenceFact {
  present: boolean;
  attention: AttentionState;
  confidence: number;
}

export interface WorkSignalInput {
  appClass: AppClass;
  inputCadence: InputCadence;
  presence: PresenceFact | null;
}

export interface WorkSignalOutput {
  focusScore: number; // 0..1
  event?: 'distraction' | 'away' | 'returned' | 'deepWork' | 'deepWorkEnd';
}

// Add to existing IPC object:
// VISION_PRESENCE: 'vision:presence'
// MEETING_QUIET: 'meeting:quiet'
// MEETING_ACTIVE: 'meeting:active'
```

The `IPC` object in `src/shared/types.ts` must also include:
```typescript
export const IPC = {
  // ... existing entries ...
  VISION_PRESENCE: 'vision:presence',
  MEETING_QUIET:   'meeting:quiet',
  MEETING_ACTIVE:  'meeting:active',
} as const;
```

---

## File Map

**New files to create:**

```
src/shared/types.ts                                  # add Phase 6 types (modify existing)
src/main/watchers/cadence/index.ts                   # InputCadence from idle-time deltas
src/main/watchers/cadence/__tests__/cadence.test.ts
src/main/watchers/focus/classify.ts                  # enhanced pure classifyApp() function
src/main/watchers/focus/__tests__/classify.test.ts   # replaces/extends Phase 2 tests
src/main/watchers/workSignal.ts                      # pure computeFocusScore + detectEvent
src/main/watchers/__tests__/workSignal.test.ts
src/main/watchers/workSignalRunner.ts                # stateful runner: tick() called every 30s
src/main/watchers/__tests__/workSignalRunner.test.ts
src/main/watchers/presence/index.ts                  # receives PresenceFact over IPC from renderer
src/main/watchers/presence/__tests__/presence.test.ts
src/main/integrations/dnd.ts                         # Auto DND via AppleScript
src/main/integrations/__tests__/dnd.test.ts
src/main/stats.ts                                    # daily stats file writer
src/main/callouts/sets.ts                            # callout text sets per personality
src/renderer/vision/camera.ts                        # getUserMedia, frame sampling
src/renderer/vision/models.ts                        # on-device MediaPipe face detection
src/renderer/vision/index.ts                         # wires camera → models → IPC
```

**Files to modify:**

```
src/shared/types.ts                   # add InputCadence, AttentionState, PresenceFact, etc.
src/main/watchers/registry.ts         # register cadenceWatcher, presenceWatcher; add workSignalRunner tick
src/main/watchers/idle/index.ts       # remove direct setMood calls — report facts only
src/main/watchers/focus/index.ts      # use enhanced classify.ts; remove direct distraction→mood
src/main/index.ts                     # create WorkSignalRunner, pass to registry; IPC for vision
src/renderer/main.ts (or index.ts)    # call startVision() after window load
```

---

## Task 1: Shared types update

**Files:**
- Modify: `src/shared/types.ts`
- Test: `tests/shared/types.test.ts` (extend existing)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/shared/types.test.ts — add these tests alongside existing ones
import {
  IPC,
  // existing imports...
} from '../../src/shared/types';
import type {
  InputCadence,
  AttentionState,
  AppClass,
  PresenceFact,
  WorkSignalInput,
  WorkSignalOutput,
} from '../../src/shared/types';

test('IPC includes vision and meeting quiet keys', () => {
  expect(IPC.VISION_PRESENCE).toBe('vision:presence');
  expect(IPC.MEETING_QUIET).toBe('meeting:quiet');
  expect(IPC.MEETING_ACTIVE).toBe('meeting:active');
});

test('PresenceFact shape is correct', () => {
  const fact: PresenceFact = { present: true, attention: 'screen', confidence: 0.95 };
  expect(fact.present).toBe(true);
  expect(fact.attention).toBe('screen');
  expect(fact.confidence).toBe(0.95);
});

test('WorkSignalInput accepts null presence (camera off)', () => {
  const input: WorkSignalInput = {
    appClass: 'work',
    inputCadence: 'steady',
    presence: null,
  };
  expect(input.presence).toBeNull();
});

test('WorkSignalOutput event is optional', () => {
  const out: WorkSignalOutput = { focusScore: 0.8 };
  expect(out.event).toBeUndefined();
});
```

- [ ] **Step 2: Run test — expect FAIL (types not yet exported)**

```bash
npx jest tests/shared/types.test.ts --no-coverage
```

Expected: `FAIL` — cannot find `InputCadence`, `PresenceFact`, etc.

- [ ] **Step 3: Add types to `src/shared/types.ts`**

Open `src/shared/types.ts` and add these exports (after existing type definitions):

```typescript
// --- Phase 6 additions ---

export type InputCadence = 'none' | 'sporadic' | 'steady';
export type AttentionState = 'screen' | 'away' | 'down';

// AppClass is already present from Phase 2 — verify it includes 'meeting'
// export type AppClass = 'work' | 'distraction' | 'neutral' | 'meeting';

export interface PresenceFact {
  present: boolean;
  attention: AttentionState;
  confidence: number;
}

export interface WorkSignalInput {
  appClass: AppClass;
  inputCadence: InputCadence;
  presence: PresenceFact | null;
}

export interface WorkSignalOutput {
  focusScore: number; // 0..1
  event?: 'distraction' | 'away' | 'returned' | 'deepWork' | 'deepWorkEnd';
}
```

Also add to the `IPC` const object:

```typescript
VISION_PRESENCE: 'vision:presence',
MEETING_QUIET:   'meeting:quiet',
MEETING_ACTIVE:  'meeting:active',
```

And add to `Config`:

```typescript
// Inside Config interface, camera already exists — add awayMin if missing:
awayMin: number;          // minutes away before 'away' event fires (default 10)
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npx jest tests/shared/types.test.ts --no-coverage
```

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts tests/shared/types.test.ts
git commit -m "feat(shared): add Phase 6 types — InputCadence, PresenceFact, WorkSignalInput/Output"
```

---

## Task 2: Callout sets (personality-aware)

**Files:**
- Create: `src/main/callouts/sets.ts`
- Test: `tests/main/callouts/sets.test.ts`

This is a pure data module. workSignalRunner picks callouts from here by personality.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/main/callouts/sets.test.ts
import { getCalloutSet, pickCallout } from '../../../src/main/callouts/sets';

test('getCalloutSet returns an object with distraction, away, returned arrays', () => {
  const set = getCalloutSet('coach');
  expect(Array.isArray(set.distraction)).toBe(true);
  expect(Array.isArray(set.away)).toBe(true);
  expect(Array.isArray(set.returned)).toBe(true);
  expect(set.distraction.length).toBeGreaterThan(0);
});

test('getCalloutSet falls back to coach for unknown personality', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const set = getCalloutSet('nonexistent' as any);
  expect(set.distraction.length).toBeGreaterThan(0);
});

test('pickCallout returns a string from the array', () => {
  const arr = ['a', 'b', 'c', 'd', 'e'];
  const result = pickCallout(arr);
  expect(arr).toContain(result);
});

test('pickCallout avoids repeating the last picked item', () => {
  const arr = ['only-two', 'different'];
  const first = pickCallout(arr);
  // Run 20 times — should never get same string twice in a row
  let prev = first;
  for (let i = 0; i < 20; i++) {
    const next = pickCallout(arr);
    expect(next).not.toBe(prev);
    prev = next;
  }
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx jest tests/main/callouts/sets.test.ts --no-coverage
```

- [ ] **Step 3: Create `src/main/callouts/sets.ts`**

```typescript
// src/main/callouts/sets.ts
import type { Config } from '../../shared/types';

export interface CalloutSet {
  distraction: string[];
  away: string[];
  returned: string[];
  deepWork: string[];
}

const SETS: Record<string, CalloutSet> = {
  coach: {
    distraction: [
      'Forty minutes of that. The content will still exist after your sprint.',
      'Still there. I am just noting the time.',
      'The rabbit hole has claimed another victim. That victim is you.',
      'I am not judging. I am just watching the clock on your behalf.',
      'Fascinating choice. Truly. I wait.',
    ],
    away: [
      'You appear to have left. I will keep the lights on.',
      'Gone. Noted. The work remains.',
    ],
    returned: [
      'Welcome back. {mins} minutes. I counted.',
      'There you are. {mins} minutes. The sprint survived.',
      'Oh good, you exist. {mins} minutes.',
    ],
    deepWork: [
      'You are in the zone. Enabling Do Not Disturb.',
    ],
  },
  'drill-sergeant': {
    distraction: [
      'Get off that site. Now.',
      '{mins} minutes wasted. Clock is running.',
      'Unacceptable. Back to work.',
    ],
    away: ['AWOL. Tracking.'],
    returned: ['Back at last. {mins} minutes. Do not make it a habit.'],
    deepWork: ['Deep work engaged. DND on. No excuses now.'],
  },
  therapist: {
    distraction: [
      'I notice you have been on that site for a while. How are you feeling?',
      'Sometimes we scroll when we feel overwhelmed. That is okay. When you are ready.',
      'No judgment. But perhaps we return to the task when you feel grounded?',
    ],
    away: ['You stepped away. Rest is important. I am here when you return.'],
    returned: ['Welcome back. You were gone {mins} minutes. How do you feel?'],
    deepWork: ['Beautiful focus. I have turned on Do Not Disturb for you.'],
  },
  silent: {
    distraction: [],
    away: [],
    returned: [],
    deepWork: [],
  },
};

let _lastPicked = '';

export function getCalloutSet(personality: Config['personality']): CalloutSet {
  return SETS[personality] ?? SETS['coach'];
}

export function pickCallout(arr: string[]): string {
  if (arr.length === 0) return '';
  if (arr.length === 1) return arr[0];
  let pick: string;
  do {
    pick = arr[Math.floor(Math.random() * arr.length)];
  } while (pick === _lastPicked);
  _lastPicked = pick;
  return pick;
}

export function formatCallout(template: string, vars: { mins?: number } = {}): string {
  return template.replace('{mins}', String(vars.mins ?? 0));
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npx jest tests/main/callouts/sets.test.ts --no-coverage
```

- [ ] **Step 5: Commit**

```bash
git add src/main/callouts/sets.ts tests/main/callouts/sets.test.ts
git commit -m "feat(callouts): add personality-aware callout sets for Phase 6 workSignalRunner"
```

---

## Task 3: cadenceWatcher

**Files:**
- Create: `src/main/watchers/cadence/index.ts`
- Test: `src/main/watchers/cadence/__tests__/cadence.test.ts`

**Hard rule baked in:** NO event taps, NO key codes, NO key content. Only idle-time delta.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/main/watchers/cadence/__tests__/cadence.test.ts
import { powerMonitor } from 'electron';

jest.mock('electron', () => ({
  powerMonitor: { getSystemIdleTime: jest.fn() },
}));
const mockGetIdleTime = powerMonitor.getSystemIdleTime as jest.Mock;

jest.useFakeTimers();

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { CadenceWatcher } = require('../index') as typeof import('../index');

function makeCtx() {
  return {
    config: {} as Parameters<InstanceType<typeof CadenceWatcher>['start']>[0]['config'],
    setMood: jest.fn(),
    requestCallout: jest.fn(),
    setActivity: jest.fn(),
    log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  };
}

describe('CadenceWatcher', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
  });

  it('starts with none cadence', () => {
    const w = new CadenceWatcher();
    expect(w.getCurrentCadence()).toBe('none');
  });

  it('counts input events when idle time resets to zero', () => {
    const w = new CadenceWatcher();
    const ctx = makeCtx();

    // Sequence: idle was 5, drops to 0 = 1 input event
    mockGetIdleTime.mockReturnValueOnce(5);   // initial read
    w.start(ctx as Parameters<InstanceType<typeof CadenceWatcher>['start']>[0]);
    mockGetIdleTime.mockReturnValueOnce(0);   // idle reset
    jest.advanceTimersByTime(1000);
    mockGetIdleTime.mockReturnValueOnce(0);
    jest.advanceTimersByTime(1000);
    // prevIdleTime was 0, new is 0 — no reset detected here (still at 0)
    // Force a new drop: was 5, now 0
    mockGetIdleTime.mockReturnValueOnce(5);
    jest.advanceTimersByTime(1000);
    mockGetIdleTime.mockReturnValueOnce(0); // drops: eventCount++
    jest.advanceTimersByTime(1000);
    w.stop();
    // We do not check eventCount directly — we check that getCurrentCadence()
    // reflects the bucket after a full minute passes
  });

  it('reports none cadence when no input events in a minute', () => {
    const w = new CadenceWatcher();
    const ctx = makeCtx();
    mockGetIdleTime.mockReturnValue(30); // steady idle — no resets
    w.start(ctx as Parameters<InstanceType<typeof CadenceWatcher>['start']>[0]);
    // Advance 60 full 1-second ticks
    for (let i = 0; i < 61; i++) {
      jest.advanceTimersByTime(1000);
    }
    expect(w.getCurrentCadence()).toBe('none');
    w.stop();
  });

  it('reports sporadic for 1-9 input events per minute', () => {
    const w = new CadenceWatcher();
    const ctx = makeCtx();

    // Simulate 3 idle-time drops over 60 seconds
    let tick = 0;
    mockGetIdleTime.mockImplementation(() => {
      tick++;
      // Drop at ticks 10, 20, 30 — three input events
      if (tick === 10 || tick === 20 || tick === 30) return 0;
      return 5;
    });

    w.start(ctx as Parameters<InstanceType<typeof CadenceWatcher>['start']>[0]);
    for (let i = 0; i < 61; i++) jest.advanceTimersByTime(1000);
    expect(w.getCurrentCadence()).toBe('sporadic');
    w.stop();
  });

  it('reports steady for 10+ input events per minute', () => {
    const w = new CadenceWatcher();
    const ctx = makeCtx();

    let tick = 0;
    // Drop at every even tick — 30 drops in 60 seconds
    mockGetIdleTime.mockImplementation(() => {
      tick++;
      return tick % 2 === 0 ? 0 : 5;
    });

    w.start(ctx as Parameters<InstanceType<typeof CadenceWatcher>['start']>[0]);
    for (let i = 0; i < 61; i++) jest.advanceTimersByTime(1000);
    expect(w.getCurrentCadence()).toBe('steady');
    w.stop();
  });

  it('stop() clears the interval', () => {
    const w = new CadenceWatcher();
    const ctx = makeCtx();
    mockGetIdleTime.mockReturnValue(0);
    w.start(ctx as Parameters<InstanceType<typeof CadenceWatcher>['start']>[0]);
    w.stop();
    const callsBefore = mockGetIdleTime.mock.calls.length;
    jest.advanceTimersByTime(10_000);
    expect(mockGetIdleTime.mock.calls.length).toBe(callsBefore); // no new calls
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx jest src/main/watchers/cadence/__tests__/cadence.test.ts --no-coverage
```

Expected: `FAIL` — `CadenceWatcher` not found.

- [ ] **Step 3: Create `src/main/watchers/cadence/index.ts`**

```typescript
// src/main/watchers/cadence/index.ts
// CRITICAL PRIVACY RULE: This module ONLY reads idle time deltas.
// No event taps. No key codes. No key content. Ever.
// We count that input happened, never what it was.
import { powerMonitor } from 'electron';
import type { Watcher, WatcherContext } from '../types';
import type { InputCadence } from '../../../shared/types';

export class CadenceWatcher implements Watcher {
  readonly name = 'cadence';
  private interval?: ReturnType<typeof setInterval>;
  private prevIdleTime = 0;
  private eventCount = 0;      // idle-time drops in current minute
  private minuteStart = Date.now();
  private current: InputCadence = 'none';

  start(_ctx: WatcherContext): void {
    this.prevIdleTime = powerMonitor.getSystemIdleTime();
    this.eventCount = 0;
    this.minuteStart = Date.now();
    this.current = 'none';

    this.interval = setInterval(() => {
      const idle = powerMonitor.getSystemIdleTime(); // returns seconds
      // An idle-time reset (new value < previous) means the user touched keyboard or mouse.
      // This is the only signal we ever read — no key codes, no tap events, nothing.
      if (idle < this.prevIdleTime) {
        this.eventCount++;
      }
      this.prevIdleTime = idle;

      // Bucket into cadence label at the end of each minute
      if (Date.now() - this.minuteStart >= 60_000) {
        this.current =
          this.eventCount === 0
            ? 'none'
            : this.eventCount < 10
            ? 'sporadic'
            : 'steady';
        this.eventCount = 0;
        this.minuteStart = Date.now();
      }
    }, 1000);
  }

  stop(): void {
    clearInterval(this.interval);
    this.interval = undefined;
  }

  resetWindow(): void {
    this.eventCount = 0;
    this.minuteStart = Date.now();
    this.current = 'none';
  }

  getCurrentCadence(): InputCadence {
    return this.current;
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npx jest src/main/watchers/cadence/__tests__/cadence.test.ts --no-coverage
```

- [ ] **Step 5: Commit**

```bash
git add src/main/watchers/cadence/index.ts src/main/watchers/cadence/__tests__/cadence.test.ts
git commit -m "feat(watchers): add cadenceWatcher — idle-delta input intensity, zero key logging"
```

---

## Task 4: Enhanced focusWatcher classify.ts

**Files:**
- Create/Replace: `src/main/watchers/focus/classify.ts`
- Test: `src/main/watchers/focus/__tests__/classify.test.ts`

This is a pure function with no Electron imports — fully testable in Node.

- [ ] **Step 1: Write the failing tests (25+ cases)**

```typescript
// src/main/watchers/focus/__tests__/classify.test.ts
import { classifyApp, classifyUrl } from '../classify';
import type { Config } from '../../../../shared/types';

const baseConfig: Pick<Config, 'workApps' | 'workDomains' | 'distractionDomains'> = {
  workApps: ['Code', 'Cursor', 'iTerm2', 'Terminal', 'Figma', 'Xcode', 'Sublime Text'],
  workDomains: ['github.com', 'docs.anthropic.com', 'notion.so', 'linear.app'],
  distractionDomains: ['youtube.com', 'x.com', 'twitter.com', 'instagram.com', 'reddit.com', 'tiktok.com', 'twitch.tv'],
};

describe('classifyApp', () => {
  // Work apps by name
  it('classifies VS Code by process name', () => expect(classifyApp('Code', undefined, baseConfig)).toBe('work'));
  it('classifies Cursor by process name', () => expect(classifyApp('Cursor', undefined, baseConfig)).toBe('work'));
  it('classifies iTerm2 by process name', () => expect(classifyApp('iTerm2', undefined, baseConfig)).toBe('work'));
  it('classifies Figma by process name', () => expect(classifyApp('Figma', undefined, baseConfig)).toBe('work'));
  it('classifies Xcode by process name', () => expect(classifyApp('Xcode', undefined, baseConfig)).toBe('work'));

  // Work via URL
  it('classifies Chrome on github.com as work', () => expect(classifyApp('Google Chrome', 'https://github.com/org/repo', baseConfig)).toBe('work'));
  it('classifies Chrome on localhost:3000 as work', () => expect(classifyApp('Google Chrome', 'http://localhost:3000', baseConfig)).toBe('work'));
  it('classifies Chrome on localhost (no port) as work', () => expect(classifyApp('Safari', 'http://localhost/', baseConfig)).toBe('work'));
  it('classifies Chrome on .internal subdomain as work', () => expect(classifyApp('Arc', 'https://jira.internal/board', baseConfig)).toBe('work'));
  it('classifies Chrome on .dev TLD as work', () => expect(classifyApp('Arc', 'https://myapp.dev/', baseConfig)).toBe('work'));

  // Distraction domains
  it('classifies youtube.com as distraction', () => expect(classifyApp('Google Chrome', 'https://youtube.com/watch?v=abc', baseConfig)).toBe('distraction'));
  it('classifies www.reddit.com as distraction', () => expect(classifyApp('Safari', 'https://www.reddit.com/r/programming', baseConfig)).toBe('distraction'));
  it('classifies twitter.com as distraction', () => expect(classifyApp('Arc', 'https://twitter.com/home', baseConfig)).toBe('distraction'));
  it('classifies x.com as distraction', () => expect(classifyApp('Arc', 'https://x.com/home', baseConfig)).toBe('distraction'));
  it('classifies instagram.com as distraction', () => expect(classifyApp('Safari', 'https://instagram.com/feed', baseConfig)).toBe('distraction'));
  it('classifies tiktok.com as distraction', () => expect(classifyApp('Chrome', 'https://tiktok.com', baseConfig)).toBe('distraction'));

  // Meeting apps by process name
  it('classifies zoom.us as meeting', () => expect(classifyApp('zoom.us', undefined, baseConfig)).toBe('meeting'));
  it('classifies Microsoft Teams as meeting', () => expect(classifyApp('Microsoft Teams', undefined, baseConfig)).toBe('meeting'));
  it('classifies FaceTime as meeting', () => expect(classifyApp('FaceTime', undefined, baseConfig)).toBe('meeting'));
  it('classifies Webex as meeting', () => expect(classifyApp('Webex', undefined, baseConfig)).toBe('meeting'));

  // Meeting via browser URL
  it('classifies Chrome on meet.google.com as meeting', () => expect(classifyApp('Google Chrome', 'https://meet.google.com/abc-def-ghi', baseConfig)).toBe('meeting'));
  it('classifies Chrome on zoom.us as meeting', () => expect(classifyApp('Safari', 'https://zoom.us/j/12345', baseConfig)).toBe('meeting'));
  it('classifies Chrome on teams.microsoft.com as meeting', () => expect(classifyApp('Arc', 'https://teams.microsoft.com/l/meeting', baseConfig)).toBe('meeting'));

  // Neutral
  it('classifies Spotify as neutral', () => expect(classifyApp('Spotify', undefined, baseConfig)).toBe('neutral'));
  it('classifies Discord as neutral', () => expect(classifyApp('Discord', undefined, baseConfig)).toBe('neutral'));
  it('classifies unknown process as neutral with unknown url', () => expect(classifyApp('SomeApp', 'https://unknownsite.com', baseConfig)).toBe('neutral'));

  // Priority: meeting > distraction
  it('meeting app with distraction URL still returns meeting', () => expect(classifyApp('zoom.us', 'https://reddit.com', baseConfig)).toBe('meeting'));

  // Case insensitivity
  it('classifies lowercase cursor as work', () => expect(classifyApp('cursor', undefined, baseConfig)).toBe('work'));
  it('classifies ZOOM.US as meeting', () => expect(classifyApp('ZOOM.US', undefined, baseConfig)).toBe('meeting'));

  // Malformed URL
  it('handles malformed URL gracefully without throwing', () => {
    expect(() => classifyApp('Chrome', 'not-a-url', baseConfig)).not.toThrow();
    expect(classifyApp('Chrome', 'not-a-url', baseConfig)).toBe('neutral');
  });
});

describe('classifyUrl', () => {
  it('returns distraction for youtube.com', () => expect(classifyUrl('https://youtube.com', baseConfig)).toBe('distraction'));
  it('returns work for github.com', () => expect(classifyUrl('https://github.com/org/repo', baseConfig)).toBe('work'));
  it('returns work for localhost', () => expect(classifyUrl('http://localhost:8080', baseConfig)).toBe('work'));
  it('returns neutral for unknown domain', () => expect(classifyUrl('https://randomsite.xyz', baseConfig)).toBe('neutral'));
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx jest src/main/watchers/focus/__tests__/classify.test.ts --no-coverage
```

Expected: `FAIL` — `classifyApp` / `classifyUrl` not found or missing cases.

- [ ] **Step 3: Create `src/main/watchers/focus/classify.ts`**

```typescript
// src/main/watchers/focus/classify.ts
// ZERO Electron imports — this is a pure function, fully testable in Node.
import type { AppClass, Config } from '../../../shared/types';

const MEETING_APPS = new Set([
  'zoom.us',
  'zoom',
  'microsoft teams',
  'msteams',
  'facetime',
  'webex',
  'cisco webex meetings',
  'google meet',
]);

const MEETING_DOMAINS = [
  'meet.google.com',
  'zoom.us',
  'teams.microsoft.com',
  'chat.google.com',
];

function parseDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function matchesDomain(host: string, domains: string[]): boolean {
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

function isLocalDomain(url: string): boolean {
  const host = parseDomain(url);
  if (!host) return false;
  return (
    host === 'localhost' ||
    host.match(/^localhost:\d+$/) !== null ||
    host.endsWith('.internal') ||
    host.endsWith('.dev') ||
    host.match(/^127\./) !== null ||
    host.match(/^192\.168\./) !== null ||
    host.match(/^10\./) !== null
  );
}

/**
 * Classify a URL into work | distraction | neutral.
 * Pure function — no side effects.
 */
export function classifyUrl(
  url: string,
  config: Pick<Config, 'workDomains' | 'distractionDomains'>,
): Exclude<AppClass, 'meeting'> {
  if (isLocalDomain(url)) return 'work';
  const host = parseDomain(url);
  if (!host) return 'neutral';
  if (matchesDomain(host, config.distractionDomains)) return 'distraction';
  if (matchesDomain(host, config.workDomains)) return 'work';
  return 'neutral';
}

/**
 * Classify a frontmost app + optional active-tab URL into AppClass.
 * Priority order: meeting > work-by-name > url-based > neutral.
 * Pure function — no side effects, no Electron imports.
 *
 * @param appName  Process name from System Events (case-insensitive).
 * @param url      Active tab URL if browser is frontmost; undefined otherwise.
 * @param config   Config subset (workApps, workDomains, distractionDomains).
 */
export function classifyApp(
  appName: string,
  url: string | undefined,
  config: Pick<Config, 'workApps' | 'workDomains' | 'distractionDomains'>,
): AppClass {
  const nameLower = appName.toLowerCase();

  // 1. Meeting apps always win — quiet mode must be reliable
  if (MEETING_APPS.has(nameLower)) return 'meeting';
  if (url) {
    const host = parseDomain(url);
    if (host && matchesDomain(host, MEETING_DOMAINS)) return 'meeting';
  }

  // 2. Work apps by process name
  if (config.workApps.some((a) => a.toLowerCase() === nameLower)) return 'work';

  // 3. URL-based classification (only if url present)
  if (url) {
    return classifyUrl(url, config);
  }

  return 'neutral';
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npx jest src/main/watchers/focus/__tests__/classify.test.ts --no-coverage
```

- [ ] **Step 5: Commit**

```bash
git add src/main/watchers/focus/classify.ts src/main/watchers/focus/__tests__/classify.test.ts
git commit -m "feat(watchers): enhanced classifyApp — meeting priority, local domains, standalone URL classifier"
```

---

## Task 5: workSignal pure module

**Files:**
- Create: `src/main/watchers/workSignal.ts`
- Test: `src/main/watchers/__tests__/workSignal.test.ts`

Zero Electron imports. Pure functions only.

- [ ] **Step 1: Write the failing tests (20+ cases)**

```typescript
// src/main/watchers/__tests__/workSignal.test.ts
import {
  computeFocusScore,
  detectEvent,
} from '../workSignal';
import type { WorkSignalInput, WorkSignalOutput } from '../../../shared/types';

function input(
  appClass: WorkSignalInput['appClass'],
  cadence: WorkSignalInput['inputCadence'],
  presence: WorkSignalInput['presence'] = null,
): WorkSignalInput {
  return { appClass, inputCadence: cadence, presence };
}

function hist(scores: number[]): WorkSignalOutput[] {
  return scores.map((s) => ({ focusScore: s }));
}

describe('computeFocusScore', () => {
  // No camera (presence=null)
  it('work + steady = high score ~0.9', () => {
    expect(computeFocusScore(input('work', 'steady'))).toBeCloseTo(0.9, 1);
  });
  it('work + sporadic = ~0.75', () => {
    expect(computeFocusScore(input('work', 'sporadic'))).toBeCloseTo(0.75, 1);
  });
  it('work + none = ~0.6', () => {
    expect(computeFocusScore(input('work', 'none'))).toBeCloseTo(0.6, 1);
  });
  it('neutral + steady = ~0.6', () => {
    expect(computeFocusScore(input('neutral', 'steady'))).toBeCloseTo(0.6, 1);
  });
  it('neutral + none = ~0.3', () => {
    expect(computeFocusScore(input('neutral', 'none'))).toBeCloseTo(0.3, 1);
  });
  it('distraction + steady = ~0.3', () => {
    expect(computeFocusScore(input('distraction', 'steady'))).toBeCloseTo(0.3, 1);
  });
  it('distraction + none = ~0.0 (floored)', () => {
    expect(computeFocusScore(input('distraction', 'none'))).toBeLessThanOrEqual(0.1);
  });
  it('meeting + steady = ~0.7', () => {
    expect(computeFocusScore(input('meeting', 'steady'))).toBeCloseTo(0.7, 1);
  });

  // Camera present, attention=screen
  it('work + steady + screen = ~1.0 (capped)', () => {
    const score = computeFocusScore(input('work', 'steady', { present: true, attention: 'screen', confidence: 0.9 }));
    expect(score).toBe(1);
  });
  it('distraction + none + attention=down = 0 or near 0', () => {
    const score = computeFocusScore(input('distraction', 'none', { present: true, attention: 'down', confidence: 0.9 }));
    expect(score).toBe(0);
  });

  // Away (present=false) always = 0
  it('work + steady + present=false = 0', () => {
    expect(computeFocusScore(input('work', 'steady', { present: false, attention: 'away', confidence: 0.9 }))).toBe(0);
  });
  it('neutral + none + present=false = 0', () => {
    expect(computeFocusScore(input('neutral', 'none', { present: false, attention: 'away', confidence: 0.8 }))).toBe(0);
  });

  // Score is always clamped [0, 1]
  it('score never exceeds 1', () => {
    expect(computeFocusScore(input('work', 'steady', { present: true, attention: 'screen', confidence: 1 }))).toBeLessThanOrEqual(1);
  });
  it('score never goes below 0', () => {
    expect(computeFocusScore(input('distraction', 'none', { present: true, attention: 'down', confidence: 1 }))).toBeGreaterThanOrEqual(0);
  });
});

describe('detectEvent', () => {
  it('returns away when present=false', () => {
    expect(detectEvent(hist([0.8, 0.8, 0.8]), 0, input('work', 'steady', { present: false, attention: 'away', confidence: 0.9 }), false, false)).toBe('away');
  });

  it('returns returned when was away and now present', () => {
    expect(detectEvent(hist([0, 0, 0]), 0.7, input('work', 'sporadic', { present: true, attention: 'screen', confidence: 0.9 }), true, false)).toBe('returned');
  });

  it('does NOT return returned when was not away', () => {
    expect(detectEvent(hist([0.8, 0.8, 0.8]), 0.7, input('work', 'steady', { present: true, attention: 'screen', confidence: 0.9 }), false, false)).toBeUndefined();
  });

  it('returns deepWork when score > 0.8 for 3 consecutive ticks and was not deepWork', () => {
    expect(detectEvent(hist([0.85, 0.9, 0.87]), 0.88, input('work', 'steady'), false, false)).toBe('deepWork');
  });

  it('does NOT return deepWork if already in deepWork', () => {
    expect(detectEvent(hist([0.85, 0.9, 0.87]), 0.88, input('work', 'steady'), false, true)).toBeUndefined();
  });

  it('does NOT return deepWork if less than 2 prior high scores', () => {
    expect(detectEvent(hist([0.5, 0.9, 0.87]), 0.88, input('work', 'steady'), false, false)).toBeUndefined();
  });

  it('returns deepWorkEnd when was deepWork and score drops below 0.6', () => {
    expect(detectEvent(hist([0.7, 0.5, 0.4]), 0.3, input('distraction', 'none'), false, true)).toBe('deepWorkEnd');
  });

  it('does NOT return deepWorkEnd if score >= 0.6', () => {
    expect(detectEvent(hist([0.8, 0.8, 0.8]), 0.65, input('work', 'sporadic'), false, true)).toBeUndefined();
  });

  it('returns distraction when score < 0.2 AND appClass=distraction AND 1 prior low score', () => {
    expect(detectEvent(hist([0.1, 0.8, 0.1]), 0.05, input('distraction', 'none'), false, false)).toBe('distraction');
  });

  it('does NOT return distraction if appClass is not distraction', () => {
    expect(detectEvent(hist([0.1, 0.1, 0.1]), 0.05, input('neutral', 'none'), false, false)).toBeUndefined();
  });

  it('does NOT return distraction if score >= 0.2', () => {
    expect(detectEvent(hist([0.1, 0.1, 0.1]), 0.3, input('distraction', 'none'), false, false)).toBeUndefined();
  });

  it('returns undefined when no event conditions are met', () => {
    expect(detectEvent(hist([0.6, 0.6, 0.6]), 0.6, input('neutral', 'sporadic'), false, false)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx jest src/main/watchers/__tests__/workSignal.test.ts --no-coverage
```

- [ ] **Step 3: Create `src/main/watchers/workSignal.ts`**

```typescript
// src/main/watchers/workSignal.ts
// ZERO Electron imports. Pure functions only.
// This module is the single arbiter of focus scoring and event detection.
// Individual watchers report facts; this module decides interpretations.
import type { WorkSignalInput, WorkSignalOutput } from '../../shared/types';

const APP_BASE: Record<WorkSignalInput['appClass'], number> = {
  work:        0.7,
  neutral:     0.4,
  distraction: 0.1,
  meeting:     0.5,
};

const CADENCE_MOD: Record<WorkSignalInput['inputCadence'], number> = {
  steady:   0.2,
  sporadic: 0.05,
  none:    -0.1,
};

/**
 * Compute a focus score 0..1 from the current work signal input.
 *
 * Score anatomy:
 *   appBase   — what app/site is frontmost (0.1 distraction → 0.7 work)
 *   cadenceMod — how actively the user is typing/moving (−0.1 → +0.2)
 *   presenceMod — head direction from camera, if available (−0.1 → +0.1)
 *
 * If camera reports present=false, score is always 0 (user is away — cannot be working).
 */
export function computeFocusScore(input: WorkSignalInput): number {
  // Away always scores 0 — you can't work if you're not at the desk
  if (input.presence && !input.presence.present) return 0;

  const appBase = APP_BASE[input.appClass];
  const cadenceMod = CADENCE_MOD[input.inputCadence];
  const presenceMod = input.presence
    ? input.presence.attention === 'screen'
      ? 0.1
      : input.presence.attention === 'down'
      ? -0.1
      : 0
    : 0;

  return Math.max(0, Math.min(1, appBase + cadenceMod + presenceMod));
}

/**
 * Detect a discrete work event from score history.
 *
 * @param history       Last 3 WorkSignalOutputs (before current tick).
 * @param currentScore  Score for the current tick.
 * @param input         Current WorkSignalInput.
 * @param prevWasAway   True if last tick had an 'away' event or user was confirmed absent.
 * @param prevWasDeepWork True if last tick had an active deepWork streak.
 */
export function detectEvent(
  history: WorkSignalOutput[],
  currentScore: number,
  input: WorkSignalInput,
  prevWasAway: boolean,
  prevWasDeepWork: boolean,
): WorkSignalOutput['event'] | undefined {
  // Away: camera says user is not present
  if (input.presence && !input.presence.present) return 'away';

  // Returned: was away, now present
  if (prevWasAway && (!input.presence || input.presence.present)) return 'returned';

  // Deep work: current score > 0.8 AND at least 2 of the last 3 scores also > 0.8
  if (
    currentScore > 0.8 &&
    history.filter((h) => h.focusScore > 0.8).length >= 2 &&
    !prevWasDeepWork
  ) {
    return 'deepWork';
  }

  // Deep work ended: was in deep work, score dropped below 0.6
  if (prevWasDeepWork && currentScore < 0.6) return 'deepWorkEnd';

  // Distraction: score < 0.2 AND app is distraction AND at least 1 prior low score
  if (
    currentScore < 0.2 &&
    input.appClass === 'distraction' &&
    history.filter((h) => h.focusScore < 0.2).length >= 1
  ) {
    return 'distraction';
  }

  return undefined;
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npx jest src/main/watchers/__tests__/workSignal.test.ts --no-coverage
```

- [ ] **Step 5: Commit**

```bash
git add src/main/watchers/workSignal.ts src/main/watchers/__tests__/workSignal.test.ts
git commit -m "feat(watchers): add pure workSignal module — computeFocusScore + detectEvent"
```

---

## Task 6: Stats writer

**Files:**
- Create: `src/main/stats.ts`
- Test: `tests/main/stats.test.ts`

workSignalRunner calls `appendFocusSample()` every tick. Stats written to `~/.pixel/stats/YYYY-MM-DD.json`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/main/stats.test.ts
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-stats-test-'));
jest.mock('os', () => ({ ...jest.requireActual('os'), homedir: () => tmpDir }));

import { appendFocusSample, getDayStats } from '../../src/main/stats';

afterEach(() => {
  const statsDir = path.join(tmpDir, '.pixel', 'stats');
  if (fs.existsSync(statsDir)) {
    for (const f of fs.readdirSync(statsDir)) {
      fs.unlinkSync(path.join(statsDir, f));
    }
  }
});

test('appendFocusSample creates the stats file with first entry', () => {
  appendFocusSample('2026-06-04', 0.8);
  const stats = getDayStats('2026-06-04');
  expect(stats).not.toBeNull();
  expect(stats!.samples.length).toBe(1);
  expect(stats!.samples[0].score).toBe(0.8);
});

test('appendFocusSample appends multiple samples', () => {
  appendFocusSample('2026-06-04', 0.5);
  appendFocusSample('2026-06-04', 0.8);
  appendFocusSample('2026-06-04', 0.3);
  const stats = getDayStats('2026-06-04');
  expect(stats!.samples.length).toBe(3);
});

test('getDayStats returns null for missing day', () => {
  expect(getDayStats('1990-01-01')).toBeNull();
});

test('samples are written per date — different dates do not mix', () => {
  appendFocusSample('2026-06-04', 0.9);
  appendFocusSample('2026-06-05', 0.2);
  expect(getDayStats('2026-06-04')!.samples.length).toBe(1);
  expect(getDayStats('2026-06-05')!.samples.length).toBe(1);
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx jest tests/main/stats.test.ts --no-coverage
```

- [ ] **Step 3: Create `src/main/stats.ts`**

```typescript
// src/main/stats.ts
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

export interface FocusSample {
  ts: string;   // ISO timestamp
  score: number;
}

export interface DayStats {
  date: string;
  samples: FocusSample[];
}

function statsPath(date: string): string {
  return path.join(os.homedir(), '.pixel', 'stats', `${date}.json`);
}

export function appendFocusSample(date: string, score: number): void {
  const p = statsPath(date);
  fs.mkdirSync(path.dirname(p), { recursive: true });

  let day: DayStats = { date, samples: [] };
  if (fs.existsSync(p)) {
    try {
      day = JSON.parse(fs.readFileSync(p, 'utf8')) as DayStats;
    } catch {
      day = { date, samples: [] };
    }
  }

  day.samples.push({ ts: new Date().toISOString(), score });
  fs.writeFileSync(p, JSON.stringify(day, null, 2), 'utf8');
}

export function getDayStats(date: string): DayStats | null {
  const p = statsPath(date);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as DayStats;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npx jest tests/main/stats.test.ts --no-coverage
```

- [ ] **Step 5: Commit**

```bash
git add src/main/stats.ts tests/main/stats.test.ts
git commit -m "feat(stats): add daily focus sample writer — ~/.pixel/stats/YYYY-MM-DD.json"
```

---

## Task 7: Auto DND integration

**Files:**
- Create: `src/main/integrations/dnd.ts`
- Test: `src/main/integrations/__tests__/dnd.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/main/integrations/__tests__/dnd.test.ts
jest.mock('../../../main/core/osascript', () => ({
  runScript: jest.fn(),
}));

import { runScript } from '../../../main/core/osascript';
const mockRunScript = runScript as jest.Mock;

// Also mock execFile for the Shortcuts fallback
import { execFile } from 'child_process';
jest.mock('child_process', () => ({ execFile: jest.fn() }));
const mockExecFile = execFile as jest.MockedFunction<typeof execFile>;

import { DND } from '../dnd';

function resolveExecFile() {
  mockExecFile.mockImplementationOnce(
    (_cmd: string, _args: string[], callback: (...args: unknown[]) => void) => {
      callback(null, '', '');
      return {} as ReturnType<typeof execFile>;
    },
  );
}

function rejectExecFile(msg: string) {
  mockExecFile.mockImplementationOnce(
    (_cmd: string, _args: string[], callback: (...args: unknown[]) => void) => {
      callback(new Error(msg), '', '');
      return {} as ReturnType<typeof execFile>;
    },
  );
}

describe('DND', () => {
  afterEach(() => jest.clearAllMocks());

  it('enable() calls System Events AppleScript to set doNotDisturb true', async () => {
    mockRunScript.mockResolvedValueOnce('');
    const dnd = new DND();
    await expect(dnd.enable()).resolves.toBeUndefined();
    expect(mockRunScript).toHaveBeenCalledWith(
      expect.stringContaining('doNotDisturb'),
    );
  });

  it('disable() calls System Events AppleScript to set doNotDisturb false', async () => {
    mockRunScript.mockResolvedValueOnce('');
    const dnd = new DND();
    await expect(dnd.disable()).resolves.toBeUndefined();
    expect(mockRunScript).toHaveBeenCalledWith(
      expect.stringContaining('doNotDisturb'),
    );
  });

  it('enable() tries Shortcuts fallback when runScript throws', async () => {
    mockRunScript.mockRejectedValueOnce(new Error('permission denied'));
    resolveExecFile();
    const dnd = new DND();
    await expect(dnd.enable()).resolves.toBeUndefined();
    expect(mockExecFile).toHaveBeenCalledWith(
      'shortcuts',
      ['run', 'Enable Focus'],
      expect.any(Function),
    );
  });

  it('disable() tries Shortcuts fallback when runScript throws', async () => {
    mockRunScript.mockRejectedValueOnce(new Error('permission denied'));
    resolveExecFile();
    const dnd = new DND();
    await expect(dnd.disable()).resolves.toBeUndefined();
    expect(mockExecFile).toHaveBeenCalledWith(
      'shortcuts',
      ['run', 'Disable Focus'],
      expect.any(Function),
    );
  });

  it('enable() does NOT throw when both runScript and Shortcuts fail', async () => {
    mockRunScript.mockRejectedValueOnce(new Error('script failed'));
    rejectExecFile('shortcuts failed');
    const dnd = new DND();
    await expect(dnd.enable()).resolves.toBeUndefined(); // no throw
  });

  it('disable() does NOT throw when both runScript and Shortcuts fail', async () => {
    mockRunScript.mockRejectedValueOnce(new Error('script failed'));
    rejectExecFile('shortcuts failed');
    const dnd = new DND();
    await expect(dnd.disable()).resolves.toBeUndefined(); // no throw
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx jest src/main/integrations/__tests__/dnd.test.ts --no-coverage
```

- [ ] **Step 3: Create `src/main/integrations/dnd.ts`**

```typescript
// src/main/integrations/dnd.ts
import { execFile } from 'child_process';
import { promisify } from 'util';
import { runScript } from '../core/osascript';

const execFileAsync = promisify(execFile);

export class DND {
  /**
   * Enable Do Not Disturb via System Events AppleScript.
   * Falls back to macOS Shortcuts if System Events DND fails (macOS version differences).
   * Never throws — all errors are swallowed silently (DND is best-effort).
   */
  async enable(): Promise<void> {
    try {
      await runScript(`tell application "System Events"
  set doNotDisturb of (current user) to true
end tell`);
    } catch {
      try {
        await execFileAsync('shortcuts', ['run', 'Enable Focus']);
      } catch {
        // Both paths failed — DND unavailable, continue silently
      }
    }
  }

  /**
   * Disable Do Not Disturb.
   * Never throws.
   */
  async disable(): Promise<void> {
    try {
      await runScript(`tell application "System Events"
  set doNotDisturb of (current user) to false
end tell`);
    } catch {
      try {
        await execFileAsync('shortcuts', ['run', 'Disable Focus']);
      } catch {
        // Both paths failed — DND unavailable, continue silently
      }
    }
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npx jest src/main/integrations/__tests__/dnd.test.ts --no-coverage
```

- [ ] **Step 5: Commit**

```bash
git add src/main/integrations/dnd.ts src/main/integrations/__tests__/dnd.test.ts
git commit -m "feat(integrations): add DND class — AppleScript + Shortcuts fallback, never throws"
```

---

## Task 8: workSignalRunner

**Files:**
- Create: `src/main/watchers/workSignalRunner.ts`
- Test: `src/main/watchers/__tests__/workSignalRunner.test.ts`

This is the stateful wrapper that calls `computeFocusScore` + `detectEvent` every 30s and translates events into moods and callouts.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/main/watchers/__tests__/workSignalRunner.test.ts
jest.mock('../workSignal', () => ({
  computeFocusScore: jest.fn(),
  detectEvent: jest.fn(),
}));
jest.mock('../../stats', () => ({
  appendFocusSample: jest.fn(),
}));
jest.mock('../../integrations/dnd', () => ({
  DND: jest.fn().mockImplementation(() => ({
    enable: jest.fn().mockResolvedValue(undefined),
    disable: jest.fn().mockResolvedValue(undefined),
  })),
}));

import { computeFocusScore, detectEvent } from '../workSignal';
import { appendFocusSample } from '../../stats';
import { DND } from '../../integrations/dnd';
import { WorkSignalRunner } from '../workSignalRunner';
import type { WorkSignalInput } from '../../../shared/types';

const mockScore = computeFocusScore as jest.Mock;
const mockDetect = detectEvent as jest.Mock;
const mockAppendStats = appendFocusSample as jest.Mock;

function makeInput(appClass: WorkSignalInput['appClass'] = 'distraction'): WorkSignalInput {
  return { appClass, inputCadence: 'none', presence: null };
}

function makeCtx(personalityOverride = 'coach') {
  const dnd = new DND();
  return {
    config: {
      personality: personalityOverride,
      calloutCooldownMin: 20,
      awayMin: 10,
      workHours: { start: '00:00', end: '23:59', days: [0,1,2,3,4,5,6] },
    } as Parameters<InstanceType<typeof WorkSignalRunner>['tick']>[1]['config'],
    setMood: jest.fn(),
    requestCallout: jest.fn(),
    setActivity: jest.fn(),
    log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    dnd,
  };
}

describe('WorkSignalRunner.tick()', () => {
  afterEach(() => jest.clearAllMocks());

  it('calls computeFocusScore with current input', () => {
    mockScore.mockReturnValue(0.5);
    mockDetect.mockReturnValue(undefined);
    const runner = new WorkSignalRunner();
    const ctx = makeCtx();
    runner.tick(makeInput('neutral'), ctx);
    expect(mockScore).toHaveBeenCalledWith(expect.objectContaining({ appClass: 'neutral' }));
  });

  it('appends focus sample to stats on each tick', () => {
    mockScore.mockReturnValue(0.7);
    mockDetect.mockReturnValue(undefined);
    const runner = new WorkSignalRunner();
    runner.tick(makeInput('work'), makeCtx());
    expect(mockAppendStats).toHaveBeenCalledWith(
      expect.any(String), // date string
      0.7,
    );
  });

  it('calls requestCallout on distraction event', () => {
    mockScore.mockReturnValue(0.05);
    mockDetect.mockReturnValue('distraction');
    const runner = new WorkSignalRunner();
    const ctx = makeCtx();
    runner.tick(makeInput('distraction'), ctx);
    expect(ctx.requestCallout).toHaveBeenCalledWith(expect.any(String));
  });

  it('does NOT call requestCallout when personality is silent', () => {
    mockScore.mockReturnValue(0.05);
    mockDetect.mockReturnValue('distraction');
    const runner = new WorkSignalRunner();
    const ctx = makeCtx('silent');
    runner.tick(makeInput('distraction'), ctx);
    expect(ctx.requestCallout).not.toHaveBeenCalled();
  });

  it('records awayStartTime on away event', () => {
    mockScore.mockReturnValue(0);
    mockDetect.mockReturnValue('away');
    const runner = new WorkSignalRunner();
    runner.tick(makeInput('neutral'), makeCtx());
    // Access private field via cast for test — just verify returned fires correctly after
  });

  it('calls requestCallout with return greeting on returned event', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-04T10:00:00Z'));
    mockScore.mockReturnValue(0);
    mockDetect.mockReturnValue('away');
    const runner = new WorkSignalRunner();
    const ctx = makeCtx();
    runner.tick(makeInput('neutral'), ctx);

    // Advance 15 minutes
    jest.advanceTimersByTime(15 * 60 * 1000);
    jest.setSystemTime(new Date('2026-06-04T10:15:00Z'));

    mockScore.mockReturnValue(0.7);
    mockDetect.mockReturnValue('returned');
    runner.tick(makeInput('work'), ctx);
    expect(ctx.requestCallout).toHaveBeenCalledWith(
      expect.stringMatching(/15 minutes/),
    );
    jest.useRealTimers();
  });

  it('enables DND on deepWork event', async () => {
    mockScore.mockReturnValue(0.9);
    mockDetect.mockReturnValue('deepWork');
    const runner = new WorkSignalRunner();
    const ctx = makeCtx();
    runner.tick(makeInput('work'), ctx);
    // DND enable is async fire-and-forget — give it a tick
    await Promise.resolve();
    expect(ctx.dnd.enable).toHaveBeenCalled();
  });

  it('disables DND on deepWorkEnd event', async () => {
    mockScore.mockReturnValue(0.4);
    mockDetect.mockReturnValue('deepWorkEnd');
    const runner = new WorkSignalRunner();
    const ctx = makeCtx();
    runner.tick(makeInput('neutral'), ctx);
    await Promise.resolve();
    expect(ctx.dnd.disable).toHaveBeenCalled();
  });

  it('caps history at 10 entries', () => {
    mockScore.mockReturnValue(0.5);
    mockDetect.mockReturnValue(undefined);
    const runner = new WorkSignalRunner();
    const ctx = makeCtx();
    for (let i = 0; i < 15; i++) runner.tick(makeInput('neutral'), ctx);
    // History should not grow unbounded — inspect via detectEvent call args
    const lastCall = mockDetect.mock.calls[mockDetect.mock.calls.length - 1];
    const historyArg = lastCall[0] as unknown[];
    expect(historyArg.length).toBeLessThanOrEqual(10);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx jest src/main/watchers/__tests__/workSignalRunner.test.ts --no-coverage
```

- [ ] **Step 3: Create `src/main/watchers/workSignalRunner.ts`**

```typescript
// src/main/watchers/workSignalRunner.ts
import { computeFocusScore, detectEvent } from './workSignal';
import { appendFocusSample } from '../stats';
import { DND } from '../integrations/dnd';
import { getCalloutSet, pickCallout, formatCallout } from '../callouts/sets';
import type { WorkSignalInput, WorkSignalOutput, WatcherContext, Config } from '../../shared/types';

export interface WorkSignalContext extends WatcherContext {
  config: Readonly<Config>;
  dnd: DND;
}

export class WorkSignalRunner {
  private history: WorkSignalOutput[] = [];
  private prevWasAway = false;
  private prevWasDeepWork = false;
  private awayStartTime?: number;

  tick(input: WorkSignalInput, ctx: WorkSignalContext): void {
    const score = computeFocusScore(input);
    const event = detectEvent(
      this.history.slice(-3),
      score,
      input,
      this.prevWasAway,
      this.prevWasDeepWork,
    );

    this.history.push({ focusScore: score, event });
    if (this.history.length > 10) this.history.shift();

    // Persist sample for end-of-day recap
    const today = new Date().toISOString().slice(0, 10);
    appendFocusSample(today, score);

    // React to events
    const personality = ctx.config.personality;
    const calloutSet = getCalloutSet(personality);

    switch (event) {
      case 'distraction': {
        const text = pickCallout(calloutSet.distraction);
        if (text) ctx.requestCallout(text);
        break;
      }
      case 'away': {
        this.awayStartTime = Date.now();
        break;
      }
      case 'returned': {
        const mins = Math.round((Date.now() - (this.awayStartTime ?? Date.now())) / 60_000);
        const template = pickCallout(calloutSet.returned);
        if (template) ctx.requestCallout(formatCallout(template, { mins }));
        this.awayStartTime = undefined;
        break;
      }
      case 'deepWork': {
        const text = pickCallout(calloutSet.deepWork);
        if (text) ctx.requestCallout(text);
        ctx.dnd.enable().catch(() => {});
        break;
      }
      case 'deepWorkEnd': {
        ctx.dnd.disable().catch(() => {});
        break;
      }
    }

    // Update state flags for next tick
    this.prevWasAway =
      event === 'away' ||
      (this.prevWasAway && input.presence !== null && !input.presence?.present);
    this.prevWasDeepWork =
      event === 'deepWork' ||
      (this.prevWasDeepWork && score > 0.6 && event !== 'deepWorkEnd');
  }

  reset(): void {
    this.history = [];
    this.prevWasAway = false;
    this.prevWasDeepWork = false;
    this.awayStartTime = undefined;
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npx jest src/main/watchers/__tests__/workSignalRunner.test.ts --no-coverage
```

- [ ] **Step 5: Commit**

```bash
git add src/main/watchers/workSignalRunner.ts src/main/watchers/__tests__/workSignalRunner.test.ts
git commit -m "feat(watchers): add WorkSignalRunner — stateful tick loop, events→moods, DND, stats"
```

---

## Task 9: presenceWatcher (main process IPC receiver)

**Files:**
- Create: `src/main/watchers/presence/index.ts`
- Test: `src/main/watchers/presence/__tests__/presence.test.ts`

This watcher is a thin IPC listener. It stores the last `PresenceFact` for workSignalRunner to read each tick.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/main/watchers/presence/__tests__/presence.test.ts
import { ipcMain } from 'electron';

jest.mock('electron', () => ({
  ipcMain: {
    on: jest.fn(),
    removeListener: jest.fn(),
  },
}));

const mockIpcMainOn = ipcMain.on as jest.Mock;
const mockIpcMainRemove = ipcMain.removeListener as jest.Mock;

import { PresenceWatcher } from '../index';
import { IPC } from '../../../../shared/types';
import type { WatcherContext, PresenceFact } from '../../../../shared/types';

function makeCtx(): WatcherContext {
  return {
    config: { camera: { enabled: true } } as WatcherContext['config'],
    setMood: jest.fn(),
    requestCallout: jest.fn(),
    setActivity: jest.fn(),
    log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  };
}

describe('PresenceWatcher', () => {
  afterEach(() => jest.clearAllMocks());

  it('registers IPC listener on start', () => {
    const w = new PresenceWatcher();
    w.start(makeCtx());
    expect(mockIpcMainOn).toHaveBeenCalledWith(
      IPC.VISION_PRESENCE,
      expect.any(Function),
    );
  });

  it('getCurrentFact() returns null before any IPC message', () => {
    const w = new PresenceWatcher();
    w.start(makeCtx());
    expect(w.getCurrentFact()).toBeNull();
  });

  it('getCurrentFact() returns the last received PresenceFact', () => {
    const w = new PresenceWatcher();
    w.start(makeCtx());

    // Simulate IPC event by calling the registered handler directly
    const handler = mockIpcMainOn.mock.calls.find(
      (c: [string, unknown]) => c[0] === IPC.VISION_PRESENCE,
    )![1] as (event: unknown, fact: PresenceFact) => void;

    const fact: PresenceFact = { present: true, attention: 'screen', confidence: 0.95 };
    handler({}, fact);

    expect(w.getCurrentFact()).toEqual(fact);
  });

  it('getCurrentFact() updates when new fact arrives', () => {
    const w = new PresenceWatcher();
    w.start(makeCtx());

    const handler = mockIpcMainOn.mock.calls.find(
      (c: [string, unknown]) => c[0] === IPC.VISION_PRESENCE,
    )![1] as (event: unknown, fact: PresenceFact) => void;

    handler({}, { present: true, attention: 'screen', confidence: 0.8 });
    handler({}, { present: false, attention: 'away', confidence: 0.9 });

    expect(w.getCurrentFact()!.present).toBe(false);
  });

  it('stop() removes IPC listener', () => {
    const w = new PresenceWatcher();
    w.start(makeCtx());
    w.stop();
    expect(mockIpcMainRemove).toHaveBeenCalledWith(
      IPC.VISION_PRESENCE,
      expect.any(Function),
    );
  });

  it('does not register listener when camera is disabled', () => {
    const w = new PresenceWatcher();
    const ctx = makeCtx();
    (ctx.config as { camera: { enabled: boolean } }).camera.enabled = false;
    w.start(ctx);
    expect(mockIpcMainOn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx jest src/main/watchers/presence/__tests__/presence.test.ts --no-coverage
```

- [ ] **Step 3: Create `src/main/watchers/presence/index.ts`**

```typescript
// src/main/watchers/presence/index.ts
import { ipcMain } from 'electron';
import type { Watcher, WatcherContext, PresenceFact } from '../../../shared/types';
import { IPC } from '../../../shared/types';

export class PresenceWatcher implements Watcher {
  readonly name = 'presence';
  private lastFact: PresenceFact | null = null;
  private handler?: (event: unknown, fact: PresenceFact) => void;

  start(ctx: WatcherContext): void {
    // Only register if camera is enabled in config
    if (!ctx.config.camera?.enabled) return;

    this.handler = (_event: unknown, fact: PresenceFact) => {
      this.lastFact = fact;
    };
    ipcMain.on(IPC.VISION_PRESENCE, this.handler);
  }

  stop(): void {
    if (this.handler) {
      ipcMain.removeListener(IPC.VISION_PRESENCE, this.handler);
      this.handler = undefined;
    }
  }

  resetWindow(): void {
    // On sleep/wake, reset the last fact so stale camera data doesn't persist
    this.lastFact = null;
  }

  getCurrentFact(): PresenceFact | null {
    return this.lastFact;
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npx jest src/main/watchers/presence/__tests__/presence.test.ts --no-coverage
```

- [ ] **Step 5: Commit**

```bash
git add src/main/watchers/presence/index.ts src/main/watchers/presence/__tests__/presence.test.ts
git commit -m "feat(watchers): add PresenceWatcher — IPC receiver for renderer vision facts"
```

---

## Task 10: Camera capture (renderer)

**Files:**
- Create: `src/renderer/vision/camera.ts`

**CRITICAL PRIVACY CONSTRAINTS:**
- `ImageData` is passed ONLY to `models.detectPresence()` inside the `onFrame` callback.
- `ImageData` is NEVER serialized, NEVER passed to `ipcRenderer.send`, NEVER written to disk.
- The `PresenceFact` result is what crosses IPC — not pixels.

There is no Jest test for this file (it requires `getUserMedia` browser APIs). Instead the test is static analysis (grep) in Task 13.

- [ ] **Step 1: Create `src/renderer/vision/camera.ts`**

```typescript
// src/renderer/vision/camera.ts
// PRIVACY: ImageData NEVER leaves this file's callback chain.
// PRIVACY: ImageData is NEVER sent over IPC. Only PresenceFact crosses IPC.
// PRIVACY: No frames are written to disk. No continuous analysis — one frame every ~7s.

export class CameraCapture {
  private stream?: MediaStream;
  private intervalId?: ReturnType<typeof window.setInterval>;
  private sampleIntervalMs = 7000; // ~7s between frames — no continuous video

  /**
   * Start the camera capture loop.
   *
   * @param onFrame  Called with one sampled ImageData every sampleIntervalMs.
   *                 THE CALLER IS RESPONSIBLE for consuming this in-place.
   *                 Do NOT store or serialize ImageData — pass it only to the model.
   */
  async start(onFrame: (imageData: ImageData) => void): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 320, height: 240, facingMode: 'user' },
      audio: false,
    });

    const video = document.createElement('video');
    video.srcObject = this.stream;
    video.muted = true;
    await video.play();

    const canvas = new OffscreenCanvas(320, 240);
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) throw new Error('OffscreenCanvas 2D context unavailable');

    this.intervalId = window.setInterval(() => {
      ctx2d.drawImage(video, 0, 0, 320, 240);
      const imageData = ctx2d.getImageData(0, 0, 320, 240);
      // imageData NEVER leaves this callback chain.
      // It goes only to onFrame(), which calls models.detectPresence().
      // The caller (vision/index.ts) passes it to the model and sends only PresenceFact over IPC.
      onFrame(imageData);
    }, this.sampleIntervalMs);
  }

  /**
   * Stop the camera and release the device.
   * The macOS green camera indicator light will turn off.
   */
  stop(): void {
    window.clearInterval(this.intervalId);
    this.intervalId = undefined;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined;
  }

  isActive(): boolean {
    return !!this.stream;
  }

  /**
   * Adjust sample rate when inference is too slow.
   * Called by models.ts when consecutive frames exceed 50ms inference time.
   */
  setSampleInterval(ms: number): void {
    this.sampleIntervalMs = ms;
  }
}
```

- [ ] **Step 2: Verify no `ipcRenderer` import in camera.ts**

```bash
grep -n 'ipcRenderer\|ipcMain\|ImageData.*send\|send.*ImageData' \
  /Users/devashishrana/Desktop/Work/Personal/ai-floating-assistant/src/renderer/vision/camera.ts
# Expected: no output
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/vision/camera.ts
git commit -m "feat(renderer/vision): add CameraCapture — 7s sampling, ImageData never leaves callback"
```

---

## Task 11: On-device inference (renderer)

**Files:**
- Create: `src/renderer/vision/models.ts`

**Note on library selection:** At implementation time, verify `@mediapipe/tasks-vision` is still the best-maintained option. Alternative: `@tensorflow-models/face-detection` with `@tensorflow/tfjs-backend-wasm`. Check npm weekly downloads and last publish date for both. This plan uses MediaPipe Tasks — swap import paths if you choose tfjs.

- [ ] **Step 1: Add the dependency**

```bash
# Verify current version before installing:
npm info @mediapipe/tasks-vision version
npm install @mediapipe/tasks-vision
```

- [ ] **Step 2: Create `src/renderer/vision/models.ts`**

```typescript
// src/renderer/vision/models.ts
// At implementation time: verify @mediapipe/tasks-vision is still best-maintained.
// Alternative: @tensorflow-models/face-detection with tfjs-wasm backend.
// Check: npm info @mediapipe/tasks-vision; npm info @tensorflow-models/face-detection
import type { PresenceFact, AttentionState } from '../../shared/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FaceDetector = any; // Typed loosely — MediaPipe types vary by version

export class PresenceDetector {
  private detector: FaceDetector | null = null;
  private slowCount = 0;
  private onSlowInference?: (newIntervalMs: number) => void;
  private currentIntervalMs = 7000;

  /**
   * Load the MediaPipe face detection model.
   * Uses the blaze_face_short_range model — fast on CPU, ~30ms on M1.
   * Call once before any detect() calls.
   */
  async load(): Promise<void> {
    // Dynamic import — keeps bundle size manageable and avoids loading if camera is disabled
    const { FaceDetector, FilesetResolver } = await import('@mediapipe/tasks-vision');

    const vision = await FilesetResolver.forVisionTasks(
      // CDN path — swap for bundled path in production build
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm',
    );

    this.detector = await FaceDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite',
        delegate: 'CPU', // GPU delegate optional — CPU is reliable on macOS
      },
      runningMode: 'IMAGE',
      minDetectionConfidence: 0.5,
      minSuppressionThreshold: 0.3,
    });
  }

  /**
   * Run face detection on a single ImageData frame.
   * Never stores or logs the ImageData — only the result facts cross any boundary.
   *
   * @param imageData  Raw pixel data from OffscreenCanvas. Consumed in-place. NOT stored.
   * @returns PresenceFact — the only output that leaves this function.
   */
  detect(imageData: ImageData): PresenceFact {
    if (!this.detector) {
      // Model not loaded — return a safe default (present=false means we won't trigger false callouts)
      return { present: false, attention: 'away', confidence: 0 };
    }

    const t0 = performance.now();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = this.detector.detect(imageData);

    const elapsed = performance.now() - t0;

    // Adaptive rate: if inference consistently takes > 50ms, slow down sampling
    if (elapsed > 50) {
      this.slowCount++;
      if (this.slowCount >= 3) {
        this.currentIntervalMs = Math.min(this.currentIntervalMs * 2, 30_000);
        this.slowCount = 0;
        this.onSlowInference?.(this.currentIntervalMs);
      }
    } else {
      this.slowCount = 0;
    }

    // No detections = user not present
    if (!result.detections || result.detections.length === 0) {
      return { present: false, attention: 'away', confidence: 0.9 };
    }

    const detection = result.detections[0];
    const score: number = detection.categories?.[0]?.score ?? 0.5;
    const keypoints: Array<{ label?: string; x?: number; y?: number }> =
      detection.keypoints ?? [];

    // Crude head-pose estimation from facial keypoints:
    // nose_tip Y significantly below left_eye Y → head is tilted down (phone-scroll posture)
    const noseTip = keypoints.find((k) => k.label === 'nose_tip');
    const leftEye = keypoints.find((k) => k.label === 'left_eye');

    let attention: AttentionState = 'screen';
    if (noseTip && leftEye) {
      const pitch = (noseTip.y ?? 0.5) - (leftEye.y ?? 0.5);
      if (pitch > 0.08) attention = 'down';
    }

    // ImageData is NOT stored, NOT sent anywhere — only this PresenceFact is returned
    return { present: true, attention, confidence: score };
  }

  /**
   * Register a callback for when inference is consistently slow.
   * Camera capture should call setSampleInterval() in response.
   */
  onSlowInferenceDetected(cb: (newIntervalMs: number) => void): void {
    this.onSlowInference = cb;
  }

  dispose(): void {
    this.detector?.close?.();
    this.detector = null;
  }
}
```

- [ ] **Step 3: Verify no ImageData persistence**

```bash
grep -n 'writeFile\|appendFile\|localStorage\|sessionStorage\|indexedDB\|imageData.*JSON\|JSON.*imageData' \
  /Users/devashishrana/Desktop/Work/Personal/ai-floating-assistant/src/renderer/vision/models.ts
# Expected: no output
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/vision/models.ts
git commit -m "feat(renderer/vision): add PresenceDetector — MediaPipe face detection, adaptive rate, no frame persistence"
```

---

## Task 12: Renderer vision wiring

**Files:**
- Create: `src/renderer/vision/index.ts`
- Modify: `src/renderer/main.ts` (or `renderer/index.ts` depending on Phase 0 layout — check the file that runs after DOMContentLoaded)

- [ ] **Step 1: Create `src/renderer/vision/index.ts`**

```typescript
// src/renderer/vision/index.ts
// PRIVACY BOUNDARY: This file is the only place where ImageData and PresenceFact coexist.
// ImageData goes IN to detector.detect(). PresenceFact comes OUT.
// PresenceFact is the ONLY thing sent over IPC. ImageData never crosses IPC.
import { CameraCapture } from './camera';
import { PresenceDetector } from './models';
import { IPC } from '../../shared/types';
import type { Config } from '../../shared/types';

let camera: CameraCapture | null = null;
let detector: PresenceDetector | null = null;
let started = false;

/**
 * Start the vision pipeline.
 * - Checks config.camera.enabled — exits immediately if false.
 * - Loads the MediaPipe model.
 * - Starts camera capture loop.
 * - Sends ONLY PresenceFact over IPC on each sampled frame.
 */
export async function startVision(): Promise<void> {
  const config = await window.cosmo.invoke(IPC.SETTINGS_GET) as Config;
  if (!config.camera?.enabled) return;

  if (started) return;
  started = true;

  detector = new PresenceDetector();
  try {
    await detector.load();
  } catch (err) {
    console.warn('[vision] Failed to load presence detector:', err);
    started = false;
    return;
  }

  camera = new CameraCapture();

  // When inference is slow, tell the camera to sample less often
  detector.onSlowInferenceDetected((newIntervalMs) => {
    camera?.setSampleInterval(newIntervalMs);
  });

  try {
    await camera.start((imageData) => {
      // imageData is consumed here — it goes ONLY into detect().
      // The PresenceFact result (never pixels) is what gets sent over IPC.
      const fact = detector!.detect(imageData);

      // ONLY { present, attention, confidence } crosses IPC — never ImageData
      window.cosmo.send(IPC.VISION_PRESENCE, fact);
    });
  } catch (err) {
    console.warn('[vision] Camera unavailable:', err);
    started = false;
    camera = null;
  }
}

/**
 * Stop the vision pipeline and release the camera device.
 * The macOS green camera indicator will turn off.
 */
export function stopVision(): void {
  camera?.stop();
  detector?.dispose();
  camera = null;
  detector = null;
  started = false;
}
```

- [ ] **Step 2: Wire vision into renderer startup**

Find the renderer entry file (from Phase 0 — likely `src/renderer/main.ts`, `src/renderer/chat.ts`, or `src/renderer/index.ts`; it is the file called by `src/renderer/index.html`'s `<script>` tag). Add at the bottom:

```typescript
// In src/renderer/main.ts (or equivalent renderer entry) — ADD after window.addEventListener('load', ...):

import { startVision, stopVision } from './vision';

// Start vision on load — startVision() is a no-op if camera is disabled in config
window.addEventListener('load', () => {
  void startVision();
});

// Pause vision during meetings — camera competing with Zoom causes permission issues
window.cosmo.on(IPC.MEETING_QUIET, () => stopVision());
window.cosmo.on(IPC.MEETING_ACTIVE, () => { void startVision(); });
```

- [ ] **Step 3: Verify the IPC privacy boundary**

```bash
# Verify no raw ImageData is sent over IPC
grep -rn 'ImageData\|getImageData\|toDataURL\|toBlob' \
  /Users/devashishrana/Desktop/Work/Personal/ai-floating-assistant/src/renderer/vision/index.ts
# Expected: no output

# Verify VISION_PRESENCE IPC send only appears in vision/index.ts (renderer side)
grep -rn 'VISION_PRESENCE' \
  /Users/devashishrana/Desktop/Work/Personal/ai-floating-assistant/src/renderer/
# Expected: only vision/index.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/vision/index.ts src/renderer/main.ts
git commit -m "feat(renderer/vision): wire vision pipeline — only PresenceFact crosses IPC, zero pixel leakage"
```

---

## Task 13: Registry wiring — remove Phase 2 direct watcher→mood calls

**Files:**
- Modify: `src/main/watchers/registry.ts`
- Modify: `src/main/watchers/idle/index.ts`
- Modify: `src/main/watchers/focus/index.ts`
- Modify: `src/main/index.ts`

This is the breaking change that completes Phase 6: watcher→mood direct calls are removed. workSignalRunner becomes the sole decision maker for observation-driven moods.

- [ ] **Step 1: Update `src/main/watchers/idle/index.ts`**

Remove the `ctx.setMood('bored')`, `ctx.setMood('annoyed')`, `ctx.setMood('sleeping')` calls. The idleWatcher now only tracks raw idle time and reports it for workSignalRunner to consume.

Find and replace in `src/main/watchers/idle/index.ts`:

```typescript
// BEFORE (Phase 2 direct mood wiring — REMOVE):
// ctx.setMood('bored');
// ctx.setMood('annoyed');
// ctx.requestCallout(randomIdleCallout());
// ctx.setMood('sleeping');

// AFTER — idleWatcher now only stores its current state for workSignalRunner to read:

export class IdleWatcher implements Watcher {
  readonly name = 'idle';
  private interval?: ReturnType<typeof setInterval>;
  private currentIdleSec = 0;

  start(ctx: WatcherContext): void {
    const pollMs = process.env.PIXEL_DEV === '1' ? 5_000 : 30_000;
    this.interval = setInterval(() => {
      this.currentIdleSec = powerMonitor.getSystemIdleTime();
      // Phase 6: sleeping is still set directly — it's a display state, not a judgment
      const sleepSec = (ctx.config.idleHardMin * 60 * 4); // 4× hard threshold = ~100 min
      if (this.currentIdleSec >= sleepSec) {
        ctx.setMood('sleeping');
      }
    }, pollMs);
  }

  stop(): void {
    clearInterval(this.interval);
    this.interval = undefined;
  }

  resetWindow(): void {
    this.currentIdleSec = 0;
  }

  getCurrentIdleSec(): number {
    return this.currentIdleSec;
  }
}

export const idleWatcher = new IdleWatcher();
```

- [ ] **Step 2: Update `src/main/watchers/focus/index.ts`**

Remove direct distraction callout firing. focusWatcher now only stores the last `AppClass` and URL for workSignalRunner to read.

```typescript
// src/main/watchers/focus/index.ts — replace _poll logic

// Remove: ctx.requestCallout(distractionCallout(domain || appName));
// Remove: direct rolling window distraction threshold check

// Add: store last classification for workSignalRunner.tick() to read

export class FocusWatcher implements Watcher {
  readonly name = 'focus';
  private interval?: ReturnType<typeof setInterval>;
  private lastAppClass: AppClass = 'neutral';
  private lastUrl?: string;
  private lastAppName = '';

  start(ctx: WatcherContext): void {
    const pollMs = process.env.PIXEL_DEV === '1' ? 5_000 : 30_000;
    this.interval = setInterval(() => void this._poll(ctx), pollMs);
  }

  stop(): void {
    clearInterval(this.interval);
    this.interval = undefined;
  }

  resetWindow(): void {
    this.lastAppClass = 'neutral';
    this.lastUrl = undefined;
  }

  getLastAppClass(): AppClass { return this.lastAppClass; }
  getLastUrl(): string | undefined { return this.lastUrl; }
  getLastAppName(): string { return this.lastAppName; }

  private async _poll(ctx: WatcherContext): Promise<void> {
    let appName: string;
    try {
      appName = await runScript(GET_FRONTMOST_APP);
    } catch (err) {
      ctx.log.warn('[focusWatcher] Could not get frontmost app:', err);
      return;
    }
    this.lastAppName = appName;

    let url: string | undefined;
    const nameLower = appName.toLowerCase();
    if (BROWSER_APPS.has(nameLower)) {
      const script = BROWSER_URL_SCRIPTS[nameLower];
      if (script) {
        try { url = await runScript(script); } catch { /* non-fatal */ }
      }
    }
    this.lastUrl = url;
    this.lastAppClass = classifyApp(appName, url, ctx.config);

    // Meeting quiet mode — still reported directly (it's a display/audio concern, not a mood judgment)
    if (ctx.setMeetingQuiet) {
      ctx.setMeetingQuiet(this.lastAppClass === 'meeting');
    }
  }
}

export const focusWatcher = new FocusWatcher();
```

Note: `setMeetingQuiet` is an optional extension on `WatcherContext`. Add it to `src/shared/types.ts`:

```typescript
// src/shared/types.ts — add to WatcherContext interface:
setMeetingQuiet?: (active: boolean) => void;
```

- [ ] **Step 3: Register new watchers and wire workSignalRunner in `src/main/watchers/registry.ts`**

Add a `startWorkSignalLoop()` function that registers cadenceWatcher + presenceWatcher and starts the 30s tick:

```typescript
// src/main/watchers/registry.ts — ADD:

import { CadenceWatcher } from './cadence';
import { PresenceWatcher } from './presence';
import { WorkSignalRunner, WorkSignalContext } from './workSignalRunner';
import { focusWatcher } from './focus';
import { DND } from '../integrations/dnd';

const cadenceWatcher = new CadenceWatcher();
const presenceWatcher = new PresenceWatcher();
const workSignalRunner = new WorkSignalRunner();
let workSignalInterval: ReturnType<typeof setInterval> | undefined;

export function startWorkSignalLoop(ctx: WorkSignalContext): void {
  registerWatcher(cadenceWatcher);
  registerWatcher(presenceWatcher);
  const dnd = new DND();

  const workCtx: WorkSignalContext = { ...ctx, dnd };

  workSignalInterval = setInterval(() => {
    const input = {
      appClass: focusWatcher.getLastAppClass(),
      inputCadence: cadenceWatcher.getCurrentCadence(),
      presence: presenceWatcher.getCurrentFact(),
    };
    workSignalRunner.tick(input, workCtx);
  }, 30_000);
}

export function stopWorkSignalLoop(): void {
  clearInterval(workSignalInterval);
  workSignalInterval = undefined;
  workSignalRunner.reset();
}
```

- [ ] **Step 4: Wire into `src/main/index.ts`**

After `startAll(ctx)`, add:

```typescript
// src/main/index.ts — ADD after startAll(ctx):
import { startWorkSignalLoop, stopWorkSignalLoop } from './watchers/registry';

startWorkSignalLoop({
  config,
  setMood: (state) => stateManager.setMood(state),
  requestCallout: (text) => calloutManager.requestCallout(text),
  setActivity: (a) => mainWindow.webContents.send(IPC.ACTIVITY_SET, a),
  log: logger,
  dnd: new DND(),  // WorkSignalRunner creates its own; this is for ctx type compliance
  setMeetingQuiet: (active) => calloutManager.setMeetingQuiet(active),
});

// On quit, clean up
app.on('quit', () => {
  stopWorkSignalLoop();
  stopAll();
  speechQueue.clear();
});
```

Also add the MEETING_QUIET/MEETING_ACTIVE IPC broadcasts from main to renderer (for vision pipeline):

```typescript
// src/main/index.ts — add to meeting quiet handling:
// When calloutManager.setMeetingQuiet() is called by focusWatcher:
// Broadcast to renderer so vision/index.ts can stop/restart camera
mainWindow.webContents.send(active ? IPC.MEETING_QUIET : IPC.MEETING_ACTIVE);
```

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add \
  src/main/watchers/idle/index.ts \
  src/main/watchers/focus/index.ts \
  src/main/watchers/registry.ts \
  src/main/index.ts \
  src/shared/types.ts
git commit -m "feat(watchers): wire workSignalRunner — remove Phase 2 direct watcher→mood calls"
```

---

## Task 14: Privacy verification (grep checks)

These commands verify the critical privacy invariants. Run each and confirm expected output.

- [ ] **Step 1: No raw frame data reaches main process**

```bash
grep -rn 'ImageData\|getImageData\|canvas\.toDataURL\|canvas\.toBlob' \
  /Users/devashishrana/Desktop/Work/Personal/ai-floating-assistant/src/main/
```

Expected: **no output**. If any output appears, a frame is leaking into main — fix before proceeding.

- [ ] **Step 2: VISION_PRESENCE only in allowed files**

```bash
grep -rn 'VISION_PRESENCE' \
  /Users/devashishrana/Desktop/Work/Personal/ai-floating-assistant/src/
```

Expected output must ONLY include:
- `src/shared/types.ts` (definition)
- `src/renderer/vision/index.ts` (sender)
- `src/main/watchers/presence/index.ts` (receiver)

Any other file appearing = IPC privacy leak. Fix it.

- [ ] **Step 3: No frame data written to disk**

```bash
grep -rn 'writeFile.*vision\|appendFile.*vision\|writeFile.*ImageData\|writeFile.*frame\|writeFile.*pixel' \
  /Users/devashishrana/Desktop/Work/Personal/ai-floating-assistant/src/
```

Expected: **no output**.

- [ ] **Step 4: No key codes or event tap imports**

```bash
grep -rn 'addGlobalShortcut\|registerShortcut\|keycode\|KeyboardEvent\|key_event\|event_tap\|CGEventTap' \
  /Users/devashishrana/Desktop/Work/Personal/ai-floating-assistant/src/main/watchers/cadence/
```

Expected: **no output**. Cadence watcher must never contain these.

- [ ] **Step 5: Commit verification results**

Create a comment-only file to record the verification (optional but useful for audit trail):

```bash
git add src/main/watchers/cadence/index.ts  # touch to confirm no changes needed
git commit -m "chore(privacy): run Phase 6 grep verifications — all checks pass"
```

---

## Task 15: Manual acceptance verification

These are not automated — they require running the app with `PIXEL_DEV=1`.

- [ ] **Step 1: Build and run**

```bash
PIXEL_DEV=1 npm run dev
```

- [ ] **Step 2: Editor + steady typing → high focus, zero callouts**

  1. Open VS Code (or any `workApps` entry).
  2. Type continuously for 90 seconds.
  3. Observe: no `bored` or `annoyed` state, no callouts.
  4. Check logs at `~/.pixel/logs/` — focus score should be > 0.8 in consecutive entries.

- [ ] **Step 3: Away tracking → greeting on return**

  1. Walk away from the machine (or let idle time accumulate for > `awayMin` seconds in PIXEL_DEV mode).
  2. Return and wiggle the mouse.
  3. Confirm spoken greeting: "Welcome back. X minutes. I counted."

- [ ] **Step 4: Phone-scroll posture + distraction site → annoyed via workSignal ONLY**

  1. Navigate to a `distractionDomains` URL in a browser.
  2. If camera is on: tilt your head down (phone-scroll posture) and hold for 2+ poll ticks.
  3. Wait for distraction event to fire.
  4. Confirm callout is from `calloutSet.distraction` (personality-aware text).
  5. Confirm the callout fired from `workSignalRunner.tick()` — check logs show "distraction event" not "idleWatcher callout" or "focusWatcher direct".

- [ ] **Step 5: Camera disabled mode — all non-camera tests pass**

  1. Set `config.camera.enabled = false`.
  2. Restart with `PIXEL_DEV=1`.
  3. Repeat Steps 2–4 (excluding camera-specific head-tilt).
  4. Confirm all watcher behaviors work correctly without a camera.

- [ ] **Step 6: Run all tests**

```bash
npm test
```

Expected: all test suites pass, zero failures.

- [ ] **Step 7: CPU budget check**

  1. Open Activity Monitor.
  2. Run the app for 5 minutes at idle (no interaction, no camera if on battery).
  3. Confirm CPU stays below 1% sustained. If camera is on, confirm it does not spike above 3% during inference.

---

## Acceptance Criteria

| # | Criterion | Verification |
|---|---|---|
| AC-1 | Editor + steady typing → focusScore > 0.8, zero callouts | Task 15.2 |
| AC-2 | Away 15 min → "Welcome back. 15 minutes. I counted." | Task 15.3 |
| AC-3 | Phone-scroll posture + distraction site → annoyed via workSignalRunner ONLY | Task 15.4 |
| AC-4 | Camera disabled → all tests pass except camera-specific | Task 15.5 |
| AC-5 | grep: no ImageData in src/main/ | Task 14.1 |
| AC-6 | grep: VISION_PRESENCE only in 3 allowed files | Task 14.2 |
| AC-7 | grep: no frame data written to disk | Task 14.3 |
| AC-8 | grep: no key codes or event taps in cadenceWatcher | Task 14.4 |
| AC-9 | `npm test` — all suites pass | Task 15.6 |
| AC-10 | CPU < 1% idle (< 3% with camera active) | Task 15.7 |
| AC-11 | DND enables on deepWork event, disables on deepWorkEnd | Task 8 tests |
| AC-12 | Callouts respect personality — silent personality = zero callouts | Task 8 tests |

---

## File Checklist

After all tasks complete, these files must exist:

```
src/
  shared/
    types.ts                              # updated: InputCadence, PresenceFact, WorkSignalInput/Output
  main/
    stats.ts                              # daily focus sample writer
    callouts/
      sets.ts                             # personality-aware callout sets
    integrations/
      dnd.ts                              # Auto DND, never throws
      __tests__/
        dnd.test.ts
    watchers/
      cadence/
        index.ts                          # CadenceWatcher — idle-delta only, zero keylogging
        __tests__/
          cadence.test.ts
      focus/
        classify.ts                       # enhanced pure classifyApp + classifyUrl
        __tests__/
          classify.test.ts                # 25+ cases
      presence/
        index.ts                          # PresenceWatcher — IPC receiver only
        __tests__/
          presence.test.ts
      workSignal.ts                       # pure computeFocusScore + detectEvent
      workSignalRunner.ts                 # stateful tick loop
      __tests__/
        workSignal.test.ts                # 20+ cases
        workSignalRunner.test.ts
  renderer/
    vision/
      camera.ts                           # getUserMedia, 7s sampling
      models.ts                           # MediaPipe face detection
      index.ts                            # wires camera → models → IPC (PresenceFact only)
tests/
  main/
    stats.test.ts
    callouts/
      sets.test.ts
```

---

## Notes for Implementor

**Phase 2 mood wiring removal:** Phase 2's `idleWatcher` and `focusWatcher` called `ctx.setMood()` and `ctx.requestCallout()` directly. Phase 6 removes those calls. The only direct mood calls remaining in watchers are: `sleeping` (idleWatcher — a display state, not a judgment) and meeting quiet mode propagation (focusWatcher → calloutManager). All other observation-driven moods go through workSignalRunner.

**workSignalRunner tick timing:** The 30s interval is set in `registry.ts`. In `PIXEL_DEV=1` mode you may want to shorten this to 5s for faster testing — add the same `PIXEL_DEV` env check used in cadenceWatcher and focusWatcher.

**MediaPipe WASM hosting:** The default MediaPipe setup fetches WASM and model files from a CDN. In production (packaged .app), you must bundle these files locally. In `electron-builder.yml`, add the MediaPipe WASM files to `extraResources` and update the `FilesetResolver.forVisionTasks()` path to point to the bundled location. Failing to do this will break vision features when offline.

**OffscreenCanvas availability:** `OffscreenCanvas` is available in Electron's renderer process. If you see `ReferenceError: OffscreenCanvas is not defined`, check that the renderer's `contextIsolation` is not stripping it — it should be fine with Electron's default renderer security settings.

**`setMeetingQuiet` on WatcherContext:** This is an optional extension field. The Phase 2 `WatcherContext` did not have it. Adding it as optional (`setMeetingQuiet?: (active: boolean) => void`) keeps Phase 2 watchers compatible without changes — they simply never call it. Only focusWatcher calls it.

**Test isolation for `PIXEL_DEV`:** Same pattern as Phase 2 — set `process.env.PIXEL_DEV = '1'` before requiring the module under test. The cadenceWatcher test shows the correct pattern.
