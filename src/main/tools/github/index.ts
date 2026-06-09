import { z } from 'zod';
import { registerTool } from '../registry';
import type { ToolContext } from '../types';

function token(ctx: ToolContext): string | undefined {
  return ctx.config.integrations?.github?.token || process.env.GITHUB_TOKEN || undefined;
}

async function gh(path: string, tok: string): Promise<unknown> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${tok}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'cosmo',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  return res.json();
}

export function registerGithubTools(): void {
  registerTool({
    name: 'github.notifications',
    description: 'Get your unread GitHub notifications',
    schema: z.object({}),
    availableOffline: false,
    async execute(_args, ctx) {
      const tok = token(ctx);
      if (!tok) return { ok: false, error: 'no-token', userMessage: 'Add a GitHub token (GITHUB_TOKEN) to use this.' };
      try {
        const items = await gh('/notifications', tok) as Array<{ subject: { title: string; type: string }; repository: { full_name: string } }>;
        if (!items.length) return { ok: true, summary: 'Inbox zero on GitHub. ✨' };
        const lines = items.slice(0, 8).map((n) => `• [${n.repository.full_name}] ${n.subject.title}`);
        return { ok: true, summary: `${items.length} unread notification${items.length === 1 ? '' : 's'}:\n${lines.join('\n')}` };
      } catch (e) {
        return { ok: false, error: (e as Error).message, userMessage: `GitHub unavailable: ${(e as Error).message}` };
      }
    },
  });

  registerTool({
    name: 'github.prs',
    description: 'List open pull requests awaiting your review',
    schema: z.object({}),
    availableOffline: false,
    async execute(_args, ctx) {
      const tok = token(ctx);
      if (!tok) return { ok: false, error: 'no-token', userMessage: 'Add a GitHub token (GITHUB_TOKEN) to use this.' };
      try {
        const r = await gh('/search/issues?q=' + encodeURIComponent('is:open is:pr review-requested:@me'), tok) as { total_count: number; items: Array<{ title: string; repository_url: string; html_url: string }> };
        if (!r.total_count) return { ok: true, summary: 'No PRs awaiting your review.' };
        const lines = r.items.slice(0, 8).map((p) => `• ${p.repository_url.split('/repos/')[1] ?? ''} — ${p.title}`);
        return { ok: true, summary: `${r.total_count} PR${r.total_count === 1 ? '' : 's'} awaiting your review:\n${lines.join('\n')}` };
      } catch (e) {
        return { ok: false, error: (e as Error).message, userMessage: `GitHub unavailable: ${(e as Error).message}` };
      }
    },
  });
}
