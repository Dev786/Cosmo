<?php
/** SEO helpers — canonical URL, Open Graph / Twitter cards, and JSON-LD structured
 *  data. Pages set $title / $desc (and optionally a $jsonld[] array of extra
 *  schema.org nodes) before including header.php, which calls cosmo_seo_head().
 *  All absolute URLs derive from $cfg['site_url']; everything degrades gracefully
 *  when .env (hence $cfg) is absent so the marketing pages still render.
 *
 *  Self-sufficient: a page may `require_once includes/seo.php` up front to build
 *  its $jsonld[] (via cosmo_breadcrumbs/cosmo_faq_jsonld/cosmo_site_url) before the
 *  header is included. */
require_once __DIR__ . '/db.php';

/** Configured site origin, no trailing slash. '' when unconfigured. */
function cosmo_site_url(?array $cfg): string
{
    return $cfg ? rtrim((string)($cfg['site_url'] ?? ''), '/') : '';
}

/** Absolute canonical URL for the current request: origin + clean path (query
 *  stripped, trailing slash removed except root). .htaccess already 301s away
 *  index.php / the .php extension, so REQUEST_URI is the clean path. */
function cosmo_canonical(?array $cfg): string
{
    $base = cosmo_site_url($cfg);
    if ($base === '') return '';
    $path = explode('?', (string)($_SERVER['REQUEST_URI'] ?? '/'), 2)[0];
    if ($path !== '/') $path = '/' . trim($path, '/');
    return $base . $path;
}

/** Absolute URL for a docroot-relative asset (og:image etc.). '' when unconfigured. */
function cosmo_asset_url(?array $cfg, string $rel): string
{
    $base = cosmo_site_url($cfg);
    return $base === '' ? '' : $base . '/' . ltrim($rel, '/');
}

/** Indexable pages, for the sitemap: [path, changefreq, priority]. */
function cosmo_seo_pages(): array
{
    return [
        ['/',             'weekly',  '1.0'],
        ['/features',     'monthly', '0.9'],
        ['/architecture', 'monthly', '0.9'],
        ['/demos',        'monthly', '0.7'],
        ['/setup',        'monthly', '0.7'],
        ['/support',      'yearly',  '0.4'],
    ];
}

/** Render one JSON-LD <script> block. */
function cosmo_jsonld_script(array $data): string
{
    return '<script type="application/ld+json">'
        . json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
        . "</script>\n";
}

/** Site-wide JSON-LD graph: the WebSite and its author (Person). Page-specific
 *  nodes (SoftwareApplication, TechArticle, FAQPage, BreadcrumbList) are passed
 *  per page via $jsonld and emitted as separate scripts. */
function cosmo_site_jsonld(?array $cfg): array
{
    $url  = cosmo_site_url($cfg) ?: 'https://example.com';
    $repo = (string)($cfg['repo_url'] ?? '');
    $person = ['@type' => 'Person', '@id' => $url . '/#author', 'name' => 'Devashish Rana'];
    if ($repo !== '') $person['sameAs'] = [$repo];
    return [
        '@context' => 'https://schema.org',
        '@graph'   => [
            [
                '@type'       => 'WebSite',
                '@id'         => $url . '/#website',
                'url'         => $url . '/',
                'name'        => 'Cosmo',
                'description' => 'Cosmo is a local-first, open-source AI desktop companion with on-device speech-to-text, text-to-speech, and a pluggable LLM brain.',
                'inLanguage'  => 'en',
                'publisher'   => ['@id' => $url . '/#author'],
            ],
            $person,
        ],
    ];
}

/** Emit canonical + Open Graph + Twitter cards + JSON-LD into <head>. Call from
 *  header.php after the <title>/<meta description>. */
function cosmo_seo_head(?array $cfg, string $title, string $desc, array $jsonld = []): void
{
    $canonical = cosmo_canonical($cfg);
    $siteName  = (string)($cfg['site_name'] ?? 'Cosmo');

    // Only advertise an og:image once the asset actually exists — a broken preview
    // card is worse than a plain one. Drop a 1200×630 PNG at assets/media/og-cover.png.
    $ogRel    = 'assets/media/og-cover.png';
    $ogImage  = (is_file(dirname(__DIR__) . '/' . $ogRel)) ? cosmo_asset_url($cfg, $ogRel) : '';

    echo '<meta property="og:title" content="' . e($title) . "\">\n";
    echo '<meta property="og:description" content="' . e($desc) . "\">\n";
    echo "<meta property=\"og:type\" content=\"website\">\n";
    echo '<meta property="og:site_name" content="' . e($siteName) . "\">\n";
    echo "<meta property=\"og:locale\" content=\"en_US\">\n";
    if ($canonical !== '') {
        echo '<link rel="canonical" href="' . e($canonical) . "\">\n";
        echo '<meta property="og:url" content="' . e($canonical) . "\">\n";
    }
    if ($ogImage !== '') {
        echo '<meta property="og:image" content="' . e($ogImage) . "\">\n";
        echo "<meta property=\"og:image:width\" content=\"1200\">\n";
        echo "<meta property=\"og:image:height\" content=\"630\">\n";
    }
    echo '<meta name="twitter:card" content="' . ($ogImage !== '' ? 'summary_large_image' : 'summary') . "\">\n";
    echo '<meta name="twitter:title" content="' . e($title) . "\">\n";
    echo '<meta name="twitter:description" content="' . e($desc) . "\">\n";
    if ($ogImage !== '') echo '<meta name="twitter:image" content="' . e($ogImage) . "\">\n";

    // Structured data: site-wide graph first, then any page-specific nodes.
    echo cosmo_jsonld_script(cosmo_site_jsonld($cfg));
    foreach ($jsonld as $node) echo cosmo_jsonld_script($node);
}

/** SoftwareApplication node for Cosmo (home page). No aggregateRating — we don't
 *  fabricate review stars; the node is still valid and feeds AI/product understanding. */
function cosmo_softwareapp_jsonld(?array $cfg): array
{
    $url  = cosmo_site_url($cfg) ?: 'https://example.com';
    $repo = (string)($cfg['repo_url'] ?? '');
    $node = [
        '@context'            => 'https://schema.org',
        '@type'               => 'SoftwareApplication',
        '@id'                 => $url . '/#app',
        'name'                => 'Cosmo',
        'applicationCategory' => 'UtilitiesApplication',
        'operatingSystem'     => 'macOS',
        'url'                 => $url . '/',
        'description'         => 'Cosmo is a free, open-source, local-first AI desktop companion for macOS with on-device speech-to-text, text-to-speech, and a pluggable local (Ollama) or cloud LLM brain.',
        'author'              => ['@id' => $url . '/#author'],
        'isAccessibleForFree' => true,
        'license'             => 'https://www.apache.org/licenses/LICENSE-2.0',
        'offers'              => ['@type' => 'Offer', 'price' => '0', 'priceCurrency' => 'USD'],
        'featureList'         => [
            'On-device speech-to-text (STT)',
            'Local and cloud text-to-speech (TTS)',
            'Wake word and semantic end-of-turn detection',
            'Pluggable local (Ollama) or cloud LLM brain',
            'Vendor-neutral tool calling',
            'Semantic memory',
            'Privacy-first: no webcam, no keylogging, no screen capture',
        ],
        'keywords' => 'local AI assistant, on-device speech-to-text, local text-to-speech, offline voice assistant, private AI, Ollama, open source desktop companion',
    ];
    if ($repo !== '') { $node['sameAs'] = [$repo]; $node['downloadUrl'] = $repo; }
    return $node;
}

/** Build a BreadcrumbList node for a page: pass [[name, path], …] crumbs. */
function cosmo_breadcrumbs(?array $cfg, array $crumbs): array
{
    $base = cosmo_site_url($cfg) ?: '';
    $items = [];
    foreach ($crumbs as $i => [$name, $path]) {
        $items[] = [
            '@type'    => 'ListItem',
            'position' => $i + 1,
            'name'     => $name,
            'item'     => $base . $path,
        ];
    }
    return ['@context' => 'https://schema.org', '@type' => 'BreadcrumbList', 'itemListElement' => $items];
}

/** Build a FAQPage node from [[question, answer], …]. The same Q&As must also be
 *  visible on the page (Google requirement) — render them with cosmo_faq_html(). */
function cosmo_faq_jsonld(array $qa): array
{
    $items = [];
    foreach ($qa as [$q, $a]) {
        $items[] = [
            '@type'          => 'Question',
            'name'           => $q,
            'acceptedAnswer' => ['@type' => 'Answer', 'text' => $a],
        ];
    }
    return ['@context' => 'https://schema.org', '@type' => 'FAQPage', 'mainEntity' => $items];
}

/** Visible FAQ markup matching a cosmo_faq_jsonld() set, using <details> so it needs
 *  no JS. Answers may contain inline HTML; questions are escaped. */
function cosmo_faq_html(array $qa): string
{
    $out = '<div class="faq">';
    foreach ($qa as [$q, $a]) {
        $out .= '<details class="faq__item"><summary>' . e($q) . '</summary><div class="faq__a">' . $a . '</div></details>';
    }
    return $out . '</div>';
}
