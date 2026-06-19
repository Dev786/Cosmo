<?php
$page = 'demos';
$title = 'Cosmo demo — try a local AI desktop assistant in your browser';
$desc = 'Try Cosmo right in your browser: drag the floating character around, talk or type, watch him search and use tools, and hear his real on-device voice. A live demo of a local-first, private AI desktop assistant.';
$page_scripts = ['assets/js/demo.js'];
require_once __DIR__ . '/includes/seo.php';
$cfg = cosmo_config();
$jsonld = [cosmo_breadcrumbs($cfg, [['Home', '/'], ['Demos', '/demos']])];
require __DIR__ . '/includes/header.php';
?>

<section class="hero wrap" style="padding-bottom:6px">
  <h1>See Cosmo come alive</h1>
  <p class="lead center">Not a video — the <em>real</em> widget, floating on a Mac just like he does on yours. <strong>Drag him anywhere</strong>, <strong>hover</strong> to slide out his control rail, then talk, type, or open his panel. His voice is his real on-device voice.</p>
</section>

<section class="wrap">
  <!-- ===== A MacBook; Cosmo lives on its screen (drag him around) ===== -->
  <div class="mb" id="mb">
    <div class="mb-screen" id="mb-screen">
      <div class="mb-wall"></div>
      <div class="mb-menubar">
        <span class="mb-mb-left"><span class="mb-mb-logo"></span> Cosmo <span class="mb-mb-dim">File&nbsp; Edit&nbsp; View</span></span>
        <span class="mb-mb-right">
          <!-- Cosmo's menu-bar (tray) icon — exactly the menu the app shows when he's tucked away -->
          <button class="mb-tray" id="mb-tray" type="button" title="Cosmo" aria-haspopup="true" aria-expanded="false"><span class="mb-tray-eyes"></span></button>
          <span class="mb-mb-dim"><span class="mb-batt"></span> 100%</span>
          <span class="mb-mb-dim">9:41</span>
        </span>
      </div>
      <!-- the tray dropdown (mirrors src/main/index.ts createTray) -->
      <div class="mb-traymenu" id="mb-traymenu" role="menu" hidden>
        <button class="mb-tm-item" data-tray="toggle" type="button" role="menuitem">Hide Cosmo</button>
        <div class="mb-tm-sep"></div>
        <button class="mb-tm-item" data-tray="mic" type="button" role="menuitem">Talk to Cosmo</button>
        <button class="mb-tm-item" data-tray="chat" type="button" role="menuitem">Open chat</button>
        <button class="mb-tm-item" data-tray="panel" type="button" role="menuitem">Tasks &amp; reminders…</button>
        <button class="mb-tm-item" data-tray="mute" type="button" role="menuitem">Mute (silence &amp; stop listening)</button>
        <div class="mb-tm-sep"></div>
        <button class="mb-tm-item" data-tray="setup" type="button" role="menuitem">AI setup (vendor, model, key)…</button>
        <button class="mb-tm-item" data-tray="clear" type="button" role="menuitem">Clear conversation</button>
        <div class="mb-tm-sep"></div>
        <button class="mb-tm-item" data-tray="quit" type="button" role="menuitem">Quit Cosmo</button>
      </div>

      <!-- ===== Faithful Cosmo widget (mirrors src/renderer/index.html) ===== -->
      <div class="cw" id="cw">
        <!-- face column (150) -->
        <div class="cw-col" id="cw-col">
          <div class="cw-gear" id="cw-gear" title="AI setup — vendor, model & key">⚙</div>
          <div class="cw-close" id="cw-close" title="Hide Cosmo">✕</div>
          <div class="cw-avatar"><div class="cw-eyes" id="demo-eyes" aria-label="Live Cosmo eyes"></div></div>
          <div class="cw-status" id="demo-status" hidden aria-live="polite"></div>
          <div class="cw-handle"></div>
        </div>

        <!-- control rail (48) — hidden at rest, slides open on hover (real behavior) -->
        <div class="cw-rail" id="cw-rail">
          <button class="cw-dot cw-mic" id="cw-mic" type="button" title="Click to talk" aria-label="Talk to Cosmo"></button>
          <button class="cw-dot cw-mute" id="cw-mute" type="button" title="Mute — silence his voice" aria-label="Mute">🔊</button>
          <button class="cw-dot cw-chat" id="cw-chat" type="button" title="Toggle chat" aria-label="Chat">💬</button>
          <button class="cw-dot cw-panel" id="cw-panel" type="button" title="Tasks & reminders" aria-label="Tasks and reminders">📋</button>
        </div>

        <!-- chat column (220) — opens to the right, the text channel -->
        <div class="cw-chatcol" id="cw-chatcol">
          <button class="cw-chat-close" id="cw-chat-close" type="button" title="Close chat">✕</button>
          <div class="cw-msgs" id="cw-msgs"></div>
          <form class="cw-inputrow" id="cw-inputrow" autocomplete="off">
            <input class="cw-input" id="demo-input" type="text" maxlength="120" placeholder="Ask Cosmo…" aria-label="Type to Cosmo" />
            <button class="cw-send" id="demo-send" type="submit" aria-label="Send">➤</button>
          </form>
        </div>

        <!-- tasks / reminders / notes / sources panel (full-widget overlay) -->
        <div class="cw-overlay" id="cw-panel-overlay">
          <button class="cw-ov-close" id="cw-panel-close" type="button" title="Close">✕</button>
          <div class="cw-ov-title">Cosmo</div>
          <div class="cw-tabs">
            <button class="cw-tab is-on" data-ptab="tasks" type="button">✅ Tasks</button>
            <button class="cw-tab" data-ptab="reminders" type="button">⏰ Reminders</button>
            <button class="cw-tab" data-ptab="notes" type="button">📝 Notes</button>
            <button class="cw-tab" data-ptab="sources" type="button">📰 Sources</button>
          </div>
          <div class="cw-pane is-on" data-ppane="tasks">
            <div class="cw-list">
              <div class="cw-item done"><span class="cw-check">✓</span><span class="cw-itext">Ship the demo page</span></div>
              <div class="cw-item"><span class="cw-check"></span><span class="cw-itext">Reply to Priya</span></div>
              <div class="cw-item"><span class="cw-check"></span><span class="cw-itext">Read the LLM survey paper</span></div>
            </div>
          </div>
          <div class="cw-pane" data-ppane="reminders">
            <div class="cw-list">
              <div class="cw-item"><span class="cw-dotmark">⏰</span><span class="cw-itext">Stand up &amp; stretch<span class="cw-when">in 25 min</span></span></div>
              <div class="cw-item"><span class="cw-dotmark">⏰</span><span class="cw-itext">Call mom<span class="cw-when">today, 6:00 PM</span></span></div>
            </div>
          </div>
          <div class="cw-pane" data-ppane="notes">
            <div class="cw-list">
              <div class="cw-item"><span class="cw-itext">Cosmo's voice = Kokoro, on-device</span></div>
              <div class="cw-item"><span class="cw-itext">Idea: a tiny desktop buddy ✨</span></div>
            </div>
          </div>
          <div class="cw-pane" data-ppane="sources">
            <div class="cw-list" id="cw-sources">
              <div class="cw-empty" id="cw-sources-empty">Ask Cosmo to look something up — his sources land here.</div>
            </div>
          </div>
        </div>

        <!-- setup overlay (gear) — faithful tabs, read-only preview -->
        <div class="cw-overlay" id="cw-setup-overlay">
          <button class="cw-ov-close" id="cw-setup-close" type="button" title="Close">✕</button>
          <div class="cw-ov-title">Set up Cosmo</div>
          <div class="cw-ov-sub">Brain, voice &amp; ears — pick what you like.</div>
          <div class="cw-tabs">
            <button class="cw-tab is-on" data-stab="brain" type="button">🧠 Brain</button>
            <button class="cw-tab" data-stab="voice" type="button">🔊 Voice</button>
            <button class="cw-tab" data-stab="ears" type="button">👂 Ears</button>
          </div>
          <div class="cw-pane is-on" data-spane="brain">
            <label class="cw-flabel">Vendor</label>
            <div class="cw-fakefield">OpenAI · Anthropic · Gemini · Groq · xAI · DeepSeek · Cerebras · Ollama</div>
            <label class="cw-flabel">Model</label>
            <div class="cw-fakefield">your pick — local or cloud</div>
          </div>
          <div class="cw-pane" data-spane="voice">
            <label class="cw-flabel">Voice</label>
            <div class="cw-fakefield">Kokoro (on-device) · ElevenLabs · OpenAI · Groq · Deepgram · Cartesia…</div>
            <p class="cw-fhint">On-device Kokoro by default — no key, no cloud.</p>
          </div>
          <div class="cw-pane" data-spane="ears">
            <label class="cw-flabel">Ears</label>
            <div class="cw-fakefield">Whisper / Moonshine (on-device) · or a cloud STT</div>
            <p class="cw-fhint">Your voice never leaves your Mac on the local setting.</p>
          </div>
        </div>
      </div>

      <span class="mb-hint" id="demo-hint">drag Cosmo · hover for controls</span>
    </div>
    <div class="mb-deck"><span class="mb-notch"></span></div>
  </div>

  <!-- ===== Director's controls (demo affordances, not part of the widget) ===== -->
  <div class="demo-director">
    <div class="demo-voicebar" id="demo-voicebar" hidden>
      <label for="demo-voice">Cosmo's voice</label>
      <select id="demo-voice" aria-label="Cosmo's voice"></select>
      <button class="btn btn--ghost btn--sm" id="demo-hear" type="button">▶ Hear him</button>
      <span class="demo-voicebar__note">real on-device Kokoro voices</span>
    </div>

    <div class="demo-chips" aria-label="Try one — talks to him just like the chat box">
      <button class="demo-chip" type="button" data-ask="find me papers on large language models">🔎 find papers on LLMs</button>
      <button class="demo-chip" type="button" data-ask="set a timer for 10 minutes">⏱ set a timer</button>
      <button class="demo-chip" type="button" data-ask="start a 25 minute pomodoro focus session">🍅 start a Pomodoro</button>
      <button class="demo-chip" type="button" data-ask="remember to call mom">📝 take a note</button>
      <button class="demo-chip" type="button" data-ask="what are you?">🧒 what are you?</button>
      <button class="demo-chip demo-chip--scene" type="button" id="demo-play">▶ play the ask → search scene</button>
    </div>

    <details class="demo-moods">
      <summary>Every mood &amp; reaction</summary>
      <div class="demo-controls" aria-label="Moods">
        <button class="btn btn--ghost" data-mood="idle">Idle</button>
        <button class="btn btn--ghost" data-mood="listening">Listening</button>
        <button class="btn btn--ghost" data-mood="thinking">Thinking</button>
        <button class="btn btn--ghost" data-mood="speaking">Speaking</button>
        <button class="btn btn--ghost" data-mood="happy">Happy</button>
        <button class="btn btn--ghost" data-mood="bored">Bored</button>
        <button class="btn btn--ghost" data-mood="annoyed">Annoyed</button>
        <button class="btn btn--ghost" data-mood="sleeping">Sleeping</button>
      </div>
      <div class="demo-controls" aria-label="Reactions">
        <button class="btn btn--ghost" data-pulse="blink">Blink</button>
        <button class="btn btn--ghost" data-pulse="lookAround">Look around</button>
        <button class="btn btn--ghost" data-pulse="heart">Heart</button>
        <button class="btn btn--ghost" data-pulse="startle">Startle</button>
      </div>
    </details>
  </div>

  <p class="demo-honest" id="demo-honest">
    Real eyes, real voice, real layout — drag, hover, rail, chat, panel and all. In the browser Cosmo plays a few <strong>canned lines in his actual on-device voice</strong>; on your Mac he hears you for real and answers live with any model you pick. Prefer it quiet? <strong>Mute his voice (🔊 in the rail) and just chat by typing</strong> — every feature works exactly the same, silent or out loud.
  </p>

  <div class="center" style="margin-top:30px">
    <a class="btn btn--primary js-funnel" href="#">Get Cosmo →</a>
  </div>
</section>

<?php require __DIR__ . '/includes/footer.php'; ?>
