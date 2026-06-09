<?php
$page = 'features';
$title = 'Features — Cosmo';
$desc = 'Everything Cosmo can do: expressive eyes, local-first voice, a pluggable AI brain, a real tool system, semantic memory, an Obsidian vault mirror, and gentle work-coaching.';
require __DIR__ . '/includes/header.php';
?>

<section class="hero wrap" style="padding-bottom:10px">
  <h1>What Cosmo can do</h1>
  <p class="lead center">A desktop companion, not a chat window. Here's the whole toolbox.</p>
</section>

<section class="wrap">
  <div class="grid grid--2">

    <div class="card">
      <h2 style="font-size:1.3rem">Personality &amp; liveliness</h2>
      <div class="feat"><div class="feat__ico">🧒</div><div><h3>A curious little kid</h3><p>Bright, innocent and endlessly curious — he answers in short, simple lines like a clever child, never in stiff corporate chatbot-speak.</p></div></div>
      <div class="feat"><div class="feat__ico">👀</div><div><h3>Big expressive eyes</h3><p>Round, glossy eyes that blink on a natural rhythm, follow your cursor, and tween between moods.</p></div></div>
      <div class="feat"><div class="feat__ico">🎭</div><div><h3>Eight moods</h3><p>Idle, listening, thinking, speaking, happy, bored, annoyed, sleeping — each with its own eye shape, gaze, and mouth.</p></div></div>
      <div class="feat"><div class="feat__ico">✨</div><div><h3>Liveliness</h3><p>Yawns, stretches, glances around, giggles, hearts and startles — little micro-behaviors so he feels alive between tasks.</p></div></div>
      <div class="feat"><div class="feat__ico">🪟</div><div><h3>Always-on-top</h3><p>A small, frameless window that sits politely over your work. Hover and a slim dock of controls fans out beside him; the chat opens to the side, so the mic stays live while you talk and type at once.</p></div></div>
    </div>

    <div class="card">
      <h2 style="font-size:1.3rem">Voice <span class="tag tag--green">on-device</span></h2>
      <div class="feat"><div class="feat__ico">🎙️</div><div><h3>Local speech-to-text</h3><p>Transcription runs on your machine (Moonshine / Whisper via transformers.js) — your audio doesn't have to leave.</p></div></div>
      <div class="feat"><div class="feat__ico">🗣️</div><div><h3>Wake word + push-to-talk</h3><p>Tap the mic, or say "Cosmo" to wake him hands-free. Push-to-talk is the default.</p></div></div>
      <div class="feat"><div class="feat__ico">⏱️</div><div><h3>Smart end-of-turn</h3><p>Semantic turn detection knows when you've finished speaking, so he doesn't cut you off or wait awkwardly.</p></div></div>
      <div class="feat"><div class="feat__ico">🔊</div><div><h3>Natural voice + barge-in</h3><p>Local Kokoro TTS (or a cloud voice). Start talking and he stops to listen — no talking over each other.</p></div></div>
    </div>

    <div class="card">
      <h2 style="font-size:1.3rem">The brain</h2>
      <div class="feat"><div class="feat__ico">🧠</div><div><h3>Bring any model</h3><p>OpenAI, Anthropic, Google Gemini, xAI Grok, DeepSeek, Groq, Cerebras — or a fully local model via Ollama.</p></div></div>
      <div class="feat"><div class="feat__ico">🛠️</div><div><h3>Reliable tool-calling</h3><p>Native function-calling on capable models, with a vendor-neutral fallback so a tiny local model and a frontier model stay interchangeable.</p></div></div>
      <div class="feat"><div class="feat__ico">🔁</div><div><h3>Reason → act → observe</h3><p>A ReAct loop lets him chain tools (search → read), react to results, and recover when the first guess is wrong.</p></div></div>
      <div class="feat"><div class="feat__ico">🔑</div><div><h3>Keys stay sealed</h3><p>API keys are encrypted in your OS keychain, never stored as plaintext.</p></div></div>
    </div>

    <div class="card">
      <h2 style="font-size:1.3rem">Gets things done</h2>
      <div class="feat"><div class="feat__ico">🔎</div><div><h3>Web search</h3><p>Looks things up, then drops the sources into a Sources tab instead of reading URLs aloud.</p></div></div>
      <div class="feat"><div class="feat__ico">🚀</div><div><h3>Open apps &amp; sites</h3><p>Launch a Mac app or jump to a website by voice.</p></div></div>
      <div class="feat"><div class="feat__ico">⏰</div><div><h3>Timers, reminders, notes, tasks</h3><p>Quick capture for everything — set a timer (and end it whenever), leave a reminder, jot a note, add a task.</p></div></div>
      <div class="feat"><div class="feat__ico">🔔</div><div><h3>Nudges when it's time</h3><p>When a reminder fires or he's got something for you, he bounces to catch your eye — and if he's tucked away or muted, drops a native notification so you don't miss it.</p></div></div>
      <div class="feat"><div class="feat__ico">🌤️</div><div><h3>Weather, music, volume</h3><p>Today's weather, play/pause/next, nudge the system volume — the everyday bits.</p></div></div>
    </div>

    <div class="card">
      <h2 style="font-size:1.3rem">Memory <span class="tag tag--green">local</span></h2>
      <div class="feat"><div class="feat__ico">💭</div><div><h3>Semantic recall</h3><p>An on-device vector store + local embeddings surface the parts of past conversations that matter for what you're asking now.</p></div></div>
      <div class="feat"><div class="feat__ico">💬</div><div><h3>Conversation history</h3><p>Your chat is saved to a plain file on your machine — he shows the last few messages and pulls in older ones as you scroll up. Yours to read or clear anytime.</p></div></div>
      <div class="feat"><div class="feat__ico">📓</div><div><h3>Obsidian vault mirror</h3><p>Notes, tasks and reminders are mirrored as plain Markdown into an Obsidian vault you own.</p></div></div>
    </div>

    <div class="card">
      <h2 style="font-size:1.3rem">Works with you</h2>
      <div class="feat"><div class="feat__ico">🎯</div><div><h3>Gentle work-coaching</h3><p>Notices idle stretches and time lost on distracting apps — and nudges with expression, not nagging.</p></div></div>
      <div class="feat"><div class="feat__ico">📊</div><div><h3>Day insights &amp; recaps</h3><p>Tracks how your time splits across apps — entirely on-device — and mirrors an <code>Activity.md</code> to your Obsidian vault. Ask "how was my day?" any time, or get a spoken end-of-day recap and week-over-week trend (only if you've enabled proactive speech).</p></div></div>
      <div class="feat"><div class="feat__ico">🧠</div><div><h3>Smart Focus <span class="tag tag--green">opt-in</span></h3><p>Off by default. When you turn it on, Cosmo asks your own model to label an app the local heuristic can't place — sending only the app name and window title, never URLs or your history, and cached so it runs rarely.</p></div></div>
      <div class="feat"><div class="feat__ico">🧩</div><div><h3>Extensible by design</h3><p>Expression packs, tools, and AI providers each grow behind a clean contract — add one without touching the others.</p></div></div>
      <div class="feat"><div class="feat__ico">🔕</div><div><h3>Quiet when needed</h3><p>Proactive speech is off by default — he shows feelings through expression and only speaks when you spoke first.</p></div></div>
    </div>

  </div>

  <div class="center" style="margin-top:40px">
    <a class="btn btn--primary js-funnel" href="#">Get Cosmo →</a>
  </div>
</section>

<?php require __DIR__ . '/includes/footer.php'; ?>
