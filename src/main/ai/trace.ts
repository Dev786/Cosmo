import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { log } from '../core/log';

// Tool-call eval / trace. One JSONL record per user turn lands in
// ~/.pixel/logs/tool-trace.jsonl so tool-selection quality is measurable over time
// — the 2026 agent-eval metrics: tool correctness, argument validity (a zod
// rejection = a bad-args call), and step efficiency. Lifetime counters give a
// one-line rolling health read in the normal app log. Tracing never throws into a
// turn: all I/O is best-effort.

const TRACE_PATH = path.join(os.homedir(), '.pixel', 'logs', 'tool-trace.jsonl');

// Tracing is a diagnostic — off by default. Opt in with PIXEL_TRACE=1 to get the
// per-turn JSONL trace file + the rolling "Tool trace: …" log line. The cheap
// in-memory aggregates below are always kept; only the disk write + log line are gated.
const TRACE_ENABLED = process.env.PIXEL_TRACE === '1';

export type CallKind = 'ok' | 'validation' | 'not-found' | 'timeout' | 'duplicate' | 'runtime';

interface CallRec { name: string; ok: boolean; ms: number; kind: CallKind; error?: string }

// Per-process lifetime aggregates (reset on restart) — a cheap "is tool use
// healthy?" signal without parsing the JSONL.
const agg = { turns: 0, toolTurns: 0, calls: 0, callFails: 0, duplicates: 0 };

function classify(ok: boolean, error?: string): CallKind {
  if (ok) return 'ok';
  switch (error) {
    case 'validation': return 'validation';
    case 'not-found': return 'not-found';
    case 'timeout': return 'timeout';
    case 'duplicate': return 'duplicate';
    default: return 'runtime';
  }
}

/** Records one user turn's ReAct activity, then writes a JSONL line + logs a
 *  rolling summary. Create one per turn; call recordTool per executed call and
 *  finish() exactly once (it's idempotent). */
export class TurnTrace {
  private calls: CallRec[] = [];
  private readonly started = Date.now();
  private done = false;
  constructor(private readonly query: string, private readonly model: string) {}

  recordTool(name: string, ok: boolean, ms: number, error?: string): void {
    this.calls.push({ name, ok, ms, kind: classify(ok, error), error });
  }

  finish(steps: number, finalOk: boolean): void {
    if (this.done) return;
    this.done = true;

    const fails = this.calls.filter((c) => !c.ok && c.kind !== 'duplicate').length;
    const dups = this.calls.filter((c) => c.kind === 'duplicate').length;
    agg.turns++;
    if (this.calls.length) agg.toolTurns++;
    agg.calls += this.calls.length;
    agg.callFails += fails;
    agg.duplicates += dups;

    if (!TRACE_ENABLED) return;   // diagnostic off → no JSONL write, no per-turn log line

    const rec = {
      t: new Date().toISOString(),
      model: this.model,
      query: this.query.slice(0, 200),
      steps,
      finalOk,
      ms: Date.now() - this.started,
      calls: this.calls,
    };
    try {
      fs.mkdirSync(path.dirname(TRACE_PATH), { recursive: true });
      fs.appendFileSync(TRACE_PATH, JSON.stringify(rec) + '\n', 'utf8');
    } catch { /* never let tracing crash a turn */ }

    const failPct = agg.calls ? Math.round((agg.callFails / agg.calls) * 100) : 0;
    const toolStr = this.calls.length
      ? this.calls.map((c) => `${c.name}${c.ok ? '✓' : `✗(${c.kind})`}`).join(',')
      : 'none';
    log.info(`Tool trace: ${steps} step(s) · tools=[${toolStr}] · ${rec.ms}ms · lifetime ${agg.calls} calls ${failPct}% fail, ${agg.duplicates} dup`);
  }
}

/** Aggregate tool-call health since process start (for a /trace command or tests). */
export function traceSummary(): { turns: number; toolTurns: number; calls: number; callFails: number; duplicates: number; failRate: number } {
  return { ...agg, failRate: agg.calls ? agg.callFails / agg.calls : 0 };
}
