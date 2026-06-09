import { _electron as electron } from 'playwright-core';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, '..');
const SHOT_DIR = process.env.SCREENSHOT_DIR || '/tmp/cosmo-shots';
fs.mkdirSync(SHOT_DIR, { recursive: true });

const electronBin = path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');

async function run() {
  console.log('Starting Cosmo with Kokoro TTS...');

  const app = await electron.launch({
    executablePath: electronBin,
    args: [path.join(APP_DIR, 'dist/main/main/index.js')],
    env: { ...process.env, PIXEL_DEV: '1' },
    timeout: 60_000,
  });

  await new Promise(r => setTimeout(r, 4000));
  const page = app.windows().find(w => !w.url().startsWith('devtools://')) ?? await app.firstWindow();

  await page.evaluate(() => {
    document.documentElement.style.background = 'linear-gradient(135deg, #e8eaf6 0%, #fce4ec 100%)';
  });

  console.log('App ready. Sending message...');

  // Send message via JS (chat area hidden by default)
  await page.evaluate(() => {
    const chatArea = document.getElementById('chat-area');
    const input = document.getElementById('chat-input');
    if (chatArea) chatArea.classList.add('visible');
    if (input) {
      input.value = 'Say hello in one cute sentence!';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }
  });

  await page.screenshot({ path: path.join(SHOT_DIR, 'voice-thinking.png') });
  console.log('Waiting for Groq response + Kokoro to speak (may take ~15s on first run while model loads)...');

  // Wait for bot response to appear
  let response = '';
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 500));
    response = await page.evaluate(() => {
      const msgs = [...document.querySelectorAll('.msg.bot')];
      return msgs[msgs.length - 1]?.textContent ?? '';
    });
    if (response) break;
  }

  if (response) {
    console.log('✓ Groq replied:', response.slice(0, 80));
    console.log('  Kokoro is now speaking... (listen for af_heart voice)');
  } else {
    console.log('✗ No response within 20s');
  }

  // Wait for speech to finish (give Kokoro time to generate + play)
  await new Promise(r => setTimeout(r, 8000));
  await page.screenshot({ path: path.join(SHOT_DIR, 'voice-speaking.png') });

  await app.close();
  console.log('Done.');
}

run().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
