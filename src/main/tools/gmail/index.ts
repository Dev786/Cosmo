import { z } from 'zod';
import { registerTool } from '../registry';
import { refreshAccessToken } from '../../core/googleOAuth';
import { getApiKey } from '../../core/secrets';
import type { ToolContext } from '../types';

// Read-only Gmail via the Gmail REST API. This is the "OAuth" auth path: the user
// connects their Google account once in the Accounts onboarding tab (which stores
// clientId/secret + a long-lived refresh token). The tool is stateless — it trades
// the refresh token for a fresh access token on each call, so there's no token
// write-back to manage. Scope is gmail.readonly; no sending, no modifying.

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const DETAIL_CAP = 6; // metadata fetches per call — keep us under the 8s tool cap

interface MsgRef { id: string }
interface MsgList { messages?: MsgRef[]; resultSizeEstimate?: number }
interface MsgMeta { payload?: { headers?: { name: string; value: string }[] } }

function googleCreds(ctx: ToolContext): { clientId: string; clientSecret: string; refreshToken: string } | null {
  // clientId isn't secret (it travels in the auth URL) → plain config. The secret
  // + refresh token ARE sensitive → encrypted secrets store (set by the Accounts
  // onboarding flow), with explicit .env fallbacks for dev.
  const clientId = ctx.config.integrations?.google?.clientId || process.env.GOOGLE_CLIENT_ID || '';
  const clientSecret = getApiKey('googleClientSecret', 'GOOGLE_CLIENT_SECRET');
  const refreshToken = getApiKey('googleRefreshToken', 'GOOGLE_REFRESH_TOKEN');
  return clientId && clientSecret && refreshToken ? { clientId, clientSecret, refreshToken } : null;
}

const NOT_CONNECTED = 'Connect Gmail first — choose Google OAuth in setup (the Accounts tab) and sign in.';

async function gmail<T>(path: string, accessToken: string): Promise<T> {
  const res = await fetch(`${GMAIL}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Gmail ${res.status}`);
  return res.json() as Promise<T>;
}

function header(meta: MsgMeta, name: string): string {
  const h = meta.payload?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? '';
}

// "Alex Rivera <alex@x.com>" → "Alex Rivera"; bare address → the local part.
function senderName(from: string): string {
  const m = from.match(/^\s*"?([^"<]+?)"?\s*</);
  if (m) return m[1].trim();
  return from.split('@')[0].replace(/[<>]/g, '').trim() || from;
}

async function summarize(query: string, accessToken: string, emptyMsg: string): Promise<string> {
  const list = await gmail<MsgList>(`/messages?q=${encodeURIComponent(query)}&maxResults=20`, accessToken);
  const ids = list.messages ?? [];
  if (!ids.length) return emptyMsg;

  const metas = await Promise.all(
    ids.slice(0, DETAIL_CAP).map((m) =>
      gmail<MsgMeta>(`/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`, accessToken),
    ),
  );
  const lines = metas.map((meta) => `• ${senderName(header(meta, 'From'))}: ${header(meta, 'Subject') || '(no subject)'}`);
  const total = list.resultSizeEstimate ?? ids.length;
  const more = total > DETAIL_CAP ? `\n…and ${total - DETAIL_CAP} more` : '';
  return `${total} message${total === 1 ? '' : 's'}:\n${lines.join('\n')}${more}`;
}

export function registerGmailTools(): void {
  registerTool({
    name: 'gmail.unread',
    description: 'Check unread Gmail — sender + subject of recent unread messages (read-only)',
    schema: z.object({}),
    availableOffline: false,
    async execute(_args, ctx) {
      const c = googleCreds(ctx);
      if (!c) return { ok: false, error: 'no-creds', userMessage: NOT_CONNECTED };
      try {
        const { accessToken } = await refreshAccessToken(c.clientId, c.clientSecret, c.refreshToken);
        const summary = await summarize('is:unread', accessToken, 'Inbox zero — no unread mail. ✨');
        return { ok: true, summary };
      } catch (e) {
        return { ok: false, error: (e as Error).message, userMessage: `Couldn't reach Gmail: ${(e as Error).message}` };
      }
    },
  });

  registerTool({
    name: 'gmail.search',
    description: 'Search your Gmail with a query (e.g. "from:acme invoice", "is:important newer_than:2d")',
    schema: z.object({ query: z.string().min(1) }),
    availableOffline: false,
    async execute(args: { query: string }, ctx) {
      const c = googleCreds(ctx);
      if (!c) return { ok: false, error: 'no-creds', userMessage: NOT_CONNECTED };
      try {
        const { accessToken } = await refreshAccessToken(c.clientId, c.clientSecret, c.refreshToken);
        const summary = await summarize(args.query, accessToken, `No mail matching "${args.query}".`);
        return { ok: true, summary };
      } catch (e) {
        return { ok: false, error: (e as Error).message, userMessage: `Couldn't search Gmail: ${(e as Error).message}` };
      }
    },
  });
}
