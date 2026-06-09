import { z } from 'zod';
import { registerTool } from '../registry';
import { runScript } from '../../core/osascript';
import type { Tool, ToolContext, ToolResult } from '../types';

const playTool: Tool = {
  name: 'music.play',
  description: 'Play a playlist, track, or artist in Apple Music',
  schema: z.object({
    playlist: z.string().optional(),
    track: z.string().optional(),
    artist: z.string().optional(),
  }),
  permissions: ['automation:Music'],
  availableOffline: true,
  async execute(args, ctx) {
    try {
      let script: string;
      if (args.playlist) {
        script = `tell application "Music" to play playlist "${args.playlist}"`;
      } else if (args.track) {
        script = `tell application "Music"
          set results to (search library playlist 1 for "${args.track}")
          if length of results > 0 then play item 1 of results
        end tell`;
      } else if (args.artist) {
        script = `tell application "Music"
          set results to (search library playlist 1 for "${args.artist}")
          if length of results > 0 then play item 1 of results
        end tell`;
      } else {
        script = `tell application "Music" to play`;
      }
      await runScript(script);
      // A track/artist search can match NOTHING — Apple Music's AppleScript only plays
      // items already in YOUR library, not the streaming catalog — and then the `play`
      // above is a silent no-op. Verify something actually started before claiming
      // success (the old code always reported "Playing…", even when nothing did).
      const playing = (await runScript(
        `tell application "Music"
          if player state is playing then return "yes"
          return "no"
        end tell`,
      ).catch(() => 'no')).trim();
      if (playing !== 'yes') {
        const what = args.track || args.artist || args.playlist || 'that';
        return {
          ok: false,
          error: 'not-found',
          userMessage: `I couldn't play "${what}" — I can only play songs already in your Apple Music library, not the streaming catalog.`,
        };
      }
      // Get now playing
      const nowPlaying = await runScript(`tell application "Music" to get {name of current track, artist of current track}`).catch(() => '');
      const parts = nowPlaying.split(', ');
      const track = parts[0] ?? 'Unknown';
      const artist = parts[1] ?? 'Unknown';
      ctx.setActivity({ type: 'music', nowPlaying: { track, artist } });
      ctx.setMood('happy', 2000);
      return { ok: true, summary: `Playing ${track} by ${artist}` };
    } catch (e: unknown) {
      const msg = (e as Error).message;
      const userMsg = msg.includes('permission') || msg.includes('not allowed')
        ? 'Music control needs Automation permission. Go to System Settings → Privacy → Automation.'
        : `Couldn't play music: ${msg}`;
      return { ok: false, error: msg, userMessage: userMsg };
    }
  },
};

const pauseTool: Tool = {
  name: 'music.pause',
  description: 'Pause Apple Music',
  schema: z.object({}),
  availableOffline: true,
  async execute(_args, ctx) {
    try {
      await runScript(`tell application "Music" to pause`);
      ctx.setActivity(null);
      return { ok: true, summary: 'Music paused.' };
    } catch (e: unknown) {
      return { ok: false, error: (e as Error).message, userMessage: `Couldn't pause: ${(e as Error).message}` };
    }
  },
};

const nextTool: Tool = {
  name: 'music.next',
  description: 'Skip to the next track in Apple Music',
  schema: z.object({}),
  availableOffline: true,
  async execute(_args, ctx) {
    try {
      await runScript(`tell application "Music" to next track`);
      const nowPlaying = await runScript(`tell application "Music" to get {name of current track, artist of current track}`).catch(() => '');
      const parts = nowPlaying.split(', ');
      const track = parts[0] ?? 'Unknown';
      const artist = parts[1] ?? 'Unknown';
      ctx.setActivity({ type: 'music', nowPlaying: { track, artist } });
      return { ok: true, summary: `Now playing: ${track} by ${artist}` };
    } catch (e: unknown) {
      return { ok: false, error: (e as Error).message, userMessage: `Couldn't skip: ${(e as Error).message}` };
    }
  },
};

const nowPlayingTool: Tool = {
  name: 'music.nowPlaying',
  description: 'Get the currently playing track in Apple Music',
  schema: z.object({}),
  availableOffline: true,
  async execute() {
    try {
      const nowPlaying = await runScript(`tell application "Music" to get {name of current track, artist of current track}`);
      const parts = nowPlaying.split(', ');
      return { ok: true, summary: `Now playing: ${parts[0]} by ${parts[1]}`, data: { track: parts[0], artist: parts[1] } };
    } catch {
      return { ok: true, summary: 'Nothing is playing right now.' };
    }
  },
};

export function registerMusicTools(): void {
  registerTool(playTool);
  registerTool(pauseTool);
  registerTool(nextTool);
  registerTool(nowPlayingTool);
}
