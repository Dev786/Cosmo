import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/types';

// All channels the renderer is allowed to receive from main
const ALLOWED_RECEIVE: string[] = [
  IPC.MOOD_SET,
  IPC.MOOD_PULSE,
  IPC.MOOD_INTENSITY,
  IPC.ACTIVITY_SET,
  IPC.CHAT_MESSAGE,
  IPC.VOICE_STATUS,
  IPC.CHAT_CAPTURE_MODE,
  IPC.MEETING_QUIET,
  'window:blur',
  'boot:status',
  'boot:ready',
  'voice:listen',
  'voice:mode',
  'companion:gaze',
  'setup:open',
  'control:do',
  'panel:changed',
  'dash:set',
  'chat:clear',
  'cosmo:nudge',
];

// Channels renderer can send to main (one-way)
const ALLOWED_SEND: string[] = [
  IPC.VOICE_TRIGGER,
  IPC.RENDERER_ERROR,
  'user:interaction',
  'window:blur',
  'window:hide',
  'voice:audio',
  'voice:command-begin',
  'voice:mute',
  'chat:resize',
  'dash:pin',
  'setup:resize',
  'panel:resize',
  'chat:persist',
];

// Channels renderer can invoke on main (request/response)
const ALLOWED_INVOKE: string[] = [
  IPC.CHAT_SUBMIT,
  IPC.SETTINGS_GET,
  IPC.SETTINGS_SET,
  'onboarding:test',
  'onboarding:testAutomation',
  'onboarding:requestMic',
  'dev:setMood',
  'boot:state',
  'character:set',
  'setup:state',
  'setup:test',
  'setup:models',
  'setup:save',
  'setup:previewVoice',
  'accounts:connectGoogle',
  'accounts:disconnectGoogle',
  'panel:state',
  'task:add',
  'task:toggle',
  'task:clear',
  'reminder:remove',
  'reminder:clear',
  'note:add',
  'note:clear',
  'source:open',
  'source:clear',
  'chat:recent',
  'chat:older',
  'pomodoro:stop',
];

contextBridge.exposeInMainWorld('cosmo', {
  on(channel: string, cb: (...args: unknown[]) => void): void {
    if (!ALLOWED_RECEIVE.includes(channel)) {
      console.warn(`[preload] Blocked receive on disallowed channel: ${channel}`);
      return;
    }
    ipcRenderer.on(channel, (_event, ...args) => cb(_event, ...args));
  },

  send(channel: string, data?: unknown): void {
    if (!ALLOWED_SEND.includes(channel)) {
      console.warn(`[preload] Blocked send on disallowed channel: ${channel}`);
      return;
    }
    ipcRenderer.send(channel, data);
  },

  invoke(channel: string, data?: unknown): Promise<unknown> {
    if (!ALLOWED_INVOKE.includes(channel)) {
      console.warn(`[preload] Blocked invoke on disallowed channel: ${channel}`);
      return Promise.reject(new Error(`Channel not allowed: ${channel}`));
    }
    return ipcRenderer.invoke(channel, data);
  },
});
