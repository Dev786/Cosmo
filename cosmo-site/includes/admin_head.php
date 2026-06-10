<?php
/** Shared admin chrome. A page calls admin_head($title, $active) → echoes its body →
 *  calls admin_foot(). $active ∈ 'overview' | 'events' picks the lit tab. All admin
 *  styling lives here so the pages stay data + markup only. */

require_once __DIR__ . '/db.php';

function admin_head(string $title, string $active = 'overview'): void
{
    $css = asset_v('assets/css/style.css');
    $tab = function (string $key, string $label, string $href) use ($active): string {
        $on = $key === $active ? ' nav-tab--on' : '';
        return "<a class=\"nav-tab$on\" href=\"" . e($href) . "\">" . e($label) . "</a>";
    };
    ?><!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= e($title) ?></title>
<link rel="stylesheet" href="../assets/css/style.css<?= $css ?>">
<style>
  body{background:var(--paper)}
  .adminbar{display:flex;align-items:center;gap:14px;padding:14px clamp(16px,4vw,40px);background:var(--ink);color:#fff;flex-wrap:wrap}
  .adminbar .grow{margin-left:auto;display:flex;gap:18px}
  .adminbar a{color:#fff;opacity:.82}.adminbar a:hover{opacity:1}
  .admintabs{display:flex;gap:4px;padding:0 clamp(16px,4vw,40px);background:var(--ink)}
  .nav-tab{color:#fff;opacity:.55;padding:11px 16px;border-bottom:2px solid transparent;font-size:.9rem;font-weight:600}
  .nav-tab:hover{opacity:.85}
  .nav-tab--on{opacity:1;border-bottom-color:#4a9eff}
  .adminwrap{width:min(1100px,94vw);margin:24px auto}
  .stat-row{display:grid;grid-template-columns:repeat(5,1fr);gap:14px;margin-bottom:22px}
  .stat{background:var(--card);border:1px solid var(--line);border-radius:var(--r-md);padding:18px;text-align:center;box-shadow:var(--shadow-s)}
  .stat b{display:block;font-family:var(--serif);font-size:1.6rem;line-height:1.1}
  .stat span{color:var(--muted);font-size:.84rem}
  .grid2{display:grid;grid-template-columns:1.7fr 1fr;gap:18px;margin-bottom:22px}
  .panel{background:var(--card);border:1px solid var(--line);border-radius:var(--r-md);padding:18px;box-shadow:var(--shadow-s)}
  .panel h3{font-family:var(--serif);margin:0 0 12px;font-size:1.04rem}
  .panel--chart{display:flex;flex-direction:column}
  table{width:100%;border-collapse:collapse;background:var(--card);border-radius:var(--r-md);overflow:hidden;box-shadow:var(--shadow-s);margin-bottom:22px}
  th,td{text-align:left;padding:9px 12px;font-size:.86rem;border-bottom:1px solid var(--line);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:280px}
  th{background:var(--paper-2);font-family:var(--serif)}
  .badge{display:inline-block;font-size:.7rem;padding:2px 9px;border-radius:999px;text-transform:capitalize;font-weight:600}
  .badge--visit{background:rgba(74,158,255,.14);color:var(--blue-deep)}
  .badge--lead{background:rgba(155,107,255,.16);color:#6b3fd4}
  .badge--tip{background:rgba(34,197,123,.18);color:#1b8a5a}
  .legend{list-style:none;margin:14px 0 0;padding:0;font-size:.86rem}
  .legend li{display:flex;align-items:center;gap:9px;padding:4px 0;color:var(--ink)}
  .legend .key{width:11px;height:11px;border-radius:3px;flex:none}
  .filters{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;align-items:center}
  .chip{padding:6px 14px;border:1px solid var(--line);border-radius:999px;font-size:.86rem;color:var(--muted);background:var(--card)}
  .chip--on{background:var(--ink);color:#fff;border-color:var(--ink)}
  .chip--count{border-style:dashed}
  .pager{display:flex;align-items:center;gap:16px;justify-content:center;margin:6px 0 32px}
  .pager a{font-size:.9rem;font-weight:600;color:var(--blue-deep)}
  .pager .muted{font-size:.9rem;color:var(--muted)}
  .seeall{font-size:.82rem;font-weight:400}
  @media(max-width:860px){.stat-row{grid-template-columns:repeat(2,1fr)}.grid2{grid-template-columns:1fr}}
</style>
</head><body>
<div class="adminbar">
  <span class="brand-eyes brand-eyes--sm" aria-hidden="true"><i></i><i></i></span>
  <strong>Cosmo admin</strong>
  <span class="grow"><a href="../index.php">View site</a><a href="logout.php">Log out</a></span>
</div>
<nav class="admintabs">
  <?= $tab('overview', 'Overview', 'index.php') ?>
  <?= $tab('events', 'All events', 'events.php') ?>
</nav>
<div class="adminwrap">
<?php
}

function admin_foot(): void
{
    ?>
</div>
</body></html>
<?php
}
