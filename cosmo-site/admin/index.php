<?php
require_once __DIR__ . '/../includes/admin_auth.php';
require_admin();

$dbError = '';
$stats = ['visits' => 0, 'visits7' => 0, 'leads' => 0, 'tips' => 0, 'tipTotal' => 0];
$countries = $recentVisits = $recentLeads = $recentTips = [];
try {
    $pdo = db();
    $one = fn(string $sql) => (int)$pdo->query($sql)->fetchColumn();
    $stats['visits']   = $one('SELECT COUNT(*) FROM visits');
    $stats['visits7']  = $one('SELECT COUNT(*) FROM visits WHERE created_at >= (NOW() - INTERVAL 7 DAY)');
    $stats['leads']    = $one('SELECT COUNT(*) FROM leads');
    $stats['tips']     = $one("SELECT COUNT(*) FROM donations WHERE status='paid'");
    $stats['tipTotal'] = $one("SELECT COALESCE(SUM(amount_paise),0) FROM donations WHERE status='paid'");
    $countries    = $pdo->query("SELECT country, COUNT(*) c FROM visits WHERE country<>'' GROUP BY country ORDER BY c DESC LIMIT 8")->fetchAll();
    $recentVisits = $pdo->query('SELECT created_at, country, city, path, referrer, ip FROM visits ORDER BY id DESC LIMIT 40')->fetchAll();
    $recentLeads  = $pdo->query('SELECT email, created_at, country, consent FROM leads ORDER BY id DESC LIMIT 25')->fetchAll();
    $recentTips   = $pdo->query('SELECT created_at, email, amount_paise, currency, status FROM donations ORDER BY id DESC LIMIT 15')->fetchAll();
} catch (Throwable $ex) {
    $dbError = 'Database not reachable. Check .env DB settings and that sql/schema.sql was imported.';
}
$rupees = fn(int $paise) => '₹' . number_format($paise / 100, 0);
?><!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cosmo admin · dashboard</title>
<link rel="stylesheet" href="../assets/css/style.css">
<style>
  body{background:var(--paper)}
  .adminbar{display:flex;align-items:center;gap:14px;padding:14px clamp(16px,4vw,40px);background:var(--ink);color:#fff}
  .adminbar a{color:#fff;margin-left:auto}
  .adminwrap{width:min(1100px,94vw);margin:24px auto}
  .stat-row{display:grid;grid-template-columns:repeat(5,1fr);gap:14px;margin-bottom:24px}
  .stat{background:var(--card);border:1px solid var(--line);border-radius:var(--r-md);padding:18px;text-align:center;box-shadow:var(--shadow-s)}
  .stat b{display:block;font-family:var(--serif);font-size:1.7rem}
  .stat span{color:var(--muted);font-size:.85rem}
  table{width:100%;border-collapse:collapse;background:var(--card);border-radius:var(--r-md);overflow:hidden;box-shadow:var(--shadow-s);margin-bottom:28px}
  th,td{text-align:left;padding:9px 12px;font-size:.86rem;border-bottom:1px solid var(--line);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:260px}
  th{background:var(--paper-2);font-family:var(--serif)}
  h3{font-family:var(--serif);margin:6px 0 10px}
  .pill{font-size:.72rem;padding:1px 8px;border-radius:999px;background:rgba(74,158,255,.14);color:var(--blue-deep)}
  .pill.paid{background:rgba(34,197,123,.18);color:#1b8a5a}
  @media(max-width:760px){.stat-row{grid-template-columns:repeat(2,1fr)}}
</style>
</head><body>
<div class="adminbar">
  <span class="brand-eyes brand-eyes--sm" aria-hidden="true"><i></i><i></i></span>
  <strong>Cosmo admin</strong>
  <a href="../index.php">View site</a> <a href="logout.php">Log out</a>
</div>
<div class="adminwrap">
  <?php if ($dbError): ?><p class="modal__msg err" style="display:block"><?= e($dbError) ?></p><?php endif; ?>

  <div class="stat-row">
    <div class="stat"><b><?= number_format($stats['visits']) ?></b><span>Total visits</span></div>
    <div class="stat"><b><?= number_format($stats['visits7']) ?></b><span>Last 7 days</span></div>
    <div class="stat"><b><?= number_format($stats['leads']) ?></b><span>Emails captured</span></div>
    <div class="stat"><b><?= number_format($stats['tips']) ?></b><span>Coffees ☕</span></div>
    <div class="stat"><b><?= e($rupees($stats['tipTotal'])) ?></b><span>Tips total</span></div>
  </div>

  <?php if ($countries): ?>
  <h3>Where visitors come from</h3>
  <table><tr><th>Country</th><th>Visits</th></tr>
    <?php foreach ($countries as $r): ?><tr><td><?= e($r['country']) ?></td><td><?= number_format((int)$r['c']) ?></td></tr><?php endforeach; ?>
  </table>
  <?php endif; ?>

  <h3>Recent emails</h3>
  <table><tr><th>Email</th><th>When</th><th>Country</th><th>Updates?</th></tr>
    <?php foreach ($recentLeads as $r): ?>
      <tr><td><?= e($r['email']) ?></td><td><?= e($r['created_at']) ?></td><td><?= e($r['country']) ?></td>
      <td><?= ((int)$r['consent']) ? '<span class="pill">yes</span>' : '—' ?></td></tr>
    <?php endforeach; ?>
    <?php if (!$recentLeads): ?><tr><td colspan="4">No emails yet.</td></tr><?php endif; ?>
  </table>

  <h3>Recent tips</h3>
  <table><tr><th>When</th><th>Email</th><th>Amount</th><th>Status</th></tr>
    <?php foreach ($recentTips as $r): ?>
      <tr><td><?= e($r['created_at']) ?></td><td><?= e($r['email']) ?></td><td><?= e($rupees((int)$r['amount_paise'])) ?></td>
      <td><span class="pill <?= $r['status']==='paid'?'paid':'' ?>"><?= e($r['status']) ?></span></td></tr>
    <?php endforeach; ?>
    <?php if (!$recentTips): ?><tr><td colspan="4">No tips yet.</td></tr><?php endif; ?>
  </table>

  <h3>Recent visits</h3>
  <table><tr><th>When</th><th>Location</th><th>Page</th><th>Referrer</th><th>IP</th></tr>
    <?php foreach ($recentVisits as $r): ?>
      <tr><td><?= e($r['created_at']) ?></td>
      <td><?= e(trim(($r['city'] ?? '') . ' ' . ($r['country'] ?? ''))) ?: '—' ?></td>
      <td><?= e($r['path']) ?></td>
      <td><?= e($r['referrer']) ?: '—' ?></td>
      <td><?= e($r['ip']) ?></td></tr>
    <?php endforeach; ?>
    <?php if (!$recentVisits): ?><tr><td colspan="5">No visits logged yet.</td></tr><?php endif; ?>
  </table>
</div>
</body></html>
