# Cosmo tool expansion — ideas extracted from OpenClaw

> **Status: PROPOSAL — awaiting your approval before any implementation.**
> Date: 2026-06-07. Source studied: [OpenClaw](https://github.com/openclaw/openclaw) (`openclaw.ai`, `docs.openclaw.ai`, ClawHub).

## 1. Why OpenClaw is a good reference

OpenClaw is the viral (~68k★) open-source personal AI assistant. It shares Cosmo's **channel / brain / body** split: messaging adapters → agent runtime → tools that take real-world actions. Its tools are the "body," and that's the layer we want to grow for Cosmo.

**OpenClaw's tool surface (what it can actually *do*):**

| Group | Tools | What they do |
|---|---|---|
| First-class | `browser`, `canvas`, `nodes`, `cron`, `sessions`, Discord/Slack actions | Web automation, agent-driven visual canvas, device nodes, scheduled jobs, multi-session memory |
| Core agent | `bash`, `process`, `read`, `write`, `edit` | Run shell, manage processes, read/write/edit files |
| Sessions | `sessions_list/history/send/spawn` | Spawn & talk to sub-agents, recall history |
| Automation | cron jobs, webhooks, Gmail Pub/Sub | Time- and event-triggered runs |
| Channels | WhatsApp, Telegram, Slack, Discord, iMessage, Signal, Teams, Matrix… | Reach the user on existing chat apps |
| Voice | wake word + talk mode (ElevenLabs + system TTS) | Hands-free in/out |
| Nodes | iOS/Android: camera, screen capture, voice forward | Phone as a sensor/surface |
| ClawHub marketplace | Gmail, Google Calendar, Playwright browser, home automation, stock monitoring, code deploy… | Thousands of community skills |

## 2. Cosmo's current tools (baseline)

25 tools across 16 folders in `src/main/tools/`:

- **Web/info:** `browser.open`, `search.web`, `pageRead`, `weather.today`
- **System (macOS):** `system.mute`, `system.volume`, `launcher.open`, `clipboard.get`, `clipboard.set`
- **Productivity:** `notes.capture`, `task.add/list/done/clear`, `reminder.set/list/clear`, `timer.set`, `pomodoro.start/stop`
- **Media:** `music.play/pause/next`
- **Dev:** `github.notifications`, `github.prs`
- **Voice:** `speech.say`

Cosmo already covers the "quick utility + work-coach" core. The gaps vs OpenClaw are: **calendar/email/contacts, richer macOS control, the Shortcuts bridge (huge), local file find, and personalization memory.**

## 3. Proposed new tools (prioritized)

Every proposal fits the existing boundary: a new `src/main/tools/<name>/` folder + a zod schema + registry entry, invoked via the fenced-JSON protocol. macOS actions go **only** through `core/osascript.ts` (`execFile` + arg arrays). None require new always-on permissions beyond a first-use prompt.

### Tier 1 — high value, low risk, very Cosmo (recommended first batch)

| Tool | Does | Mechanism | Example | Notes |
|---|---|---|---|---|
| `shortcuts.run` | Run any macOS Shortcut by name | `shortcuts run "<name>"` via osascript/execFile | "Cosmo, run my Focus shortcut" | **Highest leverage.** One tool turns every Shortcut the user already has (home, scenes, automations) into a Cosmo command. Mirrors OpenClaw's home-automation/skill breadth with zero per-integration code. |
| `calendar.today` / `calendar.next` | Read today's events / next meeting | EventKit or Calendar.app via osascript | "What's my next meeting?" | Pure work-coach. Read-only. Enables proactive "meeting in 10 min" later. |
| `system.focus` | Toggle a macOS Focus / Do-Not-Disturb mode | Shortcuts `Set Focus` or osascript | "Turn on Do Not Disturb" | Natural extension of `system.*`; great for the coach persona. |
| `app.control` | Quit / switch / list frontmost & running apps | osascript (System Events) | "Quit Slack" / "switch to Figma" | Extends `launcher.open` to the full lifecycle. |
| `files.find` | Spotlight search for a file, return paths | `mdfind` via execFile (read-only) | "Find my taxes PDF" | Read-only — **no** write/edit (see §4). |

### Tier 1R — Explicitly requested: Gmail · Google Calendar · Trello (read-only)

> You asked for these directly (2026-06-07). Scoped **read-only** for v1 — Cosmo *checks* and *tells you*; sending mail / creating events / moving cards is a later, confirm-chipped batch. All three add a new `src/main/tools/<name>/` folder + zod schema + registry entry like every other tool.
>
> **DECIDED (2026-06-07): the auth path is the *user's* choice, made in onboarding — not hard-coded.** A new **"Accounts / Connect"** tab in the existing setup overlay (alongside Brain · Voice · Ears) lets the user pick per service and drop in keys only for what they want:
> - **Calendar:** defaults to **native** (Calendar.app via osascript) — works with zero setup. No toggle needed unless they later want Google API.
> - **Gmail:** a radio choice — **Mail.app (native, no keys)** *or* **Google OAuth** (reveals client ID/secret fields + a "Connect Gmail" button; refresh token stored encrypted via `safeStorage`). The `gmail.*` tools read whichever mode is configured.
> - **Trello:** paste API key + token (read-only), stored encrypted via `safeStorage`.
>
> This mirrors how Brain/Voice/Ears already let the user choose provider + enter keys, so it's the same pattern users already know. Read-only v1. Build tool-by-tool, each verified before the next.

| Tool | Does | Example | Notes |
|---|---|---|---|
| `gmail.unread` / `gmail.search` | Count + summarize unread; search by query | "Any important email?" / "Did the invoice from Acme arrive?" | Returns sender + subject + snippet only. |
| `calendar.today` / `calendar.next` | Today's events / next meeting (already in Tier 1 — Google account feeds it) | "What's my next meeting?" | Read-only. Same tool surface regardless of auth path below. |
| `trello.tickets` | Cards assigned to you / on a board, with list (status) | "What are my active tickets?" / "What's in my In-Progress?" | Filters to cards where you're a member, optional board filter. |

**Auth — two paths (this is the one decision I need from you, see §6):**

- **Path A — macOS-native (no Google login, recommended for Calendar):** read Calendar via **Calendar.app**/EventKit and mail via **Mail.app**, both through the existing `core/osascript.ts`. Zero new secrets, fully local, fits Cosmo's "macOS-native, no cloud" posture exactly. **Requires** your Google account already added to macOS Calendar & Mail. Gmail-specific features (labels, server-side search) are limited to what Mail.app exposes.
- **Path B — Google Cloud OAuth (richer, needed for true Gmail features):** Google **Calendar API** + **Gmail API** over OAuth2. Works even if the macOS apps aren't set up; gives real Gmail search/labels. **Requires** you to create a Google Cloud OAuth client (consent screen + client ID/secret) once; Cosmo runs a localhost redirect in Electron and stores the refresh token **encrypted via `safeStorage`** (same pipeline as the LLM/TTS/STT keys). New dep: `googleapis` (or thin REST over the existing HTTP factory — preferred, ~no deps).
- **Trello (no native app → always API):** Trello **REST API** with your API key + token (read-only scope). You generate them once at `trello.com/app-key`; stored encrypted via `safeStorage`. Thin REST over the existing HTTP factory, no SDK.

**Privacy alignment:** tool *results* (subjects, event titles, card names) reach the LLM **only when you explicitly ask** — that's the same as any other tool and is allowed. This is distinct from the hard rule that bars *ambient* facts (window titles, URLs, cadence, camera) from ever entering LLM requests. Nothing is polled into prompts in the background; v1 is read-on-request only.

### Tier 2 — valuable, slightly more surface or a confirmation step

| Tool | Does | Mechanism | Example | Notes |
|---|---|---|---|---|
| `messages.send` | Send an iMessage/SMS | Messages.app via osascript | "Text Sarah I'm running late" | Outward-facing → must show a confirm chip before sending. Very companion-y. |
| `contacts.find` | Look up a contact's phone/email | Contacts.app via osascript | "What's mom's number?" | Pairs with `messages.send`. Local only. |
| `calendar.add` | Create a calendar event | EventKit/osascript | "Add lunch with Alex Friday 1pm" | Write action → confirm chip. |
| `notes.list` / `notes.search` | List/search Apple Notes | Notes.app via osascript | "Find my note about the trip" | Complements existing `notes.capture`. |
| `weather.forecast` | Multi-day / hourly forecast | existing weather provider | "Will it rain tomorrow?" | Small extension of `weather.today`. |
| `music.search` / `music.now` | Play a specific song/playlist; what's playing | Music/Spotify via osascript | "Play my focus playlist" | Extends `music.*` beyond transport. |
| `memory.remember` | Persist a durable user preference/fact | writes a local profile the system prompt already reads | "Remember I prefer metric units" | OpenClaw's "remembers you," done locally. Personalization without a server. |

### Tier 3 — useful but needs a design/privacy decision first

| Tool | Does | Why it needs a decision |
|---|---|---|
| `screen.read` (OCR what's on screen) | `screencapture` → **local** OCR (Vision framework), text to LLM | Screenshots of screen content reaching the LLM is a privacy line. The no-cloud-vision rule is about the *camera*, but screen contents deserve the same care — opt-in + local-OCR-only, never raw image to a cloud model. |
| `cron.schedule` (recurring jobs) | Richer than `reminder.set` — recurring/proactive triggers | Cosmo already has a reminder scheduler; decide whether to extend it or add a general cron. Ties into proactive-speech, which is currently off by design. |
| `clipboard.history` | Recent clipboard entries | Storing clipboard history locally is fine, but it can capture secrets — needs a cap + opt-in. |

## 4. Explicitly OUT of scope (and why)

These are core to OpenClaw but conflict with Cosmo's identity or its critical rules in `CLAUDE.md`:

- **Arbitrary shell (`bash`/`process`)** — Cosmo's rule: AppleScript only via `osascript.ts`, `execFile` with arg arrays, **never** `exec` with interpolated strings. A general shell tool is the opposite of that posture. ❌
- **File `write`/`edit`** — Cosmo is a companion, not a coding agent. Read-only `files.find` is fine; arbitrary write/edit is too dangerous for a voice-driven toy face. ❌ (read-only only)
- **Multi-channel messaging gateway (WhatsApp/Telegram/Slack/Discord bots)** — Cosmo is one local face on your desktop, not a chat-ops relay. Different product. ❌
- **Canvas / A2UI (agent-driven visual workspace)** — Cosmo *is* the visual (the eyes). A separate canvas surface is a different direction; revisit only if we ever want a "show me" panel. ⏸
- **Nodes / gateway / multi-agent sessions** — infrastructure for a fleet, not a single companion. ❌
- **Webhooks / Gmail Pub/Sub** — server-side event infra; Cosmo runs as a desktop app. ❌
- **Cloud vision of camera/screen** — hard rule: camera frames never leave the renderer. Screen OCR only if local (Tier 3). ❌ for cloud.

## 5. Recommendation

Start with **Tier 1** — `shortcuts.run` first (it alone unlocks a huge surface, including home automation, with almost no code and no per-integration maintenance), then `calendar.today/next`, `system.focus`, `app.control`, `files.find`. All are read-or-toggle, macOS-native, privacy-clean, and land squarely in the work-coach + companion identity. That's ~5 small tool folders.

Tier 2 (`messages.send`, `contacts.find`, `calendar.add`, `memory.remember`) adds the "personal assistant" punch but needs the confirm-chip UX for outward/write actions — worth doing as a second batch.

## 6. Open questions for you

0. ~~Auth fork~~ **Resolved: the user picks the auth path in onboarding** (new Accounts/Connect tab) — native by default, Google OAuth opt-in for real Gmail. Nothing hard-coded. (See Tier 1R.)
1. **Approve Tier 1 as the first build batch?** (Or pick a different subset.)
2. **`shortcuts.run`** — comfortable letting Cosmo run *any* named Shortcut, or restrict to an allowlist in config?
3. **`messages.send` / `calendar.add`** — confirm-chip before every send, or trust for `main` session like OpenClaw does on the host?
4. **`screen.read`** — want it at all? If yes, local-OCR-only is the constraint.
5. Any OpenClaw capability above you specifically want pulled in that I parked as out-of-scope?

---
*Once you approve a scope, I'll implement it tool-by-tool behind the existing registry boundary (folder + zod schema + registry entry), with per-tool tests, and verify each live.*
