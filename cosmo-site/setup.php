<?php
$page = 'setup';
$title = 'Setup — Cosmo';
$desc = 'Get Cosmo running in a few minutes. Every step spelled out, plus a one-command setup script that works on macOS, Linux, and Windows.';
require __DIR__ . '/includes/header.php';
// setup.sh ships at the app repo root. Once the repo is public, this raw URL is
// the from-scratch one-liner (it clones the repo, installs, builds).
$curlUrl = 'https://raw.githubusercontent.com/<your-user>/cosmo/main/setup.sh';
?>

<section class="hero wrap" style="padding-bottom:6px">
  <h1>Set up Cosmo</h1>
  <p class="lead center">A few minutes, start to finish. Do it step by step, or jump to the one-command script at the bottom.</p>
</section>

<section class="wrap">
  <h2>Step by step</h2>

  <ol class="steps">
    <li>
      <h3>1 · Check the prerequisites</h3>
      <p>You'll need <strong>Node.js 20 or newer</strong>, <strong>npm</strong> (ships with Node), and <strong>git</strong>. Cosmo is built for <strong>macOS</strong> — it runs elsewhere, but voice and AppleScript features are macOS-only.</p>
      <pre class="code">node -v   <span># should print v20.x or higher</span>
npm -v
git --version</pre>
      <p>No Node? Grab the LTS from <a href="https://nodejs.org" target="_blank" rel="noopener">nodejs.org</a> (on macOS: <code>brew install node</code>).</p>
    </li>

    <li>
      <h3>2 · Get the code</h3>
      <p>Clone the repository, then move into it. <em>(The repo link is handed to you when you grab Cosmo — hit <a href="#" class="js-funnel">Get Cosmo</a>.)</em></p>
      <pre class="code">git clone &lt;your-cosmo-repo-url&gt; cosmo
cd cosmo</pre>
    </li>

    <li>
      <h3>3 · Install dependencies</h3>
      <pre class="code">npm install</pre>
    </li>

    <li>
      <h3>4 · Build</h3>
      <pre class="code">npm run build</pre>
    </li>

    <li>
      <h3>5 · Launch</h3>
      <p>Start Cosmo in development mode. His eyes appear, always on top.</p>
      <pre class="code">npm run dev</pre>
    </li>

    <li>
      <h3>6 · Configure (in-app)</h3>
      <p>Click the gear <strong>⚙</strong> to open Setup, then:</p>
      <ul class="ticks">
        <li>Pick your <strong>AI provider + model</strong> — OpenAI, Anthropic, Gemini, Grok, DeepSeek, Groq, Cerebras, or local Ollama.</li>
        <li>Paste your <strong>API key</strong> — it's encrypted in your OS keychain, never stored as plaintext.</li>
        <li>Choose your <strong>voice</strong> and finish onboarding.</li>
      </ul>
      <p>Then say <strong>"Cosmo"</strong> or tap the mic and say hi. 👋</p>
    </li>

    <li>
      <h3>7 · Optional — a fully local brain</h3>
      <p>Want zero cloud? Install <a href="https://ollama.com" target="_blank" rel="noopener">Ollama</a> and pull a small model:</p>
      <pre class="code">ollama pull qwen2.5:7b</pre>
      <p>Then choose <strong>Ollama</strong> as the provider in Setup.</p>
    </li>

    <li>
      <h3>8 · Optional — build an app you can share</h3>
      <pre class="code">npm run dist   <span># produces a .dmg in dist/</span></pre>
    </li>
  </ol>
</section>

<section class="band">
  <div class="wrap">
    <h2 class="center">…or the one-command way</h2>
    <p class="lead center">A single script that checks prerequisites, fetches the code, installs, builds, and offers to launch. Works on <strong>macOS</strong>, <strong>Linux</strong>, and <strong>Windows</strong> (via Git Bash or WSL).</p>

    <div class="card" style="max-width:720px;margin:24px auto 0">
      <p style="margin:0 0 8px"><strong>Already cloned the repo?</strong> From inside it:</p>
      <pre class="code">./setup.sh</pre>
      <p style="margin:18px 0 8px"><strong>Starting from scratch?</strong> One line:</p>
      <pre class="code">curl -fsSL <?= e($curlUrl) ?> | bash</pre>
      <p style="margin:18px 0 0;color:var(--muted);font-size:.9rem">The script is safe to re-run — it updates an existing clone instead of starting over, and never overwrites your settings.</p>
    </div>

    <div class="center" style="margin-top:30px">
      <a class="btn btn--primary js-funnel" href="#">Get the repo link →</a>
    </div>
  </div>
</section>

<style>
  .steps{list-style:none;padding:0;counter-reset:none;display:grid;gap:18px}
  .steps>li{background:var(--card);border:1px solid var(--line);border-radius:var(--r-md);padding:22px 24px;box-shadow:var(--shadow-s)}
  .steps h3{font-family:var(--serif);margin:0 0 8px;font-size:1.15rem}
  .steps p{color:var(--muted);margin:0 0 10px}
  .ticks{margin:8px 0 0;padding-left:0;list-style:none}
  .ticks li{padding:5px 0 5px 26px;position:relative;color:var(--muted)}
  .ticks li::before{content:"✓";position:absolute;left:0;color:#1b8a5a;font-weight:700}
  .code{background:#1e1e2e;color:#e6e9f5;border-radius:var(--r-sm);padding:14px 16px;overflow-x:auto;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9rem;line-height:1.6;margin:0}
  .code span{color:#7f8bb0}
  .code code{color:#9bd0ff;background:none;padding:0}
</style>

<?php require __DIR__ . '/includes/footer.php'; ?>
