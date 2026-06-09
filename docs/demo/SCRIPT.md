# Cosmo — Demo Screenplay

> Goal: in 60 seconds, make a stranger want Cosmo on their desktop. Sell **presence**
> (a character that feels alive), **capability** (it actually does things), and
> **trust** (local-first, private). Cosmo's voice is childlike-but-smart, warm,
> curious, and *brief* — one short sentence, never "as an AI…".

## Production setup

| Thing | Value |
|---|---|
| Provider / model | Groq (fast, so "thinking" beats stay snappy) — whatever's configured live |
| Voice (TTS) | Local Kokoro, a warm voice (e.g. `af_heart`) — sells "on-device" |
| Backdrop | A clean, real-looking macOS desktop (calm wallpaper, a couple of app windows). Cosmo lives top-right. |
| Music | Warm, light, modern — low under VO, lifts on the CTA. (e.g. a soft lo-fi/marimba bed) |
| Captions | Bottom-center. User lines in quotes; Cosmo lines styled as his speech. Mono eyebrow labels for feature call-outs. |
| Format | 1080p, 16:9. **Hero cut ≈ 60s** for the website clip slot (`assets/media/cosmo-demo.mp4`). A **30s cut** below for socials. |
| Pace | Quick but never rushed. Let the eyes *react* a half-beat before each reply — that beat is the whole product. |

---

## The hero cut (~65s)

Opens by introducing **what Cosmo is**, then shows off the features in order.
Timecodes are targets; trim to the music. Each feature beat runs ~10s.

### 0:00–0:12 — Meet Cosmo · what it is
- **On screen:** the real desktop. Cosmo idle in the corner with a breathing-soft glow. He **blinks**, his eyes **follow the cursor**, then a little **happy bounce** + a ❤ as he greets you.
- **Cosmo (spoken):** "Hi — I'm Cosmo!"
- **Narrator (VO, warm):** "Meet Cosmo: a tiny AI companion that lives on your desktop. Big expressive eyes, a voice you can talk to — and he actually gets things done. All local-first, right on your machine."
- **Caption (mono):** `MEET COSMO · your desktop buddy`
- **Transition:** Cosmo perks up: "Here's what I can do." → features.
- **Why it sells:** the viewer learns *what Cosmo is* in one breath, while already feeling the character. Context + hook before any feature.

### 0:12–0:22 — Wake + ask · "you just talk to it"
- **User (spoken):** "Hey Cosmo — what's the weather looking like?"
- **Cosmo expression:** eyes **pop wide → listening** (head tilt, little sound-wave arcs), then **thinking** (pulsing dots, gaze drifts up).
- **Cosmo (spoken):** "Sunny and 24° — good day to step outside!"
- **Caption:** show the user's words appear as he hears them → `on-device speech · no audio leaves your Mac`
- **Why it sells:** zero typing, instant, and the privacy claim lands on the first interaction.

### 0:15–0:27 — Real work · web search → Sources
- **User (spoken):** "Find me the best papers on large language models."
- **Cosmo expression:** **listening → thinking**, with the **searching** activity ring spinning.
- **Cosmo (spoken):** "Found some great ones on arXiv — they're in your Sources tab!"
- **On screen:** the Sources panel slides in and fills with 3–4 real results.
- **Caption:** `searches the web · hands you the sources, not a wall of text`
- **Why it sells:** it's not a chatbot — it gets a job done and respects your attention.

### 0:27–0:37 — Action · timer + reminder
- **User (spoken):** "Start a 25-minute focus timer and remind me to stretch after."
- **Cosmo expression:** quick **happy** beat (eye-smile + ❤), then the **timer overlay** appears counting down.
- **Cosmo (spoken):** "Done — 25 minutes, and I'll nudge you to stretch!"
- **Caption:** `timers · reminders · notes · open apps — a real tool system`
- **Why it sells:** concrete, everyday usefulness, shown not told.

### 0:37–0:45 — Memory · it remembers you
- **User (spoken):** "Remember I take my coffee black."
- **Cosmo expression:** **giggle** (blush up, little ❤ floats).
- **Cosmo (spoken):** "Got it — black coffee. I'll remember that."
- **On screen (subtle):** a line writes into his memory / the Obsidian vault file.
- **Caption:** `remembers what matters · stored locally, in Markdown you own`
- **Why it sells:** continuity + ownership. Your data is yours.

### 0:45–0:52 — Personality · gentle coaching
- **Caption (time-skip, mono):** `20 minutes later…`
- **On screen:** Cosmo has drifted to **bored**, then **annoyed** (half-lids, a small frown) as a distraction app sits in front.
- **Cosmo (spoken, playful):** "Psst… still scrolling?"
- **Caption:** `notices your day — nudges with a look, not a lecture · no keylogging`
- **Why it sells:** the work-buddy angle, and the privacy promise repeated where it matters.

### 0:52–0:58 — Trust montage
- **On screen:** tight on the eyes; clean text beats fade in/out over the glow.
- **Captions (sequential, mono):**
  `on-device voice` → `no keylogging` → `no cloud vision` → `your model, your keys`
- **Cosmo expression:** calm **idle**, one slow confident blink.
- **Why it sells:** stacks the trust claims right before the ask.

### 0:58–1:00 — CTA
- **On screen:** Cosmo **happy**, a ❤ floats up. The wordmark **Cosmo** + the little blinking logo eyes.
- **Cosmo (spoken):** "Let's get to work together!"
- **Caption (CTA):** `Cosmo — your desktop buddy · free & open source` + site URL
- **Music:** lifts and resolves.

---

## The 30-second cut (socials)

Keep the spine, drop the middle:
1. **0:00–0:05** Cold open (alive + cursor-follow). `MEET COSMO`
2. **0:05–0:14** Voice ask → weather reply. `just talk to it · on-device`
3. **0:14–0:22** Web search → Sources. `actually gets things done`
4. **0:22–0:27** Trust beats over the eyes. `local-first · private`
5. **0:27–0:30** CTA: happy + ❤ + wordmark + URL.

---

## Exact lines (for TTS / captions)

**Narrator/feature captions** are on-screen text only (no VO) unless a voiceover track is added.

| # | Speaker | Line |
|---|---|---|
| 0a | Cosmo | "Hi — I'm Cosmo!" |
| 0b | Narrator | "Meet Cosmo: a tiny AI companion that lives on your desktop. Big expressive eyes, a voice you can talk to — and he actually gets things done. All local-first, right on your machine." |
| 1 | User | "Hey Cosmo — what's the weather looking like?" |
| 2 | Cosmo | "Sunny and 24° — good day to step outside!" |
| 3 | User | "Find me the best papers on large language models." |
| 4 | Cosmo | "Found some great ones on arXiv — they're in your Sources tab!" |
| 5 | User | "Start a 25-minute focus timer and remind me to stretch after." |
| 6 | Cosmo | "Done — 25 minutes, and I'll nudge you to stretch!" |
| 7 | User | "Remember I take my coffee black." |
| 8 | Cosmo | "Got it — black coffee. I'll remember that." |
| 9 | Cosmo | "Psst… still scrolling?" |
| 10 | Cosmo | "Let's get to work together!" |

> When the harness runs live, Cosmo's lines come from the **real LLM** (so they may vary
> slightly) and are spoken by the **real TTS**. The lines above are the intended takes —
> if a live reply drifts off-tone, we re-roll or fall back to the scripted line.

---

## How it gets recorded (pipeline)

1. **Drive:** `playwright-core` `_electron` launches the built app and plays the
   conversation beat-by-beat (mood cues are real; prompts are entered to the chat).
2. **Capture:** Playwright records the app window to video (`.webm`).
3. **Voice:** each Cosmo line is rendered to audio by the real TTS; the user lines
   are rendered too (or kept as captions). Timed to the beats.
4. **Assemble:** `ffmpeg` composites the window over a desktop backdrop, lays in
   captions + music + the voice track, and exports the 60s and 30s MP4s.
5. **Ship:** drop `cosmo-demo.mp4` into `cosmo-site/assets/media/` — the Demos page
   clip slot picks it up automatically.
