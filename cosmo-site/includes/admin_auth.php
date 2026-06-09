<?php
/** Admin session bootstrap. Include at the top of every /admin page. */
require_once __DIR__ . '/db.php';

if (session_status() === PHP_SESSION_NONE) {
    session_set_cookie_params([
        'httponly' => true,
        'samesite' => 'Lax',
        'secure'   => !empty($_SERVER['HTTPS']),
    ]);
    session_start();
}

function admin_logged_in(): bool
{
    return !empty($_SESSION['cosmo_admin']);
}

function require_admin(): void
{
    if (!admin_logged_in()) { header('Location: login.php'); exit; }
}
