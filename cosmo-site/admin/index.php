<?php
require_once __DIR__ . '/../includes/admin_auth.php';
require_admin();
require_once __DIR__ . '/../includes/admin_stats.php';
require_once __DIR__ . '/../includes/chart_svg.php';
require_once __DIR__ . '/../includes/admin_head.php';

$dbError = '';
$ov = ['visits' => 0, 'visits7' => 0, 'leads' => 0, 'tips' => 0];
$visitsDaily = $tipsDaily = $countries = $curTotals = $recent = [];
try {
    $db = db();
    $ov          = stats_overview($db);
    $visitsDaily = visits_by_day($db, 30);
    $tipsDaily   = tips_by_day($db, 30);
    $countries   = country_breakdown($db, 8);
    $curTotals   = currency_totals($db);
    $recent      = events_feed($db, 'all', 8, 0);
} catch (Throwable $ex) {
    $dbError = 'Database not reachable. Check .env DB settings and that sql/schema.sql was imported.';
}

// Currency-aware tips total, e.g. "₹4,900 · $30.00" (never sum across currencies).
$tipSummary = $curTotals
    ? implode('  ·  ', array_map(fn($r) => money_fmt((int)$r['total'], (string)$r['currency']), $curTotals))
    : '—';

admin_head('Cosmo admin · overview', 'overview');
?>
<?php if ($dbError): ?><p class="modal__msg err" style="display:block"><?= e($dbError) ?></p><?php endif; ?>

<div class="stat-row">
  <div class="stat"><b><?= number_format($ov['visits']) ?></b><span>Total visits</span></div>
  <div class="stat"><b><?= number_format($ov['visits7']) ?></b><span>Last 7 days</span></div>
  <div class="stat"><b><?= number_format($ov['leads']) ?></b><span>Emails captured</span></div>
  <div class="stat"><b><?= number_format($ov['tips']) ?></b><span>Coffees ☕</span></div>
  <div class="stat"><b style="font-size:1.15rem"><?= e($tipSummary) ?></b><span>Tips total</span></div>
</div>

<div class="grid2">
  <div class="panel panel--chart">
    <h3>Visits · last 30 days</h3>
    <?= svg_line($visitsDaily, ['color' => '#4a9eff']) ?>
  </div>
  <div class="panel panel--chart">
    <h3>Tips by currency</h3>
    <?= svg_donut(array_map(fn($r) => ['label' => $r['currency'], 'value' => (int)$r['cnt']], $curTotals), ['center' => 'tips']) ?>
    <ul class="legend">
      <?php foreach ($curTotals as $i => $r): $c = COSMO_CHART_PALETTE[$i % count(COSMO_CHART_PALETTE)]; ?>
        <li><span class="key" style="background:<?= e($c) ?>"></span>
          <strong><?= e((string)$r['currency']) ?></strong>&nbsp;—&nbsp;<?= number_format((int)$r['cnt']) ?> tip<?= (int)$r['cnt'] === 1 ? '' : 's' ?>
          &nbsp;·&nbsp;<?= e(money_fmt((int)$r['total'], (string)$r['currency'])) ?></li>
      <?php endforeach; ?>
      <?php if (!$curTotals): ?><li class="muted">No tips yet.</li><?php endif; ?>
    </ul>
  </div>
</div>

<div class="grid2">
  <div class="panel panel--chart">
    <h3>Tips · last 30 days</h3>
    <?= svg_line($tipsDaily, ['color' => '#22c57b']) ?>
  </div>
  <div class="panel panel--chart">
    <h3>Where visitors come from</h3>
    <?= svg_bar_h($countries, ['color' => '#4a9eff']) ?>
  </div>
</div>

<div class="panel" style="margin-bottom:24px">
  <h3 style="display:flex;justify-content:space-between;align-items:baseline">
    Recent activity <a class="seeall" href="events.php">See all events →</a>
  </h3>
  <table style="box-shadow:none;margin:0">
    <tr><th>When</th><th>Type</th><th>Who / what</th><th>Detail</th></tr>
    <?php foreach ($recent as $r): ?>
      <tr>
        <td><?= e((string)$r['ts']) ?></td>
        <td><span class="badge badge--<?= e((string)$r['kind']) ?>"><?= e($r['kind'] === 'lead' ? 'email' : (string)$r['kind']) ?></span></td>
        <td><?= e(event_who($r)) ?></td>
        <td><?= e(event_detail($r)) ?></td>
      </tr>
    <?php endforeach; ?>
    <?php if (!$recent && !$dbError): ?><tr><td colspan="4">No activity yet.</td></tr><?php endif; ?>
  </table>
</div>
<?php admin_foot(); ?>
