# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Full design spec, milestone acceptance criteria, and personality backlog are in `claude.md`. Read it before starting any milestone. Build one milestone at a time; do not begin a later one until the previous one's acceptance criteria pass.

## Build & dev commands

```bash
# Install deps
npm install

# Dev mode (with hot reload)
npm run dev

# TypeScript type-check (no emit)
npm run typecheck

# Lint
npm run lint

# Run tests
npm test

# Run a single test file
npx jest path/to/file.test.ts

# Package for distribution
npm run dist          # produces .dmg in dist/

# Simulate dev environment (accelerated watcher thresholds)
PIXEL_DEV=1 npm run dev
```

`PIXEL_DEV=1` enables debug keyboard shortcuts 1–8 (state switcher) and shrinks idle thresholds to seconds instead of minutes so you can test the full bored→annoyed→sleeping escalation without waiting.

`PIXEL_TRACE=1` opt-in tool-call tracing — writes a per-turn JSONL trace to `~/.pixel/logs/tool-trace.jsonl` and logs a rolling tool-health summary each turn. Off by default (the cheap in-memory aggregates in `ai/trace.ts` always run; only the disk trace + log line are gated).

## Architecture

### The three hard boundaries

Every major capability hides behind a contract + registry. **A change inside one boundary must never require editing another boundary's folder.**

| Boundary | Contract file | Registry | Grows by |
|---|---|---|---|
| Expression packs | `src/renderer/packs/types.ts` | `src/renderer/packs/registry.ts` | Adding `packs/<name>/` |
| Tools | `src/main/tools/types.ts` | `src/main/tools/registry.ts` | Adding `tools/<name>/` |
| LLM providers | `src/main/ai/providers/types.ts` | `src/main/ai/providers/registry.ts` | Adding `providers/<name>/` |

The watcher system follows the same pattern: `src/main/watchers/types.ts` + `registry.ts`.

### Mood ownership

`state.ts` (main process) is the single owner of `MoodState`. It pushes state to the renderer over IPC. The renderer and packs only render what they're told — they never set mood. Any user interaction (click, type, voice) immediately exits `bored`/`annoyed`.

### Tool-call protocol

Tool calls are **fenced JSON blocks in plain text** — deliberately not vendor function-calling. The dispatcher (`ai/dispatcher.ts`) parses them, validates args against each tool's zod schema, and executes. Unknown tool or malformed JSON → plain text answer, never a crash. This is what makes a 7B Ollama model and a frontier model interchangeable.

### Provider shape

Five of six providers (xAI, OpenAI, Google Gemini compat, DeepSeek, Ollama) are thin presets over `openaiCompat.ts`. Anthropic is the exception with its own adapter. Adding a new provider is typically ~15 lines. **Verify current model IDs against vendor docs at implementation time** — never trust examples in this file or the spec.

### Watcher → workSignal separation

Individual watchers (idle, focus, battery, eyeStrain) **report facts, never moods** — each calls `ctx.report(signal)` with an observed `WorkSignal` and nothing else. Only `src/main/workSignal.ts` translates combined watcher output into mood changes and callout events; it owns work-hours gating, mood precedence (never stomps an interaction mood), meeting-quiet, and routes every callout through `calloutManager` (whose single cooldown is the anti-double-scold). All judgment lives in this one tunable file.

### Core primitives

`src/main/core/` holds shared low-level modules that tools and watchers use via `ToolContext` injection — they never import directly:
- `osascript.ts` — all AppleScript calls go here. Always `execFile` with argument arrays, never `exec` with interpolated strings.
- `speechQueue.ts` — serialized TTS; tools call `ctx.speak()`, never the queue directly.
- `log.ts` — rotating logger to `~/.pixel/logs/`.

### IPC boundary (main ↔ renderer)

The renderer owns the camera pipeline (`vision/`). Camera-derived facts cross IPC as `{present, attention, confidence}` — never pixels or frames. `MoodState` and `ActivityState` (both in `shared/types.ts`) are the only vocabulary shared across the IPC boundary.

## Critical rules

- `src/main/core/osascript.ts` is the only place AppleScript runs. No `child_process.exec` with interpolated user strings anywhere — always `execFile` with arg arrays.
- **No keylogging, ever.** cadenceWatcher counts that input happened via idle-time deltas. No event taps, no key codes, no key content.
- **No cloud vision.** Camera frames never leave the renderer process, never write to disk, never reach any API.
- **Window titles, URLs, cadence, and camera facts never appear in LLM requests.** The AI sees only what the user explicitly typed/said.
- Timing and physics (blink scheduler, idle escalation, speak cadence) belong to main. Packs decide how things look, never when they happen.
- Timeouts and error-wrapping live in registries, not individual tools/watchers.
- TypeScript strict mode. No `any` without a justifying comment.
