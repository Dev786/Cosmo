<?php
$page = 'architecture';
$title = 'How a local AI voice assistant works: STT → LLM → TTS | Cosmo';
$desc = 'A from-scratch tour of how a local-first AI voice assistant is built: voice activity detection, on-device speech-to-text, semantic end-of-turn detection, a ReAct LLM brain with vendor-neutral tool calls, local text-to-speech, semantic memory, and the privacy boundaries — using Cosmo as the worked example.';
require_once __DIR__ . '/includes/seo.php';
$cfg = cosmo_config();
$base = cosmo_site_url($cfg) ?: 'https://example.com';
// FAQ — rendered visibly below AND as FAQPage schema (Google requires both to match).
// Deep "how it works" angle, distinct from the home and features FAQs.
$faq = [
  ['How does a local AI voice assistant work, end to end?', 'The pipeline is: your microphone feeds voice activity detection (VAD), which isolates speech; on-device speech-to-text (STT) turns it into text; a language-model brain reasons over it and calls tools in a reason → act → observe loop; and text-to-speech (TTS) speaks the reply. In Cosmo every step is local-first, and the model only ever sees what you actually said.'],
  ['What is voice activity detection (VAD) and why is it needed?', 'VAD decides, moment to moment, whether you are speaking or silent, so the assistant processes real speech instead of constantly transcribing room noise. Cosmo runs a Silero VAD model on-device, continuously, and gates the rest of the pipeline behind it.'],
  ['What is semantic end-of-turn detection, and how is it different from a silence timeout?', 'A fixed silence timeout often cuts you off mid-thought or feels laggy. Semantic end-of-turn detection uses a small model (Smart Turn) to predict whether you have actually finished your turn, so Cosmo replies at the right moment. If that model is unavailable, it falls back to silence detection.'],
  ['How does on-device speech-to-text work?', 'Cosmo runs an ONNX speech-recognition model (Moonshine by default, or Whisper) through transformers.js in a worker process, entirely on your machine. The model downloads once on first use and is cached; after that, transcription needs no network and your audio never leaves the device.'],
  ['How can one assistant use a local model and a cloud model interchangeably?', 'A provider abstraction hides every LLM behind one interface. Capable models use native function-calling; smaller or local models fall back to a vendor-neutral fenced-JSON tool protocol. That keeps a 7B local model on Ollama and a frontier cloud model interchangeable — the personality, tools, and memory stay identical.'],
  ['What does the AI actually see — is my screen or typing sent to it?', 'Only what you explicitly type or say. Window titles, URLs, typing cadence, and your screen are never put into AI requests; Cosmo never logs keystrokes and never opens your webcam. With a local model, nothing leaves your machine at all.'],
  ['How does on-device semantic memory work?', 'Cosmo stores past conversation snippets as vectors using a local embedding model, then retrieves the most relevant ones by similarity when you ask something new — a small retrieval-augmented memory that runs on your machine, with no cloud database.'],
];
$jsonld = [
  [
    '@context'         => 'https://schema.org',
    '@type'            => 'TechArticle',
    'headline'         => 'How a local-first AI voice assistant works',
    'description'      => $desc,
    'mainEntityOfPage' => $base . '/architecture',
    'inLanguage'       => 'en',
    'author'           => ['@id' => $base . '/#author'],
    'publisher'        => ['@id' => $base . '/#author'],
    'about'            => array_map(fn($t) => ['@type' => 'Thing', 'name' => $t], [
      'Speech recognition', 'Speech synthesis', 'Voice user interface',
      'Large language model', 'On-device machine learning', 'Privacy',
    ]),
    'keywords'         => 'local voice assistant architecture, on-device STT, local TTS, end-of-turn detection, ReAct agent, tool calling, Ollama, private AI',
  ],
  cosmo_breadcrumbs($cfg, [['Home', '/'], ['Architecture', '/architecture']]),
  cosmo_faq_jsonld($faq),
];
require __DIR__ . '/includes/header.php';
?>

<div class="arch-progress" id="arch-progress" aria-hidden="true"></div>

<section class="arch-hero wrap center">
  <div class="hero__eyes" id="arch-eyes" style="height:150px;margin-bottom:14px" aria-hidden="true"></div>
  <span class="eyebrow eyebrow--blue">Under the hood · build-it-yourself</span>
  <h1>How Cosmo works</h1>
  <p class="lead center">Cosmo is small, but it's built like something much bigger should be. This page takes the whole system apart, one piece at a time — what each part does, how it connects to the rest, and why it's built that way — so that by the end you could rebuild it yourself.</p>
  <p class="muted" style="max-width:60ch;margin:14px auto 0;font-size:.95rem">Each chapter starts with a <em>problem</em>, shows you the <strong>contract</strong> before the code, then explains the one decision that made it work. Read top to bottom, or jump around with the menu.</p>
</section>

<section class="wrap" id="systemmap" style="padding:clamp(24px,4vw,48px) 0 8px;scroll-margin-top:86px">
  <div class="center" style="margin-bottom:6px">
    <span class="eyebrow eyebrow--blue">The whole system, connected</span>
    <h2>Every part, on one canvas</h2>
    <p class="lead center">How the pieces actually wire together — your input, the IPC line, the four boundaries, the brain, voice, memory, and what reaches the outside world. Scroll to zoom, drag to pan.</p>
  </div>

  <div class="arch-map" id="arch-map">
    <div class="arch-map__bar">
      <span>System map · Cosmo</span>
      <span class="spacer"></span>
      <button class="arch-map__btn" type="button" data-zoom="out" aria-label="Zoom out">−</button>
      <button class="arch-map__btn" type="button" data-zoom="reset" aria-label="Reset view">⤢</button>
      <button class="arch-map__btn" type="button" data-zoom="in" aria-label="Zoom in">+</button>
    </div>
    <div class="arch-map__viewport">
      <div class="arch-map__canvas">
        <svg viewBox="0 0 1180 800" width="1180" height="800" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Cosmo architecture diagram connecting all parts">
          <defs>
            <marker id="ah"  markerWidth="9" markerHeight="9" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#aab2cc"/></marker>
            <marker id="ahb" markerWidth="9" markerHeight="9" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#4a9eff"/></marker>
            <marker id="ahp" markerWidth="9" markerHeight="9" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#ff6b8a"/></marker>
            <marker id="ahg" markerWidth="9" markerHeight="9" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#1b9a63"/></marker>
          </defs>
          <style>
            .nm{font-family:'Space Grotesk',system-ui,sans-serif;font-weight:600;font-size:15px;fill:#1e1e2e}
            .nm.w{fill:#ffffff}
            .ns{font-family:Inter,system-ui,sans-serif;font-size:11px;fill:#6a6a7e}
            .ns.w{fill:rgba(255,255,255,.74)}
            .bl{font-family:'JetBrains Mono',monospace;font-size:12px;fill:#9090a4;letter-spacing:.1em}
            .e{fill:none;stroke:#aab2cc;stroke-width:2;marker-end:url(#ah)}
            .eb{fill:none;stroke:#4a9eff;stroke-width:2;marker-end:url(#ahb)}
            .ep{fill:none;stroke:#ff6b8a;stroke-width:2;marker-end:url(#ahp)}
            .eg{fill:none;stroke:#1b9a63;stroke-width:2;marker-end:url(#ahg)}
          </style>

          <!-- bands -->
          <rect x="180" y="70"  width="760" height="120" rx="16" fill="#f0f5ff" stroke="#cfe0ff" stroke-width="1.5"/>
          <text x="196" y="92" class="bl">RENDERER · draws &amp; senses</text>
          <rect x="180" y="235" width="760" height="545" rx="16" fill="#f7f8fc" stroke="#e7e8f1" stroke-width="1.5"/>
          <text x="196" y="259" class="bl">MAIN PROCESS · thinks &amp; decides</text>
          <line x1="180" y1="212" x2="940" y2="212" stroke="#cdbfe2" stroke-width="2" stroke-dasharray="7 6"/>
          <text x="560" y="206" text-anchor="middle" class="bl">IPC · MoodState · ActivityState</text>

          <!-- edges (drawn first; arrowheads stop short of target borders) -->
          <path class="eb" d="M156,172 C 360,150 520,142 672,132"/>
          <path class="eb" d="M800,170 C 640,235 430,250 322,266"/>
          <path class="eb" d="M156,277 C 300,288 380,300 462,306"/>
          <path class="eb" d="M422,312 L462,312"/>
          <path class="eb" d="M692,308 L712,308"/>
          <path class="eb" d="M922,314 L972,316"/>
          <path class="eb" d="M578,368 L578,394"/>
          <path class="eb" d="M560,472 L560,504"/>
          <path class="e"  d="M692,430 C 716,448 724,478 752,506"/>
          <path class="eg" d="M922,538 L972,536"/>
          <path class="eg" d="M692,544 C 800,566 905,600 972,626"/>
          <path class="e"  d="M310,472 L310,504"/>
          <path class="ep" d="M422,538 C 560,505 640,462 712,438"/>
          <path class="ep" d="M662,360 C 700,378 712,398 740,402"/>
          <path class="ep" d="M790,398 C 600,250 430,196 312,166"/>
          <!-- callout (proactive speech) → the one speech queue -->
          <path class="eb" d="M310,578 L310,616"/>

          <!-- input nodes -->
          <g><rect x="24" y="150" width="132" height="54" rx="12" fill="#ffffff" stroke="#d9dae8" stroke-width="1.6"/><text x="90" y="182" text-anchor="middle" class="nm">🎤 You speak</text></g>
          <g><rect x="24" y="250" width="132" height="54" rx="12" fill="#ffffff" stroke="#d9dae8" stroke-width="1.6"/><text x="90" y="282" text-anchor="middle" class="nm">⌨ You type</text></g>

          <!-- renderer nodes -->
          <g><rect x="200" y="100" width="200" height="64" rx="12" fill="#eaf3ff" stroke="#9cc8ff" stroke-width="1.6"/><text x="300" y="128" text-anchor="middle" class="nm">Expression pack</text><text x="300" y="146" text-anchor="middle" class="ns">the eyes you see</text></g>
          <g><rect x="680" y="100" width="240" height="64" rx="12" fill="#eaf3ff" stroke="#9cc8ff" stroke-width="1.6"/><text x="800" y="126" text-anchor="middle" class="nm">Mic · voice activity</text><text x="800" y="144" text-anchor="middle" class="ns">detects speech on-device</text></g>

          <!-- main: row 1 -->
          <g><rect x="200" y="270" width="220" height="96" rx="12" fill="#eaf3ff" stroke="#9cc8ff" stroke-width="1.6"/><text x="310" y="300" text-anchor="middle" class="nm">Voice pipeline</text><text x="310" y="320" text-anchor="middle" class="ns">STT worker · wake gate</text><text x="310" y="338" text-anchor="middle" class="ns">smart turn · echo control</text></g>
          <g><rect x="470" y="270" width="220" height="96" rx="12" fill="#ffffff" stroke="#c7cde0" stroke-width="1.8"/><text x="580" y="298" text-anchor="middle" class="nm">Brain</text><text x="580" y="318" text-anchor="middle" class="ns">ReAct: reason→act→observe</text><text x="580" y="336" text-anchor="middle" class="ns">dispatcher · fenced + native</text></g>
          <g><rect x="720" y="270" width="200" height="96" rx="12" fill="#ffffff" stroke="#d9dae8" stroke-width="1.6"/><text x="820" y="298" text-anchor="middle" class="nm">LLM providers</text><text x="820" y="318" text-anchor="middle" class="ns">openaiCompat + Anthropic</text><text x="820" y="336" text-anchor="middle" class="ns">swap any model</text></g>

          <!-- main: row 2 -->
          <g><rect x="200" y="400" width="220" height="70" rx="12" fill="#ffffff" stroke="#d9dae8" stroke-width="1.6"/><text x="310" y="428" text-anchor="middle" class="nm">Watchers</text><text x="310" y="448" text-anchor="middle" class="ns">idle · focus · battery</text></g>
          <g><rect x="470" y="400" width="220" height="70" rx="12" fill="#ffffff" stroke="#d9dae8" stroke-width="1.6"/><text x="580" y="428" text-anchor="middle" class="nm">Tools</text><text x="580" y="448" text-anchor="middle" class="ns">registry · zod · ToolContext</text></g>
          <g><rect x="720" y="400" width="200" height="70" rx="12" fill="#ffeef2" stroke="#ffb3c2" stroke-width="1.6"/><text x="820" y="428" text-anchor="middle" class="nm">StateManager</text><text x="820" y="448" text-anchor="middle" class="ns">single mood owner</text></g>

          <!-- main: row 3 -->
          <g><rect x="200" y="510" width="220" height="64" rx="12" fill="#ffeef2" stroke="#ffb3c2" stroke-width="1.6"/><text x="310" y="536" text-anchor="middle" class="nm">workSignal</text><text x="310" y="554" text-anchor="middle" class="ns">facts → mood + callout</text></g>
          <g><rect x="470" y="510" width="220" height="64" rx="12" fill="#e9f8f0" stroke="#9ad9bd" stroke-width="1.6"/><text x="580" y="536" text-anchor="middle" class="nm">Memory</text><text x="580" y="554" text-anchor="middle" class="ns">vector store · embedder</text></g>
          <g><rect x="720" y="510" width="200" height="64" rx="12" fill="#ffffff" stroke="#d9dae8" stroke-width="1.6"/><text x="820" y="536" text-anchor="middle" class="nm">Core</text><text x="820" y="554" text-anchor="middle" class="ns">osascript · secrets · log</text></g>

          <!-- speech queue: the one serialized voice (anti-outburst funnel) -->
          <g><rect x="200" y="620" width="220" height="64" rx="12" fill="#1e1e2e" stroke="#1e1e2e"/><text x="310" y="646" text-anchor="middle" class="nm w">Speech queue</text><text x="310" y="664" text-anchor="middle" class="ns w">replies + nudges → one voice</text></g>

          <!-- external nodes -->
          <g><rect x="980" y="285" width="170" height="64" rx="12" fill="#1e1e2e" stroke="#1e1e2e"/><text x="1065" y="313" text-anchor="middle" class="nm w">LLM</text><text x="1065" y="331" text-anchor="middle" class="ns w">cloud or local</text></g>
          <g><rect x="980" y="505" width="170" height="64" rx="12" fill="#e9f8f0" stroke="#9ad9bd" stroke-width="1.6"/><text x="1065" y="533" text-anchor="middle" class="nm">Your Mac</text><text x="1065" y="551" text-anchor="middle" class="ns">AppleScript · Music</text></g>
          <g><rect x="980" y="600" width="170" height="60" rx="12" fill="#e9f8f0" stroke="#9ad9bd" stroke-width="1.6"/><text x="1065" y="626" text-anchor="middle" class="nm">Obsidian vault</text><text x="1065" y="644" text-anchor="middle" class="ns">your markdown</text></g>

          <!-- legend -->
          <line x1="210" y1="724" x2="244" y2="724" class="eb"/><text x="252" y="728" class="ns">data · voice · actions</text>
          <line x1="430" y1="724" x2="464" y2="724" class="ep"/><text x="472" y="728" class="ns">mood</text>
          <line x1="560" y1="724" x2="594" y2="724" class="eg"/><text x="602" y="728" class="ns">local &amp; private</text>
          <line x1="740" y1="724" x2="774" y2="724" class="e"/><text x="782" y="728" class="ns">facts</text>
        </svg>
      </div>
      <span class="arch-map__hint">scroll to zoom · drag to pan</span>
    </div>
  </div>
</section>

<div class="arch-layout">

  <!-- ───────── sticky table of contents ───────── -->
  <aside class="arch-toc" aria-label="Chapters">
    <p class="arch-toc__title">The build, in order</p>
    <ol>
      <li><a href="#systemmap"><span class="arch-toc__num">▦</span>The whole system, connected</a></li>
      <li><a href="#map"><span class="arch-toc__num">00</span>The shape of the whole thing</a></li>
      <li><a href="#shell"><span class="arch-toc__num">01</span>Getting a face on screen</a></li>
      <li><a href="#mood"><span class="arch-toc__num">02</span>Who owns how Cosmo feels</a></li>
      <li><a href="#packs"><span class="arch-toc__num">03</span>How the face knows what to draw</a></li>
      <li><a href="#privacy"><span class="arch-toc__num">04</span>The line nothing crosses</a></li>
      <li><a href="#watchers"><span class="arch-toc__num">05</span>Noticing you, honestly</a></li>
      <li><a href="#signal"><span class="arch-toc__num">06</span>Turning facts into feeling</a></li>
      <li><a href="#brain"><span class="arch-toc__num">07</span>Talking to any LLM</a></li>
      <li><a href="#tools"><span class="arch-toc__num">08</span>Actually doing things</a></li>
      <li><a href="#voice"><span class="arch-toc__num">09</span>Hearing and speaking</a></li>
      <li><a href="#comms"><span class="arch-toc__num">10</span>How the parts talk</a></li>
      <li><a href="#memory"><span class="arch-toc__num">11</span>Remembering, locally</a></li>
      <li><a href="#core"><span class="arch-toc__num">12</span>The safe machine</a></li>
      <li><a href="#boot"><span class="arch-toc__num">13</span>How Cosmo wakes up</a></li>
      <li><a href="#build"><span class="arch-toc__num">14</span>Build your own Cosmo</a></li>
      <li class="arch-toc__part"><a href="#payments"><span class="arch-toc__num">II</span>Bonus · how this site takes payments</a></li>
      <li><a href="#pay-flow"><span class="arch-toc__num">15</span>A safe checkout, end to end</a></li>
      <li><a href="#pay-keys"><span class="arch-toc__num">16</span>Keys, secrets &amp; signatures</a></li>
      <li><a href="#pay-webhooks"><span class="arch-toc__num">17</span>Webhooks — the backstop</a></li>
      <li><a href="#pay-money"><span class="arch-toc__num">18</span>One checkout, many currencies</a></li>
    </ol>
  </aside>

  <!-- ───────── chapters ───────── -->
  <div class="arch-content">

    <!-- 00 -->
    <section class="chapter" id="map">
      <span class="chapter__num">Chapter 00 · Orientation</span>
      <h2>The shape of the whole thing</h2>
      <p class="q-lead">Before any code: what are the big pieces, and what rule governs each?</p>
      <p>Cosmo is an Electron app, so it has two halves. The <strong>main process</strong> (Node.js, CommonJS) is the grown-up: it owns timing, state, the AI, tools, the microphone loop, and everything that touches your Mac. The <strong>renderer</strong> (a sandboxed browser window, bundled with esbuild) owns exactly two display-side jobs — drawing the face and running the on-device microphone voice-activity detector. Between them sits a deliberately narrow <strong>IPC boundary</strong> with a tiny shared vocabulary.</p>

      <div class="diagram">
        <div class="diag-layers">
          <div class="diag-layer diag-box--blue"><b>Renderer</b> <small>expression packs · microphone VAD — draws the face and listens for speech, decides nothing</small></div>
          <div class="diag-bound">IPC boundary — only <code>MoodState</code> &amp; <code>ActivityState</code> cross here</div>
          <div class="diag-layer diag-box--ink"><b>Main process</b> <small>state · brain · tools · providers · watchers · voice · memory · core primitives</small></div>
        </div>
        <p class="diagram__cap">main thinks &amp; decides · renderer shows &amp; senses · the line between them is the whole privacy story</p>
      </div>

      <p>Almost every capability hides behind the same shape: a <strong>contract</strong> (a <code>types.ts</code> interface) plus a <strong>registry</strong> (the thing that holds the implementations). Adding a feature means adding a folder — never editing a neighbour. Three boundaries follow this pattern, plus a fourth for sensing:</p>
      <ul>
        <li><strong>Expression packs</strong> — how Cosmo looks (<code>renderer/packs</code>)</li>
        <li><strong>Tools</strong> — what Cosmo can do (<code>main/tools</code>)</li>
        <li><strong>LLM providers</strong> — which brain Cosmo uses (<code>main/ai/providers</code>)</li>
        <li><strong>Watchers</strong> — how Cosmo senses your day (<code>main/watchers</code>)</li>
      </ul>
      <div class="callout callout--why">
        <span class="callout__k">Why this way</span>
        <p>Three reusable ideas carry the whole codebase: <strong>contract + registry</strong> (swap implementations without touching the engine), <strong>single-owner state</strong> (one file decides mood), and <strong>facts vs. judgment</strong> (sensors report, one place decides). Spot these three and the rest is detail.</p>
      </div>
      <div class="chapter-nav"><span></span><a href="#shell">Next: getting a face on screen →</a></div>
    </section>

    <!-- 01 -->
    <section class="chapter" id="shell">
      <span class="chapter__num">Chapter 01 · The shell</span>
      <h2>Getting a face on screen</h2>
      <p class="q-lead">How does a little floating character even appear, always-on-top, without a window frame?</p>
      <p>Main creates a small, frameless, transparent <code>BrowserWindow</code> pinned above other windows, then hands the renderer its HTML. The catch: browser audio APIs (the on-device voice-activity detector, the TTS WASM) refuse to run from a bare <code>file://</code> origin. So main serves the renderer through a custom <code>app://</code> protocol, giving it a real origin where AudioWorklet and WASM behave.</p>
      <p>The window isn't a fixed box, either. One owner in main resizes it on the fly — growing rightward from just his face, to a slim dock the moment your cursor is over him, to a full panel when the chat is open — so he only ever takes the space he's actually using. The catch that shaped it: a non-activating always-on-top panel never receives hover events of its own, so that one owner watches the cursor position from main rather than waiting on the window to report it. One place decides the size; nothing else fights over it.</p>
      <p>The two halves never share objects. They speak only through a <strong>preload bridge</strong> that exposes a tiny allow-listed API — <code>window.cosmo.on() / send() / invoke()</code> — and rejects any channel not on the list. That allow-list <em>is</em> the contract for what main and renderer are allowed to say to each other.</p>
      <div class="callout callout--rule">
        <span class="callout__k">Critical rule</span>
        <p>The renderer is sandboxed and context-isolated. No Node in the window; no direct IPC. Everything crosses through the preload allow-list, so the attack surface is a handful of named messages — not "the whole app."</p>
      </div>
      <div class="chapter-nav"><a href="#map">← Orientation</a><a href="#mood">Next: who owns the mood →</a></div>
    </section>

    <!-- 02 -->
    <section class="chapter" id="mood">
      <span class="chapter__num">Chapter 02 · State</span>
      <h2>Who owns how Cosmo feels</h2>
      <p class="q-lead">If a watcher, a tool, and the brain can all change the mood, who's actually in charge?</p>
      <p>Exactly one file: <code>state.ts</code> in main. The <strong>StateManager</strong> is the single owner of <code>MoodState</code>. Anyone who wants a mood change calls <code>setState(mood, durationMs?)</code>; the manager pushes it to the renderer over IPC and, for transient moods like <em>happy</em> or <em>listening</em>, sets a timer to revert to <em>idle</em>. The renderer never decides a mood — it receives one and draws it.</p>

      <p class="contract__cap">shared/types.ts — the vocabulary that crosses the boundary</p>
      <pre class="code">type MoodState =
  | 'idle' | 'listening' | 'thinking' | 'speaking'
  | 'happy' | 'bored' | 'annoyed' | 'sleeping';

type ActivityState =
  | { type: 'music'; nowPlaying: { track: string; artist: string } }
  | { type: 'searching' }
  | { type: 'timer'; remainingSec: number; label: string }
  | null;</pre>

      <div class="diagram">
        <div class="diag-flow">
          <div class="diag-box">watcher · tool · brain — <small>"set mood to thinking"</small></div>
          <div class="diag-arrow">↓ <code>setState()</code></div>
          <div class="diag-box diag-box--ink"><b>StateManager</b><small>clears revert timer · single source of truth</small></div>
          <div class="diag-arrow">↓ IPC <code>mood:set</code></div>
          <div class="diag-box diag-box--blue"><b>Renderer / pack</b><small>draws the mood, decides nothing</small></div>
        </div>
        <p class="diagram__cap">every mood change funnels through one owner — so two sources can never fight over the face</p>
      </div>
      <div class="callout callout--why">
        <span class="callout__k">Why this way</span>
        <p>Mood is a <em>property</em> with one owner, not a state machine scattered across files. Timing and physics (blink rhythm, idle escalation, how long "happy" lasts) live in main. Packs decide how things look, never <em>when</em> they happen — which is what lets you reskin Cosmo without touching a line of logic.</p>
      </div>
      <div class="chapter-nav"><a href="#shell">← The shell</a><a href="#packs">Next: how the face draws →</a></div>
    </section>

    <!-- 03 -->
    <section class="chapter" id="packs">
      <span class="chapter__num">Chapter 03 · Boundary #1 — Expression packs</span>
      <h2>How the face knows what to draw</h2>
      <p class="q-lead">You want to add a whole new look — anime eyes, a chibi character — without editing the engine. How?</p>
      <p>An expression pack is anything that can render a mood. The contract is small on purpose, and the registry just picks one by name. Adding a look means adding a folder under <code>renderer/packs/&lt;name&gt;/</code> and registering it — the brain, the watchers, and main don't change at all.</p>

      <p class="contract__cap">renderer/packs/types.ts</p>
      <pre class="code">interface ExpressionPack {
  init(container: HTMLElement, opts: { reducedMotion: boolean }): void;
  setState(state: MoodState): void;        <span>// render a mood</span>
  pulse(event: PulseEvent): void;          <span>// one-shot reaction (blink, heart…)</span>
  setActivity(a: ActivityState | null): void;
  setGaze?(dx: number, dy: number): void;  <span>// optional cursor-follow</span>
  dispose(): void;
}</pre>
      <p>The shipped <code>classic</code> pack is pure DOM + CSS: two dark circles, a glossy white shine offset up-left, two clustered catch-lights, cheek blush, and a tweened mouth — exactly the eyes blinking at the top of this page. A second <code>chibi</code> pack swaps in illustrated characters. Both satisfy the same five methods, so main treats them identically.</p>
      <div class="callout callout--trade">
        <span class="callout__k">The boundary pattern</span>
        <p>This same "small contract + registry + one folder per implementation" shape repeats three more times below — for tools, for providers, for watchers. Learn it once here and the rest of the codebase reads itself.</p>
      </div>
      <div class="chapter-nav"><a href="#mood">← State</a><a href="#privacy">Next: the privacy line →</a></div>
    </section>

    <!-- 04 -->
    <section class="chapter" id="privacy">
      <span class="chapter__num">Chapter 04 · The privacy line</span>
      <h2>The line nothing crosses</h2>
      <p class="q-lead">Cosmo notices your day — when you've gone idle, what app you're in. So what stops it from being spyware?</p>
      <p>The architecture, not a promise. Privacy here isn't a setting you trust — it's enforced by where the boundaries are drawn. Cosmo has no camera. It senses your day through a few narrow, <em>local</em> channels: system <em>idle-time</em> (how long since any input), and the <em>frontmost app name, browser domain, and window title</em>, all read on your machine via AppleScript. From those it keeps a private record of how your time was spent — stored in <code>~/.pixel</code> and mirrored to <em>your own</em> Obsidian vault, and sent nowhere. What actually crosses into the rest of the app is a tiny fact:</p>
      <pre class="code"><span>// what the focus watcher reports to the judge — a fact, no title, no URL</span>
{ source: 'focus', cls: 'work' | 'distraction' | 'meeting' | 'neutral', secs: 30 }
<span>// the richer sample is written only to the local activity log on disk</span>
{ app: 'Xcode', title: 'main.ts', domain: '', category: 'dev', secs: 30 }</pre>
      <div class="callout callout--rule">
        <span class="callout__k">Invariants baked in</span>
        <p><strong>No keylogging.</strong> Cosmo knows <em>that</em> you typed from idle-time deltas only — never key codes, never content.<br>
        <strong>Activity stays on your machine.</strong> App name, window title, and domain feed a local activity log (<code>~/.pixel</code>) and a mirrored <code>Activity.md</code> in your own vault — for nudges and your own recaps, never uploaded.<br>
        <strong>By default, nothing implicit reaches the LLM.</strong> Window titles, URLs, app names, and idle facts are <em>never</em> put in a model request — the AI sees only what you explicitly typed or said. The one exception is opt-in: <strong>Smart Focus</strong> (off by default) may send a single app name + window title to your configured model to label an app the local heuristic can't place — never URLs, never your activity history, and cached so it runs rarely.</p>
      </div>
      <p>Because these are structural, you can reason about them by reading the boundary, not by auditing every feature. No tool can see your keystrokes, and nothing ships your activity history to a model — the one app-context path that <em>can</em> reach the model, Smart Focus, stays off until you switch it on.</p>
      <div class="chapter-nav"><a href="#packs">← Packs</a><a href="#watchers">Next: noticing you →</a></div>
    </section>

    <!-- 05 -->
    <section class="chapter" id="watchers">
      <span class="chapter__num">Chapter 05 · Boundary #4 — Watchers</span>
      <h2>Noticing you, honestly</h2>
      <p class="q-lead">How does Cosmo know you've gone idle, or fallen down a distraction hole — without surveilling you?</p>
      <p>Small polling loops called <strong>watchers</strong>. Idle watches system idle-time; focus classifies the frontmost app as work / distraction / neutral; others watch battery and screen-time. Crucially, a watcher's job is to report a <em>fact</em> — "idle for 12 minutes", "distraction app for 15 of the last 30" — and nothing more.</p>
      <p class="contract__cap">main/watchers/types.ts</p>
      <pre class="code">interface Watcher {
  name: string;
  start(ctx: WatcherContext): void;  <span>// emits facts via ctx, never opinions</span>
  stop(): void;
}</pre>
      <p>Detecting which app you're in uses AppleScript through a single chokepoint (Chapter 11) — app name, browser domain, and window title, all kept on your machine. No vision, no keystrokes.</p>
      <div class="callout callout--why">
        <span class="callout__k">Why facts, not moods</span>
        <p>If each watcher could set the mood directly, the idle watcher and the focus watcher could scold you twice for the same lull. Keeping them dumb — pure sensors — means the <em>judgment</em> lives in exactly one tunable place. That place is the next chapter.</p>
      </div>
      <div class="chapter-nav"><a href="#privacy">← Privacy line</a><a href="#signal">Next: facts into feeling →</a></div>
    </section>

    <!-- 06 -->
    <section class="chapter" id="signal">
      <span class="chapter__num">Chapter 06 · Judgment</span>
      <h2>Turning facts into feeling</h2>
      <p class="q-lead">Several sensors are firing facts. Who decides Cosmo should actually look bored — and just once?</p>
      <p>The clean answer is one file: <code>workSignal.ts</code> — the only place allowed to translate the combined stream of watcher facts into a <em>decision</em> — drift to <em>bored</em>, escalate to <em>annoyed</em>, fire a spoken callout, or do nothing because it's outside your work hours. Every "should Cosmo react?" rule lives there, which means tuning the personality is editing one file, not hunting through four.</p>
      <p>And that's how it actually works. A watcher's context exposes exactly one mood-related method — <code>ctx.report(fact)</code> — and nothing else; none of them can touch the mood. <code>workSignal</code> is the single consumer of those facts: it's the only place that calls <code>setMood</code>, fires a callout, applies the cooldowns, and respects your work hours — and it won't stomp a mood you caused yourself (it only nudges Cosmo toward bored or annoyed when he's already idling). The judgment really does live in one tunable file.</p>
      <div class="diagram">
        <div class="diag-3" style="align-items:center">
          <div class="diag-col">
            <div class="diag-box"><b>idle</b><small>idle-time</small></div>
            <div class="diag-box"><b>focus</b><small>app class</small></div>
            <div class="diag-box"><b>battery</b><small>charge state</small></div>
          </div>
          <div class="diag-box diag-box--pink"><b>workSignal</b><small>the one judge · cooldowns · work-hours · no double-scold</small></div>
          <div class="diag-col">
            <div class="diag-box diag-box--ink"><b>setMood()</b><small>bored / annoyed</small></div>
            <div class="diag-box diag-box--ink"><b>callout</b><small>a gentle nudge</small></div>
          </div>
        </div>
        <p class="diagram__cap">many dumb sensors fan in · one smart judge fans out</p>
      </div>
      <div class="chapter-nav"><a href="#watchers">← Watchers</a><a href="#brain">Next: any LLM →</a></div>
    </section>

    <!-- 07 -->
    <section class="chapter" id="brain">
      <span class="chapter__num">Chapter 07 · Boundary #2 — Providers</span>
      <h2>Talking to any LLM</h2>
      <p class="q-lead">A 7B model on your laptop and a frontier model in the cloud should be interchangeable. How do you pull that off?</p>
      <p>Every brain hides behind one contract. The registry returns whichever provider your config selects, and the brain code above never knows which one it got.</p>
      <p class="contract__cap">main/ai/providers/types.ts</p>
      <pre class="code">interface LLMProvider {
  name: string;
  capabilities: { offline: boolean; nativeTools?: boolean };
  chat(req: ChatRequest): Promise&lt;ChatResponse&gt;;
}</pre>
      <p>Six of the seven cloud providers are thin presets over a single shared transport, <code>openaiCompat.ts</code> — they differ by a base URL, an API-key name, and the odd per-vendor quirk (OpenAI's <code>max_completion_tokens</code>, Gemini's empty tool-call ids). Anthropic gets its own adapter because its API shape differs. Adding a new OpenAI-compatible vendor is roughly fifteen lines.</p>
      <div class="diagram">
        <div class="diag-flow">
          <div class="diag-box diag-box--ink"><b>openaiCompat.ts</b><small>one HTTP transport · fenced + native tool paths</small></div>
          <div class="diag-arrow">↑ thin presets ↑</div>
          <div class="diag-row">
            <div class="diag-box"><b>OpenAI</b></div><div class="diag-box"><b>Groq</b></div><div class="diag-box"><b>Gemini</b></div>
            <div class="diag-box"><b>DeepSeek</b></div><div class="diag-box"><b>xAI</b></div><div class="diag-box"><b>Cerebras</b></div><div class="diag-box"><b>Ollama</b></div>
          </div>
        </div>
        <p class="diagram__cap">+ Anthropic as a standalone adapter · all satisfy the same <code>chat()</code></p>
      </div>
      <div class="callout callout--why">
        <span class="callout__k">Why no LangChain</span>
        <p>The tool protocol is plain text (next chapter), not vendor function-calling, so a tiny local model and a frontier model are genuinely swappable. A heavyweight framework would bloat the bundle and couple us to one vendor's calling convention — the opposite of the goal.</p>
      </div>
      <div class="chapter-nav"><a href="#signal">← Judgment</a><a href="#tools">Next: doing things →</a></div>
    </section>

    <!-- 08 -->
    <section class="chapter" id="tools">
      <span class="chapter__num">Chapter 08 · Boundary #3 — Tools &amp; the ReAct loop</span>
      <h2>Actually doing things</h2>
      <p class="q-lead">The model decided to search the web. How does that wish become a real action — safely, and without crashing on a malformed reply?</p>
      <p>A tool is a name, a description, a <strong>zod schema</strong> for its arguments, and an <code>execute</code>. The registry validates arguments against the schema and races execution against a timeout before anything runs — so a tool can't get bad input or hang the app.</p>
      <p class="contract__cap">main/tools/types.ts</p>
      <pre class="code">interface Tool&lt;A&gt; {
  name: string;
  description: string;
  schema: z.ZodType&lt;A&gt;;            <span>// args validated BEFORE execute</span>
  availableOffline: boolean;
  execute(args: A, ctx: ToolContext): Promise&lt;ToolResult&gt;;
}

type ToolResult =
  | { ok: true;  summary: string; data?: unknown }
  | { ok: false; error: string;   userMessage: string };</pre>
      <p>Tools never reach into the app directly. They get a <strong>ToolContext</strong> — <code>ctx.speak()</code>, <code>ctx.setMood()</code>, <code>ctx.setActivity()</code>, <code>ctx.config</code>, <code>ctx.log</code> — so they stay testable and can't poke at internals they shouldn't.</p>

      <h3>The tool-call protocol</h3>
      <p>Tool calls are <strong>fenced JSON blocks in plain text</strong> — deliberately not vendor function-calling. The dispatcher parses them out of the model's prose; capable cloud models additionally use native function-calling, but both paths converge in the same loop. Unknown tool or broken JSON? It falls back to a plain text answer. It never crashes.</p>
      <pre class="code"><span>// the model writes this; the dispatcher extracts it</span>
```search.web
{ "query": "papers on large language models" }
```</pre>

      <h3>Reason → Act → Observe</h3>
      <p>The brain runs a bounded <strong>ReAct loop</strong> (up to four steps): the model reasons, optionally calls one tool, sees the result as an observation, and continues — so it can chain <em>search → read</em> and recover when the first guess is wrong. Identical calls are de-duplicated so it can't spin.</p>
      <ol class="flow-steps">
        <li><b>You speak or type</b><small>the only thing that enters the brain is what you explicitly said</small></li>
        <li><b>Model replies with prose + maybe a fenced tool block</b><small>"On it —" then <code>search.web {…}</code></small></li>
        <li><b>Dispatcher parses &amp; validates</b><small>zod-checks args; unknown/garbled → plain answer, no crash</small></li>
        <li><b>Registry executes with a timeout</b><small>tool runs with an injected ToolContext, capped at a few seconds</small></li>
        <li><b>Result fed back as an observation</b><small>loop continues, or the model writes its final reply</small></li>
        <li><b>Cosmo speaks the answer</b><small>through the serialized speech queue (Chapter 10)</small></li>
      </ol>
      <div class="callout callout--rule">
        <span class="callout__k">Critical rule</span>
        <p>Timeouts and error-wrapping live in the <em>registry</em>, not in individual tools. A tool author writes the happy path; the boundary makes it safe. That's why a malformed model reply degrades to text instead of taking down the app.</p>
      </div>
      <div class="chapter-nav"><a href="#brain">← Providers</a><a href="#voice">Next: voice →</a></div>
    </section>

    <!-- 09 -->
    <section class="chapter" id="voice">
      <span class="chapter__num">Chapter 09 · The voice pipeline</span>
      <h2>Hearing and speaking</h2>
      <p class="q-lead">From "Cosmo…" out loud to a spoken answer back — without cutting you off, talking over itself, or shipping your audio anywhere it shouldn't go.</p>
      <p>The renderer runs an on-device voice-activity detector (Silero VAD) and ships finished speech segments to main. Main transcribes them — locally by default (Moonshine / Whisper via transformers.js, in a forked worker process), or via a cloud STT provider if you choose one. A <strong>wake-word gate</strong> opens a short window when it hears "Cosmo", and <strong>smart end-of-turn</strong> detection decides you've actually finished talking instead of just pausing.</p>
      <ol class="flow-steps">
        <li><b>VAD catches a speech segment</b><small>renderer → main, 16 kHz audio · paused while Cosmo talks (echo control)</small></li>
        <li><b>STT transcribes</b><small>local Whisper/Moonshine worker by default; cloud optional</small></li>
        <li><b>Wake gate + smart turn</b><small>fuzzy-matches "Cosmo", rejects "cosmos/costco", waits for a real end-of-turn</small></li>
        <li><b>The brain runs</b><small>the ReAct loop from Chapter 08</small></li>
        <li><b>Speech queue speaks</b><small>serialized TTS (local Kokoro or cloud) with a watchdog so a stuck voice can't mute the mic</small></li>
      </ol>
      <p>Tap the mic mid-sentence and Cosmo stops instantly — <strong>barge-in</strong> aborts synthesis, clears the queue, and drops straight into listening. The whole thing is glued together by one primitive, the speech queue, so tools just call <code>ctx.speak()</code> and never worry about ordering.</p>
      <div class="callout callout--trade">
        <span class="callout__k">A decision worth seeing</span>
        <p>The ONNX speech models run in a <em>forked system-node worker</em>, not in Electron's bundled Node — onnxruntime crashes under Electron's runtime. A small platform quirk, but it's the kind of thing the architecture has to make room for, so it's isolated behind a worker boundary.</p>
      </div>
      <div class="chapter-nav"><a href="#tools">← Tools</a><a href="#comms">Next: how the parts talk →</a></div>
    </section>

    <!-- 10 -->
    <section class="chapter" id="comms">
      <span class="chapter__num">Chapter 10 · Communication</span>
      <h2>How the parts talk — and why Cosmo never talks over itself</h2>
      <p class="q-lead">Two processes, a handful of background loops, and tools all wanting to say something. What carries those messages — and what stops Cosmo from blurting four things at once?</p>

      <h3>The line between the two halves</h3>
      <p>Main and the renderer never share an object. They pass <em>messages</em> across the preload allow-list from Chapter 01, and the traffic comes in two distinct shapes:</p>
      <ul>
        <li><strong>Pushes</strong> — fire-and-forget, main → renderer. Main decides something changed and tells the face: <code>mood:set</code>, <code>activity:set</code>, <code>chat:message</code>, <code>voice:status</code>. The renderer subscribes with <code>window.cosmo.on(…)</code> and redraws.</li>
        <li><strong>Requests</strong> — ask-and-wait, renderer → main. <code>window.cosmo.invoke('settings:get')</code> returns a value; <code>chat:submit</code> hands main what you typed and waits for the reply. Anything that needs an answer uses <code>invoke</code>; anything fire-once uses <code>send</code>.</li>
      </ul>
      <p>In the draw direction only <code>MoodState</code> and <code>ActivityState</code> ever cross — the same narrow vocabulary from Chapter 02. Every channel name is an explicit enum in <code>shared/types.ts</code>, so both sides agree on exactly which messages exist; a channel that isn't on the list is rejected by the bridge.</p>

      <h3>One mouth, one queue</h3>
      <p>Speaking is the one place a floating companion can embarrass itself. A reply lands just as the idle watcher gets bored, the battery dips, and a timer ends — four voices, all at once, talking over each other. Cosmo routes <em>every</em> spoken line through a two-stage pipeline so that can't happen.</p>

      <p class="contract__cap">main/watchers/calloutManager.ts — the gate in front of the queue</p>
      <pre class="code">requestCallout(text, config) {
  if (!config.voice.proactiveSpeech) return;          <span>// opt-in: Cosmo is quiet by default</span>
  if (this.paused || this.meetingQuiet) return;       <span>// never mid-meeting</span>
  if (Date.now() - this.lastCalloutAt &lt; cooldownMs) return;  <span>// ≤ 1 nudge per cooldown (def. 20 min)</span>
  this.lastCalloutAt = Date.now();
  speechQueue.enqueue(text);                           <span>// → the one serialized queue</span>
  this.onSpeak?.(text);                                <span>// + a visual nudge if he's off-screen / muted</span>
}</pre>

      <p><strong>Stage 1 — the callout gate.</strong> The watchers' proactive nudges ("you've gone quiet…") go through <code>calloutManager</code> first. It drops the line unless you've opted into proactive speech, and then only when Cosmo isn't in a meeting or paused and a <em>cooldown</em> has elapsed since the last nudge. So even when idle, focus, and battery all fire in the same second, at most one nudge survives — the rest are silently swallowed.</p>
      <p><strong>Stage 2 — the speech queue.</strong> Everything that <em>does</em> speak — the questions you asked answered <em>and</em> the surviving nudge — is enqueued in one FIFO <code>speechQueue</code> that speaks <strong>one utterance at a time</strong>, never overlapping. Each line is sanitized for the synth, capped so a runaway reply can't synthesize minutes of audio, and guarded by a 30-second watchdog so a wedged audio device can't freeze the mic. Tap the mic to interrupt and <strong>barge-in</strong> aborts the current line and empties the queue.</p>

      <p><strong>And one more guarantee — that you actually notice.</strong> A hush is no use if Cosmo is buried behind a window or muted in the tray, so every <em>proactive</em> line — a surviving callout, a daily recap, a reminder coming due — also fires a silent visual nudge through the same hook (<code>onSpeak</code> above): he bounces in place to catch your eye, and if he's hidden or muted, raises a native notification instead. The gate decides <em>whether</em> to speak up; this makes sure the moment lands even when the voice can't.</p>

      <div class="diagram">
        <div class="diag-flow">
          <div class="diag-row">
            <div class="diag-box"><b>idle</b></div><div class="diag-box"><b>focus</b></div><div class="diag-box"><b>battery</b></div>
          </div>
          <div class="diag-arrow">↓ proactive nudges</div>
          <div class="diag-box diag-box--pink"><b>callout gate</b><small>opt-in · meeting-quiet · cooldown → ≤ 1 nudge per window</small></div>
          <div class="diag-row">
            <div class="diag-box"><b>surviving nudge</b><small>passed the gate</small></div>
            <div class="diag-box"><b>your reply</b><small>you asked — skips the gate</small></div>
          </div>
          <div class="diag-arrow">↓ <code>enqueue()</code></div>
          <div class="diag-box diag-box--ink"><b>speech queue</b><small>FIFO · one utterance at a time · sanitize · watchdog · barge-in</small></div>
          <div class="diag-arrow">↓</div>
          <div class="diag-box diag-box--blue"><b>one voice</b><small>lines never overlap</small></div>
        </div>
        <p class="diagram__cap">proactive nudges must pass the cooldown gate · your direct replies skip it, but everything still serializes through the one queue</p>
      </div>
      <div class="callout callout--why">
        <span class="callout__k">Why two stages</span>
        <p>They solve different problems. The cooldown controls <em>how often</em> Cosmo speaks up on its own — that's taste, and it's tunable. The queue controls <em>whether two sounds ever overlap</em> — that's a hard guarantee, because <code>ctx.speak()</code> is the only way anything makes sound and it always lands in the same single-consumer queue. Separate the "how often" from the "never at once" and each stays simple.</p>
      </div>
      <div class="chapter-nav"><a href="#voice">← Voice</a><a href="#memory">Next: memory →</a></div>
    </section>

    <!-- 11 -->
    <section class="chapter" id="memory">
      <span class="chapter__num">Chapter 11 · Memory</span>
      <h2>Remembering, locally</h2>
      <p class="q-lead">Cosmo should recall what matters from past chats — without dumping your whole history into every prompt, and without a cloud database.</p>
      <p>Memory is two cooperating ideas. <strong>Semantic recall</strong> keeps a plain-JSON vector store on disk; a forked worker runs a small local embedding model (all-MiniLM, 384-dim). When you ask something, Cosmo embeds the query, cosine-searches the store, and injects only the handful of relevant chunks. If the embedder isn't ready, it falls back to injecting the memory files whole — it degrades, it doesn't fail.</p>
      <div class="callout callout--why">
        <span class="callout__k">Why JSON, not SQLite</span>
        <p>A file-based store has zero native dependencies, re-indexes on file mtime (cheap and self-healing), and is trivial to inspect. For one user's memory it's more than fast enough — and it survives packaging quirks that a compiled vector extension wouldn't.</p>
      </div>
      <p>The second idea is the <strong>Obsidian vault mirror</strong>: every note, task, and reminder is also written as plain Markdown into a vault folder you own. The canonical stores live elsewhere; the vault is a readable projection you can browse or edit. Redundant on purpose — your data is never trapped inside Cosmo.</p>
      <p>Your conversation is kept the same honest way. Every message is appended to a plain transcript file in <code>~/.pixel</code>; the chat window shows only the last few and lazy-loads older ones as you scroll up, so a long history never bloats memory or a prompt. Local, capped, and yours to clear in a click — like everything else here, nothing about your past is locked in a format only Cosmo can read.</p>
      <div class="chapter-nav"><a href="#comms">← Communication</a><a href="#core">Next: the safe machine →</a></div>
    </section>

    <!-- 12 -->
    <section class="chapter" id="core">
      <span class="chapter__num">Chapter 12 · Core primitives</span>
      <h2>The safe machine</h2>
      <p class="q-lead">Tools and watchers all want to run AppleScript, speak, log, and read API keys. How do you give them that without scattering risk everywhere?</p>
      <p>Shared low-level modules in <code>main/core/</code>, injected through context — tools and watchers use them, never import them directly:</p>
      <ul>
        <li><strong><code>osascript.ts</code></strong> — the <em>only</em> place AppleScript runs. Always <code>execFile</code> with an argument array, never a shell string with your text interpolated in. One chokepoint to audit for injection.</li>
        <li><strong><code>speechQueue.ts</code></strong> — serialized TTS with abort and a 30-second watchdog, so a bad audio device can't leave the mic muted forever.</li>
        <li><strong><code>secrets.ts</code></strong> — API keys sealed via the OS keychain (<code>safeStorage</code>), never written as plaintext.</li>
        <li><strong><code>log.ts</code></strong> — a rotating logger to <code>~/.pixel/logs</code>.</li>
      </ul>
      <div class="callout callout--rule">
        <span class="callout__k">Critical rule</span>
        <p>One chokepoint per dangerous capability. AppleScript only through <code>osascript.ts</code>; TTS only through the speech queue; keys only through <code>secrets.ts</code>. Centralizing the risk is what makes the rest of the code boring — and boring is safe.</p>
      </div>
      <div class="chapter-nav"><a href="#memory">← Memory</a><a href="#boot">Next: how he wakes up →</a></div>
    </section>

    <!-- 13 -->
    <section class="chapter" id="boot">
      <span class="chapter__num">Chapter 13 · Waking up</span>
      <h2>How Cosmo comes alive — and where his soul lives</h2>
      <p class="q-lead">Before the face ever appears, something has to decide <em>who</em> Cosmo is. Where does his personality come from — and what order does everything else switch on in?</p>
      <p>Cosmo's personality isn't compiled in. It lives as plain Markdown you can open and edit, under <code>~/.pixel/workspace/</code>. On the very first run main <em>seeds</em> those files with the built-in persona and operating rules, then leaves them alone forever after — so the instant you change a line, your version is what Cosmo reads.</p>
      <p class="contract__cap">~/.pixel/workspace/ — editable, plain markdown</p>
      <pre class="code">SOUL.md      # personality, voice, values — the character sheet
AGENTS.md    # operating rules: when to use a tool, the output contract
USER.md      # durable facts about you ("remember X" appends here)
MEMORY.md    # curated long-term memory across sessions
memory/YYYY-MM-DD.md   # daily notes — compaction folds into these</pre>
      <p>The seed is <strong>write-if-missing</strong>: <code>ensureWorkspace()</code> runs every boot but only creates a file that isn't there yet, so your edits survive every update. Each turn the prompt builder <em>loads</em> them back — <code>context.ts</code> reads SOUL (the persona), AGENTS (the rules), and USER + MEMORY (what Cosmo knows about you) and folds them into the system prompt, shaped per model family. Personality is data, not code: change the file, change Cosmo, no rebuild.</p>
      <p>With the soul in place, the rest comes up in a deliberate order. Startup splits in two halves: a synchronous stretch that runs the moment main loads — environment, config, and the workspace + vault seeds — and then everything inside <code>app.whenReady()</code>, where the window, the four registries, and the voice worker switch on. A loader overlay holds the face back until voice, ears, and turn-detection all report ready, with a 25-second safety net so one stuck subsystem can't trap it forever.</p>
      <div class="diagram">
        <div class="diag-flow">
          <div class="diag-arrow">① the moment main loads · synchronous</div>
          <div class="diag-box diag-box--blue"><b>load .env</b><small>project root in dev · app resources when packaged</small></div>
          <div class="diag-arrow">↓</div>
          <div class="diag-box"><b>config store + <code>backfillDefaults()</code></b><small>your saved choices win · new defaults fill the gaps</small></div>
          <div class="diag-arrow">↓</div>
          <div class="diag-box diag-box--pink"><b><code>ensureWorkspace()</code> · seed if missing</b><small>SOUL.md · AGENTS.md · USER.md · MEMORY.md — your edits always survive</small></div>
          <div class="diag-arrow">↓</div>
          <div class="diag-box"><b>migrate memory · seed vault · <code>warmRecall()</code></b><small>fold legacy memory into USER.md · build the embedder index in the background</small></div>
          <div class="diag-arrow">↓  then <code>app.whenReady()</code>  ↓</div>
          <div class="diag-box diag-box--blue"><b>② window + tray</b><small>frameless always-on-top panel · served over <code>app://</code></small></div>
          <div class="diag-arrow">↓</div>
          <div class="diag-box"><b>fill the four registries</b><small>providers · tools · STT · TTS — each boundary populates itself</small></div>
          <div class="diag-arrow">↓</div>
          <div class="diag-box"><b>warm the voice worker</b><small>local ASR + Smart Turn v3 · wake loop + liveliness begin</small></div>
          <div class="diag-arrow">↓</div>
          <div class="diag-box diag-box--ink"><b><code>boot:ready</code> → the loader lifts</b><small>voice · ears · turn all green (25s safety net)</small></div>
        </div>
        <p class="diagram__cap">seed the editable soul before the face appears · then warm the senses · the loader waits for all three</p>
      </div>
      <div class="callout callout--why">
        <span class="callout__k">Why a folder of Markdown, not constants</span>
        <p>Hardcoding the persona in TypeScript means only a rebuild can retune the voice — and you can never actually see what Cosmo "is". Plain files make the personality inspectable, diffable, and yours to rewrite. Same local-and-open principle as the vault and the chat transcript: nothing about who Cosmo is, or what he knows, is locked in a format only Cosmo can read.</p>
      </div>
      <div class="chapter-nav"><a href="#core">← Core primitives</a><a href="#build">Next: build your own →</a></div>
    </section>

    <!-- 14 -->
    <section class="chapter" id="build">
      <span class="chapter__num">Chapter 14 · Epilogue</span>
      <h2>Build your own Cosmo</h2>
      <p>You've now seen every load-bearing piece. The same three patterns held the whole way down:</p>
      <ul>
        <li><strong>Contract + registry</strong> — packs, tools, providers, watchers. Add a folder, never edit a neighbour.</li>
        <li><strong>Single-owner state</strong> — <code>state.ts</code> owns mood; <code>workSignal.ts</code> owns judgment, turning watcher facts into a mood or a nudge; one owner in main even owns the window's size. One owner each, no fights.</li>
        <li><strong>Facts vs. judgment</strong> — sensors report, one place decides. Privacy and personality both fall out of this.</li>
      </ul>
      <p>If you wanted to rebuild it from nothing, the order writes itself — and each step is a working app:</p>
      <ol class="flow-steps">
        <li><b>A frameless always-on-top Electron window</b><small>serve the renderer over <code>app://</code></small></li>
        <li><b>One mood, one owner</b><small>StateManager pushes <code>MoodState</code> to a CSS-eyes pack</small></li>
        <li><b>One LLM provider + the fenced-JSON ReAct loop</b><small>start with a single cloud model</small></li>
        <li><b>A couple of tools</b><small>search, open URL, timer — behind the zod-validated registry</small></li>
        <li><b>Voice</b><small>cloud STT/TTS first, then a local Whisper worker, then wake word + barge-in</small></li>
        <li><b>Watchers → workSignal</b><small>watchers report idle and focus facts; workSignal turns them into mood and nudges</small></li>
        <li><b>Memory</b><small>a JSON vector store + a local embedder worker, plus the vault mirror</small></li>
        <li><b>Harden the boundaries</b><small>the privacy line, the AppleScript chokepoint, sealed keys</small></li>
      </ol>
      <div class="center" style="margin-top:30px">
        <a class="btn btn--primary js-funnel" href="#">Get the code →</a>
        <a class="btn btn--ghost" href="/features">See the full feature list</a>
      </div>
      <div class="chapter-nav"><a href="#boot">← Waking up</a><a href="#payments">Bonus: how this site takes payments ↓</a></div>
    </section>

    <!-- ───────── Part II · Payments (bonus, educational) ───────── -->
    <section class="chapter arch-part" id="payments">
      <span class="chapter__num">Part II · A different system, same instincts</span>
      <h2>Bonus: how this very site takes payments</h2>
      <p class="q-lead">You just took Cosmo apart. Here's a second, much smaller system — the "buy me a coffee" button on this very page — and it leans on the same instincts: one owner per job, a contract you can swap behind, and a hard line that secrets never cross.</p>
      <p>The goal is modest: let a visitor leave an optional tip in their own currency, then hand back the GitHub link — on a plain PHP site with no payment SDK bundled in. The whole thing reduces to <strong>three ideas</strong> and <strong>one pattern</strong> you've already met. The three ideas: the browser is never trusted, the secret never leaves the server, and every payment is confirmed twice. The one pattern: each payment processor hides behind a single contract — the same contract-plus-registry shape that carried all of Part I.</p>
      <div class="callout callout--trade">
        <span class="callout__k">What you won't see here</span>
        <p>No routes, no file names, no copy-paste endpoints — on purpose. This is the <em>shape</em> of a safe integration, the part that's the same whether you use Razorpay, PayPal, or Stripe, so you can build your own rather than clone ours.</p>
      </div>
      <div class="chapter-nav"><a href="#build">← Build your own Cosmo</a><a href="#pay-flow">Next: a safe checkout →</a></div>
    </section>

    <!-- 15 -->
    <section class="chapter" id="pay-flow">
      <span class="chapter__num">Chapter 15 · Payments — the flow</span>
      <h2>A safe checkout, end to end</h2>
      <p class="q-lead">A visitor wants to leave a $5 tip. Where does the money actually change hands — and which parts of this is the browser allowed to decide? (Almost none of it.)</p>
      <p>The browser is hostile territory: anyone can open dev-tools and change a number. So the rule is strict — the browser may <em>start</em> a payment and <em>display</em> the provider's checkout, but the <strong>amount, the verification, and the reward are all decided on your server</strong>. The payment provider (Razorpay for ₹, PayPal for other currencies) is the only thing that actually moves money; your server is the only thing trusted to say it happened.</p>
      <ol class="flow-steps">
        <li><b>Browser asks your server to start a tip</b><small>it sends an amount + currency — but the server re-checks that amount against a minimum; the page's number is never trusted on its own</small></li>
        <li><b>Server creates an order with the provider</b><small>server-to-server, using the secret key; the browser gets back only an order id + your public identifier — never the secret</small></li>
        <li><b>The provider's checkout opens in the browser</b><small>card form or wallet, hosted by the provider — your site never sees card details</small></li>
        <li><b>The visitor pays the provider directly</b><small>money moves between the visitor and the provider, not through your server</small></li>
        <li><b>Server confirms with the provider</b><small>it verifies a signature, or captures the order server-side — and believes only the provider's own answer, never a "success" flag from the page</small></li>
        <li><b>Confirmed → server unlocks the reward</b><small>flip the record to paid, hand back the GitHub link</small></li>
      </ol>
      <div class="diagram">
        <div class="diag-layers">
          <div class="diag-layer diag-box--blue"><b>Browser · untrusted</b> <small>holds the public identifier only · opens the provider's checkout · can be tampered with, so it decides nothing</small></div>
          <div class="diag-bound">the trust line — the secret key and every "is this really paid?" decision stay on this side</div>
          <div class="diag-layer diag-box--ink"><b>Your server · trusted</b> <small>holds the secret · creates the order · verifies the payment · releases the reward</small></div>
        </div>
        <p class="diagram__cap">the browser may start and display a payment · only the server may decide it succeeded</p>
      </div>
      <div class="callout callout--why">
        <span class="callout__k">Why the browser decides nothing</span>
        <p>It's the same lesson as Cosmo's privacy line (Chapter 04): trust is a property of <em>where you draw the boundary</em>, not a promise you make. Treat every value from the page as a <em>request</em> to be re-checked, and a tampered amount or a faked "it worked" simply can't get past the server.</p>
      </div>
      <div class="chapter-nav"><a href="#payments">← Bonus intro</a><a href="#pay-keys">Next: keys &amp; secrets →</a></div>
    </section>

    <!-- 16 -->
    <section class="chapter" id="pay-keys">
      <span class="chapter__num">Chapter 16 · Payments — credentials</span>
      <h2>Keys, secrets &amp; signatures</h2>
      <p class="q-lead">Every provider hands you two strings that look alike: a <em>publishable</em> key and a <em>secret</em> key. Swap them by accident and you either break checkout or hand the world your account.</p>
      <p>Three credentials, and the whole integration's safety is just keeping them in the right place:</p>
      <ul>
        <li><strong>Publishable key / client id — a token that's safe in public.</strong> It only <em>identifies</em> your account to the provider. It can start a checkout but can't move money or read anything. This is the one value allowed into the browser.</li>
        <li><strong>Secret key — never leaves the server.</strong> It <em>authenticates</em> your server when it creates or captures an order. In the browser it would let anyone charge as you, so it lives only in an environment file the web server can read and the public can't.</li>
        <li><strong>Webhook secret — proves the provider is the one calling.</strong> Used to confirm a server-to-server notification genuinely came from the provider and wasn't forged (full webhooks next chapter).</li>
      </ul>
      <p class="contract__cap">where each credential is allowed to live</p>
      <pre class="code">PUBLIC  · in the page    →  publishable key / client id   <span>// identify only</span>
SECRET  · on the server  →  secret key                    <span>// create &amp; capture orders</span>
SECRET  · on the server  →  webhook secret                <span>// verify provider callbacks</span></pre>
      <p>Confirmation comes in two flavours, and a provider gives you one or the other:</p>
      <ul>
        <li><strong>Signature check.</strong> After payment, the provider hands the browser a signature. Your server recomputes it from the order id + payment id using the secret key, and believes the payment only if they match — proof nothing was tampered with in transit.</li>
        <li><strong>Server-side capture.</strong> Instead, your server <em>asks</em> the provider directly: "did this order complete, and for how much?" You trust only that reply, and cross-check the amount and currency against what you stored — so a tampered amount can't unlock the reward.</li>
      </ul>
      <p class="contract__cap">confirming a signed payment — runs on the server, with the secret key</p>
      <pre class="code">expected = hmac_sha256(order_id + "|" + payment_id, <b>secret_key</b>)
if (expected !== signature_from_browser) reject()   <span>// forged or tampered</span>
markPaidOnce(order_id)                               <span>// verified → release the reward</span></pre>
      <div class="callout callout--rule">
        <span class="callout__k">The one rule that matters</span>
        <p>The secret key and the webhook secret <strong>never</strong> appear in HTML, JavaScript, or any file the public can fetch — only the publishable token ships to the browser. If a secret ever lands in front-end code or a screenshot, treat it as burned and rotate it immediately.</p>
      </div>
      <div class="chapter-nav"><a href="#pay-flow">← The flow</a><a href="#pay-webhooks">Next: webhooks →</a></div>
    </section>

    <!-- 17 -->
    <section class="chapter" id="pay-webhooks">
      <span class="chapter__num">Chapter 17 · Payments — webhooks</span>
      <h2>Webhooks — the backstop when the tab closes</h2>
      <p class="q-lead">The visitor pays, then closes the tab before the "it worked" call reaches your server. Did you just lose the payment?</p>
      <p>No — because the browser was never the only path. A <strong>webhook</strong> is the provider calling <em>your server directly</em>, server-to-server, the moment a payment settles. It doesn't depend on the tab staying open, the network holding, or the page not being refreshed. And it's <strong>signed</strong> with the webhook secret from the last chapter, so your server can tell a real event from a forged one.</p>
      <p>The catch is that confirmation can now arrive <em>twice</em> — the browser's callback and the webhook, or a provider retrying. So the write that marks a tip paid must be <strong>idempotent</strong>: flip the record from pending → paid exactly once, and quietly ignore any later copy. Releasing the reward twice is precisely the bug this prevents.</p>
      <div class="diagram">
        <div class="diag-flow">
          <div class="diag-row">
            <div class="diag-box diag-box--blue"><b>Browser confirm</b><small>fast feedback · may never arrive</small></div>
            <div class="diag-box diag-box--ink"><b>Signed webhook</b><small>server-to-server · the reliable source of truth</small></div>
          </div>
          <div class="diag-arrow">↓ each verified, then ↓</div>
          <div class="diag-box diag-box--pink"><b>mark paid — once</b><small>idempotent: first writer wins · duplicates ignored</small></div>
          <div class="diag-arrow">↓</div>
          <div class="diag-box"><b>reward released</b><small>the GitHub link, exactly one time</small></div>
        </div>
        <p class="diagram__cap">two independent confirmations, one idempotent write — a closed tab never loses a payment, a retry never double-counts it</p>
      </div>
      <div class="callout callout--why">
        <span class="callout__k">Why two paths</span>
        <p>They do different jobs. The browser callback is instant feedback for the person who just paid; the webhook is the truth that survives closed tabs and flaky networks. Build both, make the write idempotent, and the edge cases stop being edge cases.</p>
      </div>
      <div class="chapter-nav"><a href="#pay-keys">← Credentials</a><a href="#pay-money">Next: many currencies →</a></div>
    </section>

    <!-- 18 -->
    <section class="chapter" id="pay-money">
      <span class="chapter__num">Chapter 18 · Payments — one checkout, many currencies</span>
      <h2>One checkout, many currencies</h2>
      <p class="q-lead">An Indian visitor should pay in ₹ through one provider; everyone else in their own currency through another. How do you do that without four copies of the checkout?</p>
      <p>With the exact boundary pattern from Part I — <strong>a contract plus a registry</strong>. A small <em>pure</em> function turns a visitor's rough region into a currency, a minimum tip, and which processor handles it. Each processor — one for ₹, one for everything else — hides behind a single shared interface: <em>create an order · verify it · capture it</em>. A registry hands back whichever one the currency selected, and the checkout code above never knows which it got. Adding a third processor tomorrow is a new adapter, not a rewrite.</p>
      <div class="diagram">
        <div class="diag-flow">
          <div class="diag-box"><b>visitor's region</b><small>resolved server-side</small></div>
          <div class="diag-arrow">↓ one pure function</div>
          <div class="diag-box diag-box--ink"><b>currency · minimum · processor</b><small>₹ floor · $/€/£ floor · which adapter</small></div>
          <div class="diag-arrow">↓ registry picks the adapter</div>
          <div class="diag-row">
            <div class="diag-box diag-box--blue"><b>₹ → processor A</b><small>same interface</small></div>
            <div class="diag-box diag-box--blue"><b>others → processor B</b><small>same interface</small></div>
          </div>
        </div>
        <p class="diagram__cap">one pure router · interchangeable processors behind one contract · the same shape as Cosmo's packs, tools, and providers</p>
      </div>
      <div class="callout callout--trade">
        <span class="callout__k">You've seen this before</span>
        <p>This is the contract-plus-registry boundary from Chapters 03, 07, and 08 — now applied to money. Learn the shape once and it keeps paying off: swap an implementation, never edit a neighbour. A safe checkout isn't a special skill; it's the same architecture, pointed at payments.</p>
      </div>
      <p>That's the whole system: three ideas — an untrusted browser, server-only secrets, confirmation that arrives twice and writes once — and one pattern you already knew. The "Get Cosmo" button at the top runs exactly this flow.</p>
      <div class="center" style="margin-top:30px">
        <a class="btn btn--primary js-funnel" href="#">Try the checkout →</a>
        <a class="btn btn--ghost" href="#payments">Re-read Part II ↑</a>
      </div>
      <div class="chapter-nav"><a href="#pay-webhooks">← Webhooks</a><a href="#map">Back to the top ↑</a></div>
    </section>

  </div>
</div>

<script>
  // Friendly eyes watching over the page header (decorative).
  window.addEventListener('DOMContentLoaded', function () {
    var box = document.getElementById('arch-eyes');
    if (box && window.CosmoEyes) {
      var ey = new CosmoEyes(box, { scale: 1.5, interactive: true });
      setTimeout(function () { ey.setState('thinking'); }, 1400);
      setTimeout(function () { ey.setState('idle'); }, 4200);
    }
  });
</script>

<section class="band band--tint" id="faq">
  <div class="wrap">
    <span class="eyebrow eyebrow--blue">Questions</span>
    <h2 class="center">How Cosmo works — FAQ</h2>
    <p class="lead center">Common questions about building a local-first, on-device AI voice assistant.</p>
    <?= cosmo_faq_html($faq) ?>
  </div>
</section>

<?php require __DIR__ . '/includes/footer.php'; ?>
