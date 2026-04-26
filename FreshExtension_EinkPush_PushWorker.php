<?php
// Standalone push worker - runs as background CLI process
// Usage: php FreshExtension_EinkPush_PushWorker.php <progressFile>
error_reporting(E_ALL & ~E_WARNING & ~E_NOTICE);
ini_set('display_errors', 1);
ini_set('log_errors', 1);
set_time_limit(0);

$progressFile = $argv[1] ?? '';
if (empty($progressFile) || !file_exists($progressFile)) {
    error_log('[EinkPush Worker] No progress file: ' . $progressFile);
    exit(1);
}

$bg = json_decode(file_get_contents($progressFile), true);
if (!$bg) {
    error_log('[EinkPush Worker] Invalid config in progress file');
    exit(1);
}

$jobId = $bg['jobId'];
$endpoint = $bg['endpoint'];
$epubDir = $bg['epubDir'];
$sources = $bg['sources'];
$pushRetries = $bg['pushRetries'];
$pushRetryDelay = $bg['pushRetryDelay'];
$screenWidth = $bg['screenWidth'];
$screenHeight = $bg['screenHeight'];
$fontSize = $bg['fontSize'];
$readabilityUrl = $bg['readabilityUrl'];

$writeProgress = function($step, $extra = []) use ($progressFile) {
    $payload = ['step' => $step, 'time' => microtime(true)] + $extra;
    $ok = file_put_contents($progressFile, json_encode($payload), LOCK_EX);
    clearstatcache(true, $progressFile);
    if (!$ok) {
        error_log('[EinkPush Worker] Failed to write progress: ' . $step);
    }
};

error_log('[EinkPush Worker] Starting jobId=' . $jobId . ' pid=' . getmypid());

// Bootstrap FreshRSS
$freshRssRoot = dirname(__DIR__);
if (!file_exists($freshRssRoot . '/lib/lib_rss.php')) {
    // Try parent (extension is in extensions/xExtension-EinkPush/)
    $freshRssRoot = dirname(dirname(dirname(__DIR__)));
}

if (!file_exists($freshRssRoot . '/lib/lib_rss.php')) {
    $writeProgress('error', ['message' => 'Cannot find FreshRSS lib_rss.php at ' . $freshRssRoot]);
    error_log('[EinkPush Worker] FreshRSS not found at ' . $freshRssRoot);
    exit(1);
}

require_once $freshRssRoot . '/lib/lib_rss.php';

// Set minimal context
$_SERVER['REMOTE_USER'] = '';
$_SERVER['HTTP_HOST'] = '';
$_SERVER['REQUEST_URI'] = '';

// Create helper
require_once __DIR__ . '/FreshExtension_EinkPush_Helper.php';
$helper = new EinkPushHelper($epubDir, $screenWidth, $screenHeight, $fontSize, $readabilityUrl);

// Step 1: Test connection
$writeProgress('test_connection', ['message' => 'Testing connection...']);
error_log('[EinkPush Worker] checking device: ' . $endpoint);
$connOk = $helper->checkDeviceStatus($endpoint);
error_log('[EinkPush Worker] checkDeviceStatus=' . ($connOk ? 'ok' : 'fail'));

if (!$connOk) {
    $writeProgress('error', ['message' => 'Device unreachable']);
    error_log('[EinkPush Worker] Device unreachable, exiting');
    exit(0);
}
$writeProgress('connection_ok', ['message' => 'Device online']);

// Step 2: Generate EPUBs
$totalSources = 0;
foreach ($sources as $srcCfg) {
    if (!empty($srcCfg['enabled'])) $totalSources++;
}

$paths = [];
$totalArticles = 0;
$processedArticles = 0;
$currentSource = 0;

foreach ($sources as $key => $srcCfg) {
    if (empty($srcCfg['enabled'])) continue;
    $currentSource++;
    $label = $helper->sourceLabel($key);
    $writeProgress('generating', ['source' => $label, 'sourceIndex' => $currentSource, 'totalSources' => $totalSources]);

    $historyDays = (int) ($srcCfg['historyDays'] ?? 7);
    $unreadOnly = !empty($srcCfg['unreadOnly']);
    $markAsRead = !empty($srcCfg['markAsRead']);
    $fetchContent = !empty($srcCfg['fetchContent']);
    $maxArticles = (int) ($srcCfg['maxArticles'] ?? 0);
    $addTimestamp = !empty($srcCfg['addTimestamp']);

    $writeProgress('collecting', ['source' => $label, 'message' => 'Collecting articles...']);
    $entries = $helper->collectForSource($key, $historyDays, $unreadOnly);

    if (empty($entries)) {
        $writeProgress('source_empty', ['source' => $label]);
        continue;
    }

    $numEntries = count($entries);
    $totalArticles += $numEntries;
    $writeProgress('building', ['source' => $label, 'articles' => $numEntries, 'totalAllArticles' => $totalArticles]);

    $path = $helper->buildEpub($key, $label, $entries, $markAsRead, $fetchContent, $addTimestamp, $maxArticles, function($idx, $total) use ($label, $writeProgress, $totalArticles, $processedArticles) {
        $all = $processedArticles + $idx;
        $writeProgress('article', [
            'source' => $label, 'articleIndex' => $idx, 'totalInSource' => $total,
            'processedAllArticles' => $all, 'totalAllArticles' => $totalArticles,
            'percent' => round(($all / max(1, $totalArticles)) * 100)
        ]);
    });

    $processedArticles += $numEntries;
    if ($path !== null) $paths[$key] = $path;

    if ($key === 'favorites' && !empty($srcCfg['removeFromFavorites'])) {
        $helper->removeFromFavorites(array_map(function($e) { return $e->id(); }, $entries));
    }
}

if (empty($paths)) {
    $writeProgress('no_content', ['message' => 'No articles found']);
    exit(0);
}

// Step 3: Push to device
$totalFiles = count($paths);
$pushedFiles = 0;
$success = 0;
$failed = 0;

foreach ($paths as $sourceKey => $path) {
    $pushedFiles++;
    $sourceName = $helper->sourceLabel($sourceKey);
    $writeProgress('pushing', ['source' => $sourceName, 'fileIndex' => $pushedFiles, 'totalFiles' => $totalFiles]);
    if ($helper->pushToEndpoint($path, $endpoint, $pushRetries, $pushRetryDelay, $sourceName)) $success++; else $failed++;
}

// Save last push timestamp to file (FreshRSS config unavailable in CLI)
$lastPushFile = rtrim($epubDir, '/') . '/.last_push';
file_put_contents($lastPushFile, json_encode(['time' => time(), 'type' => 'manual', 'success' => $success, 'failed' => $failed]));

if ($failed === 0) {
    $writeProgress('done', ['success' => $success, 'message' => 'Successfully pushed ' . $success . ' EPUB(s).']);
} else {
    $writeProgress('done_with_errors', ['success' => $success, 'failed' => $failed,
        'message' => 'Pushed ' . $success . ', but ' . $failed . ' failed.']);
}

error_log('[EinkPush Worker] DONE success=' . $success . ' failed=' . $failed);
exit(0);
