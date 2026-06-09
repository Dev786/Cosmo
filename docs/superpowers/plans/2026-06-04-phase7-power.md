# Phase 7: Power Features & Integrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add daily-utility integrations and productivity tools that make Cosmo a genuine command centre for your workday.

**Architecture:** All Google services share one OAuth2 token managed by `integrations/google.ts`. Tools follow the existing registry pattern — each is a folder under `tools/`, registered in `tools/registry.ts`. New watchers (water, briefing, github) implement the `Watcher` interface and register in `watchers/registry.ts`. The webhook server is a localhost-only Node.js HTTP server in `core/webhookServer.ts`.

**Tech Stack:** Node.js `http` module, Google OAuth2 REST, Gmail/Calendar/Chat APIs, GitHub REST API, Open-Meteo (no API key), `electron.globalShortcut`, `crypto.randomUUID`

---

## File map

```
src/main/
  integrations/
    google.ts          ← shared OAuth2 token manager (new)
  tools/
    calendar/index.ts  ← calendar.today / next / block (new)
    email/index.ts     ← email.unread / read / compose / send / today (new)
    github/index.ts    ← github.prs / ci / mentions (new)
    weather/index.ts   ← weather.today / forecast (new)
    pomodoro/index.ts  ← pomodoro.start / stop (new)
    focusGoal/index.ts ← goal.set (new)
    reminders/index.ts ← reminder.add / list / remove (new)
    tasks/index.ts     ← task.add / list / complete / remove (new)
  watchers/
    water/index.ts     ← hydration reminder every 90 active-min (new)
    github/index.ts    ← PR staleness polling watcher (new)
    briefing/index.ts  ← morning + evening scheduled summaries (new)
    focus/index.ts     ← add distraction cap logic (modify)
  core/
    webhookServer.ts   ← localhost-only inbound HTTP (new)
  index.ts             ← quick-capture shortcut, webhook start (modify)
tests/main/
  integrations/google.test.ts
  tools/calendar.test.ts
  tools/email.test.ts
  tools/github.test.ts
  tools/weather.test.ts
  tools/pomodoro.test.ts
  tools/reminders.test.ts
  tools/tasks.test.ts
  watchers/water.test.ts
  watchers/briefing.test.ts
  core/webhookServer.test.ts
```

---

## Task 1: Google OAuth2 shared module

**Files:**
- Create: `src/main/integrations/google.ts`
- Test: `tests/main/integrations/google.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/main/integrations/google.test.ts
import { getAccessToken, isConfigured } from '../../../src/main/integrations/google';
import { CONFIG_DEFAULTS } from '../../../src/shared/types';

const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('getAccessToken', () => {
  it('returns existing token if not expired', async () => {
    const config = { ...CONFIG_DEFAULTS, integrations: {
      google: { accessToken: 'tok', refreshToken: 'ref', expiresAt: Date.now() + 120_000 }
    }};
    const token = await getAccessToken(config);
    expect(token).toBe('tok');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('refreshes expired token', async () => {
    mockFetch.mockResolvedValueOnce({ json: async () => ({ access_token: 'new-tok', expires_in: 3600 }) });
    const config = { ...CONFIG_DEFAULTS, integrations: {
      google: { accessToken: 'old', refreshToken: 'ref', expiresAt: Date.now() - 1000 }
    }};
    const token = await getAccessToken(config);
    expect(token).toBe('new-tok');
    const body = new URLSearchParams(mockFetch.mock.calls[0][1].body);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('ref');
  });

  it('throws if no refreshToken', async () => {
    const config = { ...CONFIG_DEFAULTS, integrations: {} };
    await expect(getAccessToken(config)).rejects.toThrow('Google not connected');
  });
});

describe('isConfigured', () => {
  it('returns true when refreshToken exists', () => {
    const config = { ...CONFIG_DEFAULTS, integrations: { google: { refreshToken: 'r', accessToken: 't', expiresAt: 0 } }};
    expect(isConfigured(config)).toBe(true);
  });
  it('returns false when no google integration', () => {
    expect(isConfigured({ ...CONFIG_DEFAULTS, integrations: {} })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx jest tests/main/integrations/google.test.ts
```
Expected: `Cannot find module`

- [ ] **Step 3: Implement**

```typescript
// src/main/integrations/google.ts
import type { Config } from '../../shared/types';

export async function getAccessToken(config: Config): Promise<string> {
  const g = config.integrations.google;
  if (!g?.refreshToken) throw new Error('Google not connected. Go to Settings → Integrations.');
  if (g.accessToken && g.expiresAt! > Date.now() + 60_000) return g.accessToken;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      refresh_token: g.refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });
  const data = await res.json() as { access_token: string; expires_in: number };
  // Caller is responsible for persisting the new token via store.set
  return data.access_token;
}

export function isConfigured(config: Config): boolean {
  return !!config.integrations.google?.refreshToken;
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npx jest tests/main/integrations/google.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/main/integrations/google.ts tests/main/integrations/google.test.ts
git commit -m "feat: Google OAuth2 shared token module"
```

---

## Task 2: Google Calendar tool

**Files:**
- Create: `src/main/tools/calendar/index.ts`
- Test: `tests/main/tools/calendar.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/main/tools/calendar.test.ts
import { calendarToday } from '../../../src/main/tools/calendar';
import * as google from '../../../src/main/integrations/google';

jest.spyOn(google, 'getAccessToken').mockResolvedValue('fake-token');
jest.spyOn(google, 'isConfigured').mockReturnValue(true);

const mockFetch = jest.fn();
global.fetch = mockFetch;

const mockCtx = {
  config: { integrations: { google: { refreshToken: 'r', accessToken: 't', expiresAt: Date.now() + 9999 } } } as any,
  speak: jest.fn(), setMood: jest.fn(), setActivity: jest.fn(), log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
};

it('formats events correctly', async () => {
  mockFetch.mockResolvedValueOnce({
    json: async () => ({ items: [
      { summary: 'Standup', start: { dateTime: '2026-06-04T10:00:00Z' }, hangoutLink: 'https://meet.google.com/abc' },
      { summary: 'Review', start: { dateTime: '2026-06-04T14:00:00Z' } },
    ]})
  });
  const result = await calendarToday.execute({}, mockCtx);
  expect(result.ok).toBe(true);
  expect(result.summary).toContain('Standup');
  expect(result.summary).toContain('meet.google.com/abc');
  expect(result.summary).toContain('Review');
});

it('returns not-configured message when google not set up', async () => {
  jest.spyOn(google, 'isConfigured').mockReturnValueOnce(false);
  const result = await calendarToday.execute({}, mockCtx);
  expect(result.ok).toBe(false);
  expect(result.userMessage).toContain('not connected');
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx jest tests/main/tools/calendar.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// src/main/tools/calendar/index.ts
import { z } from 'zod';
import { getAccessToken, isConfigured } from '../../integrations/google';
import type { Tool, ToolContext } from '../../../shared/types';

function formatEvent(e: any): string {
  const time = e.start.dateTime
    ? new Date(e.start.dateTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
    : 'All day';
  const meet = e.hangoutLink ? ` (${e.hangoutLink})` : '';
  return `${time} — ${e.summary}${meet}`;
}

export const calendarToday: Tool = {
  name: 'calendar.today',
  description: "List today's calendar events with times and Meet links",
  schema: z.object({}),
  availableOffline: false,
  execute: async (_args, ctx) => {
    if (!isConfigured(ctx.config)) {
      return { ok: false, error: 'not-configured', userMessage: "Google Calendar not connected. Go to Settings → Integrations." };
    }
    try {
      const token = await getAccessToken(ctx.config);
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(start)}&timeMax=${encodeURIComponent(end)}&singleEvents=true&orderBy=startTime`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json() as { items?: any[] };
      if (!data.items?.length) return { ok: true, summary: 'No events today.' };
      // Schedule 5-min pre-meeting callouts
      for (const e of data.items) {
        if (e.start.dateTime) {
          const delta = new Date(e.start.dateTime).getTime() - 5 * 60_000 - Date.now();
          if (delta > 0) setTimeout(() => ctx.speak(`Meeting in 5: ${e.summary}`), delta);
        }
      }
      return { ok: true, summary: `Today's events:\n${data.items.map(formatEvent).join('\n')}` };
    } catch (e: any) {
      return { ok: false, error: e.message, userMessage: `Calendar error: ${e.message}` };
    }
  },
};

export const calendarNext: Tool = {
  name: 'calendar.next',
  description: 'Show your next upcoming calendar event',
  schema: z.object({}),
  availableOffline: false,
  execute: async (_args, ctx) => {
    if (!isConfigured(ctx.config)) return { ok: false, error: 'not-configured', userMessage: "Google Calendar not connected." };
    try {
      const token = await getAccessToken(ctx.config);
      const now = new Date().toISOString();
      const end = new Date(Date.now() + 24 * 3600_000).toISOString();
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(now)}&timeMax=${encodeURIComponent(end)}&singleEvents=true&orderBy=startTime&maxResults=1`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json() as { items?: any[] };
      if (!data.items?.length) return { ok: true, summary: 'No upcoming events in the next 24 hours.' };
      const e = data.items[0];
      const mins = Math.round((new Date(e.start.dateTime).getTime() - Date.now()) / 60_000);
      return { ok: true, summary: `Next: ${e.summary} in ${mins} minutes.` };
    } catch (e: any) {
      return { ok: false, error: e.message, userMessage: `Calendar error: ${e.message}` };
    }
  },
};

export const calendarBlock: Tool = {
  name: 'calendar.block',
  description: 'Create a focus block on your calendar starting now',
  schema: z.object({ hours: z.number().positive().default(2), label: z.string().default('Focus Block') }),
  availableOffline: false,
  execute: async (args, ctx) => {
    if (!isConfigured(ctx.config)) return { ok: false, error: 'not-configured', userMessage: "Google Calendar not connected." };
    try {
      const token = await getAccessToken(ctx.config);
      const start = new Date().toISOString();
      const end = new Date(Date.now() + args.hours * 3600_000).toISOString();
      await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: args.label, start: { dateTime: start }, end: { dateTime: end } }),
      });
      return { ok: true, summary: `Blocked ${args.hours}h as "${args.label}" on your calendar.` };
    } catch (e: any) {
      return { ok: false, error: e.message, userMessage: `Calendar error: ${e.message}` };
    }
  },
};
```

Register in `src/main/tools/registry.ts`:
```typescript
import { calendarToday, calendarNext, calendarBlock } from './calendar';
registerTool(calendarToday);
registerTool(calendarNext);
registerTool(calendarBlock);
```

- [ ] **Step 4: Run — expect PASS**

```bash
npx jest tests/main/tools/calendar.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/main/tools/calendar/ tests/main/tools/calendar.test.ts src/main/tools/registry.ts
git commit -m "feat: Google Calendar tools (today/next/block)"
```

---

## Task 3: Gmail tools

**Files:**
- Create: `src/main/tools/email/index.ts`
- Test: `tests/main/tools/email.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { emailCompose, emailSend, emailUnread, resetPendingDraft } from '../../../src/main/tools/email';
import * as google from '../../../src/main/integrations/google';

jest.spyOn(google, 'getAccessToken').mockResolvedValue('tok');
jest.spyOn(google, 'isConfigured').mockReturnValue(true);
const mockFetch = jest.fn();
global.fetch = mockFetch;

const ctx = {
  config: {} as any,
  speak: jest.fn(), setMood: jest.fn(), setActivity: jest.fn(),
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
};

beforeEach(() => { mockFetch.mockReset(); resetPendingDraft(); });

it('compose shows draft but does NOT call Gmail API', async () => {
  const result = await emailCompose.execute({ to: 'bob@example.com', subject: 'Hi', body: 'Hello!' }, ctx);
  expect(result.ok).toBe(true);
  expect(result.summary).toContain('bob@example.com');
  expect(result.summary).toContain('send it');
  expect(mockFetch).not.toHaveBeenCalled();
});

it('send without prior compose returns error', async () => {
  const result = await emailSend.execute({}, ctx);
  expect(result.ok).toBe(false);
  expect(result.userMessage).toContain('No draft pending');
});

it('send after compose calls Gmail API', async () => {
  mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
  await emailCompose.execute({ to: 'bob@example.com', subject: 'Hi', body: 'Hello!' }, ctx);
  const result = await emailSend.execute({}, ctx);
  expect(result.ok).toBe(true);
  expect(mockFetch).toHaveBeenCalledWith(
    expect.stringContaining('messages/send'),
    expect.objectContaining({ method: 'POST' })
  );
});

it('unread returns not-configured when google missing', async () => {
  jest.spyOn(google, 'isConfigured').mockReturnValueOnce(false);
  const result = await emailUnread.execute({ maxResults: 3 }, ctx);
  expect(result.ok).toBe(false);
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx jest tests/main/tools/email.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// src/main/tools/email/index.ts
import { z } from 'zod';
import { getAccessToken, isConfigured } from '../../integrations/google';
import type { Tool, ToolContext } from '../../../shared/types';

let pendingDraft: { raw: string; to: string; subject: string } | null = null;
export function resetPendingDraft(): void { pendingDraft = null; } // for tests

async function gmailFetch(path: string, token: string, opts?: RequestInit): Promise<any> {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Gmail ${res.status}: ${await res.text()}`);
  return res.json();
}

export const emailUnread: Tool = {
  name: 'email.unread',
  description: 'Check unread emails — returns subjects and senders',
  schema: z.object({ maxResults: z.number().default(5) }),
  availableOffline: false,
  execute: async (args, ctx) => {
    if (!isConfigured(ctx.config)) return { ok: false, error: 'not-configured', userMessage: "Gmail not connected. Go to Settings → Integrations." };
    try {
      const token = await getAccessToken(ctx.config);
      const list = await gmailFetch(`/messages?labelIds=UNREAD&maxResults=${args.maxResults}`, token);
      if (!list.messages?.length) return { ok: true, summary: 'No unread emails.' };
      const details = await Promise.all(list.messages.map((m: any) =>
        gmailFetch(`/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`, token)
      ));
      const lines = details.map((d: any, i: number) => {
        const subject = d.payload.headers.find((h: any) => h.name === 'Subject')?.value ?? '(no subject)';
        const from = d.payload.headers.find((h: any) => h.name === 'From')?.value ?? 'Unknown';
        return `${i + 1}. ${subject} — ${from}`;
      });
      return { ok: true, summary: `${lines.length} unread:\n${lines.join('\n')}` };
    } catch (e: any) {
      return { ok: false, error: e.message, userMessage: `Email error: ${e.message}` };
    }
  },
};

export const emailCompose: Tool = {
  name: 'email.compose',
  description: 'Draft an email for review before sending — always shows draft first',
  schema: z.object({ to: z.string(), subject: z.string(), body: z.string() }),
  availableOffline: true,
  execute: async (args, _ctx) => {
    const raw = `To: ${args.to}\nSubject: ${args.subject}\nContent-Type: text/plain\n\n${args.body}`;
    pendingDraft = { raw, to: args.to, subject: args.subject };
    return {
      ok: true,
      summary: `Draft ready:\nTo: ${args.to}\nSubject: ${args.subject}\n\n${args.body}\n\nSay "send it" to send.`,
    };
  },
};

export const emailSend: Tool = {
  name: 'email.send',
  description: 'Send the pending draft created by email.compose',
  schema: z.object({}),
  availableOffline: false,
  execute: async (_args, ctx) => {
    if (!pendingDraft) return { ok: false, error: 'no-draft', userMessage: "No draft pending. Use email.compose first." };
    try {
      const token = await getAccessToken(ctx.config);
      const encoded = Buffer.from(pendingDraft.raw).toString('base64url');
      await gmailFetch('/messages/send', token, {
        method: 'POST',
        body: JSON.stringify({ raw: encoded }),
      });
      const to = pendingDraft.to;
      pendingDraft = null;
      ctx.setMood('happy', 2000);
      return { ok: true, summary: `Email sent to ${to}.` };
    } catch (e: any) {
      return { ok: false, error: e.message, userMessage: `Failed to send: ${e.message}` };
    }
  },
};

export const emailRead: Tool = {
  name: 'email.read',
  description: 'Read and summarize an email thread by ID or search query',
  schema: z.object({ threadId: z.string() }),
  availableOffline: false,
  execute: async (args, ctx) => {
    if (!isConfigured(ctx.config)) return { ok: false, error: 'not-configured', userMessage: "Gmail not connected." };
    try {
      const token = await getAccessToken(ctx.config);
      const thread = await gmailFetch(`/threads/${args.threadId}?format=full`, token);
      // Extract plain text from most recent message
      const msg = thread.messages[thread.messages.length - 1];
      let body = '';
      const findText = (part: any): void => {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          body += Buffer.from(part.body.data, 'base64').toString('utf8');
        }
        part.parts?.forEach(findText);
      };
      findText(msg.payload);
      // Strip quoted history
      body = body.split(/\nOn .+wrote:/)[0].trim().slice(0, 3000);
      // EMAIL BODY → LLM: only here, only on explicit user request
      const { providerRegistry } = await import('../../ai/providers/registry');
      const provider = providerRegistry.getActiveProvider(ctx.config);
      const summary = await provider.chat({
        system: 'You are a concise assistant.',
        messages: [{ role: 'user', content: `Summarize this email in 3-5 sentences:\n\n${body}` }],
      });
      ctx.speak(summary.text);
      return { ok: true, summary: summary.text };
    } catch (e: any) {
      return { ok: false, error: e.message, userMessage: `Could not read email: ${e.message}` };
    }
  },
};
```

Register all 4 tools in `tools/registry.ts`.

- [ ] **Step 4: Run — expect PASS**

```bash
npx jest tests/main/tools/email.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/main/tools/email/ tests/main/tools/email.test.ts
git commit -m "feat: Gmail tools (unread/compose/send/read)"
```

---

## Task 4: Google Chat DND

**Files:**
- Modify: `src/main/integrations/google.ts`
- Test: add to `tests/main/integrations/google.test.ts`

- [ ] **Step 1: Add test**

```typescript
it('setGoogleChatDND calls PATCH with correct body', async () => {
  mockFetch.mockResolvedValueOnce({ ok: true });
  const config = { integrations: { google: { accessToken: 'tok', refreshToken: 'r', expiresAt: Date.now() + 9999 }, googleChat: { enabled: true } } } as any;
  await setGoogleChatDND(true, config);
  expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('spaceNotificationSetting'), expect.objectContaining({ method: 'PATCH' }));
});

it('setGoogleChatDND does not throw on fetch error', async () => {
  mockFetch.mockRejectedValueOnce(new Error('Network error'));
  const config = { integrations: { google: { accessToken: 'tok', refreshToken: 'r', expiresAt: Date.now() + 9999 }, googleChat: { enabled: true } } } as any;
  await expect(setGoogleChatDND(true, config)).resolves.toBeUndefined();
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx jest tests/main/integrations/google.test.ts -t "setGoogleChatDND"
```

- [ ] **Step 3: Implement**

```typescript
// Add to src/main/integrations/google.ts
import { log } from '../core/log';

export async function setGoogleChatDND(enabled: boolean, config: Config): Promise<void> {
  if (!config.integrations.googleChat?.enabled || !isConfigured(config)) return;
  try {
    const token = await getAccessToken(config);
    await fetch('https://chat.googleapis.com/v1/users/me/spaceNotificationSetting', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mutedStatus: enabled ? 'MUTED' : 'UNMUTED' }),
    });
  } catch (e) {
    log.warn('Google Chat DND update failed:', (e as Error).message);
    // never rethrow — integration failure must never affect app stability
  }
}
```

Wire in `src/main/watchers/workSignalRunner.ts`:
```typescript
case 'deepWork':    setGoogleChatDND(true, ctx.config).catch(() => {}); break;
case 'deepWorkEnd': setGoogleChatDND(false, ctx.config).catch(() => {}); break;
```

- [ ] **Step 4: Run — expect PASS**

```bash
npx jest tests/main/integrations/google.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/main/integrations/google.ts
git commit -m "feat: Google Chat DND sync on deepWork/deepWorkEnd"
```

---

## Task 5: GitHub tools + polling watcher

**Files:**
- Create: `src/main/tools/github/index.ts`
- Create: `src/main/watchers/github/index.ts`
- Test: `tests/main/tools/github.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { githubPRs } from '../../../src/main/tools/github';

const mockFetch = jest.fn();
global.fetch = mockFetch;

const ctx = { config: { integrations: { github: { token: 'ghp_test' } } } as any, speak: jest.fn(), setMood: jest.fn(), setActivity: jest.fn(), log: { warn: jest.fn(), error: jest.fn(), info: jest.fn() } };

it('formats PRs with repo name and age', async () => {
  const threeDaysAgo = new Date(Date.now() - 3 * 86400_000).toISOString();
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ items: [
      { title: 'Fix auth bug', repository_url: 'https://api.github.com/repos/dev/myapp', created_at: threeDaysAgo }
    ]})
  });
  const result = await githubPRs.execute({}, ctx);
  expect(result.ok).toBe(true);
  expect(result.summary).toContain('dev/myapp');
  expect(result.summary).toContain('Fix auth bug');
  expect(result.summary).toContain('3d');
});

it('returns no-token message when GITHUB_TOKEN missing', async () => {
  const result = await githubPRs.execute({}, { ...ctx, config: { integrations: {} } as any });
  expect(result.ok).toBe(false);
  expect(result.userMessage).toContain('GITHUB_TOKEN');
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx jest tests/main/tools/github.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// src/main/tools/github/index.ts
import { z } from 'zod';
import type { Tool, ToolContext } from '../../../shared/types';

async function ghFetch(path: string, ctx: ToolContext): Promise<any> {
  const token = ctx.config.integrations.github?.token;
  if (!token) throw new Error('Set GITHUB_TOKEN in .env for GitHub integration.');
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  return res.json();
}

function ageLabel(isoDate: string): string {
  const days = Math.round((Date.now() - new Date(isoDate).getTime()) / 86400_000);
  return days === 0 ? 'today' : `${days}d ago`;
}

export const githubPRs: Tool = {
  name: 'github.prs',
  description: 'List open pull requests where your review is requested',
  schema: z.object({}),
  availableOffline: false,
  execute: async (_args, ctx) => {
    try {
      const data = await ghFetch('/search/issues?q=is:pr+is:open+review-requested:@me', ctx);
      if (!data.items?.length) return { ok: true, summary: 'No PRs waiting on your review.' };
      const lines = data.items.map((item: any) => {
        const repo = item.repository_url.split('/').slice(-2).join('/');
        return `• ${repo}: ${item.title} (${ageLabel(item.created_at)})`;
      });
      return { ok: true, summary: `${data.items.length} PR(s) need your review:\n${lines.join('\n')}` };
    } catch (e: any) {
      const msg = e.message.includes('GITHUB_TOKEN') ? 'Set GITHUB_TOKEN in .env for GitHub integration.' : `GitHub error: ${e.message}`;
      return { ok: false, error: e.message, userMessage: msg };
    }
  },
};

export const githubMentions: Tool = {
  name: 'github.mentions',
  description: 'Show unread GitHub @mentions in issues and PRs',
  schema: z.object({}),
  availableOffline: false,
  execute: async (_args, ctx) => {
    try {
      const data = await ghFetch('/notifications?participating=true', ctx);
      const mentions = data.filter((n: any) => n.reason === 'mention');
      if (!mentions.length) return { ok: true, summary: 'No unread mentions.' };
      const lines = mentions.slice(0, 5).map((n: any) => `• ${n.repository.name}: ${n.subject.title}`);
      return { ok: true, summary: `${mentions.length} mention(s):\n${lines.join('\n')}` };
    } catch (e: any) {
      return { ok: false, error: e.message, userMessage: `GitHub error: ${e.message}` };
    }
  },
};
```

```typescript
// src/main/watchers/github/index.ts
import type { Watcher, WatcherContext } from '../../../shared/types';
import { githubPRs } from '../../tools/github';
import { buildToolCtx } from '../registry';

export class GithubWatcher implements Watcher {
  readonly name = 'github';
  private interval?: NodeJS.Timeout;
  private lastCalloutAt = 0;

  start(ctx: WatcherContext): void {
    const pollMs = 15 * 60_000;
    this.interval = setInterval(async () => {
      if (!ctx.config.integrations.github?.token) return;
      try {
        const result = await githubPRs.execute({}, buildToolCtx(ctx));
        if (!result.ok) return;
        // Check for stale PRs (> 24h old)
        if (result.data && Array.isArray(result.data)) {
          const stale = (result.data as any[]).filter(pr =>
            Date.now() - new Date(pr.created_at).getTime() > 24 * 3600_000
          );
          if (stale.length > 0 && Date.now() - this.lastCalloutAt > 3600_000) {
            this.lastCalloutAt = Date.now();
            ctx.requestCallout(`${stale.length} PR${stale.length > 1 ? 's' : ''} waiting on your review since yesterday.`);
          }
        }
      } catch { /* silent */ }
    }, pollMs);
  }

  stop(): void { clearInterval(this.interval); }
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npx jest tests/main/tools/github.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/main/tools/github/ src/main/watchers/github/
git commit -m "feat: GitHub PR/mention tools and staleness watcher"
```

---

## Task 6: Weather tool

**Files:**
- Create: `src/main/tools/weather/index.ts`
- Test: `tests/main/tools/weather.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { weatherToday } from '../../../src/main/tools/weather';

const mockFetch = jest.fn();
global.fetch = mockFetch;

const ctx = {
  config: { location: { lat: 28.7, lng: 77.1, city: 'Delhi' } } as any,
  speak: jest.fn(), setMood: jest.fn(), setActivity: jest.fn(),
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
};

it('formats weather from Open-Meteo response', async () => {
  mockFetch.mockResolvedValueOnce({
    json: async () => ({
      current: { temperature_2m: 32, weathercode: 1, wind_speed_10m: 12 },
      daily: { temperature_2m_max: [36], temperature_2m_min: [27] },
    })
  });
  const result = await weatherToday.execute({ days: 1 }, ctx);
  expect(result.ok).toBe(true);
  expect(result.summary).toContain('32°C');
  expect(result.summary).toContain('Mainly clear');
  expect(result.summary).toContain('High 36°');
});

it('returns no-location message when location not set', async () => {
  const result = await weatherToday.execute({ days: 1 }, { ...ctx, config: {} as any });
  expect(result.ok).toBe(false);
  expect(result.userMessage).toContain('Settings');
});

it('uses cache within 30 min', async () => {
  // first call populates cache
  mockFetch.mockResolvedValueOnce({ json: async () => ({ current: { temperature_2m: 20, weathercode: 0, wind_speed_10m: 5 }, daily: { temperature_2m_max: [25], temperature_2m_min: [15] } }) });
  await weatherToday.execute({ days: 1 }, ctx);
  mockFetch.mockClear();
  await weatherToday.execute({ days: 1 }, ctx);
  expect(mockFetch).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx jest tests/main/tools/weather.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// src/main/tools/weather/index.ts
import { z } from 'zod';
import type { Tool } from '../../../shared/types';

const WMO: Record<number, string> = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Foggy', 48: 'Freezing fog', 51: 'Light drizzle', 61: 'Light rain',
  63: 'Rain', 65: 'Heavy rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow',
  80: 'Rain showers', 81: 'Heavy showers', 95: 'Thunderstorm',
};

let cache: { at: number; result: string } | null = null;

export const weatherToday: Tool = {
  name: 'weather.today',
  description: 'Get current weather and today\'s forecast',
  schema: z.object({ days: z.number().min(1).max(7).default(1) }),
  availableOffline: false,
  execute: async (args, ctx) => {
    if (cache && Date.now() - cache.at < 30 * 60_000) return { ok: true, summary: cache.result };
    if (!ctx.config.location) {
      return { ok: false, error: 'no-location', userMessage: 'Set your city in Settings → General first.' };
    }
    try {
      const { lat, lng } = ctx.config.location;
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
        `&current=temperature_2m,weathercode,wind_speed_10m` +
        `&daily=temperature_2m_max,temperature_2m_min&forecast_days=${args.days}&timezone=auto`;
      const res = await fetch(url);
      const d = await res.json() as any;
      const desc = WMO[d.current.weathercode as number] ?? 'Unknown conditions';
      const temp = Math.round(d.current.temperature_2m);
      const hi = Math.round(d.daily.temperature_2m_max[0]);
      const lo = Math.round(d.daily.temperature_2m_min[0]);
      const result = `${desc}, ${temp}°C. High ${hi}°, Low ${lo}°.`;
      cache = { at: Date.now(), result };
      return { ok: true, summary: result };
    } catch (e: any) {
      return { ok: false, error: e.message, userMessage: `Weather unavailable: ${e.message}` };
    }
  },
};
```

- [ ] **Step 4: Run — expect PASS**

```bash
npx jest tests/main/tools/weather.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/main/tools/weather/
git commit -m "feat: weather.today via Open-Meteo (no API key, 30min cache)"
```

---

## Task 7: Pomodoro tool

**Files:**
- Create: `src/main/tools/pomodoro/index.ts`
- Test: `tests/main/tools/pomodoro.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { pomodoroStart, pomodoroStop, resetPomodoroState } from '../../../src/main/tools/pomodoro';

jest.useFakeTimers();

const ctx = {
  config: {} as any, speak: jest.fn(), setMood: jest.fn(), setActivity: jest.fn(),
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
};

beforeEach(() => { jest.clearAllMocks(); resetPomodoroState(); });

it('starts and fires work-end after workMin', async () => {
  await pomodoroStart.execute({ workMin: 25, breakMin: 5, cycles: 2 }, ctx);
  expect(ctx.setActivity).toHaveBeenCalledWith(expect.objectContaining({ type: 'timer', label: expect.stringContaining('Work') }));
  jest.advanceTimersByTime(25 * 60_000);
  expect(ctx.speak).toHaveBeenCalledWith('Time to rest. Step away.');
  expect(ctx.setMood).toHaveBeenCalledWith('sleeping');
});

it('advances to cycle 2 after break', async () => {
  await pomodoroStart.execute({ workMin: 1, breakMin: 1, cycles: 2 }, ctx);
  jest.advanceTimersByTime(60_000); // work done
  jest.advanceTimersByTime(60_000); // break done
  expect(ctx.setActivity).toHaveBeenCalledWith(expect.objectContaining({ label: expect.stringContaining('2/2') }));
});

it('stop cancels session', async () => {
  await pomodoroStart.execute({ workMin: 25, breakMin: 5, cycles: 4 }, ctx);
  await pomodoroStop.execute({}, ctx);
  expect(ctx.setActivity).toHaveBeenLastCalledWith(null);
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx jest tests/main/tools/pomodoro.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// src/main/tools/pomodoro/index.ts
import { z } from 'zod';
import type { Tool, ToolContext } from '../../../shared/types';

type PomPhase = 'idle' | 'work' | 'break';
let phase: PomPhase = 'idle';
let cycle = 0;
let totalCycles = 0;
let activeTimer: NodeJS.Timeout | null = null;

export function resetPomodoroState(): void {
  if (activeTimer) clearTimeout(activeTimer);
  phase = 'idle'; cycle = 0; totalCycles = 0; activeTimer = null;
}

function startWork(workMin: number, breakMin: number, total: number, current: number, ctx: ToolContext): void {
  phase = 'work';
  cycle = current;
  ctx.setActivity({ type: 'timer', remainingSec: workMin * 60, label: `Pomodoro – Work (${current}/${total})` });
  activeTimer = setTimeout(() => {
    ctx.speak('Time to rest. Step away.');
    ctx.setMood('sleeping');
    phase = 'break';
    ctx.setActivity({ type: 'timer', remainingSec: breakMin * 60, label: 'Pomodoro – Break' });
    activeTimer = setTimeout(() => {
      if (current >= total) {
        ctx.speak('Pomodoro session complete. Well done.');
        ctx.setMood('happy', 3000);
        ctx.setActivity(null);
        phase = 'idle';
      } else {
        startWork(workMin, breakMin, total, current + 1, ctx);
      }
    }, breakMin * 60_000);
  }, workMin * 60_000);
}

export const pomodoroStart: Tool = {
  name: 'pomodoro.start',
  description: 'Start a Pomodoro session (default 25 min work / 5 min break × 4 cycles)',
  schema: z.object({ workMin: z.number().default(25), breakMin: z.number().default(5), cycles: z.number().default(4) }),
  availableOffline: true,
  execute: async (args, ctx) => {
    if (phase !== 'idle') return { ok: false, error: 'running', userMessage: "Pomodoro already running. Say 'stop pomodoro' to cancel." };
    totalCycles = args.cycles;
    startWork(args.workMin, args.breakMin, args.cycles, 1, ctx);
    return { ok: true, summary: `Pomodoro started: ${args.workMin}min work / ${args.breakMin}min break × ${args.cycles}` };
  },
};

export const pomodoroStop: Tool = {
  name: 'pomodoro.stop',
  description: 'Stop the current Pomodoro session',
  schema: z.object({}),
  availableOffline: true,
  execute: async (_args, ctx) => {
    if (phase === 'idle') return { ok: false, error: 'not-running', userMessage: 'No Pomodoro running.' };
    resetPomodoroState();
    ctx.setActivity(null);
    return { ok: true, summary: 'Pomodoro stopped.' };
  },
};
```

- [ ] **Step 4: Run — expect PASS**

```bash
npx jest tests/main/tools/pomodoro.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/main/tools/pomodoro/
git commit -m "feat: pomodoro.start/stop with work/break cycle management"
```

---

## Task 8: Reminders tool

**Files:**
- Create: `src/main/tools/reminders/index.ts`
- Test: `tests/main/tools/reminders.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { parseTime, reminderAdd } from '../../../src/main/tools/reminders';

describe('parseTime', () => {
  it('"in 30 minutes" → ~now + 30min', () => {
    const t = parseTime('in 30 minutes');
    expect(t).toBeGreaterThan(Date.now() + 29 * 60_000);
    expect(t).toBeLessThan(Date.now() + 31 * 60_000);
  });
  it('"in 2 hours" → ~now + 2h', () => {
    const t = parseTime('in 2 hours');
    expect(t).toBeGreaterThan(Date.now() + 119 * 60_000);
  });
  it('"tomorrow morning" → 9am tomorrow', () => {
    const t = parseTime('tomorrow morning');
    const d = new Date(t);
    expect(d.getHours()).toBe(9);
    expect(d.getDate()).toBe(new Date().getDate() + 1);
  });
  it('unknown format throws', () => {
    expect(() => parseTime('next blue moon')).toThrow();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx jest tests/main/tools/reminders.test.ts -t "parseTime"
```

- [ ] **Step 3: Implement**

```typescript
// src/main/tools/reminders/index.ts
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import type { Tool } from '../../../shared/types';

const REMINDERS_PATH = path.join(os.homedir(), '.pixel', 'reminders.json');

interface Reminder { id: string; text: string; fireAt: number; acknowledged: boolean; }

function load(): Reminder[] {
  try { return JSON.parse(fs.readFileSync(REMINDERS_PATH, 'utf8')); } catch { return []; }
}
function save(rs: Reminder[]): void {
  fs.mkdirSync(path.dirname(REMINDERS_PATH), { recursive: true });
  fs.writeFileSync(REMINDERS_PATH, JSON.stringify(rs, null, 2));
}

export function parseTime(input: string): number {
  const inMin = input.match(/in\s+(\d+)\s*min/i);
  if (inMin) return Date.now() + parseInt(inMin[1]) * 60_000;
  const inHr = input.match(/in\s+(\d+)\s*h/i);
  if (inHr) return Date.now() + parseInt(inHr[1]) * 3_600_000;
  const atTime = input.match(/at\s+(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (atTime) {
    let h = parseInt(atTime[1]), m = parseInt(atTime[2]);
    if (atTime[3]?.toLowerCase() === 'pm' && h < 12) h += 12;
    if (atTime[3]?.toLowerCase() === 'am' && h === 12) h = 0;
    const d = new Date(); d.setHours(h, m, 0, 0);
    if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  const tomorrow = input.match(/tomorrow(?:\s+(morning|afternoon|evening))?/i);
  if (tomorrow) {
    const hr = ({ morning: 9, afternoon: 14, evening: 18 } as Record<string, number>)[tomorrow[1]?.toLowerCase() ?? ''] ?? 9;
    const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(hr, 0, 0, 0);
    return d.getTime();
  }
  throw new Error(`Could not understand time: "${input}"`);
}

export const reminderAdd: Tool = {
  name: 'reminder.add',
  description: 'Set a reminder with natural language time (e.g. "in 30 minutes", "at 3pm", "tomorrow morning")',
  schema: z.object({ text: z.string(), time: z.string() }),
  availableOffline: true,
  execute: async (args, ctx) => {
    let fireAt: number;
    try { fireAt = parseTime(args.time); }
    catch (e: any) { return { ok: false, error: e.message, userMessage: e.message }; }
    const reminder: Reminder = { id: crypto.randomUUID(), text: args.text, fireAt, acknowledged: false };
    save([...load(), reminder]);
    const mins = Math.round((fireAt - Date.now()) / 60_000);
    return { ok: true, summary: `Reminder set for ${mins} min: "${args.text}"` };
  },
};

export const reminderList: Tool = {
  name: 'reminder.list',
  description: 'List upcoming reminders',
  schema: z.object({}),
  availableOffline: true,
  execute: async () => {
    const rs = load().filter(r => !r.acknowledged && r.fireAt > Date.now())
      .sort((a, b) => a.fireAt - b.fireAt);
    if (!rs.length) return { ok: true, summary: 'No upcoming reminders.' };
    const lines = rs.map((r, i) => {
      const mins = Math.round((r.fireAt - Date.now()) / 60_000);
      return `${i + 1}. "${r.text}" — in ${mins} min`;
    });
    return { ok: true, summary: lines.join('\n') };
  },
};

export const reminderRemove: Tool = {
  name: 'reminder.remove',
  description: 'Cancel a reminder by number from reminder.list',
  schema: z.object({ index: z.number().positive() }),
  availableOffline: true,
  execute: async (args) => {
    const rs = load().filter(r => !r.acknowledged && r.fireAt > Date.now())
      .sort((a, b) => a.fireAt - b.fireAt);
    const target = rs[args.index - 1];
    if (!target) return { ok: false, error: 'not-found', userMessage: `No reminder #${args.index}.` };
    const all = load().filter(r => r.id !== target.id);
    save(all);
    return { ok: true, summary: `Cancelled: "${target.text}"` };
  },
};

// Checker — called from main/index.ts on setInterval(60_000)
let lastFiredId: string | null = null;
let lastFiredAt = 0;
export function checkReminders(speak: (t: string) => void, sendChat: (t: string) => void): void {
  const now = Date.now();
  const rs = load();
  const due = rs.filter(r => !r.acknowledged && r.fireAt <= now);
  for (const r of due) {
    speak(r.text);
    sendChat(r.text);
    lastFiredId = r.id;
    lastFiredAt = now;
  }
}
export function acknowledgeLastReminder(): void {
  if (!lastFiredId || Date.now() - lastFiredAt > 5 * 60_000) return;
  const rs = load().map(r => r.id === lastFiredId ? { ...r, acknowledged: true } : r);
  save(rs);
  lastFiredId = null;
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npx jest tests/main/tools/reminders.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/main/tools/reminders/
git commit -m "feat: reminder.add/list/remove with natural language time parsing"
```

---

## Task 9: Tasks tool

**Files:**
- Create: `src/main/tools/tasks/index.ts`
- Test: `tests/main/tools/tasks.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { taskAdd, taskComplete, taskList, getOpenTaskCount, resetTasksPath } from '../../../src/main/tools/tasks';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

const TEST_PATH = path.join(os.tmpdir(), 'test-tasks.json');
beforeEach(() => { fs.writeFileSync(TEST_PATH, '[]'); resetTasksPath(TEST_PATH); });
afterAll(() => { try { fs.unlinkSync(TEST_PATH); } catch {} });

const ctx = { config: {} as any, speak: jest.fn(), setMood: jest.fn(), setActivity: jest.fn(), log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } };

it('add and list tasks', async () => {
  await taskAdd.execute({ text: 'Write tests', priority: 'high' }, ctx);
  await taskAdd.execute({ text: 'Deploy to prod', priority: 'low' }, ctx);
  const result = await taskList.execute({}, ctx);
  expect(result.summary).toContain('Write tests');
  expect(result.summary).toContain('Deploy to prod');
});

it('complete by fuzzy text', async () => {
  await taskAdd.execute({ text: 'Refactor auth service', priority: 'medium' }, ctx);
  const result = await taskComplete.execute({ query: 'auth' }, ctx);
  expect(result.ok).toBe(true);
  expect(ctx.setMood).toHaveBeenCalledWith('happy', 2000);
  const list = await taskList.execute({}, ctx);
  expect(list.summary).not.toContain('auth');
});

it('getOpenTaskCount returns correct count', async () => {
  await taskAdd.execute({ text: 'Task A', priority: 'medium' }, ctx);
  await taskAdd.execute({ text: 'Task B', priority: 'medium' }, ctx);
  expect(getOpenTaskCount()).toBe(2);
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx jest tests/main/tools/tasks.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// src/main/tools/tasks/index.ts
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import type { Tool } from '../../../shared/types';

interface Task { id: string; text: string; priority: 'low'|'medium'|'high'; createdAt: number; completedAt?: number; }

let TASKS_PATH = path.join(os.homedir(), '.pixel', 'tasks.json');
export function resetTasksPath(p: string): void { TASKS_PATH = p; }

function load(): Task[] {
  try { return JSON.parse(fs.readFileSync(TASKS_PATH, 'utf8')); } catch { return []; }
}
function save(tasks: Task[]): void {
  fs.mkdirSync(path.dirname(TASKS_PATH), { recursive: true });
  fs.writeFileSync(TASKS_PATH, JSON.stringify(tasks, null, 2));
}

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

export function getOpenTaskCount(): number {
  return load().filter(t => !t.completedAt).length;
}

export const taskAdd: Tool = {
  name: 'task.add',
  description: 'Add a task to your local task list',
  schema: z.object({ text: z.string(), priority: z.enum(['low','medium','high']).default('medium') }),
  availableOffline: true,
  execute: async (args, _ctx) => {
    const task: Task = { id: crypto.randomUUID(), text: args.text, priority: args.priority, createdAt: Date.now() };
    save([...load(), task]);
    return { ok: true, summary: `Task added: "${args.text}"` };
  },
};

export const taskList: Tool = {
  name: 'task.list',
  description: 'List open tasks sorted by priority',
  schema: z.object({ filter: z.string().optional() }),
  availableOffline: true,
  execute: async (args, _ctx) => {
    let tasks = load().filter(t => !t.completedAt);
    if (args.filter) tasks = tasks.filter(t => t.text.toLowerCase().includes(args.filter!.toLowerCase()));
    if (!tasks.length) return { ok: true, summary: 'No open tasks.' };
    tasks.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
    const lines = tasks.map((t, i) => `${i + 1}. [${t.priority}] ${t.text}`);
    return { ok: true, summary: lines.join('\n') };
  },
};

export const taskComplete: Tool = {
  name: 'task.complete',
  description: 'Mark a task as done by fuzzy text match',
  schema: z.object({ query: z.string() }),
  availableOffline: true,
  execute: async (args, ctx) => {
    const tasks = load();
    const target = tasks.find(t => !t.completedAt && t.text.toLowerCase().includes(args.query.toLowerCase()));
    if (!target) return { ok: false, error: 'not-found', userMessage: `No open task matching "${args.query}".` };
    target.completedAt = Date.now();
    save(tasks);
    ctx.setMood('happy', 2000);
    ctx.speak('Done!');
    return { ok: true, summary: `Completed: "${target.text}"` };
  },
};

export const taskRemove: Tool = {
  name: 'task.remove',
  description: 'Delete a task by fuzzy text match',
  schema: z.object({ query: z.string() }),
  availableOffline: true,
  execute: async (args, _ctx) => {
    const tasks = load();
    const idx = tasks.findIndex(t => t.text.toLowerCase().includes(args.query.toLowerCase()));
    if (idx === -1) return { ok: false, error: 'not-found', userMessage: `No task matching "${args.query}".` };
    const removed = tasks.splice(idx, 1)[0];
    save(tasks);
    return { ok: true, summary: `Removed: "${removed.text}"` };
  },
};
```

- [ ] **Step 4: Run — expect PASS**

```bash
npx jest tests/main/tools/tasks.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/main/tools/tasks/
git commit -m "feat: task.add/list/complete/remove with fuzzy matching"
```

---

## Task 10: Water reminder watcher

**Files:**
- Create: `src/main/watchers/water/index.ts`
- Test: `tests/main/watchers/water.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { WaterWatcher } from '../../../src/main/watchers/water';

jest.useFakeTimers();

const ctx = {
  config: { personality: 'coach' } as any,
  setMood: jest.fn(), requestCallout: jest.fn(), setActivity: jest.fn(),
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
};

it('fires callout after 90 active minutes', () => {
  const watcher = new WaterWatcher();
  watcher.start(ctx);
  watcher.simulateCadence('steady'); // expose for testing
  jest.advanceTimersByTime(90 * 60_000);
  expect(ctx.requestCallout).toHaveBeenCalledTimes(1);
  watcher.stop();
});

it('resets active time on 10+ min idle', () => {
  const watcher = new WaterWatcher();
  watcher.start(ctx);
  watcher.simulateCadence('steady');
  jest.advanceTimersByTime(50 * 60_000);
  watcher.simulateCadence('none');
  jest.advanceTimersByTime(11 * 60_000); // 10+ min idle = reset
  watcher.simulateCadence('steady');
  jest.advanceTimersByTime(50 * 60_000); // only 50 active min since reset
  expect(ctx.requestCallout).not.toHaveBeenCalled();
  watcher.stop();
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx jest tests/main/watchers/water.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// src/main/watchers/water/index.ts
import type { Watcher, WatcherContext } from '../../../shared/types';
import { getCalloutSet, pickCallout } from '../callouts';

export class WaterWatcher implements Watcher {
  readonly name = 'water';
  private activeMinutes = 0;
  private idleMinutes = 0;
  private lastCadence: 'none' | 'sporadic' | 'steady' = 'none';
  private interval?: NodeJS.Timeout;
  private lastCalloutAt = 0;

  start(ctx: WatcherContext): void {
    this.interval = setInterval(() => {
      if (this.lastCadence !== 'none') {
        this.activeMinutes++;
        this.idleMinutes = 0;
      } else {
        this.idleMinutes++;
        if (this.idleMinutes >= 10) {
          this.activeMinutes = 0; // reset on real break
          this.idleMinutes = 0;
        }
      }
      if (this.activeMinutes >= 90 && Date.now() - this.lastCalloutAt > 90 * 60_000) {
        const text = pickCallout(getCalloutSet(ctx.config.personality).water);
        if (text) {
          ctx.requestCallout(text);
          this.lastCalloutAt = Date.now();
          this.activeMinutes = 0;
        }
      }
    }, 60_000);
  }

  stop(): void { clearInterval(this.interval); }

  // For testing only
  simulateCadence(cadence: 'none' | 'sporadic' | 'steady'): void {
    this.lastCadence = cadence;
  }

  onCadenceUpdate(cadence: 'none' | 'sporadic' | 'steady'): void {
    this.lastCadence = cadence;
  }
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npx jest tests/main/watchers/water.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/main/watchers/water/
git commit -m "feat: water reminder watcher (90 active-min trigger, resets on break)"
```

---

## Task 11: Daily distraction cap

**Files:**
- Modify: `src/main/watchers/focus/index.ts`
- Test: add to `tests/main/watchers/focus.test.ts`

- [ ] **Step 1: Add test**

```typescript
import { FocusWatcher } from '../../../src/main/watchers/focus';
// mock stats module to return controlled distraction minutes
jest.mock('../../../src/main/stats', () => ({
  getDailyDistractionMinutes: jest.fn().mockReturnValue(46),
  appendFocusSample: jest.fn(),
}));

it('fires 75% warning at 46 of 60 min cap', () => {
  const ctx = { config: { distractionCapMin: 60, personality: 'coach' } as any, requestCallout: jest.fn(), setMood: jest.fn(), setActivity: jest.fn(), log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } };
  const watcher = new FocusWatcher();
  watcher.checkDistractionCap(ctx);
  expect(ctx.requestCallout).toHaveBeenCalledWith(expect.stringContaining('46'));
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx jest tests/main/watchers/focus.test.ts -t "75% warning"
```

- [ ] **Step 3: Implement (add to FocusWatcher)**

```typescript
// Add to src/main/watchers/focus/index.ts
private warned75 = false;
private lastCapCallout = 0;
private lastCapDate = '';

checkDistractionCap(ctx: WatcherContext): void {
  const today = new Date().toISOString().slice(0, 10);
  if (this.lastCapDate !== today) { this.warned75 = false; this.lastCapDate = today; }
  const used = getDailyDistractionMinutes(today);
  const cap = ctx.config.distractionCapMin;
  if (!this.warned75 && used >= cap * 0.75) {
    this.warned75 = true;
    ctx.requestCallout(`${Math.round(used)} of your ${cap} allowed distraction minutes used today.`);
  }
  if (used >= cap && Date.now() - this.lastCapCallout > 30 * 60_000) {
    this.lastCapCallout = Date.now();
    ctx.requestCallout(`Daily distraction cap hit. Eyes forward.`);
  }
}
```

Call `this.checkDistractionCap(ctx)` inside the existing 30s poll loop.

- [ ] **Step 4: Run — expect PASS**

```bash
npx jest tests/main/watchers/focus.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/main/watchers/focus/index.ts
git commit -m "feat: daily distraction cap with 75% warning and 30min repeat"
```

---

## Task 12: Morning + evening briefings

**Files:**
- Create: `src/main/watchers/briefing/index.ts`
- Test: `tests/main/watchers/briefing.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { BriefingWatcher } from '../../../src/main/watchers/briefing';

jest.useFakeTimers();

const ctx = {
  config: { workHours: { start: '10:00', end: '19:00', days: [1,2,3,4,5] }, personality: 'coach', location: undefined, integrations: {} } as any,
  setMood: jest.fn(), requestCallout: jest.fn(), setActivity: jest.fn(),
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
};

it('fires morning brief exactly once at work start', () => {
  const watcher = new BriefingWatcher();
  const morningspy = jest.spyOn(watcher as any, 'morning').mockResolvedValue(undefined);
  watcher.start(ctx);
  // Simulate work hours start time match
  jest.setSystemTime(new Date('2026-06-04T10:00:00'));
  jest.advanceTimersByTime(60_000);
  expect(morningspy).toHaveBeenCalledTimes(1);
  // Advance another minute — should NOT fire again
  jest.advanceTimersByTime(60_000);
  expect(morningspy).toHaveBeenCalledTimes(1);
  watcher.stop();
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx jest tests/main/watchers/briefing.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// src/main/watchers/briefing/index.ts
import type { Watcher, WatcherContext } from '../../../shared/types';
import { getOpenTaskCount } from '../../tools/tasks';
import { getCalloutSet } from '../callouts';
import { readDailyStats } from '../../stats';

export class BriefingWatcher implements Watcher {
  readonly name = 'briefing';
  private lastMorning = '';
  private lastEvening = '';
  private interval?: NodeJS.Timeout;

  start(ctx: WatcherContext): void {
    this.interval = setInterval(() => {
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      const hhmm = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
      if (!ctx.config.workHours.days.includes(now.getDay())) return;
      if (hhmm === ctx.config.workHours.start && this.lastMorning !== today) {
        this.lastMorning = today;
        this.morning(ctx).catch(e => ctx.log.error('Morning brief error:', e));
      }
      if (hhmm === ctx.config.workHours.end && this.lastEvening !== today) {
        this.lastEvening = today;
        this.evening(ctx);
      }
    }, 60_000);
  }

  async morning(ctx: WatcherContext): Promise<void> {
    const parts: string[] = ['Good morning.'];
    const taskCount = getOpenTaskCount();
    if (taskCount > 0) parts.push(`${taskCount} task${taskCount !== 1 ? 's' : ''} open.`);
    // Weather and calendar sections added if tools are available and configured
    ctx.requestCallout(parts.join(' '));
  }

  evening(ctx: WatcherContext): void {
    const today = new Date().toISOString().slice(0, 10);
    const stats = readDailyStats(today);
    const focusH = ((stats.focusMinutes ?? 0) / 60).toFixed(1);
    const distractionM = stats.distractionMinutes ?? 0;
    const tasksDone = stats.tasksCompleted ?? 0;
    const callouts = { coach: `${focusH}h focused. ${tasksDone} tasks done. Good work.`, 'drill-sergeant': `${focusH}h of real work. ${distractionM}min wasted. ${tasksDone} tasks. Do better.`, therapist: `You focused for ${focusH}h today. How are you feeling about your progress?`, silent: '' };
    const text = callouts[ctx.config.personality] ?? callouts.coach;
    if (text) ctx.requestCallout(text);
  }

  // Expose for manual triggers ("give me my briefing", "how was my day")
  async triggerMorning(ctx: WatcherContext): Promise<void> { await this.morning(ctx); }
  triggerEvening(ctx: WatcherContext): void { this.evening(ctx); }

  stop(): void { clearInterval(this.interval); }
}
```

In `brain.ts`, before the LLM call add detection:
```typescript
if (/morning briefing|give me my briefing/i.test(text)) { briefingWatcher.triggerMorning(watcherCtx); return; }
if (/how was my day|evening recap/i.test(text)) { briefingWatcher.triggerEvening(watcherCtx); return; }
```

- [ ] **Step 4: Run — expect PASS**

```bash
npx jest tests/main/watchers/briefing.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/main/watchers/briefing/
git commit -m "feat: morning briefing and evening recap watchers"
```

---

## Task 13: Inbound webhook server + quick capture shortcut

**Files:**
- Create: `src/main/core/webhookServer.ts`
- Modify: `src/main/index.ts`
- Test: `tests/main/core/webhookServer.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { WebhookServer } from '../../../src/main/core/webhookServer';
import * as http from 'http';

const handlers = { onMood: jest.fn(), onSpeak: jest.fn(), onNotify: jest.fn() };
let server: WebhookServer;
const PORT = 57399;
const TOKEN = 'test-token';

beforeAll(() => { server = new WebhookServer(); server.start(PORT, TOKEN, handlers); });
afterAll(() => server.stop());

async function post(url: string, body: object, token = TOKEN): Promise<{ status: number; body: string }> {
  return new Promise(resolve => {
    const data = JSON.stringify(body);
    const req = http.request({ hostname: '127.0.0.1', port: PORT, path: url, method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => { let b = ''; res.on('data', d => b += d); res.on('end', () => resolve({ status: res.statusCode!, body: b })); });
    req.write(data); req.end();
  });
}

it('returns 401 on wrong token', async () => {
  const res = await post('/mood', { state: 'happy' }, 'wrong');
  expect(res.status).toBe(401);
});

it('returns 400 on invalid state', async () => {
  const res = await post('/mood', { state: 'flying' });
  expect(res.status).toBe(400);
  expect(res.body).toContain('idle');
});

it('calls onMood for valid state', async () => {
  const res = await post('/mood', { state: 'happy', durationMs: 2000 });
  expect(res.status).toBe(200);
  expect(handlers.onMood).toHaveBeenCalledWith('happy', 2000);
});

it('calls onSpeak for /speak', async () => {
  const res = await post('/speak', { text: 'Hello world' });
  expect(res.status).toBe(200);
  expect(handlers.onSpeak).toHaveBeenCalledWith('Hello world');
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx jest tests/main/core/webhookServer.test.ts
```

- [ ] **Step 3: Implement**

```typescript
// src/main/core/webhookServer.ts
import * as http from 'http';
import type { MoodState } from '../../shared/types';

const VALID_STATES: MoodState[] = ['idle','listening','thinking','speaking','happy','bored','annoyed','sleeping'];

export class WebhookServer {
  private server?: http.Server;

  start(port: number, bearerToken: string, handlers: {
    onMood: (state: MoodState, durationMs?: number) => void;
    onSpeak: (text: string) => void;
    onNotify: (text: string) => void;
  }): void {
    this.server = http.createServer((req, res) => {
      if (req.headers.authorization !== `Bearer ${bearerToken}`) {
        res.writeHead(401).end('Unauthorized'); return;
      }
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (req.method === 'POST' && req.url === '/mood') {
            if (!VALID_STATES.includes(data.state)) {
              res.writeHead(400).end(`Invalid state. Valid: ${VALID_STATES.join(', ')}`); return;
            }
            handlers.onMood(data.state as MoodState, data.durationMs);
            res.writeHead(200).end('OK');
          } else if (req.method === 'POST' && req.url === '/speak') {
            handlers.onSpeak(String(data.text ?? ''));
            res.writeHead(200).end('OK');
          } else if (req.method === 'POST' && req.url === '/notify') {
            handlers.onNotify(String(data.text ?? ''));
            res.writeHead(200).end('OK');
          } else {
            res.writeHead(404).end('Not found');
          }
        } catch { res.writeHead(400).end('Invalid JSON'); }
      });
    });
    this.server.listen(port, '127.0.0.1'); // NEVER bind to 0.0.0.0
  }

  stop(): void { this.server?.close(); }
}
```

Add to `src/main/index.ts`:
```typescript
import * as crypto from 'crypto';

// After store init — generate bearer token on first run
if (!store.get('integrations.webhook.bearerToken')) {
  store.set('integrations.webhook.bearerToken', crypto.randomUUID());
}

// Start webhook server if enabled
const webhookServer = new WebhookServer();
if (store.get('integrations.webhook.enabled')) {
  webhookServer.start(
    store.get('integrations.webhook.port') as number ?? 57321,
    store.get('integrations.webhook.bearerToken') as string,
    {
      onMood: (state, durationMs) => stateManager.setState(state, win, durationMs),
      onSpeak: (text) => speechQueue.enqueue(text),
      onNotify: (text) => win.webContents.send(IPC.CHAT_MESSAGE, { text, type: 'bot' }),
    }
  );
}

// Quick capture global shortcut
const shortcut = (store.get('quickCaptureShortcut') as string) ?? 'CommandOrControl+Shift+B';
globalShortcut.register(shortcut, () => {
  win.show();
  win.webContents.send('chat:captureMode', { active: true });
});

// In ipcMain.handle(IPC.CHAT_SUBMIT):
// if (data.captureOnly) {
//   await toolRegistry.execute('notes.capture', { text: data.text }, toolCtx);
//   win.webContents.send(IPC.CHAT_MESSAGE, { text: 'Captured.', type: 'bot' });
//   win.blur();
//   return;
// }
```

- [ ] **Step 4: Run — expect PASS**

```bash
npx jest tests/main/core/webhookServer.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/main/core/webhookServer.ts src/main/index.ts
git commit -m "feat: localhost webhook server (bearer auth) + quick-capture shortcut"
```

---

## Phase 7 acceptance criteria

- [ ] `npx jest tests/main/integrations/ tests/main/tools/ tests/main/watchers/ tests/main/core/webhookServer.test.ts` — all pass
- [ ] `npx tsc --noEmit` — zero errors
- [ ] "What's on my schedule today?" → calendar events listed and spoken (Google connected)
- [ ] "Remind me in 30 minutes to check the deploy" → reminder fires, persists until acknowledged
- [ ] "Add task: write release notes" → stored; "mark it done" → happy flash + "Done!"
- [ ] "Start a pomodoro" → 25/5 cycle, eyes sleeping during break, wakes on break end
- [ ] "What's the weather?" → Open-Meteo answer, no API key needed, cache on second call
- [ ] Morning briefing fires once at workHours.start, skips unconfigured sections
- [ ] Evening recap speaks personality-toned summary at workHours.end
- [ ] `curl -X POST http://localhost:57321/mood -H "Authorization: Bearer $(cat ~/.pixel/token)" -H "Content-Type: application/json" -d '{"state":"happy","durationMs":3000}'` → eyes go happy for 3s
- [ ] `curl` with wrong token → 401 response
- [ ] Email compose shows full draft in chat, no Gmail API call; send fires only after "send it"
- [ ] `CommandOrControl+Shift+B` captures note without invoking LLM
