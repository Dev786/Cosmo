import { z } from 'zod';
import { registerTool } from '../registry';
import { addSources } from '../../core/sources';

// Headlines via Google News' public RSS feed — keyless and free (no signup, no API
// key), the same "fetch + regex-parse" shape as search.web. Top stories when no
// topic is given, or a focused search when one is. We return only the headline +
// source (short, spoken-friendly), never full articles — and record the headline +
// outlet + link into the Sources store so the panel's Sources tab can show them.

interface NewsItem { title: string; source: string; url: string; }

/** Decode the HTML entities / CDATA that turn up in RSS titles. &amp; is done last
 *  so we don't double-decode (e.g. "&amp;lt;" must stay "&lt;", not become "<"). */
function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();
}

/** Pull headline + source out of each <item> in a Google News RSS document. Titles
 *  arrive as "Headline - Source"; when a <source> tag is present we strip that
 *  redundant suffix off the headline. */
function parseRssItems(xml: string): NewsItem[] {
  const items: NewsItem[] = [];
  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    const titleM = block.match(/<title[^>]*>([\s\S]*?)<\/title>/);
    if (!titleM) continue;
    let title = decodeEntities(titleM[1]);
    const srcM = block.match(/<source\b[^>]*>([\s\S]*?)<\/source>/);
    const source = srcM ? decodeEntities(srcM[1]) : '';
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3)).trim();
    const linkM = block.match(/<link\b[^>]*>([\s\S]*?)<\/link>/);
    const url = linkM ? decodeEntities(linkM[1]) : '';
    if (title) items.push({ title, source, url });
  }
  return items;
}

export function registerNewsTools(): void {
  registerTool({
    name: 'news.headlines',
    description: 'Get the latest news headlines. Pass a topic in `query` to focus (e.g. "technology", "Apple", "elections", "Premier League") or omit it for top stories. Returns recent headlines with their source.',
    schema: z.object({ query: z.string().optional() }),
    availableOffline: false,
    async execute(args, ctx) {
      ctx.setActivity({ type: 'searching' });
      try {
        const q = args.query?.trim();
        const base = 'hl=en-US&gl=US&ceid=US:en';
        const url = q
          ? `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&${base}`
          : `https://news.google.com/rss?${base}`;
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Cosmo/1.0)' } });
        const xml = await res.text();
        const items = parseRssItems(xml).slice(0, 6);
        ctx.setActivity(null);

        if (!items.length) {
          return { ok: true, summary: q ? `I couldn't find news about "${q}" right now.` : "I couldn't fetch the news right now." };
        }
        // Record them so the panel's Sources tab has the full list with links.
        addSources(items);
        const lines = items.map((it, i) => `${i + 1}. ${it.title}${it.source ? ` (${it.source})` : ''}`);
        const heading = q ? `Latest on ${q}:` : 'Top headlines right now:';
        // The spoken reply stays brief; the sources live in the Sources tab.
        return { ok: true, summary: `${heading}\n${lines.join('\n')}\n\n(The full list with sources is in the Sources tab.)`, data: items };
      } catch (e: unknown) {
        ctx.setActivity(null);
        return { ok: false, error: (e as Error).message, userMessage: `Couldn't get the news: ${(e as Error).message}` };
      }
    },
  });
}
