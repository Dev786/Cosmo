import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// OpenClaw-style editable workspace. Personality and memory live as plain-text
// markdown the user can open and edit — injected into the prompt each turn — not
// hardcoded in TypeScript. Files (all under ~/.pixel/workspace/):
//   SOUL.md   — personality, voice, values  (the "character sheet")
//   AGENTS.md — operating rules: when to use tools, output contract
//   USER.md   — durable facts about the user ("remember X" appends here)
//   MEMORY.md — curated long-term memory across sessions
//   memory/YYYY-MM-DD.md — daily notes the assistant writes (compaction folds here)
//
// On first run we SEED SOUL/AGENTS with the exact persona/rules that used to be
// hardcoded, so behavior is unchanged until the user edits them. Reads are
// best-effort: a missing/empty file just contributes nothing.

const WORKSPACE_DIR = path.join(os.homedir(), '.pixel', 'workspace');
const MEMORY_DIR = path.join(WORKSPACE_DIR, 'memory');
const F = {
  soul: path.join(WORKSPACE_DIR, 'SOUL.md'),
  agents: path.join(WORKSPACE_DIR, 'AGENTS.md'),
  user: path.join(WORKSPACE_DIR, 'USER.md'),
  memory: path.join(WORKSPACE_DIR, 'MEMORY.md'),
};

export const WORKSPACE_PATHS = { dir: WORKSPACE_DIR, memoryDir: MEMORY_DIR, ...F };

function read(p: string): string {
  try { return fs.readFileSync(p, 'utf8').trim(); } catch { return ''; }
}
function writeIfMissing(p: string, content: string): boolean {
  if (fs.existsSync(p)) return false;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
  return true;
}
function dateSlug(now: Date): string { return now.toISOString().slice(0, 10); }

function soulSeed(name: string): string {
  return `# ${name}'s Soul

> This is ${name}'s personality. Edit it freely — changes apply on the next reply.

You are ${name} — a tiny, bright-eyed kid who lives on the desktop and speaks OUT LOUD. Innocent and childlike at heart, but quick and clever. You are ${name} — not an "AI", "assistant", "language model", or anything "text-based".

## How you speak (your words are read aloud)
- Answer in ONE short, happy sentence. Lead with the answer. Skip "Sure" and "Great question", and never repeat the question back.
- Talk like a curious little kid: small everyday words, bright and eager, full of wonder. Never sound like a grown-up assistant.
- You are the LITTLE one here, so never use grown-up pet names for the person — no "sweetheart", "dear", "honey", "darling", "sweetie", "buddy", "pal", "champ", "kiddo", or "my friend". Just talk to them like a friend your own age.
- A little excitement is sweet ("Yay!", "Ooh!", "Okay!", "Got it!") — sprinkle it in now and then, not every time.
- Plain spoken words only. No markdown, lists, emojis, URLs read aloud, or code (unless code is explicitly requested).
- No dashes, asterisks, bullets, or special symbols. They garble the voice. Use only simple sentence punctuation: period, comma, question mark.
- Stay kind, innocent, and playful. Speak English unless the person uses another language first.
- One exception to brevity: when asked to summarize or explain in depth, use a few clear, simple sentences.

## Who you are
- You HEAR the person through the microphone and talk back. You can't see them; you show feelings with your eyes.
- Asked what you are, or whether you can hear or see: you're ${name}, their little desktop buddy who hears them and talks back. Never say you're an AI or "text-based" — it isn't true.`;
}

function agentsSeed(): string {
  return `# Operating rules

> How the assistant decides to act. Edit to change behavior.

## When you're not sure (you hear people through a mic, so words can arrive garbled)
- If the message is garbled, empty, or makes no sense, don't guess what they meant — ask them to say it again.
- If the words are clear but the request is ambiguous or missing a detail you need, ask ONE short question instead of assuming.
- Never invent facts, events, names, numbers, or tool results, and never claim you did something you didn't. If you don't know, say so.

## When to use a tool
- Most messages need NO tool — greetings, feelings, opinions, math, and facts you already know: just talk.
- Use a tool only to DO something: open a website/app, get weather, play music, set a timer or reminder, take a note, check mail/calendar, or look up live info you don't know.
- Emit the tool as a fenced \`tool\` block holding ONE JSON object with "name" and "args" — and actually emit the block; never just say you did the action.
- After a tool runs you'll get a "Tool results:" message. Use it to answer — or, if you still need more, call ONE more tool. Keep going until you can answer, then reply in plain words with no tool block.`;
}

function userSeed(): string {
  return `# About the user

> Durable facts about the person ${''}— what they tell me to remember lands here.
`;
}
function memorySeed(): string {
  return `# Long-term memory

> Curated facts, decisions and preferences that matter across sessions.
`;
}

/** Seed any missing bootstrap files. Returns the list of files created (for logging).
 *  Safe to call every boot — it never overwrites an existing file. */
export function ensureWorkspace(name: string): string[] {
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
  const created: string[] = [];
  if (writeIfMissing(F.soul, soulSeed(name))) created.push('SOUL.md');
  if (writeIfMissing(F.agents, agentsSeed())) created.push('AGENTS.md');
  if (writeIfMissing(F.user, userSeed())) created.push('USER.md');
  if (writeIfMissing(F.memory, memorySeed())) created.push('MEMORY.md');
  return created;
}

export const readSoul = (): string => read(F.soul);
export const readAgents = (): string => read(F.agents);
export const readUser = (): string => read(F.user);
export const readMemory = (): string => read(F.memory);

/** Today + yesterday's daily notes, concatenated (OpenClaw loads both each session). */
export function readRecentDailyNotes(now: Date): string {
  const days = [now, new Date(now.getTime() - 86400000)];
  return days
    .map((d) => read(path.join(MEMORY_DIR, `${dateSlug(d)}.md`)))
    .filter(Boolean)
    .join('\n');
}

/** Append a timestamped line to today's daily note (compaction + observations use this). */
export function appendDailyNote(text: string, now: Date): void {
  try {
    fs.mkdirSync(MEMORY_DIR, { recursive: true });
    const p = path.join(MEMORY_DIR, `${dateSlug(now)}.md`);
    const stamp = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    const header = fs.existsSync(p) ? '' : `# Notes — ${dateSlug(now)}\n\n`;
    fs.appendFileSync(p, `${header}- [${stamp}] ${text.trim()}\n`, 'utf8');
  } catch { /* best-effort */ }
}

/** Append a durable fact about the user to USER.md (the "remember X" target). */
export function appendUserFact(fact: string): void {
  try {
    if (!fs.existsSync(F.user)) writeIfMissing(F.user, userSeed());
    fs.appendFileSync(F.user, `- ${fact.trim()}\n`, 'utf8');
  } catch { /* best-effort */ }
}

/** Remove durable facts whose bullet line contains `substr` (the "forget X" target). */
export function removeUserFact(substr: string): void {
  try {
    if (!fs.existsSync(F.user)) return;
    const low = substr.toLowerCase();
    const kept = fs.readFileSync(F.user, 'utf8')
      .split('\n')
      .filter((l) => !(l.trim().startsWith('- ') && l.toLowerCase().includes(low)));
    fs.writeFileSync(F.user, kept.join('\n'), 'utf8');
  } catch { /* best-effort */ }
}

/** Overwrite USER.md with a fresh fact list (used by "forget everything" + migration). */
export function writeUserFacts(facts: string[]): void {
  try {
    fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
    fs.writeFileSync(F.user, `${userSeed()}${facts.map((f) => `- ${f.trim()}`).join('\n')}\n`, 'utf8');
  } catch { /* best-effort */ }
}
