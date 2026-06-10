<?php
require_once __DIR__ . '/../includes/chart_svg.php';

section('svg_bar_h');
$bar = svg_bar_h([['label' => 'India', 'value' => 10], ['label' => 'US', 'value' => 5], ['label' => 'UK', 'value' => 2]]);
check('starts with <svg', str_starts_with($bar, '<svg'));
eq('3 value bars', substr_count($bar, 'class="bar"'), 3);
check('longest bar is widest', str_contains($bar, 'India'));
check('empty → empty state', str_contains(svg_bar_h([]), 'No data'));
check('all-zero → empty state', str_contains(svg_bar_h([['label' => 'x', 'value' => 0]]), 'No data'));

section('svg_line');
$line = svg_line([['t' => 'Jun 1', 'v' => 2], ['t' => 'Jun 2', 'v' => 5], ['t' => 'Jun 3', 'v' => 3]]);
check('has polyline', str_contains($line, '<polyline'));
check('has area polygon', str_contains($line, '<polygon'));
check('shows peak value', str_contains($line, 'peak 5'));
check('first + last labels', str_contains($line, 'Jun 1') && str_contains($line, 'Jun 3'));
check('empty → empty state', str_contains(svg_line([]), 'No data'));
check('all-zero → empty state', str_contains(svg_line([['t' => 'Jun 1', 'v' => 0]]), 'No data'));

section('svg_donut');
$d = svg_donut([['label' => 'INR', 'value' => 8], ['label' => 'USD', 'value' => 2]], ['center' => 'tips']);
eq('2 slices', substr_count($d, 'class="slice"'), 2);
check('center shows total 10', str_contains($d, '>10</text>'));
check('center caption', str_contains($d, '>tips</text>'));
check('empty → empty state', str_contains(svg_donut([]), 'No data'));
