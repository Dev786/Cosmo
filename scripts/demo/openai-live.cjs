/* Headless Electron probe: decrypt the app's REAL sealed OpenAI key (safeStorage,
   exactly as the app does) and make two live OpenAI tool-calls — the OLD dotted
   name (which OpenAI rejected) vs the NEW sanitised name openaiCompat now sends.
   No window, no Playwright. Run:  npx electron scripts/demo/openai-live.cjs */
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Match the real app's identity so safeStorage resolves the same keychain item
// the app sealed the key under ("cosmo Safe Storage").
app.setName('cosmo');

const cfgPath = path.join(os.homedir(), 'Library/Application Support/cosmo/config.json');

function tools(name) {
  return [{ type: 'function', function: {
    name, description: 'Get the current weather for a city.',
    parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
  } }];
}

async function call(key, model, name) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model, max_completion_tokens: 256,
      messages: [{ role: 'user', content: "What's the weather in Paris? Use a tool." }],
      tools: tools(name), tool_choice: 'auto',
    }),
  });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch {}
  return { status: r.status, call: j?.choices?.[0]?.message?.tool_calls?.[0]?.function?.name, err: j?.error?.message };
}

app.whenReady().then(async () => {
  try {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    const sealed = cfg.secrets?.openai || '';
    let key = '';
    if (sealed.startsWith('enc:')) key = safeStorage.decryptString(Buffer.from(sealed.slice(4), 'base64'));
    else if (sealed.startsWith('raw:')) key = Buffer.from(sealed.slice(4), 'base64').toString('utf8');
    if (!key) { console.log('NO_OPENAI_KEY_DECRYPTED'); app.exit(0); return; }
    const model = cfg.llm?.model || 'gpt-4o-mini';
    console.log('model:', model, '| key decrypted OK (len ' + key.length + ')');

    const dotted = await call(key, model, 'weather.today');
    console.log(`dotted   "weather.today"  → HTTP ${dotted.status}` + (dotted.call ? ` · called ${dotted.call}` : '') + (dotted.err ? ` · ${dotted.err.slice(0, 100)}` : ''));
    const sane = await call(key, model, 'weather_today');
    console.log(`sanitised "weather_today" → HTTP ${sane.status}` + (sane.call ? ` · called ${sane.call}` : '') + (sane.err ? ` · ${sane.err.slice(0, 100)}` : ''));
    console.log(`\nVERDICT: sanitised name ${sane.status === 200 ? 'ACCEPTED ✅' : 'REJECTED ❌'} | dotted name ${dotted.status === 200 ? 'accepted' : 'REJECTED (' + dotted.status + ') — the old bug'}`);
  } catch (e) { console.log('ERR', e.message); }
  app.exit(0);
});
