import { z } from 'zod';
import { registerTool } from '../registry';
import { runScript } from '../../core/osascript';

// page.read — read the page the user is LOOKING AT (or a URL they hand us) so the
// model can summarize / answer about it. Privacy: this fires ONLY on an explicit ask
// (never the focus watcher, never passively); the result carries the page TEXT only —
// never the URL or tab title — so what reaches the LLM is exactly the content the user
// asked it to read. With a local model nothing leaves the machine at all.
//
// Hybrid extraction: try the live tab's rendered text via AppleScript (works on
// logged-in / SPA / paywalled-but-open pages), and fall back to fetching the tab's URL
// when that's unavailable (browser toggle off, Firefox, permission denied).

const MAX_CHARS = 8000;     // token-budget cap — a long article still fits a summary turn
const FETCH_MS = 6000;      // per-fetch ceiling (the registry also caps the whole tool)

// Browsers whose active tab we can reach. Chromium-family supports `execute … javascript`;
// Safari uses `do JavaScript`. Firefox/others expose no scriptable content → URL fetch only.
const BROWSER_HINTS = ['google chrome', 'safari', 'arc', 'brave browser', 'microsoft edge', 'firefox'];

/** Strip a raw HTML document down to readable text. Pure + unit-tested. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|header|footer)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#0?39;/gi, "'").replace(/&#x27;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Trim text to the token-budget cap, marking truncation. Pure + unit-tested. */
export function capText(s: string, max = MAX_CHARS): string {
  const t = s.trim();
  return t.length <= max ? t : t.slice(0, max).trimEnd() + '…';
}

/** Normalize a user-supplied link; null unless it resolves to an http(s) URL. Parses
 *  as-is first (so a non-http scheme like `file:`/`javascript:` is rejected, not
 *  "fixed"), then retries with an `https://` prefix for a bare host like `example.com`. */
export function normalizeUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const httpOnly = (candidate: string): string | null => {
    try {
      const u = new URL(candidate);
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
    } catch { return null; }
  };
  // If it already parses as an absolute URL, honor its scheme (reject non-http(s)).
  try { new URL(s); return httpOnly(s); } catch { /* not absolute → add a scheme */ }
  return httpOnly(`https://${s}`);
}

async function fetchReadable(url: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Cosmo/1.0)' }, signal: ctrl.signal });
    return htmlToText(await res.text());
  } finally { clearTimeout(timer); }
}

async function frontmostApp(): Promise<string> {
  return (await runScript(`tell application "System Events" to get name of first process whose frontmost is true`)).trim();
}

// LITERAL app names only — never interpolate a dynamic value into AppleScript. The
// browser's "Allow JavaScript from Apple Events" must be on, else these throw and the
// caller falls back to fetching the URL.
async function liveTabText(app: string): Promise<string> {
  if (app.includes('safari')) return (await runScript(`tell application "Safari" to do JavaScript "document.body.innerText" in current tab of front window`)).trim();
  if (app.includes('google chrome')) return (await runScript(`tell application "Google Chrome" to execute active tab of front window javascript "document.body.innerText"`)).trim();
  if (app.includes('brave browser')) return (await runScript(`tell application "Brave Browser" to execute active tab of front window javascript "document.body.innerText"`)).trim();
  if (app.includes('arc')) return (await runScript(`tell application "Arc" to execute active tab of front window javascript "document.body.innerText"`)).trim();
  if (app.includes('microsoft edge')) return (await runScript(`tell application "Microsoft Edge" to execute active tab of front window javascript "document.body.innerText"`)).trim();
  return ''; // Firefox & co. — no scriptable tab content
}

async function activeTabUrl(app: string): Promise<string> {
  if (app.includes('safari')) return (await runScript(`tell application "Safari" to get URL of current tab of front window`)).trim();
  if (app.includes('google chrome')) return (await runScript(`tell application "Google Chrome" to get URL of active tab of front window`)).trim();
  if (app.includes('brave browser')) return (await runScript(`tell application "Brave Browser" to get URL of active tab of front window`)).trim();
  if (app.includes('arc')) return (await runScript(`tell application "Arc" to get URL of active tab of front window`)).trim();
  if (app.includes('microsoft edge')) return (await runScript(`tell application "Microsoft Edge" to get URL of active tab of front window`)).trim();
  return '';
}

async function runningProcessNames(): Promise<string[]> {
  try {
    return (await runScript(`tell application "System Events" to get name of every process`))
      .split(',').map((s) => s.trim().toLowerCase());
  } catch { return []; }
}

/** Which browser to read: the frontmost app if it's a browser, else the first running
 *  browser (probed via System Events, WITHOUT launching anything). This is why
 *  "summarize this page" still works after you click into Cosmo's chat box — Cosmo is
 *  frontmost then, but Chrome is still the browser you meant. null = no browser open. */
async function resolveBrowser(ctx: import('../types').ToolContext): Promise<string | null> {
  let front = '';
  try { front = (await frontmostApp()).toLowerCase(); }
  catch (e) { ctx.log.debug('page.read: frontmost check failed:', (e as Error).message); }
  if (BROWSER_HINTS.some((b) => front.includes(b))) return front;
  const procs = await runningProcessNames();
  return BROWSER_HINTS.find((b) => procs.includes(b)) ?? null;
}

/** Wrap the extracted text with a short instruction for the model. The user's own
 *  "summarize this" is already in the conversation; this just steers small models. */
function wrap(text: string): string {
  return 'PAGE CONTENT — the user asked you to read the page in front of them. Reply with a clear, ' +
    'friendly summary in your own words (a few sentences; longer only if they asked for depth). ' +
    `Never read a URL aloud.\n\n${text}`;
}

export function registerPageReadTools(): void {
  registerTool({
    name: 'page.read',
    description:
      'Read the web page the user is currently looking at (or a link they give you) so you can ' +
      'summarize it or answer questions about it. Use ONLY when the user explicitly asks to read, ' +
      'summarize, tldr, or explain the current page, article, or link.',
    schema: z.object({
      url: z.string().optional().describe('Optional: a specific link to read instead of the active browser tab.'),
    }),
    availableOffline: false,
    permissions: ['automation:browser'],
    async execute(args: { url?: string }, ctx): Promise<import('../types').ToolResult> {
      // 1) Explicit link → fetch it directly (no browser required).
      if (args.url) {
        const url = normalizeUrl(args.url);
        if (!url) return { ok: false, error: 'bad-url', userMessage: "That doesn't look like a link I can open." };
        try {
          const text = capText(await fetchReadable(url));
          if (!text) return { ok: false, error: 'empty', userMessage: "I couldn't pull any text out of that link." };
          return { ok: true, summary: wrap(text) };
        } catch (e) {
          ctx.log.debug('page.read fetch(url) failed:', (e as Error).message);
          return { ok: false, error: (e as Error).message, userMessage: "I couldn't open that link to read it." };
        }
      }

      // 2) The active browser tab (frontmost browser, or any running one if Cosmo is
      //    frontmost because the user typed into the chat box).
      const app = await resolveBrowser(ctx);
      if (!app) {
        return { ok: false, error: 'no-browser', userMessage: "I don't see a browser open to read — open the page in Chrome, Safari, Arc, Brave, or Edge first." };
      }

      // 2a) Preferred: the live tab's rendered text (covers logged-in / SPA pages).
      let text = '';
      try { text = await liveTabText(app); }
      catch (e) { ctx.log.debug('page.read liveTabText failed, will try URL fetch:', (e as Error).message); }

      // 2b) Fallback: read the tab's URL and fetch it server-side.
      if (!text) {
        try {
          const url = await activeTabUrl(app);
          if (/^https?:/i.test(url)) text = await fetchReadable(url);
        } catch (e) { ctx.log.debug('page.read URL-fetch fallback failed:', (e as Error).message); }
      }

      text = capText(text);
      if (!text) {
        return {
          ok: false, error: 'unreadable',
          userMessage: "I couldn't read this page. Try clicking into it first, or turn on the browser's “Allow JavaScript from Apple Events”.",
        };
      }
      return { ok: true, summary: wrap(text) };
    },
  });
}
