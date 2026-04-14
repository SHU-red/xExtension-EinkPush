<?php
/**
 * EinkPush Release Helper Script
 * 
 * This script verifies version consistency across metadata.json, extension.php, 
 * and CHANGELOG.md, then packages the extension into a zip file.
 */

$metadataFile = __DIR__ . '/../metadata.json';
$extensionFile = __DIR__ . '/../extension.php';
$changelogFile = __DIR__ . '/../CHANGELOG.md';
$outputZip = __DIR__ . '/../xExtension-EinkPush.zip';

echo "🚀 Starting EinkPush Release Process...\n";

// 1. Load Metadata Version
if (!file_exists($metadataFile)) {
    die("❌ Error: metadata.json not found.\n");
}
$metadata = json_decode(file_get_contents($metadataFile), true);
$version = $metadata['version'] ?? null;
if (!$version) {
    die("❌ Error: No version found in metadata.json.\n");
}
echo "📦 Metadata Version: $version\n";

// 2. Verify extension.php Version
if (!file_exists($extensionFile)) {
    die("❌ Error: extension.php not found.\n");
}
$extensionContent = file_get_contents($extensionFile);
if (strpos($extensionContent, "const VERSION = '$version';") === false) {
    die("❌ Error: extension.php VERSION constant does not match metadata.json ($version).\n");
}
echo "✅ extension.php version matches.\n";

// 3. Verify CHANGELOG.md
if (!file_exists($changelogFile)) {
    die("❌ Error: CHANGELOG.md not found.\n");
}
$changelogContent = file_get_contents($changelogFile);
if (strpos($changelogContent, "## [$version]") === false) {
    die("❌ Error: CHANGELOG.md does not contain an entry for version $version.\n");
}
echo "✅ CHANGELOG.md entry found.\n";

// 4. Create Zip Package
echo "📂 Packaging extension...\n";
$zip = new ZipArchive();
if ($zip->open($outputZip, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
    die("❌ Error: Could not create zip file.\n");
}

$filesToInclude = [
    'Controllers',
    'i18n',
    'static',
    'views',
    'readability-api',
    'FreshExtension_EinkPush_Helper.php',
    'extension.php',
    'configure.phtml',
    'metadata.json',
    'LICENSE',
    'README.md',
    'CHANGELOG.md'
];

$rootPath = realpath(__DIR__ . '/..');

foreach ($filesToInclude as $file) {
    $filePath = $rootPath . '/' . $file;
    if (is_dir($filePath)) {
        $iterator = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($filePath, RecursiveDirectoryIterator::SKIP_DOTS),
            RecursiveIteratorIterator::SELF_FIRST
        );
        foreach ($iterator as $item) {
            $relativePath = 'xExtension-EinkPush/' . $file . '/' . $iterator->getSubPathName();
            if ($item->isDir()) {
                $zip->addEmptyDir($relativePath);
            } else {
                $zip->addFile($item->getRealPath(), $relativePath);
            }
        }
    } else if (file_exists($filePath)) {
        $zip->addFile($filePath, 'xExtension-EinkPush/' . $file);
    }
}

$zip->close();
echo "✅ Release package created: xExtension-EinkPush.zip\n";
echo "🎉 Ready for release! Push a tag 'v$version' to GitHub to trigger the automated release.\n";
