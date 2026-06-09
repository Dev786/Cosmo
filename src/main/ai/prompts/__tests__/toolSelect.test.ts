import { selectToolNames, regexRevealedPrefixes, applyGate } from '../toolSelect';

// A representative slice of the real registry: everyday CORE tools + every
// SITUATIONAL group, plus an unclassified tool to prove new tools stay visible.
const ALL = [
  'search.web', 'browser.open', 'launcher.open', 'notes.capture',
  'task.add', 'task.list', 'reminder.set', 'timer.set', 'system.mute', 'speech.say',
  'page.read', 'weather.today', 'clipboard.get',
  'music.play', 'music.pause', 'pomodoro.start',
  'github.notifications', 'github.prs',
  'calendar.today', 'calendar.next',
  'gmail.unread', 'gmail.search',
  'trello.tickets',
  'future.tool', // unclassified — must always survive gating
];

const SITUATIONAL_PREFIXES = ['page.', 'weather.', 'clipboard.', 'music.', 'pomodoro.', 'github.', 'calendar.', 'gmail.', 'trello.'];
const isSituational = (n: string): boolean => SITUATIONAL_PREFIXES.some((p) => n.startsWith(p));

describe('selectToolNames (deterministic cascade)', () => {
  it('keyword hit → focuses to core + the matched group, hiding other situational', () => {
    const picked = selectToolNames('any unread email from my boss?', ALL);
    expect(picked).toEqual(expect.arrayContaining(['gmail.unread', 'gmail.search', 'search.web', 'task.add', 'future.tool']));
    expect(picked).not.toContain('trello.tickets');
    expect(picked).not.toContain('github.prs');
    expect(picked).not.toContain('weather.today');
    expect(picked).not.toContain('music.play');
  });

  it('NO keyword hit → shows EVERYTHING (reliability by construction, never hide)', () => {
    const picked = selectToolNames('hey cosmo, how are you?', ALL);
    expect(picked).toEqual(ALL); // show-all: identical list, order preserved
  });

  it('reveals the calendar group for a meeting query', () => {
    const picked = selectToolNames("what's my next meeting?", ALL);
    expect(picked).toContain('calendar.next');
    expect(picked).toContain('calendar.today');
    expect(picked).not.toContain('gmail.unread');
  });

  it('reveals multiple groups when the query spans intents', () => {
    const picked = selectToolNames('play some music and check my email', ALL);
    expect(picked).toEqual(expect.arrayContaining(['music.play', 'music.pause', 'gmail.unread']));
    expect(picked).not.toContain('trello.tickets');
  });

  it('reveals trello + github on their keywords', () => {
    expect(selectToolNames('what are my active tickets?', ALL)).toContain('trello.tickets');
    expect(selectToolNames('any PRs waiting on my review?', ALL)).toContain('github.prs');
  });

  it('preserves the original order of surfaced tools', () => {
    const picked = selectToolNames('check my calendar', ALL);
    const order = picked.map((n) => ALL.indexOf(n));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('an empty query has no keyword hit → shows everything', () => {
    expect(selectToolNames('', ALL)).toEqual(ALL);
  });
});

describe('regexRevealedPrefixes (keyword layer L1)', () => {
  it('matches explicit domain words', () => {
    expect(regexRevealedPrefixes('check my email')).toEqual(expect.arrayContaining(['gmail.', 'mail.']));
    expect(regexRevealedPrefixes("what's the weather?")).toContain('weather.');
    expect(regexRevealedPrefixes('play some music')).toContain('music.');
  });

  it('returns [] for chit-chat (→ caller shows all)', () => {
    expect(regexRevealedPrefixes('how are you?')).toEqual([]);
    expect(regexRevealedPrefixes('tell me a joke')).toEqual([]);
  });

  // Regressions for bugs/gaps the real-embedding validation exposed.
  it('matches stemmed + paraphrased forms that the old regexes missed', () => {
    expect(regexRevealedPrefixes('how productive was I?')).toContain('activity.');   // was \bproductiv\b — never matched "productive"
    expect(regexRevealedPrefixes('did the team ship the build?')).toContain('github.');
    expect(regexRevealedPrefixes('put on something upbeat')).toContain('music.');
    expect(regexRevealedPrefixes('summarize this page for me')).toContain('page.');
    expect(regexRevealedPrefixes('who emailed me?')).toEqual(expect.arrayContaining(['gmail.', 'mail.']));
    expect(regexRevealedPrefixes('help me focus for 25 minutes')).toContain('pomodoro.');
  });
});

describe('applyGate', () => {
  it('reveals only the given prefixes; core/unclassified always pass', () => {
    const picked = applyGate(ALL, ['weather.']);
    expect(picked).toContain('weather.today');
    expect(picked).toContain('search.web');  // core
    expect(picked).toContain('future.tool'); // unclassified
    expect(picked).not.toContain('gmail.unread');
    expect(picked).not.toContain('music.play');
  });

  it('with no revealed prefixes, hides every situational tool', () => {
    expect(applyGate(ALL, []).filter(isSituational)).toEqual([]);
  });
});
