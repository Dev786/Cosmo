// Progressive tool disclosure ("tool gating") — DETERMINISTIC, reliable by design.
//
// A small/mid model reasons better over a SHORT, relevant tool list than over all
// ~28 at once. We shrink the list with a two-tier cascade:
//
//   L1  keyword/regex hit  → reveal CORE + the matched situational group(s). Tight.
//   L2  no hit             → reveal EVERYTHING. We never hide a tool on an utterance
//                            we couldn't classify, so the model can always reach what
//                            it needs. (Most no-hit turns are chit-chat, where a longer
//                            list is harmless — the prompt's "most messages need no
//                            tool" rule suppresses spurious calls.)
//
// Why no embeddings here (we tried — see git history / memory): tool gating is an
// ~11-way classifier over a FIXED, enumerable set. Curated keywords are deterministic
// (100% on what they cover), debuggable, and improve monotonically; a fuzzy similarity
// threshold can't be made reliable (it both misses real intent and fires on topical
// chit-chat). The genuine safety net is L2 (show-all) + core-always-pinned + the
// dispatcher executing any registered tool the model calls — NOT a vector score.
// (Embeddings stay where they're irreplaceable: open-ended memory recall.)
//
// SAFETY: this only changes what's *advertised* in the prompt — the dispatcher still
// executes ANY registered tool if the model calls it. Unclassified tools are CORE
// (always visible). When in doubt we show more, not less.

export interface Group {
  match: RegExp;
  /** Tool-name prefixes this group governs (matched with String.startsWith). */
  prefixes: string[];
}

// Situational groups: hidden until the query trips the regex (or L2 show-all kicks
// in). Keep keywords GENEROUS and use stems (\w*) so morphology is covered — a false
// reveal only adds one line, and a total miss just falls through to show-all.
export const SITUATIONAL: Group[] = [
  { match: /\b(e-?mail\w*|gmail|inbox|unread|mailbox|sender|messages?|from\s+\w+@)\b/i, prefixes: ['gmail.', 'mail.'] },
  { match: /\b(calendar|meetings?|events?|schedule|appointments?|agenda|invite|next meeting|next call|today|tomorrow|this week|free time|am i free|busy)\b/i, prefixes: ['calendar.'] },
  { match: /\b(trello|tickets?|cards?|boards?|kanban|sprint|backlog|to-?do board)\b/i, prefixes: ['trello.'] },
  { match: /\b(github|pull requests?|\bprs?\b|repos?|code review|merge\w*|commits?|ship\w*|deploy\w*|notifications?)\b/i, prefixes: ['github.'] },
  { match: /\b(weather|rain\w*|temperature|forecast|sunny|snow\w*|hot|cold|umbrella|degrees|outside)\b/i, prefixes: ['weather.'] },
  { match: /\b(news|headlines?|breaking|current events?|top stories|stories|in the news|happening in the world|going on in the world)\b/i, prefixes: ['news.'] },
  { match: /\b(music|songs?|tracks?|play|pause|resume|skip|next song|spotify|album|playlist|tunes|upbeat)\b/i, prefixes: ['music.'] },
  { match: /\b(pomodoro|focus session|focus timer|work session|work sprint|deep work|focus for|concentrate|time left|minutes? left|time remaining|how much (time )?left)\b/i, prefixes: ['pomodoro.'] },
  { match: /\b(clipboard|copy|paste|copied|pasteboard)\b/i, prefixes: ['clipboard.'] },
  { match: /\b(read|article|page|web ?page|summari[sz]e\w*|this link|that link|the link|this url|tldr)\b/i, prefixes: ['page.'] },
  { match: /\b(my day|time spent|spent (my )?time|where did (my|the) (time|day|afternoon|evening)|productiv\w*|distracted|distraction|screen ?time|usage|activity|recap|what did i (do|work)|how('?s| is| was) my day|how focused|time tracking)\b/i, prefixes: ['activity.'] },
];

export const ALL_SITUATIONAL = SITUATIONAL.flatMap((g) => g.prefixes);

const startsWithAny = (name: string, prefixes: string[]): boolean => prefixes.some((p) => name.startsWith(p));

/** Situational prefixes revealed by KEYWORD match for this query (L1). */
export function regexRevealedPrefixes(query: string): string[] {
  return SITUATIONAL.filter((g) => g.match.test(query)).flatMap((g) => g.prefixes);
}

/** Apply a set of revealed prefixes: core/unclassified tools always pass; a
 *  situational tool passes only if its prefix is revealed. Order is preserved. */
export function applyGate(allNames: string[], revealedPrefixes: string[]): string[] {
  return allNames.filter((name) =>
    startsWithAny(name, ALL_SITUATIONAL) ? startsWithAny(name, revealedPrefixes) : true,
  );
}

/**
 * The cascade. Pick which registered tool names to advertise for this turn:
 *   • keyword hit  → CORE + matched situational group(s) (focused list).
 *   • no hit       → ALL tools (show-all; never hide on an unclassified utterance).
 * Order of `allNames` is preserved.
 */
export function selectToolNames(query: string, allNames: string[]): string[] {
  const revealed = regexRevealedPrefixes(query);
  if (revealed.length === 0) return allNames; // L2: show everything, reliability by construction
  return applyGate(allNames, revealed);
}
