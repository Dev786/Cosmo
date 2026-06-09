import { loadPack } from './packs/registry';
import { getCharacter, nextCharacterId, DEFAULT_CHARACTER } from './packs/chibi/registry';
import type { MoodState, ActivityState, Config } from '../shared/types';
import { IPC } from '../shared/types';
import type { ProviderInfo, TTSInfo, STTInfo } from '../shared/providerCatalog';
import { startListening, triggerCommandCapture, pauseListening, resumeListening, primeVoice, stopListening } from './voice';

declare global {
  interface Window {
    cosmo: {
      on(channel: string, cb: (...args: unknown[]) => void): void;
      invoke(channel: string, data?: unknown): Promise<unknown>;
      send(channel: string, data?: unknown): void;
    };
  }
}

async function init() {
  const container = document.getElementById('eyes-container')!;
  const chatArea = document.getElementById('chat-area')!;
  const chatMessages = document.getElementById('chat-messages')!;
  const chatInput = document.getElementById('chat-input') as HTMLInputElement;
  const chatSend = document.getElementById('chat-send')!;
  const chatToggle = document.getElementById('chat-toggle')!;
  const chatClose = document.getElementById('chat-close')!;
  const micDot = document.getElementById('mic-dot')!;
  const muteDot = document.getElementById('mute-dot')!;
  const bootOverlay = document.getElementById('boot-overlay')!;
  const bootStatus = document.getElementById('boot-status');

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Which character? Read the persisted choice; fall back to the default.
  let currentCharacter = DEFAULT_CHARACTER;
  try {
    const cfg = (await window.cosmo.invoke(IPC.SETTINGS_GET)) as Partial<Config> | undefined;
    if (cfg?.character) currentCharacter = cfg.character;
  } catch { /* default */ }

  // Tell main which voice to use for this character (and persist the choice).
  function applyCharacter(id: string): void {
    const c = getCharacter(id);
    window.cosmo.invoke('character:set', { id, voice: c.voice }).catch(() => { /* non-fatal */ });
  }

  // `let` so the right-click switcher can hot-swap the pack at runtime; the IPC
  // listeners below close over the binding, so they always use the current pack.
  let pack = await loadPack('chibi', container, reducedMotion, currentCharacter);
  applyCharacter(currentCharacter);

  // Brief floating name label when switching characters.
  function flashName(name: string): void {
    let toast = document.getElementById('char-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'char-toast';
      toast.style.cssText = 'position:absolute;top:8px;left:0;right:0;text-align:center;font:600 12px system-ui;color:#fff;text-shadow:0 1px 4px rgba(0,0,0,0.5);pointer-events:none;opacity:0;transition:opacity 0.25s ease;z-index:40;';
      document.getElementById('app')?.appendChild(toast);
    }
    toast.textContent = name;
    toast.style.opacity = '1';
    setTimeout(() => { if (toast) toast.style.opacity = '0'; }, 1100);
  }

  async function switchCharacter(id: string): Promise<void> {
    currentCharacter = id;
    pack = await loadPack('chibi', container, reducedMotion, id);
    applyCharacter(id);
    flashName(getCharacter(id).name);
  }

  // Right-click the avatar to cycle through the roster (Cosmo → Bulma → Luffy …).
  container.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    void switchCharacter(nextCharacterId(currentCharacter));
  });

  let chatHideTimer: ReturnType<typeof setTimeout> | null = null;
  let captureMode = false;
  let chatPinned = false; // opened via the chat button — stays open until closed

  // ─── Right dashboard rail ───────────────────────────────────────────────────
  // The controls (mic/mute/chat/tasks) live in a rail to the RIGHT of the face,
  // hidden at rest so the face + status pill own the window. HOVER IS MAIN-DRIVEN:
  // Cosmo is a non-activating `type:'panel'` window, so the renderer gets no DOM
  // mouseenter/mousemove unless the app is focused — hover would only work after a
  // click. So main polls the GLOBAL cursor (same reason gaze lives in main), resizes
  // the window on the enter/leave transition, and sends 'dash:set'; we just toggle
  // the rail class to match, never showing it while a full overlay owns the window.
  const dashRail = document.getElementById('dash-rail')!;

  // The rail's visibility is decided in MAIN (syncWindow knows hover + chat + mic) and
  // pushed here via 'dash:set'. We only VETO it for setup/panel, which COVER the whole
  // window. Chat does NOT hide the rail — chat opens to the right of the buttons, so the
  // mic stays reachable while chatting.
  function coveringOverlayOpen(): boolean {
    return !!document.getElementById('panel-overlay')?.classList.contains('visible')
      || !!document.getElementById('setup-overlay')?.classList.contains('visible');
  }
  function setDashOpen(open: boolean): void {
    if (open && !coveringOverlayOpen()) dashRail.classList.add('open');
    else dashRail.classList.remove('open');
  }
  // Setup/panel cover the window — hide the rail while they're up.
  function collapseDashForOverlay(): void { dashRail.classList.remove('open'); }
  // Pin the rail open (in main) while the mic is live, so the red mic stays visible.
  function pinDash(pinned: boolean): void { window.cosmo.send('dash:pin', { pinned }); }

  window.cosmo.on('dash:set', (_, data) => { setDashOpen(!!(data as { open?: boolean })?.open); });

  // The chat panel lives in a column to the RIGHT of Cosmo; main grows/shrinks
  // the OS window so it never overlaps his face. Keep the window width in sync
  // with whether the panel is actually visible (single source of truth).
  function syncChatWindow(): void {
    window.cosmo.send('chat:resize', { open: chatArea.classList.contains('visible') });
  }

  function showChat() {
    chatArea.classList.add('visible');
    syncChatWindow();
    if (chatHideTimer) clearTimeout(chatHideTimer);
    chatHideTimer = setTimeout(() => {
      if (!captureMode && !chatPinned) { chatArea.classList.remove('visible'); syncChatWindow(); }
    }, 20000); // 20s — enough time to read the response
  }

  function openChat() {
    chatPinned = true;
    chatArea.classList.add('visible');
    chatToggle.classList.add('active');
    syncChatWindow();
    if (chatHideTimer) clearTimeout(chatHideTimer);
    chatInput.focus();
  }

  function closeChat() {
    chatPinned = false;
    captureMode = false;
    chatArea.classList.remove('visible', 'capture-mode');
    chatToggle.classList.remove('active');
    chatInput.value = '';
    syncChatWindow();
  }

  // Chat button beside the mic toggles the panel; ✕ closes it. Shared by the
  // tray's Open/Close-chat action (control:do) so both paths behave identically.
  function toggleChat(): void {
    if (chatArea.classList.contains('visible')) closeChat();
    else openChat();
    window.cosmo.send('user:interaction');
  }
  chatToggle.addEventListener('click', toggleChat);
  chatClose.addEventListener('click', closeChat);

  // ✕ on the avatar hides Cosmo to the menu-bar tray (he keeps running).
  document.getElementById('close-cosmo')?.addEventListener('click', () => {
    window.cosmo.send('window:hide');
  });

  function makeMsg(text: string, type: 'user' | 'bot'): HTMLDivElement {
    const msg = document.createElement('div');
    msg.className = `msg ${type}`;
    msg.textContent = text;
    return msg;
  }

  function appendMessage(text: string, type: 'user' | 'bot', persist = true): void {
    chatMessages.appendChild(makeMsg(text, type));
    chatMessages.scrollTop = chatMessages.scrollHeight;
    // Every shown message is written to the durable transcript (~/.pixel/chat-history)
    // so it survives restarts. History-loaded messages pass persist=false to avoid
    // re-writing what's already on disk.
    if (persist) window.cosmo.send('chat:persist', { text, type });
    // NEVER pop the panel open on its own — e.g. when Cosmo speaks a voice reply.
    // Only surface it if the user already has it open. Messages are still appended
    // to the log, so opening the panel later shows the history. When pinned (user-
    // opened) it just stays; only the transient case refreshes its auto-hide timer.
    if (chatArea.classList.contains('visible') && !chatPinned) showChat();
  }

  // ─── Chat transcript: show the last 5, lazy-load older on scroll-up ──────────
  // The whole conversation lives on disk; we keep the DOM light by rendering only
  // the most recent few and pulling older batches when the user scrolls to the top.
  let oldestIndex = 0;     // global index of the topmost message currently in the DOM
  let historyReady = false;
  let loadingOlder = false;
  let noMoreHistory = false;

  interface HistBatch { items: { text: string; type: 'user' | 'bot' }[]; start: number }

  async function loadInitialHistory(): Promise<void> {
    try {
      const r = (await window.cosmo.invoke('chat:recent', { limit: 5 })) as HistBatch;
      for (const it of r.items) chatMessages.appendChild(makeMsg(it.text, it.type));
      chatMessages.scrollTop = chatMessages.scrollHeight;
      oldestIndex = r.start;
      noMoreHistory = r.start <= 0;
    } catch { /* no history yet */ }
    historyReady = true;
  }

  async function loadOlderHistory(): Promise<void> {
    if (!historyReady || loadingOlder || noMoreHistory) return;
    loadingOlder = true;
    try {
      const r = (await window.cosmo.invoke('chat:older', { before: oldestIndex, limit: 10 })) as HistBatch;
      if (r.items.length) {
        const prevH = chatMessages.scrollHeight;
        const frag = document.createDocumentFragment();
        for (const it of r.items) frag.appendChild(makeMsg(it.text, it.type));
        chatMessages.insertBefore(frag, chatMessages.firstChild);
        chatMessages.scrollTop = chatMessages.scrollHeight - prevH; // hold the viewport steady
      }
      oldestIndex = r.start;
      if (r.start <= 0) noMoreHistory = true;
    } catch { /* ignore */ } finally {
      loadingOlder = false;
    }
  }

  chatMessages.addEventListener('scroll', () => {
    if (chatMessages.scrollTop <= 8) void loadOlderHistory();
  });

  // Tray "Clear conversation" wipes the transcript file (in main) and signals here.
  window.cosmo.on('chat:clear', () => {
    chatMessages.replaceChildren();
    oldestIndex = 0;
    noMoreHistory = true;
    appendMessage('— conversation cleared —', 'bot', false);
  });

  void loadInitialHistory();

  // ─── IPC listeners ───────────────────────────────────────────────────────

  // A short two-tone "I'm listening" earcon (Alexa-style), synthesized via Web
  // Audio so it needs no bundled asset. Played on the LEADING edge of the listening
  // state — which both a confirmed wake word and a mic-dot click drive — so there's
  // one cue, one code path, for "Cosmo is now listening".
  let earconCtx: AudioContext | null = null;
  function playEarcon(): void {
    try {
      earconCtx = earconCtx ?? new AudioContext();
      if (earconCtx.state === 'suspended') void earconCtx.resume();
      const ctx = earconCtx;
      const t0 = ctx.currentTime;
      // Rising ding-dong: 880Hz then 1320Hz, ~110ms each, quick exp decay.
      for (const [freq, at] of [[880, 0], [1320, 0.09]] as const) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const start = t0 + at;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.linearRampToValueAtTime(0.13, start + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.12);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.15);
      }
    } catch { /* audio unavailable — non-fatal */ }
  }

  let lastMood: MoodState | null = null;
  window.cosmo.on(IPC.MOOD_SET, (_, data) => {
    const { state } = data as { state: MoodState };
    if (state === 'listening' && lastMood !== 'listening') playEarcon();
    lastMood = state;
    pack.setState(state);
  });

  window.cosmo.on(IPC.MOOD_PULSE, (_, data) => {
    const { event } = data as { event: Parameters<typeof pack.pulse>[0] };
    pack.pulse(event);
  });

  window.cosmo.on(IPC.MOOD_INTENSITY, (_, data) => {
    const { level } = data as { level: number };
    pack.setIntensity(level);
  });

  window.cosmo.on(IPC.ACTIVITY_SET, (_, data) => {
    const { activity } = data as { activity: ActivityState | null };
    pack.setActivity(activity);
  });

  window.cosmo.on(IPC.CHAT_MESSAGE, (_, data) => {
    const { text, type } = data as { text: string; type: 'user' | 'bot' };
    appendMessage(text, type);
  });

  window.cosmo.on(IPC.VOICE_STATUS, (_, data) => {
    const { wakeFailed } = data as { wakeFailed: boolean };
    if (wakeFailed) {
      micDot.classList.add('always-visible');
    }
  });

  window.cosmo.on(IPC.CHAT_CAPTURE_MODE, (_, data) => {
    const { active } = data as { active: boolean };
    captureMode = active;
    if (active) {
      chatArea.classList.add('visible', 'capture-mode');
      chatInput.focus();
      if (chatHideTimer) clearTimeout(chatHideTimer);
    } else {
      chatArea.classList.remove('capture-mode');
    }
    syncChatWindow();
  });

  // ─── Chat input ──────────────────────────────────────────────────────────

  async function submitChat() {
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = '';

    if (captureMode) {
      await window.cosmo.invoke(IPC.CHAT_SUBMIT, { text, captureOnly: true });
      captureMode = false;
      chatArea.classList.remove('capture-mode');
      (window as Window & { cosmo: Window['cosmo'] }).cosmo.send('window:blur');
      return;
    }

    appendMessage(text, 'user');
    await window.cosmo.invoke(IPC.CHAT_SUBMIT, { text, captureOnly: false });
  }

  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submitChat(); }
    if (e.key === 'Escape') {
      closeChat();
    }
    // Any typing = interaction
    window.cosmo.send('user:interaction');
  });

  chatSend.addEventListener('click', submitChat);

  // ─── Always-on voice: continuous VAD → main (wake word + Smart Turn) ───────

  let listeningStarted = false;
  let muted = false;   // full mute: voice off + mic off, until un-muted
  // Listening mode, fetched from config at boot and updated live on a setup save.
  // false = push-to-talk (mic opens only for a mic-dot click); true = always-listen
  // (continuous mic for the "Cosmo" wake word).
  let alwaysListen = false;
  let pttCloseTimer: ReturnType<typeof setTimeout> | null = null;
  // An explicit mic-click capture is in progress. Drives the red "recording" look and
  // makes the mic button a toggle (tap to start, tap again to stop).
  let commandCapturing = false;
  let micSafetyTimer: ReturnType<typeof setTimeout> | null = null;

  // Each detected utterance → main, tagged wake vs explicit command. Shared by
  // both modes; in push-to-talk we close the mic again right after the one command
  // so it never stays open between clicks.
  // Clear the explicit-capture state + its red dot (capture finished or cancelled).
  function endCommandVisual(): void {
    commandCapturing = false;
    if (micSafetyTimer) { clearTimeout(micSafetyTimer); micSafetyTimer = null; }
    micDot.classList.remove('recording');
    pinDash(false);
  }
  function onUtterance(wav: ArrayBuffer, mode: 'wake' | 'command'): void {
    if (mode === 'command') endCommandVisual();
    window.cosmo.send('voice:audio', { wav: Array.from(new Uint8Array(wav)), mode });
    if (!alwaysListen) {
      if (pttCloseTimer) { clearTimeout(pttCloseTimer); pttCloseTimer = null; }
      void stopListening();   // push-to-talk: one capture, then mic closes
    }
  }
  // VAD speech-state. We DON'T perk the eyes for ambient speech (main owns the eyes,
  // only after a wake word / click). But we DO hold the mic dot red while the user is
  // actually talking, so it never flips back to idle-blue mid-sentence (#mic-blue bug).
  function onVoiceState(state: 'listening' | 'idle'): void {
    if (state === 'listening') {
      if (commandCapturing || alwaysListen) micDot.classList.add('recording');
      // Real speech arrived — the no-speech safety timer is no longer needed.
      if (micSafetyTimer) { clearTimeout(micSafetyTimer); micSafetyTimer = null; }
    } else if (alwaysListen && !commandCapturing) {
      // Always-on: speech ended and no explicit capture pending → calm the dot.
      micDot.classList.remove('recording');
    }
  }

  // Always-listen: open the continuous mic (idempotent).
  function beginListening() {
    if (listeningStarted) return;
    listeningStarted = true;
    micDot.classList.add('always-on');
    startListening(onUtterance, onVoiceState);
  }
  // Push-to-talk: register the callbacks but leave the mic closed until a click.
  function primeListening() {
    primeVoice(onUtterance, onVoiceState);
  }
  // Leave always-listen mode: tear the continuous mic down and re-prime for clicks.
  function stopContinuousListening() {
    listeningStarted = false;
    micDot.classList.remove('always-on', 'recording');
    void stopListening();
    primeListening();
  }

  // Main pauses listening while Cosmo speaks (echo control), resumes after.
  // While fully muted we never resume — the mute button is the only way back.
  window.cosmo.on('voice:listen', (_, data) => {
    const { active } = data as { active: boolean };
    if (active && !muted) resumeListening(); else pauseListening();
  });

  // Mute dot = full mute: silence his voice AND stop listening, until tapped again.
  // Shared with the tray's Mute/Unmute action (control:do).
  function toggleMute(): void {
    muted = !muted;
    muteDot.textContent = muted ? '🔇' : '🔊';
    muteDot.classList.toggle('active', muted);
    micDot.classList.toggle('muted', muted);
    if (muted) { pauseListening(); micDot.classList.remove('recording', 'always-on'); }
    else if (alwaysListen) { micDot.classList.add('always-on'); resumeListening(); }
    // Push-to-talk: un-mute just re-arms the mic button — no continuous mic to resume.
    window.cosmo.send('voice:mute', { muted });   // main: stop/allow speech + flip the mic gate
    window.cosmo.send('user:interaction');
  }
  muteDot.addEventListener('click', toggleMute);

  // Mic-dot click = "I'm talking now" — next utterance is an explicit command
  // (bypasses the wake word). Handy when the wake word mishears. Shared with the
  // tray's Talk action (control:do).
  function startMic(): void {
    commandCapturing = true;
    void triggerCommandCapture();   // async: self-heals (rebuilds the VAD) if the mic died
    micDot.classList.add('recording');
    pinDash(true);   // keep the rail out so the red mic stays visible while live
    // Push-to-talk safety: if the click catches no speech, close the mic again so it
    // doesn't sit open. onUtterance clears this the moment a command is captured.
    if (!alwaysListen) {
      if (pttCloseTimer) clearTimeout(pttCloseTimer);
      pttCloseTimer = setTimeout(() => { pttCloseTimer = null; if (!alwaysListen) void stopListening(); }, 9000);
    }
    // No-speech safety for the red dot: if nothing is ever heard, drop the recording
    // look. Generous so a slow start isn't cut off; VAD speech-start cancels it, and
    // the dot then lives as long as the user keeps talking (fixes the mid-speech flip).
    if (micSafetyTimer) clearTimeout(micSafetyTimer);
    micSafetyTimer = setTimeout(() => { micSafetyTimer = null; if (commandCapturing) stopMic(); }, 12000);
    window.cosmo.send('user:interaction');
    // Show the listening pose right away — clicking the mic is the same "I'm
    // talking now" cue as the wake word, so main flips the eyes to listening.
    window.cosmo.send('voice:command-begin');
  }
  // Tap again to stop: cancel the in-flight capture + clear the red look. In push-to-
  // talk this also closes the mic; in always-on the continuous mic just stays armed.
  function stopMic(): void {
    if (pttCloseTimer) { clearTimeout(pttCloseTimer); pttCloseTimer = null; }
    endCommandVisual();
    if (!alwaysListen) void stopListening();
  }
  // Mic-dot click = "I'm talking now" — next utterance is an explicit command
  // (bypasses the wake word). Click again while live to stop. Shared with the tray's
  // Talk action (control:do).
  function triggerMic(): void {
    if (muted) return;   // full mute: mic button is inert until un-muted via the mute dot
    if (commandCapturing) stopMic();   // #click-active-mic-stops
    else startMic();
  }
  micDot.addEventListener('click', triggerMic);

  // The timer pill's ✕ (rendered by the active pack) asks to end the focus session.
  document.addEventListener('cosmo:timer-stop', () => { void window.cosmo.invoke('pomodoro:stop'); });

  // Cosmo-initiated heads-up (reminder / callout / recap) while he's on screen: a
  // quick attention bounce. Main only sends this when he's visible; when he's hidden
  // or muted it shows a native banner instead.
  const cosmoCol = document.getElementById('cosmo-col');
  window.cosmo.on('cosmo:nudge', () => {
    if (!cosmoCol) return;
    cosmoCol.classList.remove('nudge');
    void cosmoCol.offsetWidth;   // reflow so the animation restarts if one's mid-flight
    cosmoCol.classList.add('nudge');
    setTimeout(() => cosmoCol.classList.remove('nudge'), 700);
  });

  // Tray menu drives the same controls one at a time, even while hidden.
  window.cosmo.on('control:do', (_, data) => {
    const action = (data as { action?: string })?.action;
    if (action === 'mic') triggerMic();
    else if (action === 'chat') toggleChat();
    else if (action === 'mute') toggleMute();
    else if (action === 'panel') togglePanel();
  });

  // ─── Boot loader — wait until voice + ears + turn detection are ready ──────

  function finishBoot() {
    if (bootOverlay.classList.contains('done')) return;
    bootOverlay.classList.add('done');
    setTimeout(() => { bootOverlay.style.display = 'none'; }, 450);
    // Register the voice callbacks at once so a mic-dot click works immediately,
    // even before we learn the listening mode. Open the continuous (always-listen)
    // mic only if config asks for it; otherwise stay in push-to-talk (mic closed).
    primeListening();
    window.cosmo.invoke('setup:state')
      .then((st) => {
        const s = st as { needsSetup?: boolean; alwaysListen?: boolean };
        alwaysListen = !!s?.alwaysListen;
        if (alwaysListen) beginListening();
        // First run with no usable vendor/key → show the setup overlay.
        if (s?.needsSetup) void openSetup();
      })
      .catch(() => { /* ignore — stays in push-to-talk, mic button still works */ });
  }

  // Live mode switch from a setup save (push-to-talk ⇄ always-listen).
  window.cosmo.on('voice:mode', (_, data) => {
    alwaysListen = !!(data as { alwaysListen?: boolean })?.alwaysListen;
    if (alwaysListen) beginListening();
    else stopContinuousListening();
  });

  window.cosmo.on('boot:status', (_, data) => {
    const { label, ready } = data as { label: string; ready: boolean };
    if (bootStatus && label) bootStatus.textContent = ready ? 'ready!' : `loading ${label}…`;
  });
  window.cosmo.on('boot:ready', () => finishBoot());

  // Catch the case where boot finished before our listeners attached.
  window.cosmo.invoke('boot:state').then((st) => {
    if ((st as { ready?: boolean })?.ready) finishBoot();
  }).catch(() => { /* ignore — boot:ready will arrive */ });

  // ─── Setup / onboarding overlay (Brain · Voice · Ears) ────────────────────
  const setupOverlay = document.getElementById('setup-overlay')!;
  // Brain
  const setupVendor = document.getElementById('setup-vendor') as HTMLSelectElement;
  const setupModel = document.getElementById('setup-model') as HTMLSelectElement;
  const setupModelCustom = document.getElementById('setup-model-custom') as HTMLInputElement;
  const setupKey = document.getElementById('setup-key') as HTMLInputElement;
  const setupKeyLink = document.getElementById('setup-keylink') as HTMLAnchorElement;
  const setupKeyLabel = document.getElementById('setup-key-label') as HTMLElement;
  const setupFreeTier = document.getElementById('setup-freetier')!;
  const setupTest = document.getElementById('setup-test') as HTMLButtonElement;
  // Voice
  const setupTts = document.getElementById('setup-tts') as HTMLSelectElement;
  const setupVoice = document.getElementById('setup-voice') as HTMLSelectElement;
  const setupVoiceCustom = document.getElementById('setup-voice-custom') as HTMLInputElement;
  const setupTtsKey = document.getElementById('setup-tts-key') as HTMLInputElement;
  const setupTtsKeyLink = document.getElementById('setup-tts-keylink') as HTMLAnchorElement;
  const setupTtsKeyLabel = document.getElementById('setup-tts-key-label') as HTMLElement;
  const setupTtsFreeTier = document.getElementById('setup-tts-freetier')!;
  const setupTtsKeyOk = document.getElementById('setup-tts-keyok')!;
  const setupPreview = document.getElementById('setup-preview') as HTMLButtonElement;
  // Ears
  const setupSttProvider = document.getElementById('setup-stt-provider') as HTMLSelectElement;
  const setupStt = document.getElementById('setup-stt') as HTMLSelectElement;
  const setupSttFreeTier = document.getElementById('setup-stt-freetier')!;
  const setupSttKey = document.getElementById('setup-stt-key') as HTMLInputElement;
  const setupSttKeyLink = document.getElementById('setup-stt-keylink') as HTMLAnchorElement;
  const setupSttKeyLabel = document.getElementById('setup-stt-key-label') as HTMLElement;
  const setupSttKeyOk = document.getElementById('setup-stt-keyok')!;
  const setupAlwaysListen = document.getElementById('setup-always-listen') as HTMLInputElement;
  const setupSmartFocus = document.getElementById('setup-smart-focus') as HTMLInputElement;
  // Accounts (Gmail via Google OAuth; Calendar is native, no controls)
  const setupGmailBadge = document.getElementById('setup-gmail-badge')!;
  const setupGoogleFields = document.getElementById('setup-google-fields')!;
  const setupGoogleId = document.getElementById('setup-google-id') as HTMLInputElement;
  const setupGoogleSecret = document.getElementById('setup-google-secret') as HTMLInputElement;
  const setupGoogleConnect = document.getElementById('setup-google-connect') as HTMLButtonElement;
  const setupGoogleDisconnect = document.getElementById('setup-google-disconnect') as HTMLButtonElement;
  // Shared
  const setupStatus = document.getElementById('setup-status')!;
  const setupSave = document.getElementById('setup-save') as HTMLButtonElement;
  const setupCloseX = document.getElementById('setup-close-x')!;
  const setupGear = document.getElementById('setup-gear')!;
  const setupTabs = Array.from(document.querySelectorAll<HTMLButtonElement>('.setup-tab'));
  const setupPanes = Array.from(document.querySelectorAll<HTMLElement>('.setup-pane'));

  const CUSTOM = '__custom__';
  let catalog: ProviderInfo[] = [];
  let ttsCatalog: TTSInfo[] = [];
  let sttCatalog: STTInfo[] = [];
  let secretsPresent: Record<string, boolean> = {};

  interface SetupState {
    provider?: string; model?: string; catalog?: ProviderInfo[]; needsSetup?: boolean;
    secretsPresent?: Record<string, boolean>;
    tts?: { provider: string; voice: string }; ttsCatalog?: TTSInfo[];
    stt?: { provider: string; model: string }; sttCatalog?: STTInfo[];
    alwaysListen?: boolean;
    smartFocus?: boolean;
    accounts?: { calendar?: { native: boolean }; gmail?: { connected: boolean; email?: string; clientId?: string } };
  }
  type Result = { ok: boolean; error?: string };

  const setStatus = (text: string, cls: '' | 'ok' | 'err' | 'busy'): void => { setupStatus.textContent = text; setupStatus.className = cls; };

  function showTab(tab: string): void {
    for (const b of setupTabs) b.classList.toggle('active', b.dataset.tab === tab);
    for (const p of setupPanes) p.classList.toggle('active', p.dataset.pane === tab);
  }
  for (const b of setupTabs) b.addEventListener('click', () => { showTab(b.dataset.tab ?? 'brain'); setStatus('', ''); });

  // A key field: hidden for local providers; optional ("leave blank to keep") when
  // a key is already on file, required otherwise. Shared by the Brain & Voice tabs.
  function applyKeyField(o: {
    needsKey: boolean; onFile: boolean; keyUrl?: string;
    label: HTMLElement; input: HTMLInputElement; link: HTMLAnchorElement; ok?: HTMLElement;
  }): void {
    o.label.style.display = o.needsKey ? '' : 'none';
    o.input.style.display = o.needsKey ? '' : 'none';
    o.input.placeholder = o.onFile ? 'leave blank to keep saved key' : 'paste your key';
    if (o.ok) o.ok.style.display = o.needsKey && o.onFile ? 'block' : 'none';
    if (o.needsKey && o.keyUrl && !o.onFile) { o.link.href = o.keyUrl; o.link.style.display = ''; }
    else o.link.style.display = 'none';
  }

  // ── Brain (LLM) ──
  const currentVendor = (): ProviderInfo | undefined => catalog.find(p => p.id === setupVendor.value);
  const chosenModel = (): string => (setupModel.value === CUSTOM ? setupModelCustom.value.trim() : setupModel.value);

  function renderModels(models: string[], selected?: string): void {
    setupModel.innerHTML = '';
    for (const m of models) {
      const o = document.createElement('option'); o.value = m; o.textContent = m; setupModel.appendChild(o);
    }
    const co = document.createElement('option'); co.value = CUSTOM; co.textContent = 'Custom…'; setupModel.appendChild(co);
    if (selected && models.includes(selected)) { setupModel.value = selected; setupModelCustom.style.display = 'none'; }
    else if (selected) { setupModel.value = CUSTOM; setupModelCustom.style.display = 'block'; setupModelCustom.value = selected; }
    else { setupModel.value = models[0] ?? CUSTOM; setupModelCustom.style.display = setupModel.value === CUSTOM ? 'block' : 'none'; }
  }

  // Fill the model dropdown. Cloud vendors show ONLY the curated catalog (a short,
  // hand-picked set of tool-capable, value models) — their live /v1/models lists
  // hundreds of image/TTS/embedding/legacy models that flood the dropdown and none
  // of which suit Cosmo. The "Custom…" entry always covers anything not curated.
  // ONLY local Ollama is replaced with its LIVE list (your actually-installed
  // models — the one place you must pick from what's really there). `selected`
  // preserves a specific pick; undefined lets the curated/first model win.
  let modelsReqId = 0;
  async function loadModels(selected?: string): Promise<void> {
    const info = currentVendor();
    if (!info) return;
    renderModels(info.models ?? [], selected);
    if (info.needsKey) return; // cloud → curated list only (no live /v1/models flood)
    const haveKey = !info.needsKey || !!setupKey.value.trim() || !!secretsPresent[info.id];
    if (!haveKey) return;
    const reqId = ++modelsReqId;
    const r = await window.cosmo.invoke('setup:models', { provider: info.id, key: setupKey.value.trim() })
      .catch(() => null) as { ok?: boolean; models?: string[] } | null;
    // Drop a stale response if the vendor changed (or a newer request fired) while we waited.
    if (reqId !== modelsReqId || info.id !== setupVendor.value) return;
    if (r?.ok && r.models?.length) {
      const want = selected ?? (info.models.find(m => r.models!.includes(m)) ?? r.models[0]);
      renderModels(r.models, want);
    }
  }

  function syncVendorUI(): void {
    const info = currentVendor();
    setupFreeTier.textContent = info?.freeTier ?? '';
    applyKeyField({
      needsKey: info?.needsKey ?? true,
      onFile: info ? !!secretsPresent[info.id] : false,
      keyUrl: info?.keyUrl,
      label: setupKeyLabel, input: setupKey, link: setupKeyLink,
    });
  }

  // ── Voice (TTS) ──
  const currentTts = (): TTSInfo | undefined => ttsCatalog.find(t => t.id === setupTts.value);
  const chosenVoice = (): string => (setupVoice.value === CUSTOM ? setupVoiceCustom.value.trim() : setupVoice.value);

  function renderVoices(info: TTSInfo | undefined, selected?: string): void {
    const voices = info?.voices ?? [];
    setupVoice.innerHTML = '';
    for (const v of voices) {
      const o = document.createElement('option'); o.value = v.id; o.textContent = v.label; setupVoice.appendChild(o);
    }
    const co = document.createElement('option'); co.value = CUSTOM; co.textContent = 'Custom voice…'; setupVoice.appendChild(co);
    const ids = voices.map(v => v.id);
    if (selected !== undefined && ids.includes(selected)) { setupVoice.value = selected; setupVoiceCustom.style.display = 'none'; }
    else if (selected) { setupVoice.value = CUSTOM; setupVoiceCustom.style.display = 'block'; setupVoiceCustom.value = selected; }
    else { setupVoice.value = info?.defaultVoice ?? voices[0]?.id ?? CUSTOM; setupVoiceCustom.style.display = setupVoice.value === CUSTOM ? 'block' : 'none'; }
  }

  function syncTtsUI(): void {
    const info = currentTts();
    setupTtsFreeTier.textContent = info?.freeTier ?? '';
    const keyId = info?.keyId ?? info?.id ?? '';
    applyKeyField({
      needsKey: info?.needsKey ?? false,
      onFile: keyId ? !!secretsPresent[keyId] : false,
      keyUrl: info?.keyUrl,
      label: setupTtsKeyLabel, input: setupTtsKey, link: setupTtsKeyLink, ok: setupTtsKeyOk,
    });
  }

  // ── Ears (STT) ──
  const currentStt = (): STTInfo | undefined => sttCatalog.find(s => s.id === setupSttProvider.value);

  function renderSttModels(info: STTInfo | undefined, selected?: string): void {
    const models = info?.models ?? [];
    setupStt.innerHTML = '';
    for (const m of models) {
      const o = document.createElement('option'); o.value = m.id; o.textContent = m.label; setupStt.appendChild(o);
    }
    if (selected && models.some(m => m.id === selected)) setupStt.value = selected;
    else setupStt.value = info?.defaultModel ?? models[0]?.id ?? '';
  }

  function syncSttUI(): void {
    const info = currentStt();
    setupSttFreeTier.textContent = info?.freeTier ?? '';
    const keyId = info?.keyId ?? info?.id ?? '';
    applyKeyField({
      needsKey: info?.needsKey ?? false,
      onFile: keyId ? !!secretsPresent[keyId] : false,
      keyUrl: info?.keyUrl,
      label: setupSttKeyLabel, input: setupSttKey, link: setupSttKeyLink, ok: setupSttKeyOk,
    });
  }

  // Accounts tab — Gmail connection state. Calendar needs no controls (native).
  function renderGmail(g?: { connected: boolean; email?: string; clientId?: string }): void {
    const connected = !!g?.connected;
    setupGmailBadge.textContent = connected ? (g?.email ? `Connected · ${g.email}` : 'Connected ✓') : 'Not connected';
    setupGmailBadge.classList.toggle('ok', connected);
    setupGoogleFields.style.display = connected ? 'none' : '';
    setupGoogleDisconnect.style.display = connected ? '' : 'none';
    if (g?.clientId) setupGoogleId.value = g.clientId;
  }

  setupGoogleConnect.addEventListener('click', async () => {
    const clientId = setupGoogleId.value.trim();
    const clientSecret = setupGoogleSecret.value.trim();
    if (!clientId || !clientSecret) { setStatus('Enter the Client ID and secret first.', 'err'); return; }
    setStatus('Opening Google sign-in in your browser…', 'busy');
    setupGoogleConnect.disabled = true;
    const r = await window.cosmo.invoke('accounts:connectGoogle', { clientId, clientSecret })
      .catch((e) => ({ ok: false, error: String(e) })) as Result & { email?: string };
    setupGoogleConnect.disabled = false;
    if (r.ok) {
      setStatus('✓ Gmail connected!', 'ok');
      setupGoogleSecret.value = '';
      renderGmail({ connected: true, email: r.email, clientId });
    } else {
      setStatus(`✗ ${r.error ?? 'Connect failed'}`, 'err');
    }
  });

  setupGoogleDisconnect.addEventListener('click', async () => {
    await window.cosmo.invoke('accounts:disconnectGoogle').catch(() => null);
    setStatus('Gmail disconnected.', '');
    renderGmail({ connected: false });
  });

  // Connect disables the button until the browser sign-in resolves — which can take up
  // to 3 min, or never (if the flow is abandoned). The moment the user edits either
  // credential they're retrying, so re-activate the button right away.
  const reenableGoogleConnect = (): void => {
    setupGoogleConnect.disabled = false;
    if (setupStatus.classList.contains('busy')) setStatus('', '');
  };
  setupGoogleId.addEventListener('input', reenableGoogleConnect);
  setupGoogleSecret.addEventListener('input', reenableGoogleConnect);

  async function openSetup(): Promise<void> {
    collapseDashForOverlay();
    const s = await window.cosmo.invoke('setup:state').catch(() => null) as SetupState | null;
    if (s?.catalog) catalog = s.catalog;
    if (s?.ttsCatalog) ttsCatalog = s.ttsCatalog;
    if (s?.sttCatalog) sttCatalog = s.sttCatalog;
    secretsPresent = s?.secretsPresent ?? {};

    // Brain
    setupVendor.innerHTML = '';
    for (const p of catalog) {
      const o = document.createElement('option'); o.value = p.id; o.textContent = p.label; setupVendor.appendChild(o);
    }
    setupVendor.value = s?.provider ?? catalog[0]?.id ?? '';
    syncVendorUI();
    void loadModels(s?.model);
    setupKey.value = '';

    // Voice
    setupTts.innerHTML = '';
    for (const t of ttsCatalog) {
      const o = document.createElement('option'); o.value = t.id; o.textContent = t.label; setupTts.appendChild(o);
    }
    setupTts.value = s?.tts?.provider ?? ttsCatalog[0]?.id ?? '';
    syncTtsUI();
    renderVoices(currentTts(), s?.tts?.voice);
    setupTtsKey.value = '';

    // Ears
    setupSttProvider.innerHTML = '';
    for (const st of sttCatalog) {
      const o = document.createElement('option'); o.value = st.id; o.textContent = st.label; setupSttProvider.appendChild(o);
    }
    setupSttProvider.value = s?.stt?.provider ?? sttCatalog[0]?.id ?? '';
    syncSttUI();
    renderSttModels(currentStt(), s?.stt?.model);
    setupSttKey.value = '';
    setupAlwaysListen.checked = !!s?.alwaysListen;
    setupSmartFocus.checked = !!s?.smartFocus;

    // Accounts
    renderGmail(s?.accounts?.gmail);

    showTab('brain');
    setStatus('', '');
    setupOverlay.classList.toggle('reopen', !s?.needsSetup); // show ✕ only when already set up
    // Setup and the tasks panel are mutually-exclusive full-window overlays.
    document.getElementById('panel-overlay')?.classList.remove('visible');
    document.getElementById('panel-toggle')?.classList.remove('active');
    window.cosmo.send('setup:resize', { open: true });
    setupOverlay.classList.add('visible');
  }

  function closeSetup(): void {
    setupOverlay.classList.remove('visible');
    window.cosmo.send('setup:resize', { open: false });
  }

  setupVendor.addEventListener('change', () => { syncVendorUI(); void loadModels(); });
  // Pasting a cloud key unlocks that vendor's live model list — refresh on blur,
  // keeping whatever model is currently chosen.
  setupKey.addEventListener('blur', () => { void loadModels(chosenModel() || undefined); });
  setupModel.addEventListener('change', () => {
    const custom = setupModel.value === CUSTOM;
    setupModelCustom.style.display = custom ? 'block' : 'none';
    if (custom) setupModelCustom.focus();
  });
  setupTts.addEventListener('change', () => { syncTtsUI(); renderVoices(currentTts()); });
  setupVoice.addEventListener('change', () => {
    const custom = setupVoice.value === CUSTOM;
    setupVoiceCustom.style.display = custom ? 'block' : 'none';
    if (custom) setupVoiceCustom.focus();
  });
  setupSttProvider.addEventListener('change', () => { syncSttUI(); renderSttModels(currentStt()); });

  setupTest.addEventListener('click', async () => {
    const model = chosenModel();
    if (!model) { setStatus('Pick or type a model.', 'err'); return; }
    setStatus('Testing connection…', 'busy');
    setupTest.disabled = true; setupSave.disabled = true;
    const r = await window.cosmo.invoke('setup:test', { provider: setupVendor.value, model, key: setupKey.value })
      .catch((e) => ({ ok: false, error: String(e) })) as Result;
    setStatus(r.ok ? '✓ Connected!' : `✗ ${r.error ?? 'Failed'}`, r.ok ? 'ok' : 'err');
    setupTest.disabled = false; setupSave.disabled = false;
  });

  setupPreview.addEventListener('click', async () => {
    setStatus('Playing a sample…', 'busy');
    setupPreview.disabled = true;
    const r = await window.cosmo.invoke('setup:previewVoice', { provider: setupTts.value, voice: chosenVoice(), key: setupTtsKey.value })
      .catch((e) => ({ ok: false, error: String(e) })) as Result;
    setStatus(r.ok ? "✓ That's the voice!" : `✗ ${r.error ?? 'Preview failed'}`, r.ok ? 'ok' : 'err');
    setupPreview.disabled = false;
  });

  setupSave.addEventListener('click', async () => {
    const model = chosenModel();
    if (!model) { showTab('brain'); setStatus('Pick or type a model.', 'err'); return; }
    setStatus('Saving…', 'busy');
    setupTest.disabled = true; setupSave.disabled = true;
    const r = await window.cosmo.invoke('setup:save', {
      provider: setupVendor.value, model, key: setupKey.value,
      tts: { provider: setupTts.value, voice: chosenVoice(), key: setupTtsKey.value },
      stt: { provider: setupSttProvider.value, model: setupStt.value, key: setupSttKey.value },
      voice: { alwaysListen: setupAlwaysListen.checked },
      activity: { smartFocus: setupSmartFocus.checked },
    }).catch((e) => ({ ok: false, error: String(e) })) as Result;
    setupTest.disabled = false; setupSave.disabled = false;
    if (r.ok) { closeSetup(); window.cosmo.send('user:interaction'); }
    else setStatus(`✗ ${r.error ?? 'Could not save'}`, 'err');
  });

  setupCloseX.addEventListener('click', closeSetup);
  setupGear.addEventListener('click', () => { void openSetup(); });
  window.cosmo.on('setup:open', () => { void openSetup(); });

  // Open setup's external links (Get-a-key, "Open console →") in the real browser.
  // There's no window-open handler, so target="_blank" wouldn't fire — route the
  // click through source:open (shell.openExternal in main), like the Sources tab.
  document.getElementById('setup-overlay')?.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('a[href]') as HTMLAnchorElement | null;
    const href = a?.getAttribute('href') ?? '';
    if (a && /^https?:\/\//i.test(href)) {
      e.preventDefault();
      window.cosmo.invoke('source:open', { url: href }).catch(() => null);
    }
  });

  // ─── Tasks & reminders panel ──────────────────────────────────────────────
  // A second full-window overlay (mutually exclusive with setup) that reads/writes
  // the shared task + reminder stores in main via the panel:* IPC channels.
  const panelOverlay = document.getElementById('panel-overlay')!;
  const panelToggle = document.getElementById('panel-toggle')!;
  const panelCloseX = document.getElementById('panel-close-x')!;
  const panelTabs = Array.from(document.querySelectorAll<HTMLButtonElement>('.panel-tab'));
  const panelPanes = Array.from(document.querySelectorAll<HTMLElement>('.panel-pane'));
  const panelTasksList = document.getElementById('panel-tasks')!;
  const panelRemindersList = document.getElementById('panel-reminders')!;
  const panelTaskInput = document.getElementById('panel-task-input') as HTMLInputElement;
  const panelTaskAdd = document.getElementById('panel-task-add') as HTMLButtonElement;
  const panelTasksClear = document.getElementById('panel-tasks-clear') as HTMLButtonElement;
  const panelRemindersClear = document.getElementById('panel-reminders-clear') as HTMLButtonElement;
  const panelNotesList = document.getElementById('panel-notes')!;
  const panelNoteInput = document.getElementById('panel-note-input') as HTMLInputElement;
  const panelNoteAdd = document.getElementById('panel-note-add') as HTMLButtonElement;
  const panelNotesClear = document.getElementById('panel-notes-clear') as HTMLButtonElement;
  const panelSourcesList = document.getElementById('panel-sources')!;
  const panelSourcesClear = document.getElementById('panel-sources-clear') as HTMLButtonElement;

  interface PanelTask { id: number; text: string; done: boolean; created: number; }
  interface PanelReminder { id: string; text: string; fireAt: number; created: number; }
  interface PanelNote { id: number; text: string; when: string; }
  interface PanelSource { title: string; source: string; url: string; when: number; }
  interface PanelState { tasks: PanelTask[]; reminders: PanelReminder[]; notes: PanelNote[]; sources: PanelSource[]; }

  function showPanelTab(tab: string): void {
    for (const b of panelTabs) b.classList.toggle('active', b.dataset.ptab === tab);
    for (const p of panelPanes) p.classList.toggle('active', p.dataset.ppane === tab);
  }

  // Friendly "when" for a reminder: relative if it's soon, absolute otherwise.
  function whenLabel(fireAt: number): string {
    const d = new Date(fireAt);
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const mins = Math.round((fireAt - Date.now()) / 60000);
    if (mins < 1) return 'any moment now';
    if (mins < 60) return `in ${mins} min · ${time}`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `in ${hrs} h · ${time}`;
    return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${time}`;
  }

  function taskItem(t: PanelTask): HTMLElement {
    const row = document.createElement('div');
    row.className = t.done ? 'panel-item done' : 'panel-item';
    const check = document.createElement('div');
    check.className = 'panel-check';
    check.textContent = t.done ? '✓' : '';
    check.title = t.done ? 'Mark not done' : 'Mark done';
    check.addEventListener('click', () => void mutate('task:toggle', { id: t.id }));
    const text = document.createElement('div');
    text.className = 'panel-text';
    text.textContent = t.text;
    row.append(check, text);
    return row;
  }

  function reminderItem(r: PanelReminder): HTMLElement {
    const row = document.createElement('div');
    row.className = 'panel-item';
    const text = document.createElement('div');
    text.className = 'panel-text';
    const label = document.createElement('span');
    label.textContent = r.text;
    const when = document.createElement('span');
    when.className = 'panel-when';
    when.textContent = whenLabel(r.fireAt);
    text.append(label, when);
    const del = document.createElement('div');
    del.className = 'panel-del';
    del.textContent = '✕';
    del.title = 'Remove reminder';
    del.addEventListener('click', () => void mutate('reminder:remove', { id: r.id }));
    row.append(text, del);
    return row;
  }

  function noteItem(n: PanelNote): HTMLElement {
    const row = document.createElement('div');
    row.className = 'panel-item';
    const text = document.createElement('div');
    text.className = 'panel-text';
    const label = document.createElement('span');
    label.textContent = n.text;
    const when = document.createElement('span');
    when.className = 'panel-when';
    when.textContent = n.when;
    text.append(label, when);
    row.append(text);
    return row;
  }

  // Friendly relative age for a recorded source (e.g. "5 min ago", "2 h ago").
  function agoLabel(ts: number): string {
    const mins = Math.round((Date.now() - ts) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs} h ago`;
    return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function sourceItem(s: PanelSource): HTMLElement {
    const row = document.createElement('div');
    row.className = 'panel-item';
    const text = document.createElement('div');
    text.className = 'panel-text';
    const label = document.createElement('span');
    label.textContent = s.title;
    if (s.url) {
      label.className = 'panel-link';
      label.title = 'Open in browser';
      label.addEventListener('click', () => {
        window.cosmo.invoke('source:open', { url: s.url }).catch(() => null);
        window.cosmo.send('user:interaction');
      });
    }
    const meta = document.createElement('span');
    meta.className = 'panel-when';
    meta.textContent = [s.source, agoLabel(s.when)].filter(Boolean).join(' · ');
    text.append(label, meta);
    row.append(text);
    return row;
  }

  function emptyNote(msg: string): HTMLElement {
    const e = document.createElement('div');
    e.className = 'panel-empty';
    e.textContent = msg;
    return e;
  }

  function renderPanel(st: PanelState | null): void {
    const tasks = st?.tasks ?? [];
    panelTasksList.replaceChildren();
    if (!tasks.length) panelTasksList.appendChild(emptyNote('No tasks yet — add one above.'));
    else {
      // Open tasks first, completed sink to the bottom; stable by creation order.
      const ordered = [...tasks].sort((a, b) => Number(a.done) - Number(b.done) || a.created - b.created);
      for (const t of ordered) panelTasksList.appendChild(taskItem(t));
    }

    const reminders = st?.reminders ?? []; // main already returns these soonest-first
    panelRemindersList.replaceChildren();
    if (!reminders.length) panelRemindersList.appendChild(emptyNote('No reminders set.'));
    else for (const r of reminders) panelRemindersList.appendChild(reminderItem(r));

    const notes = st?.notes ?? []; // main returns these newest-first
    panelNotesList.replaceChildren();
    if (!notes.length) panelNotesList.appendChild(emptyNote('No notes yet — jot one above.'));
    else for (const n of notes) panelNotesList.appendChild(noteItem(n));

    const sources = st?.sources ?? []; // main returns these newest-first
    panelSourcesList.replaceChildren();
    if (!sources.length) panelSourcesList.appendChild(emptyNote('No sources yet — ask Cosmo to search the web.'));
    else for (const s of sources) panelSourcesList.appendChild(sourceItem(s));
  }

  async function refreshPanel(): Promise<void> {
    const st = await window.cosmo.invoke('panel:state').catch(() => null) as PanelState | null;
    renderPanel(st);
  }

  // Every mutation handler in main returns the fresh snapshot — render straight from it.
  async function mutate(channel: string, payload: unknown): Promise<void> {
    const st = await window.cosmo.invoke(channel, payload).catch(() => null) as PanelState | null;
    if (st) renderPanel(st);
    window.cosmo.send('user:interaction'); // any panel action counts as "I'm here"
  }

  function addTaskFromInput(): void {
    const text = panelTaskInput.value.trim();
    if (!text) return;
    panelTaskInput.value = '';
    void mutate('task:add', { text });
  }

  function addNoteFromInput(): void {
    const text = panelNoteInput.value.trim();
    if (!text) return;
    panelNoteInput.value = '';
    void mutate('note:add', { text });
  }

  async function openPanel(): Promise<void> {
    collapseDashForOverlay();
    setupOverlay.classList.remove('visible'); // mutually exclusive with setup
    panelToggle.classList.add('active');
    await refreshPanel();
    showPanelTab('tasks');
    window.cosmo.send('panel:resize', { open: true });
    panelOverlay.classList.add('visible');
    window.cosmo.send('user:interaction');
  }

  function closePanel(): void {
    panelOverlay.classList.remove('visible');
    panelToggle.classList.remove('active');
    window.cosmo.send('panel:resize', { open: false });
  }

  function togglePanel(): void {
    if (panelOverlay.classList.contains('visible')) closePanel();
    else void openPanel();
  }

  for (const b of panelTabs) b.addEventListener('click', () => showPanelTab(b.dataset.ptab ?? 'tasks'));
  panelToggle.addEventListener('click', togglePanel);
  panelCloseX.addEventListener('click', closePanel);
  panelTaskAdd.addEventListener('click', addTaskFromInput);
  panelTaskInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addTaskFromInput(); });
  panelTasksClear.addEventListener('click', () => void mutate('task:clear', { allTasks: false }));
  panelRemindersClear.addEventListener('click', () => void mutate('reminder:clear', {}));
  panelNoteAdd.addEventListener('click', addNoteFromInput);
  panelNoteInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addNoteFromInput(); });
  panelNotesClear.addEventListener('click', () => void mutate('note:clear', {}));
  panelSourcesClear.addEventListener('click', () => void mutate('source:clear', {}));
  // A reminder fired (consumed by main) → keep an open panel in sync.
  window.cosmo.on('panel:changed', () => { if (panelOverlay.classList.contains('visible')) void refreshPanel(); });

  // ─── Click on eyes = interaction + a little delight ──────────────────────

  container.addEventListener('click', () => {
    window.cosmo.send('user:interaction');
    pack.pulse('giggle');
    pack.pulse('heart');
  });

  // ─── Cursor-follow gaze — driven by MAIN (global cursor), so it works even
  // though the window is a drag surface and the cursor is usually off-window. ─
  window.cosmo.on('companion:gaze', (_, data) => {
    const { dx, dy } = data as { dx: number; dy: number };
    pack.setGaze?.(dx, dy);
  });

  // ─── Error forwarding ────────────────────────────────────────────────────

  window.addEventListener('unhandledrejection', (e) => {
    window.cosmo.send(IPC.RENDERER_ERROR, { message: String(e.reason) });
  });

  window.addEventListener('error', (e) => {
    window.cosmo.send(IPC.RENDERER_ERROR, { message: e.message });
  });
}

init().catch(console.error);
