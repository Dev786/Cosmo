/* Direct, real-API check of the native tool-calling WIRE FORMAT — independent of
   Electron. Proves: (1) a dotted tool name (the old bug) vs (2) the sanitised name
   we now send, against live vendor endpoints. Groq key comes from .env; OpenAI key
   only used if OPENAI_API_KEY is in the environment. Run under node:
     node scripts/demo/api-check.mjs */
import fs from 'fs';
import path from 'path';

const root = process.cwd();
function envKey(name) {
  try {
    const m = fs.readFileSync(path.join(root, '.env'), 'utf8').match(new RegExp(`^\\s*${name}\\s*=\\s*(.+)\\s*$`, 'm'));
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  } catch {}
  return process.env[name] || '';
}

// Two tool payloads: the OLD dotted name (what used to be sent) and the NEW
// sanitised name (what openaiCompat now sends). Same tool, only the name differs.
const toolWith = (name) => ([{
  type: 'function',
  function: { name, description: 'Get the current weather for a city.',
    parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } },
}]);

async function call(baseURL, key, model, tools) {
  const res = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model, max_tokens: 256, stream: false,
      messages: [{ role: 'system', content: 'You can call tools.' }, { role: 'user', content: "What's the weather in Paris?" }],
      tools, tool_choice: 'auto',
    }),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = null; }
  const toolCall = json?.choices?.[0]?.message?.tool_calls?.[0]?.function?.name;
  const errMsg = json?.error?.message;
  return { status: res.status, toolCall, errMsg };
}

async function probe(label, baseURL, key, model) {
  if (!key) { console.log(`\n## ${label}: SKIP (no key)`); return; }
  console.log(`\n## ${label}  (${model})`);
  const dotted = await call(baseURL, key, model, toolWith('weather.today'));
  console.log(`  dotted  "weather.today"  → HTTP ${dotted.status}${dotted.toolCall ? ` · called ${dotted.toolCall}` : ''}${dotted.errMsg ? ` · ${dotted.errMsg.slice(0, 90)}` : ''}`);
  const sane = await call(baseURL, key, model, toolWith('weather_today'));
  console.log(`  sanitised "weather_today" → HTTP ${sane.status}${sane.toolCall ? ` · called ${sane.toolCall}` : ''}${sane.errMsg ? ` · ${sane.errMsg.slice(0, 90)}` : ''}`);
  console.log(`  VERDICT: sanitised name ${sane.status === 200 ? 'ACCEPTED ✅' : 'REJECTED ❌'}`);
}

await probe('Groq', 'https://api.groq.com/openai/v1', envKey('GROQ_API_KEY'), 'llama-3.3-70b-versatile');
await probe('OpenAI', 'https://api.openai.com/v1', process.env.OPENAI_API_KEY || '', 'gpt-4o-mini');
console.log('\n(OpenAI runs only if OPENAI_API_KEY is exported; its key in the app is sealed via safeStorage.)');
