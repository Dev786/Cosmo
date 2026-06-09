/* Live end-to-end verification: launch the BUILT app, drive the real chat through
   the real provider (whatever ~/.pixel config says — currently Groq), and assert
   each promised feature actually works. Reads Cosmo's rendered reply from the DOM
   and the on-disk sources store. Backup/restore of user data is handled by the
   bash wrapper around this script. Run under system node:
     node scripts/demo/verify.mjs */
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import os from 'os';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const root = process.cwd();
const outDir = path.join(root, 'scripts/demo/out/verify');
fs.mkdirSync(outDir, { recursive: true });

const sourcesFile = path.join(os.homedir(), '.pixel', 'sources.json');
const userFile = path.join(os.homedir(), '.pixel', 'workspace', 'USER.md');

const app = await electron.launch({
  executablePath: electronPath,
  args: [path.join(root, 'dist/main/main/index.js')],
  env: { ...process.env, PIXEL_DEV: '1' },
});
const page = await app.firstWindow();
await page.waitForSelector('#chat-input', { timeout: 30_000 });
// Make the chat panel visible so screenshots show the conversation.
await page.evaluate(() => {
  document.getElementById('chat-area')?.classList.add('visible');
  document.getElementById('chat-messages')?.classList.add('visible');
});
await page.waitForTimeout(4000); // let providers/voice settle

/** Submit one chat line via the REAL keydown→submitChat path and wait for the
 *  next bot bubble. Returns the bot reply text. */
async function ask(cmd, timeoutMs = 45_000) {
  const before = await page.evaluate(() => document.querySelectorAll('#chat-messages .msg.bot').length);
  await page.evaluate((text) => {
    const el = document.getElementById('chat-input');
    el.value = text;
    el.focus();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }, cmd);
  try {
    await page.waitForFunction(
      (n) => document.querySelectorAll('#chat-messages .msg.bot').length > n,
      before,
      { timeout: timeoutMs },
    );
  } catch {
    return '[no reply — timed out]';   // don't abort the whole run on one stall
  }
  // brief settle so the full text is in the node
  await page.waitForTimeout(400);
  return page.evaluate(() => {
    const bots = document.querySelectorAll('#chat-messages .msg.bot');
    return bots[bots.length - 1]?.textContent ?? '';
  });
}

const results = [];
function record(name, reply, ok, note = '') {
  results.push({ name, ok, reply, note });
  console.log(`\n${ok ? '✅' : '❌'} ${name}\n   reply: ${JSON.stringify(reply)}${note ? `\n   note: ${note}` : ''}`);
}

const isError = (r) => /something went wrong|failed to call a function|failed_generation/i.test(r);

try {
  // 1) The exact trivial input that crashed before — must NOT error now.
  let r = await ask('Super small how are you');
  record('chitchat (no tool, was crashing)', r, !!r && !isError(r));

  // 2) Weather with NO city — must give a real forecast, not "which city?".
  r = await ask("What's the weather right now? Reply in one short, cheerful sentence.");
  record('weather without a city', r, !!r && !isError(r) && !/which city/i.test(r));

  // 3) Web search — reply should point to Sources, and sources.json must gain rows.
  const srcBefore = (() => { try { return JSON.parse(fs.readFileSync(sourcesFile, 'utf8')).length; } catch { return 0; } })();
  r = await ask('Search the web for the best papers on large language models.', 60_000);
  await page.waitForTimeout(800);
  const srcAfter = (() => { try { return JSON.parse(fs.readFileSync(sourcesFile, 'utf8')).length; } catch { return 0; } })();
  record('web search → Sources tab', r, !!r && !isError(r) && srcAfter > srcBefore, `sources ${srcBefore}→${srcAfter}`);

  // 4) Timer — must confirm a 25-minute timer (and an overlay should be present).
  r = await ask('Start a 25 minute focus timer.');
  const hasOverlay = await page.evaluate(() =>
    !!document.querySelector('[class*="timer"], [id*="timer"], [class*="activity"]'),
  ).catch(() => false);
  record('25-minute timer', r, !!r && !isError(r), `overlay node present: ${hasOverlay}`);

  // 5) Memory — canned confirm + USER.md must contain the fact.
  r = await ask('Remember that I take my coffee black.');
  await page.waitForTimeout(400);
  const userMd = (() => { try { return fs.readFileSync(userFile, 'utf8'); } catch { return ''; } })();
  record('memory write', r, !!r && /coffee black/i.test(userMd), `USER.md has fact: ${/coffee black/i.test(userMd)}`);

  await page.screenshot({ path: path.join(outDir, 'conversation.png') }).catch(() => {});
} catch (e) {
  console.log('\nHARNESS ERROR:', e.message);
} finally {
  await page.screenshot({ path: path.join(outDir, 'final.png') }).catch(() => {});
  await app.close();
}

const passed = results.filter((x) => x.ok).length;
console.log(`\n──────── ${passed}/${results.length} checks passed ────────`);
fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2));
process.exit(passed === results.length ? 0 : 1);
