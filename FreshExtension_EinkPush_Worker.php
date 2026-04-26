<?php
// Standalone push worker - runs as background CLI process
// Usage: php FreshExtension_EinkPush_Worker.php <progressFile>
error_reporting(E_ALL);
ini_set('display_errors', 0);
ini_set('log_errors', 1);
ini_set('error_log', '/tmp/einkpush_worker_errors.log');
set_time_limit(0);

$log = function($msg) {
    $line = '[' . date('H:i:s') . '] [Worker] ' . $msg . PHP_EOL;
    echo $line;
    file_put_contents('/tmp/einkpush_worker.log', $line, FILE_APPEND);
};

$progressFile = $argv[1] ?? '';

// Catch fatal errors
set_error_handler(function($severity, $message, $file, $line) use ($progressFile) {
    $log("ERROR [$severity] $message at $file:$line");
    @file_put_contents($progressFile, json_encode([
        'step' => 'error',
        'message' => "PHP Error: $message at $file:$line",
        'time' => microtime(true),
    ]), LOCK_EX);
    return false;
});

set_exception_handler(function($e) use ($progressFile) {
    $log("EXCEPTION: " . $e->getMessage());
    @file_put_contents($progressFile, json_encode([
        'step' => 'error',
        'message' => 'Exception: ' . $e->getMessage(),
        'time' => microtime(true),
    ]), LOCK_EX);
});

register_shutdown_function(function() use ($progressFile) {
    $err = error_get_last();
    if ($err) {
        $log("SHUTDOWN: " . print_r($err, true));
        if (in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR])) {
            @file_put_contents($progressFile, json_encode([
                'step' => 'error',
                'message' => 'Worker crashed: ' . $err['message'],
                'time' => microtime(true),
            ]), LOCK_EX);
        }
    }
});

if (empty($progressFile) || !file_exists($progressFile)) {
    exit(1);
}

$bg = json_decode(file_get_contents($progressFile), true);
if (!$bg) {
    exit(1);
}

$jobId = $bg['jobId'];
$mode = $bg['mode'] ?? 'push';
$endpoint = $bg['endpoint'] ?? '';
$epubDir = $bg['epubDir'];
$sources = $bg['sources'];
$pushRetries = $bg['pushRetries'] ?? 3;
$pushRetryDelay = $bg['pushRetryDelay'] ?? 5;
$screenWidth = $bg['screenWidth'] ?? 800;
$screenHeight = $bg['screenHeight'] ?? 600;
$fontSize = $bg['fontSize'] ?? 14;
$readabilityUrl = $bg['readabilityUrl'] ?? '';
$user = $bg['username'] ?? 'shur3d';

$write = function($step, $msg, $extra = []) use ($progressFile, $log) {
    $payload = [
        'step' => $step,
        'message' => $msg,
        'time' => microtime(true),
    ] + $extra;
    file_put_contents($progressFile, json_encode($payload), LOCK_EX);
    clearstatcache(true, $progressFile);
    $log("$step: $msg");
};

$log('START pid=' . getmypid() . ' user=' . $user . ' mode=' . $mode . ' endpoint=' . $endpoint);

// Bootstrap FreshRSS (follows cli/_cli.php pattern)
$freshRssRoot = dirname(dirname(__DIR__));
$log('FreshRSS root: ' . $freshRssRoot);

if (!file_exists($freshRssRoot . '/constants.php')) {
    $write('error', 'constants.php not found');
    exit(1);
}
require_once $freshRssRoot . '/constants.php';
$log('constants.php loaded');

require_once LIB_PATH . '/lib_rss.php';
$log('lib_rss.php loaded');

if (file_exists(LIB_PATH . '/lib_install.php')) {
    require_once LIB_PATH . '/lib_install.php';
}

try {
    Minz_Session::init('FreshRSS', true);
    FreshRSS_Context::initSystem();
    Minz_ExtensionManager::init();
    Minz_Translate::init(Minz_Translate::DEFAULT_LANGUAGE);
    $log('System context initialized');
} catch (Throwable $e) {
    $write('error', 'System init: ' . $e->getMessage());
    exit(1);
}

try {
    FreshRSS_Context::initUser($user);
    if (!FreshRSS_Context::hasUserConf()) {
        $write('error', 'User config not found for ' . $user);
        exit(1);
    }
    $ext_list = FreshRSS_Context::userConf()->extensions_enabled;
    Minz_ExtensionManager::enableByList($ext_list, 'user');
    $log('User context initialized: ' . $user);
} catch (Throwable $e) {
    $write('error', 'User init: ' . $e->getMessage());
    exit(1);
}

$helperPath = __DIR__ . '/FreshExtension_EinkPush_Helper.php';
if (!file_exists($helperPath)) {
    $write('error', 'Helper not found');
    exit(1);
}

require_once $helperPath;
$helper = new EinkPushHelper($epubDir, $screenWidth, $screenHeight, $fontSize, $readabilityUrl);
$log('Helper created');

// ============================================================
// CONNECTION TEST (push mode only)
// ============================================================
if ($mode === 'push') {
    $write('test_connection', 'Testing connection...');
    $connOk = $helper->checkDeviceStatus($endpoint);
    $log('Connection: ' . ($connOk ? 'OK' : 'FAIL'));

    if (!$connOk) {
        $write('error', 'Device unreachable at ' . $endpoint);
        exit(0);
    }
    $write('connection_ok', 'Device online');
}

// Step 2: Generate EPUBs
$totalSources = 0;
foreach ($sources as $_cfg) {
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
    $entries = $helper->collectForSource($key, $historyDays, $unreadOnly, $maxArticles);

    if (empty($entries)) {
        $write('source_empty', $label . ': no articles');
        continue;
    }

    $numEntries = count($entries);
    $totalArticles += $numEntries;
    $write('building', $label . ': ' . $numEntries . ' articles', ['source' => $label, 'articles' => $numEntries, 'totalAllArticles' => $totalArticles]);

    try {
        $log('buildEpub START: ' . $numEntries . ' entries, fetchContent=' . ($fetchContent ? 'yes' : 'no') . ', readability=' . ($readabilityUrl ?: 'none'));
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
        $log('buildEpub DONE: path=' . ($path ?: 'null'));
    } catch (Throwable $e) {
        $write('error', 'buildEpub failed: ' . $e->getMessage() . ' at ' . $e->getFile() . ':' . $e->getLine());
        exit(1);
    }

    $processedArticles += $numEntries;
    if ($path !== null) $paths[$key] = $path;
}

if (empty($paths)) {
    $write('no_content', 'No articles found');
    exit(0);
}

// Step 3: Push to device (push mode only)
if ($mode === 'push') {
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
        $write('done', 'Pushed ' . $success . ' EPUB(s)', ['success' => $success, 'generatedSources' => array_keys($paths)]);
    } else {
        $write('done_with_errors', $success . ' ok, ' . $failed . ' failed', ['success' => $success, 'failed' => $failed, 'generatedSources' => array_keys($paths)]);
    }
    $log('DONE success=' . $success . ' failed=' . $failed);
} else {
    $write('done', 'Generated ' . count($paths) . ' EPUB(s)', ['success' => count($paths), 'generatedSources' => array_keys($paths)]);
    $log('DONE generated=' . count($paths));
}

exit(0);
