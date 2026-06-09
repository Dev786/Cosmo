import { WakeWordGate } from '../wakeGate';
import type { Config } from '../../../shared/types';

const WAKE_WORDS = ['cosmo', 'hey cosmo', 'hi cosmo', 'ok cosmo', 'okay cosmo', 'yo cosmo', 'hello cosmo'];

function gate(): WakeWordGate {
  const cfg = { voice: { wakeWords: WAKE_WORDS, activeWindowSec: 9 } } as unknown as Config;
  return new WakeWordGate(() => cfg);
}

const NOW = 1_000_000;

describe('WakeWordGate — false-wake hardening', () => {
  // The bug that prompted this: background TV/speech saying "cosmos" etc. kept
  // waking him. These near-miss real words must be ignored.
  it.each(['cosmos is a great show', 'the cosmic background radiation', 'I went to costco today', 'cosmetic surgery', 'como estas'])(
    'ignores confusable real word: "%s"',
    (text) => { expect(gate().decide(text, NOW).kind).toBe('ignore'); },
  );

  it.each(['Kathmandu West', 'only from the west', 'is also known'])(
    'ignores unrelated background speech: "%s"',
    (text) => { expect(gate().decide(text, NOW).kind).toBe('ignore'); },
  );

  it('wakes on a clean bare "cosmo"', () => {
    expect(gate().decide('cosmo', NOW).kind).toBe('wake');
  });

  it('wakes on a two-word phrase', () => {
    expect(gate().decide('hey cosmo', NOW).kind).toBe('wake');
  });

  it('forgives a single STT slip on the name', () => {
    // "kosmo" is one edit from "cosmo" and not a real word — a plausible mishear.
    expect(gate().decide('kosmo', NOW).kind).toBe('wake');
  });

  it('treats wake-word + trailing text as a command', () => {
    const d = gate().decide('hey cosmo what time is it', NOW);
    expect(d.kind).toBe('command');
    if (d.kind === 'command') expect(d.text).toBe('what time is it');
  });

  it('opens a window so the next utterance is a command', () => {
    const g = gate();
    expect(g.decide('cosmo', NOW).kind).toBe('wake');
    const d = g.decide('what is the weather', NOW + 2000);
    expect(d.kind).toBe('command');
  });
});
