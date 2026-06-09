export interface STTProvider {
  readonly name: string;
  readonly offline: boolean;
  /** Transcribe a 16-bit PCM WAV buffer. `opts.model` lets the caller pick the
   *  provider's model per call (cloud vendors); the local engine ignores it (its
   *  model is fixed when the worker spawns). */
  transcribe(audioBuffer: Buffer, opts?: { model?: string; language?: string }): Promise<string>;
}
