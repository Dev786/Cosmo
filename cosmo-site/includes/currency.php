<?php
/** Currency model + resolution + processor routing. PURE — no I/O, no globals beyond
 *  these constants. The public subset is safe to expose to the browser. `floor`/`max`
 *  are in MAJOR units; `minor` is the smallest-unit factor (all four are 2-decimal). */

const COSMO_CURRENCIES = [
    'INR' => ['symbol' => '₹', 'minor' => 100, 'floor' => 49, 'max' => 100000, 'presets' => [49, 99, 199, 499]],
    'USD' => ['symbol' => '$', 'minor' => 100, 'floor' => 3,  'max' => 1000,   'presets' => [3, 5, 10, 25]],
    'EUR' => ['symbol' => '€', 'minor' => 100, 'floor' => 3,  'max' => 1000,   'presets' => [3, 5, 10, 25]],
    'GBP' => ['symbol' => '£', 'minor' => 100, 'floor' => 3,  'max' => 1000,   'presets' => [3, 5, 10, 25]],
];
const COSMO_DEFAULT_CURRENCY = 'USD';

/** Eurozone ISO-3166-1 alpha-2 codes (the 20 EUR-using members relevant to card geo). */
const COSMO_EUROZONE = ['AT','BE','HR','CY','EE','FI','FR','DE','GR','IE','IT','LV','LT','LU','MT','NL','PT','SK','SI','ES'];

function currency_for_country(string $iso): string
{
    $iso = strtoupper(trim($iso));
    if ($iso === 'IN') return 'INR';
    if ($iso === 'US') return 'USD';
    if ($iso === 'GB') return 'GBP';
    if (in_array($iso, COSMO_EUROZONE, true)) return 'EUR';
    return COSMO_DEFAULT_CURRENCY;
}

/** Override (if enabled) → geo-derived (if enabled) → default. Always returns an enabled currency. */
function resolve_currency(?string $override, string $geoIso, array $enabled, string $default): string
{
    $default = in_array($default, $enabled, true) ? $default : ($enabled[0] ?? 'USD');
    if ($override !== null) {
        $o = strtoupper(trim($override));
        if (in_array($o, $enabled, true)) return $o;
    }
    $geo = currency_for_country($geoIso);
    return in_array($geo, $enabled, true) ? $geo : $default;
}

function currency_meta(string $cur): array
{
    $cur = strtoupper(trim($cur));
    return COSMO_CURRENCIES[$cur] ?? COSMO_CURRENCIES[COSMO_DEFAULT_CURRENCY];
}

function to_minor(int $major, string $cur): int
{
    return $major * currency_meta($cur)['minor'];
}

/** INR is always Razorpay (UPI). Everything else uses the configured foreign processor
 *  ('paypal' now; flip to 'razorpay' once International Payments is approved). */
function processor_for_currency(string $cur, string $foreignProcessor): string
{
    return strtoupper(trim($cur)) === 'INR' ? 'razorpay' : $foreignProcessor;
}

/** The browser-safe subset: symbol/floor/presets per enabled currency. No internal max/minor. */
function public_currency_map(array $enabled): array
{
    $out = [];
    foreach ($enabled as $cur) {
        if (!isset(COSMO_CURRENCIES[$cur])) continue;
        $m = COSMO_CURRENCIES[$cur];
        $out[$cur] = ['symbol' => $m['symbol'], 'floor' => $m['floor'], 'presets' => $m['presets']];
    }
    return $out;
}
