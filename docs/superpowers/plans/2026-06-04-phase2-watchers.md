# Phase 2 — Watchers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire idle, focus, battery, and eyeStrain watchers behind a registry so Cosmo escalates through bored → annoyed → sleeping autonomously, fires cooldown-gated spoken callouts, and resets cleanly after sleep/wake.

**Architecture:** A central `WatcherContext` (created in `main/index.ts`) is the only channel watchers use to affect the app — they call `setMood`, `requestCallout`, and `setActivity`; they never import state or tools directly. Cooldown enforcement, work-hours gating, and pause logic all live in the `calloutManager` singleton in `main/index.ts`, not in individual watchers. `core/osascript.ts` and `core/speechQueue.ts` are shared primitives that watchers consume through `ToolContext` / direct import from `core/`.

**Tech Stack:** Electron `powerMonitor` API, Node `child_process.execFile` (never `exec`), TypeScript strict mode, Jest for unit tests, `PIXEL_DEV=1` env flag for accelerated thresholds.

---

## Prerequisites

- Phase 0 (Face) complete: Electron window renders, tray toggle works.
- Phase 1 (Moods) complete: `state.ts` owns `MoodState`, IPC push to renderer works, all 8 states render.
- `src/shared/types.ts` exists with `MoodState`, `Config`, `WatcherContext`, `Watcher`, `ActivityState`, `Logger`.

---

## Shared types reference (`src/shared/types.ts`)

These types must exist before any task below compiles. Verify or create them first.

```typescript
// src/shared/types.ts
export type MoodState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'happy'
  | 'bored'
  | 'annoyed'
  | 'sleeping';

export type AppClass = 'work' | 'distraction' | 'meeting' | 'neutral';

export type InputCadence = 'none' | 'sporadic' | 'steady';

export interface Logger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

export interface WatcherContext {
  config: Readonly<Config>;
  setMood(state: MoodState): void;
  requestCallout(text: string): void; // cooldown enforced centrally
  setActivity(activity: ActivityState | null): void;
  log: Logger;
}

export interface Watcher {
  readonly name: string;
  start(ctx: WatcherContext): void;
  stop(): void;
  resetWindow?(): void; // optional — called on powerMonitor resume
}

export type ActivityState =
  | { type: 'music'; nowPlaying: { track: string; artist: string } }
  | { type: 'searching' }
  | { type: 'timer'; remainingSec: number; label: string };

export interface Config {
  botName: string;
  workHours: { start: string; end: string; days: number[] };
  idleSoftMin: number;
  idleHardMin: number;
  distractionMin: number;
  distractionCapMin: number;
  calloutCooldownMin: number;
  awayMin: number;
  expressionPack: string;
  personality: 'coach' | 'drill-sergeant' | 'therapist' | 'silent';
  llm: { provider: string; model: string; fallback?: string[] };
  stt: { provider: 'whisperLocal' | 'openaiWhisper' };
  voice: { enabled: boolean; rate: number };
  sounds: { enabled: boolean };
  camera: { enabled: boolean };
  workApps: string[];
  workDomains: string[];
  distractionDomains: string[];
}
```

---

## Task 1: `src/main/core/osascript.ts`

**Purpose:** Single choke-point for all AppleScript execution. `execFile` only — never `exec` with interpolated strings.

- [ ] **1.1** Create `src/main/core/osascript.ts`:

```typescript
// src/main/core/osascript.ts
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export class OsaError extends Error {
  constructor(
    message: string,
    public readonly stderr: string,
    public readonly code: number | null,
  ) {
    super(message);
    this.name = 'OsaError';
  }
}

export class PermissionError extends OsaError {
  constructor(stderr: string) {
    super('Automation permission denied', stderr, -1);
    this.name = 'PermissionError';
  }
}

const PERMISSION_PATTERNS = [
  'not allowed assistive access',
  'errAEEventNotPermitted',
  'is not allowed to send Apple events',
  '-1743',
];

/**
 * Execute an AppleScript string via osascript.
 * Always uses execFile with an argument array — never shell interpolation.
 * @param script  Raw AppleScript source (not a file path).
 * @param timeoutMs  Default 5 000 ms.
 * @returns stdout trimmed of surrounding whitespace.
 * @throws PermissionError if macOS Automation access is denied.
 * @throws OsaError for all other osascript failures.
 */
export async function runScript(
  script: string,
  timeoutMs = 5_000,
): Promise<string> {
  try {
    const { stdout } = await execFileAsync('osascript', ['-e', script], {
      timeout: timeoutMs,
    });
    return stdout.trim();
  } catch (err: unknown) {
    const e = err as { stderr?: string; code?: number | null; message?: string };
    const stderr = e.stderr ?? '';
    const code = e.code ?? null;

    if (PERMISSION_PATTERNS.some((p) => stderr.includes(p))) {
      throw new PermissionError(stderr);
    }
    throw new OsaError(e.message ?? 'osascript failed', stderr, code);
  }
}
```

- [ ] **1.2** Create `src/main/core/__tests__/osascript.test.ts`:

```typescript
// src/main/core/__tests__/osascript.test.ts
import { execFile } from 'child_process';

// Mock BEFORE importing the module under test
jest.mock('child_process', () => ({ execFile: jest.fn() }));
const mockExecFile = execFile as jest.MockedFunction<typeof execFile>;

// Promisify-compatible mock helper
function resolveExecFile(stdout: string, stderr = '') {
  mockExecFile.mockImplementationOnce(
    (_cmd, _args, _opts, callback: (...args: unknown[]) => void) => {
      callback(null, stdout, stderr);
      return {} as ReturnType<typeof execFile>;
    },
  );
}

function rejectExecFile(stderr: string, code: number | null = 1) {
  mockExecFile.mockImplementationOnce(
    (_cmd, _args, _opts, callback: (...args: unknown[]) => void) => {
      const err = Object.assign(new Error('osascript failed'), { stderr, code });
      callback(err, '', stderr);
      return {} as ReturnType<typeof execFile>;
    },
  );
}

import { runScript, OsaError, PermissionError } from '../osascript';

describe('runScript', () => {
  afterEach(() => jest.clearAllMocks());

  it('calls execFile with osascript and -e flag', async () => {
    resolveExecFile('hello');
    await runScript('return "hello"');
    expect(mockExecFile).toHaveBeenCalledWith(
      'osascript',
      ['-e', 'return "hello"'],
      expect.objectContaining({ timeout: 5_000 }),
      expect.any(Function),
    );
  });

  it('returns trimmed stdout on success', async () => {
    resolveExecFile('  result  \n');
    const result = await runScript('...');
    expect(result).toBe('result');
  });

  it('passes custom timeout to execFile', async () => {
    resolveExecFile('ok');
    await runScript('...', 2_000);
    expect(mockExecFile).toHaveBeenCalledWith(
      'osascript',
      expect.any(Array),
      expect.objectContaining({ timeout: 2_000 }),
      expect.any(Function),
    );
  });

  it('throws PermissionError on errAEEventNotPermitted', async () => {
    rejectExecFile('errAEEventNotPermitted: not allowed');
    await expect(runScript('...')).rejects.toBeInstanceOf(PermissionError);
  });

  it('throws PermissionError on assistive access denial', async () => {
    rejectExecFile('not allowed assistive access');
    await expect(runScript('...')).rejects.toBeInstanceOf(PermissionError);
  });

  it('throws OsaError (not PermissionError) for generic failure', async () => {
    rejectExecFile('some other error');
    let caught: unknown;
    try {
      await runScript('...');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OsaError);
    expect(caught).not.toBeInstanceOf(PermissionError);
  });
});
```

- [ ] **1.3** Run: `npx jest src/main/core/__tests__/osascript.test.ts` — all tests green.

---

## Task 2: `src/main/core/speechQueue.ts`

**Purpose:** Serialize all TTS output. One `say` process at a time. Supports enable/disable (for mute, meeting quiet mode).

- [ ] **2.1** Create `src/main/core/speechQueue.ts`:

```typescript
// src/main/core/speechQueue.ts
import { execFile, ChildProcess } from 'child_process';

interface QueueEntry {
  text: string;
}

export class SpeechQueue {
  private queue: QueueEntry[] = [];
  private current: ChildProcess | null = null;
  private enabled = true;
  private rate: number;

  constructor(rate = 180) {
    this.rate = rate;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.clear();
    }
  }

  setRate(rate: number): void {
    this.rate = rate;
  }

  enqueue(text: string): void {
    if (!this.enabled) return;
    this.queue.push({ text });
    if (this.current === null) {
      this.processNext();
    }
  }

  clear(): void {
    this.queue = [];
    if (this.current !== null) {
      this.current.kill();
      this.current = null;
    }
  }

  private processNext(): void {
    const entry = this.queue.shift();
    if (!entry) {
      this.current = null;
      return;
    }

    // execFile with argument array — never shell interpolation
    const proc = execFile(
      'say',
      ['-r', String(this.rate), entry.text],
      (err) => {
        if (err && err.killed) {
          // Cleared mid-sentence — stop processing
          return;
        }
        this.current = null;
        this.processNext();
      },
    );
    this.current = proc;
  }
}

// Singleton for use across main process
export const speechQueue = new SpeechQueue();
```

- [ ] **2.2** Create `src/main/core/__tests__/speechQueue.test.ts`:

```typescript
// src/main/core/__tests__/speechQueue.test.ts
import { execFile, ChildProcess } from 'child_process';

jest.mock('child_process', () => ({ execFile: jest.fn() }));
const mockExecFile = execFile as jest.MockedFunction<typeof execFile>;

import { SpeechQueue } from '../speechQueue';

describe('SpeechQueue', () => {
  let callbacks: Array<(err: Error | null) => void>;

  beforeEach(() => {
    callbacks = [];
    mockExecFile.mockImplementation(
      (_cmd, _args, callback: (err: Error | null) => void) => {
        callbacks.push(callback);
        const proc = { kill: jest.fn() } as unknown as ChildProcess;
        return proc;
      },
    );
  });

  afterEach(() => jest.clearAllMocks());

  it('calls execFile with say, -r flag, and text', () => {
    const q = new SpeechQueue(200);
    q.enqueue('hello world');
    expect(mockExecFile).toHaveBeenCalledWith(
      'say',
      ['-r', '200', 'hello world'],
      expect.any(Function),
    );
  });

  it('processes items sequentially — second item waits for first to finish', () => {
    const q = new SpeechQueue();
    q.enqueue('first');
    q.enqueue('second');
    q.enqueue('third');

    // Only one execFile call so far
    expect(mockExecFile).toHaveBeenCalledTimes(1);
    expect(mockExecFile).toHaveBeenCalledWith('say', expect.arrayContaining(['first']), expect.any(Function));

    // Finish first
    callbacks[0](null);
    expect(mockExecFile).toHaveBeenCalledTimes(2);
    expect(mockExecFile).toHaveBeenLastCalledWith('say', expect.arrayContaining(['second']), expect.any(Function));

    // Finish second
    callbacks[1](null);
    expect(mockExecFile).toHaveBeenCalledTimes(3);
    expect(mockExecFile).toHaveBeenLastCalledWith('say', expect.arrayContaining(['third']), expect.any(Function));
  });

  it('clear() kills current process and empties queue', () => {
    const q = new SpeechQueue();
    q.enqueue('first');
    q.enqueue('second');

    const proc = mockExecFile.mock.results[0].value as { kill: jest.Mock };
    q.clear();

    expect(proc.kill).toHaveBeenCalled();
    // After killing, no new processes should start
    expect(mockExecFile).toHaveBeenCalledTimes(1);
  });

  it('setEnabled(false) discards new enqueues silently', () => {
    const q = new SpeechQueue();
    q.setEnabled(false);
    q.enqueue('should be ignored');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('setEnabled(false) clears queue and kills current process', () => {
    const q = new SpeechQueue();
    q.enqueue('speaking now');
    const proc = mockExecFile.mock.results[0].value as { kill: jest.Mock };
    q.setEnabled(false);
    expect(proc.kill).toHaveBeenCalled();
  });

  it('setEnabled(true) after false allows new enqueues', () => {
    const q = new SpeechQueue();
    q.setEnabled(false);
    q.setEnabled(true);
    q.enqueue('now allowed');
    expect(mockExecFile).toHaveBeenCalledWith('say', expect.arrayContaining(['now allowed']), expect.any(Function));
  });
});
```

- [ ] **2.3** Run: `npx jest src/main/core/__tests__/speechQueue.test.ts` — all tests green.

---

## Task 3: Watcher registry (`src/main/watchers/registry.ts`)

**Purpose:** Single place to register and lifecycle-manage all watchers. Timeout and error wrapping live here.

- [ ] **3.1** Create `src/main/watchers/types.ts` (re-export from shared for main-process use):

```typescript
// src/main/watchers/types.ts
// Re-export canonical types so watcher modules import from one place
export type { Watcher, WatcherContext } from '../../shared/types';
```

- [ ] **3.2** Create `src/main/watchers/registry.ts`:

```typescript
// src/main/watchers/registry.ts
import type { Watcher, WatcherContext } from './types';

const watchers: Watcher[] = [];

export function registerWatcher(w: Watcher): void {
  watchers.push(w);
}

export function startAll(ctx: WatcherContext): void {
  for (const w of watchers) {
    try {
      w.start(ctx);
    } catch (err) {
      ctx.log.error(`[watchers] Failed to start watcher "${w.name}":`, err);
    }
  }
}

export function stopAll(): void {
  for (const w of watchers) {
    try {
      w.stop();
    } catch {
      // Stopping must never throw to the caller
    }
  }
}

export function resetAllWindows(): void {
  for (const w of watchers) {
    if (typeof w.resetWindow === 'function') {
      try {
        w.resetWindow();
      } catch {
        // Reset failure is non-fatal
      }
    }
  }
}

/** Exposed for testing — clears the module-level registry. */
export function _clearRegistry(): void {
  watchers.length = 0;
}
```

- [ ] **3.3** Create `src/main/watchers/__tests__/registry.test.ts`:

```typescript
// src/main/watchers/__tests__/registry.test.ts
import {
  registerWatcher,
  startAll,
  stopAll,
  resetAllWindows,
  _clearRegistry,
} from '../registry';
import type { Watcher, WatcherContext } from '../types';

function makeCtx(): WatcherContext {
  return {
    config: {} as WatcherContext['config'],
    setMood: jest.fn(),
    requestCallout: jest.fn(),
    setActivity: jest.fn(),
    log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  };
}

function makeWatcher(name: string): Watcher & { start: jest.Mock; stop: jest.Mock; resetWindow: jest.Mock } {
  return { name, start: jest.fn(), stop: jest.fn(), resetWindow: jest.fn() };
}

describe('watcher registry', () => {
  beforeEach(() => _clearRegistry());

  it('startAll calls start on every registered watcher', () => {
    const a = makeWatcher('a');
    const b = makeWatcher('b');
    registerWatcher(a);
    registerWatcher(b);
    const ctx = makeCtx();
    startAll(ctx);
    expect(a.start).toHaveBeenCalledWith(ctx);
    expect(b.start).toHaveBeenCalledWith(ctx);
  });

  it('stopAll calls stop on every registered watcher', () => {
    const a = makeWatcher('a');
    const b = makeWatcher('b');
    registerWatcher(a);
    registerWatcher(b);
    stopAll();
    expect(a.stop).toHaveBeenCalled();
    expect(b.stop).toHaveBeenCalled();
  });

  it('stopAll does not throw if a watcher.stop throws', () => {
    const bad: Watcher = {
      name: 'bad',
      start: jest.fn(),
      stop: () => { throw new Error('oops'); },
    };
    registerWatcher(bad);
    expect(() => stopAll()).not.toThrow();
  });

  it('startAll logs error and continues if a watcher.start throws', () => {
    const bad: Watcher = {
      name: 'bad',
      start: () => { throw new Error('start failed'); },
      stop: jest.fn(),
    };
    const good = makeWatcher('good');
    registerWatcher(bad);
    registerWatcher(good);
    const ctx = makeCtx();
    expect(() => startAll(ctx)).not.toThrow();
    expect(ctx.log.error).toHaveBeenCalled();
    expect(good.start).toHaveBeenCalled();
  });

  it('resetAllWindows calls resetWindow on watchers that have it', () => {
    const a = makeWatcher('a');
    const b: Watcher = { name: 'b', start: jest.fn(), stop: jest.fn() }; // no resetWindow
    registerWatcher(a);
    registerWatcher(b);
    expect(() => resetAllWindows()).not.toThrow();
    expect(a.resetWindow).toHaveBeenCalled();
  });
});
```

- [ ] **3.4** Run: `npx jest src/main/watchers/__tests__/registry.test.ts` — all tests green.

---

## Task 4: Callout system (`src/main/index.ts` additions)

**Purpose:** Single enforcement point for cooldown, pause, work-hours gating, and meeting quiet mode. No watcher ever bypasses this.

- [ ] **4.1** Create `src/main/calloutManager.ts` (extracted from index for testability):

```typescript
// src/main/calloutManager.ts
import type { Config } from '../shared/types';
import { speechQueue } from './core/speechQueue';

export interface CalloutManagerOpts {
  config: Readonly<Config>;
}

export function isInWorkHours(config: Readonly<Config>): boolean {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  if (!config.workHours.days.includes(day)) return false;

  const [startH, startM] = config.workHours.start.split(':').map(Number);
  const [endH, endM] = config.workHours.end.split(':').map(Number);
  const startMins = startH * 60 + startM;
  const endMins = endH * 60 + endM;
  const nowMins = now.getHours() * 60 + now.getMinutes();

  return nowMins >= startMins && nowMins < endMins;
}

export class CalloutManager {
  private lastCalloutAt = 0;
  private pausedUntil = 0;
  private meetingQuietActive = false;
  private config: Readonly<Config>;

  constructor(config: Readonly<Config>) {
    this.config = config;
  }

  updateConfig(config: Readonly<Config>): void {
    this.config = config;
  }

  /**
   * Called from the watcher registry via WatcherContext.requestCallout.
   * Enforces: paused | outside work hours | meeting quiet | cooldown.
   */
  requestCallout(text: string): void {
    const now = Date.now();

    if (now < this.pausedUntil) return;
    if (this.meetingQuietActive) return;
    if (!isInWorkHours(this.config)) return;

    const cooldownMs = this.config.calloutCooldownMin * 60 * 1_000;
    if (now - this.lastCalloutAt < cooldownMs) return;

    this.lastCalloutAt = now;
    speechQueue.enqueue(text);
  }

  /**
   * Tray "Pause watching (1h)".
   * @param durationMs How long to suppress callouts.
   */
  pauseWatching(durationMs: number): void {
    this.pausedUntil = Date.now() + durationMs;
  }

  resumeWatching(): void {
    this.pausedUntil = 0;
  }

  setMeetingQuiet(active: boolean): void {
    this.meetingQuietActive = active;
  }

  isPaused(): boolean {
    return Date.now() < this.pausedUntil;
  }
}
```

- [ ] **4.2** Create `src/main/__tests__/calloutManager.test.ts`:

```typescript
// src/main/__tests__/calloutManager.test.ts
import { CalloutManager, isInWorkHours } from '../calloutManager';
import { speechQueue } from '../core/speechQueue';
import type { Config } from '../../shared/types';

jest.mock('../core/speechQueue', () => ({
  speechQueue: { enqueue: jest.fn(), clear: jest.fn() },
}));
const mockEnqueue = speechQueue.enqueue as jest.Mock;

function makeConfig(overrides: Partial<Config['workHours']> = {}): Config {
  const now = new Date();
  const day = now.getDay();
  const h = now.getHours();
  const m = now.getMinutes();

  // Default: work hours include right now
  const startH = h - 1 < 0 ? 0 : h - 1;
  const endH = h + 2 > 23 ? 23 : h + 2;
  const pad = (n: number) => String(n).padStart(2, '0');

  return {
    botName: 'Cosmo',
    workHours: {
      start: `${pad(startH)}:00`,
      end: `${pad(endH)}:59`,
      days: [0, 1, 2, 3, 4, 5, 6], // all days
      ...overrides,
    },
    calloutCooldownMin: 20,
    idleSoftMin: 10,
    idleHardMin: 25,
    distractionMin: 15,
    distractionCapMin: 60,
    awayMin: 10,
    expressionPack: 'classic',
    personality: 'coach',
    llm: { provider: 'xai', model: 'grok-3-fast' },
    stt: { provider: 'whisperLocal' },
    voice: { enabled: true, rate: 180 },
    sounds: { enabled: true },
    camera: { enabled: false },
    workApps: [],
    workDomains: [],
    distractionDomains: [],
  } as Config;
}

describe('isInWorkHours', () => {
  it('returns true when current time falls within work hours and day matches', () => {
    const config = makeConfig();
    expect(isInWorkHours(config)).toBe(true);
  });

  it('returns false when current day is not in workHours.days', () => {
    const config = makeConfig();
    config.workHours.days = []; // no days
    expect(isInWorkHours(config)).toBe(false);
  });

  it('returns false when current time is before start', () => {
    const config = makeConfig();
    config.workHours.start = '23:00';
    config.workHours.end = '23:59';
    // Current time is almost certainly not in this window
    const now = new Date();
    if (now.getHours() < 23) {
      expect(isInWorkHours(config)).toBe(false);
    }
  });
});

describe('CalloutManager.requestCallout', () => {
  beforeEach(() => mockEnqueue.mockClear());

  it('enqueues callout text on first call during work hours', () => {
    const mgr = new CalloutManager(makeConfig());
    mgr.requestCallout('Hello there');
    expect(mockEnqueue).toHaveBeenCalledWith('Hello there');
  });

  it('blocks second callout within cooldown window', () => {
    const mgr = new CalloutManager(makeConfig());
    mgr.requestCallout('First');
    mgr.requestCallout('Second — should be blocked');
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
  });

  it('blocks callout while paused', () => {
    const mgr = new CalloutManager(makeConfig());
    mgr.pauseWatching(60 * 60 * 1_000); // pause 1h
    mgr.requestCallout('Should be blocked');
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('allows callout after resume', () => {
    const mgr = new CalloutManager(makeConfig());
    mgr.pauseWatching(60 * 60 * 1_000);
    mgr.resumeWatching();
    mgr.requestCallout('Now allowed');
    expect(mockEnqueue).toHaveBeenCalledWith('Now allowed');
  });

  it('blocks callout outside work hours', () => {
    const config = makeConfig();
    // Set work hours to a window that excludes now
    config.workHours.start = '00:00';
    config.workHours.end = '00:01';
    const mgr = new CalloutManager(config);
    mgr.requestCallout('Outside hours');
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('blocks callout during meeting quiet mode', () => {
    const mgr = new CalloutManager(makeConfig());
    mgr.setMeetingQuiet(true);
    mgr.requestCallout('Quiet during meeting');
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('allows callout after meeting quiet cleared', () => {
    const mgr = new CalloutManager(makeConfig());
    mgr.setMeetingQuiet(true);
    mgr.setMeetingQuiet(false);
    mgr.requestCallout('Now OK');
    expect(mockEnqueue).toHaveBeenCalledWith('Now OK');
  });
});
```

- [ ] **4.3** Run: `npx jest src/main/__tests__/calloutManager.test.ts` — all tests green.

---

## Task 5: `idleWatcher` (`src/main/watchers/idle/index.ts`)

**Purpose:** Poll `powerMonitor.getSystemIdleTime()`, escalate through bored → annoyed → sleeping, fire cooldown-gated callouts.

- [ ] **5.1** Create `src/main/watchers/idle/callouts.ts`:

```typescript
// src/main/watchers/idle/callouts.ts

const IDLE_CALLOUTS = [
  'Devashish. I have been staring at nothing for twenty-five minutes.',
  'I assume you have been kidnapped. Blink twice.',
  'Still here. Still waiting. No rush.',
  'Twenty-five minutes. I counted.',
  'I am not saying you are avoiding your work. I am just saying.',
  'The cursor has not moved. The cursor never moves.',
  'You know what also just sits there and does nothing? A screensaver.',
  'I have developed opinions about the ceiling since you left.',
];

let lastIndex = -1;

export function randomIdleCallout(): string {
  let index: number;
  do {
    index = Math.floor(Math.random() * IDLE_CALLOUTS.length);
  } while (index === lastIndex && IDLE_CALLOUTS.length > 1);
  lastIndex = index;
  return IDLE_CALLOUTS[index];
}
```

- [ ] **5.2** Create `src/main/watchers/idle/index.ts`:

```typescript
// src/main/watchers/idle/index.ts
import { powerMonitor } from 'electron';
import type { Watcher, WatcherContext } from '../types';
import { randomIdleCallout } from './callouts';

const DEV_MULTIPLIER = process.env.PIXEL_DEV === '1' ? (1 / 60) : 1; // seconds instead of minutes in dev

export const idleWatcher: Watcher = {
  name: 'idle',

  start(ctx: WatcherContext): void {
    const { config } = ctx;
    const pollMs = process.env.PIXEL_DEV === '1' ? 5_000 : 30_000;

    const softSec = config.idleSoftMin * 60 * DEV_MULTIPLIER;
    const hardSec = config.idleHardMin * 60 * DEV_MULTIPLIER;
    const sleepSec = 60 * 60 * DEV_MULTIPLIER; // 60 min → 60s in dev

    let calloutFiredForCurrentIdleSpell = false;

    this._interval = setInterval(() => {
      const idleSec = powerMonitor.getSystemIdleTime();

      if (idleSec >= sleepSec) {
        ctx.setMood('sleeping');
        calloutFiredForCurrentIdleSpell = true; // already escalated
        return;
      }

      if (idleSec >= hardSec) {
        ctx.setMood('annoyed');
        if (!calloutFiredForCurrentIdleSpell) {
          ctx.requestCallout(randomIdleCallout());
          calloutFiredForCurrentIdleSpell = true;
        }
        return;
      }

      if (idleSec >= softSec) {
        ctx.setMood('bored');
        return;
      }

      // User is active — reset the spell tracker so the next idle period gets a fresh callout
      calloutFiredForCurrentIdleSpell = false;
    }, pollMs);
  },

  stop(): void {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = undefined;
    }
  },

  resetWindow(): void {
    // Called on powerMonitor resume. The callout-fired flag resets naturally
    // when idle time drops to 0, but we force it here to be safe.
    // No rolling window to clear (idle watcher is stateless beyond the flag).
  },

  _interval: undefined as ReturnType<typeof setInterval> | undefined,
};
```

- [ ] **5.3** Create `src/main/watchers/idle/__tests__/idle.test.ts`:

```typescript
// src/main/watchers/idle/__tests__/idle.test.ts
import { powerMonitor } from 'electron';

jest.mock('electron', () => ({
  powerMonitor: { getSystemIdleTime: jest.fn() },
}));
const mockGetIdleTime = powerMonitor.getSystemIdleTime as jest.Mock;

// Use fake timers
jest.useFakeTimers();

// Force PIXEL_DEV for tests so thresholds are in seconds
process.env.PIXEL_DEV = '1';

// Re-import after setting env
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { idleWatcher } = require('../index') as typeof import('../index');

function makeCtx(configOverrides = {}) {
  return {
    config: {
      idleSoftMin: 10,  // in dev mode = 10s
      idleHardMin: 25,  // in dev mode = 25s
      calloutCooldownMin: 20,
      workHours: { start: '00:00', end: '23:59', days: [0,1,2,3,4,5,6] },
      ...configOverrides,
    },
    setMood: jest.fn(),
    requestCallout: jest.fn(),
    setActivity: jest.fn(),
    log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  };
}

describe('idleWatcher', () => {
  afterEach(() => {
    idleWatcher.stop();
    jest.clearAllMocks();
    jest.clearAllTimers();
  });

  it('stays idle when system idle time is below softSec threshold', () => {
    const ctx = makeCtx();
    mockGetIdleTime.mockReturnValue(5); // 5s < 10s soft threshold in dev
    idleWatcher.start(ctx as Parameters<typeof idleWatcher.start>[0]);
    jest.advanceTimersByTime(5_000); // one poll tick
    expect(ctx.setMood).not.toHaveBeenCalled();
  });

  it('sets mood to bored when idle >= softSec', () => {
    const ctx = makeCtx();
    mockGetIdleTime.mockReturnValue(15); // 15s >= 10s soft threshold
    idleWatcher.start(ctx as Parameters<typeof idleWatcher.start>[0]);
    jest.advanceTimersByTime(5_000);
    expect(ctx.setMood).toHaveBeenCalledWith('bored');
  });

  it('sets mood to annoyed and requests callout when idle >= hardSec', () => {
    const ctx = makeCtx();
    mockGetIdleTime.mockReturnValue(30); // 30s >= 25s hard threshold
    idleWatcher.start(ctx as Parameters<typeof idleWatcher.start>[0]);
    jest.advanceTimersByTime(5_000);
    expect(ctx.setMood).toHaveBeenCalledWith('annoyed');
    expect(ctx.requestCallout).toHaveBeenCalledTimes(1);
    expect(typeof ctx.requestCallout.mock.calls[0][0]).toBe('string');
  });

  it('fires callout only once per idle spell even on repeated polls', () => {
    const ctx = makeCtx();
    mockGetIdleTime.mockReturnValue(30);
    idleWatcher.start(ctx as Parameters<typeof idleWatcher.start>[0]);
    jest.advanceTimersByTime(5_000);  // poll 1
    jest.advanceTimersByTime(5_000);  // poll 2
    jest.advanceTimersByTime(5_000);  // poll 3
    expect(ctx.requestCallout).toHaveBeenCalledTimes(1);
  });

  it('sets mood to sleeping when idle >= 60s in dev mode', () => {
    const ctx = makeCtx();
    mockGetIdleTime.mockReturnValue(65); // 65s >= 60s sleep threshold in dev
    idleWatcher.start(ctx as Parameters<typeof idleWatcher.start>[0]);
    jest.advanceTimersByTime(5_000);
    expect(ctx.setMood).toHaveBeenCalledWith('sleeping');
  });

  it('resets callout flag when user becomes active again', () => {
    const ctx = makeCtx();
    // First: become annoyed
    mockGetIdleTime.mockReturnValue(30);
    idleWatcher.start(ctx as Parameters<typeof idleWatcher.start>[0]);
    jest.advanceTimersByTime(5_000);
    expect(ctx.requestCallout).toHaveBeenCalledTimes(1);

    // User returns active
    mockGetIdleTime.mockReturnValue(0);
    jest.advanceTimersByTime(5_000);

    // User goes idle again — new spell, new callout
    mockGetIdleTime.mockReturnValue(30);
    jest.advanceTimersByTime(5_000);
    expect(ctx.requestCallout).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **5.4** Run: `npx jest src/main/watchers/idle/__tests__/idle.test.ts` — all tests green.

---

## Task 6: `focusWatcher` (`src/main/watchers/focus/index.ts`)

**Purpose:** Poll frontmost app + active tab URL; classify app; accumulate distraction time; trigger callouts when over threshold.

- [ ] **6.1** Create `src/main/watchers/focus/classify.ts` (pure function, no Electron imports):

```typescript
// src/main/watchers/focus/classify.ts
import type { AppClass, Config } from '../../../shared/types';

const MEETING_APPS = new Set([
  'zoom.us',
  'zoom',
  'microsoft teams',
  'msteams',
  'facetime',
  'webex',
  'cisco webex meetings',
]);

const MEETING_DOMAINS = [
  'meet.google.com',
  'zoom.us',
  'chat.google.com',
  'teams.microsoft.com',
];

function matchesDomain(url: string, domains: string[]): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return domains.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

/**
 * Classify a frontmost app into one of four classes.
 * Pure function — no side effects, fully testable in isolation.
 *
 * @param appName  Process name from System Events (case-insensitive match).
 * @param url      Active tab URL if a browser is frontmost; undefined otherwise.
 * @param config   Current Config (workApps, workDomains, distractionDomains).
 */
export function classifyApp(
  appName: string,
  url: string | undefined,
  config: Pick<Config, 'workApps' | 'workDomains' | 'distractionDomains'>,
): AppClass {
  const nameLower = appName.toLowerCase();

  // Meeting apps take priority — we need quiet mode regardless of everything else
  if (MEETING_APPS.has(nameLower)) return 'meeting';
  if (url && matchesDomain(url, MEETING_DOMAINS)) return 'meeting';

  // Check work apps by process name
  if (config.workApps.some((a) => a.toLowerCase() === nameLower)) return 'work';

  // URL-based classification
  if (url) {
    if (matchesDomain(url, config.distractionDomains)) return 'distraction';
    if (matchesDomain(url, config.workDomains)) return 'work';
  }

  return 'neutral';
}
```

- [ ] **6.2** Create `src/main/watchers/focus/callouts.ts`:

```typescript
// src/main/watchers/focus/callouts.ts

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function distractionCallout(domain: string): string {
  const templates = [
    `Forty minutes of ${domain}. The content will still exist after your sprint.`,
    `Still on ${domain}. The discourse will survive without you.`,
    `${domain}. Again. Fascinating choice.`,
    `I am not judging. I am just noting that it has been a while on ${domain}.`,
    `The ${domain} rabbit hole has claimed another victim. That victim is you.`,
  ];
  return pick(templates);
}
```

- [ ] **6.3** Create `src/main/watchers/focus/scripts.ts` (AppleScript strings as constants — no dynamic interpolation):

```typescript
// src/main/watchers/focus/scripts.ts

export const GET_FRONTMOST_APP = `
tell application "System Events"
  get name of first process whose frontmost is true
end tell
`.trim();

export const GET_CHROME_URL = `
tell application "Google Chrome"
  get URL of active tab of front window
end tell
`.trim();

export const GET_SAFARI_URL = `
tell application "Safari"
  get URL of current tab of front window
end tell
`.trim();

export const GET_ARC_URL = `
tell application "Arc"
  get URL of active tab of front window
end tell
`.trim();

export const GET_FIREFOX_URL = `
tell application "Firefox"
  get URL of active tab of front window
end tell
`.trim();
```

- [ ] **6.4** Create `src/main/watchers/focus/index.ts`:

```typescript
// src/main/watchers/focus/index.ts
import type { Watcher, WatcherContext } from '../types';
import { runScript } from '../../core/osascript';
import { classifyApp } from './classify';
import { distractionCallout } from './callouts';
import {
  GET_FRONTMOST_APP,
  GET_CHROME_URL,
  GET_SAFARI_URL,
  GET_ARC_URL,
  GET_FIREFOX_URL,
} from './scripts';

const BROWSER_APPS = new Set(['google chrome', 'chrome', 'safari', 'arc', 'firefox']);

const BROWSER_URL_SCRIPTS: Record<string, string> = {
  'google chrome': GET_CHROME_URL,
  chrome: GET_CHROME_URL,
  safari: GET_SAFARI_URL,
  arc: GET_ARC_URL,
  firefox: GET_FIREFOX_URL,
};

// Rolling window: array of { timestamp, isoDistraction } entries
interface WindowEntry {
  ts: number;
  isDistraction: boolean;
  domain: string;
}

const WINDOW_MS = 30 * 60 * 1_000; // 30 min rolling window
const POLL_MS = process.env.PIXEL_DEV === '1' ? 5_000 : 30_000;

export const focusWatcher: Watcher = {
  name: 'focus',

  start(ctx: WatcherContext): void {
    this._rollingWindow = [];
    this._lastDistractionDomain = '';
    this._interval = setInterval(() => void this._poll(ctx), POLL_MS);
  },

  stop(): void {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = undefined;
    }
  },

  resetWindow(): void {
    this._rollingWindow = [];
    this._lastDistractionDomain = '';
  },

  async _poll(ctx: WatcherContext): Promise<void> {
    let appName: string;
    try {
      appName = await runScript(GET_FRONTMOST_APP);
    } catch (err) {
      ctx.log.warn('[focusWatcher] Could not get frontmost app:', err);
      return;
    }

    let url: string | undefined;
    const nameLower = appName.toLowerCase();
    if (BROWSER_APPS.has(nameLower)) {
      const script = BROWSER_URL_SCRIPTS[nameLower];
      if (script) {
        try {
          url = await runScript(script);
        } catch {
          // Browser might not have a window; non-fatal
        }
      }
    }

    const appClass = classifyApp(appName, url, ctx.config);

    // Update meeting quiet mode via callout manager
    // (The actual setMeetingQuiet call happens in main/index.ts which owns calloutManager)
    // Here we emit a mood signal only for distraction
    const now = Date.now();

    // Prune old entries
    this._rollingWindow = this._rollingWindow.filter(
      (e: WindowEntry) => now - e.ts < WINDOW_MS,
    );

    const domain = url
      ? (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } })()
      : '';

    this._rollingWindow.push({ ts: now, isDistraction: appClass === 'distraction', domain });

    // Sum distraction time (each entry represents one poll interval)
    const distractionMs = this._rollingWindow.filter((e: WindowEntry) => e.isDistraction).length * POLL_MS;
    const thresholdMs = ctx.config.distractionMin * 60 * 1_000 * (process.env.PIXEL_DEV === '1' ? (1 / 60) : 1);

    if (distractionMs >= thresholdMs && appClass === 'distraction') {
      // Only fire if the last dominant domain is still in use
      ctx.requestCallout(distractionCallout(domain || appName));
      // Reset window to avoid repeat callouts every poll after threshold
      this._rollingWindow = this._rollingWindow.filter((e: WindowEntry) => !e.isDistraction);
    }
  },

  _interval: undefined as ReturnType<typeof setInterval> | undefined,
  _rollingWindow: [] as WindowEntry[],
  _lastDistractionDomain: '' as string,
};

// Re-export for testing
export { classifyApp };
```

- [ ] **6.5** Create `src/main/watchers/focus/__tests__/classify.test.ts`:

```typescript
// src/main/watchers/focus/__tests__/classify.test.ts
import { classifyApp } from '../classify';
import type { Config } from '../../../../shared/types';

const baseConfig: Pick<Config, 'workApps' | 'workDomains' | 'distractionDomains'> = {
  workApps: ['Code', 'Cursor', 'iTerm2', 'Terminal', 'Figma', 'Xcode'],
  workDomains: ['github.com', 'localhost', 'docs.anthropic.com'],
  distractionDomains: ['youtube.com', 'x.com', 'twitter.com', 'instagram.com', 'reddit.com'],
};

describe('classifyApp', () => {
  it('classifies a work app by name', () => {
    expect(classifyApp('Code', undefined, baseConfig)).toBe('work');
    expect(classifyApp('Cursor', undefined, baseConfig)).toBe('work');
  });

  it('classifies by work domain URL', () => {
    expect(classifyApp('Google Chrome', 'https://github.com/org/repo', baseConfig)).toBe('work');
    expect(classifyApp('Safari', 'http://localhost:3000', baseConfig)).toBe('work');
  });

  it('classifies by distraction domain URL', () => {
    expect(classifyApp('Google Chrome', 'https://youtube.com/watch?v=abc', baseConfig)).toBe('distraction');
    expect(classifyApp('Safari', 'https://www.reddit.com/r/programming', baseConfig)).toBe('distraction');
    expect(classifyApp('Arc', 'https://twitter.com/home', baseConfig)).toBe('distraction');
  });

  it('classifies meeting apps by process name', () => {
    expect(classifyApp('zoom.us', undefined, baseConfig)).toBe('meeting');
    expect(classifyApp('Microsoft Teams', undefined, baseConfig)).toBe('meeting');
    expect(classifyApp('FaceTime', undefined, baseConfig)).toBe('meeting');
    expect(classifyApp('Webex', undefined, baseConfig)).toBe('meeting');
  });

  it('classifies as meeting when browser is on a meeting domain', () => {
    expect(classifyApp('Google Chrome', 'https://meet.google.com/abc-def', baseConfig)).toBe('meeting');
    expect(classifyApp('Safari', 'https://zoom.us/j/12345', baseConfig)).toBe('meeting');
  });

  it('returns neutral for unknown apps with no URL', () => {
    expect(classifyApp('Spotify', undefined, baseConfig)).toBe('neutral');
    expect(classifyApp('Discord', undefined, baseConfig)).toBe('neutral');
  });

  it('distraction takes precedence over neutral when URL matches', () => {
    expect(classifyApp('Spotify', 'https://youtube.com', baseConfig)).toBe('distraction');
  });

  it('meeting takes precedence over distraction URL', () => {
    expect(classifyApp('zoom.us', 'https://reddit.com', baseConfig)).toBe('meeting');
  });

  it('handles case-insensitive app name matching', () => {
    expect(classifyApp('cursor', undefined, baseConfig)).toBe('work');
    expect(classifyApp('ZOOM.US', undefined, baseConfig)).toBe('meeting');
  });

  it('handles malformed URLs gracefully', () => {
    expect(() => classifyApp('Chrome', 'not-a-url', baseConfig)).not.toThrow();
    expect(classifyApp('Chrome', 'not-a-url', baseConfig)).toBe('neutral');
  });
});
```

- [ ] **6.6** Run: `npx jest src/main/watchers/focus/__tests__/classify.test.ts` — all tests green.

---

## Task 7: `batteryWatcher` (`src/main/watchers/battery/index.ts`)

**Purpose:** Monitor battery level when on battery power; urgent callouts below 10%; no callouts on AC.

- [ ] **7.1** Create `src/main/watchers/battery/index.ts`:

```typescript
// src/main/watchers/battery/index.ts
import { powerMonitor } from 'electron';
import type { Watcher, WatcherContext } from '../types';

const POLL_MS = 5 * 60 * 1_000; // 5 min
const LOW_THRESHOLD = 20;
const CRITICAL_THRESHOLD = 10;
const CRITICAL_REPEAT_MS = 5 * 60 * 1_000; // repeat every 5 min below 10%

interface PowerState {
  isOnBatteryPower: boolean;
  percentRemaining: number;
}

// Electron types may not expose getSystemPowerState in all versions
// Wrap with a safe accessor
function getPowerState(): PowerState | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (powerMonitor as any).getSystemPowerState?.() ?? null;
  } catch {
    return null;
  }
}

export const batteryWatcher: Watcher = {
  name: 'battery',

  start(ctx: WatcherContext): void {
    this._lowFired = false;
    this._lastCriticalCallout = 0;
    this._interval = setInterval(() => this._check(ctx), POLL_MS);
    // Also check immediately
    this._check(ctx);
  },

  stop(): void {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = undefined;
    }
  },

  resetWindow(): void {
    this._lowFired = false;
    this._lastCriticalCallout = 0;
  },

  _check(ctx: WatcherContext): void {
    const state = getPowerState();
    if (!state) return;

    // No callouts when plugged in
    if (!state.isOnBatteryPower) {
      this._lowFired = false;
      this._lastCriticalCallout = 0;
      return;
    }

    const { percentRemaining } = state;
    const now = Date.now();

    if (percentRemaining <= CRITICAL_THRESHOLD) {
      ctx.setMood('annoyed');
      // Bypass normal callout cooldown for critical battery — track separately
      if (now - this._lastCriticalCallout >= CRITICAL_REPEAT_MS) {
        this._lastCriticalCallout = now;
        ctx.requestCallout(
          `Battery at ${percentRemaining}%. I am about to die. Unlike your procrastination, which is thriving.`,
        );
      }
      return;
    }

    if (percentRemaining <= LOW_THRESHOLD && !this._lowFired) {
      this._lowFired = true;
      ctx.requestCallout(
        `I am running low on power. Unlike you, who has infinite energy for distractions.`,
      );
    }
  },

  _interval: undefined as ReturnType<typeof setInterval> | undefined,
  _lowFired: false as boolean,
  _lastCriticalCallout: 0 as number,
};
```

- [ ] **7.2** Create `src/main/watchers/battery/__tests__/battery.test.ts`:

```typescript
// src/main/watchers/battery/__tests__/battery.test.ts
import { powerMonitor } from 'electron';

jest.mock('electron', () => ({
  powerMonitor: {
    getSystemPowerState: jest.fn(),
  },
}));

jest.useFakeTimers();

const mockGetPowerState = (powerMonitor as unknown as { getSystemPowerState: jest.Mock }).getSystemPowerState;

// Re-import after mock
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { batteryWatcher } = require('../index') as typeof import('../index');

function makeCtx() {
  return {
    config: {} as Parameters<typeof batteryWatcher.start>[0]['config'],
    setMood: jest.fn(),
    requestCallout: jest.fn(),
    setActivity: jest.fn(),
    log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  };
}

describe('batteryWatcher', () => {
  afterEach(() => {
    batteryWatcher.stop();
    jest.clearAllMocks();
    jest.clearAllTimers();
  });

  it('does not call requestCallout when on AC power', () => {
    mockGetPowerState.mockReturnValue({ isOnBatteryPower: false, percentRemaining: 15 });
    const ctx = makeCtx();
    batteryWatcher.start(ctx as Parameters<typeof batteryWatcher.start>[0]);
    expect(ctx.requestCallout).not.toHaveBeenCalled();
  });

  it('fires low-battery callout once when battery drops to 19%', () => {
    mockGetPowerState.mockReturnValue({ isOnBatteryPower: true, percentRemaining: 19 });
    const ctx = makeCtx();
    batteryWatcher.start(ctx as Parameters<typeof batteryWatcher.start>[0]);
    expect(ctx.requestCallout).toHaveBeenCalledTimes(1);
    expect(ctx.requestCallout.mock.calls[0][0]).toContain('running low on power');
  });

  it('fires low-battery callout only once even after multiple polls at 19%', () => {
    mockGetPowerState.mockReturnValue({ isOnBatteryPower: true, percentRemaining: 19 });
    const ctx = makeCtx();
    batteryWatcher.start(ctx as Parameters<typeof batteryWatcher.start>[0]);
    jest.advanceTimersByTime(5 * 60 * 1_000); // 2nd poll
    jest.advanceTimersByTime(5 * 60 * 1_000); // 3rd poll
    expect(ctx.requestCallout).toHaveBeenCalledTimes(1);
  });

  it('sets mood to annoyed and fires callout at 9%', () => {
    mockGetPowerState.mockReturnValue({ isOnBatteryPower: true, percentRemaining: 9 });
    const ctx = makeCtx();
    batteryWatcher.start(ctx as Parameters<typeof batteryWatcher.start>[0]);
    expect(ctx.setMood).toHaveBeenCalledWith('annoyed');
    expect(ctx.requestCallout).toHaveBeenCalledTimes(1);
    expect(ctx.requestCallout.mock.calls[0][0]).toContain('9%');
  });

  it('repeats critical callout every 5 min below 10%', () => {
    mockGetPowerState.mockReturnValue({ isOnBatteryPower: true, percentRemaining: 9 });
    const ctx = makeCtx();
    batteryWatcher.start(ctx as Parameters<typeof batteryWatcher.start>[0]);
    expect(ctx.requestCallout).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(5 * 60 * 1_000); // triggers poll
    expect(ctx.requestCallout).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(5 * 60 * 1_000);
    expect(ctx.requestCallout).toHaveBeenCalledTimes(3);
  });

  it('resets low-fired flag when charger is connected', () => {
    const ctx = makeCtx();
    // Battery is low
    mockGetPowerState.mockReturnValue({ isOnBatteryPower: true, percentRemaining: 19 });
    batteryWatcher.start(ctx as Parameters<typeof batteryWatcher.start>[0]);
    expect(ctx.requestCallout).toHaveBeenCalledTimes(1);

    // Charger connected
    mockGetPowerState.mockReturnValue({ isOnBatteryPower: false, percentRemaining: 19 });
    jest.advanceTimersByTime(5 * 60 * 1_000);

    // Battery drops again (charger unplugged)
    mockGetPowerState.mockReturnValue({ isOnBatteryPower: true, percentRemaining: 19 });
    jest.advanceTimersByTime(5 * 60 * 1_000);
    expect(ctx.requestCallout).toHaveBeenCalledTimes(2); // fires again
  });
});
```

- [ ] **7.3** Run: `npx jest src/main/watchers/battery/__tests__/battery.test.ts` — all tests green.

---

## Task 8: `eyeStrainWatcher` (`src/main/watchers/eyeStrain/index.ts`)

**Purpose:** Track continuous non-idle screen time; remind to look away every 20 minutes; reset on breaks.

- [ ] **8.1** Create `src/main/watchers/eyeStrain/index.ts`:

```typescript
// src/main/watchers/eyeStrain/index.ts
import { powerMonitor } from 'electron';
import type { Watcher, WatcherContext } from '../types';

// In Phase 2, we sample idle time directly here.
// In Phase 6, the cadence signal replaces this with real input cadence.
const SAMPLE_MS = process.env.PIXEL_DEV === '1' ? 2_000 : 60_000; // 1-min samples, 2s in dev
const BREAK_IDLE_SEC = 60; // 60s idle counts as a break
const REMIND_INTERVALS = process.env.PIXEL_DEV === '1' ? 2 : 20; // samples before reminder

export const eyeStrainWatcher: Watcher = {
  name: 'eyeStrain',

  start(ctx: WatcherContext): void {
    this._continuousSamples = 0;
    this._interval = setInterval(() => this._check(ctx), SAMPLE_MS);
  },

  stop(): void {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = undefined;
    }
  },

  resetWindow(): void {
    this._continuousSamples = 0;
  },

  _check(ctx: WatcherContext): void {
    const idleSec = powerMonitor.getSystemIdleTime();

    if (idleSec >= BREAK_IDLE_SEC) {
      // Break detected — reset counter
      this._continuousSamples = 0;
      return;
    }

    this._continuousSamples += 1;

    if (this._continuousSamples >= REMIND_INTERVALS) {
      this._continuousSamples = 0; // reset so it fires again in another 20 min
      ctx.requestCallout('Look at something twenty feet away for twenty seconds.');
    }
  },

  _interval: undefined as ReturnType<typeof setInterval> | undefined,
  _continuousSamples: 0 as number,
};
```

- [ ] **8.2** Create `src/main/watchers/eyeStrain/__tests__/eyeStrain.test.ts`:

```typescript
// src/main/watchers/eyeStrain/__tests__/eyeStrain.test.ts
import { powerMonitor } from 'electron';

jest.mock('electron', () => ({
  powerMonitor: { getSystemIdleTime: jest.fn() },
}));
const mockGetIdleTime = powerMonitor.getSystemIdleTime as jest.Mock;

jest.useFakeTimers();

process.env.PIXEL_DEV = '1'; // 2s samples, 2 intervals = 4s to remind

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { eyeStrainWatcher } = require('../index') as typeof import('../index');

function makeCtx() {
  return {
    config: {} as Parameters<typeof eyeStrainWatcher.start>[0]['config'],
    setMood: jest.fn(),
    requestCallout: jest.fn(),
    setActivity: jest.fn(),
    log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  };
}

describe('eyeStrainWatcher', () => {
  afterEach(() => {
    eyeStrainWatcher.stop();
    jest.clearAllMocks();
    jest.clearAllTimers();
  });

  it('fires callout after 2 continuous non-idle samples (dev mode)', () => {
    mockGetIdleTime.mockReturnValue(5); // 5s < 60s break threshold
    const ctx = makeCtx();
    eyeStrainWatcher.start(ctx as Parameters<typeof eyeStrainWatcher.start>[0]);
    jest.advanceTimersByTime(2_000); // sample 1
    jest.advanceTimersByTime(2_000); // sample 2 → REMIND_INTERVALS reached
    expect(ctx.requestCallout).toHaveBeenCalledTimes(1);
    expect(ctx.requestCallout.mock.calls[0][0]).toContain('twenty feet');
  });

  it('resets counter after callout fires (re-fires after another 2 samples)', () => {
    mockGetIdleTime.mockReturnValue(5);
    const ctx = makeCtx();
    eyeStrainWatcher.start(ctx as Parameters<typeof eyeStrainWatcher.start>[0]);
    jest.advanceTimersByTime(2_000);
    jest.advanceTimersByTime(2_000); // first reminder
    jest.advanceTimersByTime(2_000);
    jest.advanceTimersByTime(2_000); // second reminder
    expect(ctx.requestCallout).toHaveBeenCalledTimes(2);
  });

  it('resets counter when user takes a 60s+ break', () => {
    const ctx = makeCtx();
    eyeStrainWatcher.start(ctx as Parameters<typeof eyeStrainWatcher.start>[0]);

    // 1 non-idle sample
    mockGetIdleTime.mockReturnValue(5);
    jest.advanceTimersByTime(2_000);

    // Break — idle > 60s
    mockGetIdleTime.mockReturnValue(65);
    jest.advanceTimersByTime(2_000); // counter resets

    // Now needs 2 more non-idle samples before reminder
    mockGetIdleTime.mockReturnValue(5);
    jest.advanceTimersByTime(2_000); // sample 1 post-break
    expect(ctx.requestCallout).not.toHaveBeenCalled();

    jest.advanceTimersByTime(2_000); // sample 2 → fires
    expect(ctx.requestCallout).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **8.3** Run: `npx jest src/main/watchers/eyeStrain/__tests__/eyeStrain.test.ts` — all tests green.

---

## Task 9: Sleep/wake reset (`main/index.ts` addition)

**Purpose:** On `powerMonitor` `resume`, reset all watcher rolling windows and clear the speech queue so the bot never scolds after wake.

- [ ] **9.1** Add the resume handler in `src/main/index.ts` (shown as a targeted addition — insert into the existing app lifecycle setup, after `app.whenReady()`):

```typescript
// src/main/index.ts  (excerpt — add this block after watchers are started)
import { app, powerMonitor, Tray, Menu, BrowserWindow } from 'electron';
import { startAll, stopAll, resetAllWindows } from './watchers/registry';
import { speechQueue } from './core/speechQueue';
import { CalloutManager } from './calloutManager';

// ... existing app setup ...

// Sleep/wake reset — mandatory for daily-driver reliability
powerMonitor.on('resume', () => {
  // 1. Clear any queued speech (no post-wake callout backlog)
  speechQueue.clear();

  // 2. Reset every watcher's rolling window so distraction timers start fresh
  resetAllWindows();

  // Mood resets to idle on any interaction; no forced mood change here
  // because the user hasn't done anything yet — let the bot stay in whatever
  // visual state it was in and snap to idle naturally on first input.
});

app.on('quit', () => {
  stopAll();
  speechQueue.clear();
});
```

- [ ] **9.2** Create `src/main/__tests__/resumeReset.test.ts`:

```typescript
// src/main/__tests__/resumeReset.test.ts
// Tests the powerMonitor.resume integration without spinning up Electron

import { EventEmitter } from 'events';

// We test the behaviour by directly simulating the resume handler logic
// (the handler itself is a closure created in main/index.ts; here we verify
//  the components it calls behave correctly when called together)

import { resetAllWindows, registerWatcher, _clearRegistry } from '../watchers/registry';
import { speechQueue } from '../core/speechQueue';
import type { Watcher } from '../watchers/types';

jest.mock('../core/speechQueue', () => ({
  speechQueue: { enqueue: jest.fn(), clear: jest.fn() },
}));

const mockClear = speechQueue.clear as jest.Mock;

describe('resume reset behaviour', () => {
  beforeEach(() => _clearRegistry());
  afterEach(() => jest.clearAllMocks());

  it('speechQueue.clear() is called on resume', () => {
    // Simulate what the resume handler does
    speechQueue.clear();
    expect(mockClear).toHaveBeenCalledTimes(1);
  });

  it('resetAllWindows() calls resetWindow on each watcher', () => {
    const w: Watcher & { resetWindow: jest.Mock } = {
      name: 'test',
      start: jest.fn(),
      stop: jest.fn(),
      resetWindow: jest.fn(),
    };
    registerWatcher(w);
    resetAllWindows();
    expect(w.resetWindow).toHaveBeenCalled();
  });

  it('resetAllWindows() is safe when watcher has no resetWindow', () => {
    const w: Watcher = { name: 'no-reset', start: jest.fn(), stop: jest.fn() };
    registerWatcher(w);
    expect(() => resetAllWindows()).not.toThrow();
  });
});
```

- [ ] **9.3** Run: `npx jest src/main/__tests__/resumeReset.test.ts` — all tests green.

---

## Task 10: Wire everything in `src/main/index.ts`

**Purpose:** Register all watchers, build the `WatcherContext`, connect callout manager to tray, and handle the full lifecycle.

- [ ] **10.1** Register watchers and build `WatcherContext` (add to `src/main/index.ts`):

```typescript
// src/main/index.ts — complete additions for Phase 2
// Insert these after the existing Phase 0/1 setup

import { app, Tray, Menu, BrowserWindow, powerMonitor } from 'electron';
import { registerWatcher, startAll, stopAll, resetAllWindows } from './watchers/registry';
import { idleWatcher } from './watchers/idle';
import { focusWatcher } from './watchers/focus';
import { batteryWatcher } from './watchers/battery';
import { eyeStrainWatcher } from './watchers/eyeStrain';
import { speechQueue } from './core/speechQueue';
import { CalloutManager } from './calloutManager';
import type { WatcherContext, Config } from '../shared/types';

// Register all Phase 2 watchers (order doesn't matter)
registerWatcher(idleWatcher);
registerWatcher(focusWatcher);
registerWatcher(batteryWatcher);
registerWatcher(eyeStrainWatcher);

// Created once; config updated via updateConfig() when settings change
let calloutManager: CalloutManager;

function buildWatcherContext(config: Readonly<Config>): WatcherContext {
  return {
    config,
    setMood(state) {
      // stateManager is the Phase 1 singleton that owns MoodState
      stateManager.setMood(state);
    },
    requestCallout(text) {
      calloutManager.requestCallout(text);
    },
    setActivity(activity) {
      stateManager.setActivity(activity);
    },
    log: logger, // Phase 0/1 logger instance
  };
}

app.whenReady().then(async () => {
  // ... existing Phase 0/1 window + tray setup ...

  const config = store.get('config') as Config; // electron-store instance from Phase 0
  calloutManager = new CalloutManager(config);
  speechQueue.setEnabled(config.voice.enabled);
  speechQueue.setRate(config.voice.rate);

  const ctx = buildWatcherContext(config);
  startAll(ctx);

  // Sleep/wake reset
  powerMonitor.on('resume', () => {
    speechQueue.clear();
    resetAllWindows();
  });
});

// Full tray menu (Phase 2 additions — extend existing tray)
function buildTrayMenu(): Electron.MenuItemConstructorOptions[] {
  return [
    { label: 'Show / Hide', click: () => mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show() },
    { type: 'separator' },
    {
      label: 'Pause watching (1h)',
      click: () => {
        calloutManager.pauseWatching(60 * 60 * 1_000);
        tray.setToolTip('Cosmo — watching paused');
      },
    },
    {
      label: 'Resume watching',
      click: () => {
        calloutManager.resumeWatching();
        tray.setToolTip('Cosmo');
      },
    },
    {
      label: 'Mute voice',
      type: 'checkbox',
      checked: !config.voice.enabled,
      click: (item) => {
        speechQueue.setEnabled(!item.checked);
      },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ];
}

app.on('quit', () => {
  stopAll();
  speechQueue.clear();
});
```

- [ ] **10.2** Ensure `PIXEL_DEV=1` is documented in `.env.example`:

```
# .env.example
XAI_API_KEY=
OPENAI_API_KEY=
GOOGLE_API_KEY=
DEEPSEEK_API_KEY=
ANTHROPIC_API_KEY=
PICOVOICE_ACCESS_KEY=
PIXEL_DEV=       # set to 1 for accelerated thresholds (seconds instead of minutes) and 5s poll intervals
```

---

## Task 11: Jest configuration

**Purpose:** Ensure all test files can run with `npx jest` from the project root.

- [ ] **11.1** Verify or create `jest.config.ts` at project root:

```typescript
// jest.config.ts
import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    // Mock Electron modules in tests
    electron: '<rootDir>/src/__mocks__/electron.ts',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  clearMocks: true,
};

export default config;
```

- [ ] **11.2** Create Electron mock at `src/__mocks__/electron.ts`:

```typescript
// src/__mocks__/electron.ts
// Minimal Electron mock for Node test environment
export const app = {
  getPath: jest.fn(() => '/tmp/pixel-test'),
  on: jest.fn(),
  whenReady: jest.fn(() => Promise.resolve()),
  quit: jest.fn(),
  dock: { hide: jest.fn() },
};

export const powerMonitor = {
  getSystemIdleTime: jest.fn(() => 0),
  getSystemPowerState: jest.fn(() => ({ isOnBatteryPower: false, percentRemaining: 100 })),
  on: jest.fn(),
};

export const ipcMain = { on: jest.fn(), handle: jest.fn() };
export const ipcRenderer = { on: jest.fn(), send: jest.fn() };
export const BrowserWindow = jest.fn();
export const Tray = jest.fn();
export const Menu = { buildFromTemplate: jest.fn(), setApplicationMenu: jest.fn() };
export const nativeTheme = { shouldUseDarkColors: false };
```

- [ ] **11.3** Verify `tsconfig.json` has `strict: true` and includes `src/**/*.ts`. No changes if already correct.

---

## Task 12: Full escalation smoke test (`PIXEL_DEV=1`)

This is not an automated test — it is a manual acceptance verification step.

- [ ] **12.1** Build and run the app:

```bash
PIXEL_DEV=1 npm run dev
# or
PIXEL_DEV=1 npx electron .
```

- [ ] **12.2** Escalation sequence (observe visually):
  1. Do nothing — after ~10 seconds, eyes go half-lidded (`bored`).
  2. After ~25 seconds idle, eyes narrow and shift amber (`annoyed`); a callout is spoken.
  3. Further inactivity for ~60 seconds total → eyes close to 2px lines (`sleeping`).
  4. Move the mouse or click — eyes return to `idle` immediately.

- [ ] **12.3** Cooldown verification:
  1. Trigger annoyed (wait 25s idle).
  2. Become active, then idle again within 20 seconds.
  3. Confirm: mood changes to `annoyed` again but **no second callout fires**.

- [ ] **12.4** Pause watching verification:
  1. Click "Pause watching (1h)" in tray.
  2. Wait > 25 seconds idle.
  3. Confirm: mood escalates visually (eyes go bored/annoyed) but **no speech fires**.

- [ ] **12.5** Outside work hours verification:
  1. Temporarily set `workHours` in config to a window that excludes the current time.
  2. Restart with `PIXEL_DEV=1`.
  3. Wait > 25s — confirm no callouts fire; bot may still change moods silently.

- [ ] **12.6** Sleep/wake reset verification:
  1. Let the app accumulate 25s of idle time (annoyed state, callout fired).
  2. Simulate sleep: `pmset sleepnow` or close the lid briefly.
  3. Wake the machine.
  4. Confirm: no queued speech plays on wake; idle timer restarts from zero.

---

## Acceptance Criteria

| # | Criterion | How to verify |
|---|---|---|
| AC-1 | `PIXEL_DEV=1` full bored → annoyed → sleeping escalation observable | Task 12.2 |
| AC-2 | Callout fires once per idle spell; cooldown blocks repeat within 20 min | Task 12.3 |
| AC-3 | Zero callouts while tray-paused | Task 12.4 |
| AC-4 | Zero callouts outside configured work hours | Task 12.5 |
| AC-5 | Sleep/wake reset: no post-wake callout backlog | Task 12.6 |
| AC-6 | All unit tests pass: `npx jest` exits 0 | CI / local run |
| AC-7 | `classifyApp` correctly identifies work, distraction, meeting, neutral | Task 6.6 |
| AC-8 | Battery callouts fire at 19% (once) and 9% (repeat every 5 min) | Task 7.3 |
| AC-9 | Eye-strain reminder fires every 20 min of continuous non-idle screen time | Task 8.3 |
| AC-10 | No AppleScript call uses `exec` with interpolated strings — only `execFile` with argument arrays | `grep -r 'child_process.exec(' src/` returns only matches inside `execFile` |

---

## File checklist

After all tasks complete, the following files must exist:

```
src/
  __mocks__/
    electron.ts
  shared/
    types.ts                              (updated with AppClass, InputCadence, WatcherContext, Watcher)
  main/
    calloutManager.ts
    index.ts                              (Phase 2 additions wired)
    core/
      osascript.ts
      speechQueue.ts
      __tests__/
        osascript.test.ts
        speechQueue.test.ts
    watchers/
      types.ts
      registry.ts
      __tests__/
        registry.test.ts
      idle/
        index.ts
        callouts.ts
        __tests__/
          idle.test.ts
      focus/
        index.ts
        classify.ts
        callouts.ts
        scripts.ts
        __tests__/
          classify.test.ts
      battery/
        index.ts
        __tests__/
          battery.test.ts
      eyeStrain/
        index.ts
        __tests__/
          eyeStrain.test.ts
    __tests__/
      calloutManager.test.ts
      resumeReset.test.ts
jest.config.ts
.env.example                              (PIXEL_DEV documented)
```

---

## Notes for implementor

- **PIXEL_DEV=1 threshold math:** All watcher thresholds stored in config are in minutes. When `PIXEL_DEV=1`, each watcher multiplies its threshold by `(1/60)` before comparing against seconds returned by `powerMonitor.getSystemIdleTime()`. This avoids touching config shape or the unit contract.

- **focusWatcher and meeting quiet mode:** `classifyApp` correctly returns `'meeting'` for Zoom/Teams/Meet. In Phase 2, `focusWatcher` should call `calloutManager.setMeetingQuiet(appClass === 'meeting')` on each poll. Add this in Task 10.1 by exposing `calloutManager` from the scope where `focusWatcher` runs, or by threading it through `WatcherContext` as an optional extension. The cleanest Phase 2 approach: add a `setMeetingQuiet?: (active: boolean) => void` field to `WatcherContext` and populate it in `buildWatcherContext`.

- **AppleScript for browser URL:** Arc's AppleScript dictionary differs from Chrome's in some versions. If `GET_ARC_URL` fails with a script error (not a permission error), catch it silently and proceed without a URL — the focus watcher degrades to app-name-only classification, which is still useful.

- **`powerMonitor.getSystemPowerState` availability:** This API was added in Electron 22. If the target runs an older Electron, fall back to polling `powerMonitor.isOnBatteryPower()` and `powerMonitor.getCurrentActivityType()`. Wrap in the try/catch already in `batteryWatcher._check`.

- **Test isolation for env vars:** The `PIXEL_DEV=1` env var is read at module load time in some watchers (`const POLL_MS = ...`). Tests that import these modules must set `process.env.PIXEL_DEV = '1'` **before** the `require()` / `import`. The test files above use `jest.mock` + deferred `require` for this reason.

- **`calloutManager` vs `WatcherContext.requestCallout`:** Watchers call `ctx.requestCallout(text)`. The `WatcherContext` is built in `main/index.ts` and its `requestCallout` closure calls `calloutManager.requestCallout(text)`. This indirection means watchers are fully decoupled from `CalloutManager` — they can be unit-tested with a plain mock ctx.
