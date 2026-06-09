export interface TTSProvider {
  readonly name: string;
  readonly offline: boolean;
  /** Speak text. Returns when audio finishes playing. Pass `signal` to abort
   *  mid-utterance (barge-in): synthesis stops and any playing audio is killed. */
  /** `onAudioStart` fires the instant real audio begins playing (after any
   *  synth/network latency) — used to start the talk animation in sync with the
   *  sound instead of at enqueue time. */
  speak(text: string, opts?: { voice?: string; rate?: number; signal?: AbortSignal; onAudioStart?: () => void }): Promise<void>;
  /** Optional: speak WITHOUT the silent fallback-to-`say`, REJECTING on failure.
   *  `speak` deliberately degrades to macOS `say` so a bad cloud key never leaves
   *  the user in silence — but that masks errors. The setup screen's "Preview"
   *  calls this instead so it can show the real failure (bad key, wrong voice id).
   *  Providers that can't fail on a key (Kokoro/macOS) may omit it. */
  preview?(text: string, opts?: { voice?: string }): Promise<void>;
  /** Optional: preload models / warm up. Called once at startup. */
  init?(): Promise<void>;
  dispose?(): void;
}
