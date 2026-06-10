<?php
/** Runs every tests/test_*.php in one process. Usage: php tests/run.php */
require __DIR__ . '/lib.php';
foreach (glob(__DIR__ . '/test_*.php') as $f) { require $f; }
summary_exit();
