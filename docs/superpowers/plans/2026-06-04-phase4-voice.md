# Phase 4: Voice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add fully hands-free voice interaction via wake word and STT with a guaranteed hover-dot fallback.
**Architecture:** VoiceController orchestrates Porcupine (wake word) → recorder → STT → brain.handleUserInput. Wake failures never block startup; the hover mic dot is always the fallback entry point.
**Tech Stack:** @picovoice/porcupine-node, nodejs-whisper (research best binding at impl time), node-record-lpcm16 or sox

---

## File Map

Files to **create** (in dependency order):

```
src/main/stt/types.ts                        # STTProvider interface
src/main/stt/registry.ts                     # registerSTT, getActiveSTT
src/main/stt/whisperLocal/index.ts           # whisper.cpp binding, default offline
src/main/stt/openaiWhisper/index.ts          # OpenAI Whisper API adapter
src/main/voice/recorder.ts                  # audio capture + silence detection
src/main/voice/wakeWord.ts                  # Porcupine wrapper + error classes
src/main/voice/controller.ts               # VoiceController — single orchestrator

tests/main/stt/registry.test.ts
tests/main/stt/whisperLocal.test.ts
tests/main/stt/openaiWhisper.test.ts
tests/main/voice/recorder.test.ts
tests/main/voice/wakeWord.test.ts
tests/main/voice/controller.test.ts
tests/renderer/micDot.test.ts
```

Files to **modify**:
- `src/shared/types.ts` — add `voice:trigger` and `voice:status` IPC keys; add `STTProvider` interface; add `stt` field to `Config`
- `src/main/index.ts` — instantiate and start VoiceController; wire `voice:trigger` IPC; add tray mute toggle
- `src/renderer/main.ts` — mic dot DOM + hover logic + `voice:status` listener
- `src/renderer/index.html` — add `#mic-dot` element

---

## Task 1: STT provider types + registry

**Files:**
- Create: `src/main/stt/types.ts`
- Create: `src/main/stt/registry.ts`
- Test: `tests/main/stt/registry.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/main/stt/registry.test.ts
import { registerSTT, getActiveSTT, clearSTTRegistry } from '../../../src/main/stt/registry';
import type { STTProvider } from '../../../src/main/stt/types';
import type { Config } from '../../../src/shared/types';

const mockProvider: STTProvider = {
  name: 'mock',
  transcribe: jest.fn().mockResolvedValue('hello world'),
};

const baseConfig = {
  stt: { provider: 'mock' },
} as unknown as Config;

beforeEach(() => clearSTTRegistry());

test('registerSTT + getActiveSTT returns registered provider', () => {
  registerSTT(mockProvider);
  const result = getActiveSTT(baseConfig);
  expect(result.name).toBe('mock');
});

test('getActiveSTT throws with list of valid providers when name unknown', () => {
  registerSTT(mockProvider);
  const badConfig = { stt: { provider: 'nonexistent' } } as unknown as Config;
  expect(() => getActiveSTT(badConfig)).toThrow(
    /Unknown STT provider "nonexistent"\. Valid: mock/
  );
});

test('getActiveSTT throws when registry is empty', () => {
  expect(() => getActiveSTT(baseConfig)).toThrow(/No STT providers registered/);
});
```

- [ ] **Step 2: Run test — expect FAIL (module not found)**

```bash
npx jest tests/main/stt/registry.test.ts --no-coverage
```

Expected: `Cannot find module '../../../src/main/stt/registry'`

- [ ] **Step 3: Create `src/main/stt/types.ts`**

```typescript
// src/main/stt/types.ts

export interface STTProvider {
  /** Unique identifier used in config.stt.provider */
  readonly name: string;
  /**
   * Transcribe raw PCM/WAV audio bytes to text.
   * Implementations must clean up any temp files even on error.
   */
  transcribe(audioBuffer: Buffer): Promise<string>;
}
```

- [ ] **Step 4: Create `src/main/stt/registry.ts`**

```typescript
// src/main/stt/registry.ts
import type { STTProvider } from './types';
import type { Config } from '../../shared/types';

const registry = new Map<string, STTProvider>();

export function registerSTT(provider: STTProvider): void {
  registry.set(provider.name, provider);
}

export function getActiveSTT(config: Config): STTProvider {
  if (registry.size === 0) {
    throw new Error('No STT providers registered. Call registerSTT before getActiveSTT.');
  }
  const name = config.stt?.provider ?? 'whisperLocal';
  const provider = registry.get(name);
  if (!provider) {
    const valid = Array.from(registry.keys()).join(', ');
    throw new Error(`Unknown STT provider "${name}". Valid: ${valid}`);
  }
  return provider;
}

/** Test helper — clears registry between tests */
export function clearSTTRegistry(): void {
  registry.clear();
}
```

- [ ] **Step 5: Update `src/shared/types.ts` — add STT config field and voice IPC keys**

Add inside the `Config` interface (after `voice` field):

```typescript
  stt: {
    provider: string;   // 'whisperLocal' | 'openaiWhisper'
    modelSize?: 'tiny.en' | 'base.en' | 'small.en';  // whisperLocal only
  };
```

Add inside the `IPC` const object:

```typescript
  VOICE_TRIGGER:  'voice:trigger',   // renderer → main: user clicked mic dot
  VOICE_STATUS:   'voice:status',    // main → renderer: { active: boolean; wakeFailed: boolean }
```

- [ ] **Step 6: Run test — expect PASS**

```bash
npx jest tests/main/stt/registry.test.ts --no-coverage
```

Expected: `3 passed`

- [ ] **Step 7: Commit**

```bash
git add src/main/stt/types.ts src/main/stt/registry.ts src/shared/types.ts tests/main/stt/registry.test.ts
git commit -m "feat(stt): STT provider types, registry, and IPC voice constants"
```

---

## Task 2: whisperLocal provider

**Files:**
- Create: `src/main/stt/whisperLocal/index.ts`
- Test: `tests/main/stt/whisperLocal.test.ts`

> **Implementation note:** At implementation time, verify whether `nodejs-whisper`, `@xenova/transformers` (WASM), or a `whisper.cpp` native binding is the best-maintained option for Apple Silicon. Prefer a native binding that runs offline; fall back to `@xenova/transformers` only if no native option is viable. The interface below is identical regardless of choice.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/main/stt/whisperLocal.test.ts
import path from 'path';
import os from 'os';
import fs from 'fs';

// Mock the whisper runner before importing the module under test
const mockTranscribeFile = jest.fn().mockResolvedValue({ text: '  hello from whisper  ' });
jest.mock('nodejs-whisper', () => ({ transcribeFile: mockTranscribeFile }), { virtual: true });

import { whisperLocalProvider } from '../../../src/main/stt/whisperLocal';

beforeEach(() => jest.clearAllMocks());

test('transcribe returns trimmed text', async () => {
  const buffer = Buffer.from('fake-audio-data');
  const result = await whisperLocalProvider.transcribe(buffer);
  expect(result).toBe('hello from whisper');
});

test('transcribe calls runner with a temp .wav path', async () => {
  const buffer = Buffer.from('fake-audio-data');
  await whisperLocalProvider.transcribe(buffer);
  const [calledPath] = mockTranscribeFile.mock.calls[0];
  expect(calledPath).toMatch(/\.wav$/);
  expect(calledPath.startsWith(os.tmpdir())).toBe(true);
});

test('temp file is deleted after successful transcription', async () => {
  const spyUnlink = jest.spyOn(fs.promises, 'unlink').mockResolvedValue(undefined);
  const buffer = Buffer.from('fake-audio-data');
  await whisperLocalProvider.transcribe(buffer);
  expect(spyUnlink).toHaveBeenCalledTimes(1);
  spyUnlink.mockRestore();
});

test('temp file is deleted even when runner throws', async () => {
  mockTranscribeFile.mockRejectedValueOnce(new Error('runner crashed'));
  const spyUnlink = jest.spyOn(fs.promises, 'unlink').mockResolvedValue(undefined);
  const buffer = Buffer.from('fake-audio-data');
  await expect(whisperLocalProvider.transcribe(buffer)).rejects.toThrow('runner crashed');
  expect(spyUnlink).toHaveBeenCalledTimes(1);
  spyUnlink.mockRestore();
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx jest tests/main/stt/whisperLocal.test.ts --no-coverage
```

Expected: `Cannot find module '../../../src/main/stt/whisperLocal'`

- [ ] **Step 3: Install dependency (verify best binding first)**

```bash
# Primary choice — native binding, fast on Apple Silicon:
npm install nodejs-whisper
# If unavailable or unmaintained, fall back to:
# npm install @xenova/transformers
```

- [ ] **Step 4: Create `src/main/stt/whisperLocal/index.ts`**

```typescript
// src/main/stt/whisperLocal/index.ts
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';
import type { STTProvider } from '../types';

// Dynamic import so the binding's absence causes a clear error at transcription time,
// not at app startup — whisperLocal is optional if the user switches to openaiWhisper.
async function getRunner(): Promise<{ transcribeFile: (p: string, opts?: object) => Promise<{ text: string }> }> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('nodejs-whisper');
}

const MODEL_DIR = path.join(os.homedir(), '.pixel', 'models');
const DEFAULT_MODEL = 'base.en';

export const whisperLocalProvider: STTProvider = {
  name: 'whisperLocal',

  async transcribe(audioBuffer: Buffer): Promise<string> {
    const tmpPath = path.join(os.tmpdir(), `pixel-stt-${randomUUID()}.wav`);
    try {
      await fs.writeFile(tmpPath, audioBuffer);
      const runner = await getRunner();
      const result = await runner.transcribeFile(tmpPath, {
        modelName: DEFAULT_MODEL,
        modelDir: MODEL_DIR,
        removeWavFileAfterTranscription: false, // we clean up ourselves
        withCuda: false,
        autoDownloadModelName: DEFAULT_MODEL,
      });
      return result.text.trim();
    } finally {
      await fs.unlink(tmpPath).catch(() => {
        // best-effort: temp dir cleanup handles it eventually
      });
    }
  },
};
```

- [ ] **Step 5: Run test — expect PASS**

```bash
npx jest tests/main/stt/whisperLocal.test.ts --no-coverage
```

Expected: `4 passed`

- [ ] **Step 6: Commit**

```bash
git add src/main/stt/whisperLocal/index.ts tests/main/stt/whisperLocal.test.ts
git commit -m "feat(stt): whisperLocal provider wrapping nodejs-whisper with temp file cleanup"
```

---

## Task 3: openaiWhisper provider

**Files:**
- Create: `src/main/stt/openaiWhisper/index.ts`
- Test: `tests/main/stt/openaiWhisper.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/main/stt/openaiWhisper.test.ts
import os from 'os';
import fs from 'fs/promises';

// Must set key before module import
process.env.OPENAI_API_KEY = 'test-key-abc';

const mockFetch = jest.fn();
global.fetch = mockFetch;

import { openaiWhisperProvider, isOpenAIWhisperAvailable } from '../../../src/main/stt/openaiWhisper';

beforeEach(() => {
  jest.clearAllMocks();
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ text: 'transcribed speech' }),
  });
});

test('isOpenAIWhisperAvailable returns true when OPENAI_API_KEY is set', () => {
  expect(isOpenAIWhisperAvailable()).toBe(true);
});

test('transcribe sends correct Authorization header', async () => {
  await openaiWhisperProvider.transcribe(Buffer.from('audio'));
  const [url, init] = mockFetch.mock.calls[0];
  expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
  expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer test-key-abc');
});

test('transcribe FormData contains file and model fields', async () => {
  await openaiWhisperProvider.transcribe(Buffer.from('audio'));
  const [, init] = mockFetch.mock.calls[0];
  const body = init.body as FormData;
  expect(body.get('model')).toBe('whisper-1');
  expect(body.get('file')).toBeTruthy();
});

test('transcribe returns .text from API response', async () => {
  const result = await openaiWhisperProvider.transcribe(Buffer.from('audio'));
  expect(result).toBe('transcribed speech');
});

test('transcribe throws on non-ok response', async () => {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status: 401,
    text: async () => 'Unauthorized',
  });
  await expect(openaiWhisperProvider.transcribe(Buffer.from('audio'))).rejects.toThrow(
    /OpenAI Whisper API error 401/
  );
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx jest tests/main/stt/openaiWhisper.test.ts --no-coverage
```

Expected: `Cannot find module '../../../src/main/stt/openaiWhisper'`

- [ ] **Step 3: Create `src/main/stt/openaiWhisper/index.ts`**

```typescript
// src/main/stt/openaiWhisper/index.ts
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';
import type { STTProvider } from '../types';
import { log } from '../../core/log';

export function isOpenAIWhisperAvailable(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export const openaiWhisperProvider: STTProvider = {
  name: 'openaiWhisper',

  async transcribe(audioBuffer: Buffer): Promise<string> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not set — openaiWhisper provider cannot transcribe');
    }

    // Write buffer to a named temp file so we can attach it as a real file in FormData
    const tmpPath = path.join(os.tmpdir(), `pixel-whisper-${randomUUID()}.wav`);
    try {
      await fs.writeFile(tmpPath, audioBuffer);

      const { Blob } = await import('buffer');
      const fileBlob = new Blob([audioBuffer], { type: 'audio/wav' });

      const formData = new FormData();
      // Node's FormData.append with a Blob + filename satisfies multipart/form-data
      formData.append('file', fileBlob as globalThis.Blob, 'audio.wav');
      formData.append('model', 'whisper-1');

      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          // Do NOT set Content-Type — fetch sets it with boundary automatically for FormData
        },
        body: formData,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`OpenAI Whisper API error ${response.status}: ${body}`);
      }

      const data = (await response.json()) as { text: string };
      return data.text.trim();
    } finally {
      await fs.unlink(tmpPath).catch(() => undefined);
    }
  },
};

// Self-register check (called from main process setup)
if (!isOpenAIWhisperAvailable()) {
  log?.warn?.('OPENAI_API_KEY not set — openaiWhisper provider will not be registered');
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npx jest tests/main/stt/openaiWhisper.test.ts --no-coverage
```

Expected: `5 passed`

- [ ] **Step 5: Commit**

```bash
git add src/main/stt/openaiWhisper/index.ts tests/main/stt/openaiWhisper.test.ts
git commit -m "feat(stt): openaiWhisper provider with Authorization header and FormData upload"
```

---

## Task 4: Audio recorder

**Files:**
- Create: `src/main/voice/recorder.ts`
- Test: `tests/main/voice/recorder.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/main/voice/recorder.test.ts
import EventEmitter from 'events';
import os from 'os';
import fs from 'fs/promises';

// Mock child_process before importing recorder
const mockProcess = new EventEmitter() as NodeJS.EventEmitter & {
  kill: jest.Mock;
  stdin: null;
  stdout: EventEmitter;
  stderr: EventEmitter;
};
mockProcess.kill = jest.fn();
mockProcess.stdout = new EventEmitter();
mockProcess.stderr = new EventEmitter();

const mockExecFile = jest.fn().mockReturnValue(mockProcess);
jest.mock('child_process', () => ({ execFile: mockExecFile }));
jest.mock('fs/promises', () => ({
  readFile: jest.fn().mockResolvedValue(Buffer.from('fake-audio')),
  unlink: jest.fn().mockResolvedValue(undefined),
  mkdir: jest.fn().mockResolvedValue(undefined),
}));

import { Recorder } from '../../../src/main/voice/recorder';

beforeEach(() => jest.clearAllMocks());

test('startRecording spawns sox with correct args', () => {
  const recorder = new Recorder();
  recorder.startRecording();
  expect(mockExecFile).toHaveBeenCalledWith(
    'sox',
    expect.arrayContaining(['-t', 'wav']),
    expect.any(Object),
    expect.any(Function)
  );
});

test('stopRecording returns buffer and cleans up temp file', async () => {
  const recorder = new Recorder();
  recorder.startRecording();
  const bufferPromise = recorder.stopRecording();
  // Simulate process exit
  mockProcess.emit('close', 0);
  const buffer = await bufferPromise;
  expect(buffer).toEqual(Buffer.from('fake-audio'));
  expect((fs.unlink as jest.Mock)).toHaveBeenCalledTimes(1);
});

test('silence event fires after 1200ms of RMS below threshold', async () => {
  jest.useFakeTimers();
  const recorder = new Recorder();
  const silenceHandler = jest.fn();
  recorder.on('silence', silenceHandler);
  recorder.startRecording();

  // Feed silent samples (all zeros → RMS = 0)
  const silentFrame = Buffer.alloc(3200); // 100ms of silence at 16kHz/16bit
  for (let i = 0; i < 13; i++) {
    recorder.feedSamples(silentFrame);
    jest.advanceTimersByTime(100);
  }

  expect(silenceHandler).toHaveBeenCalledTimes(1);
  jest.useRealTimers();
});

test('silence does NOT fire when loud samples interrupt', async () => {
  jest.useFakeTimers();
  const recorder = new Recorder();
  const silenceHandler = jest.fn();
  recorder.on('silence', silenceHandler);
  recorder.startRecording();

  // 8 silent frames, then a loud frame, then 8 more silent frames (< 1200ms continuous)
  const silentFrame = Buffer.alloc(3200);
  const loudFrame = Buffer.alloc(3200);
  // Fill loudFrame with max amplitude 16-bit samples
  for (let i = 0; i < loudFrame.length; i += 2) {
    loudFrame.writeInt16LE(32767, i);
  }

  for (let i = 0; i < 8; i++) {
    recorder.feedSamples(silentFrame);
    jest.advanceTimersByTime(100);
  }
  recorder.feedSamples(loudFrame);
  jest.advanceTimersByTime(100);
  for (let i = 0; i < 8; i++) {
    recorder.feedSamples(silentFrame);
    jest.advanceTimersByTime(100);
  }

  // 800ms of continuous silence — not enough to fire (needs 1200ms)
  expect(silenceHandler).not.toHaveBeenCalled();
  jest.useRealTimers();
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx jest tests/main/voice/recorder.test.ts --no-coverage
```

Expected: `Cannot find module '../../../src/main/voice/recorder'`

- [ ] **Step 3: Create `src/main/voice/recorder.ts`**

```typescript
// src/main/voice/recorder.ts
import { execFile, ChildProcess } from 'child_process';
import EventEmitter from 'events';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';

const SILENCE_THRESHOLD_RMS = 0.01;
const SILENCE_DURATION_MS = 1200;
const SAMPLE_INTERVAL_MS = 100;

function computeRMS(buf: Buffer): number {
  if (buf.length < 2) return 0;
  let sum = 0;
  const samples = buf.length >> 1; // 16-bit samples
  for (let i = 0; i < buf.length - 1; i += 2) {
    const sample = buf.readInt16LE(i) / 32768;
    sum += sample * sample;
  }
  return Math.sqrt(sum / samples);
}

export interface RecorderEvents {
  silence: () => void;
  error: (err: Error) => void;
}

export class Recorder extends EventEmitter {
  private proc: ChildProcess | null = null;
  private tmpPath: string | null = null;
  private silentMs = 0;
  private silenceFired = false;

  startRecording(): void {
    this.silentMs = 0;
    this.silenceFired = false;
    this.tmpPath = path.join(os.tmpdir(), `pixel-rec-${randomUUID()}.wav`);

    // sox -d (default audio input) → WAV, 16kHz mono 16-bit
    this.proc = execFile(
      'sox',
      ['-d', '-t', 'wav', '-r', '16000', '-c', '1', '-b', '16', this.tmpPath!],
      { timeout: 60_000 },
      (err) => {
        if (err && (err as NodeJS.ErrnoException).killed !== true) {
          this.emit('error', err);
        }
      }
    );
  }

  /**
   * Feed raw PCM samples (16-bit LE) for silence detection.
   * Called externally by the audio pipeline or test harness.
   */
  feedSamples(chunk: Buffer): void {
    if (this.silenceFired) return;
    const rms = computeRMS(chunk);
    if (rms < SILENCE_THRESHOLD_RMS) {
      this.silentMs += SAMPLE_INTERVAL_MS;
      if (this.silentMs >= SILENCE_DURATION_MS) {
        this.silenceFired = true;
        this.emit('silence');
      }
    } else {
      this.silentMs = 0;
    }
  }

  async stopRecording(): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      if (!this.proc || !this.tmpPath) {
        reject(new Error('stopRecording called without an active recording'));
        return;
      }

      const onClose = async () => {
        const tmpPath = this.tmpPath!;
        this.proc = null;
        this.tmpPath = null;
        try {
          const buf = await fs.readFile(tmpPath);
          await fs.unlink(tmpPath);
          resolve(buf);
        } catch (err) {
          await fs.unlink(tmpPath).catch(() => undefined);
          reject(err);
        }
      };

      this.proc.once('close', onClose);
      this.proc.kill('SIGTERM');
    });
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npx jest tests/main/voice/recorder.test.ts --no-coverage
```

Expected: `4 passed`

- [ ] **Step 5: Commit**

```bash
git add src/main/voice/recorder.ts tests/main/voice/recorder.test.ts
git commit -m "feat(voice): audio recorder with sox spawn, SIGTERM stop, and RMS silence detection"
```

---

## Task 5: Porcupine wake word module

**Files:**
- Create: `src/main/voice/wakeWord.ts`
- Test: `tests/main/voice/wakeWord.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/main/voice/wakeWord.test.ts
import {
  WakeWordNotConfigured,
  MicPermissionDenied,
  WakeWordInitFailed,
} from '../../../src/main/voice/wakeWord';

// Build a controllable mock Porcupine instance
let detectedCallback: (() => void) | null = null;
const mockPorcupineInstance = {
  frameLength: 512,
  process: jest.fn().mockReturnValue(-1), // -1 = no keyword
  delete: jest.fn(),
};
const mockPorcupineCreate = jest.fn().mockImplementation((_key, _kw, cb: () => void) => {
  detectedCallback = cb;
  return mockPorcupineInstance;
});

jest.mock('@picovoice/porcupine-node', () => ({
  Porcupine: { create: mockPorcupineCreate },
  BuiltinKeyword: { COSMO: 'COSMO' },
}), { virtual: true });

import { WakeWordDetector } from '../../../src/main/voice/wakeWord';

beforeEach(() => {
  jest.clearAllMocks();
  detectedCallback = null;
});

test('throws WakeWordNotConfigured when accessKey is empty', async () => {
  const detector = new WakeWordDetector();
  await expect(detector.init('')).rejects.toThrow(WakeWordNotConfigured);
});

test('init succeeds with valid key and registers onDetected callback', async () => {
  const detector = new WakeWordDetector();
  const cb = jest.fn();
  detector.onDetected(cb);
  await detector.init('valid-key');
  // Simulate a keyword detection event
  detectedCallback!();
  expect(cb).toHaveBeenCalledTimes(1);
});

test('destroy calls porcupine.delete and clears resources', async () => {
  const detector = new WakeWordDetector();
  await detector.init('valid-key');
  detector.destroy();
  expect(mockPorcupineInstance.delete).toHaveBeenCalledTimes(1);
});

test('throws WakeWordInitFailed when Porcupine.create throws generic error', async () => {
  mockPorcupineCreate.mockImplementationOnce(() => {
    throw new Error('invalid access key');
  });
  const detector = new WakeWordDetector();
  await expect(detector.init('bad-key')).rejects.toThrow(WakeWordInitFailed);
});

test('throws MicPermissionDenied when error message contains permission', async () => {
  mockPorcupineCreate.mockImplementationOnce(() => {
    throw new Error('microphone permission denied');
  });
  const detector = new WakeWordDetector();
  await expect(detector.init('valid-key')).rejects.toThrow(MicPermissionDenied);
});

test('all 3 custom error classes extend Error', () => {
  expect(new WakeWordNotConfigured()).toBeInstanceOf(Error);
  expect(new MicPermissionDenied()).toBeInstanceOf(Error);
  expect(new WakeWordInitFailed('msg')).toBeInstanceOf(Error);
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx jest tests/main/voice/wakeWord.test.ts --no-coverage
```

Expected: `Cannot find module '../../../src/main/voice/wakeWord'`

- [ ] **Step 3: Install Porcupine**

```bash
npm install @picovoice/porcupine-node
```

- [ ] **Step 4: Create `src/main/voice/wakeWord.ts`**

```typescript
// src/main/voice/wakeWord.ts

// --- Custom error classes ---

export class WakeWordNotConfigured extends Error {
  constructor() {
    super(
      'PICOVOICE_ACCESS_KEY is not set. ' +
      'Get a free key at https://picovoice.ai and add it to your .env file.'
    );
    this.name = 'WakeWordNotConfigured';
  }
}

export class MicPermissionDenied extends Error {
  constructor() {
    super(
      'Microphone permission was denied. ' +
      'Grant microphone access to the app in System Settings → Privacy & Security → Microphone.'
    );
    this.name = 'MicPermissionDenied';
  }
}

export class WakeWordInitFailed extends Error {
  constructor(reason: string) {
    super(`Wake word engine failed to initialize: ${reason}`);
    this.name = 'WakeWordInitFailed';
  }
}

// --- Detector ---

export class WakeWordDetector {
  private porcupine: { frameLength: number; process: (frames: Int16Array) => number; delete: () => void } | null = null;
  private detectedCallbacks: Array<() => void> = [];

  onDetected(cb: () => void): void {
    this.detectedCallbacks.push(cb);
  }

  async init(accessKey: string): Promise<void> {
    if (!accessKey) {
      throw new WakeWordNotConfigured();
    }

    try {
      // Dynamic require so the binding's absence causes a clear error at init time,
      // not at app startup (allows tree-shaking in tests).
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { Porcupine, BuiltinKeyword } = require('@picovoice/porcupine-node') as {
        Porcupine: { create: (key: string, kw: unknown[], cb: () => void) => typeof this.porcupine };
        BuiltinKeyword: Record<string, unknown>;
      };

      const keyword = BuiltinKeyword['HEY_COSMO'] ?? BuiltinKeyword['COSMO'] ?? 'COSMO';

      this.porcupine = Porcupine.create(accessKey, [keyword], () => {
        this.detectedCallbacks.forEach((cb) => cb());
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
      if (message.includes('permission')) {
        throw new MicPermissionDenied();
      }
      throw new WakeWordInitFailed(err instanceof Error ? err.message : String(err));
    }
  }

  destroy(): void {
    if (this.porcupine) {
      this.porcupine.delete();
      this.porcupine = null;
    }
    this.detectedCallbacks = [];
  }
}
```

- [ ] **Step 5: Run test — expect PASS**

```bash
npx jest tests/main/voice/wakeWord.test.ts --no-coverage
```

Expected: `6 passed`

- [ ] **Step 6: Commit**

```bash
git add src/main/voice/wakeWord.ts tests/main/voice/wakeWord.test.ts
git commit -m "feat(voice): Porcupine WakeWordDetector with WakeWordNotConfigured, MicPermissionDenied, WakeWordInitFailed errors"
```

---

## Task 6: VoiceController

**Files:**
- Create: `src/main/voice/controller.ts`
- Test: `tests/main/voice/controller.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/main/voice/controller.test.ts
import { EventEmitter } from 'events';
import type { BrowserWindow } from 'electron';

// Minimal stubs
const mockWin = {
  webContents: { send: jest.fn() },
  isDestroyed: () => false,
} as unknown as BrowserWindow;

const mockStateManager = { setState: jest.fn() };

const mockBrain = { handleUserInput: jest.fn().mockResolvedValue(undefined) };

const mockSTTProvider = { name: 'mock', transcribe: jest.fn().mockResolvedValue('what time is it') };
const mockSTTRegistry = { getActiveSTT: jest.fn().mockReturnValue(mockSTTProvider) };

const mockRecorder = new EventEmitter() as EventEmitter & {
  startRecording: jest.Mock;
  stopRecording: jest.Mock;
};
mockRecorder.startRecording = jest.fn();
mockRecorder.stopRecording = jest.fn().mockResolvedValue(Buffer.from('audio'));

const mockWakeDetector = {
  init: jest.fn().mockResolvedValue(undefined),
  onDetected: jest.fn(),
  destroy: jest.fn(),
};

const mockCalloutManager = { isMeetingQuiet: jest.fn().mockReturnValue(false) };

const mockSpeechQueue = { setEnabled: jest.fn() };

jest.mock('../../../src/main/voice/wakeWord', () => ({
  WakeWordDetector: jest.fn().mockImplementation(() => mockWakeDetector),
  WakeWordInitFailed: class WakeWordInitFailed extends Error {},
  WakeWordNotConfigured: class WakeWordNotConfigured extends Error {},
  MicPermissionDenied: class MicPermissionDenied extends Error {},
}));

jest.mock('../../../src/main/voice/recorder', () => ({
  Recorder: jest.fn().mockImplementation(() => mockRecorder),
}));

import { VoiceController } from '../../../src/main/voice/controller';
import { IPC } from '../../../src/shared/types';

const baseConfig = {
  stt: { provider: 'mock' },
} as any;

beforeEach(() => jest.clearAllMocks());

test('start() attempts wake word init and broadcasts status on success', async () => {
  process.env.PICOVOICE_ACCESS_KEY = 'valid-key';
  const vc = new VoiceController(
    mockWin, mockStateManager as any, mockBrain as any,
    mockSTTRegistry as any, mockSpeechQueue as any,
    mockCalloutManager as any, baseConfig
  );
  await vc.start();
  expect(mockWakeDetector.init).toHaveBeenCalledWith('valid-key');
  expect(mockWin.webContents.send).toHaveBeenCalledWith(
    IPC.VOICE_STATUS, expect.objectContaining({ wakeFailed: false })
  );
});

test('start() sets wakeFailed=true and sends chat message when init throws', async () => {
  process.env.PICOVOICE_ACCESS_KEY = 'bad-key';
  mockWakeDetector.init.mockRejectedValueOnce(new Error('invalid access key'));
  const vc = new VoiceController(
    mockWin, mockStateManager as any, mockBrain as any,
    mockSTTRegistry as any, mockSpeechQueue as any,
    mockCalloutManager as any, baseConfig
  );
  await vc.start();
  expect(vc.getWakeFailed()).toBe(true);
  expect(mockWin.webContents.send).toHaveBeenCalledWith(
    IPC.CHAT_MESSAGE, expect.objectContaining({ text: expect.stringContaining('Wake word unavailable') })
  );
  expect(mockWin.webContents.send).toHaveBeenCalledWith(
    IPC.VOICE_STATUS, expect.objectContaining({ wakeFailed: true })
  );
});

test('triggerListening follows full state sequence: listening → thinking → brain', async () => {
  const vc = new VoiceController(
    mockWin, mockStateManager as any, mockBrain as any,
    mockSTTRegistry as any, mockSpeechQueue as any,
    mockCalloutManager as any, baseConfig
  );
  await vc.start();
  await vc.triggerListening();
  expect(mockStateManager.setState).toHaveBeenCalledWith('listening', mockWin);
  expect(mockRecorder.startRecording).toHaveBeenCalled();
  expect(mockRecorder.stopRecording).toHaveBeenCalled();
  expect(mockStateManager.setState).toHaveBeenCalledWith('thinking', mockWin);
  expect(mockSTTProvider.transcribe).toHaveBeenCalledWith(expect.any(Buffer));
  expect(mockBrain.handleUserInput).toHaveBeenCalledWith('what time is it', mockWin, baseConfig);
});

test('triggerListening returns early when muted', async () => {
  const vc = new VoiceController(
    mockWin, mockStateManager as any, mockBrain as any,
    mockSTTRegistry as any, mockSpeechQueue as any,
    mockCalloutManager as any, baseConfig
  );
  await vc.start();
  vc.setMuted(true);
  await vc.triggerListening();
  expect(mockRecorder.startRecording).not.toHaveBeenCalled();
});

test('triggerListening returns early in meeting quiet mode', async () => {
  mockCalloutManager.isMeetingQuiet.mockReturnValueOnce(true);
  const vc = new VoiceController(
    mockWin, mockStateManager as any, mockBrain as any,
    mockSTTRegistry as any, mockSpeechQueue as any,
    mockCalloutManager as any, baseConfig
  );
  await vc.start();
  await vc.triggerListening();
  expect(mockRecorder.startRecording).not.toHaveBeenCalled();
});

test('triggerListening still works when wakeFailed=true (dot path)', async () => {
  mockWakeDetector.init.mockRejectedValueOnce(new Error('bad key'));
  const vc = new VoiceController(
    mockWin, mockStateManager as any, mockBrain as any,
    mockSTTRegistry as any, mockSpeechQueue as any,
    mockCalloutManager as any, baseConfig
  );
  await vc.start();
  expect(vc.getWakeFailed()).toBe(true);
  // Dot click should still work
  await vc.triggerListening();
  expect(mockRecorder.startRecording).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx jest tests/main/voice/controller.test.ts --no-coverage
```

Expected: `Cannot find module '../../../src/main/voice/controller'`

- [ ] **Step 3: Create `src/main/voice/controller.ts`**

```typescript
// src/main/voice/controller.ts
import type { BrowserWindow } from 'electron';
import { WakeWordDetector } from './wakeWord';
import { Recorder } from './recorder';
import type { Config } from '../../shared/types';
import { IPC } from '../../shared/types';
import { log } from '../core/log';

interface StateManager {
  setState(state: string, win: BrowserWindow): void;
}

interface Brain {
  handleUserInput(text: string, win: BrowserWindow, config: Config): Promise<void>;
}

interface STTRegistry {
  getActiveSTT(config: Config): { transcribe(buf: Buffer): Promise<string> };
}

interface SpeechQueue {
  setEnabled(enabled: boolean): void;
}

interface CalloutManager {
  isMeetingQuiet(): boolean;
}

export class VoiceController {
  private wakeDetector = new WakeWordDetector();
  private recorder = new Recorder();
  private muted = false;
  private wakeFailed = false;
  private active = false;

  constructor(
    private readonly win: BrowserWindow,
    private readonly stateManager: StateManager,
    private readonly brain: Brain,
    private readonly sttRegistry: STTRegistry,
    private readonly speechQueue: SpeechQueue,
    private readonly calloutManager: CalloutManager,
    private readonly config: Config
  ) {}

  async start(): Promise<void> {
    const accessKey = process.env.PICOVOICE_ACCESS_KEY ?? '';
    try {
      await this.wakeDetector.init(accessKey);
      this.wakeDetector.onDetected(() => {
        this.triggerListening().catch((err) => {
          log.error('triggerListening from wake word failed:', err);
        });
      });
      this.active = true;
      this.broadcastStatus();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn('Wake word unavailable:', message);
      this.wakeFailed = true;
      // Notify renderer: show persistent dot + fallback chat message
      this.win.webContents.send(IPC.VOICE_STATUS, { active: false, wakeFailed: true });
      this.win.webContents.send(IPC.CHAT_MESSAGE, {
        text: 'Wake word unavailable — tap the dot to talk',
        type: 'bot',
      });
    }
  }

  /**
   * SINGLE entry point for both the wake word path and the mic dot path.
   * The dot path calls this directly; wake word's onDetected callback calls this.
   */
  async triggerListening(): Promise<void> {
    if (this.muted) return;
    if (this.calloutManager.isMeetingQuiet()) return;

    this.stateManager.setState('listening', this.win);
    this.recorder.startRecording();

    // Wait for silence auto-stop or manual stopRecording
    const buffer = await this.recorder.stopRecording();

    this.stateManager.setState('thinking', this.win);

    const stt = this.sttRegistry.getActiveSTT(this.config);
    const text = await stt.transcribe(buffer);

    if (text.trim()) {
      await this.brain.handleUserInput(text, this.win, this.config);
    } else {
      // Empty transcription — return to idle silently
      this.stateManager.setState('idle', this.win);
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.speechQueue.setEnabled(!muted);
    this.broadcastStatus();
  }

  getWakeFailed(): boolean {
    return this.wakeFailed;
  }

  destroy(): void {
    this.wakeDetector.destroy();
  }

  private broadcastStatus(): void {
    this.win.webContents.send(IPC.VOICE_STATUS, {
      active: this.active && !this.muted,
      wakeFailed: this.wakeFailed,
    });
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npx jest tests/main/voice/controller.test.ts --no-coverage
```

Expected: `6 passed`

- [ ] **Step 5: Commit**

```bash
git add src/main/voice/controller.ts tests/main/voice/controller.test.ts
git commit -m "feat(voice): VoiceController orchestrates wake word → recorder → STT → brain with mute and meeting quiet guards"
```

---

## Task 7: Hover mic dot in renderer

**Files:**
- Modify: `src/renderer/index.html` — add `#mic-dot` element
- Modify: `src/renderer/main.ts` — hover logic + `voice:status` listener
- Test: `tests/renderer/micDot.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/renderer/micDot.test.ts
/**
 * @jest-environment jsdom
 */
import { setupMicDot } from '../../src/renderer/micDot';
import { IPC } from '../../src/shared/types';

// Minimal electron IPC mock
const mockSend = jest.fn();
const mockOn = jest.fn();
(global as any).window = {
  cosmo: { send: mockSend, on: mockOn },
};

function buildDOM() {
  document.body.innerHTML = `
    <div id="eyes-container"></div>
    <div id="mic-dot" style="opacity: 0; transition: opacity 0.2s ease; pointer-events: none;"></div>
  `;
}

beforeEach(() => {
  buildDOM();
  jest.clearAllMocks();
});

test('mic-dot opacity becomes 1 on mouseenter', () => {
  setupMicDot();
  document.body.dispatchEvent(new MouseEvent('mouseenter'));
  const dot = document.getElementById('mic-dot')!;
  expect(dot.style.opacity).toBe('1');
  expect(dot.style.pointerEvents).toBe('auto');
});

test('mic-dot opacity returns to 0 on mouseleave when not always-visible', () => {
  setupMicDot();
  document.body.dispatchEvent(new MouseEvent('mouseenter'));
  document.body.dispatchEvent(new MouseEvent('mouseleave'));
  const dot = document.getElementById('mic-dot')!;
  expect(dot.style.opacity).toBe('0');
  expect(dot.style.pointerEvents).toBe('none');
});

test('mic-dot click sends voice:trigger IPC', () => {
  setupMicDot();
  const dot = document.getElementById('mic-dot')!;
  dot.dispatchEvent(new MouseEvent('click'));
  expect(mockSend).toHaveBeenCalledWith(IPC.VOICE_TRIGGER);
});

test('wakeFailed status adds always-visible class and dot stays visible on mouseleave', () => {
  const { handleVoiceStatus } = setupMicDot();
  handleVoiceStatus({ active: false, wakeFailed: true });
  const dot = document.getElementById('mic-dot')!;
  expect(dot.classList.contains('dot-always-visible')).toBe(true);
  // Mouseleave should not hide the dot
  document.body.dispatchEvent(new MouseEvent('mouseleave'));
  expect(dot.style.opacity).toBe('1');
});

test('non-failed status does NOT add always-visible class', () => {
  const { handleVoiceStatus } = setupMicDot();
  handleVoiceStatus({ active: true, wakeFailed: false });
  const dot = document.getElementById('mic-dot')!;
  expect(dot.classList.contains('dot-always-visible')).toBe(false);
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx jest tests/renderer/micDot.test.ts --no-coverage
```

Expected: `Cannot find module '../../src/renderer/micDot'`

- [ ] **Step 3: Add `#mic-dot` to `src/renderer/index.html`**

Inside the `<body>`, immediately after the eyes container:

```html
<!-- Hover-revealed voice trigger dot — hidden by default, always-visible when wake fails -->
<div id="mic-dot" aria-label="Click to talk" title="Click to talk"></div>
```

Add to the `<style>` block:

```css
#mic-dot {
  position: absolute;
  bottom: 18px;
  left: 50%;
  transform: translateX(-50%);
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.85);
  box-shadow: 0 0 0 2px rgba(255,255,255,0.3);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease;
  cursor: pointer;
  z-index: 10;
}

#mic-dot.dot-always-visible {
  opacity: 1 !important;
  pointer-events: auto !important;
}

/* Pulse animation while listening */
#mic-dot.listening {
  animation: mic-pulse 1s ease-in-out infinite;
}

@keyframes mic-pulse {
  0%, 100% { box-shadow: 0 0 0 2px rgba(255,100,100,0.5); }
  50%       { box-shadow: 0 0 0 8px rgba(255,100,100,0.0); }
}
```

- [ ] **Step 4: Create `src/renderer/micDot.ts`**

```typescript
// src/renderer/micDot.ts
import { IPC } from '../shared/types';

interface VoiceStatus {
  active: boolean;
  wakeFailed: boolean;
}

interface MicDotHandle {
  handleVoiceStatus(status: VoiceStatus): void;
}

export function setupMicDot(): MicDotHandle {
  const dot = document.getElementById('mic-dot');
  if (!dot) throw new Error('#mic-dot element not found in DOM');

  let alwaysVisible = false;

  // Hover show/hide
  document.body.addEventListener('mouseenter', () => {
    dot.style.opacity = '1';
    dot.style.pointerEvents = 'auto';
  });

  document.body.addEventListener('mouseleave', () => {
    if (!alwaysVisible) {
      dot.style.opacity = '0';
      dot.style.pointerEvents = 'none';
    }
  });

  // Click → send IPC to main
  dot.addEventListener('click', () => {
    (window as any).cosmo.send(IPC.VOICE_TRIGGER);
  });

  function handleVoiceStatus(status: VoiceStatus): void {
    if (status.wakeFailed) {
      alwaysVisible = true;
      dot.classList.add('dot-always-visible');
      dot.style.opacity = '1';
      dot.style.pointerEvents = 'auto';
    } else {
      alwaysVisible = false;
      dot.classList.remove('dot-always-visible');
    }
  }

  // Listen for main process voice:status broadcasts
  (window as any).cosmo.on(IPC.VOICE_STATUS, (_event: unknown, status: VoiceStatus) => {
    handleVoiceStatus(status);
  });

  return { handleVoiceStatus };
}
```

- [ ] **Step 5: Wire `setupMicDot()` into `src/renderer/main.ts`**

```typescript
// Add near top of DOMContentLoaded handler in src/renderer/main.ts
import { setupMicDot } from './micDot';

// Inside the DOMContentLoaded listener, after existing setup:
setupMicDot();
```

- [ ] **Step 6: Run test — expect PASS**

```bash
npx jest tests/renderer/micDot.test.ts --no-coverage
```

Expected: `5 passed`

- [ ] **Step 7: Commit**

```bash
git add src/renderer/index.html src/renderer/micDot.ts src/renderer/main.ts tests/renderer/micDot.test.ts
git commit -m "feat(renderer): hover mic dot with always-visible fallback on wake word failure"
```

---

## Task 8: Wake init failure path (integration)

**Files:**
- `src/main/voice/controller.ts` (already handles this — verified in Task 6 tests)
- Test: `tests/main/voice/wakeFailure.integration.test.ts`

- [ ] **Step 1: Write the integration test**

```typescript
// tests/main/voice/wakeFailure.integration.test.ts
/**
 * Validates the full wake failure flow:
 *   Porcupine throws → wakeFailed=true → chat message sent → voice:status broadcast
 *   → app startup continues → dot path (triggerListening) still works
 */
import { EventEmitter } from 'events';
import type { BrowserWindow } from 'electron';

const mockWin = {
  webContents: { send: jest.fn() },
  isDestroyed: () => false,
} as unknown as BrowserWindow;

const mockStateManager = { setState: jest.fn() };
const mockBrain = { handleUserInput: jest.fn().mockResolvedValue(undefined) };
const mockSTTProvider = { name: 'mock', transcribe: jest.fn().mockResolvedValue('test') };
const mockSTTRegistry = { getActiveSTT: jest.fn().mockReturnValue(mockSTTProvider) };
const mockRecorder = new EventEmitter() as EventEmitter & {
  startRecording: jest.Mock; stopRecording: jest.Mock;
};
mockRecorder.startRecording = jest.fn();
mockRecorder.stopRecording = jest.fn().mockResolvedValue(Buffer.from('audio'));
const mockSpeechQueue = { setEnabled: jest.fn() };
const mockCalloutManager = { isMeetingQuiet: jest.fn().mockReturnValue(false) };

jest.mock('../../../src/main/voice/wakeWord', () => ({
  WakeWordDetector: jest.fn().mockImplementation(() => ({
    init: jest.fn().mockRejectedValue(new Error('invalid access key — init failed')),
    onDetected: jest.fn(),
    destroy: jest.fn(),
  })),
  WakeWordInitFailed: class extends Error {},
  WakeWordNotConfigured: class extends Error {},
  MicPermissionDenied: class extends Error {},
}));

jest.mock('../../../src/main/voice/recorder', () => ({
  Recorder: jest.fn().mockImplementation(() => mockRecorder),
}));

import { VoiceController } from '../../../src/main/voice/controller';
import { IPC } from '../../../src/shared/types';

beforeEach(() => jest.clearAllMocks());

test('app startup completes even when Porcupine throws', async () => {
  const vc = new VoiceController(
    mockWin, mockStateManager as any, mockBrain as any,
    mockSTTRegistry as any, mockSpeechQueue as any,
    mockCalloutManager as any, {} as any
  );
  // start() must resolve (not reject) regardless of wake word failure
  await expect(vc.start()).resolves.toBeUndefined();
});

test('chat fallback message is sent on failure', async () => {
  const vc = new VoiceController(
    mockWin, mockStateManager as any, mockBrain as any,
    mockSTTRegistry as any, mockSpeechQueue as any,
    mockCalloutManager as any, {} as any
  );
  await vc.start();
  expect(mockWin.webContents.send).toHaveBeenCalledWith(
    IPC.CHAT_MESSAGE,
    expect.objectContaining({ text: expect.stringContaining('Wake word unavailable') })
  );
});

test('voice:status broadcast has wakeFailed=true on failure', async () => {
  const vc = new VoiceController(
    mockWin, mockStateManager as any, mockBrain as any,
    mockSTTRegistry as any, mockSpeechQueue as any,
    mockCalloutManager as any, {} as any
  );
  await vc.start();
  expect(mockWin.webContents.send).toHaveBeenCalledWith(
    IPC.VOICE_STATUS, expect.objectContaining({ wakeFailed: true })
  );
});

test('triggerListening (dot path) still works after wake failure', async () => {
  const vc = new VoiceController(
    mockWin, mockStateManager as any, mockBrain as any,
    mockSTTRegistry as any, mockSpeechQueue as any,
    mockCalloutManager as any, {} as any
  );
  await vc.start();
  await vc.triggerListening();
  expect(mockStateManager.setState).toHaveBeenCalledWith('listening', mockWin);
  expect(mockBrain.handleUserInput).toHaveBeenCalledWith('test', mockWin, expect.anything());
});
```

- [ ] **Step 2: Run test — expect PASS** (controller already handles this)

```bash
npx jest tests/main/voice/wakeFailure.integration.test.ts --no-coverage
```

Expected: `4 passed`

- [ ] **Step 3: Commit**

```bash
git add tests/main/voice/wakeFailure.integration.test.ts
git commit -m "test(voice): integration test for wake init failure path — startup and dot fallback"
```

---

## Task 9: Mute toggle and meeting quiet integration

**Files:**
- Modify: `src/main/index.ts` — tray mute toggle
- `src/main/voice/controller.ts` — already handles mute (Task 6); verify tray wiring

- [ ] **Step 1: Write the test for mute toggle IPC**

```typescript
// tests/main/voice/muteToggle.test.ts
import { EventEmitter } from 'events';
import type { BrowserWindow } from 'electron';

const mockWin = {
  webContents: { send: jest.fn() },
  isDestroyed: () => false,
} as unknown as BrowserWindow;

const mockStateManager = { setState: jest.fn() };
const mockBrain = { handleUserInput: jest.fn().mockResolvedValue(undefined) };
const mockSTTProvider = { name: 'mock', transcribe: jest.fn().mockResolvedValue('hi') };
const mockSTTRegistry = { getActiveSTT: jest.fn().mockReturnValue(mockSTTProvider) };
const mockRecorder = new EventEmitter() as EventEmitter & {
  startRecording: jest.Mock; stopRecording: jest.Mock;
};
mockRecorder.startRecording = jest.fn();
mockRecorder.stopRecording = jest.fn().mockResolvedValue(Buffer.from('audio'));
const mockSpeechQueue = { setEnabled: jest.fn() };
const mockCalloutManager = { isMeetingQuiet: jest.fn().mockReturnValue(false) };

jest.mock('../../../src/main/voice/wakeWord', () => ({
  WakeWordDetector: jest.fn().mockImplementation(() => ({
    init: jest.fn().mockResolvedValue(undefined),
    onDetected: jest.fn(),
    destroy: jest.fn(),
  })),
  WakeWordInitFailed: class extends Error {},
  WakeWordNotConfigured: class extends Error {},
  MicPermissionDenied: class extends Error {},
}));
jest.mock('../../../src/main/voice/recorder', () => ({
  Recorder: jest.fn().mockImplementation(() => mockRecorder),
}));

import { VoiceController } from '../../../src/main/voice/controller';
import { IPC } from '../../../src/shared/types';

beforeEach(() => jest.clearAllMocks());

test('setMuted(true) disables speechQueue and broadcasts voice:status active=false', async () => {
  const vc = new VoiceController(
    mockWin, mockStateManager as any, mockBrain as any,
    mockSTTRegistry as any, mockSpeechQueue as any,
    mockCalloutManager as any, {} as any
  );
  await vc.start();
  jest.clearAllMocks();
  vc.setMuted(true);
  expect(mockSpeechQueue.setEnabled).toHaveBeenCalledWith(false);
  expect(mockWin.webContents.send).toHaveBeenCalledWith(
    IPC.VOICE_STATUS, expect.objectContaining({ active: false })
  );
});

test('setMuted(false) re-enables speechQueue', async () => {
  const vc = new VoiceController(
    mockWin, mockStateManager as any, mockBrain as any,
    mockSTTRegistry as any, mockSpeechQueue as any,
    mockCalloutManager as any, {} as any
  );
  await vc.start();
  vc.setMuted(true);
  jest.clearAllMocks();
  vc.setMuted(false);
  expect(mockSpeechQueue.setEnabled).toHaveBeenCalledWith(true);
});

test('meeting quiet mode blocks triggerListening', async () => {
  mockCalloutManager.isMeetingQuiet.mockReturnValue(true);
  const vc = new VoiceController(
    mockWin, mockStateManager as any, mockBrain as any,
    mockSTTRegistry as any, mockSpeechQueue as any,
    mockCalloutManager as any, {} as any
  );
  await vc.start();
  await vc.triggerListening();
  expect(mockRecorder.startRecording).not.toHaveBeenCalled();
  expect(mockStateManager.setState).not.toHaveBeenCalledWith('listening', mockWin);
});
```

- [ ] **Step 2: Run test — expect PASS**

```bash
npx jest tests/main/voice/muteToggle.test.ts --no-coverage
```

Expected: `3 passed`

- [ ] **Step 3: Wire tray mute toggle and `voice:trigger` IPC in `src/main/index.ts`**

Add to the existing tray menu builder (in the section that creates `contextMenu`):

```typescript
// In src/main/index.ts — inside createTray() or buildTrayMenu()

import { VoiceController } from './voice/controller';

// After voiceController.start() is awaited:
let voiceMuted = false;

function buildTrayMenu(): Electron.MenuItemConstructorOptions[] {
  return [
    {
      label: voiceMuted ? 'Unmute voice' : 'Mute voice',
      click: () => {
        voiceMuted = !voiceMuted;
        voiceController.setMuted(voiceMuted);
        tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenu()));
      },
    },
    // ... existing menu items
  ];
}

// Register IPC handler for mic dot click
ipcMain.on(IPC.VOICE_TRIGGER, () => {
  voiceController.triggerListening().catch((err) => {
    log.error('triggerListening from dot failed:', err);
  });
});
```

- [ ] **Step 4: Register STT providers at startup in `src/main/index.ts`**

```typescript
// In src/main/index.ts — in app.whenReady() after providers/tools are set up:

import { registerSTT } from './stt/registry';
import { whisperLocalProvider } from './stt/whisperLocal';
import { openaiWhisperProvider, isOpenAIWhisperAvailable } from './stt/openaiWhisper';

// Register STT providers
registerSTT(whisperLocalProvider);
if (isOpenAIWhisperAvailable()) {
  registerSTT(openaiWhisperProvider);
  log.info('openaiWhisper STT registered');
} else {
  log.info('OPENAI_API_KEY not set — openaiWhisper STT not registered');
}

// Start voice controller after window is created
const voiceController = new VoiceController(
  mainWindow,
  stateManager,
  brain,
  { getActiveSTT: (cfg) => getActiveSTT(cfg) },
  speechQueue,
  calloutManager,
  config
);
await voiceController.start();
```

- [ ] **Step 5: Run mute toggle test — expect PASS**

```bash
npx jest tests/main/voice/muteToggle.test.ts --no-coverage
```

Expected: `3 passed`

- [ ] **Step 6: Commit**

```bash
git add tests/main/voice/muteToggle.test.ts src/main/index.ts
git commit -m "feat(voice): tray mute toggle, voice:trigger IPC handler, STT provider registration at startup"
```

---

## Task 10: Acceptance test checklist

- [ ] **Step 1: Run the full voice test suite**

```bash
npx jest tests/main/stt/ tests/main/voice/ tests/renderer/micDot.test.ts --no-coverage --verbose
```

Expected output:
```
  tests/main/stt/registry.test.ts         — 3 passed
  tests/main/stt/whisperLocal.test.ts     — 4 passed
  tests/main/stt/openaiWhisper.test.ts    — 5 passed
  tests/main/voice/recorder.test.ts       — 4 passed
  tests/main/voice/wakeWord.test.ts       — 6 passed
  tests/main/voice/controller.test.ts     — 6 passed
  tests/main/voice/wakeFailure.integration.test.ts — 4 passed
  tests/main/voice/muteToggle.test.ts     — 3 passed
  tests/renderer/micDot.test.ts           — 5 passed
  Total: 40 passed
```

- [ ] **Step 2: Manual acceptance — happy path**

```
1. Set PICOVOICE_ACCESS_KEY=<real key> in .env
2. npm run dev
3. Say "Hey Cosmo" → observe window transitions to 'listening' state (eyes widen)
4. Speak a question → observe 'thinking' (eyes narrow, look up)
5. Hear and read the spoken answer → observe 'idle' return
6. PASS ✓
```

- [ ] **Step 3: Manual acceptance — wake failure / dot path**

```
1. Set PICOVOICE_ACCESS_KEY=deliberately-bad-key in .env
2. npm run dev
3. Observe chat area shows: "Wake word unavailable — tap the dot to talk"
4. Move cursor off window → no dot visible
5. Move cursor over window → dot is ALWAYS visible (not just on hover)
6. Click the dot → app enters 'listening', voice loop completes normally
7. PASS ✓
```

- [ ] **Step 4: Manual acceptance — offline mode**

```
1. Disable WiFi
2. In config.json set llm.provider = "ollama", stt.provider = "whisperLocal"
3. Ensure Ollama is running locally: ollama serve
4. Say "Hey Cosmo, what is 2 plus 2"
5. Observe full voice loop completes with no network
6. PASS ✓
```

- [ ] **Step 5: Manual acceptance — meeting quiet**

```
1. Open Zoom (or add zoom.us to distractionList to test easily)
2. Make Zoom the frontmost app
3. Say "Hey Cosmo" → wake word should NOT trigger (calloutManager.isMeetingQuiet returns true)
4. Click mic dot → also blocked silently
5. Switch away from Zoom → both paths work again
6. PASS ✓
```

- [ ] **Step 6: Final commit — mark M4 complete**

```bash
# Update progress checklist in CLAUDE.md
git add CLAUDE.md
git commit -m "chore: mark M4 Voice complete in progress checklist"
```

---

## Dependency summary

```
npm install @picovoice/porcupine-node nodejs-whisper
```

> **At implementation time:** Verify `nodejs-whisper` is still the best-maintained Apple-Silicon binding for whisper.cpp. Alternatives in order of preference: `nodejs-whisper` (native), `whisper-node`, `@xenova/transformers` (WASM, slower but pure JS). The `whisperLocalProvider` interface is identical regardless of choice — only the `getRunner()` internals change.

## Architecture diagram

```
[Porcupine wake word]  ──────────────────────────────────────────┐
                                                                  ↓
[Mic dot click] ──────────────────────────── VoiceController.triggerListening()
                                                    │
                                      ┌─────────────┼────────────────┐
                                      │             │                │
                              Muted?  │      MeetingQuiet?    wakeFailed?
                              return  │         return         (allowed)
                                      │
                                      ↓
                             stateManager → 'listening'
                                      │
                              recorder.startRecording()
                                      │
                              recorder.stopRecording()  ← silence auto-stops
                                      │
                             stateManager → 'thinking'
                                      │
                              sttRegistry.getActiveSTT(config)
                                      │
                              provider.transcribe(buffer)
                                      │
                              brain.handleUserInput(text)
                                      │
                               (tools, LLM, TTS) ...
```

## Key invariants

1. `start()` NEVER rejects — all Porcupine errors are caught, logged, and surfaced as a chat message.
2. `triggerListening()` is the **single** entry point for both the wake word and the mic dot. No second path exists.
3. When `wakeFailed=true`, the mic dot is **persistently visible** (not hidden on `mouseleave`) and remains fully functional.
4. STT providers are registered at app startup and selected by `config.stt.provider`. Unknown name = clear startup error (not crash).
5. No frame data, no audio data, no transcription text leaves the machine except as user-initiated input to the configured LLM.
6. Voice init failure must complete in < 500ms (Porcupine error path). The happy path (Porcupine loads successfully) must complete before the window is shown.
