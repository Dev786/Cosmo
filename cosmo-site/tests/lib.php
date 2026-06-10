<?php
/** Zero-dependency assert harness. Tests print PASS/FAIL; run.php aggregates the exit code. */
$GLOBALS['__t'] = ['pass' => 0, 'fail' => 0];

function section(string $title): void { fwrite(STDOUT, "\n== $title ==\n"); }

function check(string $name, bool $cond): void {
    if ($cond) { $GLOBALS['__t']['pass']++; fwrite(STDOUT, "  PASS  $name\n"); }
    else       { $GLOBALS['__t']['fail']++; fwrite(STDOUT, "  FAIL  $name\n"); }
}

function eq(string $name, $actual, $expected): void {
    check($name . "  (got " . var_export($actual, true) . ")", $actual === $expected);
}

function summary_exit(): void {
    $t = $GLOBALS['__t'];
    fwrite(STDOUT, "\n{$t['pass']} passed, {$t['fail']} failed\n");
    exit($t['fail'] === 0 ? 0 : 1);
}
