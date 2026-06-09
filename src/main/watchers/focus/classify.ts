import type { Config } from '../../../shared/types';
import type { Category } from '../../core/activityLog';

export type AppClass = 'work' | 'distraction' | 'neutral' | 'meeting';

const MEETING_APPS = ['zoom.us', 'zoom', 'microsoft teams', 'facetime', 'webex', 'google meet', 'around'];

// App-name → category keyword tables (lowercased substrings). Strong, instant
// signals — checked before domains and before the user's config lists. Order
// matters: meeting first (a video-call app wins over anything), then the rest.
const APP_CATS: Array<[Category, string[]]> = [
  ['dev', ['code', 'cursor', 'xcode', 'intellij', 'webstorm', 'pycharm', 'goland', 'rubymine',
    'phpstorm', 'rider', 'clion', 'android studio', 'sublime text', 'zed', 'nova',
    'iterm', 'terminal', 'warp', 'ghostty', 'alacritty', 'kitty', 'hyper', 'wezterm',
    'vim', 'nvim', 'neovim', 'emacs', 'docker', 'postman', 'insomnia', 'tableplus',
    'sequel ace', 'sequel pro', 'github desktop', 'sourcetree', 'tower', 'fork']],
  ['design', ['figma', 'sketch', 'photoshop', 'illustrator', 'affinity', 'framer', 'zeplin',
    'principle', 'blender', 'canva', 'pixelmator', 'lightroom']],
  ['comms', ['slack', 'discord', 'mail', 'gmail', 'outlook', 'spark', 'airmail', 'messages',
    'telegram', 'whatsapp', 'signal', 'front']],
  ['research', ['notion', 'obsidian', 'notes', 'bear', 'craft', 'devonthink', 'zotero',
    'papers', 'preview', 'books', 'kindle', 'reeder']],
  ['entertainment', ['spotify', 'music', 'podcasts', ' tv', 'netflix', 'vlc', 'iina',
    'quicktime', 'infuse', 'plex', 'steam']],
  ['social', ['instagram', 'threads', 'mastodon']],
];

// Domain keyword tables (matched against the host, e.g. "docs.python.org"). Built-in
// defaults; the user's config lists are consulted first so they can override.
const DOMAIN_CATS: Array<[Category, string[]]> = [
  ['entertainment', ['youtube.com', 'youtu.be', 'netflix.com', 'twitch.tv', 'hulu.com',
    'disneyplus.com', 'primevideo.com', 'hotstar.com', 'spotify.com']],
  ['social', ['x.com', 'twitter.com', 'instagram.com', 'reddit.com', 'tiktok.com',
    'facebook.com', 'threads.net', 'linkedin.com', 'mastodon', 'snapchat.com']],
  ['comms', ['mail.google.com', 'gmail.com', 'outlook.', 'slack.com', 'discord.com',
    'web.whatsapp.com', 'messenger.com', 'web.telegram.org']],
  ['dev', ['github.com', 'gitlab.com', 'bitbucket.org', 'localhost', 'stackoverflow.com',
    'stackexchange.com', 'developer.', 'docs.', 'mdn', 'npmjs.com', 'pypi.org',
    'crates.io', 'vercel.com', 'netlify.com', '.dev', '.internal']],
  ['research', ['wikipedia.org', 'arxiv.org', 'scholar.google', 'medium.com', 'dev.to',
    'substack.com', 'notion.so']],
];

const MEETING_DOMAINS = ['meet.google.com', 'zoom.us', 'teams.microsoft.com', 'chat.google.com', 'whereby.com'];

const keysFor = (c: Category): string[] => DOMAIN_CATS.find(e => e[0] === c)?.[1] ?? [];

/** Extract a normalized host ("www." stripped, lowercased) from a URL, if any. */
export function hostOf(url?: string): string | undefined {
  if (!url) return undefined;
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); }
  catch {
    const m = url.toLowerCase().match(/^[a-z]+:\/\/([^/]+)/);
    return m ? m[1].replace(/^www\./, '') : undefined;
  }
}

/** Best-effort category for the focused app, from app name + window title + domain
 *  alone (no network, no LLM). Smart Focus (opt-in) refines this later. */
export function classifyHeuristic(appName: string, _title: string | undefined, domain: string | undefined, config: Config): Category {
  const name = appName.toLowerCase();

  if (MEETING_APPS.some(a => name.includes(a))) return 'meeting';
  if (domain && MEETING_DOMAINS.some(d => domain.includes(d))) return 'meeting';

  // App keyword tables win — a known app is a stronger signal than its current URL.
  for (const [cat, keys] of APP_CATS) {
    if (keys.some(k => name.includes(k))) return cat;
  }

  // Browser (or any app) with a domain. The user's own lists assert work-vs-distraction
  // intent and win; we then pick the most precise category from the built-in tables.
  if (domain) {
    const userWork = config.workDomains.some(d => domain.includes(d));
    const userDistraction = config.distractionDomains.some(d => domain.includes(d));
    if (userWork && !userDistraction) {
      // "this is work" — refine to dev vs research, never social/entertainment.
      return keysFor('dev').some(k => domain.includes(k)) ? 'dev' : 'research';
    }
    if (userDistraction) return distractionBucket(domain);
    for (const [cat, keys] of DOMAIN_CATS) {
      if (keys.some(k => domain.includes(k))) return cat;
    }
  }

  // A user-listed work app we didn't recognize above → treat as focused work.
  if (config.workApps.some(a => name.includes(a.toLowerCase()))) return 'dev';

  return 'neutral';
}

/** A user-flagged distraction domain → social vs entertainment by known names. */
function distractionBucket(domain: string): Category {
  return keysFor('entertainment').some(k => domain.includes(k)) ? 'entertainment' : 'social';
}

/** Map a rich category onto the coarse focus/distraction class the scold uses.
 *  Preserves the old behaviour: comms (Slack/Mail) stays neutral, not a distraction. */
export function categoryToClass(cat: Category): AppClass {
  switch (cat) {
    case 'dev': case 'design': case 'research': return 'work';
    case 'social': case 'entertainment': return 'distraction';
    case 'meeting': return 'meeting';
    default: return 'neutral';   // comms, neutral
  }
}

/** Coarse class for a focused app — now derived from the richer heuristic. */
export function classifyApp(appName: string, url: string | undefined, config: Config): AppClass {
  return categoryToClass(classifyHeuristic(appName, undefined, hostOf(url), config));
}

export function isMeetingApp(appName: string): boolean {
  const name = appName.toLowerCase();
  return MEETING_APPS.some(a => name.includes(a));
}

export function isMeetingUrl(url: string): boolean {
  const MEETING_URLS = ['meet.google.com', 'zoom.us/j/', 'teams.microsoft.com', 'chat.google.com'];
  return MEETING_URLS.some(u => url.includes(u));
}
