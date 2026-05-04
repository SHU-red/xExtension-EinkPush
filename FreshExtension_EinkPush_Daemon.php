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
    $alive = false;
    if ($oldPid > 0 && function_exists('posix_kill')) {
        $alive = posix_kill($oldPid, 0);
    } elseif ($oldPid > 0) {
        $alive = file_exists("/proc/$oldPid");
    }
    if ($alive) {
        exit(1);
    }
    unlink($pidFile);
}

file_put_contents($pidFile, getmypid());

$statusFile = '/tmp/einkpush_daemon_status.json';
$writeStatus = function($state, $nextAction, $msg = '') {
    global $statusFile;
    file_put_contents($statusFile, json_encode([
        'state' => $state,
        'next'  => $nextAction,
        'msg'   => $msg,
        'time'  => time(),
    ], JSON_UNESCAPED_SLASHES));
};

register_shutdown_function(function() use ($pidFile, $statusFile) {
    @unlink($pidFile);
    @unlink($statusFile);
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
FreshRSS_Context::initSystem();
FreshRSS_Context::initUser($user);
$conf = FreshRSS_Context::$user_conf;
$pingIntervalMin = (int)($conf->EinkPush_ping_interval ?? 5);
$cooldownH = (int)($conf->EinkPush_push_cooldown ?? 20);
require_once __DIR__ . '/FreshExtension_EinkPush_Helper.php';

// Lock file to prevent multiple daemon instances
$lockFile = '/tmp/einkpush_daemon.lock';
$lockFP = fopen($lockFile, 'c');
if (!$lockFP || !flock($lockFP, LOCK_EX | LOCK_NB)) {
    $log('Another daemon already running, exiting');
    exit(0);
}

while (true) {
    // Reload config each cycle
    FreshRSS_Context::initSystem();
    FreshRSS_Context::initUser($user);
    $conf = FreshRSS_Context::$user_conf;

    $autoOn = (int)($conf->EinkPush_auto_push_enabled) > 0;
    $endpoint = (string)($conf->EinkPush_push_endpoint ?? '');

    if (!$autoOn || !$endpoint) {
        $writeStatus('off', 0, 'Auto-push disabled');
        $log('Auto-push=' . ($autoOn ? 'on' : 'off') . ' endpoint=' . ($endpoint ? 'set' : 'none'));
        sleep(60);
        continue;
    }

    $pingInt = (int)($conf->EinkPush_ping_interval ?? $pingIntervalMin) * 60;
    $cooldown = (int)($conf->EinkPush_push_cooldown ?? $cooldownH) * 3600;
    $lastPush = (int)($conf->EinkPush_last_push ?? 0);
    $lastPing = (int)($conf->EinkPush_last_ping ?? 0);
    $now = time();

    // last_ping=0 means "just re-enabled, ping now"
    if ($lastPing === 0) {
        $lastPing = $now - $pingInt; // force nextPing to be due immediately
    }

    $cooldownOk = ($now - $lastPush) >= $cooldown;
    // last_push=0 means "just re-enabled, skip cooldown"
    if (!$cooldownOk && $lastPush === 0) {
        $cooldownOk = true;
    }
    if (!$cooldownOk) {
        $rem = $cooldown - ($now - $lastPush);
        $writeStatus('cooldown', $lastPush + $cooldown, 'Push cooldown');
        $log('Cooldown: ' . gmdate('H:i:s', $rem) . ' remaining');
        sleep($rem);
        continue;
    }

    $nextPing = $lastPing + $pingInt;
    $sleepUntil = $nextPing - $now;
    if ($sleepUntil > 0) {
        $writeStatus('countdown', $nextPing, 'Next ping');
        $log('Ping in: ' . gmdate('H:i:s', $sleepUntil));
        sleep($sleepUntil);
        continue;
    }

    $conf->EinkPush_last_ping = $now;
    $conf->save();

    $writeStatus('pinging', 0, 'Pinging device...');
    $log('Pinging device...');

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

        $writeStatus('generating', 0, 'Generating EPUBs...');
        $sources = $conf->EinkPush_sources ?? [];
        $paths = $helper->generateAll($sources);

        if (!empty($paths)) {
            $writeStatus('pushing', 0, 'Pushing to device...');
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
            $writeStatus('pushing', 0, ($ok > 0 ? $ok . ' pushed' : 'Push failed'));
        } else {
            $writeStatus('generating', 0, 'No articles');
        }
    } else {
        $conf->EinkPush_last_ping_status = 'offline';
        $conf->save();
        $log('Device offline');
        $writeStatus('pinging', 0, 'Device offline');
    }
}


