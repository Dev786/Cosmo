import { speak } from '../tts/registry';
import { log } from './log';

// Strip characters that make TTS stumble — dashes, markdown, bullets, brackets,
// emoji/symbols — and normalize fancy quotes + semicolons/colons. We KEEP basic
// sentence punctuation (. , ! ? ') so speech still has natural pacing; removing
// those entirely makes a synth read everything as one breathless run-on. This is
// the reliable guarantee (the model is also told to avoid them, but won't always).
export function sanitizeForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')                       // code fences
    .replace(/[—–―‒-]+/g, ' ')                             // ALL dashes & hyphens → space (no dashes per request)
    .replace(/[*_`#>~|•·●▪◦‣⁃]+/g, ' ')                     // markdown / bullet glyphs
    .replace(/[()[\]{}<>]/g, ' ')                            // brackets & parens
    .replace(/[“”„«»]/g, '').replace(/[‘’‚]/g, "'")          // fancy quotes
    .replace(/[;:]/g, ',')                                   // semicolon / colon → comma pause
    .replace(/[\u{1F000}-\u{1FAFF}\u{2190}-\u{27BF}\u{2B00}-\u{2BFF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}]/gu, '') // emoji / symbols / arrows
    .replace(/\s+([,.!?])/g, '$1')                           // no space before punctuation
    .replace(/([,]){2,}/g, '$1')                             // dedupe commas
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export class SpeechQueue {
  private queue: string[] = [];
  private running = false;
  private enabled = true;
  private currentController: AbortController | null = null;
  private speaking = false;
  private audioPlaying = false;
  private voice: string | undefined;
  private activityListeners: Array<(speaking: boolean) => void> = [];
  private audioListeners: Array<(playing: boolean) => void> = [];

  /** Set the TTS voice (Kokoro id) for subsequent speech — driven by the
   *  selected character. Undefined falls back to the provider default. */
  setVoice(voice: string | undefined): void {
    this.voice = voice;
  }

  /** Notified true when an utterance is dequeued (queue "running"), false when it
   *  drains. Drives mic-gating + the idle return — fires reliably regardless of
   *  synth latency, so the mic always recovers. */
  onActivity(cb: (speaking: boolean) => void): void {
    this.activityListeners.push(cb);
  }

  /** Notified true the instant REAL audio starts playing (after synth/network
   *  latency), false when the queue drains. Drives the talk animation so it tracks
   *  the sound, not the ~1s cloud-TTS fetch before it. */
  onAudioActivity(cb: (playing: boolean) => void): void {
    this.audioListeners.push(cb);
  }

  private setSpeaking(v: boolean): void {
    if (v === this.speaking) return;
    this.speaking = v;
    for (const l of this.activityListeners) { try { l(v); } catch { /* ignore */ } }
  }

  private setAudioPlaying(v: boolean): void {
    if (v === this.audioPlaying) return;
    this.audioPlaying = v;
    for (const l of this.audioListeners) { try { l(v); } catch { /* ignore */ } }
  }

  isSpeaking(): boolean { return this.speaking; }

  enqueue(text: string): void {
    if (!this.enabled) return;
    let t = sanitizeForSpeech(text.trim());
    if (!t) return;
    // Safety net: never feed a wall of text to synthesis. Replies should already
    // be short (the brain summarizes tool output before speaking), but if a raw
    // blob ever reaches here it would synthesize minutes of audio and look stuck.
    const MAX = 600;
    if (t.length > MAX) {
      log.warn(`TTS text too long (${t.length} chars) — truncating to ${MAX}`);
      const cut = t.slice(0, MAX);
      const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
      t = lastStop > 200 ? cut.slice(0, lastStop + 1) : cut;
    }
    this.queue.push(t);
    if (!this.running) this.next();
  }

  private next(): void {
    const text = this.queue.shift();
    if (!text) { this.running = false; this.setSpeaking(false); this.setAudioPlaying(false); return; }
    this.running = true;
    this.setSpeaking(true);

    const controller = new AbortController();
    this.currentController = controller;

    // Failsafe: a hung TTS backend must NEVER wedge the queue. afplay (and the
    // macOS `say` fallback) can hang forever on a missing/disconnected output
    // device — and a wedged queue never fires the drain signal that echo-control
    // uses to re-enable the mic, so a single bad reply would permanently mute
    // both the wake word and the mic button. Abort after a hard cap so the queue
    // always advances and the mic always comes back.
    const watchdog = setTimeout(() => {
      log.warn('TTS watchdog fired — speech stuck, aborting so the mic recovers');
      controller.abort();
    }, 30_000);

    speak(text, { voice: this.voice, signal: controller.signal, onAudioStart: () => this.setAudioPlaying(true) })
      .catch(e => log.debug('TTS error:', e.message))
      .finally(() => {
        clearTimeout(watchdog);
        if (this.currentController === controller) this.currentController = null;
        if (!controller.signal.aborted) {
          this.next();
        } else {
          // Aborted (barge-in or watchdog): stop, but ALWAYS emit the drain signal
          // so onActivity(false) fires and listening resumes. The old code set
          // running=false without setSpeaking(false), which on a watchdog abort
          // left the mic muted forever.
          this.running = false;
          this.setSpeaking(false);
          this.setAudioPlaying(false);
        }
      });
  }

  clear(): void {
    this.queue = [];
    if (this.currentController) {
      this.currentController.abort(); // stops synthesis + kills the playing afplay
      this.currentController = null;
    }
    this.running = false;
    this.setSpeaking(false);
    this.setAudioPlaying(false);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.clear();
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}

export const speechQueue = new SpeechQueue();
