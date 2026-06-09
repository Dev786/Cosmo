/* Launch probe: confirm we can boot the BUILT app under Playwright, see a window,
   inject a clean light background, and record video. De-risks the full pipeline. */
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron'); // path to the Electron binary
const root = process.cwd();
const outDir = path.join(root, 'scripts/demo/out');
fs.mkdirSync(outDir, { recursive: true });

console.log('electron:', electronPath);
console.log('main:', path.join(root, 'dist/main/main/index.js'));

const app = await electron.launch({
  executablePath: electronPath,
  args: [path.join(root, 'dist/main/main/index.js')],
  env: { ...process.env, PIXEL_DEV: '1' },          // debug state keys + fast thresholds
  recordVideo: { dir: outDir, size: { width: 960, height: 640 } },
});

const page = await app.firstWindow();
console.log('first window title:', await page.title().catch(() => '(none)'));
await page.waitForTimeout(1800);

// Clean, on-brand light backdrop so the recording isn't transparent/black.
await page.addStyleTag({
  content: 'html,body{background:radial-gradient(circle at 50% 38%,#ffffff,#eef1fb)!important;}',
}).catch((e) => console.log('addStyleTag failed:', e.message));

await page.screenshot({ path: path.join(outDir, 'probe.png') }).catch((e) => console.log('shot failed:', e.message));

// Probe the chat drive path.
const hasChat = await page.evaluate(() => !!document.getElementById('chat-input')).catch(() => false);
console.log('has #chat-input:', hasChat);

await page.waitForTimeout(3500);
await app.close();
console.log('probe done — see scripts/demo/out/');
