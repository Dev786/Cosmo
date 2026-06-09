import { getMessages, getSummary, compactInto } from './history';
import { appendDailyNote } from './workspace';
import type { LLMProvider } from './providers/types';
import { log } from '../core/log';

// Context compaction. We don't ship the full transcript every turn — once the
// verbatim tail grows past COMPACT_TRIGGER, fold the older half into a terse
// running memory via the LLM and keep only the last KEEP_RECENT turns raw. The
// summary then rides along as a single context message (see brain.ts), so long
// conversations stay cheap without amnesia.
//
// Best-effort & non-blocking: a failed/empty summarization leaves history
// untouched (the HARD_MAX backstop in history.ts still bounds growth).

const KEEP_RECENT = 8;       // verbatim recent messages always retained
const COMPACT_TRIGGER = 16;  // compact once the tail grows past this

export async function maybeCompact(provider: LLMProvider, model: string | undefined): Promise<void> {
  const msgs = getMessages();
  if (msgs.length <= COMPACT_TRIGGER) return;

  const keep = msgs.slice(-KEEP_RECENT);
  const older = msgs.slice(0, -KEEP_RECENT);
  const prev = getSummary();
  const transcript = older.map((m) => `${m.role}: ${m.content}`).join('\n');

  try {
    const res = await provider.chat({
      system:
        'You compress a chat log into a compact running memory for a desktop assistant. ' +
        "Keep only durable facts, the user's goals and preferences, decisions made, and open to-dos. " +
        'Write in the third person, terse, no preamble or fluff.',
      model,
      messages: [{
        role: 'user',
        content:
          `${prev ? `Current memory:\n${prev}\n\n` : ''}Fold in these newer messages:\n${transcript}\n\n` +
          'Return the updated memory as at most 120 words of plain text.',
      }],
      maxTokens: 220,
    });
    const summary = res.text.trim();
    if (summary) {
      compactInto(summary, keep);
      // Also persist the folded gist to today's workspace daily note, so memory
      // survives restarts (history's summary is per-conversation; daily notes are
      // the durable "what happened today" log the prompt re-reads next session).
      appendDailyNote(summary, new Date());
      log.info(`History compacted: folded ${older.length} msg(s) into summary, kept ${keep.length} verbatim.`);
    }
  } catch (e) {
    log.debug('History compaction skipped:', (e as Error).message);
  }
}
