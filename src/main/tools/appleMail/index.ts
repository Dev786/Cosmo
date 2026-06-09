import { z } from 'zod';
import { registerTool } from '../registry';
import { runScript, runScriptWithArgs, openApp, PermissionError } from '../../core/osascript';

// Read-only access to the Mac Mail app (Mail.app) via AppleScript — a LOCAL,
// no-OAuth alternative to the Gmail connector. Reads whatever accounts Mail is set
// up with (iCloud, a Gmail added to Mail, Exchange…), works OFFLINE (the mail is
// already synced to disk), and needs only macOS Automation permission, which the
// user grants on first use. Reads only; the one write-ish action is mail.open, which
// just brings the app to the front.
//
// `mail.unread` answers the everyday "any mail?" — the unread COUNT plus the most-recent
// UNREAD messages (sender + subject), flagging the important ones (⚑) so Cosmo can lead
// with what matters and summarise the rest, then offer to open Mail. The user-controlled
// search text for `mail.search` is passed via `on run argv` (runScriptWithArgs) so it can
// never inject AppleScript.

const CAP = 10; // how many recent unread we surface / max search matches
const TIMEOUT = 7000; // under the registry's 8s tool cap

// Reliability: querying the WHOLE inbox (e.g. `whose read status is false`) scans every
// message and times out (-1712) on a large or actively-syncing mailbox — the original
// "Cosmo can't read emails" bug. So we BOUND every Mail round-trip with `with timeout`,
// read the unread COUNT first (usually instant), then walk only the most-recent messages
// directly (`message i of inbox`), collecting the unread ones — never an eager whole-inbox
// filter. A genuine timeout returns the "ERR_BUSY" sentinel (Mail wedged/syncing); any other
// error (e.g. permission) propagates so failure() can give the right message.
const UNREAD = `tell application "Mail"
  set unreadN to -1
  try
    with timeout of 3 seconds
      set unreadN to unread count of inbox
    end timeout
  on error errMsg number errNum
    if errNum is -1712 then
      return "ERR_BUSY"
    else
      error errMsg number errNum
    end if
  end try
  set out to ""
  try
    with timeout of 3 seconds
      set shown to 0
      repeat with i from 1 to 60
        if shown > ${CAP - 1} then exit repeat
        set m to message i of inbox
        if (read status of m) is false then
          set mk to "U"
          if (flagged status of m) then set mk to "F"
          set out to out & mk & tab & (sender of m) & tab & (subject of m) & linefeed
          set shown to shown + 1
        end if
      end repeat
    end timeout
  on error
    -- timed out or ran past the last message: keep whatever we gathered so far
  end try
  return (unreadN as string) & linefeed & out
end tell`;

const SEARCH = `on run argv
  set q to item 1 of argv
  tell application "Mail"
    set out to ""
    try
      with timeout of 5 seconds
        set hits to (messages of inbox whose (subject contains q) or (sender contains q))
        set total to (count of hits)
        set shown to 0
        repeat with m in hits
          if shown > ${CAP - 1} then exit repeat
          set out to out & (sender of m) & tab & (subject of m) & linefeed
          set shown to shown + 1
        end repeat
        return (total as string) & linefeed & out
      end timeout
    on error errMsg number errNum
      if errNum is -1712 then
        return "ERR_BUSY"
      else
        error errMsg number errNum
      end if
    end try
  end tell
end run`;

// "Alex Rivera <alex@x.com>" → "Alex Rivera"; bare address → its local part.
function senderName(from: string): string {
  const m = from.match(/^\s*"?([^"<]+?)"?\s*</);
  if (m) return m[1].trim();
  return from.split('@')[0].replace(/[<>]/g, '').trim() || from;
}

// `mail.unread` output: "<unreadCount>\n<marker>\t<sender>\t<subject>\n…" where marker is
// F (flagged → important) or U (unread). Leads with the count, calls out any flagged mail,
// lists the recent unread for Cosmo to summarise, then offers to open Mail.
function formatUnread(raw: string): string {
  const lines = raw.split('\n');
  const unread = parseInt((lines[0] ?? '').trim(), 10) || 0;
  const records = lines.slice(1).filter((l) => l.length > 0).slice(0, CAP);
  if (unread === 0 && records.length === 0) return 'Inbox zero — no unread mail. ✨';
  const head = `${unread} unread message${unread === 1 ? '' : 's'}.`;
  if (records.length === 0) return head; // have a count but no recent unread reachable
  let flagged = 0;
  const list = records.map((r) => {
    const parts = r.split('\t');
    const mk = parts[0] ?? 'U';
    const sender = parts[1] ?? '';
    const subject = (parts[2] ?? '').trim() || '(no subject)';
    if (mk === 'F') flagged++;
    const dot = mk === 'F' ? '⚑ ' : '• ';
    return `${dot}${senderName(sender)} — ${subject}`;
  });
  const flagNote = flagged > 0 ? ` ${flagged} flagged ⚑.` : '';
  return `${head}${flagNote}\nMost recent unread:\n${list.join('\n')}\n\nWant me to open Mail so you can see them?`;
}

// `mail.search` output: "<totalMatches>\n<sender>\t<subject>\n…".
function formatSearch(raw: string, emptyMsg: string): string {
  const lines = raw.split('\n');
  const total = parseInt((lines[0] ?? '').trim(), 10) || 0;
  if (total === 0) return emptyMsg;
  const records = lines.slice(1).filter((l) => l.length > 0);
  const shown = records.slice(0, CAP).map((r) => {
    const t = r.indexOf('\t');
    const sender = t >= 0 ? r.slice(0, t) : r;
    const subject = (t >= 0 ? r.slice(t + 1) : '').trim() || '(no subject)';
    return `• ${senderName(sender)}: ${subject}`;
  });
  const more = total > shown.length ? `\n…and ${total - shown.length} more` : '';
  return `${total} message${total === 1 ? '' : 's'}:\n${shown.join('\n')}${more}`;
}

function failure(e: unknown): { ok: false; error: string; userMessage: string } {
  if (e instanceof PermissionError) {
    return { ok: false, error: 'permission', userMessage: 'I need permission to read Mail — turn on Cosmo under System Settings, Privacy and Security, Automation, then ask me again.' };
  }
  const msg = (e as Error).message;
  return { ok: false, error: msg, userMessage: `Couldn't reach Mail: ${msg}` };
}

// Mail answered too slowly (wedged or syncing a large mailbox) — the AppleScript hit
// its internal `with timeout` and returned the ERR_BUSY sentinel. Degrade gracefully.
function busy(): { ok: false; error: string; userMessage: string } {
  return { ok: false, error: 'mail-busy', userMessage: "Mail isn't answering — it's probably wedged or busy syncing a big mailbox. Quitting Mail (⌘Q) and reopening it usually clears it; then ask me again, or say “check my Gmail.”" };
}

export function registerAppleMailTools(): void {
  registerTool({
    name: 'mail.unread',
    description: 'Check the Mac Mail app — the unread count plus the most-recent unread messages, with flagged (⚑ important) ones surfaced so you can focus on and summarise what matters (read-only, works offline, all accounts). Use this for email unless the user explicitly says Gmail.',
    schema: z.object({}),
    availableOffline: true,
    async execute() {
      try {
        const raw = await runScript(UNREAD, TIMEOUT);
        if (raw.trim() === 'ERR_BUSY') return busy();
        return { ok: true, summary: formatUnread(raw) };
      } catch (e) {
        return failure(e);
      }
    },
  });

  registerTool({
    name: 'mail.search',
    description: 'Search the Mac Mail app by sender or subject text, e.g. "any mail from Acme?" (read-only). Use this for email unless the user explicitly says Gmail.',
    schema: z.object({ query: z.string().min(1) }),
    availableOffline: true,
    async execute(args: { query: string }) {
      try {
        const raw = await runScriptWithArgs(SEARCH, [args.query], TIMEOUT);
        if (raw.trim() === 'ERR_BUSY') return busy();
        return { ok: true, summary: formatSearch(raw, `No mail matching "${args.query}".`) };
      } catch (e) {
        return failure(e);
      }
    },
  });

  registerTool({
    name: 'mail.open',
    description: 'Open / bring the Mac Mail app to the front so the user can read their inbox. Use when the user agrees to open Mail (e.g. after checking unread).',
    schema: z.object({}),
    availableOffline: true,
    async execute() {
      try {
        await openApp('Mail');
        return { ok: true, summary: 'Opened Mail for you.' };
      } catch (e) {
        return { ok: false, error: (e as Error).message, userMessage: "I couldn't open Mail just now — try launching it yourself." };
      }
    },
  });
}
