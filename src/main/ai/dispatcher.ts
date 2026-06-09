import { executeTool, getTool } from '../tools/registry';
import type { ToolContext } from '../tools/types';

export interface ToolCall { name: string; args: unknown; }

// A tool name is `group.action`. The *shape* test is used for fenced blocks
// (where a dotted name almost certainly means a tool call); the *registry* test
// gates the riskier unfenced scan so we never strip ordinary prose or code that
// merely looks like a dotted call.
const TOOL_NAME_RE = /^[a-z][a-z0-9]*\.[a-z][a-z0-9]*$/i;
const isToolNameShape = (s: string): boolean => TOOL_NAME_RE.test(s.trim());
const isRegistered = (s: string): boolean => getTool(s.trim()) !== undefined;

function safeJson(s: string): unknown {
  const t = s.trim();
  if (!t) return undefined;
  try { return JSON.parse(t); } catch { return undefined; }
}

// Tools take an object of named args. Anything else (array, primitive, null)
// becomes an empty arg set — validation against the tool's zod schema happens in
// the registry, so a wrong shape surfaces as a clean error, never a crash.
function asArgs(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

// `{"name":"x","args":{...}}` (canonical) OR a flat `{"name":"x","level":50}`
// (some models inline the args) — both yield a clean { name, args }.
function jsonNameCall(o: Record<string, unknown>): ToolCall {
  const name = String(o.name).trim();
  if ('args' in o) return { name, args: asArgs(o.args) };
  const rest = { ...o };
  delete (rest as Record<string, unknown>).name;
  return { name, args: rest };
}

const INLINE_RE = /^([a-z][a-z0-9]*\.[a-z][a-z0-9]*)\s*\(?\s*(\{[\s\S]*\})?\s*\)?\s*;?$/i;
// `music.play {json}` / `music.play({json})` / bare `music.next`.
function parseInline(s: string, requireRegistered: boolean): ToolCall | null {
  const m = s.trim().match(INLINE_RE);
  if (!m) return null;
  const name = m[1];
  if (requireRegistered ? !isRegistered(name) : !isToolNameShape(name)) return null;
  if (m[2]) {
    const args = safeJson(m[2]);
    if (args === undefined) return null; // had a brace block but it was invalid JSON
    return { name, args: asArgs(args) };
  }
  return { name, args: {} };
}

// Parse one fenced block into a tool call, tolerating the shapes small models
// actually emit:
//   ```tool        {"name":"music.play","args":{...}}   canonical
//   ```json        {"name":"music.play","args":{...}}   any lang, name in body
//   ```music.play  {...args...}                          tool name as the fence lang
//   ```            music.play {...}                      tool name inline in body
//   ```music.play {...}```                               all on one line (→ in `info`)
// Returns null for ordinary code blocks so they're left untouched.
function parseFence(info: string, body: string): ToolCall | null {
  const lang = (info || '').trim();
  const raw = (body || '').trim();

  // Single-line fence: the whole call lands in the info string, body empty.
  if (!raw && lang && !isToolNameShape(lang)) {
    const inline = parseInline(lang, false);
    if (inline) return inline;
  }

  const j = safeJson(raw);
  if (j && typeof j === 'object' && typeof (j as { name?: unknown }).name === 'string'
      && isToolNameShape((j as { name: string }).name)) {
    return jsonNameCall(j as Record<string, unknown>);
  }

  if (isToolNameShape(lang)) return { name: lang, args: asArgs(j) };

  return parseInline(raw, false);
}

// Index just past the '}' matching the '{' at `open`, honoring strings/escapes.
function matchBrace(s: string, open: number): number {
  let depth = 0, inStr = false, esc = false;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i + 1;
  }
  return -1;
}

// Strip unfenced `tool.name {json}` occurrences. Registry-gated so prose like
// "use array.map {…}" survives untouched.
function stripUnfenced(text: string, calls: ToolCall[]): string {
  const NAME_RE = /([a-z][a-z0-9]*\.[a-z][a-z0-9]*)\s*\(?\s*\{/gi;
  let result = '', last = 0, m: RegExpExecArray | null;
  while ((m = NAME_RE.exec(text)) !== null) {
    if (!isRegistered(m[1])) continue;
    const braceStart = m.index + m[0].length - 1;
    const end = matchBrace(text, braceStart);
    if (end < 0) continue;
    const args = safeJson(text.slice(braceStart, end));
    if (args === undefined) continue;
    const tail = text.slice(end).match(/^\s*\)?\s*;?/);
    const e = end + (tail ? tail[0].length : 0);
    calls.push({ name: m[1], args: asArgs(args) });
    result += text.slice(last, m.index);
    last = e;
    NAME_RE.lastIndex = e;
  }
  return result + text.slice(last);
}

// Strip UNFENCED bare JSON tool objects: `{"name":"music.play","args":{...}}`.
// Some models (seen on groq llama-3.3-70b) emit the call as raw inline JSON with
// no ```tool fence AND no `tool.name {` prefix, so neither parseFence nor
// stripUnfenced catches it and it leaks into chat/speech. We scan balanced `{…}`
// objects and accept one only when its embedded `name` is a REGISTERED tool, so
// ordinary JSON in prose is left untouched.
function stripBareJsonCalls(text: string, calls: ToolCall[]): string {
  let result = '', last = 0, i = 0;
  while (i < text.length) {
    if (text[i] !== '{') { i++; continue; }
    const end = matchBrace(text, i);
    if (end < 0) break; // unbalanced from here on — stop scanning
    const j = safeJson(text.slice(i, end));
    if (j && typeof j === 'object' && !Array.isArray(j)
        && typeof (j as { name?: unknown }).name === 'string'
        && isRegistered((j as { name: string }).name)) {
      calls.push(jsonNameCall(j as Record<string, unknown>));
      result += text.slice(last, i);
      last = end;
    }
    i = end; // skip past this object either way (don't re-scan its inner braces)
  }
  return result + text.slice(last);
}

const FENCE_RE = /```([^\n`]*)\n?([\s\S]*?)```/g;

/** Extract every tool call from model output and return the text with those
 *  calls removed. Ordinary prose and non-tool code blocks pass through. */
export function extractToolCalls(text: string): { calls: ToolCall[]; text: string } {
  const calls: ToolCall[] = [];
  let out = text.replace(FENCE_RE, (whole, info: string, body: string) => {
    const call = parseFence(info, body);
    if (call) { calls.push(call); return ''; }
    return whole;
  });
  out = stripUnfenced(out, calls);
  out = stripBareJsonCalls(out, calls);
  out = out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { calls, text: out };
}

/** Back-compat / testing helper: just the calls. */
export function parseToolCalls(text: string): ToolCall[] {
  return extractToolCalls(text).calls;
}

export async function dispatch(text: string, ctx: ToolContext): Promise<string> {
  const { calls, text: cleaned } = extractToolCalls(text);
  if (!calls.length) return text; // nothing tool-like — return the reply untouched

  const results: string[] = [];
  for (const call of calls) {
    const result = await executeTool(call.name, call.args, ctx);
    results.push(result.ok ? result.summary : result.userMessage);
  }

  const reply = cleaned.trim();
  const tail = results.filter(Boolean).join('\n');
  return reply ? (tail ? `${reply}\n\n${tail}` : reply) : tail;
}
