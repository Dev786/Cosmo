<?php
require_once __DIR__ . '/../includes/admin_auth.php';
if (admin_logged_in()) { header('Location: index.php'); exit; }

$err = '';
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    $cfg  = cosmo_config();
    $hash = $cfg['admin_password_hash'] ?? '';
    $pw   = (string)($_POST['password'] ?? '');

    // Tiny throttle: slow down repeated attempts in this session.
    $_SESSION['admin_attempts'] = ($_SESSION['admin_attempts'] ?? 0) + 1;
    if ($_SESSION['admin_attempts'] > 3) usleep(700000);

    if ($hash === '' || stripos($hash, 'REPLACE') !== false) {
        $err = 'Admin password not set. Add ADMIN_PASSWORD_HASH to .env.';
    } elseif ($pw !== '' && password_verify($pw, $hash)) {
        session_regenerate_id(true);
        $_SESSION['cosmo_admin'] = true;
        $_SESSION['admin_attempts'] = 0;
        header('Location: index.php');
        exit;
    } else {
        $err = 'Wrong password.';
    }
}
?><!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cosmo admin</title>
<link rel="stylesheet" href="../assets/css/style.css">
<style>body{display:grid;place-items:center;min-height:100vh}.login{width:min(360px,92vw);text-align:center}</style>
</head><body>
<form class="login card" method="post">
  <span class="brand-eyes" aria-hidden="true" style="justify-content:center;margin-bottom:10px"><i></i><i></i></span>
  <h2>Cosmo admin</h2>
  <?php if ($err): ?><p class="modal__msg err" style="display:block"><?= e($err) ?></p><?php endif; ?>
  <input class="field" type="password" name="password" placeholder="Admin password" autofocus required>
  <button class="btn btn--primary btn--block" type="submit">Sign in</button>
</form>
</body></html>
