<?php
$page = 'home';
$title = 'Cosmo — a tiny desktop buddy with big eyes';
$desc = 'Cosmo is an always-on-top desktop companion with big expressive eyes and a local-first voice. Curious heart, sharp mind — he hears you, helps you, and lives on your machine.';
$page_scripts = ['assets/js/home.js'];
require __DIR__ . '/includes/header.php';
?>

<section class="hero wrap">
  <div class="hero__eyes" id="hero-eyes" aria-label="Cosmo's animated eyes"></div>
  <span class="eyebrow eyebrow--blue">Local-first · macOS · open source</span>
  <h1>Meet Cosmo</h1>
  <p class="lead center">A tiny companion that lives on your desktop — big expressive eyes, a voice you can talk to, and a knack for actually getting things done. Childlike heart, sharp mind.</p>
  <div class="hero__cta">
    <a class="btn btn--primary js-funnel" href="#">Get Cosmo →</a>
    <a class="btn btn--ghost" href="demos.php">See him move</a>
  </div>
  <p class="hero__hint">Tip: move your cursor — he's watching. 👀</p>

  <div class="providers reveal">
    <span class="providers__label">Plug in any brain</span>
    <span class="pill pill--plain">OpenAI</span>
    <span class="pill pill--plain">Anthropic</span>
    <span class="pill pill--plain">Gemini</span>
    <span class="pill pill--plain">Grok</span>
    <span class="pill pill--plain">DeepSeek</span>
    <span class="pill pill--plain">Groq</span>
    <span class="pill pill--plain">Cerebras</span>
    <span class="pill pill--pink">Ollama · fully local</span>
  </div>
</section>

<section class="wrap">
  <div class="grid grid--3">
    <div class="card reveal">
      <div class="card__ico">👀</div>
      <h3>Expressive, alive</h3>
      <p>Big animated eyes that blink, glance around, follow your cursor, and shift mood — curious, thinking, happy, sleepy. He <em>feels</em> present, not like a chat box.</p>
    </div>
    <div class="card reveal" data-d="1">
      <div class="card__ico">🎙️</div>
      <h3>Just talk to him</h3>
      <p>On-device speech recognition, a wake word ("Cosmo"), natural end-of-turn detection, and a warm voice back. Push-to-talk by default; go hands-free if you like.</p>
    </div>
    <div class="card reveal" data-d="2">
      <div class="card__ico">🧰</div>
      <h3>Actually does things</h3>
      <p>Searches the web, opens apps and sites, sets timers and reminders, takes notes, checks the weather, controls music — through a clean, extensible tool system.</p>
    </div>
  </div>
</section>

<section class="band band--ink">
  <div class="wrap center">
    <span class="eyebrow" style="color:#9bb0d6">Yours, and only yours</span>
    <h2>Private by architecture, not by promise</h2>
    <p class="lead center">Cosmo is built local-first. The things that should stay on your machine, stay on your machine — it's wired into how he's built.</p>
    <div class="grid grid--3" style="margin-top:34px">
      <div class="card reveal">
        <h3>No keylogging</h3>
        <p>He senses whether you're working from idle-time only — never key codes, never what you type.</p>
      </div>
      <div class="card reveal" data-d="1">
        <h3>No camera, ever</h3>
        <p>Cosmo senses focus from idle-time and your active app — locally. It never opens your webcam, so there's nothing to leak.</p>
      </div>
      <div class="card reveal" data-d="2">
        <h3>Your brain, your keys</h3>
        <p>Run a local model with Ollama, or bring your own API key for a frontier model. You choose.</p>
      </div>
    </div>
  </div>
</section>

<section class="wrap center">
  <span class="eyebrow eyebrow--blue">One buddy, many brains</span>
  <h2>Swap the model, keep the character</h2>
  <p class="lead center">Cosmo speaks to OpenAI, Anthropic, Google Gemini, xAI Grok, DeepSeek, Groq, Cerebras — or a fully local model via Ollama. The personality, the eyes, and the tools stay exactly the same.</p>
  <div class="hero__cta">
    <a class="btn btn--ghost" href="features.php">Full feature list</a>
    <a class="btn btn--ghost" href="architecture.php">How it's built →</a>
  </div>
</section>

<section class="band band--tint">
  <div class="wrap center">
    <h2>Free to use. A coffee keeps the eyes blinking. ☕</h2>
    <p class="lead center">Cosmo is open source. If he makes you smile, you can chip in — totally optional.</p>
    <div class="hero__cta">
      <a class="btn btn--primary js-funnel" href="#">Get Cosmo on GitHub</a>
      <a class="btn btn--ghost" href="support.php">Buy me a coffee</a>
    </div>
  </div>
</section>

<?php require __DIR__ . '/includes/footer.php'; ?>
