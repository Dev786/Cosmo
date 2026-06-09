<div align="center">

# Cosmo

**A tiny, bright-eyed companion who lives on your Mac desktop — hears you, talks back, and quietly helps you get things done.**

Always-on-top animated eyes · local-first voice · your choice of AI brain · private by design.

[Architecture deep-dive](cosmo-site/architecture.php) · [License](LICENSE) · Apache-2.0 · macOS

</div>

---

## What is Cosmo?

Cosmo is a desktop AI companion for macOS. He floats above your other windows as a small pair of expressive eyes, listens for a wake word, and answers out loud in a short, friendly voice. Under the hood he can run a tool — open a site, check the weather, play music, set a timer, take a note, read your Mail — and he remembers what matters across sessions.

Three things make him different:

- **Local-first.** Speech-to-text, turn-detection, text-to-speech, and memory embeddings all run **on-device** by default. Nothing about your screen, your typing, or your camera is sent anywhere.
- **Bring your own brain.** The LLM is pluggable — eight providers (OpenAI, Anthropic, Google Gemini, xAI, Groq, DeepSeek, Cerebras, or a fully-local Ollama model) behind one contract, swappable from a dropdown.
- **Yours to read and edit.** Cosmo's personality, your memory, your notes — all plain Markdown on disk you can open, diff, and rewrite. No data is locked in a format only Cosmo can read.

## Highlights

- 🪟 **Frameless, always-on-top avatar** — a 150px face that grows a control rail on hover and a chat column beside it.
- 🗣️ **Hands-free voice** — wake word → listen → answer, with barge-in (interrupt him mid-sentence) and on-device end-of-turn detection (Smart Turn v3).
- 🧠 **Pluggable LLM** — 8 providers behind one `chat()` contract; a 7B local model and a frontier model are genuinely interchangeable.
- 🔧 **Tools, the safe way** — search, weather, news, music, timers/Pomodoro, reminders, tasks, notes, clipboard, app launcher, GitHub, Calendar, Trello, Gmail, **and a local Apple Mail reader** — each behind a zod-validated registry.
- 🧩 **Expression packs** — the eyes are a swappable rendering pack; mood is owned by exactly one place in the main process.
- 💾 **Local memory** — a plain-JSON vector store + a small on-device embedder (all-MiniLM), plus an **Obsidian vault mirror** of every note, task, and reminder.
- 👀 **Gentle work-buddy nudges** — watchers notice idle/focus/battery facts; one tunable judge (`workSignal.ts`) decides if and when Cosmo reacts, never double-scolding.
- 🎙️ **Voices to match** — local Kokoro by default, or cloud voices (ElevenLabs, OpenAI, Groq, Deepgram, Cartesia, Hume, Sarvam) if you bring a key.

## Privacy — the lines nothing crosses

These are enforced in code, not just promised:

- **No keylogging, ever.** Typing cadence is inferred from idle-time deltas only — no event taps, no key codes, no key content.
- **No cloud vision.** Camera frames never leave the renderer process, never touch disk, never reach an API.
- **Your context stays local.** Window titles, URLs, typing cadence, and camera-derived facts are **never** put into LLM requests. The AI sees only what you explicitly typed or said.
- **Keys are sealed.** API keys are encrypted with the OS keychain (`safeStorage`), never written as plaintext.
- **AppleScript has one chokepoint.** Every OS automation call goes through a single audited module using `execFile` with argument arrays — never a shell string with your text interpolated in.

## Requirements

- **macOS** (Cosmo uses AppleScript + the macOS Automation permission for Mail, Music, Calendar, etc.)
- **Node.js 20+** and npm
- ~400 MB free space for the on-device voice/STT/memory models (downloaded on first launch)

## Install & run

```bash
# 1. Install dependencies
npm install

# 2. (Optional) Pre-download the on-device models so first launch is instant
./setup.sh            # or just launch — models fetch lazily on first run

# 3. Run in dev (hot reload)
npm run dev

# 4. Package a distributable .dmg
npm run dist          # output in release/
```

On first launch a setup panel asks you to pick an AI provider + model (or point at a local Ollama model), a voice, and your listening mode. Grant the macOS **Automation** permission when prompted so Cosmo can read Mail, control Music, and check Calendar.

### Useful flags

| Command | What it does |
|---|---|
| `npm run typecheck` | `tsc --noEmit` — strict type-check |
| `npm test` | Jest test suite |
| `npm run licenses:check` | Fail if any GPL/AGPL/SSPL dependency creeps in |
| `PIXEL_DEV=1 npm run dev` | Debug mood shortcuts (1–8) + accelerated watcher thresholds |
| `PIXEL_TRACE=1 npm run dev` | Per-turn tool-call tracing to `~/.pixel/logs/` |

## Make Cosmo your own

Cosmo's personality isn't compiled in — it's plain Markdown seeded on first run under `~/.pixel/workspace/` and read into the prompt on every turn. Edit a file, change Cosmo, no rebuild:

```
~/.pixel/workspace/
  SOUL.md      # personality, voice, values — the character sheet
  AGENTS.md    # operating rules: when to use a tool, the output contract
  USER.md      # durable facts about you  ("remember X" appends here)
  MEMORY.md    # curated long-term memory across sessions
  memory/YYYY-MM-DD.md   # daily notes
```

See [**Chapter 13 · How Cosmo wakes up**](cosmo-site/architecture.php#boot) for the full boot sequence and how these files are seeded and loaded.

## How it works

Cosmo is an Electron app split across a **main** process (thinks & decides) and a **renderer** (draws & senses), with a deliberately narrow IPC line between them. Every major capability hides behind a *contract + registry*, so the app grows by adding a folder — never by editing a neighbour:

| Boundary | Grows by |
|---|---|
| Expression packs (the eyes) | adding `renderer/packs/<name>/` |
| Tools | adding `main/tools/<name>/` |
| LLM providers | adding `main/ai/providers/<name>/` |
| Watchers | adding `main/watchers/<name>/` |

Tool calls are **fenced JSON blocks in plain text**, parsed and validated against each tool's schema — deliberately *not* vendor function-calling, which is what makes any model swappable. Mood has a single owner; judgment about when to react lives in one tunable file.

📖 **The full story** — a chapter-by-chapter teaching deep-dive with diagrams — lives in [`cosmo-site/architecture.php`](cosmo-site/architecture.php).

## Project layout

```
src/
  main/        # Electron main: brain, providers, tools, watchers, voice, memory, core
  renderer/    # eyes, expression packs, chat/panel UI, camera pipeline
  shared/      # the vocabulary shared across the IPC boundary (MoodState, types)
cosmo-site/    # the marketing + architecture deep-dive website (PHP)
scripts/       # build helpers, model prefetch
setup.sh       # optional first-run model install
```

## License

Cosmo is released under the **Apache License 2.0** — see [`LICENSE`](LICENSE). You may use, modify, redistribute, and ship it commercially, with a patent grant, provided you preserve the notices.

It bundles and downloads third-party software and models under their own (permissive) licenses, and includes the LGPL-3.0 **libvips** library (pulled in transitively, dynamically linked). Full attribution and the LGPL compliance notice are in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) and [`THIRD_PARTY_LICENSES.txt`](THIRD_PARTY_LICENSES.txt).

## Author

Devashish Rana · <ranadevashish131@gmail.com>
