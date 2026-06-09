import { z } from 'zod';
import { registerTool } from '../registry';
import type { ToolContext } from '../types';

// Read-only Trello via the REST API. Trello has no native macOS app, so it always
// uses an API key + token (the user pastes both in the Accounts/Connect onboarding
// tab; read-only is enough). Mirrors the github tool's shape: creds from config
// (or env for dev), thin fetch, summarize. No write actions in v1.

interface TrelloCard {
  name: string;
  due: string | null;
  url: string;
  idBoard: string;
}
interface TrelloBoard {
  id: string;
  name: string;
}

function creds(ctx: ToolContext): { key: string; token: string } | null {
  const t = ctx.config.integrations?.trello;
  const key = t?.key || process.env.TRELLO_KEY || '';
  const token = t?.token || process.env.TRELLO_TOKEN || '';
  return key && token ? { key, token } : null;
}

async function trello<T>(path: string, key: string, token: string): Promise<T> {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`https://api.trello.com/1${path}${sep}key=${encodeURIComponent(key)}&token=${encodeURIComponent(token)}`);
  if (!res.ok) throw new Error(`Trello ${res.status}`);
  return res.json() as Promise<T>;
}

function dueLabel(due: string | null): string {
  if (!due) return '';
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return '';
  return ` (due ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })})`;
}

export function registerTrelloTools(): void {
  registerTool({
    name: 'trello.tickets',
    description: 'List your active (open) Trello cards/tickets assigned to you',
    schema: z.object({}),
    availableOffline: false,
    async execute(_args, ctx) {
      const c = creds(ctx);
      if (!c) {
        return {
          ok: false,
          error: 'no-creds',
          userMessage: 'Connect Trello first — add your API key and token in setup (the Accounts tab).',
        };
      }
      try {
        const cards = await trello<TrelloCard[]>(
          '/members/me/cards?filter=open&fields=name,due,url,idBoard',
          c.key,
          c.token,
        );
        if (!cards.length) return { ok: true, summary: 'No active Trello cards assigned to you. ✨' };

        // One extra call to turn board IDs into readable names.
        let boardName: Record<string, string> = {};
        try {
          const boards = await trello<TrelloBoard[]>('/members/me/boards?fields=name', c.key, c.token);
          boardName = Object.fromEntries(boards.map((b) => [b.id, b.name]));
        } catch { /* names are a nicety; cards already work without them */ }

        const lines = cards.slice(0, 8).map((card) => {
          const board = boardName[card.idBoard] ? ` — ${boardName[card.idBoard]}` : '';
          return `• ${card.name}${dueLabel(card.due)}${board}`;
        });
        const more = cards.length > 8 ? `\n…and ${cards.length - 8} more` : '';
        return { ok: true, summary: `${cards.length} active ticket${cards.length === 1 ? '' : 's'}:\n${lines.join('\n')}${more}` };
      } catch (e) {
        return { ok: false, error: (e as Error).message, userMessage: `Couldn't reach Trello: ${(e as Error).message}` };
      }
    },
  });
}
