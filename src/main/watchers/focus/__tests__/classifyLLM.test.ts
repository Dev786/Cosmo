import { focusKey, parseCategory } from '../classifyLLM';

describe('focusKey', () => {
  it('lowercases app + domain and normalizes the title', () => {
    expect(focusKey('Visual Studio Code', 'Untitled-1', 'github.com')).toBe(
      'visual studio code|untitled-#|github.com'
    );
  });

  it('collapses digit runs so per-document/per-tab titles share one key', () => {
    const a = focusKey('Chrome', 'Issue 1234 · repo', 'github.com');
    const b = focusKey('Chrome', 'Issue 5678 · repo', 'github.com');
    expect(a).toBe(b);
    expect(a).toBe('chrome|issue # · repo|github.com');
  });

  it('treats missing title and domain as empty segments', () => {
    expect(focusKey('Terminal')).toBe('terminal||');
  });

  it('caps long titles at 80 chars to bound the cache', () => {
    const key = focusKey('App', 'x'.repeat(200));
    const title = key.split('|')[1];
    expect(title.length).toBe(80);
  });
});

describe('parseCategory', () => {
  it('accepts a bare known category, case-insensitive', () => {
    expect(parseCategory('dev')).toBe('dev');
    expect(parseCategory('MEETING')).toBe('meeting');
  });

  it('extracts the first word from a chatty reply', () => {
    expect(parseCategory('research, since the title is a paper')).toBe('research');
    expect(parseCategory('  comms.')).toBe('comms');
  });

  it('returns null for unknown words or empty/garbage replies', () => {
    expect(parseCategory('coding')).toBeNull();
    expect(parseCategory('')).toBeNull();
    expect(parseCategory('42')).toBeNull();
  });
});
