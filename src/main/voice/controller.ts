import type { BrowserWindow } from 'electron';
import { ipcMain } from 'electron';
import { IPC, type Config, type MoodState, type ActivityState } from '../../shared/types';
import { getActiveSTT } from '../stt/registry';
import { startRecording } from './recorder';
import { initWakeWord, destroyWakeWord, onWakeWordDetected, WakeWordNotConfigured, WakeWordInitFailed } from './wakeWord';
import { calloutManager } from '../watchers/calloutManager';
import { speechQueue } from '../core/speechQueue';
import { log } from '../core/log';

export class VoiceController {
  private muted = false;
  private wakeFailed = false;
  private win: BrowserWindow;
  private config: Config;
  private setMood: (s: MoodState, dur?: number) => void;
  private setActivity: (a: ActivityState | null) => void;
  private onInput: (text: string) => Promise<void>;

  constructor(opts: {
    win: BrowserWindow;
    config: Config;
    setMood(s: MoodState, dur?: number): void;
    setActivity(a: ActivityState | null): void;
    onInput(text: string): Promise<void>;
  }) {
    this.win = opts.win;
    this.config = opts.config;
    this.setMood = opts.setMood;
    this.setActivity = opts.setActivity;
    this.onInput = opts.onInput;
  }

  async start(): Promise<void> {
    // Wire mic dot click from renderer
    ipcMain.on(IPC.VOICE_TRIGGER, () => this.triggerListening());

    // Try to init wake word
    const accessKey = process.env.PICOVOICE_ACCESS_KEY ?? '';
    try {
      await initWakeWord(accessKey);
      onWakeWordDetected(() => this.triggerListening());
    } catch (e) {
      this.wakeFailed = true;
      const msg = e instanceof WakeWordNotConfigured
        ? 'Wake word unavailable — tap the dot to talk'
        : `Wake word unavailable (${(e as Error).message}) — tap the dot to talk`;
      log.warn('Wake word init:', msg);
      // Show honest message in chat — voice init must NEVER block startup
      this.win.webContents.send(IPC.CHAT_MESSAGE, { text: msg, type: 'bot' });
      this.win.webContents.send(IPC.VOICE_STATUS, { active: false, wakeFailed: true });
    }

    if (!this.wakeFailed) {
      this.win.webContents.send(IPC.VOICE_STATUS, { active: true, wakeFailed: false });
    }
  }

  /** Single entry point for BOTH wake word detection AND mic dot click */
  async triggerListening(): Promise<void> {
    if (this.muted) return;
    if (calloutManager.isMeetingQuiet()) return;

    this.setMood('listening');
    this.win.webContents.send(IPC.MOOD_SET, { state: 'listening' });

    const recorder = startRecording();

    // Auto-stop after 10s max
    const autoStop = setTimeout(() => recorder.stop(), 10_000);

    try {
      const buffer = await recorder.stop();
      clearTimeout(autoStop);

      if (!buffer.length) {
        this.setMood('idle');
        return;
      }

      this.setMood('thinking');

      const text = await getActiveSTT().transcribe(buffer);
      if (!text.trim()) {
        this.setMood('idle');
        return;
      }

      // Show user's spoken text in chat
      this.win.webContents.send(IPC.CHAT_MESSAGE, { text, type: 'user' });
      await this.onInput(text);

    } catch (e: unknown) {
      log.error('Voice input error:', (e as Error).message);
      this.setMood('idle');
      this.win.webContents.send(IPC.CHAT_MESSAGE, {
        text: `Voice error: ${(e as Error).message}`,
        type: 'bot',
      });
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    speechQueue.setEnabled(!muted);
    this.win.webContents.send(IPC.VOICE_STATUS, { active: !muted, wakeFailed: this.wakeFailed });
  }

  isMuted(): boolean { return this.muted; }
  isWakeFailed(): boolean { return this.wakeFailed; }

  dispose(): void {
    destroyWakeWord();
    ipcMain.removeAllListeners(IPC.VOICE_TRIGGER);
  }
}
