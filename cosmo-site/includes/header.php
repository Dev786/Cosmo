<?php
/** Shared page head + nav. Set $page (nav highlight), $title, $desc before include. */
require_once __DIR__ . '/track.php';
require_once __DIR__ . '/seo.php';
$cfg   = cosmo_config();
$page  = $page  ?? '';
$title = $title ?? 'Cosmo — local-first AI desktop assistant with voice';
$desc  = $desc  ?? 'Cosmo is a free, open-source desktop AI companion with on-device speech-to-text, text-to-speech, and a pluggable local or cloud LLM brain. Private by design — your voice and screen stay on your machine.';
$nav = [
    'home'         => ['/', 'Home'],
    'features'     => ['/features', 'Features'],
    'architecture' => ['/architecture', 'Architecture'],
    'demos'        => ['/demos', 'Demos'],
    'setup'        => ['/setup', 'Setup'],
    'support'      => ['/support', 'Support'],
];
?><!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= e($title) ?></title>
<meta name="description" content="<?= e($desc) ?>">
<?php cosmo_seo_head($cfg, $title, $desc, $jsonld ?? []); ?>
<meta name="theme-color" content="#1e1e2e">
<link rel="icon" type="image/svg+xml" href="assets/favicon.svg">
<link rel="apple-touch-icon" href="assets/favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="assets/css/style.css<?= asset_v('assets/css/style.css') ?>">
</head>
<body data-page="<?= e($page) ?>">
<header class="nav">
  <a class="nav__brand" href="/" aria-label="Cosmo home">
    <span class="brand-eyes" aria-hidden="true"><i></i><i></i></span>
    <span class="brand-name">Cosmo</span>
  </a>
  <nav class="nav__links" id="nav-links">
    <?php foreach ($nav as $key => [$href, $label]): ?>
      <a href="<?= $href ?>"<?= $page === $key ? ' class="is-active"' : '' ?>><?= $label ?></a>
    <?php endforeach; ?>
  </nav>
  <button class="nav__github" id="github-funnel" type="button" aria-label="Get Cosmo on GitHub">
    <svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>
    <span>Get Cosmo</span>
  </button>
  <button class="nav__burger" id="nav-burger" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="nav-links">
    <span></span><span></span><span></span>
  </button>
</header>
<main class="page">
