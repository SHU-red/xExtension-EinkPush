<?php
// Verify extension structure. Run: php verify_extension.php
// NOTE: Cannot fully test without FreshRSS runtime (Minz_Extension required).

echo "Verifying extension file structure...\n\n";

$required = [
    'extension.php',
    'metadata.json',
    'configure.phtml',
    'FreshExtension_EinkPush_Helper.php',
    'Controllers/einkpushController.php',
    'i18n/en/ext.php',
    'i18n/de/ext.php',
    'i18n/fr/ext.php',
    'views/einkpush/error.phtml',
    'views/einkpush/message.phtml',
];

$ok = true;
foreach ($required as $f) {
    $exists = file_exists(__DIR__ . '/' . $f);
    echo ($exists ? '  [OK]  ' : '  [MISS]') . " {$f}\n";
    if (!$exists) $ok = false;
}

// Check metadata
$meta = json_decode(file_get_contents(__DIR__ . '/metadata.json'), true);
echo "\nMetadata:\n";
echo "  name:       " . ($meta['name'] ?? '?') . "\n";
echo "  entrypoint: " . ($meta['entrypoint'] ?? '?') . "\n";
echo "  version:    " . ($meta['version'] ?? '?') . "\n";

echo $ok ? "\nAll checks passed.\n" : "\nSome files are missing!\n";
exit($ok ? 0 : 1);