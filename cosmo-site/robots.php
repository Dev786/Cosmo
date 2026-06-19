<?php
/** Served as /robots.txt (see .htaccess). Generated so the Sitemap line carries the
 *  configured SITE_URL. AI answer-engine crawlers are explicitly welcomed — Cosmo is
 *  an educational, open-source project and we want it cited in AI answers about
 *  local/on-device voice assistants, STT and TTS. */
require_once __DIR__ . '/includes/db.php';
require_once __DIR__ . '/includes/seo.php';

header('Content-Type: text/plain; charset=utf-8');
$base = cosmo_site_url(cosmo_config());

$lines = [
    '# Cosmo — local-first AI desktop assistant. https://github.com (open source).',
    '',
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin/',
    'Disallow: /api/',
    'Disallow: /setup.php',
    '',
    '# AI answer engines welcome (educational, open-source project).',
];
foreach (['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-Web', 'anthropic-ai', 'PerplexityBot', 'Google-Extended', 'Applebot-Extended', 'CCBot'] as $bot) {
    $lines[] = "User-agent: $bot";
    $lines[] = 'Allow: /';
}
$lines[] = '';
$lines[] = 'Sitemap: ' . ($base !== '' ? $base : '') . '/sitemap.xml';

echo implode("\n", $lines) . "\n";
