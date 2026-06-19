<?php
/** Served as /sitemap.xml (see .htaccess). Generated so <loc> URLs carry the
 *  configured SITE_URL rather than a hardcoded domain. */
require_once __DIR__ . '/includes/db.php';
require_once __DIR__ . '/includes/seo.php';

header('Content-Type: application/xml; charset=utf-8');
$base = cosmo_site_url(cosmo_config());

echo '<?xml version="1.0" encoding="UTF-8"?>' . "\n";
echo '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' . "\n";
foreach (cosmo_seo_pages() as [$path, $freq, $prio]) {
    echo "  <url>\n";
    echo '    <loc>' . e($base . $path) . "</loc>\n";
    echo "    <changefreq>$freq</changefreq>\n";
    echo "    <priority>$prio</priority>\n";
    echo "  </url>\n";
}
echo "</urlset>\n";
