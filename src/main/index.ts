import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen, powerMonitor, protocol, net, shell, Notification } from 'electron';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { pathToFileURL } from 'url';
import { config as loadEnv } from 'dotenv';
import ElectronStore from 'electron-store';
import { IPC, CONFIG_DEFAULTS, type Config, type MoodState } from '../shared/types';
import {
  PROVIDER_CATALOG, getProviderInfo,
  TTS_CATALOG, STT_CATALOG, getTTSInfo, getSTTInfo,
} from '../shared/providerCatalog';
import { initSecrets, setApiKey, hasApiKey } from './core/secrets';
import { getCachedModels, setCachedModels } from './core/modelCache';
import { authUrl, exchangeCode } from './core/googleOAuth';
import { ensureWorkspace } from './ai/workspace';
import { migrateLegacyMemory } from './ai/memory';
import { warmRecall } from './memory/recall';
import { configureVault, ensureVault, mirrorTaskAdded, syncActivity } from './core/vault';
import { onActivityFlush } from './core/activityLog';
import { log } from './core/log';
import { StateManager } from './state';
import { speechQueue } from './core/speechQueue';
import { calloutManager } from './watchers/calloutManager';
import { registerWatcher, startAll, stopAll, resetAllWindows } from './watchers/registry';
import { configureWorkSignal, reportSignal, resetWorkSignal } from './workSignal';
import { startBriefing, stopBriefing } from './briefing';
import { IdleWatcher } from './watchers/idle';
import { FocusWatcher } from './watchers/focus';
import { BatteryWatcher } from './watchers/battery';
import { EyeStrainWatcher } from './watchers/eyeStrain';
// AI providers
import { registerProvider, getProvider } from './ai/providers/registry';
import { AuthError } from './ai/providers/types';
import { xaiProvider } from './ai/providers/xai';
import { openaiProvider } from './ai/providers/openai';
import { googleProvider } from './ai/providers/google';
import { deepseekProvider } from './ai/providers/deepseek';
import { ollamaProvider } from './ai/providers/ollama';
import { anthropicProvider } from './ai/providers/anthropic';
import { groqProvider } from './ai/providers/groq';
import { cerebrasProvider } from './ai/providers/cerebras';
// Tools
import { registerMusicTools } from './tools/music';
import { registerSpeechTools } from './tools/speech';
import { registerBrowserTools } from './tools/browser';
import { registerTimerTools } from './tools/timer';
import { registerSearchTools } from './tools/search';
import { registerNewsTools } from './tools/news';
import { registerNotesTools } from './tools/notes';
import { registerSystemTools } from './tools/system';
import { registerWeatherTools } from './tools/weather';
import { registerLauncherTools } from './tools/launcher';
import { registerReminderTools } from './tools/reminders';
import { registerTaskTools } from './tools/tasks';
import { registerClipboardTools } from './tools/clipboard';
import { registerPomodoroTools } from './tools/pomodoro';
import { registerGithubTools } from './tools/github';
import { registerCalendarTools } from './tools/calendar';
import { registerTrelloTools } from './tools/trello';
import { registerGmailTools } from './tools/gmail';
import { registerAppleMailTools } from './tools/appleMail';
import { registerActivityTools } from './tools/activity';
import { registerPageReadTools } from './tools/pageRead';
import { startReminderScheduler, listReminders, removeReminder, clearReminders } from './core/reminders';
import { runScript } from './core/osascript';
import { listTasks, addTask, toggleTask, clearTasks } from './core/tasks';
import { appendChat, recentChat, olderChat, clearChat } from './core/chatHistory';
import { listNotes, addNote, clearNotes } from './core/notes';
import { listSources, clearSources, onSourcesChanged } from './core/sources';
// TTS
import { registerTTSProvider, setActiveTTSProvider, getActiveTTSProvider, getTTSProvider } from './tts/registry';
import { kokoroTTSProvider } from './tts/kokoro';
import { macosTTSProvider } from './tts/macos';
import { elevenlabsTTSProvider } from './tts/elevenlabs';
import { sarvamTTSProvider } from './tts/sarvam';
import { deepgramTTSProvider } from './tts/deepgram';
import { groqTTSProvider } from './tts/groq';
import { openaiTTSProvider } from './tts/openai';
import { cartesiaTTSProvider } from './tts/cartesia';
import { humeTTSProvider } from './tts/hume';
// STT — local (transformers.js, offline) + cloud vendors behind the registry
import { registerSTT, setActiveSTT, getActiveSTT } from './stt/registry';
import {
  transformersWhisperProvider, warmUpWhisper, transcribeAudio,
  detectEndOfTurn, whenTurnReady, wavToFloat32, configureStt,
} from './stt/transformersWhisper';
import { float32ToWav16 } from './stt/wav';
import { groqSTTProvider } from './stt/groq';
import { openaiSTTProvider } from './stt/openai';
import { deepgramSTTProvider } from './stt/deepgram';
import { elevenlabsSTTProvider } from './stt/elevenlabs';
import { sarvamSTTProvider } from './stt/sarvam';
// Voice
import { VoiceController } from './voice/controller';
import { WakeWordGate } from './voice/wakeGate';
// Brain
import { handleUserInput } from './ai/brain';
// Companion liveliness (Phase A)
import { startIdleScheduler, attachGestureReactions, startGazeTracking } from './companion/idleScheduler';

// Load .env from project root (dev) or app resources (packaged)
const envPath = app.isPackaged
  ? path.join(process.resourcesPath, '.env')
  : path.join(__dirname, '..', '..', '..', '.env');
loadEnv({ path: envPath, override: true });

const isDev = process.env.PIXEL_DEV === '1';

// ─── Single-instance lock ────────────────────────────────────────────────────

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// ─── Custom app:// protocol (real origin for AudioWorklet + WASM + modules) ───
// Must be registered before app is ready.
const RENDERER_DIR = path.join(__dirname, '..', '..', '..', 'dist', 'renderer', 'renderer');
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false },
  },
]);

// ─── State ────────────────────────────────────────────────────────────────────

const store = new ElectronStore<Config & { windowBounds: { x: number; y: number } }>({
  defaults: { ...CONFIG_DEFAULTS, windowBounds: { x: -1, y: -1 } },
});

// Backfill newly-added (possibly nested) config fields onto an older persisted
// config. electron-store's `defaults` only fill keys that are entirely absent,
// so adding a sub-field like voice.turnDetection to an existing `voice` object
// would otherwise leave it undefined. Recurse: existing values win, defaults
// fill the gaps.
function backfillDefaults(stored: unknown, defaults: unknown): unknown {
  if (defaults === null || typeof defaults !== 'object' || Array.isArray(defaults)) {
    return stored === undefined ? defaults : stored;
  }
  const out: Record<string, unknown> = { ...(defaults as object), ...((stored as object) ?? {}) };
  for (const k of Object.keys(defaults as object)) {
    out[k] = backfillDefaults((stored as Record<string, unknown> | undefined)?.[k], (defaults as Record<string, unknown>)[k]);
  }
  return out;
}
store.set(backfillDefaults(store.store, CONFIG_DEFAULTS) as Config);

// wakeWords are app-tuned, not user-set (no UI yet), and backfill won't replace an
// existing array — so always pull the latest broadened list from defaults on boot.
store.set('voice.wakeWords', CONFIG_DEFAULTS.voice.wakeWords);

// One-time rename Cosmo → Cosmo (wake word + identity): "Cosmo" is a made-up word
// STT can't transcribe; "Cosmo" is a real word it nails. Only touch the old default
// so a future explicit choice is preserved.
if (store.get('botName') === 'Cosmo') store.set('botName', 'Cosmo');

// `.env` is the switch for which character boots (COSMO_CHARACTER=cosmo|bulma|luffy).
// When set it overrides the persisted choice; when unset, the config default (Cosmo) wins.
const envCharacter = process.env.COSMO_CHARACTER?.trim();
if (envCharacter) store.set('character', envCharacter);

// Seed the editable personality/memory workspace (~/.pixel/workspace) and migrate
// any legacy memory.json into USER.md — one time, before the prompt layer reads it.
{
  const created = ensureWorkspace((store.store as Config).botName ?? 'Cosmo');
  if (created.length) log.info(`Workspace seeded: ${created.join(', ')}`);
  migrateLegacyMemory();
  // Obsidian vault mirror: notes/tasks/reminders are projected here as markdown.
  // Default base is the OS's real Documents folder (no hardcoded path); a configured
  // vault.path overrides it. ensureVault then creates the folders + seed files now.
  configureVault((store.store as Config).vault, app.getPath('documents'));
  const vault = ensureVault();
  if (vault) log.info(`Obsidian vault ready: ${vault}`);
  // Activity.md is regenerated into the vault by activityLog (throttled) — wire the sink.
  onActivityFlush(syncActivity);
  // Warm the embedder + build the semantic-recall index in the background. Best-
  // effort: if it never readies, the prompt layer falls back to full-file injection.
  void warmRecall().catch((e) => log.debug('warmRecall:', (e as Error).message));
}

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
// Tray menu mirrors the avatar's controls, so its labels track renderer state
// (mute on/off, chat open/closed). The renderer reports both over IPC; we cache
// them here and rebuild the menu so labels stay correct.
let rebuildTray: (() => void) | null = null;
let trayMicMuted = false;
let trayChatOpen = false;
export const stateManager = new StateManager();

// Cosmo-initiated heads-up (a fired reminder, a proactive callout, a recap). The
// talk animation already plays whenever he speaks (TTS → 'speaking' mood); this adds
// the VISUAL nudge so an update is never missed: an attention bounce when he's on
// screen, and a native macOS banner (+ peek to front) when he's hidden or muted and
// the audio/animation alone wouldn't reach the user.
function nudge(text: string): void {
  const bw = win;
  if (!bw || bw.isDestroyed()) return;
  const hidden = !bw.isVisible() || bw.isMinimized();
  if (!hidden) bw.webContents.send('cosmo:nudge');
  if (hidden || trayMicMuted) {
    try { if (Notification.isSupported()) new Notification({ title: 'Cosmo', body: text }).show(); }
    catch { /* notifications may be denied — best-effort */ }
    if (hidden) bw.show(); // peek him back so he's visible right after the banner
  }
}

// ─── Window creation ──────────────────────────────────────────────────────────

function createWindow(): BrowserWindow {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workArea;
  const savedBounds = store.get('windowBounds') as { x: number; y: number };

  const x = savedBounds.x >= 0 ? savedBounds.x : sw - 170;
  const y = savedBounds.y >= 0 ? savedBounds.y : 20;

  const bw = new BrowserWindow({
    width: 150,
    height: 160,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true, // programmatic only (frameless ⇒ no user resize handles); needed to widen for the chat column
    hasShadow: false,
    type: 'panel',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Load via custom app:// protocol so AudioWorklet/WASM get a real origin
  bw.loadURL('app://bundle/index.html');

  if (isDev) {
    bw.webContents.openDevTools({ mode: 'detach' });
  }

  // Forward renderer console → main log (debugging without devtools)
  bw.webContents.on('console-message', (_e, level, message) => {
    const tag = level === 3 ? 'RENDERER-ERR' : 'RENDERER';
    if (level >= 2 || message.includes('[voice]') || message.includes('VAD')) {
      log.info(`${tag}: ${message}`);
    }
  });

  // Persist position on move
  bw.on('moved', () => {
    const [bx, by] = bw.getPosition();
    store.set('windowBounds', { x: bx, y: by });
  });

  // Keep always on top after other windows open
  bw.on('blur', () => {
    bw.setAlwaysOnTop(true, 'floating');
  });

  // User interaction — exit bored/annoyed
  ipcMain.on('user:interaction', () => stateManager.onInteraction(bw));

  // Mic-dot click = "I'm talking now" — barge-in: stop whatever Cosmo is saying
  // and flip the eyes to listening for the command window, exactly like a
  // confirmed wake word does. clear() aborts in-flight synthesis + kills afplay.
  ipcMain.on('voice:command-begin', () => {
    speechQueue.clear();
    stateManager.setState('listening', bw, ((store.store as Config).voice.activeWindowSec ?? 9) * 1000);
  });

  // Blur window (used after quick capture)
  ipcMain.on('window:blur', () => bw.blur());

  // Hide to the menu-bar tray — the ✕ on the avatar. Cosmo keeps running (voice,
  // watchers); the tray icon brings him back. Quitting is a separate tray action.
  ipcMain.on('window:hide', () => bw.hide());

  // Chat / dashboard / overlays all change the window width; syncWindow() (below) is
  // the single owner of the avatar-row geometry. Chat just flips its flag and resyncs.
  const BASE_W = 150;
  const CHAT_W = 220; // chat column, added to the RIGHT of the rail (so 150 + 48 + 220)
  ipcMain.on('chat:resize', (_e, data: { open: boolean }) => {
    trayChatOpen = !!data.open;   // keep the tray's Open/Close-chat label honest
    rebuildTray?.();
    syncWindow();
  });

  // ─── Window geometry: ONE owner ────────────────────────────────────────────
  // The window grows to the RIGHT in nested bands: face (150) → +rail (48) → +chat
  // column (220 = 418 total). Five callers used to set bounds independently and
  // fought over the width — a visible chat could end up stranded, clipped into the
  // 48px rail zone. Now syncWindow() is the single owner: it reads the cursor and the
  // open flags and computes the one correct width + whether the rail shows. The
  // rail stays up while chat is open (so the MIC stays reachable beside the chat),
  // while the mic is recording, or on hover. Setup/panel COVER the whole window
  // (own width AND height), so they set their own geometry and syncWindow steps aside.
  const DASH_W = 48; // rail column
  let dashPinned = false; // mic recording pins the rail open (red mic stays visible)
  let setupOpen = false;
  let panelOpen = false;
  let railShown = false;

  function syncWindow(): void {
    if (bw.isDestroyed() || !bw.isVisible()) return;
    if (setupOpen || panelOpen) return; // a covering overlay owns the geometry
    const b = bw.getBounds();
    const p = screen.getCursorScreenPoint();
    const hover = p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
    const wantRail = trayChatOpen || dashPinned || hover;
    const targetW = BASE_W + (trayChatOpen ? DASH_W + CHAT_W : wantRail ? DASH_W : 0);
    const targetH = 160;
    if (b.width !== targetW || b.height !== targetH) {
      const wa = screen.getDisplayMatching(b).workArea;
      let x = b.x;
      if (x + targetW > wa.x + wa.width) x = Math.max(wa.x, wa.x + wa.width - targetW);
      bw.setBounds({ x, y: b.y, width: targetW, height: targetH });
    }
    if (wantRail !== railShown) {
      railShown = wantRail;
      bw.webContents.send('dash:set', { open: wantRail });
    }
  }
  ipcMain.on('dash:pin', (_e, d: { pinned: boolean }) => { dashPinned = !!d.pinned; syncWindow(); });

  // Poll the GLOBAL cursor — Cosmo is a non-activating panel window, so the renderer
  // gets no mousemove unless the app is focused (same reason gaze lives in main).
  // 120ms is imperceptible for a hover reveal and cheap.
  const dashTimer = setInterval(syncWindow, 120);
  bw.on('closed', () => clearInterval(dashTimer));

  // The setup overlay needs far more room than the avatar — grow the window to fit
  // the form, then restore to the avatar size when it closes.
  const SETUP_W = 360, SETUP_H = 510;
  ipcMain.on('setup:resize', (_e, data: { open: boolean }) => {
    setupOpen = !!data.open;
    if (!setupOpen) { syncWindow(); return; } // restore the avatar-row geometry
    const b = bw.getBounds();
    const wa = screen.getDisplayMatching(b).workArea;
    const x = Math.max(wa.x, Math.min(b.x, wa.x + wa.width - SETUP_W));
    const y = Math.max(wa.y, Math.min(b.y, wa.y + wa.height - SETUP_H));
    bw.setBounds({ x, y, width: SETUP_W, height: SETUP_H });
  });

  // The tasks/reminders panel is a scrolling list — narrower than setup, taller
  // than the avatar. Same grow-then-restore dance as setup:resize.
  const PANEL_W = 320, PANEL_H = 460;
  ipcMain.on('panel:resize', (_e, data: { open: boolean }) => {
    panelOpen = !!data.open;
    // On close, syncWindow restores the avatar row — including the chat width + rail
    // if chat was open behind the panel.
    if (!panelOpen) { syncWindow(); return; }
    const b = bw.getBounds();
    const wa = screen.getDisplayMatching(b).workArea;
    const x = Math.max(wa.x, Math.min(b.x, wa.x + wa.width - PANEL_W));
    const y = Math.max(wa.y, Math.min(b.y, wa.y + wa.height - PANEL_H));
    bw.setBounds({ x, y, width: PANEL_W, height: PANEL_H });
  });

  // Renderer errors
  ipcMain.on(IPC.RENDERER_ERROR, (_, data: { message: string }) => {
    log.error('Renderer error:', data.message);
    bw.webContents.send(IPC.CHAT_MESSAGE, {
      text: `Something went wrong: ${data.message}`,
      type: 'bot',
    });
  });

  return bw;
}

// stateManager is exported above

// ─── Tray ─────────────────────────────────────────────────────────────────────

function createTray(bw: BrowserWindow): Tray {
  // Cosmo's eyes as a macOS *template* image. Asset lives at repo-root/assets in
  // dev (up 3 from dist/main/main) and Resources/assets when packaged — same base
  // resolution the .env loader uses. Template = macOS recolours for light/dark.
  const assetBase = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', '..', '..');
  const iconPath = path.join(assetBase, 'assets', 'tray-icon.png');
  let icon: Electron.NativeImage;
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) throw new Error('empty');
  } catch {
    icon = nativeImage.createEmpty();
  }
  icon.setTemplateImage(true);

  const t = new Tray(icon);
  t.setToolTip('Cosmo');

  function buildMenu() {
    return Menu.buildFromTemplate([
      {
        label: bw.isVisible() ? 'Hide Cosmo' : 'Show Cosmo',
        click: () => { if (bw.isVisible()) bw.hide(); else bw.show(); },
      },
      { type: 'separator' },
      // One-at-a-time controls that mirror the avatar's dots, so Cosmo is fully
      // driveable from the menu bar even while the window is hidden. mic/chat
      // reveal the window first; the renderer performs the action via control:do.
      {
        label: 'Talk to Cosmo',
        enabled: !trayMicMuted,
        click: () => { bw.show(); bw.webContents.send('control:do', { action: 'mic' }); },
      },
      {
        label: trayChatOpen ? 'Close chat' : 'Open chat',
        click: () => { bw.show(); bw.webContents.send('control:do', { action: 'chat' }); },
      },
      {
        label: 'Tasks & reminders…',
        click: () => { bw.show(); bw.webContents.send('control:do', { action: 'panel' }); },
      },
      {
        label: trayMicMuted ? 'Unmute' : 'Mute (silence & stop listening)',
        click: () => { bw.webContents.send('control:do', { action: 'mute' }); },
      },
      { type: 'separator' },
      {
        label: 'AI setup (vendor, model, key)…',
        click: () => { bw.show(); bw.webContents.send('setup:open'); },
      },
      {
        label: 'Clear conversation',
        click: () => {
          void clearChat();                  // wipe the durable transcript
          bw.webContents.send('chat:clear'); // clear the DOM + show the notice
        },
      },
      { type: 'separator' },
      {
        label: 'Quit Cosmo',
        click: () => app.quit(),
      },
    ]);
  }

  function buildAndSetMenu() {
    t.setContextMenu(buildMenu());
  }

  rebuildTray = buildAndSetMenu;
  // Keep the Show/Hide label correct however the window is toggled — the avatar's
  // ✕ button (window:hide), a tray show(), or a programmatic show/hide all fire
  // these, so the menu never goes stale.
  bw.on('hide', buildAndSetMenu);
  bw.on('show', buildAndSetMenu);

  buildAndSetMenu();
  return t;
}

// ─── Sleep/wake reset ─────────────────────────────────────────────────────────

function onSystemResume(): void {
  log.info('System resumed from sleep — resetting watcher windows');
  speechQueue.clear();
  resetAllWindows();
  resetWorkSignal();
  calloutManager.resetLastCalloutTime();
  if (win) stateManager.setState('idle', win);
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────

ipcMain.handle(IPC.SETTINGS_GET, () => {
  return store.store;
});

ipcMain.handle(IPC.SETTINGS_SET, (_, data: { key: string; value: unknown }) => {
  store.set(data.key, data.value);
  // Broadcast updated config to renderer
  win?.webContents.send(IPC.SETTINGS_GET, store.store);
  return true;
});

// Renderer-driven character switch: persist the choice and adopt its voice.
// (The voice id lives in the renderer-side character manifest, so it's sent here.)
ipcMain.handle('character:set', (_, data: { id: string; voice?: string }) => {
  store.set('character', data.id);
  speechQueue.setVoice(data.voice);
  log.info(`Character → ${data.id} (voice: ${data.voice ?? 'default'})`);
  return true;
});

// ─── Tasks & reminders panel ────────────────────────────────────────────────
// The panel is a thin window onto the shared core/tasks + core/reminders stores.
// Each mutation handler returns the fresh snapshot so the renderer re-renders from
// the response; `panel:changed` is pushed only for changes the panel didn't make
// itself (a reminder firing), so an already-open panel stays live.
function panelState(): {
  tasks: ReturnType<typeof listTasks>;
  reminders: ReturnType<typeof listReminders>;
  notes: ReturnType<typeof listNotes>;
  sources: ReturnType<typeof listSources>;
} {
  return { tasks: listTasks(), reminders: listReminders(), notes: listNotes(), sources: listSources() };
}

ipcMain.handle('panel:state', () => panelState());

// When a web search records new sources, push a refresh so an open Sources tab
// updates live (the tool can't reach the window; the store notifies us instead).
onSourcesChanged(() => win?.webContents.send('panel:changed'));

ipcMain.handle('task:add', (_, data: { text?: string }) => {
  const text = (data?.text ?? '').trim();
  if (text) { addTask(text); mirrorTaskAdded(text); }
  return panelState();
});

ipcMain.handle('task:toggle', (_, data: { id: number }) => {
  if (typeof data?.id === 'number') toggleTask(data.id);
  return panelState();
});

ipcMain.handle('task:clear', (_, data: { allTasks?: boolean }) => {
  clearTasks(!!data?.allTasks);
  return panelState();
});

ipcMain.handle('reminder:remove', (_, data: { id: string }) => {
  if (data?.id) removeReminder(data.id);
  return panelState();
});

ipcMain.handle('reminder:clear', () => {
  clearReminders();
  return panelState();
});

ipcMain.handle('note:add', (_, data: { text?: string }) => {
  const text = (data?.text ?? '').trim();
  if (text) addNote(text);
  return panelState();
});

ipcMain.handle('note:clear', () => {
  clearNotes();
  return panelState();
});

ipcMain.handle('source:clear', () => {
  clearSources();
  return panelState();
});

// Open a source's article in the user's real browser (never in-app — these are
// external news links). Best-effort; an empty/blank url is ignored.
ipcMain.handle('source:open', (_, data: { url?: string }) => {
  const url = (data?.url ?? '').trim();
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url).catch(() => {});
  return { ok: true };
});

// ─── Setup / onboarding (vendor + model + API key) ──────────────────────────
// Env var name for a provider's key (matches the providers' apiKeyEnv).
const envVarFor = (id: string): string | undefined => (id === 'ollama' ? undefined : `${id.toUpperCase()}_API_KEY`);

// Which secret ids have a usable key on file (stored or env). The renderer uses
// this to skip the key field for a vendor whose key is already known — e.g. the
// Groq/OpenAI TTS voices reuse the LLM key, so picking them needs no re-entry.
function buildSecretsPresent(): Record<string, boolean> {
  const ids = new Set<string>();
  for (const p of PROVIDER_CATALOG) if (p.needsKey) ids.add(p.id);
  for (const t of TTS_CATALOG) if (t.needsKey) ids.add(t.keyId ?? t.id);
  for (const s of STT_CATALOG) if (s.needsKey) ids.add(s.keyId ?? s.id);
  const out: Record<string, boolean> = {};
  for (const id of ids) out[id] = hasApiKey(id, envVarFor(id));
  return out;
}

// Current setup state — drives the first-run overlay and pre-fills all three tabs
// (Brain / Voice / Ears).
ipcMain.handle('setup:state', () => {
  const cfg = store.store as Config;
  const provider = cfg.llm.provider;
  const info = getProviderInfo(provider);
  const keyPresent = info && !info.needsKey ? true : hasApiKey(provider, envVarFor(provider));
  return {
    needsSetup: !cfg.onboarded && !keyPresent, // first run AND no usable key (env or stored)
    provider,
    model: cfg.llm.model,
    hasKey: keyPresent,
    catalog: PROVIDER_CATALOG,
    secretsPresent: buildSecretsPresent(),
    tts: { provider: cfg.tts.provider, voice: cfg.tts.voice ?? '' },
    ttsCatalog: TTS_CATALOG,
    stt: { provider: cfg.stt.provider, model: cfg.stt.model ?? '' },
    sttCatalog: STT_CATALOG,
    alwaysListen: cfg.voice.alwaysListen,
    smartFocus: cfg.activity?.smartFocus ?? false,
    accounts: {
      // Calendar is always available (native macOS, no creds). Gmail is connected
      // once we hold a client id + (encrypted) secret + refresh token.
      calendar: { native: true },
      gmail: {
        connected:
          !!(cfg.integrations?.google?.clientId || process.env.GOOGLE_CLIENT_ID) &&
          hasApiKey('googleClientSecret', 'GOOGLE_CLIENT_SECRET') &&
          hasApiKey('googleRefreshToken', 'GOOGLE_REFRESH_TOKEN'),
        email: cfg.integrations?.google?.email ?? '',
        clientId: cfg.integrations?.google?.clientId ?? '',
      },
    },
  };
});

// Validate a (provider, model, key) by making one tiny chat call. Does not persist
// the choice — only stages the key in memory so the call can use it.
ipcMain.handle('setup:test', async (_, data: { provider: string; model: string; key?: string }) => {
  const info = getProviderInfo(data.provider);
  if (!info) return { ok: false, error: `Unknown vendor '${data.provider}'` };
  if (info.needsKey && data.key) setApiKey(data.provider, data.key.trim());
  if (info.needsKey && !hasApiKey(data.provider, envVarFor(data.provider))) return { ok: false, error: 'Enter an API key first.' };
  const provider = getProvider(data.provider);
  if (!provider) return { ok: false, error: `Vendor '${data.provider}' is not available.` };
  try {
    const res = await provider.chat({
      system: 'You are a connection test. Reply with the single word OK.',
      model: data.model,
      messages: [{ role: 'user', content: 'Say OK.' }],
      // Generous on purpose: reasoning models (gpt-oss, o-series, qwen-thinking)
      // spend tokens on a hidden reasoning channel BEFORE emitting content. A tiny
      // budget gets consumed by reasoning and returns empty content — a false
      // "connection failed" for a key + model that actually work fine.
      maxTokens: 1024,
    });
    if (!res.text?.trim()) return { ok: false, error: 'Empty reply — check the model id.' };
    return { ok: true };
  } catch (e) {
    const msg = e instanceof AuthError ? 'Invalid API key.' : (e as Error).message || 'Connection failed.';
    return { ok: false, error: msg };
  }
});

// Live model list for the setup dropdown: the models a vendor ACTUALLY exposes
// (installed Ollama models, the current cloud catalog) rather than a hardcoded list
// that drifts. A just-typed key is applied first (like setup:test) so cloud lookups
// authenticate. Failure returns ok:false and the renderer keeps the static fallback.
ipcMain.handle('setup:models', async (_, data: { provider: string; key?: string }) => {
  const info = getProviderInfo(data.provider);
  if (!info) return { ok: false, models: [] as string[] };
  const typedKey = !!(info.needsKey && data.key?.trim());
  if (typedKey) setApiKey(data.provider, data.key!.trim());
  if (info.needsKey && !hasApiKey(data.provider, envVarFor(data.provider))) return { ok: false, models: [] as string[] };

  // Cloud lists are cached for 24h (network + rate limits); local Ollama isn't —
  // its lookup is free and a just-pulled model should appear at once. A freshly
  // typed key always forces a refetch (the cache may be empty / from another key).
  const cacheable = info.needsKey;
  if (cacheable && !typedKey) {
    const cached = getCachedModels(data.provider);
    if (cached?.length) return { ok: true, models: cached, cached: true };
  }

  const provider = getProvider(data.provider);
  if (!provider?.listModels) return { ok: false, models: [] as string[] };
  try {
    const models = await provider.listModels();
    if (cacheable && models.length) setCachedModels(data.provider, models);
    return { ok: models.length > 0, models };
  } catch (e) {
    // Live lookup failed — a stale (>24h) cached list still beats nothing.
    if (cacheable) {
      const stale = getCachedModels(data.provider, true);
      if (stale?.length) return { ok: true, models: stale, cached: true };
    }
    const msg = e instanceof AuthError ? 'Invalid API key.' : (e as Error).message || 'Lookup failed.';
    return { ok: false, models: [] as string[], error: msg };
  }
});

// Persist the chosen brain (vendor + model + key), and optionally the voice (TTS
// provider + voice + its key) and ears (STT model). Marks onboarding complete.
// TTS applies live; an STT model change applies on next launch (the forked ASR
// worker loads its model at boot).
ipcMain.handle('setup:save', (_, data: {
  provider: string; model: string; key?: string;
  tts?: { provider: string; voice: string; key?: string };
  stt?: { provider: string; model: string; key?: string };
  voice?: { alwaysListen: boolean };
  activity?: { smartFocus: boolean };
}) => {
  const info = getProviderInfo(data.provider);
  if (!info) return { ok: false, error: `Unknown vendor '${data.provider}'` };
  if (info.needsKey && data.key) store.set(`secrets.${data.provider}`, setApiKey(data.provider, data.key.trim()));
  if (info.needsKey && !hasApiKey(data.provider, envVarFor(data.provider))) return { ok: false, error: 'An API key is required for this vendor.' };
  store.set('llm.provider', data.provider);
  store.set('llm.model', data.model.trim() || info.models[0]);

  // Voice (TTS) — seal its key (possibly shared with an LLM vendor), switch the
  // active provider, and apply the voice immediately.
  if (data.tts) {
    const tinfo = getTTSInfo(data.tts.provider);
    if (!tinfo) return { ok: false, error: `Unknown voice '${data.tts.provider}'` };
    const keyId = tinfo.keyId ?? tinfo.id;
    if (tinfo.needsKey && data.tts.key) store.set(`secrets.${keyId}`, setApiKey(keyId, data.tts.key.trim()));
    if (tinfo.needsKey && !hasApiKey(keyId, envVarFor(keyId))) return { ok: false, error: `An API key is required for ${tinfo.label}.` };
    store.set('tts.provider', data.tts.provider);
    store.set('tts.voice', data.tts.voice);
    try { setActiveTTSProvider(data.tts.provider); } catch (e) { log.warn('setActiveTTS failed:', (e as Error).message); }
    speechQueue.setVoice(data.tts.voice);
    if (data.tts.provider === 'kokoro') kokoroTTSProvider.init?.().catch(() => {});
  }

  // Ears (STT) — seal its (shared) key, switch the active provider live. A cloud
  // provider takes effect on the next utterance; a LOCAL model change is persisted
  // but applies next launch (the worker loads its model at boot).
  if (data.stt) {
    const sinfo = getSTTInfo(data.stt.provider);
    if (!sinfo) return { ok: false, error: `Unknown ears '${data.stt.provider}'` };
    const keyId = sinfo.keyId ?? sinfo.id;
    if (sinfo.needsKey && data.stt.key) store.set(`secrets.${keyId}`, setApiKey(keyId, data.stt.key.trim()));
    if (sinfo.needsKey && !hasApiKey(keyId, envVarFor(keyId))) return { ok: false, error: `An API key is required for ${sinfo.label}.` };
    store.set('stt.provider', data.stt.provider);
    store.set('stt.model', data.stt.model);
    try { setActiveSTT(data.stt.provider); } catch (e) { log.warn('setActiveSTT failed:', (e as Error).message); }
  }

  // Ears (listening mode) — push-to-talk vs always-listen wake word. wantListening()
  // in the boot loop reads this live, so the main side needs no other nudge; we send
  // voice:mode so the renderer starts/stops its continuous mic to match, right away.
  if (data.voice) {
    store.set('voice.alwaysListen', !!data.voice.alwaysListen);
    win?.webContents.send('voice:mode', { alwaysListen: !!data.voice.alwaysListen });
  }

  // Smart Focus opt-in (default off): when on, the focus watcher may ask the configured
  // LLM to label apps the heuristic can't place (app name + window title only).
  if (data.activity) store.set('activity.smartFocus', !!data.activity.smartFocus);

  store.set('onboarded', true);
  win?.webContents.send(IPC.SETTINGS_GET, store.store);
  log.info(`Setup saved → brain ${data.provider}/${data.model}${data.tts ? ` · voice ${data.tts.provider}/${data.tts.voice || 'default'}` : ''}${data.stt ? ` · ears ${data.stt.provider}/${data.stt.model}` : ''}${data.voice ? ` · ${data.voice.alwaysListen ? 'always-listen' : 'push-to-talk'}` : ''}`);
  return { ok: true };
});

// ─── Accounts: Google (Gmail) connect via OAuth loopback ─────────────────────
// One-time interactive sign-in: spin up a localhost server on an ephemeral port,
// open the system browser to Google's consent screen, catch the redirect carrying
// the auth code, trade it for a refresh token, and store the sensitive bits
// ENCRYPTED (client secret + refresh token via safeStorage). clientId/email are
// non-secret → plain config. The Gmail tools then run statelessly (refresh→access
// per call). Read-only Gmail scope. Use a Google "Desktop app" OAuth client so the
// 127.0.0.1 loopback redirect is allowed without registering a fixed port.
function connectGoogleLoopback(clientId: string, clientSecret: string): Promise<{ refreshToken: string; accessToken: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    let settled = false;
    const done = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { server.close(); } catch { /* already closing */ }
      fn();
    };
    const timer = setTimeout(() => done(() => reject(new Error('Sign-in timed out — please try again.'))), 180000);

    server.on('request', async (req, res) => {
      const u = new URL(req.url ?? '/', 'http://127.0.0.1');
      const code = u.searchParams.get('code');
      const err = u.searchParams.get('error');
      if (!code && !err) { res.writeHead(204); res.end(); return; }   // favicon etc.
      const okFlow = !!code && !err;
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!doctype html><meta charset="utf-8"><body style="font-family:-apple-system,system-ui;text-align:center;padding:48px;color:#1e1e2e"><h2>${okFlow ? 'Cosmo is connected ✓' : 'Sign-in failed'}</h2><p>You can close this tab and return to Cosmo.</p></body>`);
      const port = (server.address() as import('net').AddressInfo).port;
      if (!okFlow) return done(() => reject(new Error(err || 'No authorization code returned.')));
      try {
        const tokens = await exchangeCode(clientId, clientSecret, code as string, `http://127.0.0.1:${port}`);
        if (!tokens.refreshToken) {
          return done(() => reject(new Error('Google returned no refresh token — revoke Cosmo at myaccount.google.com/permissions and try again.')));
        }
        done(() => resolve({ refreshToken: tokens.refreshToken as string, accessToken: tokens.accessToken }));
      } catch (e) { done(() => reject(e as Error)); }
    });
    server.on('error', (e) => done(() => reject(e)));
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as import('net').AddressInfo).port;
      shell.openExternal(authUrl(clientId, `http://127.0.0.1:${port}`)).catch((e) => done(() => reject(e as Error)));
    });
  });
}

ipcMain.handle('accounts:connectGoogle', async (_, data: { clientId: string; clientSecret: string }) => {
  const clientId = (data.clientId || '').trim();
  const clientSecret = (data.clientSecret || '').trim();
  if (!clientId || !clientSecret) return { ok: false, error: 'Enter both the Client ID and Client secret first.' };
  try {
    const { refreshToken, accessToken } = await connectGoogleLoopback(clientId, clientSecret);
    let email = '';
    try {
      const p = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: `Bearer ${accessToken}` } });
      if (p.ok) email = ((await p.json()) as { emailAddress?: string }).emailAddress ?? '';
    } catch { /* the "connected as …" label is optional */ }

    store.set('integrations.google.clientId', clientId);
    store.set('integrations.google.email', email);
    store.set('secrets.googleClientSecret', setApiKey('googleClientSecret', clientSecret));
    store.set('secrets.googleRefreshToken', setApiKey('googleRefreshToken', refreshToken));
    log.info(`Gmail connected${email ? ` as ${email}` : ''} (refresh token stored encrypted).`);
    return { ok: true, email };
  } catch (e) {
    log.warn('Gmail connect failed:', (e as Error).message);
    return { ok: false, error: (e as Error).message };
  }
});

ipcMain.handle('accounts:disconnectGoogle', () => {
  store.set('integrations.google.clientId', '');
  store.set('integrations.google.email', '');
  store.set('secrets.googleClientSecret', setApiKey('googleClientSecret', ''));
  store.set('secrets.googleRefreshToken', setApiKey('googleRefreshToken', ''));
  log.info('Gmail disconnected.');
  return { ok: true };
});

// Speak a one-line sample in a chosen voice WITHOUT persisting anything — stages
// the key in memory so the call can use it, then uses the strict `preview` path
// (no silent fallback) so a bad key / wrong voice surfaces as an error.
ipcMain.handle('setup:previewVoice', async (_, data: { provider: string; voice: string; key?: string }) => {
  const tinfo = getTTSInfo(data.provider);
  if (!tinfo) return { ok: false, error: `Unknown voice '${data.provider}'` };
  const keyId = tinfo.keyId ?? tinfo.id;
  if (tinfo.needsKey && data.key) setApiKey(keyId, data.key.trim());
  if (tinfo.needsKey && !hasApiKey(keyId, envVarFor(keyId))) return { ok: false, error: 'Enter an API key first.' };
  const provider = getTTSProvider(data.provider);
  if (!provider) return { ok: false, error: `Voice '${data.provider}' is not available.` };
  try {
    if (data.provider === 'kokoro') await kokoroTTSProvider.init?.();
    const sample = "Hi! I'm Cosmo — this is how I sound.";
    // Offline providers can't fail on a key, so `speak` is fine; cloud providers
    // use the strict `preview` so real errors propagate.
    await (provider.preview ?? provider.speak).call(provider, sample, { voice: data.voice || tinfo.defaultVoice });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message || 'Preview failed.' };
  }
});

ipcMain.handle(IPC.CHAT_SUBMIT, async (_, data: { text: string; captureOnly?: boolean }) => {
  if (!win) return;
  if (data.captureOnly) {
    const { executeTool } = await import('./tools/registry');
    const toolCtx = {
      config: store.store as Config,
      speak: (t: string) => speechQueue.enqueue(t),
      setMood: (s: MoodState, dur?: number) => stateManager.setState(s, win!, dur),
      setActivity: (a: import('../shared/types').ActivityState | null) => stateManager.setActivity(a, win!),
      log,
    };
    await executeTool('notes.capture', { text: data.text }, toolCtx);
    win.webContents.send(IPC.CHAT_MESSAGE, { text: 'Captured.', type: 'bot' });
    win.webContents.send('panel:changed'); // refresh an open Notes tab
    win.blur();
    return;
  }
  await handleUserInput(
    data.text,
    win,
    store.store as Config,
    (s: MoodState, dur?: number) => stateManager.setState(s, win!, dur),
    (a) => stateManager.setActivity(a, win!),
  );
  return true;
});

// ─── Chat transcript persistence ───────────────────────────────────────────────
// Every message shown in the chat window is mirrored to disk by the renderer (one
// choke point: appendMessage). On open the renderer asks for the last few; scrolling
// up pulls older batches. Keeps the DOM light while the full history survives restarts.
ipcMain.on('chat:persist', (_e, d: { text: string; type: 'user' | 'bot' }) => {
  void appendChat(d.type, d.text);
});
ipcMain.handle('chat:recent', (_e, d: { limit?: number }) => recentChat(d?.limit ?? 5));
ipcMain.handle('chat:older', (_e, d: { before: number; limit?: number }) => olderChat(d.before, d.limit ?? 10));

// End the running focus timer from the UI (the ✕ on the timer pill). Reuses the same
// pomodoro.stop tool the voice path calls, so both routes cancel identically.
ipcMain.handle('pomodoro:stop', async () => {
  if (!win) return;
  const { executeTool } = await import('./tools/registry');
  await executeTool('pomodoro.stop', {}, {
    config: store.store as Config,
    speak: (t: string) => speechQueue.enqueue(t),
    setMood: (s: MoodState, dur?: number) => stateManager.setState(s, win!, dur),
    setActivity: (a: import('../shared/types').ActivityState | null) => stateManager.setActivity(a, win!),
    log,
  });
  win.webContents.send('panel:changed');
});

// ─── Dev shortcuts (PIXEL_DEV=1) ──────────────────────────────────────────────

function registerDevShortcuts(bw: BrowserWindow): void {
  if (!isDev) return;
  const moods: MoodState[] = ['idle', 'listening', 'thinking', 'speaking', 'happy', 'bored', 'annoyed', 'sleeping'];
  // Register via keydown in renderer — main process global shortcuts conflict with other apps in dev
  log.info('Dev mode active — press 1-8 in the Cosmo window to switch moods');

  bw.webContents.executeJavaScript(`
    document.addEventListener('keydown', (e) => {
      const idx = parseInt(e.key) - 1;
      const moods = ['idle','listening','thinking','speaking','happy','bored','annoyed','sleeping'];
      if (idx >= 0 && idx < moods.length) {
        window.cosmo.invoke('dev:setMood', { state: moods[idx] });
      }
    });
  `).catch(() => {});

  ipcMain.handle('dev:setMood', (_, { state }: { state: import('../shared/types').MoodState }) => {
    // Mirror production auto-revert so the preview is faithful: happy and listening
    // are transient and time out on their own (listening uses the real wake window),
    // the rest hold indefinitely so you can study them.
    const revert =
      state === 'happy' ? 2000 :
      state === 'listening' ? ((store.store as Config).voice.activeWindowSec ?? 9) * 1000 :
      undefined;
    stateManager.setState(state, bw, revert);
  });
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.on('second-instance', () => {
  if (win) { win.show(); win.focus(); }
});

app.whenReady().then(() => {
  app.dock.hide();
  app.setLoginItemSettings({ openAtLogin: true, path: process.execPath });

  // Serve renderer assets over app:// (bundle host → dist/renderer/renderer/)
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    // app://bundle/<path>
    let filePath = decodeURIComponent(url.pathname);
    if (filePath === '/' || filePath === '') filePath = '/index.html';
    const abs = path.join(RENDERER_DIR, filePath);
    // Prevent path traversal outside RENDERER_DIR
    if (!abs.startsWith(RENDERER_DIR)) {
      return new Response('Forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(abs).toString());
  });

  win = createWindow();
  tray = createTray(win);

  if (isDev) registerDevShortcuts(win);

  // STT — local ASR (transformers.js) + cloud vendors. The forked worker ALWAYS
  // loads a local model: it powers Smart Turn end-of-turn detection regardless of
  // which provider transcribes, and is the offline fallback. So feed configureStt a
  // valid LOCAL model even when a cloud provider is active (whose model id — e.g.
  // 'nova-3' — the worker couldn't load).
  const DEFAULT_LOCAL_STT = 'onnx-community/moonshine-base-ONNX';
  const sttCfg = (store.store as Config).stt;
  const localSttModel = sttCfg.provider === 'whisperLocal' ? (sttCfg.model || DEFAULT_LOCAL_STT) : DEFAULT_LOCAL_STT;
  configureStt(localSttModel, sttCfg.dtype);
  registerSTT(transformersWhisperProvider);
  registerSTT(groqSTTProvider);
  registerSTT(openaiSTTProvider);
  registerSTT(deepgramSTTProvider);
  registerSTT(elevenlabsSTTProvider);
  registerSTT(sarvamSTTProvider);
  try { setActiveSTT(sttCfg.provider || 'whisperLocal'); }
  catch { log.warn(`STT provider '${sttCfg.provider}' not found, using local`); setActiveSTT('whisperLocal'); }
  const bw = win; // non-null — we're inside whenReady after createWindow()

  // Companion liveliness (Phase A): idle micro-behaviours + cursor-follow gaze
  // + shake/pick-up reactions.
  const stopIdleScheduler = startIdleScheduler({ win: bw, state: stateManager, dev: isDev });
  const stopGazeTracking = startGazeTracking(bw, stateManager);
  attachGestureReactions(bw, stateManager);
  app.on('before-quit', () => { stopIdleScheduler(); stopGazeTracking(); });

  // ─── Boot progress — the renderer's loader overlay waits on this ───────────
  const bootState = { tts: false, stt: false, turn: false };
  const bootReady = (): boolean => bootState.tts && bootState.stt && bootState.turn;
  function markBoot(part: 'tts' | 'stt' | 'turn', label: string): void {
    if (bootState[part]) return;
    bootState[part] = true;
    bw.webContents.send('boot:status', { part, label, ready: bootReady() });
    log.info(`Boot: ${label} (${Object.values(bootState).filter(Boolean).length}/3)`);
    if (bootReady()) bw.webContents.send('boot:ready', {});
  }
  ipcMain.handle('boot:state', () => ({ ...bootState, ready: bootReady() }));
  // Safety net: never let a stuck subsystem trap the loader forever.
  setTimeout(() => { markBoot('tts', 'voice'); markBoot('stt', 'ears'); markBoot('turn', 'turn detection'); }, 25_000);

  // Warm up the voice worker (STT + Smart Turn) in the background.
  warmUpWhisper().catch((e) => log.warn('ASR warmup:', e.message)).finally(() => markBoot('stt', 'ears (ASR)'));
  whenTurnReady().then(() => markBoot('turn', 'turn detection (Smart Turn v3)'));

  // ─── Always-on voice loop: wake word + Smart Turn endpointing ──────────────
  const wakeGate = new WakeWordGate(() => store.store as Config);
  // Single-turn interaction: the wake word opens one listen window (activeWindowSec).
  // The next utterance is the command; after Cosmo answers we CLOSE the window, so he
  // goes quiet and the wake word is required again. The mic stays physically on in the
  // background only to hear "Cosmo" — it just won't act on speech until re-woken. (We
  // used to re-open a rolling 15s conversation window here, which made him respond to
  // everything continuously — that's the "listening forever" behaviour we removed.)
  // Two independent gates: alwaysListen (config — is the mic open for the wake
  // word at all?) and micMuted (the user's full-mute toggle). Read alwaysListen
  // LIVE from config so toggling it in setup → Ears takes effect immediately
  // without a relaunch. In push-to-talk mode (alwaysListen off) wantListening()
  // is always false, so the mic only opens for the duration of a mic-dot click.
  let micMuted = false;
  const wantListening = (): boolean => (store.store as Config).voice.alwaysListen && !micMuted;
  let turnBuf: Float32Array | null = null;  // accumulates one turn across VAD pauses
  let turnMode: 'wake' | 'command' = 'wake';
  let turnTimer: ReturnType<typeof setTimeout> | null = null;
  let sttBusy = false;

  // Whisper routinely hallucinates these on near-silence / noise — never act on
  // them. NOTE: we deliberately do NOT reject lone single words here anymore —
  // that rule used to swallow the bare wake word ("Cosmo") and one-word commands
  // ("stop", "yes"). The wake gate runs first and already ignores non-wake speech,
  // so this guard now only suppresses known hallucinations on post-wake commands.
  const HALLUCINATIONS = new Set([
    'thank you', 'thanks for watching', 'thank you for watching', 'thank you very much',
    'we will see you next time', 'see you next time', 'please subscribe', 'subscribe',
    'bye', 'bye bye', 'the end', 'thanks', 'you',
  ]);
  const isHallucination = (t: string): boolean => {
    const n = t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
    return !n || HALLUCINATIONS.has(n);
  };

  const setListening = (active: boolean): void => {
    bw.webContents.send('voice:listen', { active: active && wantListening() });
  };
  // Mute the mic while Cosmo is talking so it never transcribes its own voice,
  // and use the same signal to end the 'speaking' mood. onActivity(false) fires
  // when the TTS queue actually drains, so the talk animation can never outlive
  // the audio (the old WPM time-estimate in brain.ts overshot and left the mouth
  // flapping after he went quiet).
  speechQueue.onActivity((speaking) => {
    if (speaking) {
      bw.webContents.send('voice:listen', { active: false });
    } else {
      if (stateManager.getState() === 'speaking') stateManager.setState('idle', bw);
      if (wantListening()) setTimeout(() => setListening(true), 600);
    }
  });
  // The 'speaking' mood (→ talk animation) is driven by REAL audio start, not by
  // enqueue: with cloud TTS there's ~1s of fetch before any sound, and the old
  // code set 'speaking' at enqueue so the mouth/bob led the voice. onAudioActivity
  // fires the moment a provider actually begins playing (see onAudioStart).
  speechQueue.onAudioActivity((playing) => {
    if (playing) stateManager.setState('speaking', bw);
    else if (stateManager.getState() === 'speaking') stateManager.setState('idle', bw);
  });

  // Full mute toggle (renderer's mute button beside the mic). Muted = no voice
  // out AND no listening, until the user un-mutes. Flip the master mic gate, kill
  // any in-flight speech, and disable the queue so nothing can speak. Un-mute
  // restores listening to the configured default.
  ipcMain.on('voice:mute', (_e, data: { muted?: boolean }) => {
    const muted = !!data?.muted;
    micMuted = muted;   // wantListening() re-derives from this + config.alwaysListen
    speechQueue.setEnabled(!muted);   // setEnabled(false) also clears + aborts current speech
    setListening(!muted);             // pause/resume the renderer mic
    if (muted && stateManager.getState() === 'speaking') stateManager.setState('idle', bw);
    trayMicMuted = muted;   // keep the tray's Mute/Unmute + Talk-enabled state honest
    rebuildTray?.();
    log.info(`Full mute → ${muted ? 'ON (silent + not listening)' : 'OFF'}`);
  });

  const concatF32 = (a: Float32Array | null, b: Float32Array): Float32Array => {
    if (!a) return b;
    const out = new Float32Array(a.length + b.length);
    out.set(a, 0); out.set(b, a.length);
    return out;
  };
  const capLast = (a: Float32Array, max: number): Float32Array =>
    (a.length <= max ? a : a.slice(a.length - max));
  const clearTurnTimer = (): void => { if (turnTimer) { clearTimeout(turnTimer); turnTimer = null; } };

  async function dispatchCommand(text: string): Promise<void> {
    stateManager.setState('thinking', bw);
    bw.webContents.send(IPC.CHAT_MESSAGE, { text, type: 'user' });
    await handleUserInput(
      text, bw, store.store as Config,
      (s, dur) => stateManager.setState(s, bw, dur),
      (a) => stateManager.setActivity(a, bw),
    );
  }

  // Transcribe a 16kHz Float32 turn through the ACTIVE STT provider. Local stays on
  // the fast Float32→worker path; a cloud vendor gets the turn encoded to a WAV
  // buffer and picks its model from config at call time. (Smart Turn end-of-turn
  // detection always ran locally above — only this final transcription is pluggable.)
  async function transcribeTurn(pcm: Float32Array): Promise<string> {
    const active = getActiveSTT();
    if (active.offline) return transcribeAudio(pcm);
    return active.transcribe(float32ToWav16(pcm, 16000), { model: (store.store as Config).stt.model });
  }

  // Transcribe the accumulated turn and act on it (wake gate or direct command).
  async function finalizeTurn(): Promise<void> {
    clearTurnTimer();
    const audio = turnBuf; turnBuf = null;
    const mode = turnMode; turnMode = 'wake';
    if (!audio || sttBusy) return;
    try {
      // Mic off → 'thinking' the instant we commit to transcribing a command, so
      // the eyes never sit in 'listening' through STT + LLM. Covers the explicit
      // mic-click (mode 'command') AND a post-wake command (window still open).
      // Ambient wake-word detection (window closed) deliberately stays
      // non-thinking, so he doesn't "think" at every bit of background speech.
      const expectingCommand = mode === 'command' || wakeGate.isAwaitingCommand(Date.now());
      if (expectingCommand) stateManager.setState('thinking', bw);
      sttBusy = true;
      const text = (await transcribeTurn(audio)).trim();
      sttBusy = false;

      if (mode === 'command') {
        if (!text) { stateManager.setState('idle', bw); return; }
        await dispatchCommand(text);
        wakeGate.closeWindow(); // single-turn: require the wake word again for the next command
        return;
      }
      // Wake gate FIRST — so a bare "Cosmo" wakes instead of being swallowed by
      // the noise filter. The filter only applies to the resulting command text.
      const decision = wakeGate.decide(text, Date.now());
      log.info(`wake turn: "${text || '(empty)'}" → ${decision.kind}`);
      if (decision.kind === 'wake') {
        stateManager.pulse('happy', bw);
        stateManager.setState('listening', bw, ((store.store as Config).voice.activeWindowSec ?? 9) * 1000);
      } else if (decision.kind === 'command') {
        // A post-wake command can be a Whisper hallucination on silence — drop the
        // known junk phrases, but let real words (incl. one-word commands) through.
        if (isHallucination(decision.text)) { log.debug('ignored (noise command):', decision.text || '(empty)'); stateManager.setState('idle', bw); return; }
        await dispatchCommand(decision.text);
        wakeGate.closeWindow(); // single-turn: require the wake word again for the next command
      } else {
        log.debug('heard (no wake):', text || '(empty)');
        stateManager.setState('idle', bw);
      }
    } catch (e: unknown) {
      sttBusy = false;
      log.error('finalizeTurn:', (e as Error).message);
      stateManager.setState('idle', bw);
    }
  }

  // voice:audio — renderer streams each VAD segment. mode 'command' (mic click)
  // is always a command; 'wake' goes through the wake-word gate.
  ipcMain.on('voice:audio', async (_, data: { wav: number[]; mode?: 'wake' | 'command' }) => {
    // Whole body guarded: an unhandled rejection here would be fatal — Kokoro's
    // espeak/phonemizer WASM installs a rethrowing unhandledRejection handler.
    try {
      const cfg = store.store as Config;
      const td = cfg.voice.turnDetection ?? CONFIG_DEFAULTS.voice.turnDetection;
      const mode = data.mode ?? 'wake';
      const seg = wavToFloat32(Buffer.from(data.wav));

      clearTurnTimer();
      if (mode === 'wake' && sttBusy) return; // a turn is already being transcribed
      if (mode === 'command') turnMode = 'command';

      const maxSamples = td.maxTurnSec * 16000;
      // Below this a turn can only be a short word (a wake word) — skip the
      // semantic endpoint wait so "Cosmo" wakes instantly instead of stalling
      // ~1.4s. Smart Turn is for not cutting off mid-sentence on real commands.
      const minEndpointSamples = 1.2 * 16000;
      turnBuf = capLast(concatF32(turnBuf, seg), maxSamples);
      log.debug(`voice:audio seg=${seg.length} mode=${mode} buf=${turnBuf.length}`);

      // Semantic end-of-turn: truly finished, or just a mid-sentence pause?
      if (td.enabled && mode === 'wake' && turnBuf.length >= minEndpointSamples && turnBuf.length < maxSamples) {
        const prob = await detectEndOfTurn(turnBuf);
        if (prob != null && prob < td.threshold) {
          log.debug(`turn incomplete (p=${prob.toFixed(2)}) — waiting ~1.4s for more`);
          // Never hang: finalize on silence if no further speech arrives.
          turnTimer = setTimeout(() => { void finalizeTurn(); }, 1400);
          return;
        }
      }
      await finalizeTurn();
    } catch (e: unknown) {
      sttBusy = false; turnBuf = null; clearTurnTimer();
      log.error('voice:audio handler:', (e as Error).message);
      stateManager.setState('idle', bw);
    }
  });

  // Legacy voice trigger (for wake word path when implemented)
  const voiceController = new VoiceController({
    win: bw,
    config: store.store as Config,
    setMood: (s, dur) => stateManager.setState(s, bw, dur),
    setActivity: (a) => stateManager.setActivity(a, bw),
    onInput: (text) => handleUserInput(
      text, bw, store.store as Config,
      (s, dur) => stateManager.setState(s, bw, dur),
      (a) => stateManager.setActivity(a, bw),
    ),
  });
  // Don't start wake word yet — mic dot handles voice:audio directly above
  // voiceController.start() called when wake word is configured
  void voiceController;

  powerMonitor.on('resume', onSystemResume);

  // Register TTS providers — offline Kokoro (default, cute) + macOS say, plus the
  // cloud vendors (thin presets over httpTTS). All register regardless of key;
  // keys resolve at call time, same as the LLM providers.
  registerTTSProvider(kokoroTTSProvider);
  registerTTSProvider(macosTTSProvider);
  registerTTSProvider(elevenlabsTTSProvider);
  registerTTSProvider(sarvamTTSProvider);
  registerTTSProvider(deepgramTTSProvider);
  registerTTSProvider(groqTTSProvider);
  registerTTSProvider(openaiTTSProvider);
  registerTTSProvider(cartesiaTTSProvider);
  registerTTSProvider(humeTTSProvider);
  const ttsChoice = (store.get('tts.provider') as string | undefined) ?? 'kokoro';
  try {
    setActiveTTSProvider(ttsChoice);
  } catch {
    log.warn(`TTS provider '${ttsChoice}' not found, falling back to macos`);
    setActiveTTSProvider('macos');
  }
  // Apply the saved voice, and only pay Kokoro's ~90MB download when it's actually
  // the active provider (cloud users shouldn't wait for a model they won't use).
  speechQueue.setVoice((store.store as Config).tts.voice);
  if (getActiveTTSProvider().name === 'kokoro') {
    kokoroTTSProvider.init?.()
      .catch(e => log.warn('Kokoro init failed, will retry on first speak:', e.message))
      .finally(() => markBoot('tts', 'voice (Kokoro)'));
  } else {
    markBoot('tts', `voice (${getActiveTTSProvider().name})`);
  }

  // Load any user-entered API keys (decrypt from the OS keychain) before the
  // providers are used. Must run after app is ready (safeStorage needs it).
  // Any blob that can't be decrypted (keychain key changed) is dead forever —
  // purge it from config so it stops erroring on every boot and setup re-prompts.
  const deadKeys = initSecrets((store.store as Config).secrets);
  if (deadKeys.length) {
    const secrets: Record<string, string> = { ...((store.get('secrets') as Record<string, string> | undefined) ?? {}) };
    for (const id of deadKeys) delete secrets[id];
    store.set('secrets', secrets);
  }

  // Register LLM providers. Keys are resolved at call time (user-entered via the
  // setup screen, else env), so we register all of them regardless of key.
  const providerList = [cerebrasProvider, groqProvider, googleProvider, openaiProvider, anthropicProvider, deepseekProvider, xaiProvider];
  for (const p of providerList) {
    registerProvider(p);
  }
  registerProvider(ollamaProvider); // always register (no key needed)

  // Register tools
  registerMusicTools();
  registerSpeechTools();
  registerBrowserTools();
  registerTimerTools();
  registerSearchTools();
  registerNewsTools();
  registerNotesTools();
  registerSystemTools();
  registerWeatherTools();
  registerLauncherTools();
  registerReminderTools();
  registerTaskTools();
  registerClipboardTools();
  registerPomodoroTools();
  registerGithubTools();
  registerCalendarTools();
  registerTrelloTools();
  registerGmailTools();
  registerAppleMailTools();
  registerActivityTools();
  registerPageReadTools();

  // Fire due reminders: speak + chat bubble + a happy pulse + a nudge (bounce when
  // visible, native banner + peek when hidden/muted).
  startReminderScheduler((r) => {
    log.info('Reminder fired:', r.text);
    stateManager.setState('happy', bw, 4000);
    bw.webContents.send(IPC.CHAT_MESSAGE, { text: `⏰ Reminder: ${r.text}`, type: 'bot' });
    speechQueue.enqueue(`Reminder: ${r.text}`);
    nudge(`Reminder: ${r.text}`);
    bw.webContents.send('panel:changed'); // the fired reminder is gone — refresh an open panel
  });

  // Proactive callouts + recaps nudge too (so an internal update isn't missed when
  // Cosmo is off-screen/muted). The manager fires this only after its own gates pass.
  calloutManager.setOnSpeak(nudge);

  // Keep the music equalizer overlay honest: it's set when music.play succeeds, but
  // nothing told us when the song ENDED or was paused outside Cosmo, so the eq bars
  // kept dancing with no audio. While a music activity is showing, poll Apple Music's
  // real player state and clear the overlay the moment it isn't actually playing.
  const stillMusic = (): boolean => stateManager.getActivity()?.type === 'music';
  const clearMusic = (): void => { if (stillMusic()) stateManager.setActivity(null, bw); };
  setInterval(() => {
    if (!stillMusic()) return; // cheap: no osascript unless the eq is showing
    // Two calls, so we NEVER touch Music's dictionary (which can relaunch it) unless
    // it's confirmed running. Step 1 is System-Events-only.
    void runScript('tell application "System Events" to return (exists (processes whose name is "Music"))')
      .then((running) => {
        if (running.trim() !== 'true') { clearMusic(); return undefined; }
        return runScript('tell application "Music"\n  if player state is playing then return "yes"\nend tell\nreturn "no"')
          .then((playing) => { if (playing.trim() !== 'yes') clearMusic(); });
      })
      .catch(() => { /* best-effort */ });
  }, 5000);

  // Register and start watchers
  registerWatcher(new IdleWatcher());
  registerWatcher(new FocusWatcher());
  registerWatcher(new BatteryWatcher());
  registerWatcher(new EyeStrainWatcher());

  // workSignal is the single judge: watchers report facts, it owns mood + callouts.
  configureWorkSignal({
    setMood: (state) => stateManager.setState(state, win!),
    getMood: () => stateManager.getState(),
    getConfig: () => store.store as Config,
    log,
  });
  const watcherCtx = {
    config: store.store as Config,
    report: reportSignal,
    log,
  };
  startAll(watcherCtx);

  // Proactive recaps (daily / weekly) — silent unless the user enabled proactive speech.
  startBriefing(() => store.store as Config);

  // Global error handler
  process.on('uncaughtException', (err) => {
    log.error('Uncaught exception:', err.message, err.stack);
    win?.webContents.send(IPC.CHAT_MESSAGE, {
      text: `Something went wrong: ${err.message}`,
      type: 'bot',
    });
  });
});

app.on('window-all-closed', () => {
  // keep running in tray — do not quit
});

app.on('will-quit', () => {
  stopAll();
  stopBriefing();
  stateManager.dispose();
  log.info('Cosmo quitting');
});

// voiceController is scoped to app.whenReady callback

export { store, win, stateManager as state };
