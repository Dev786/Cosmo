import type { Config } from '../../shared/types';

/**
 * Decides what a transcribed utterance means in always-listening mode. All wake
 * judgment lives here so it stays tunable in one place (mirrors workSignal's
 * role for moods).
 *
 *   - command: run this text as a user request
 *   - wake:    heard the wake word with nothing after it → open a short window
 *              where the next utterance is treated as a command
 *   - ignore:  speech not addressed to Cosmo
 *
 * Wake detection is fuzzy on purpose: small.en routinely mis-hears "Cosmo" as
 * "blankie", "blanky", "blinkie", etc. We strip a leading filler word
 * ("hey"/"ok"/...), then match the next token against the configured wake words
 * by exact OR small edit distance, so near-misses still wake.
 */
export type WakeDecision =
  | { kind: 'command'; text: string }
  | { kind: 'wake' }
  | { kind: 'ignore' };

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

// Common words a hair away from "cosmo" that should NEVER wake him — they turn up
// constantly in background speech/TV and were the main source of false wakes.
const CONFUSABLE = new Set(['cosmos', 'cosmic', 'como', 'costco', 'cosme', 'cosmetic']);

function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

export class WakeWordGate {
  private activeUntil = 0;

  constructor(private getConfig: () => Config) {}

  private wakeWords(): string[] {
    return (this.getConfig().voice.wakeWords ?? []).map(normalize).filter(Boolean);
  }

  private isActive(now: number): boolean { return now < this.activeUntil; }

  /** True while the post-wake window is open — i.e. the next transcribed turn will
   *  be treated as a command. Lets the caller show the 'thinking' pose during a
   *  post-wake command's transcription, not just an explicit mic-click command. */
  isAwaitingCommand(now: number): boolean { return this.isActive(now); }

  /** Open the post-wake window. `ms` overrides the default (used for the longer
   *  EMO-style follow-up window so a back-and-forth doesn't need re-waking). */
  openWindow(now: number, ms?: number): void {
    this.activeUntil = now + (ms ?? (this.getConfig().voice.activeWindowSec ?? 9) * 1000);
  }
  closeWindow(): void { this.activeUntil = 0; }

  /** If the utterance starts with (a fuzzy) wake word, return the remainder. */
  private stripWake(text: string): { matched: boolean; rest: string } {
    const wakeWords = this.wakeWords();
    const multi = wakeWords.filter((w) => w.includes(' '));
    const single = wakeWords.filter((w) => !w.includes(' '));
    const hits = (token: string): boolean => {
      if (!token || CONFUSABLE.has(token)) return false;
      // Cap tolerance at 1 edit (was 2). Tol-2 on a 5-char name matched far too
      // much of normal speech; 1 still forgives a single STT slip but stops the
      // false-wake storm. The mic button covers anything the gate now misses.
      return single.some((w) => token === w || editDistance(token, w) <= 1);
    };

    // Exact multi-word phrases first ("hey cosmo"), longest first.
    for (const w of multi.sort((a, b) => b.length - a.length)) {
      if (text === w) return { matched: true, rest: '' };
      if (text.startsWith(w + ' ')) return { matched: true, rest: text.slice(w.length + 1) };
    }

    // Scan the first couple of tokens — Whisper routinely prepends a filler or a
    // mis-split syllable ("hey", "ah", "he") before the name. Also try re-joining
    // two adjacent tokens, for when it splits the name itself ("blin key").
    const tokens = text.split(' ');
    const scan = Math.min(tokens.length, 2);
    for (let i = 0; i < scan; i++) {
      if (hits(tokens[i])) return { matched: true, rest: tokens.slice(i + 1).join(' ') };
      if (i + 1 < tokens.length && hits(tokens[i] + tokens[i + 1])) {
        return { matched: true, rest: tokens.slice(i + 2).join(' ') };
      }
    }
    return { matched: false, rest: '' };
  }

  decide(rawTranscript: string, now: number): WakeDecision {
    const text = normalize(rawTranscript);
    if (!text) return { kind: 'ignore' };

    const { matched, rest } = this.stripWake(text);
    if (matched) {
      if (rest.trim().length >= 2) { this.closeWindow(); return { kind: 'command', text: rest.trim() }; }
      this.openWindow(now);
      return { kind: 'wake' };
    }

    // Inside the post-wake window: the whole utterance is the command.
    if (this.isActive(now)) { this.closeWindow(); return { kind: 'command', text: rawTranscript.trim() }; }

    return { kind: 'ignore' };
  }
}
