import { sanitizeForSpeech } from '../speechQueue';

describe('sanitizeForSpeech (TTS-safe text)', () => {
  it('strips dashes to spaces, leaving clean words', () => {
    expect(sanitizeForSpeech('I checked — nothing new')).toBe('I checked nothing new');
    expect(sanitizeForSpeech('well-known fact')).toBe('well known fact');
    expect(sanitizeForSpeech('wait -- really?')).toBe('wait really?');
  });

  it('strips markdown emphasis, bullets and code ticks', () => {
    expect(sanitizeForSpeech('**bold** and `code` and *star*')).toBe('bold and code and star');
    expect(sanitizeForSpeech('• item one')).toBe('item one');
  });

  it('removes emoji and symbol glyphs', () => {
    expect(sanitizeForSpeech('All done ✨ great 🎉')).toBe('All done great');
    expect(sanitizeForSpeech('next → step')).toBe('next step');
  });

  it('drops brackets/parens and fancy quotes', () => {
    expect(sanitizeForSpeech('hello (there) world')).toBe('hello there world');
    expect(sanitizeForSpeech('she said “hi” to me')).toBe('she said hi to me');
  });

  it('keeps basic sentence punctuation for natural pacing', () => {
    expect(sanitizeForSpeech('Hi there! How are you? I am good.')).toBe('Hi there! How are you? I am good.');
  });

  it('converts semicolons and colons to comma pauses', () => {
    expect(sanitizeForSpeech('one thing: do it; then rest')).toBe('one thing, do it, then rest');
  });

  it('collapses leftover whitespace', () => {
    expect(sanitizeForSpeech('a   —   b')).toBe('a b');
  });
});
