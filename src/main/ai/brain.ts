import type { BrowserWindow } from 'electron';
import { getActiveProvider } from './providers/registry';
import { extractToolCalls } from './dispatcher';
import { executeTool, getAllTools } from '../tools/registry';
import { buildToolSpecs } from '../tools/toolSpec';
import { append, getMessages, getSummary } from './history';
import { maybeCompact } from './compact';
import { handleMemoryCommand } from './memory';
import { buildSystemPrompt } from './prompts/registry';
import { TurnTrace } from './trace';
import { speechQueue } from '../core/speechQueue';
import { RetryableError, ToolChoiceError, type LLMProvider, type ChatResponse } from './providers/types';
import { IPC, type Config, type MoodState, type ActivityState, type ChatMessage } from '../../shared/types';
import { log } from '../core/log';
import type { ToolContext } from '../tools/types';

// How many reason→act→observe rounds before we force a final answer. A small cap
// keeps cost/latency bounded and stops a confused small model from looping.
const MAX_REACT_STEPS = 4;
// Per-tool observation cap so a big result (web search) can't blow up the context.
const OBS_CAP = 1800;

// One tool execution + the loop's dup guard, shared by both the native and
// fenced paths. We never re-run an identical (tool,args) pair — hand back the
// prior result and nudge the model to answer. `fresh` is false for a repeat so
// the caller can detect a step that was nothing BUT repeats and stop spinning.
interface PendingCall { name: string; args: unknown; }
async function execCall(
  c: PendingCall,
  ctx: ToolContext,
  ran: Map<string, string>,
  trace: TurnTrace,
): Promise<{ obs: string; fresh: boolean }> {
  const key = `${c.name}(${JSON.stringify(c.args)})`;
  if (ran.has(key)) {
    trace.recordTool(c.name, false, 0, 'duplicate');
    return { obs: `${c.name} → (already ran this exact call — use the result above; don't repeat it)`.slice(0, OBS_CAP), fresh: false };
  }
  const t0 = Date.now();
  const r = await executeTool(c.name, c.args, ctx);
  trace.recordTool(c.name, r.ok, Date.now() - t0, r.ok ? undefined : r.error);
  const obs = `${c.name} → ${(r.ok ? r.summary : r.userMessage)}`.slice(0, OBS_CAP);
  ran.set(key, obs);
  return { obs, fresh: true };
}

// ReAct loop: the model reasons, optionally calls ONE tool, SEES the result, then
// reasons again — repeating until it answers without a tool (or we hit the step
// cap). This replaces the old single-shot flow, which couldn't chain tools
// (search → read), react to a result, or recover from a wrong first guess.
//
// Two transports, same loop. `native` providers (OpenAI et al.) call tools through
// the API and return structured `toolCalls`; the rest use the fenced-JSON protocol
// parsed out of plain text. The difference is contained to how a step's calls are
// obtained and how results are fed back (proper {role:'tool'} messages vs a
// synthetic "Tool results:" user turn) — everything else is shared.
//
// History stays clean: the intermediate think/act/observe turns live only in the
// local `working` array; only the final spoken reply is persisted by the caller.
// `onThinking` re-asserts the thinking animation before EVERY model round-trip so
// Cosmo visibly "works" through the whole wait, not just the first call.
async function runReAct(
  provider: LLMProvider,
  system: string,
  ctx: ToolContext,
  model: string | undefined,
  onThinking: () => void,
  query: string,
  native: boolean,
): Promise<string> {
  // Seed context with the compacted running memory (older turns folded by the
  // compactor) followed by the verbatim recent tail — never the full transcript.
  const summary = getSummary();
  const working: ChatMessage[] = summary
    ? [{ role: 'user', content: `(Context — summary of our earlier conversation: ${summary})` }, ...getMessages()]
    : [...getMessages()];
  let lastProse = '';
  const trace = new TurnTrace(query, model ?? provider.name);
  const ran = new Map<string, string>();   // "name(argsJSON)" -> observation

  // Native vendors learn the tools from the API `tools` field; fenced vendors from
  // the prompt. Built once per turn (the registry is the source of truth for both).
  let toolSpecs = native ? buildToolSpecs(getAllTools()) : undefined;
  let toolsDisabled = false;   // set once if the model botches a native call

  for (let step = 0; step < MAX_REACT_STEPS; step++) {
    onThinking();
    let res: ChatResponse;
    try {
      res = await provider.chat({ system, model, messages: working, maxTokens: 512, tools: toolSpecs });
    } catch (e) {
      // The model emitted a malformed native tool call and the provider rejected
      // the whole generation. Drop tools for the rest of this turn and redo the
      // step so the user still gets a plain spoken answer — never the raw error.
      if (e instanceof ToolChoiceError && toolSpecs && !toolsDisabled) {
        toolsDisabled = true;
        toolSpecs = undefined;
        log.info('Provider rejected a native tool call — retrying this turn tool-free.');
        step--;
        continue;
      }
      throw e;
    }

    // --- NATIVE function-calling: tool calls arrive as structured data ---
    if (native) {
      const calls = res.toolCalls ?? [];
      // Strip any tool JSON the model wrongly typed into its REPLY — that text is
      // spoken aloud, so a leaked ```tool``` block would be read out as gibberish.
      const prose = extractToolCalls(res.text).text;
      log.info(`ReAct step ${step + 1}/${MAX_REACT_STEPS}: ${calls.length ? `act → ${calls.map(c => c.name).join(', ')}` : 'final answer'} (native)`);
      if (!calls.length) { trace.finish(step + 1, true); return prose.trim() || res.text.trim(); }

      // Echo the assistant turn WITH its tool_calls, then one {role:'tool'} message
      // per call — the exact multi-turn shape OpenAI-compatible vendors require.
      working.push({
        role: 'assistant',
        content: res.text || '',
        tool_calls: calls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })),
      });
      let freshCalls = 0;
      for (const c of calls) {
        const { obs, fresh } = await execCall(c, ctx, ran, trace);
        if (fresh) freshCalls++;
        working.push({ role: 'tool', tool_call_id: c.id, content: obs });
      }
      if (prose) lastProse = prose.trim();
      if (freshCalls === 0) break;   // only repeats → it's spinning
      continue;
    }

    // --- FENCED-JSON: parse tool calls out of the model's plain text ---
    const { text: prose, calls } = extractToolCalls(res.text);
    log.info(`ReAct step ${step + 1}/${MAX_REACT_STEPS}: ${calls.length ? `act → ${calls.map(c => c.name).join(', ')}` : 'final answer'}`);
    if (!calls.length) { trace.finish(step + 1, true); return prose.trim() || res.text.trim(); }

    const observations: string[] = [];
    let freshCalls = 0;
    for (const c of calls) {
      const { obs, fresh } = await execCall(c, ctx, ran, trace);
      if (fresh) freshCalls++;
      observations.push(obs);
    }
    if (prose) lastProse = prose.trim();

    // Observe — feed the results back as a synthetic user turn so the next round
    // reasons over them (the fenced protocol has no {role:'tool'} message type).
    working.push({ role: 'assistant', content: res.text || '(called a tool)' });
    working.push({
      role: 'user',
      content:
        `Tool results:\n\n${observations.join('\n\n')}\n\n` +
        `If this answers my message, reply in ONE short spoken sentence — lead with the answer, ` +
        `no "I've"/"Sure", no URLs or numbers read out verbatim, no lists or markdown. ` +
        `If you still need another tool to answer, emit exactly one more tool block instead.`,
    });

    if (freshCalls === 0) break;   // whole step was repeats → stop, force an answer
  }

  // Hit the step cap (or detected a loop) — force a tool-free spoken answer. No
  // tools are passed, so a native model must answer in prose instead of calling.
  onThinking();
  try {
    const finalRes = await provider.chat({
      system,
      model,
      messages: [...working, { role: 'user', content: 'Answer now in ONE short spoken sentence. Do NOT call any tools.' }],
      maxTokens: 90,
    });
    const clean = extractToolCalls(finalRes.text).text.trim();
    if (clean) { trace.finish(MAX_REACT_STEPS + 1, true); return clean; }
  } catch (e) {
    log.debug('ReAct final summary failed:', (e as Error).message);
  }
  trace.finish(MAX_REACT_STEPS + 1, false);
  return lastProse || 'Done!';
}

export async function handleUserInput(
  text: string,
  win: BrowserWindow,
  config: Config,
  setMood: (s: MoodState, dur?: number) => void,
  setActivity: (a: ActivityState | null) => void,
): Promise<void> {
  // Morning/evening briefing shortcuts (Phase 7)
  if (/morning briefing|give me my briefing/i.test(text)) {
    win.webContents.send(IPC.CHAT_MESSAGE, { text: "Briefing feature coming in Phase 7!", type: 'bot' });
    return;
  }

  // Memory commands
  if (handleMemoryCommand(text)) {
    const reply = text.toLowerCase().includes('forget') ? "Done — memory cleared." : "Got it, I'll remember that.";
    win.webContents.send(IPC.CHAT_MESSAGE, { text: reply, type: 'bot' });
    return;
  }

  setMood('thinking');
  speechQueue.clear();
  append('user', text);

  const toolCtx: ToolContext = {
    config,
    speak: (t: string) => speechQueue.enqueue(t),
    setMood,
    setActivity,
    log,
  };

  const speakOrIdle = (reply: string): void => {
    win.webContents.send(IPC.CHAT_MESSAGE, { text: reply, type: 'bot' });
    // 'speaking' is NOT set here. It's driven by REAL audio start in index.ts
    // (speechQueue.onAudioActivity) so the talk animation begins with the sound,
    // not during the synth/network latency before it; it returns to idle on drain.
    if (speechQueue.isEnabled() && reply.trim()) {
      speechQueue.enqueue(reply);
    } else {
      setMood('idle');
    }
  };

  const onThinking = (): void => setMood('thinking');

  try {
    const provider = getActiveProvider(config);
    // Native-tool providers get the function-calling prompt (no fenced-JSON
    // instructions); the gating in buildSystemPrompt handles the rest. Gate the
    // advertised tool list only for the small-model fenced prompt.
    const native = provider.capabilities.nativeTools === true;
    const system = await buildSystemPrompt(config, text, native);
    const model = config.llm.model;
    log.info(`Calling ${provider.name} (${model})${native ? ' [native tools]' : ''}...`);
    const reply = await runReAct(provider, system, toolCtx, model, onThinking, text, native);
    append('assistant', reply);
    speakOrIdle(reply);
    // Fold older turns into the running summary for the NEXT turn (background, the
    // reply is already out — never blocks the user).
    void maybeCompact(provider, model).catch(() => { /* best-effort */ });
  } catch (e: unknown) {
    const err = e as Error;

    // Try fallback provider
    if (e instanceof RetryableError && config.llm.fallback?.length) {
      try {
        const fallbackName = config.llm.fallback[0];
        const { getProvider } = await import('./providers/registry');
        const fallback = getProvider(fallbackName);
        if (fallback) {
          // The fallback may use a different transport than the primary, so build
          // its prompt for ITS own native-ness (the primary's `system` is out of
          // scope here, and would be wrong if the two disagree).
          const fbNative = fallback.capabilities.nativeTools === true;
          const fbSystem = await buildSystemPrompt(config, text, fbNative);
          const reply = `(${fallbackName} answered): ${await runReAct(fallback, fbSystem, toolCtx, undefined, onThinking, text, fbNative)}`;
          append('assistant', reply);
          speakOrIdle(reply);
          return;
        }
      } catch { /* fallback also failed */ }
    }

    log.error('Brain error:', err.message);
    setMood('idle');
    win.webContents.send(IPC.CHAT_MESSAGE, { text: `Something went wrong: ${err.message}`, type: 'bot' });
  }
}
