<?php
// Standalone push worker v3 - runs as background CLI process
// Usage: php FreshExtension_EinkPush_Worker.php <progressFile>
error_reporting(E_ALL);
ini_set('display_errors', 0);
ini_set('log_errors', 1);
ini_set('error_log', '/tmp/einkpush_worker_errors.log');
set_time_limit(0);

$progressFile = $argv[1] ?? '';

// Catch fatal errors and write to progress file
register_shutdown_function(function() use ($progressFile) {
    $err = error_get_last();
    if ($err && in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR])) {
        @file_put_contents($progressFile, json_encode([
            'step' => 'error',
            'message' => 'Worker crashed: ' . $err['message'],
            'time' => microtime(true),
        ]));
    }
});
if (empty($progressFile) || !file_exists($progressFile)) {
    error_log('[Worker] No progress file: ' . $progressFile);
    exit(1);
}

$bg = json_decode(file_get_contents($progressFile), true);
if (!$bg) {
    error_log('[Worker] Invalid config');
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

// Derive endpoint same way as controller (device_address + folder_name)
// If endpoint in config is empty/invalid, rebuild it
if (empty($endpoint) || strpos($endpoint, '://') === false) {
    $deviceAddress = rtrim((string)($bg['deviceAddress'] ?? ''), '/');
    $folderName = ltrim((string)($bg['folderName'] ?? 'RSSFeeds'), '/');
    $endpoint = $deviceAddress . '/upload?path=/' . $folderName;
}

$write = function($step, $msg, $extra = []) use ($progressFile) {
    $payload = [
        'step' => $step,
        'message' => $msg,
        'time' => microtime(true),
    ] + $extra;
    file_put_contents($progressFile, json_encode($payload), LOCK_EX);
    clearstatcache(true, $progressFile);
};

error_log('[Worker] START pid=' . getmypid() . ' endpoint=' . $endpoint);
$write('starting', 'Starting push...');

// Bootstrap FreshRSS
$freshRssRoot = dirname(dirname(__DIR__));
$libPath = $freshRssRoot . '/lib/lib_rss.php';

error_log('[Worker] FreshRSS root: ' . $freshRssRoot);
error_log('[Worker] lib_rss.php exists: ' . (file_exists($libPath) ? 'yes' : 'no'));

if (!file_exists($libPath)) {
    $write('error', 'FreshRSS lib not found at ' . $libPath);
    exit(1);
}

// Define syslog constants for CLI
$consts = ['LOG_PID','LOG_CONS','LOG_ODELAY','LOG_NDELAY','LOG_NOWAIT','LOG_PERROR','COPY_SYSLOG_TO_STDERR'];
foreach ($consts as $c) {
    if (!defined($c)) define($c, 0);
}

try {
    require_once $libPath;
    error_log('[Worker] lib_rss.php loaded OK');
} catch (Throwable $e) {
    $write('error', 'FreshRSS load failed: ' . $e->getMessage());
    exit(1);
}

// Set minimal context
$_SERVER['REMOTE_USER'] = '';
$_SERVER['HTTP_HOST'] = '';
$_SERVER['REQUEST_URI'] = '';

// Load helper
$helperPath = __DIR__ . '/FreshExtension_EinkPush_Helper.php';
if (!file_exists($helperPath)) {
    $write('error', 'Helper not found at ' . $helperPath);
    exit(1);
}

try {
    require_once $helperPath;
    $helper = new EinkPushHelper($epubDir, $screenWidth, $screenHeight, $fontSize, $readabilityUrl);
    error_log('[Worker] Helper created OK');
} catch (Throwable $e) {
    $write('error', 'Helper failed: ' . $e->getMessage());
    exit(1);
}

// Step 1: Test connection
error_log('[Worker] Testing connection to: ' . $endpoint);
$write('test_connection', 'Testing connection...');

$connOk = $helper->checkDeviceStatus($endpoint);
error_log('[Worker] Connection result: ' . ($connOk ? 'OK' : 'FAIL'));

if (!$connOk) {
    $write('error', 'Device unreachable at ' . $endpoint);
    exit(0);
}
$write('connection_ok', 'Device online');

// Step 2: Generate EPUBs
$totalSources = 0;
foreach ($sources as $_key => $_cfg) {
    if (!empty($_cfg['enabled'])) $totalSources++;
}

$paths = [];
$totalArticles = 0;
$processedArticles = 0;
$currentSource = 0;

foreach ($sources as $key => $srcCfg) {
    if (empty($srcCfg['enabled'])) continue;
    $currentSource++;
    $label = $helper->sourceLabel($key);
    $write('generating', 'Processing ' . $label, ['source' => $label, 'sourceIndex' => $currentSource, 'totalSources' => $totalSources]);

    $historyDays = (int)($srcCfg['historyDays'] ?? 7);
    $unreadOnly = !empty($srcCfg['unreadOnly']);
    $markAsRead = !empty($srcCfg['markAsRead']);
    $fetchContent = !empty($srcCfg['fetchContent']);
    $maxArticles = (int)($srcCfg['maxArticles'] ?? 0);
    $addTimestamp = !empty($srcCfg['addTimestamp']);

    $write('collecting', 'Collecting articles...', ['source' => $label]);
    $entries = $helper->collectForSource($key, $historyDays, $unreadOnly);

    if (empty($entries)) {
        $write('source_empty', $label . ': no articles', ['source' => $label]);
        continue;
    }

    $numEntries = count($entries);
    $totalArticles += $numEntries;
    $write('building', $label . ': ' . $numEntries . ' articles', ['source' => $label, 'articles' => $numEntries, 'totalAllArticles' => $totalArticles]);

    $path = $helper->buildEpub($key, $label, $entries, $markAsRead, $fetchContent, $addTimestamp, $maxArticles, function($idx, $total) use ($label, $write, $totalArticles, &$processedArticles) {
        $all = $processedArticles + $idx;
        $pct = round(($all / max(1, $totalArticles)) * 100);
        $write('article', 'Article ' . $all . '/' . $totalArticles . ' (' . $pct . '%)', [
            'source' => $label,
            'articleIndex' => $idx,
            'totalInSource' => $total,
            'processedAllArticles' => $all,
            'totalAllArticles' => $totalArticles,
            'percent' => $pct,
        ]);
    });

    $processedArticles += $numEntries;
    if ($path !== null) $paths[$key] = $path;
}

if (empty($paths)) {
    $write('no_content', 'No articles found');
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
    $write('pushing', 'Sending ' . $sourceName . '...', ['source' => $sourceName, 'fileIndex' => $pushedFiles, 'totalFiles' => $totalFiles]);
    if ($helper->pushToEndpoint($path, $endpoint, $pushRetries, $pushRetryDelay, $sourceName)) {
        $success++;
    } else {
        $failed++;
    }
}

if ($failed === 0) {
    $write('done', 'Pushed ' . $success . ' EPUB(s)', ['success' => $success]);
} else {
    $write('done_with_errors', $success . ' ok, ' . $failed . ' failed', ['success' => $success, 'failed' => $failed]);
}

error_log('[Worker] DONE success=' . $success . ' failed=' . $failed);
exit(0);
