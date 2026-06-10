<?php
/** Pure, zero-dependency SVG chart builders for the admin dashboard. Data in → SVG
 *  string out. No I/O, no DB, no globals beyond the palette constant. Every builder
 *  handles empty/all-zero data with a tidy empty-state so callers never branch.
 *  SVGs are responsive (viewBox + width:100%;height:auto) and use the site palette. */

const COSMO_CHART_PALETTE = ['#4a9eff', '#22c57b', '#f5a623', '#9b6bff', '#ff6b6b', '#2563eb', '#14b8a6', '#eab308'];

/** Shared empty-state used by every chart when there's nothing to draw. */
function chart_empty(int $w, int $h, string $msg = 'No data yet'): string
{
    $cx = $w / 2; $cy = $h / 2;
    $m = htmlspecialchars($msg, ENT_QUOTES, 'UTF-8');
    return "<svg viewBox=\"0 0 $w $h\" class=\"chart chart--empty\" style=\"width:100%;height:auto\" role=\"img\" aria-label=\"$m\">"
        . "<text x=\"$cx\" y=\"$cy\" text-anchor=\"middle\" dominant-baseline=\"middle\" fill=\"#9aa3b2\" font-size=\"13\">$m</text></svg>";
}

/** Line+area chart over a time series. $series = [['t'=>'Jun 1','v'=>3], ...] (chronological). */
function svg_line(array $series, array $opts = []): string
{
    $w = $opts['w'] ?? 520; $h = $opts['h'] ?? 170;
    $color = $opts['color'] ?? COSMO_CHART_PALETTE[0];
    $series = array_values($series);
    $n = count($series);
    $maxV = 0; foreach ($series as $p) $maxV = max($maxV, (int)$p['v']);
    if ($n === 0 || $maxV === 0) return chart_empty($w, $h);

    $padL = 8; $padR = 8; $padT = 18; $padB = 22;
    $plotW = $w - $padL - $padR; $plotH = $h - $padT - $padB;
    $stepX = $n > 1 ? $plotW / ($n - 1) : 0;
    $baseY = $padT + $plotH;

    $pts = [];
    foreach ($series as $i => $p) {
        $x = $padL + $i * $stepX;
        $y = $padT + $plotH - ($plotH * ((int)$p['v'] / $maxV));
        $pts[] = round($x, 1) . ',' . round($y, 1);
    }
    $line  = implode(' ', $pts);
    $lastX = round($padL + ($n - 1) * $stepX, 1);
    $area  = "$padL,$baseY $line $lastX,$baseY";

    $lastV = (int)$series[$n - 1]['v'];
    $lastY = round($padT + $plotH - ($plotH * ($lastV / $maxV)), 1);
    $first = htmlspecialchars((string)$series[0]['t'], ENT_QUOTES, 'UTF-8');
    $last  = htmlspecialchars((string)$series[$n - 1]['t'], ENT_QUOTES, 'UTF-8');

    $svg  = "<svg viewBox=\"0 0 $w $h\" class=\"chart chart--line\" style=\"width:100%;height:auto\">";
    $svg .= "<polygon class=\"area\" points=\"$area\" fill=\"$color\" fill-opacity=\"0.12\"/>";
    $svg .= "<polyline class=\"line\" points=\"$line\" fill=\"none\" stroke=\"$color\" stroke-width=\"2\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/>";
    $svg .= "<circle class=\"dot\" cx=\"$lastX\" cy=\"$lastY\" r=\"3.2\" fill=\"$color\"/>";
    $svg .= "<text x=\"$padL\" y=\"12\" font-size=\"10\" fill=\"#9aa3b2\">peak $maxV</text>";
    $svg .= "<text x=\"$padL\" y=\"" . ($h - 6) . "\" font-size=\"10\" fill=\"#9aa3b2\">$first</text>";
    $svg .= "<text x=\"" . ($w - $padR) . "\" y=\"" . ($h - 6) . "\" font-size=\"10\" fill=\"#9aa3b2\" text-anchor=\"end\">$last</text>";
    $svg .= "</svg>";
    return $svg;
}

/** Horizontal bar chart. $rows = [['label'=>'India','value'=>120], ...] (any order). */
function svg_bar_h(array $rows, array $opts = []): string
{
    $rows = array_values($rows);
    $n = count($rows);
    $w  = $opts['w'] ?? 520;
    $color = $opts['color'] ?? COSMO_CHART_PALETTE[0];
    $maxV = 0; foreach ($rows as $r) $maxV = max($maxV, (int)$r['value']);
    if ($n === 0 || $maxV === 0) return chart_empty($w, 120);

    $rh = 30; $padT = 6; $padB = 6;
    $h = $padT + $padB + $n * $rh;
    $labelW = 120; $valW = 46; $barX = $labelW; $barMax = $w - $labelW - $valW;

    $svg = "<svg viewBox=\"0 0 $w $h\" class=\"chart chart--bar\" style=\"width:100%;height:auto\">";
    foreach ($rows as $i => $r) {
        $y  = $padT + $i * $rh; $by = $y + 6; $bh = $rh - 12;
        $bw = max(2, round($barMax * ((int)$r['value'] / $maxV)));
        $ty = $y + $rh / 2;
        $raw = (string)$r['label'];
        $lbl = mb_strlen($raw) > 16 ? mb_substr($raw, 0, 15) . '…' : $raw;
        $lbl = htmlspecialchars($lbl, ENT_QUOTES, 'UTF-8');
        $val = number_format((int)$r['value']);
        $svg .= "<text x=\"0\" y=\"$ty\" dominant-baseline=\"middle\" font-size=\"12\" fill=\"#1a1a2e\">$lbl</text>";
        $svg .= "<rect class=\"bar-bg\" x=\"$barX\" y=\"$by\" width=\"$barMax\" height=\"$bh\" rx=\"4\" fill=\"#eef1f6\"/>";
        $svg .= "<rect class=\"bar\" x=\"$barX\" y=\"$by\" width=\"$bw\" height=\"$bh\" rx=\"4\" fill=\"$color\"/>";
        $svg .= "<text class=\"val\" x=\"$w\" y=\"$ty\" dominant-baseline=\"middle\" text-anchor=\"end\" font-size=\"12\" fill=\"#5b6472\">$val</text>";
    }
    $svg .= "</svg>";
    return $svg;
}

/** Donut chart. $slices = [['label'=>'INR','value'=>8], ...]; sized by value share.
 *  Center shows the total + $opts['center'] caption. Legend is rendered by the caller. */
function svg_donut(array $slices, array $opts = []): string
{
    $slices = array_values($slices);
    $total = 0; foreach ($slices as $s) $total += (int)$s['value'];
    $size = $opts['size'] ?? 170;
    if (!$slices || $total === 0) return chart_empty($size, $size);

    $cx = $size / 2; $cy = $size / 2; $r = $size / 2 - 16; $C = 2 * M_PI * $r;
    $svg  = "<svg viewBox=\"0 0 $size $size\" class=\"chart chart--donut\" style=\"width:100%;height:auto;max-width:200px;margin:0 auto;display:block\">";
    $svg .= "<circle cx=\"$cx\" cy=\"$cy\" r=\"$r\" fill=\"none\" stroke=\"#eef1f6\" stroke-width=\"16\"/>";
    $offset = 0;
    foreach ($slices as $i => $s) {
        $len   = ((int)$s['value'] / $total) * $C;
        $color = COSMO_CHART_PALETTE[$i % count(COSMO_CHART_PALETTE)];
        $dash  = round($len, 2) . ' ' . round($C - $len, 2);
        $svg  .= "<circle class=\"slice\" cx=\"$cx\" cy=\"$cy\" r=\"$r\" fill=\"none\" stroke=\"$color\" stroke-width=\"16\""
               . " stroke-dasharray=\"$dash\" stroke-dashoffset=\"" . round(-$offset, 2) . "\" transform=\"rotate(-90 $cx $cy)\"/>";
        $offset += $len;
    }
    $cap = htmlspecialchars($opts['center'] ?? '', ENT_QUOTES, 'UTF-8');
    $svg .= "<text x=\"$cx\" y=\"" . ($cy - 2) . "\" text-anchor=\"middle\" dominant-baseline=\"middle\" font-size=\"24\" font-weight=\"700\" fill=\"#1a1a2e\">" . number_format($total) . "</text>";
    if ($cap !== '') $svg .= "<text x=\"$cx\" y=\"" . ($cy + 18) . "\" text-anchor=\"middle\" font-size=\"10\" fill=\"#9aa3b2\">$cap</text>";
    $svg .= "</svg>";
    return $svg;
}
