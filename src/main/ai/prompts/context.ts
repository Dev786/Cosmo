import { getAllTools } from '../../tools/registry';
import { selectToolNames } from './toolSelect';
import { readSoul, readAgents, readUser, readMemory, readRecentDailyNotes } from '../workspace';
import { recall } from '../../memory/recall';
import { log } from '../../core/log';
import type { Config } from '../../../shared/types';
import type { PromptContext } from './types';

// Strip a markdown file's scaffolding — the H1 title and the `>` editor-note
// blockquotes we seed files with — leaving the substance for the prompt.
const stripScaffold = (body: string): string =>
  body.split('\n').filter((l) => { const t = l.trim(); return !(t.startsWith('# ') || t.startsWith('>')); }).join('\n').trim();

// A memory section, or '' when the file is effectively empty (only a header).
function section(title: string, body: string): string {
  const meat = stripScaffold(body);
  return meat ? `## ${title}\n${meat}` : '';
}

/** Build the model-agnostic data every prompt shares. This is DATA, not persona
 *  text: the tool list comes from the tool registry, memory from the memory
 *  store, and the time from the clock. Per-model prompt builders compose these.
 *
 *  `query` is the user's message for this turn. When provided, the tool list is
 *  gated down to the tools relevant to that query (progressive disclosure) so the
 *  model reasons over a shorter, sharper menu, AND long-term memory is retrieved
 *  semantically (top-k chunks relevant to the query) instead of dumped wholesale.
 *  Omit it to advertise every tool and inject all curated memory. */
export async function buildContext(config: Config, query?: string): Promise<PromptContext> {
  const name = config.botName ?? 'Cosmo';

  const all = getAllTools();

  // Tool gating runs only when the caller passes `query` (the small/local prompt
  // path; native/cloud models get the full toolset). Deterministic cascade: a keyword
  // hit narrows to core + the matched group(s); no hit shows everything (never hide on
  // an unclassified utterance). See toolSelect.ts.
  let tools = all;
  if (query !== undefined) {
    const surfaced = new Set(selectToolNames(query, all.map((t) => t.name)));
    tools = all.filter((t) => surfaced.has(t.name));
    log.debug(`Tool gating: surfaced ${tools.length}/${all.length} tools for this turn`);
  }

  const toolLines = tools.map(t => {
    const shape = (t.schema as import('zod').ZodObject<import('zod').ZodRawShape>)?.shape
      ? Object.keys((t.schema as import('zod').ZodObject<import('zod').ZodRawShape>).shape).join(', ')
      : '...';
    return `- ${t.name}: ${t.description} (args: {${shape}})`;
  }).join('\n');

  // Memory comes from the editable workspace. USER.md (durable identity facts) is
  // always injected verbatim — it's small and always relevant. For the larger,
  // growing memory (curated MEMORY.md + the daily-note archive) we retrieve only
  // the chunks SEMANTICALLY relevant to this turn's query, so the prompt stays
  // small as history grows. When there's no query, or the embedder isn't ready, we
  // fall back to dumping curated memory + recent notes verbatim (Phase A behavior).
  const now = new Date();
  const memoryParts = [section('About you', readUser())];

  let relevant: string[] = [];
  if (query) {
    try { relevant = await recall(query); } catch { relevant = []; }
  }
  if (relevant.length) {
    memoryParts.push(`## Relevant memories\n${relevant.join('\n\n')}`);
  } else {
    memoryParts.push(section('What I remember', readMemory()));
    memoryParts.push(section('Recent notes', readRecentDailyNotes(now)));
  }

  const memoryBlock = memoryParts.filter(Boolean).length
    ? `\n\n${memoryParts.filter(Boolean).join('\n\n')}`
    : '';

  // Give the model the LOCAL wall-clock time (not UTC) + the zone, and a local ISO
  // with NO 'Z'. Handing it `toISOString()` (UTC) made it reason in UTC and stamp a
  // trailing 'Z' on reminder times, which then shifted by the TZ offset (e.g. "5pm"
  // → 22:30 in IST). The tool also forces local interpretation as a backstop.
  const pad = (n: number): string => String(n).padStart(2, '0');
  const localISO = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time';
  const nowLine = `Current time: ${now.toLocaleString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })} (${tz}; local ISO ${localISO}).
When setting reminders, compute from the time above and give a LOCAL wall-clock time — NO "Z" and no timezone offset. Use inMinutes for relative ("in 20 minutes"), or atISO like "${localISO.slice(0, 11)}17:00" for absolute. A bare hour with no am/pm (e.g. "5") means the soonest upcoming time TODAY (afternoon "5" = 17:00 today); only roll to tomorrow if that time already passed.`;

  return { name, soul: stripScaffold(readSoul()), agents: stripScaffold(readAgents()), toolLines, memoryBlock, nowLine };
}
