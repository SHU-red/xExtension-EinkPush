<?php
// Quick smoke-test: verifies the PHP files parse without syntax errors.
// Run: php test_class_loading.php
// NOTE: Full functionality requires the FreshRSS runtime (Minz_Extension etc.).

echo "Checking PHP syntax of core files...\n";

$files = [
    'FreshExtension_EinkPush_Helper.php',
    'Controllers/einkpushController.php',
    'i18n/en/ext.php',
];
$ok = true;
foreach ($files as $f) {
    $path = __DIR__ . '/' . $f;
    $output = [];
    $ret = 0;
    exec('php -l ' . escapeshellarg($path) . ' 2>&1', $output, $ret);
    $status = $ret === 0 ? 'OK' : 'FAIL';
    echo "  [{$status}] {$f}\n";
    if ($ret !== 0) {
        echo "    " . implode("\n    ", $output) . "\n";
        $ok = false;
    }
}
echo $ok ? "\nAll files OK.\n" : "\nSome files have errors.\n";
exit($ok ? 0 : 1);