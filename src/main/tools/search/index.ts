import { z } from 'zod';
import { registerTool } from '../registry';
import { addSources } from '../../core/sources';

interface SearchResult { title: string; url: string; snippet: string; }
export let sessionResults: SearchResult[] = [];

/** Bare hostname for the Sources tab's outlet label (e.g. "arxiv.org"). */
function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

export function registerSearchTools(): void {
  registerTool({
    name: 'search.web',
    description: 'Search the web using DuckDuckGo. Always search before opening or reading pages.',
    schema: z.object({ query: z.string() }),
    availableOffline: false,
    async execute(args, ctx) {
      ctx.setActivity({ type: 'searching' });
      try {
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(args.query)}`;
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Cosmo/1.0)' },
        });
        const html = await res.text();

        const results: SearchResult[] = [];
        const titleRe = /class="result__title"[^>]*>.*?<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gs;
        const snippetRe = /class="result__snippet"[^>]*>(.*?)<\/a>/gs;

        const titles = [...html.matchAll(titleRe)].slice(0, 5);
        const snippets = [...html.matchAll(snippetRe)].slice(0, 5);

        for (let i = 0; i < Math.min(titles.length, 5); i++) {
          const rawUrl = titles[i][1];
          const title = titles[i][2].replace(/<[^>]+>/g, '').trim().slice(0, 140);
          // Cap snippets — some pages return a huge meta description, which used to
          // bloat the result blob (and the text fed to TTS) into minutes of audio.
          const snippet = (snippets[i]?.[1] ?? '').replace(/<[^>]+>/g, '').trim().slice(0, 220);
          // DuckDuckGo redirect URLs
          const urlMatch = rawUrl.match(/uddg=([^&]+)/);
          const finalUrl = urlMatch ? decodeURIComponent(urlMatch[1]) : rawUrl;
          if (title && finalUrl) results.push({ title, url: finalUrl, snippet });
        }

        sessionResults = results;
        // Record found pages into the Sources tab (title + outlet + link), so a
        // "find me URLs about X" request leaves a clickable list behind.
        addSources(results.map(r => ({ title: r.title, source: hostOf(r.url), url: r.url })));
        ctx.setActivity(null);

        if (!results.length) return { ok: true, summary: `No results found for "${args.query}"` };

        // Bare outlet domains (no scheme, no "www") for the SPOKEN reply. The full
        // clickable links already went to the Sources tab via addSources() above, so
        // we deliberately do NOT feed raw URLs back to the model: they're unreadable
        // over TTS, and a "find me resources" request should leave the links in the
        // Sources tab — Cosmo just names the domains and points there.
        const domains = [...new Set(results.map(r => hostOf(r.url)).filter(Boolean))];
        const lines = results.map((r, i) => `${i + 1}. ${r.title} (${hostOf(r.url)}): ${r.snippet}`);
        return {
          ok: true,
          summary:
            `Found ${results.length} results from: ${domains.join(', ')}. Full clickable links are saved to the Sources tab.\n` +
            lines.join('\n') +
            `\n\nNEVER read out a URL or this numbered list. If the user asked for resources / links / articles / papers, reply in ONE sentence: say you found resources from these domains (bare names like "${domains[0] ?? 'arxiv.org'}" — no "http", no "www"), and end with "please check the Sources section". If they asked a factual question instead, answer it briefly from the snippets above without reading any link.`,
          data: results,
        };
      } catch (e: unknown) {
        ctx.setActivity(null);
        return { ok: false, error: (e as Error).message, userMessage: `Search failed: ${(e as Error).message}` };
      }
    },
  });
}
