export type MoodState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'happy'
  | 'bored'
  | 'annoyed'
  | 'sleeping';

export type ActivityState =
  | { type: 'music'; nowPlaying: { track: string; artist: string } }
  | { type: 'searching' }
  | { type: 'timer'; remainingSec: number; label: string };

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
  focusScore: number;
  event?: 'distraction' | 'away' | 'returned' | 'deepWork' | 'deepWorkEnd';
}

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
  /** Selected character id from the chibi roster (e.g. 'cosmo', 'bulma', 'luffy'). */
  character: string;
  personality: 'coach' | 'drill-sergeant' | 'therapist' | 'silent';
  llm: { provider: string; model: string; fallback?: string[] };
  /** Sealed (OS-keychain-encrypted) API keys keyed by provider id, set via the
   *  setup screen. Never plaintext on disk — see core/secrets.ts. */
  secrets?: Record<string, string>;
  /** True once the user has completed the first-run setup screen. */
  onboarded?: boolean;
  // provider: 'whisperLocal' (on-device) or a cloud vendor id (groq, deepgram,
  // openai, elevenlabs, sarvam). `model` is that provider's model id; `dtype`
  // only applies to the local engine.
  stt: { provider: string; model?: string; dtype?: string };
  tts: { provider: string; voice?: string };
  voice: {
    enabled: boolean;
    rate: number;
    /** Listen continuously for a wake word ("Cosmo") instead of requiring a mic
     *  click. Off by default — Cosmo only listens when you tap the mic (push-to-talk);
     *  flip this on in setup → Ears to keep the mic open for the wake word. */
    alwaysListen: boolean;
    /** Allow Cosmo to SPEAK on its own (idle/work/eye-strain/battery nudges).
     *  Off by default: he shows those feelings through expression only and never
     *  talks unless the user spoke first. Tool results the user explicitly asked
     *  for (timers, reminders, pomodoro, speech.say) still speak. */
    proactiveSpeech: boolean;
    /** Phrases that wake Cosmo (normalized, lowercased). Includes common mishears. */
    wakeWords: string[];
    /** Seconds after a bare wake word during which the next utterance is the command. */
    activeWindowSec: number;
    /** Semantic end-of-turn detection (Smart Turn v3). */
    turnDetection: { enabled: boolean; threshold: number; maxTurnSec: number };
  };
  sounds: { enabled: boolean };
  camera: { enabled: boolean };
  /** Background activity tracking + the insights "buddy". */
  activity: {
    /** Record app-usage samples at all (stored locally only). */
    track: boolean;
    /** Classify the focused app with your CONFIGURED LLM. Sends the app name +
     *  window title to that model (cached, so it runs rarely). Opt-in: default off
     *  keeps everything local and nothing implicit reaches the LLM. */
    smartFocus: boolean;
    /** Proactive usage recaps. Still gated by voice.proactiveSpeech for spoken delivery. */
    recap: 'off' | 'daily' | 'weekly' | 'both';
  };
  workApps: string[];
  workDomains: string[];
  distractionDomains: string[];
  quickCaptureShortcut?: string;
  location?: { lat: number; lng: number; city: string };
  // Obsidian vault mirror: notes, tasks and reminders are also written here as
  // plain markdown so they show up in Obsidian. `path` defaults to
  // ~/Documents/Cosmo Vault when unset.
  vault?: { enabled?: boolean; path?: string };
  integrations: {
    google?: { clientId?: string; clientSecret?: string; refreshToken?: string; accessToken?: string; expiresAt?: number; email?: string };
    github?: { token?: string };
    trello?: { key?: string; token?: string };
    homekit?: { webhookUrl?: string; moodMap?: Partial<Record<MoodState, string>> };
    webhook?: { enabled: boolean; port: number; bearerToken: string };
    googleChat?: { enabled: boolean };
    emailWatcher?: { enabled: boolean };
    githubWatcher?: { enabled: boolean };
  };
}

export const CONFIG_DEFAULTS: Config = {
  botName: 'Cosmo',
  workHours: { start: '10:00', end: '19:00', days: [1, 2, 3, 4, 5] },
  idleSoftMin: 10,
  idleHardMin: 25,
  distractionMin: 15,
  distractionCapMin: 60,
  calloutCooldownMin: 20,
  awayMin: 10,
  expressionPack: 'classic',
  character: 'cosmo',
  personality: 'coach',
  llm: { provider: 'groq', model: 'llama-3.3-70b-versatile' },
  // Local ASR via transformers.js. Moonshine scales compute with clip length
  // (no Whisper 30s mel padding) → ~5-10x faster on short wake words/commands.
  // Switch model to 'Xenova/whisper-small.en' to fall back to Whisper.
  stt: { provider: 'whisperLocal', model: 'onnx-community/moonshine-base-ONNX', dtype: 'q8' },
  tts: { provider: 'kokoro', voice: 'af_heart' },
  voice: {
    enabled: true,
    rate: 180,
    // Push-to-talk by default: the mic stays closed until you tap the mic dot.
    // Turn this on in setup → Ears for hands-free wake-word ("Cosmo") listening.
    alwaysListen: false,
    proactiveSpeech: false,
    wakeWords: [
      // Wake word is "Cosmo". Bare "cosmo" + two-word phrases only. We deliberately
      // dropped loose variants ("cosmos", "kosmo", "cosimo", "cosmoe") — "cosmos" is
      // a real word that background TV/speech says constantly, and the others widened
      // fuzzy matching enough to false-wake on room noise. The two-word phrases are
      // the robust path (TV rarely says "hey cosmo"); bare "cosmo" wakes when clearly
      // spoken, and the mic button is always there as the reliable push-to-talk.
      'cosmo',
      'hey cosmo', 'hi cosmo', 'ok cosmo', 'okay cosmo', 'yo cosmo', 'hello cosmo',
    ],
    activeWindowSec: 9,
    turnDetection: { enabled: true, threshold: 0.5, maxTurnSec: 8 },
  },
  sounds: { enabled: true },
  camera: { enabled: false },
  activity: { track: true, smartFocus: false, recap: 'both' },
  workApps: ['Code', 'Cursor', 'iTerm2', 'Terminal', 'Figma', 'Xcode', 'Sublime Text', 'WebStorm', 'IntelliJ IDEA'],
  workDomains: ['github.com', 'localhost', 'stackoverflow.com', 'docs.', 'developer.'],
  distractionDomains: ['youtube.com', 'x.com', 'twitter.com', 'instagram.com', 'reddit.com', 'tiktok.com', 'netflix.com'],
  vault: { enabled: true },
  integrations: {},
};

export const IPC = {
  MOOD_SET: 'mood:set',
  MOOD_PULSE: 'mood:pulse',
  MOOD_INTENSITY: 'mood:intensity',
  ACTIVITY_SET: 'activity:set',
  CHAT_MESSAGE: 'chat:message',
  CHAT_SUBMIT: 'chat:submit',
  VISION_PRESENCE: 'vision:presence',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  VOICE_TRIGGER: 'voice:trigger',
  VOICE_STATUS: 'voice:status',
  CHAT_CAPTURE_MODE: 'chat:captureMode',
  RENDERER_ERROR: 'renderer:error',
  MEETING_QUIET: 'meeting:quiet',
} as const;

export interface Logger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
}

export interface ToolContext {
  config: Readonly<Config>;
  speak(text: string): void;
  setMood(state: MoodState, durationMs?: number): void;
  setActivity(activity: ActivityState | null): void;
  log: Logger;
}

export type ToolResult =
  | { ok: true; summary: string; data?: unknown }
  | { ok: false; error: string; userMessage: string };

export interface WatcherContext {
  config: Readonly<Config>;
  setMood(state: MoodState): void;
  requestCallout(text: string): void;
  setActivity(activity: ActivityState | null): void;
  log: Logger;
}

// Transient one-shot expressive flourishes. Main decides WHEN they fire
// (timing/physics live in main); packs decide HOW they look. The first group
// are the original sound/blink pulses; the rest are the companion "liveliness"
// micro-behaviors and gesture reactions (Phase A).
export type PulseEvent =
  | 'blink' | 'speakTick' | 'soundBloop' | 'soundChime' | 'soundGrumble' | 'lookAway'
  | 'lookAround' | 'yawn' | 'stretch' | 'doze' | 'peek'   // idle micro-behaviors
  | 'giggle' | 'heart' | 'startle' | 'dizzy';             // gesture reactions

export interface ExpressionPack {
  readonly name: string;
  // HTMLElement comes from DOM lib — only used in renderer context
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  init(container: any, opts: { reducedMotion: boolean }): void;
  setState(state: MoodState): void;
  pulse(event: PulseEvent): void;
  setIntensity(level: number): void;
  setActivity(activity: ActivityState | null): void;
  /** Continuous cursor-follow gaze. dx,dy are normalized to roughly -1..1
   *  relative to the avatar centre. Optional — packs that can't move their
   *  eyes (e.g. a flat image) may omit it or approximate with a slight lean. */
  setGaze?(dx: number, dy: number): void;
  dispose(): void;
}

// NOTE: the live LLMProvider / ChatRequest / ChatResponse contracts live in
// src/main/ai/providers/types.ts (they carry the native-tool fields). The
// duplicates that used to sit here were dead — nothing imported them — so they
// were removed to keep one source of truth. ChatMessage stays here because it's
// shared vocabulary across the IPC boundary and both the provider + history layers.

export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  /** OpenAI native tool-calling only. An assistant turn may carry `tool_calls`;
   *  a 'tool' message carries the id it answers. The fenced-JSON path never sets
   *  these, and every non-native provider ignores them. Persisted history only
   *  ever holds plain user/assistant turns. */
  tool_calls?: NativeToolCall[];
  tool_call_id?: string;
}

/** OpenAI tool_calls wire shape — echoed back verbatim on the next turn so the
 *  assistant message and its 'tool' replies link by id (OpenAI requires this). */
export interface NativeToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface STTProvider {
  readonly name: string;
  transcribe(audioBuffer: Buffer): Promise<string>;
}

export interface Watcher {
  readonly name: string;
  start(ctx: WatcherContext): void;
  stop(): void;
}
