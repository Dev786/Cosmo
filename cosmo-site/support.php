<?php
$page = 'support';
$title = 'Buy me a coffee — Cosmo';
$desc = 'Cosmo is free and open source. If he makes your day a little better, buy me a coffee — it keeps the eyes blinking and the features coming.';
require __DIR__ . '/includes/header.php';
$rzp = (cosmo_config()['razorpay'] ?? ['preset_amounts' => [99, 199, 499]]);
?>

<section class="hero wrap" style="padding-bottom:10px">
  <div class="hero__eyes" id="support-eyes" aria-hidden="true"></div>
  <h1>Buy me a coffee ☕</h1>
  <p class="lead center">Cosmo is free and open source. There's no paywall, no subscription — just one developer and a very expressive little buddy. If he's earned a smile, a coffee goes a long way.</p>
</section>

<section class="wrap center">
  <div class="card" style="max-width:560px;margin:0 auto">
    <h2 style="font-size:1.3rem">Pick a cup</h2>
    <p>Secure payment via Razorpay. Pop in your email and you'll also get the GitHub link.</p>
    <div class="tip-grid" id="support-tips">
      <?php foreach ($rzp['preset_amounts'] as $amt): ?>
        <button class="tip" type="button" data-amt="<?= (int)$amt ?>">₹<?= (int)$amt ?></button>
      <?php endforeach; ?>
      <button class="tip" type="button" data-amt="0">Custom</button>
    </div>
    <p style="color:var(--muted);font-size:.9rem;margin:0">100% optional. Cosmo works exactly the same either way. 💛</p>
  </div>
</section>

<section class="band">
  <div class="wrap center">
    <h2>Where it goes</h2>
    <div class="grid grid--3" style="margin-top:24px;text-align:left">
      <div class="card"><div class="card__ico">🧪</div><h3>More features</h3><p>New tools, new characters, and smarter voice — built faster when there's coffee in the tank.</p></div>
      <div class="card"><div class="card__ico">🖥️</div><h3>Cross-platform</h3><p>Bringing Cosmo beyond macOS takes time and test machines.</p></div>
      <div class="card"><div class="card__ico">💛</div><h3>Keeping it free</h3><p>Your support is what lets Cosmo stay free and open for everyone.</p></div>
    </div>
    <div class="hero__cta" style="margin-top:32px">
      <a class="btn btn--primary js-funnel" href="#">Get Cosmo on GitHub</a>
    </div>
  </div>
</section>

<script>
  // Friendly eyes on the support hero (purely decorative).
  window.addEventListener('DOMContentLoaded', function () {
    var box = document.getElementById('support-eyes');
    if (box && window.CosmoEyes) { var ey = new CosmoEyes(box, { scale: 1.8 }); setTimeout(function(){ ey.setState('happy'); ey.pulse('heart'); }, 400); }
  });
</script>

<?php require __DIR__ . '/includes/footer.php'; ?>
