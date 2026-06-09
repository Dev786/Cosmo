<?php
/** Shared bootstrap for /api endpoints: JSON in/out helpers + method guard. */
require_once __DIR__ . '/db.php';
header('Content-Type: application/json; charset=utf-8');

function json_input(): array
{
    $d = json_decode((string)file_get_contents('php://input'), true);
    return is_array($d) ? $d : [];
}

function json_out($data, int $code = 200): void
{
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_SLASHES);
    exit;
}

function require_post(): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') json_out(['error' => 'POST only'], 405);
}

/** Config or a clean 500 — endpoints need a configured box. */
function api_config(): array
{
    $cfg = cosmo_config();
    if ($cfg === null) json_out(['error' => 'Site not configured yet.'], 503);
    return $cfg;
}
