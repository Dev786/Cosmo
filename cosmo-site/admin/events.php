<?php
require_once __DIR__ . '/../includes/admin_auth.php';
require_admin();
require_once __DIR__ . '/../includes/admin_stats.php';
require_once __DIR__ . '/../includes/admin_head.php';

$types = ['all' => 'All', 'visit' => 'Visits', 'lead' => 'Emails', 'tip' => 'Tips'];
$type = (string)($_GET['type'] ?? 'all');
if (!isset($types[$type])) $type = 'all';

$perPage = 50;
$page = max(1, (int)($_GET['page'] ?? 1));
$offset = ($page - 1) * $perPage;

$dbError = '';
$rows = [];
$total = 0;
try {
    $db = db();
    $total = events_count($db, $type);
    $rows  = events_feed($db, $type, $perPage, $offset);
} catch (Throwable $ex) {
    $dbError = 'Database not reachable. Check .env DB settings.';
}
$pages = max(1, (int)ceil($total / $perPage));
$qs = fn(string $t, int $p): string => 'events.php?type=' . urlencode($t) . '&page=' . $p;

admin_head('Cosmo admin · events', 'events');
?>
<?php if ($dbError): ?><p class="modal__msg err" style="display:block"><?= e($dbError) ?></p><?php endif; ?>

<div class="filters">
  <?php foreach ($types as $k => $label): ?>
    <a class="chip<?= $k === $type ? ' chip--on' : '' ?>" href="<?= e($qs($k, 1)) ?>"><?= e($label) ?></a>
  <?php endforeach; ?>
  <span class="chip chip--count"><?= number_format($total) ?> event<?= $total === 1 ? '' : 's' ?></span>
</div>

<table>
  <tr><th>When</th><th>Type</th><th>Who / what</th><th>Detail</th></tr>
  <?php foreach ($rows as $r): ?>
    <tr>
      <td><?= e((string)$r['ts']) ?></td>
      <td><span class="badge badge--<?= e((string)$r['kind']) ?>"><?= e($r['kind'] === 'lead' ? 'email' : (string)$r['kind']) ?></span></td>
      <td><?= e(event_who($r)) ?></td>
      <td><?= e(event_detail($r)) ?></td>
    </tr>
  <?php endforeach; ?>
  <?php if (!$rows && !$dbError): ?><tr><td colspan="4">No events<?= $type !== 'all' ? ' of this type' : '' ?> yet.</td></tr><?php endif; ?>
</table>

<div class="pager">
  <?php if ($page > 1): ?><a href="<?= e($qs($type, $page - 1)) ?>">← Newer</a>
  <?php else: ?><span class="muted">← Newer</span><?php endif; ?>
  <span class="muted">Page <?= $page ?> of <?= $pages ?></span>
  <?php if ($page < $pages): ?><a href="<?= e($qs($type, $page + 1)) ?>">Older →</a>
  <?php else: ?><span class="muted">Older →</span><?php endif; ?>
</div>
<?php admin_foot(); ?>
