<?php
require_once __DIR__ . '/geo.php';
require_once __DIR__ . '/currency.php';
$cfg  = cosmo_config();
$rzp  = $cfg['razorpay'] ?? ['key_id' => ''];
$pay  = $cfg['payments'] ?? ['enabled_currencies' => ['INR'], 'default_currency' => 'INR', 'foreign_processor' => 'paypal'];
$ppal = $cfg['paypal'] ?? ['client_id' => '', 'env' => 'sandbox'];
$cwCur  = resolve_currency(null, geo_lookup(client_ip())['countryCode'] ?? '', $pay['enabled_currencies'], (string)$pay['default_currency']);
$cwProc = processor_for_currency($cwCur, (string)$pay['foreign_processor']);
$cwMap  = public_currency_map($pay['enabled_currencies']);
// PayPal's SDK must init with a PayPal-supported currency; INR isn't, so fall back to the default.
$ppCur  = $cwCur === 'INR' ? ((string)$pay['default_currency'] !== 'INR' ? (string)$pay['default_currency'] : 'USD') : $cwCur;
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
          <input class="tip-custom" type="number" min="1" step="1" name="custom" placeholder="custom">
        </div>
        <div class="tips__cur">
          <label for="cur-select" class="tips__curlabel">Currency</label>
          <select id="cur-select" aria-label="Currency"></select>
        </div>
        <div id="paypal-buttons" hidden></div>
      </div>
      <label class="consent"><input type="checkbox" name="consent" value="1"> Email me occasional Cosmo updates. No spam, ever.</label>
      <button class="btn btn--primary btn--block" type="submit" id="funnel-submit">Continue to GitHub →</button>
      <p class="modal__msg" id="funnel-msg" role="status" aria-live="polite"></p>
    </form>
  </div>
</div>

<style>
  .tips__cur{display:flex;align-items:center;gap:8px;margin:10px 0 2px}
  .tips__curlabel{font-size:.82rem;color:var(--muted)}
  #cur-select{padding:6px 9px;border:1px solid var(--line);border-radius:8px;font:inherit;background:var(--card);cursor:pointer}
  #paypal-buttons{margin-top:12px}
</style>

<!-- Tracking consent -->
<div class="cookie" id="cookie" hidden>
  <span>Cosmo logs anonymous visit info (page + rough location) to see who stops by.</span>
  <span class="cookie__btns">
    <button class="btn btn--ghost btn--sm" type="button" id="cookie-no">No thanks</button>
    <button class="btn btn--primary btn--sm" type="button" id="cookie-ok">Got it</button>
  </span>
</div>

<script>
  // Public config only. Razorpay key_id + PayPal client_id are publishable; secrets stay in .env.
  window.COSMO = {
    razorpayKeyId: <?= json_encode($rzp['key_id'] ?? '', JSON_UNESCAPED_SLASHES) ?>,
    paypalClientId: <?= json_encode($ppal['client_id'] ?? '', JSON_UNESCAPED_SLASHES) ?>,
    paypalEnv: <?= json_encode($ppal['env'] ?? 'sandbox') ?>,
    currency: <?= json_encode($cwCur) ?>,
    provider: <?= json_encode($cwProc) ?>,
    currencies: <?= json_encode($cwMap, JSON_UNESCAPED_SLASHES) ?>
  };
</script>
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<?php if (!empty($ppal['client_id'])): ?>
<script src="https://www.paypal.com/sdk/js?client-id=<?= rawurlencode($ppal['client_id']) ?>&currency=<?= rawurlencode($ppCur) ?>&components=buttons&intent=capture"></script>
<?php endif; ?>
<script src="assets/js/eyes.js<?= asset_v('assets/js/eyes.js') ?>"></script>
<script src="assets/js/site.js<?= asset_v('assets/js/site.js') ?>"></script>
<script src="assets/js/funnel.js<?= asset_v('assets/js/funnel.js') ?>"></script>
<?php foreach (($page_scripts ?? []) as $s): ?>
<script src="<?= e($s) ?><?= asset_v($s) ?>"></script>
<?php endforeach; ?>
</body>
</html>
