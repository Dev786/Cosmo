<?php
$page = 'home';
$title = 'Cosmo — local-first AI desktop assistant for macOS (voice, STT & TTS)';
$desc = 'Cosmo is a free, open-source AI desktop companion for macOS: an expressive on-screen character you talk to, with on-device speech-to-text and text-to-speech and a pluggable local (Ollama) or cloud LLM brain. Private by design.';
$page_scripts = ['assets/js/home.js'];
require_once __DIR__ . '/includes/seo.php';
$cfg = cosmo_config();
// One source of truth for the FAQ — rendered visibly below AND as FAQPage schema
// (Google requires the structured Q&As to be visible on the page).
$faq = [
  ['What is Cosmo?', 'Cosmo is a free, open-source AI desktop assistant for macOS — a small, always-on-top animated character you can talk to. It has an on-device voice pipeline (speech-to-text and text-to-speech) and a pluggable LLM brain that runs locally or in the cloud.'],
  ['Does Cosmo run locally and work offline?', 'Yes. Cosmo is local-first: speech recognition and the "Cosmo" wake word run on-device, and you can run the language model fully locally with Ollama. With a local model, Cosmo needs no internet connection and no cloud account.'],
  ['Is Cosmo private? Does it send my data to the cloud?', 'Privacy is built into the architecture. Cosmo never opens your webcam, never logs keystrokes, and never sends your window titles or screen anywhere. The AI only ever sees what you explicitly type or say — and with a local model, nothing leaves your machine.'],
  ['What is the difference between local and cloud TTS and STT?', "Speech-to-text (STT) turns your voice into text; text-to-speech (TTS) turns Cosmo's replies into a spoken voice. Cosmo runs STT on-device and offers both a local voice and cloud voices. Cloud voices can sound richer; local keeps everything offline and free."],
  ['Is Cosmo free?', 'Yes. Cosmo is free and open source under the Apache-2.0 license. You only pay if you choose a cloud LLM or voice and bring your own API key; with Ollama and the local voice it is completely free.'],
  ['Which AI models and providers does Cosmo support?', "Cosmo's brain is pluggable: OpenAI, Anthropic, Google Gemini, xAI Grok, DeepSeek, Groq and Cerebras, or a fully local model via Ollama. The character, eyes and tools stay the same whichever you choose."],
];
$jsonld = [
  cosmo_softwareapp_jsonld($cfg),
  cosmo_faq_jsonld($faq),
];
require __DIR__ . '/includes/header.php';
?>

<section class="hero wrap">
  <div class="hero__eyes" id="hero-eyes" aria-label="Cosmo's animated eyes"></div>
  <span class="eyebrow eyebrow--blue">Local-first · macOS · open source</span>
  <h1>Meet Cosmo</h1>
  <p class="lead center">A tiny companion that lives on your desktop — big expressive eyes, a voice you can talk to, and a knack for actually getting things done. Childlike heart, sharp mind.</p>
  <div class="hero__cta">
    <a class="btn btn--primary js-funnel" href="#">Get Cosmo →</a>
    <a class="btn btn--ghost" href="/demos">See him move</a>
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
    <a class="btn btn--ghost" href="/features">Full feature list</a>
    <a class="btn btn--ghost" href="/architecture">How it's built →</a>
  </div>
</section>

<section class="band band--tint">
  <div class="wrap center">
    <h2>Free to use. A coffee keeps the eyes blinking. ☕</h2>
    <p class="lead center">Cosmo is open source. If he makes you smile, you can chip in — totally optional.</p>
    <div class="hero__cta">
      <a class="btn btn--primary js-funnel" href="#">Get Cosmo on GitHub</a>
      <a class="btn btn--ghost" href="/support">Buy me a coffee</a>
    </div>
  </div>
</section>

<section class="wrap" id="faq">
  <span class="eyebrow eyebrow--blue">Questions</span>
  <h2 class="center">Cosmo FAQ</h2>
  <p class="lead center">What a local-first, private AI desktop assistant actually means — in plain terms.</p>
  <?= cosmo_faq_html($faq) ?>
</section>

<?php require __DIR__ . '/includes/footer.php'; ?>
