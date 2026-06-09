<?php
$cfg = cosmo_config();
$rzp = $cfg['razorpay'] ?? ['key_id' => '', 'currency' => 'INR', 'preset_amounts' => [99, 199, 499]];
$year = date('Y');
?>
</main>

<footer class="foot">
  <div class="foot__brand">
    <span class="brand-eyes brand-eyes--sm" aria-hidden="true"><i></i><i></i></span>
    <span>Cosmo</span>
  </div>
  <p class="foot__tag">A tiny desktop buddy with big eyes and a local-first heart.</p>
  <nav class="foot__links">
    <a href="features.php">Features</a>
    <a href="architecture.php">Architecture</a>
    <a href="demos.php">Demos</a>
    <a href="support.php">Support</a>
    <a href="#" class="js-funnel">Get Cosmo</a>
  </nav>
  <p class="foot__fine">© <?= $year ?> Cosmo · Built with curiosity, runs on your machine.</p>
</footer>

<!-- GitHub funnel: email gate (+ optional coffee) before the repo URL -->
<div class="modal" id="funnel" hidden role="dialog" aria-modal="true" aria-labelledby="funnel-title">
  <div class="modal__backdrop" data-close></div>
  <div class="modal__card">
    <button class="modal__x" type="button" data-close aria-label="Close">&times;</button>
    <div class="modal__eyes" id="funnel-eyes" aria-hidden="true"></div>
    <h2 id="funnel-title">Get Cosmo</h2>
    <p class="modal__sub">Drop your email and we'll take you to the repo. Cosmo is free — a coffee just keeps his eyes blinking. ☕</p>
    <form id="funnel-form" novalidate>
      <input class="field" type="email" name="email" inputmode="email" autocomplete="email" placeholder="you@email.com" required>
      <div class="tips">
        <span class="tips__label">Buy me a coffee <em>(optional)</em></span>
        <div class="tips__row" id="tip-row">
          <?php foreach ($rzp['preset_amounts'] as $amt): ?>
            <button type="button" class="tip" data-amt="<?= (int)$amt ?>">₹<?= (int)$amt ?></button>
          <?php endforeach; ?>
          <input class="tip-custom" type="number" min="1" step="1" name="custom" placeholder="₹ custom">
        </div>
      </div>
      <label class="consent"><input type="checkbox" name="consent" value="1"> Email me occasional Cosmo updates. No spam, ever.</label>
      <button class="btn btn--primary btn--block" type="submit" id="funnel-submit">Continue to GitHub →</button>
      <p class="modal__msg" id="funnel-msg" role="status" aria-live="polite"></p>
    </form>
  </div>
</div>

<!-- Tracking consent -->
<div class="cookie" id="cookie" hidden>
  <span>Cosmo logs anonymous visit info (page + rough location) to see who stops by.</span>
  <span class="cookie__btns">
    <button class="btn btn--ghost btn--sm" type="button" id="cookie-no">No thanks</button>
    <button class="btn btn--primary btn--sm" type="button" id="cookie-ok">Got it</button>
  </span>
</div>

<script>
  // Public config only. The Razorpay key_id is publishable; key_secret stays in .env on the server.
  window.COSMO = {
    razorpayKeyId: <?= json_encode($rzp['key_id'], JSON_UNESCAPED_SLASHES) ?>,
    currency: <?= json_encode($rzp['currency']) ?>,
    presets: <?= json_encode(array_values($rzp['preset_amounts'])) ?>
  };
</script>
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<script src="assets/js/eyes.js"></script>
<script src="assets/js/site.js"></script>
<script src="assets/js/funnel.js"></script>
<?php foreach (($page_scripts ?? []) as $s): ?>
<script src="<?= e($s) ?>"></script>
<?php endforeach; ?>
</body>
</html>
