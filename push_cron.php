#!/usr/bin/env php
<?php
/**
 * EinkPush Cron Script — generate and push EPUBs to a remote endpoint.
 *
 * Usage:
 *   php push_cron.php --user=USERNAME
 *
 * Add to crontab (e.g. daily at 06:00):
 *   0 6 * * * php /var/www/FreshRSS/extensions/xExtension-EinkPush2/push_cron.php --user=USERNAME
 */

$options = getopt('', ['user:']);
if (empty($options['user'])) {
    fwrite(STDERR, "Usage: php push_cron.php --user=USERNAME\n");
    exit(1);
}

// Bootstrap FreshRSS (extension sits in extensions/xExtension-EinkPush2/)
$freshrssRoot = dirname(__DIR__, 2);
$cliBootstrap = $freshrssRoot . '/cli/_cli.php';
if (!file_exists($cliBootstrap)) {
    fwrite(STDERR, "Error: Cannot find FreshRSS at {$freshrssRoot}\n");
    exit(1);
}
require($cliBootstrap);

$username = $options['user'];

// Initialize user context
if (function_exists('FreshRSS_Context::initUser')) {
    FreshRSS_Context::initUser($username);
} else {
    Minz_User::change($username);
    FreshRSS_Context::init();
}

if (FreshRSS_Context::$user_conf === null) {
    fwrite(STDERR, "Error: Unknown user '{$username}'\n");
    exit(1);
}

require_once __DIR__ . '/FreshExtension_EinkPush_Helper.php';

$conf     = FreshRSS_Context::$user_conf;
$sources  = $conf->EinkPush_sources ?? [];
$endpoint = $conf->EinkPush_push_endpoint ?? '';
$retries  = max(0, (int) ($conf->EinkPush_push_retries ?? 3));
$delay    = max(1, (int) ($conf->EinkPush_push_retryDelay ?? 10));

if ($endpoint === '') {
    fwrite(STDERR, "Error: No push endpoint configured for user '{$username}'.\n");
    exit(1);
}

// Output directory
$userDataDir = USERS_PATH . '/' . $username . '/EinkPush2/';
if (!is_dir($userDataDir)) {
    mkdir($userDataDir, 0770, true);
}

$helper = new EinkPushHelper(
    $userDataDir,
    max(100, (int) ($conf->EinkPush_screenWidth ?? 480)),
    max(100, (int) ($conf->EinkPush_screenHeight ?? 800)),
    max(0.5, min(3.0, (float) ($conf->EinkPush_fontSize ?? 1.0))),
    $conf->EinkPush_readability_url ?? ''
);

// Collect push-enabled sources
$pushSources = [];
foreach ($sources as $key => $srcCfg) {
    if (!empty($srcCfg['autoPush'])) {
        $pushSources[$key] = $srcCfg;
    }
}

if (empty($pushSources)) {
    echo "No sources configured for auto-push.\n";
    exit(0);
}

$success = 0;
$failed  = 0;

foreach ($pushSources as $key => $srcCfg) {
    $path = $helper->generateSingle($key, $srcCfg);
    if ($path === null) {
        echo "[{$key}] No articles found, skipping.\n";
        continue;
    }

    echo "[{$key}] Generated: " . basename($path) . "\n";

    $sourceName = $key === 'favorites' ? 'Favorites' : $key;
    if ($helper->pushToEndpoint($path, $endpoint, $retries, $delay, $sourceName)) {
        echo "[{$key}] Pushed successfully.\n";
        $success++;
    } else {
        fwrite(STDERR, "[{$key}] Push FAILED after {$retries} retries.\n");
        $failed++;
    }
}

echo "\nDone: {$success} pushed, {$failed} failed.\n";
exit($failed > 0 ? 1 : 0);
