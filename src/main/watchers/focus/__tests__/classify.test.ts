import { classifyHeuristic, categoryToClass, classifyApp, hostOf } from '../classify';
import type { Config } from '../../../../shared/types';

// classifyHeuristic only reads three list fields; a partial cast keeps the test focused.
const config = {
  workApps: ['Code', 'Cursor', 'Figma', 'MyCustomIDE'],
  workDomains: ['github.com', 'localhost', 'docs.'],
  distractionDomains: ['youtube.com', 'x.com', 'reddit.com', 'news.example.com'],
} as unknown as Config;

describe('classifyHeuristic', () => {
  it('maps known dev/design/comms apps by name', () => {
    expect(classifyHeuristic('Code', undefined, undefined, config)).toBe('dev');
    expect(classifyHeuristic('iTerm2', undefined, undefined, config)).toBe('dev');
    expect(classifyHeuristic('Figma', undefined, undefined, config)).toBe('design');
    expect(classifyHeuristic('Slack', undefined, undefined, config)).toBe('comms');
    expect(classifyHeuristic('Spotify', undefined, undefined, config)).toBe('entertainment');
  });

  it('detects meeting apps and meeting domains', () => {
    expect(classifyHeuristic('zoom.us', undefined, undefined, config)).toBe('meeting');
    expect(classifyHeuristic('Google Chrome', undefined, 'meet.google.com', config)).toBe('meeting');
  });

  it('classifies browser domains (built-in tables)', () => {
    expect(classifyHeuristic('Safari', undefined, 'youtube.com', config)).toBe('entertainment');
    expect(classifyHeuristic('Google Chrome', undefined, 'x.com', config)).toBe('social');
    expect(classifyHeuristic('Google Chrome', undefined, 'github.com', config)).toBe('dev');
    expect(classifyHeuristic('Google Chrome', undefined, 'docs.python.org', config)).toBe('dev');
    expect(classifyHeuristic('Google Chrome', undefined, 'en.wikipedia.org', config)).toBe('research');
  });

  it('honors a user-listed distraction domain (→ social bucket by default)', () => {
    expect(classifyHeuristic('Google Chrome', undefined, 'news.example.com', config)).toBe('social');
  });

  it('treats a user-listed custom work app as focused work', () => {
    expect(classifyHeuristic('MyCustomIDE', undefined, undefined, config)).toBe('dev');
  });

  it('falls back to neutral for the unknown', () => {
    expect(classifyHeuristic('Some Random App', undefined, undefined, config)).toBe('neutral');
  });
});

describe('categoryToClass', () => {
  it('maps focus categories to work', () => {
    expect(categoryToClass('dev')).toBe('work');
    expect(categoryToClass('design')).toBe('work');
    expect(categoryToClass('research')).toBe('work');
  });
  it('maps social/entertainment to distraction', () => {
    expect(categoryToClass('social')).toBe('distraction');
    expect(categoryToClass('entertainment')).toBe('distraction');
  });
  it('keeps comms neutral (not a distraction) — preserves old behaviour', () => {
    expect(categoryToClass('comms')).toBe('neutral');
    expect(categoryToClass('neutral')).toBe('neutral');
  });
  it('maps meeting through', () => {
    expect(categoryToClass('meeting')).toBe('meeting');
  });
});

describe('classifyApp (coarse wrapper, used by the scold)', () => {
  it('still returns work/distraction/meeting/neutral from app+url', () => {
    expect(classifyApp('Code', undefined, config)).toBe('work');
    expect(classifyApp('Safari', 'https://www.youtube.com/watch?v=abc', config)).toBe('distraction');
    expect(classifyApp('zoom.us', undefined, config)).toBe('meeting');
    expect(classifyApp('Slack', undefined, config)).toBe('neutral');
  });
});

describe('hostOf', () => {
  it('strips www and lowercases', () => {
    expect(hostOf('https://www.YouTube.com/watch?v=x')).toBe('youtube.com');
    expect(hostOf('http://localhost:3000/app')).toBe('localhost');
  });
  it('returns undefined for empty', () => {
    expect(hostOf(undefined)).toBeUndefined();
    expect(hostOf('')).toBeUndefined();
  });
});
