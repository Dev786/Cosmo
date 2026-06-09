# Cosmo — Full Build Spec

**Date:** 2026-06-04  
**Owner:** Devashish Rana  
**Working name:** Cosmo (configurable at first-run onboarding)  
**Platform:** macOS 13+, Electron + TypeScript, no Windows/Linux in v1

---

## What we're building

A small always-on-top macOS desktop companion with animated eyes (~220×170px frameless window). It:
- Watches for inactivity and distraction, reacting with escalating expressions and dry spoken callouts
- Answers questions via LLM (default: xAI/Grok, free tier)
- Controls Apple Music via AppleScript
- Searches the web (DuckDuckGo, no API key) and reads pages on request
- Responds to voice (wake word "Hey Cosmo" via Porcupine + whisper.cpp STT)
- Runs Pomodoro sessions, tracks daily focus goals, captures quick thoughts without breaking flow
- Syncs status to Google Chat, auto-enables Do Not Disturb, fires HomeKit scenes on mood changes
- Reads and summarizes Gmail; composes and sends email on explicit confirm
- Briefs you every morning (weather + calendar + email + tasks) and recaps every evening
- Controls system volume, display sleep, app launcher, clipboard history
- Tracks GitHub PRs and CI; reminds you to drink water; enforces a daily distraction cap
- Exposes a local webhook so any external tool can trigger Cosmo's moods
- Runs all day, every day — reliability and performance budget are mandatory, not nice-to-haves

---

## Tech stack

| Layer | Choice | Notes |
|---|---|---|
| App shell | Electron (latest stable) | Main process: Node 20+ |
| Language | TypeScript everywhere | Strict mode, no `any` without comment |
| Renderer | Plain HTML/CSS/TS | No React, no framework — the UI is two divs |
| Config | `electron-store` | Persisted at `~/.pixel/config.json` |
| Validation | `zod` | Tool arg schemas, config shapes |
| Packaging | `electron-builder` | `.app` / `.dmg` output |
| Wake word | Porcupine Node SDK | Free personal tier |
| STT | whisper.cpp binding | Default offline; `openaiWhisper` selectable |
| Vision (M6) | MediaPipe Tasks or tfjs-wasm | Research best-maintained at M6 time |
| Secrets | `.env` (gitignored) | `XAI_API_KEY`, others per provider |

**Allowed deps only.** Ask before adding anything not in the list above.

---

## Repository layout

```
src/
  main/
    index.ts            # app lifecycle, tray, window creation
    state.ts            # mood state machine — single source of truth
    core/
      osascript.ts      # ALL AppleScript runs here (execFile, never exec)
      shell.ts          # safe open/exec helpers
      speechQueue.ts    # serialized TTS
      soundQueue.ts     # serialized micro sound effects (afplay)
      webhookServer.ts  # inbound webhook (localhost only, opt-in)
      log.ts            # rotating logger → ~/.pixel/logs/ (7-day retention)
    integrations/
      google.ts         # shared Google OAuth2 token management (Gmail + Chat)
      dnd.ts            # macOS Focus / DND toggle
      homekit.ts        # Home Assistant webhook bridge
    stt/
      types.ts          # STTProvider interface
      registry.ts
      whisperLocal/     # whisper.cpp binding (default)
      openaiWhisper/    # API alternative
    watchers/
      types.ts          # Watcher interface { name, start(ctx), stop() }
      registry.ts
      workSignal.ts     # fusion module — the only thing that judges focus
      idle/index.ts
      focus/index.ts
      cadence/index.ts
      presence/index.ts
      battery/index.ts     # battery level alerts
      eyeStrain/index.ts   # 20-20-20 reminder
      goalTracker/index.ts # daily focus goal accumulator
      water/index.ts       # hydration reminder every 90 min
      briefing/index.ts    # morning + evening scheduled summaries
      github/index.ts      # PR / CI polling watcher
      callouts/         # template sets per personality mode
        coach.ts
        drill-sergeant.ts
        therapist.ts
    tools/
      types.ts          # Tool interface + ToolContext + ToolResult
      registry.ts       # timeout + error wrapping lives here
      music/index.ts
      speech/index.ts
      browser/index.ts
      timer/index.ts
      search/index.ts
      pageRead/index.ts
      notes/index.ts       # notes.capture
      pomodoro/index.ts    # pomodoro.start / stop
      focusGoal/index.ts   # goal.set
      reminders/index.ts   # reminder.add / list / complete
      tasks/index.ts       # task.add / list / complete / remove
      email/index.ts       # email.unread / search / read / compose / send / reply / today
      calendar/index.ts    # calendar.today / next / block
      github/index.ts      # github.prs / ci / mentions
      weather/index.ts     # weather.today / forecast
      system/index.ts      # system.volume / mute / display-sleep
      clipboard/index.ts   # clipboard.list / get
      launcher/index.ts    # launcher.open (apps + Shortcuts)
    ai/
      dispatcher.ts     # fenced JSON → registry.execute
      providers/
        types.ts        # LLMProvider interface
        registry.ts
        openaiCompat.ts # shared base for 5 providers
        xai/index.ts    # DEFAULT — Grok
        openai/index.ts
        google/index.ts
        deepseek/index.ts
        ollama/index.ts
        anthropic/index.ts
  renderer/
    index.html
    chat.ts
    vision/
      camera.ts
      models.ts
    settings/
      index.html
      settings.ts
    packs/
      types.ts          # ExpressionPack interface
      registry.ts
      classic/
        index.ts
        recipes.ts      # tunable numbers only
        tween.ts
  shared/
    types.ts            # MoodState, ActivityState, ToolCall, Config
```

**Layout principle:** everything expected to grow lives behind `types.ts` + `registry.ts`. New capability = new folder. Never edit a switch statement scattered across the codebase.

---

## Three hard boundaries

A change inside one boundary must **never** require editing another boundary's folder.

| Boundary | Contract | Registry | Grows by |
|---|---|---|---|
| Expression packs | `renderer/packs/types.ts` | `renderer/packs/registry.ts` | Add `packs/<name>/` |
| Tools | `main/tools/types.ts` | `main/tools/registry.ts` | Add `tools/<name>/` |
| LLM providers | `main/ai/providers/types.ts` | `main/ai/providers/registry.ts` | Add `providers/<name>/` |

---

## Phase 0 — Face

**Goal:** Electron window visible on screen with living, animated eyes.

### Window
- Frameless, transparent background, always-on-top, ~220×170px
- Draggable anywhere on its body; position remembered per display arrangement
- Never steals focus; never appears in Dock (`app.dock.hide()`)
- Tray icon: Show/Hide, Quit (minimal for M0; full tray in M5)

### Classic expression pack (`packs/classic/`)
- Two rounded-rect eye divs; parameters: `{w, h, radius, offsetX, offsetY, rotation, color}`
- `recipes.ts` exports named parameter sets for each MoodState — the only place numbers live
- `tween.ts`: 250ms cubic-bezier transitions between parameter sets
- Idle animation: slow gaze wander (random target every 2–4s), blink every 3–6s (scaleY 0.08 for 130ms)
- `prefers-reduced-motion`: keep state changes, drop gaze wander and bounce

### ExpressionPack interface
```ts
interface ExpressionPack {
  readonly name: string;
  init(container: HTMLElement, opts: { reducedMotion: boolean }): void;
  setState(state: MoodState): void;
  pulse(event: "blink" | "speakTick"): void;
  setIntensity(level: number): void;       // 0..1
  setActivity(activity: ActivityState | null): void;
  dispose(): void;
}
```

### Accept criteria
- 60fps eye animation
- App uses < 1% CPU at idle
- Tray Show/Hide works
- Window position persists across relaunch

---

## Phase 1 — Moods

**Goal:** Full 8-state mood machine; every state visually distinct.

### MoodState enum
`idle | listening | thinking | speaking | happy | bored | annoyed | sleeping`

### State machine rules
- `state.ts` (main process) is sole owner; pushes state to renderer over IPC on change
- Renderer never sets mood; pack only renders what it's told
- Any user interaction (click, type, voice) immediately exits `bored`/`annoyed`
- `happy` auto-reverts to `idle` after 2s
- Timing (blink scheduler, escalation timers) belongs to main; packs decide only how things look

### Classic pack reference looks
| State | Look |
|---|---|
| `idle` | Soft squares, slow gaze wander, blink 3–6s |
| `listening` | Eyes widen +20% |
| `thinking` | Narrowed, raised, look up-right |
| `speaking` | Gentle vertical bounce |
| `happy` | ∩-shaped arcs |
| `bored` | Half-lidded, slow drift down |
| `annoyed` | Flat-top narrow, color shifts amber→red with persistence |
| `sleeping` | 2px closed lines, no blinking |

### ActivityState (orthogonal to mood)
```ts
type ActivityState =
  | { type: "music"; nowPlaying: { track: string; artist: string } }
  | { type: "searching" }
  | { type: "timer"; remainingSec: number; label: string };
```
Renders as overlay alongside mood. Classic pack v1 renders: music → 5–7 bar simulated equalizer; searching → radar-sweep dot; timer → thin countdown ring around window edge.

### Dev tooling
- `PIXEL_DEV=1` env flag enables keyboard shortcuts 1–8 to force each state
- Debug palette dev-only; stripped from production build

### Accept criteria
- Every state visually distinct; blink overlays all states
- Transitions tween, never snap
- Dev shortcuts 1–8 work

---

## Phase 2 — Watchers

**Goal:** Bot observes idle time and focused app, reacts with escalating moods and spoken callouts.

### idleWatcher
- Polls `powerMonitor.getSystemIdleTime()` every 30s
- Config thresholds: `idleSoftMin` (default 10 min) → `bored`; `idleHardMin` (default 25 min) → `annoyed` + one spoken callout
- `PIXEL_DEV=1`: thresholds in seconds for testing

### batteryWatcher
- Polls `powerMonitor` battery level every 5 min (only when on battery power)
- Below 20%: eyes flicker + dramatic callout ("I'm running out of power. Unlike you.")
- Below 10%: eyes go red + urgent callout; repeats every 5 min until charging (overrides callout cooldown for below-10%)
- Clears on charger connect; no callouts when plugged in

### eyeStrainWatcher
- Tracks cumulative screen-on time via cadenceWatcher's `steady` buckets
- Every 20 min of continuous screen time → `pulse("lookAway")` to renderer (eyes animate away from screen) + soft spoken reminder: "Look at something twenty feet away for twenty seconds."
- Resets on any break > 60s of idle
- Respects callout cooldown and meeting quiet mode; visual pulse always fires even when voice is muted

### focusWatcher
- Every 30s during work hours via AppleScript: frontmost process name; if browser is frontmost, also active tab URL
- App classification (pure exported function, testable):
  - `workApps`: VS Code, Cursor, iTerm, Terminal, Figma, Xcode, browsers on `workDomains` (github.com, localhost, docs)
  - `distractions`: youtube.com, x.com, twitter.com, instagram.com, reddit.com
  - Everything else: neutral
- Rolling 30-min window; cumulative distraction time > `distractionMin` (default 15 min) → distraction callout

### Callout system
- Callouts are local templates (not AI-generated in v1) — dry, dramatic, never mean
- Examples: "Devashish. I have been staring at nothing for twenty-five minutes." / "Forty minutes of YouTube. The video essays will still exist after your sprint."
- **Cooldown: max one spoken callout per `calloutCooldownMin` (default 20 min)**
- Mood can persist; nagging cannot
- No callouts during meeting quiet mode or tray pause

### workHours
- Config: `workHours: { start: "10:00", end: "19:00", days: [1..5] }`
- Watchers stand down outside work hours

### core/osascript.ts
- ALL AppleScript calls route here
- Wraps `child_process.execFile("osascript", [...])` with timeout + error capture
- Never `exec` with interpolated user strings — always `execFile` with argument arrays

### core/speechQueue.ts
- Serializes TTS calls (macOS `say` binary); no overlapping speech
- Voice and rate from config

### Accept criteria
- Simulate idle via `PIXEL_DEV=1`; full bored → annoyed → sleeping escalation observable
- Zero callouts while tray-paused or outside work hours
- Sleep/wake reset: on `powerMonitor` resume, all watcher rolling windows reset — no post-wake callout backlog

---

## Phase 3 — Brain + Hands

**Goal:** Text chat works end-to-end; all 6 built-in tools function; provider is swappable without code changes.

### LLMProvider interface
```ts
interface LLMProvider {
  readonly name: string;
  readonly capabilities: { nativeWebSearch: boolean; offline: boolean };
  chat(req: ChatRequest): Promise<ChatResponse>;
}
interface ChatRequest { system: string; messages: ChatMessage[]; maxTokens?: number; }
interface ChatResponse { text: string; }
```

### Provider architecture
- Default: `xai` (Grok, free tier) — config: `llm: { provider: "xai", model: "<current-grok-model>" }`
- 5 providers (xAI, OpenAI, Google, DeepSeek, Ollama) are thin presets over `openaiCompat.ts`
- Anthropic gets its own adapter (Messages API shape differs)
- Optional fallback chain: `fallback?: ["ollama"]` — on 429/5xx, try next once, report honestly
- Missing API key → provider hidden from selection with console hint, not a crash
- **Verify model IDs against vendor docs at implementation time** — never trust spec examples

### Tool-call protocol
- Fenced JSON blocks in plain text — NOT vendor function-calling
- Format: ` ```tool\n{ "name": "music.play", "args": { ... } }\n``` `
- `dispatcher.ts` parses defensively; validates args via tool's zod schema; executes
- Unknown tool or malformed JSON → answer as plain text, never crash

### Tool interface
```ts
interface Tool<A = unknown> {
  readonly name: string;
  readonly description: string;
  readonly schema: z.ZodType<A>;
  readonly permissions?: string[];
  readonly availableOffline: boolean;
  execute(args: A, ctx: ToolContext): Promise<ToolResult>;
}
```
- Registry wraps every `execute` with 5s timeout + typed error capture
- Dead tool → honest `userMessage`; never crashes the app
- `description` + zod schema = what LLM sees; write them as user-facing copy

### Built-in tools (v1)
| Tool | What it does |
|---|---|
| `music.play` | AppleScript → Music app; sets `music` activity on success |
| `music.pause` | AppleScript pause |
| `music.next` | AppleScript next track |
| `music.nowPlaying` | Returns current track info |
| `speech.say` | macOS `say` via speechQueue |
| `browser.open` | `open` shell command; user-gated only |
| `timer.set` | Local countdown; flash `happy` on expiry; sets `timer` activity |
| `search.web` | DuckDuckGo HTML fetch, top 5 results; sets `searching` activity; stores session result memory |
| `page.read` | Fetch page, strip boilerplate, summarize via LLM; user-gated only |
| `notes.capture` | Append timestamped text to `~/.pixel/notes.md`; also triggerable via global shortcut without opening chat |

### Web flow rules (enforced in dispatcher)
1. Question needing web → `search.web` first. **Never auto-open browser.**
2. `browser.open` fires only on explicit user request ("open the second one", "open X")
3. `page.read` fires only on explicit user request ("summarize it", "read number 3")

### Persistent memory
- User can tell Cosmo things to remember: "Remember I'm working on the auth rewrite this week."
- Stored locally at `~/.pixel/memory.json` as key/value pairs with timestamps
- Up to 20 active memory entries; oldest evicted when full (user can clear via tray or "forget everything")
- Injected into system prompt as a "What I know about you" block — never sent to API unprompted outside this block
- Cosmo can reference memories in callouts: "You said you'd finish the auth rewrite this week. Reddit disagrees."

### System prompt
- Personality: concise, warm, lightly sarcastic when calling out slacking
- Available-tools section generated from registry at request time — never hardcoded
- Conversation history: last 20 turns from `~/.pixel/history.json`
- Persistent memory block injected when `memory.json` is non-empty

### Renderer chat area
- Text input at bottom of window; response text renders under eyes
- `thinking` state while request in flight; `speaking` state while reply renders + TTS plays

### Accept criteria
- "Play my Focus playlist" starts Apple Music
- "What's the news today" runs `search.web` and answers
- Malformed model output (no tool block, broken JSON) never crashes
- Extensibility test A: add `timer.set` as new tool folder with zero changes outside `tools/timer/`
- Extensibility test B: switch `llm.provider` to `ollama` in config; every feature above still works

---

## Phase 4 — Voice

**Goal:** Fully hands-free interaction via wake word + STT; guaranteed fallback if voice fails.

### Wake word
- Porcupine Node SDK, keyword "Hey Cosmo" (free personal tier, `PICOVOICE_ACCESS_KEY` from `.env`)
- Listens whenever app runs except: meeting quiet mode, tray mute
- On detection → `listening` state → start recording

### Hover-revealed mic dot (guaranteed fallback)
- ~20px dot, hidden by default
- Fades in when cursor enters window, fades out on leave
- Click → `listening` state (same code path as wake word — one entry point)
- **If Porcupine fails to init**: dot becomes persistently visible + honest line in chat ("Wake word unavailable — tap the dot to talk"). Voice init failure must never block app startup.

### STT provider registry
```ts
interface STTProvider {
  readonly name: string;
  transcribe(audioBuffer: Buffer): Promise<string>;
}
```
- Default: `whisperLocal` (whisper.cpp binding — offline, fast on Apple Silicon)
- Alt: `openaiWhisper` (API, selectable in settings)
- End-of-speech: silence detection ~1.2s

### Accept criteria
- Wake word → `listening` → spoken answer, fully hands-free
- Dot invisible until hover; appears/disappears smoothly
- Kill Porcupine deliberately → dot persistently visible → full voice loop still completes
- Works with WiFi off (Ollama + whisperLocal)
- Text input remains first-class fallback throughout

---

## Phase 5 — Daily-Driver Hardening

**Goal:** Ship a `.dmg` that runs from /Applications unattended for weeks.

### Launch + resilience
- `app.setLoginItemSettings({ openAtLogin: true })` — launch at login
- Single-instance lock (`app.requestSingleInstanceLock()`)
- Auto-relaunch on crash: cap 3 relaunches/hour, then stay down and log to `~/.pixel/logs/`

### Sleep/wake
- On `powerMonitor` `resume`: reset ALL watcher rolling windows
- No post-wake callout backlog; no scolding for laptop having been asleep

### Meeting quiet mode (automatic)
- Suppress all spoken output and callouts while:
  - Frontmost app is: zoom.us, Microsoft Teams, FaceTime, Webex
  - Active browser tab is: meet.google.com, zoom.us, chat.google.com
- Moods may change silently; only TTS + callouts suppressed
- Applied on top of manual tray pause

### Persistence (`~/.pixel/`)
- `config.json` — all settings
- `history.json` — last 20 conversation turns, restored on launch, clearable from tray
- `stats/YYYY-MM-DD.json` — daily focus/distraction tallies
- `logs/` — rotating 7-day retention

### Tray menu (full)
Show/Hide | Pause watching (1h) | Mute voice | Clear conversation | Settings | Quit

### Settings window (separate BrowserWindow)
Configurable: bot name, work hours, idle thresholds, distraction list, LLM provider/model, voice on/off, expression pack, camera on/off

### Personality modes
- Selectable in settings: `coach` (encouraging), `drill-sergeant` (harsh), `therapist` (reflective), `silent` (expressions + activity overlays only, no TTS or callouts)
- Each mode is a named callout template set in `src/main/watchers/callouts/<mode>.ts`
- Default: `coach`
- `silent` mode: moods still change, music overlay still shows, zero spoken output

### Micro sound effects
- New `core/soundQueue.ts` module — tiny non-TTS audio clips (< 0.5s each), serialized like speechQueue
- Sounds: soft bloop on wake word detected, satisfied chime on tool success, low grumble on `annoyed` trigger, gentle ping on timer expiry
- Separate mute toggle from voice ("Sounds" in tray / settings); both can be on or off independently
- Pack contract extended: `pulse()` receives `"soundBloop" | "soundChime" | "soundGrumble"` in addition to existing events — packs may layer visual responses to sounds
- Sound files ship as `.aiff` assets in `src/assets/sounds/`; macOS `afplay` via `core/soundQueue.ts`

### First-run onboarding
Guided flow: name the bot → pick LLM provider + paste key (or pick Ollama) → Automation permission explainer (before triggering) → Microphone permission explainer → Camera opt-in (clearly explained, default OFF) → set work hours. User never sees a raw macOS dialog without context.

### Performance budget
- < 1% CPU, < 150MB RAM at idle
- Animations fully pause while window is hidden
- Nothing polls faster than its specified interval

### Packaging
- `electron-builder` → `.app` / `.dmg`, runs from /Applications
- Ad-hoc codesigning (personal use); README documents right-click → Open Gatekeeper step

### macOS permissions (graceful degradation)
- Automation: detect denial, show one-time explainer in chat area
- Microphone: app fully usable via text if denied
- Camera: every other watcher works unchanged if denied or not opted in

### Accept criteria
- Fresh `.dmg` install + onboarding + full workday: zero crashes
- Zero callouts during a Zoom call or right after sleep/wake
- Window position + conversation history survive a reboot
- CPU stays under budget

---

## Phase 6 — Vision & Work-Signal

**Goal:** Replace direct watcher→mood wiring with a scored fusion module; add camera-based presence.

### cadenceWatcher
- Samples `powerMonitor.getSystemIdleTime()` at 1s resolution
- Each time idle resets to ~0 = user touched input; bucket per minute: `none | sporadic | steady`
- **Hard rule: no event taps, no key codes, no key content — ever**

### focusWatcher (enhanced from M2)
- Add full app classification: `workApps`, `workDomains`, `distractions`; classification is a pure exported function with unit tests

### presenceWatcher (opt-in)
- Renderer `vision/` owns the camera: `getUserMedia` at low resolution, 1 frame every 5–10s
- On-device inference only: MediaPipe face detection + landmarks (research best-maintained binding at implementation time)
- IPC payload: `{ present: boolean, attention: "screen" | "away" | "down", confidence }` — never pixels
- Privacy rules (non-negotiable):
  - Frames never written to disk
  - Frames never leave renderer process
  - Frames never sent to any API
  - macOS green camera light stays on while sampling (feature, not bug)
  - Camera off outside work hours and during meeting quiet mode
  - Inference < 50ms per frame; if over budget, lower sample rate, never the budget

### workSignal (fusion)
Pure scoring module — not a watcher:
- Inputs: `{ appClass, inputCadence, presence, attention }`
- Outputs: `focusScore` (0..1) + discrete events: `distraction | away | returned | deepWork`
- **Only workSignal triggers bored/annoyed/callouts** — individual watchers report facts, never moods
- Score history → `stats/YYYY-MM-DD.json`
- On `deepWork` event: trigger Auto DND (see Phase 7); on `deepWork` end: clear DND

### Accept criteria
- Editor + typing → high focus score, zero callouts even past old idle thresholds
- Walk away 15 min → away tracked, greeted on return
- Phone-scroll posture during distraction site → `annoyed` via workSignal only
- Camera-off mode passes every test except camera-specific ones
- Grep proves no frame data crosses IPC or reaches disk
- CPU stays under global budget with vision on

---

## Phase 7 — Power Features & Integrations

**Goal:** Pomodoro sessions, daily focus goals, quick capture, Slack/DND/HomeKit integrations, and inbound webhook. All opt-in, all degrading gracefully if the external service is unavailable.

### Pomodoro mode (`tools/pomodoro/`)
- `pomodoro.start { workMin?, breakMin?, cycles? }` — defaults 25/5, 4 cycles
- Extends `timer.set` infrastructure; sets `timer` activity with label "Pomodoro – Work" or "Pomodoro – Break"
- On work period end: eyes go `sleeping` + callout "Time to rest. Step away." Cosmo waits for you to come back (presence watcher or manual tap)
- On break end: eyes wake to `happy` + "Back to it."
- `pomodoro.stop` cancels the current session
- Session stats logged to `stats/YYYY-MM-DD.json` alongside focus score

### Daily focus goal (`tools/focusGoal/` + `watchers/goalTracker/`)
- `goal.set { hours }` — "I want 4 hours of deep work today"
- goalTracker reads `focusScore` timeline from stats; accumulates minutes where score > 0.7 as "deep work time"
- Progress visible on hover (tooltip over eyes: "2h 15m / 4h today")
- On goal hit: flash `happy` + "You actually did it. Impressive." — once per day
- Goal persists in `config.json`; resets at start of each work day

### Reminders (`tools/reminders/`)
- `reminder.add { text, time }` — "Remind me to review the PR at 3pm" or "in 30 minutes"
- Natural language time parsing (e.g. "tomorrow morning", "in 2 hours") via a small local parser — no external API
- Stored in `~/.pixel/reminders.json`; checked every 60s
- On trigger: spoken callout + flash `happy` + text appears in chat; persists until user acknowledges ("got it" / "ok" / tapping eyes)
- `reminder.list` — shows upcoming reminders in chat
- `reminder.remove { id }` — cancel a reminder
- Reminders survive app restart; cleared reminders pruned from file

### Tasks (`tools/tasks/`)
- `task.add { text, priority? }` — "Add task: write unit tests for the auth module" (priority: low/medium/high, default medium)
- `task.list { filter? }` — lists open tasks; optional filter: "today", "high", etc.
- `task.complete { id | text }` — marks done + flash `happy`
- `task.remove { id | text }` — deletes
- Stored in `~/.pixel/tasks.json` (plain JSON, importable)
- Cosmo can reference open tasks in callouts when idle: "You have 3 open tasks and you're watching YouTube." (uses persistent memory + task count; task content never sent to LLM API unprompted)
- No sync to external services in v1 — local only

### Quick capture (global shortcut)
- `notes.capture` tool already registered in M3; Phase 7 adds the global shortcut path
- Configurable shortcut (default: `Cmd+Shift+B`) registered via `globalShortcut`
- Shortcut focuses Cosmo's input in single-capture mode: type note → Enter → appended to `~/.pixel/notes.md` with timestamp → input dismisses without disrupting previous app focus
- Notes file is plain Markdown — compatible with Obsidian, Bear, any editor

### Gmail integration (`tools/email/`)
- Reuses the Google OAuth2 token from the Google Chat integration; adds `gmail.readonly` + `gmail.send` scopes
- Single OAuth consent screen covers both Gmail and Google Chat — one "Connect Google" flow in Settings → Integrations

**Reading tools:**
- `email.unread { maxResults? }` — fetch unread count + top N subjects/senders; content summarized locally by LLM; default max 5
- `email.search { query }` — Gmail search syntax ("from:boss label:urgent"); returns matching thread subjects + snippets
- `email.read { id | threadId }` — fetch full thread, strip quoted history, send to LLM for a 3–5 sentence summary; spoken + shown in chat
- `email.today` — shorthand for unread + anything received today; good morning briefing trigger

**Composing / sending:**
- `email.compose { to, subject, body }` — drafts an email and shows the full draft in chat for review before anything is sent
- `email.send { draftId }` — sends only after user explicitly confirms ("send it" / "yes go ahead"); **never auto-sends**
- `email.reply { threadId, body }` — same pattern: shows draft first, sends only on explicit confirm

**Privacy rules:**
- Email body text IS sent to the LLM for summarization — but only on explicit user request ("read that", "summarize my inbox"), never proactively
- Email content is never stored beyond the current conversation turn; not written to `history.json`
- Sender addresses and subjects from `email.unread` / `email.search` are shown in chat only — not injected into the system prompt or persistent memory
- OAuth token stored in `~/.pixel/config.json` (same as Google Chat token); revocable from Settings

**Watcher hook (optional, opt-in):**
- `emailWatcher`: polls unread count every 10 min during work hours; if count climbs by > 5 since last check → soft notification in chat area ("12 new emails since 2pm") with no TTS unless user is idle
- Off by default; toggle in Settings → Integrations

### Google Calendar (`tools/calendar/`)
- Reuses the shared Google OAuth token (`google.ts`); adds `calendar.readonly` + `calendar.events` scopes
- `calendar.today` — lists today's events (time, title, Meet link if present); spoken + shown in chat
- `calendar.next` — "What's my next meeting?" + how many minutes away
- `calendar.block { hours, label? }` — creates a focus block on the primary calendar starting now
- Pre-meeting quiet: at work hours start, schedule a silent macOS notification 5 min before each meeting with a Meet link (if present); Cosmo says "Meeting in 5 — [title]" and switches to `thinking` briefly
- Meeting quiet mode already detects `chat.google.com`; calendar integration extends it: when a calendar event is active, quiet mode engages automatically even if the Meet tab isn't open yet

### Morning briefing (`watchers/briefing/`)
- Fires once at work-hours start each day (configurable time, default: `workHours.start`)
- Spoken 30–45 second summary covering in order: weather snapshot, today's meetings count + first meeting time, unread email count, open task count, yesterday's focus score if available
- Each section uses the corresponding tool internally (`weather.today`, `calendar.today`, `email.unread`, `task.list`); all calls are local or cached — briefing never fires if any required integration isn't configured (gracefully skips that section)
- Triggered once per calendar day; reset at midnight; can also be triggered manually ("give me my briefing" / "morning summary")

### Weather (`tools/weather/`)
- `weather.today` — current conditions + high/low for today (location from config, set at onboarding)
- `weather.forecast { days? }` — up to 7-day forecast
- Data source: Open-Meteo API (free, no API key, no account)
- Location: stored as lat/lng in config (resolved once from city name at setup via Open-Meteo geocoding); never sent to any other service
- Results cached 30 min; stale cache used if network is unavailable with an honest note

### GitHub notifications (`tools/github/` + `watchers/github/`)
- Config: `integrations.github.token` (personal access token, `notifications` + `repo:status` scopes only)
- `github.prs` — PRs in your orgs/repos where your review is requested or you're assigned; shows title, repo, age
- `github.ci` — CI status on your most recently pushed branch across repos
- `github.mentions` — unread @mentions in issues/PRs
- **githubWatcher**: polls every 15 min during work hours; if any PR has been awaiting your review > 24h → soft callout in chat ("Two PRs waiting on you since yesterday."); max one callout per hour
- GitHub token missing → tools and watcher silently absent from registry

### System controls (`tools/system/`)
- `system.volume { level: 0–100 }` — set output volume via AppleScript
- `system.mute` / `system.unmute`
- `system.display-sleep` — sleep display immediately (useful before a meeting or stepping away)
- `system.brightness { level: 0–100 }` — keyboard brightness control via AppleScript (`System Events`)
- All routed through `core/osascript.ts`; no extra macOS permissions beyond existing Automation grant

### Clipboard history (`tools/clipboard/`)
- Maintains a ring buffer of the last 10 clipboard entries (plain text only — explicitly skips entries that look like passwords: > 16 chars with mixed case + digits + symbols, or entries from password manager apps)
- `clipboard.list` — shows recent clips in chat, numbered
- `clipboard.get { index }` — copies entry N back to clipboard + confirms in chat
- Buffer lives in memory only — never written to disk, cleared on quit
- Polling via `NSPasteboard` change count checked every 2s (negligible CPU)

### App + Shortcut launcher (`tools/launcher/`)
- `launcher.open { name }` — fuzzy-matches against: installed .app bundles in /Applications + ~/Applications, and named macOS Shortcuts
- Apps opened via `open -a`; Shortcuts via `shortcuts run "<name>"`; both through `core/shell.ts`
- "Open Figma" / "Open the terminal" / "Run my deploy script" all work
- No enumeration of all apps at startup — resolves lazily on first request; caches the match for the session

### Timezone + world clock
- Handled natively by the LLM — no dedicated tool needed
- "What time is it in San Francisco?" / "Convert 3pm EST to my time" answered directly from model knowledge
- Noted here so it's not accidentally implemented as a separate API call

### Calculator + unit converter
- Also handled natively by the LLM
- "15% of 3400", "5km to miles", "days until June 20" all answered directly
- No tool needed; noted to avoid redundant implementation

### Water reminder (`watchers/water/`)
- Fires every 90 min of continuous work-hours time (resets on any break > 10 min)
- Callout: dry and slightly passive-aggressive — "Drink some water. You're basically a houseplant." / "Water. Now."
- Cosmo tracks acknowledgements (any "ok", "done", "got it" response or clicking eyes resets the timer)
- End-of-day recap includes hydration count: "You drank water 3 times. Questionable."
- Respects meeting quiet mode; voice callout only; no mood change

### Daily distraction cap (`watchers/focus/` extension)
- Config: `distractionCapMin` (default 60 min/day across all distraction domains)
- focusWatcher accumulates daily distraction time in `stats/YYYY-MM-DD.json`
- At 75% of cap: soft warning in chat ("45 of your 60 allowed distraction minutes used today")
- At 100%: eyes go full red + hard callout naming the biggest offending domain; repeats every 30 min for remainder of work day (overrides normal callout cooldown)
- Resets at midnight; cap configurable per-domain in settings

### Evening recap (`watchers/briefing/` extension)
- Fires once at work-hours end each day
- Spoken 30-second summary: total focus time (from workSignal), pomodoros completed, tasks completed vs still open, distraction minutes + biggest offender domain, hydration count
- Tone matches personality mode: `coach` = encouraging; `drill-sergeant` = brutal; `therapist` = reflective
- Example (drill-sergeant): "3 hours 20 minutes of real work. 45 minutes on YouTube. 2 of 5 tasks done. You know what to do tomorrow."
- Triggered once per calendar day at `workHours.end`; also manually: "give me my recap" / "how was my day"

### Google Chat status sync (`integrations/googleChat.ts`)
- Config: `integrations.googleChat.token` (Google OAuth2 token, `https://www.googleapis.com/auth/chat.memberships.app` scope)
- On `deepWork` event from workSignal: set Google Chat availability to Do Not Disturb via Chat API (`users.me` availability endpoint)
- On `deepWork` end / work hours end / app quit: restore availability to active
- If token missing or API fails: log warning and continue silently — never surface as an error to user
- OAuth flow handled at onboarding (Settings → Integrations → "Connect Google Chat"); token stored in `~/.pixel/config.json`

### Auto Do Not Disturb (`integrations/dnd.ts`)
- On `deepWork` event: enable macOS Focus via `osascript` (`tell application "System Events" to ...`) or `shortcuts run "Enable Focus"` via `shortcuts.run` tool
- On `deepWork` end: disable Focus
- Opt-in toggle in settings (default ON once workSignal is active in M6)
- Fails silently if Automation permission not granted for System Events

### HomeKit / smart light sync (`integrations/homekit.ts`)
- Calls a user-configured Home Assistant webhook URL (stored in `config.json`, never hardcoded)
- Fires on mood change: maps `MoodState` → scene name (`idle`→"Work Neutral", `annoyed`→"Amber Alert", `sleeping`→"Dim Warm", `happy`→"Celebration Flash")
- Config: `integrations.homekit.webhookUrl`, `integrations.homekit.moodMap` (overridable per-mood)
- HTTP POST with `{ mood, intensity }` payload; 3s timeout; failures logged silently
- Works with any webhook-capable hub (Home Assistant, Hubitat, n8n) — not HomeKit-native API

### Inbound webhook server (`core/webhookServer.ts`)
- Local HTTP server on `127.0.0.1` only (never 0.0.0.0), configurable port (default 57321)
- Endpoint: `POST /mood` `{ state: MoodState, durationMs?: number }` → sets mood; optional auto-revert after `durationMs`
- Endpoint: `POST /speak` `{ text: string }` → enqueues TTS via speechQueue
- Endpoint: `POST /notify` `{ text: string }` → shows text in chat area without TTS
- Auth: static bearer token from `config.json` (generated at first run, shown in Settings → Integrations)
- Use cases: CI success/failure, deploy hooks, calendar alerts from any tool that can fire a webhook
- Server starts only when `integrations.webhook.enabled: true` in config (default OFF, opt-in)

### Accept criteria
- "Start a pomodoro" → 25/5 cycle runs; eyes go sleeping on break; wake on return
- `goal.set { hours: 3 }` then work 3h → `happy` flash + callout once
- "Remind me to review the PR in 30 minutes" → reminder fires 30 min later with callout + persists until acknowledged
- "Add task: finish the readme" → stored; "mark it done" → flash `happy`; idle callout references open task count
- Global shortcut captures note without stealing focus from current app
- Morning briefing fires at work-hours start covering weather + meetings + emails + tasks
- "What's on my schedule today?" → calendar events listed + spoken
- "Any PRs waiting on me?" → GitHub review queue answered instantly
- "What's the weather?" → Open-Meteo answer, no API key needed
- "Open Figma" / "Run my deploy script" → app or Shortcut launches
- "Set volume to 40%" → system volume changes via AppleScript
- "What did I copy earlier?" → clipboard history shown in chat
- Evening recap fires at work-hours end with focus + task + distraction summary
- Water reminder fires every 90 min; hydration count in evening recap
- "How many unread emails do I have?" → fetches + summarizes without opening browser
- "Send an email to mom saying I'll call tonight" → shows full draft in chat; sends only after explicit confirm
- Google Chat DND sets on deepWork detection and clears on end (OAuth token required)
- DND enables/disables with deepWork (Automation permission required)
- `curl -X POST localhost:57321/mood -d '{"state":"happy"}' -H "Authorization: Bearer <token>"` → eyes go `happy`
- All integrations: missing config / denied permission / API failure → silent log, app continues normally

---

## Cross-cutting rules (apply to every phase)

- `osascript.ts` is the only place AppleScript runs; always `execFile`, never `exec` with interpolated strings
- Tool/watcher/pack boundaries inviolable: if a change touches two registries' folders at once, stop and reconsider
- Timeouts and error-wrapping live in registries, not individual modules
- Watcher facts never appear in LLM requests; AI sees only what user typed/said
- TypeScript strict mode; no `any` without a comment justifying it
- After each phase: update `claude.md` progress checklist; note learnings in `NOTES.md`

---

## Environment variables

```
XAI_API_KEY          # default provider (Grok)
OPENAI_API_KEY
GOOGLE_API_KEY
DEEPSEEK_API_KEY
ANTHROPIC_API_KEY
PICOVOICE_ACCESS_KEY  # wake word (M4)
GITHUB_TOKEN          # GitHub notifications (Phase 7, optional)
PIXEL_DEV=1           # accelerated thresholds + debug shortcuts
```

---

## What's explicitly out of scope (v1)

- Windows / Linux
- Auto-updates
- Analytics / telemetry
- AI-generated callouts (templates only)
- Real audio spectrum capture (equalizer is simulated)
- Playwright browser automation
- Keylogging in any form
- Cloud vision
- Native HomeKit API (Home Assistant webhook is the bridge)
