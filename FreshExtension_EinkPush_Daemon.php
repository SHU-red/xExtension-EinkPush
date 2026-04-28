#!/usr/bin/env php
<?php
/**
 * EinkPush Daemon — runs auto-push independent of page loads.
 *
 * Usage: php FreshExtension_EinkPush_Daemon.php
 *
 * PID file: /tmp/einkpush_daemon.pid
 * Log:      /tmp/einkpush_daemon.log
 */

$pidFile = '/tmp/einkpush_daemon.pid';

if (file_exists($pidFile)) {
    $oldPid = intval(trim(file_get_contents($pidFile)));
    if ($oldPid > 0 && posix_kill($oldPid, 0)) {
        exit(1);
    }
    unlink($pidFile);
}

file_put_contents($pidFile, getmypid());
register_shutdown_function(function() use ($pidFile) {
    @unlink($pidFile);
});

$log = function($msg) {
    file_put_contents('/tmp/einkpush_daemon.log', date('H:i:s') . ' ' . $msg . "\n", FILE_APPEND | LOCK_EX);
};

$log('START pid=' . getmypid());

// Bootstrap FreshRSS
$freshrssRoot = dirname(dirname(__DIR__));
if ($freshrssRoot === '/' || $freshrssRoot === '.') {
    $freshrssRoot = '/var/www/FreshRSS';
}
$constantsFile = $freshrssRoot . '/constants.php';
if (file_exists($constantsFile)) require_once $constantsFile;
if (!defined('APP_PATH')) define('APP_PATH', $freshrssRoot . '/app/');
if (!defined('LIB_PATH')) define('LIB_PATH', $freshrssRoot . '/lib/');
if (!defined('EXTENSIONS_PATH')) define('EXTENSIONS_PATH', $freshrssRoot . '/extensions/');
if (!defined('DATA_PATH')) define('DATA_PATH', $freshrssRoot . '/data/');
if (!defined('USERS_PATH')) define('USERS_PATH', $freshrssRoot . '/data/users/');
if (!defined('FEED_TYPES')) define('FEED_TYPES', '');

$log('FreshRSS root: ' . $freshrssRoot);
$log('LIB_PATH: ' . (defined('LIB_PATH') ? LIB_PATH : 'NOT SET'));

if (!function_exists('_t')) {
    function _t($key, ...$args) { return $key; }
}

require_once rtrim(LIB_PATH, '/') . '/lib_rss.php';

// Find user with EinkPush
$user = '';
$ud = $freshrssRoot . '/data/users/';
if ($dh = opendir($ud)) {
    while (($e = readdir($dh)) !== false) {
        if ($e !== '.' && $e !== '..' && is_dir($ud . $e . '/EinkPush')) {
            $user = $e; break;
        }
    }
    closedir($dh);
}
if (!$user) exit(1);

$log('User: ' . $user);
FreshRSS_Context::initUser($user);
$conf = FreshRSS_Context::$user_conf;
$pingIntervalMin = (int)($conf->EinkPush_ping_interval ?? 5);
$cooldownH = (int)($conf->EinkPush_push_cooldown ?? 20);
require_once __DIR__ . '/FreshExtension_EinkPush_Helper.php';

while (true) {
    // Reload config each cycle
    FreshRSS_Context::initUser($user);
    $conf = FreshRSS_Context::$user_conf;

    $autoOn = !empty($conf->EinkPush_auto_push_enabled);
    $endpoint = $conf->EinkPush_push_endpoint ?? '';

    if (!$autoOn || !$endpoint) {
        sleep(60);
        continue;
    }

    $pingInt = (int)($conf->EinkPush_ping_interval ?? $pingIntervalMin) * 60;
    $cooldown = (int)($conf->EinkPush_push_cooldown ?? $cooldownH) * 3600;
    $lastPush = (int)($conf->EinkPush_last_push ?? 0);
    $lastPing = (int)($conf->EinkPush_last_ping ?? 0);

    $now = time();
    $cooldownOk = ($now - $lastPush) >= $cooldown;

    if (!$cooldownOk) {
        // Sleep until cooldown expires
        $rem = $cooldown - ($now - $lastPush);
        sleep($rem);
        continue;
    }

    // Sleep until ping interval expires
    $nextPing = $lastPing + $pingInt;
    $sleepUntil = $nextPing - $now;
    if ($sleepUntil > 0) {
        sleep($sleepUntil);
        continue;
    }

    $log('Ping...');
    $conf->EinkPush_last_ping = $now;
    $conf->save();

    $ud = USERS_PATH . '/' . $user . '/EinkPush/';
    if (!is_dir($ud)) mkdir($ud, 0770, true);

    $helper = new EinkPushHelper(
        $ud,
        max(100, (int)($conf->EinkPush_screenWidth ?? 480)),
        max(100, (int)($conf->EinkPush_screenHeight ?? 800)),
        max(0.5, min(3.0, (float)($conf->EinkPush_fontSize ?? 1.0))),
        $conf->EinkPush_readability_url ?? ''
    );

    $status = $helper->checkDeviceStatus($endpoint);
    if ($status !== false) {
        $conf->EinkPush_last_ping_status = 'online';
        $conf->EinkPush_device_info = $status;
        $conf->save();
        $log('Device online');

        $sources = $conf->EinkPush_sources ?? [];
        $paths = $helper->generateAll($sources);

        if (!empty($paths)) {
            $ok = 0; $fail = 0;
            $ret = max(0, (int)($conf->EinkPush_push_retries ?? 3));

            foreach ($paths as $k => $p) {
                $sc = $sources[$k] ?? [];
                if (empty($sc['autoPush'])) continue;
                $nm = $k === 'favorites' ? 'Favorites' : $k;
                if ($helper->pushToEndpoint($p, $endpoint, $ret, 5, $nm)) {
                    $ok++;
                } else {
                    $fail++;
                }
            }

            $conf->EinkPush_last_push = time();
            $conf->EinkPush_last_push_type = 'auto';
            $conf->EinkPush_last_push_status = $fail > 0 ? 'partial' : 'success';
            $conf->save();
            $log("Pushed $ok ok $fail fail");
        }
    } else {
        $conf->EinkPush_last_ping_status = 'offline';
        $conf->save();
        $log('Device offline');
    }
}


