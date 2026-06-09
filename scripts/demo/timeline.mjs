/* Single source of truth for the Cosmo demo: the ordered beats, their spoken
   lines (rendered to audio by gen-audio.mjs), the on-screen captions, and the
   action the Playwright harness performs to drive the REAL app for each beat.

   speaker: 'narrator' | 'user' | 'cosmo' | null  (null = caption only, no audio)
   action:
     {type:'mood',  value:'listening'|'thinking'|'speaking'|'happy'|'bored'|'annoyed'|'idle'|'sleeping'}
     {type:'submit', value:'<text typed into the app and really executed>'}
     {type:'none'}
   gap: seconds of hold added after the line's audio (reaction room).
*/
export const BEATS = [
  // ── intro: what Cosmo is ───────────────────────────────────────────────
  { id: 'hi',        kind: 'intro',  speaker: 'cosmo',
    text: "Hi — I'm Cosmo!",
    caption: "Hi — I'm Cosmo!",
    action: { type: 'mood', value: 'happy' }, gap: 0.5 },

  { id: 'intro',     kind: 'intro',  speaker: 'narrator',
    text: "Meet Cosmo: a tiny A.I. companion that lives on your desktop. Big expressive eyes, a voice you can talk to — and he actually gets things done. All local-first, right on your machine.",
    caption: "A tiny AI companion that lives on your desktop.",
    action: { type: 'mood', value: 'idle' }, gap: 0.6 },

  // ── voice: just talk to it ─────────────────────────────────────────────
  { id: 'q_weather', kind: 'dialogue', speaker: 'user',
    text: "Hey Cosmo, what's the weather looking like?",
    caption: "“Hey Cosmo — what's the weather looking like?”",
    action: { type: 'mood', value: 'listening' }, gap: 0.4 },

  { id: 'a_weather', kind: 'dialogue', speaker: 'cosmo',
    text: "It's sunny and twenty-four degrees — a good day to step outside!",
    caption: "Sunny and 24° — good day to step outside!",
    action: { type: 'submit', value: "What's the weather right now? Reply in one short, cheerful sentence." }, gap: 0.8 },

  // ── real work: web search → sources ────────────────────────────────────
  { id: 'q_search', kind: 'action', speaker: 'user',
    text: "Find me the best papers on large language models.",
    caption: "“Find me the best papers on large language models.”",
    action: { type: 'mood', value: 'listening' }, gap: 0.4 },

  { id: 'a_search', kind: 'action', speaker: 'cosmo',
    text: "Found some great ones on arXiv — they're in your Sources tab!",
    caption: "Found great ones on arXiv → your Sources tab.",
    action: { type: 'submit', value: "Search the web for the best papers on large language models." }, gap: 2.2 },

  // ── action: timer + reminder ───────────────────────────────────────────
  { id: 'q_timer', kind: 'action', speaker: 'user',
    text: "Start a twenty-five minute focus timer.",
    caption: "“Start a 25-minute focus timer.”",
    action: { type: 'mood', value: 'listening' }, gap: 0.4 },

  { id: 'a_timer', kind: 'action', speaker: 'cosmo',
    text: "Done — twenty-five minutes. Let's focus!",
    caption: "Done — 25 minutes. Let's focus!",
    action: { type: 'submit', value: "Start a 25 minute focus timer." }, gap: 1.6 },

  // ── memory ─────────────────────────────────────────────────────────────
  { id: 'q_mem', kind: 'dialogue', speaker: 'user',
    text: "Remember I take my coffee black.",
    caption: "“Remember I take my coffee black.”",
    action: { type: 'mood', value: 'listening' }, gap: 0.4 },

  { id: 'a_mem', kind: 'dialogue', speaker: 'cosmo',
    text: "Got it — black coffee. I'll remember that.",
    caption: "Got it — I'll remember. (stored locally)",
    action: { type: 'submit', value: "Remember that I take my coffee black." }, gap: 1.0 },

  // ── personality: gentle coaching ───────────────────────────────────────
  { id: 'coach_lbl', kind: 'coach', speaker: null,
    text: "", caption: "20 minutes later…",
    action: { type: 'mood', value: 'bored' }, gap: 1.4 },

  { id: 'coach', kind: 'coach', speaker: 'cosmo',
    text: "Psst… still scrolling?",
    caption: "Psst… still scrolling? — a nudge, not a lecture.",
    action: { type: 'mood', value: 'annoyed' }, gap: 1.2 },

  // ── trust montage ──────────────────────────────────────────────────────
  { id: 'trust1', kind: 'trust', speaker: null, text: "", caption: "On-device voice.",   action: { type: 'mood', value: 'idle' }, gap: 1.1 },
  { id: 'trust2', kind: 'trust', speaker: null, text: "", caption: "No keylogging.",      action: { type: 'none' }, gap: 1.1 },
  { id: 'trust3', kind: 'trust', speaker: null, text: "", caption: "No cloud vision.",    action: { type: 'none' }, gap: 1.1 },
  { id: 'trust4', kind: 'trust', speaker: null, text: "", caption: "Your model, your keys.", action: { type: 'none' }, gap: 1.2 },

  // ── CTA ────────────────────────────────────────────────────────────────
  { id: 'cta', kind: 'cta', speaker: 'cosmo',
    text: "Let's get to work — together!",
    caption: "Cosmo — your desktop buddy. Free & open source.",
    action: { type: 'mood', value: 'happy' }, gap: 1.8 },
];

// Per-speaker minimum beat length (so short lines still breathe).
const MIN = { narrator: 0, user: 1.6, cosmo: 1.8, null: 1.4 };

/** Build absolute schedule from measured audio durations {id: seconds}. */
export function schedule(durations) {
  let t = 0;
  return BEATS.map((b) => {
    const audio = durations[b.id] || 0;
    const len = Math.max(audio, MIN[b.speaker] ?? 1.2) + (b.gap || 0);
    const beat = { ...b, start: +t.toFixed(3), audioDur: +audio.toFixed(3), dur: +len.toFixed(3), end: +(t + len).toFixed(3) };
    t += len;
    return beat;
  });
}
