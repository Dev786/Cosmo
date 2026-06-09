declare module 'kokoro-js' {
  export interface KokoroAudio {
    audio: { data: Float32Array };
    sampling_rate: number;
  }
  export class KokoroTTS {
    static from_pretrained(
      model: string,
      opts?: { dtype?: string; device?: string }
    ): Promise<KokoroTTS>;
    generate(text: string, opts?: { voice?: string; speed?: number }): Promise<KokoroAudio>;
  }
}
