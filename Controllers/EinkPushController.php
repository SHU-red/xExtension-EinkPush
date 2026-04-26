<?php
// OPcache bust: 2026-04-26 v2 - worker logging + endpoint fix
error_log('[EinkPush] EinkPushController.php is INCLUDED by PHP!');

class FreshExtension_EinkPush_Controller extends Minz_ActionController {

    private ?EinkPushExtension $extension;
    private ?EinkPushHelper $helper;

    public function firstAction(): void {
        $this->extension = Minz_ExtensionManager::findExtension('EinkPush');
        
        if (!$this->extension) {
            foreach (Minz_ExtensionManager::listExtensions() as $ext) {
                if ($ext instanceof EinkPushExtension) {
                    $this->extension = $ext;
                    break;
                }
            }
        }
        
        if (!$this->extension) {
            Minz_Error::error(404);
        }

        require_once $this->extension->getPath() . '/FreshExtension_EinkPush_Helper.php';

        $conf = $this->extension->getConfig();
        $this->helper = new EinkPushHelper(
            $this->extension->getEpubDir(),
            (int) $conf['screenWidth'],
            (int) $conf['screenHeight'],
            (float) $conf['fontSize'],
            (string) $conf['readability_url']
        );
    }

    private function getSourceConfig($sourceKey, $conf) {
        if (isset($conf['sources'][$sourceKey])) {
            return $conf['sources'][$sourceKey];
        }
        if ($sourceKey === 'favorites') {
            return ['enabled' => false, 'historyDays' => 7, 'unreadOnly' => true, 'markAsRead' => false, 'autoPush' => false, 'fetchContent' => true, 'addTimestamp' => false, 'maxArticles' => 50, 'removeFromFavorites' => false];
        }
        if ($sourceKey === 'main') {
            return ['enabled' => false, 'historyDays' => 7, 'unreadOnly' => true, 'markAsRead' => false, 'autoPush' => false, 'fetchContent' => true, 'addTimestamp' => false, 'maxArticles' => 50];
        }
        if (strpos($sourceKey, 'cat_') === 0) {
            return ['enabled' => false, 'historyDays' => 7, 'unreadOnly' => true, 'markAsRead' => false, 'autoPush' => false, 'fetchContent' => true, 'addTimestamp' => false, 'maxArticles' => 50];
        }
        return null;
    }

    public function generateAction(): void {
        error_log('[EinkPush] generateAction() called');
        $sourceKey = Minz_Request::param('source');
        $conf = $this->extension->getConfig();
        $isSilent = Minz_Request::param('silent') === '1';

        try {
            if ($sourceKey) {
                $srcCfg = $this->getSourceConfig($sourceKey, $conf);
                if (!$srcCfg) {
                    if ($isSilent) { header('HTTP/1.1 204 No Content'); exit; }
                    Minz_Request::bad(_t('ext.error_invalid_source'), ['c' => 'extension', 'a' => 'configure', 'params' => ['e' => 'EinkPush']]);
                }
                
                $path = $this->helper->generateSingle($sourceKey, $srcCfg);
                if ($path) {
                    $this->downloadFile($path);
                } else {
                    if ($isSilent) {
                        setcookie('ep_dl_' . $sourceKey, '1', time() + 60, '/');
                        setcookie('ep_dl_complete', '1', time() + 60, '/');
                        header('HTTP/1.1 204 No Content');
                        exit;
                    }
                    Minz_Request::good(_t('ext.msg_no_articles'), ['c' => 'extension', 'a' => 'configure', 'params' => ['e' => 'EinkPush']]);
                }
            } else {
                $paths = $this->helper->generateAll($conf['sources']);
                if (empty($paths)) {
                    if ($isSilent) {
                        setcookie('ep_dl_complete', '1', time() + 60, '/');
                        header('HTTP/1.1 204 No Content');
                        exit;
                    }
                    Minz_Request::good(_t('ext.msg_no_articles'), ['c' => 'extension', 'a' => 'configure', 'params' => ['e' => 'EinkPush']]);
                }
                
                $latest = $this->helper->getLatestEpub();
                if ($latest) $this->downloadFile($latest);
            }
        } catch (Exception $e) {
            if ($isSilent) {
                setcookie('ep_dl_error', rawurlencode($e->getMessage()), time() + 60, '/');
                setcookie('ep_dl_complete', '1', time() + 60, '/');
                if ($sourceKey) {
                    setcookie('ep_dl_' . $sourceKey, '1', time() + 60, '/');
                }
                header('HTTP/1.1 204 No Content');
                exit;
            }
            Minz_Request::bad($e->getMessage(), ['c' => 'extension', 'a' => 'configure', 'params' => ['e' => 'EinkPush']]);
        }
    }

    private function getEndpoint($conf) {
        $deviceAddress = rtrim((string)($conf['device_address'] ?? ''), '/');
        $folderName = ltrim((string)($conf['folder_name'] ?? 'RSSFeeds'), '/');
        return $deviceAddress . '/upload?path=/' . $folderName;
    }

    public function pushRunAction(): void {
        header('Content-Type: application/json');

        $conf = $this->extension->getConfig();
        $endpoint = $this->getEndpoint($conf);
        $singleSource = Minz_Request::param('source', '');

        if (empty($endpoint) || $endpoint === '/upload?path=/RSSFeeds') {
            echo json_encode(['status' => 'error', 'message' => _t('ext.error_no_endpoint')]);
            exit;
        }

        // Filter sources if single source requested
        $sourcesToProcess = $conf['sources'] ?? [];
        if ($singleSource !== '') {
            if (!isset($sourcesToProcess[$singleSource])) {
                echo json_encode(['status' => 'error', 'message' => _t('ext.error_invalid_source')]);
                exit;
            }
            $singleSrc = $sourcesToProcess[$singleSource];
            $singleSrc['enabled'] = true; // force enable for single source
            $sourcesToProcess = [$singleSource => $singleSrc];
        }

        $jobId = bin2hex(random_bytes(4));
        $progressFile = $this->extension->getEpubDir() . '.push_progress_' . $jobId . '.json';
        $epubDir = $this->extension->getEpubDir();
        $screenWidth = (int)($conf['screenWidth'] ?? 800);
        $screenHeight = (int)($conf['screenHeight'] ?? 600);
        $fontSize = (float)($conf['fontSize'] ?? 1.0);
        $readabilityUrl = trim((string)($conf['readability_url'] ?? ''));

        $bgConfig = [
            'jobId' => $jobId,
            'mode' => 'push',
            'endpoint' => $endpoint,
            'deviceAddress' => rtrim((string)($conf['device_address'] ?? ''), '/'),
            'folderName' => ltrim((string)($conf['folder_name'] ?? 'RSSFeeds'), '/'),
            'epubDir' => $epubDir,
            'sources' => $sourcesToProcess,
            'pushRetries' => (int)($conf['push_retries'] ?? 3),
            'pushRetryDelay' => (int)($conf['push_retryDelay'] ?? 5),
            'screenWidth' => $screenWidth,
            'screenHeight' => $screenHeight,
            'fontSize' => $fontSize,
            'readabilityUrl' => $readabilityUrl,
            'username' => FreshRSS_Context::$user ?? 'shur3d',
            'step' => 'starting',
            'message' => 'Starting...',
            'time' => microtime(true),
        ];
        file_put_contents($progressFile, json_encode($bgConfig), LOCK_EX);

        $workerFile = __DIR__ . '/../FreshExtension_EinkPush_Worker.php';
        $phpBin = PHP_BINARY ?: '/usr/bin/php';
        $cmd = '/bin/sh -c "nohup ' . escapeshellarg($phpBin) . ' ' . escapeshellarg($workerFile) . ' ' . escapeshellarg($progressFile) . ' > /tmp/einkpush_worker.log 2>&1 &"';
        error_log('[EinkPush] spawning worker: ' . $cmd);
        $output = [];
        $return = 0;
        exec($cmd, $output, $return);
        error_log('[EinkPush] worker spawn: return=' . $return . ' output=' . json_encode($output));

        echo json_encode(['status' => 'ok', 'job' => $jobId]);
        exit;
    }

    public function generateRunAction(): void {
        header('Content-Type: application/json');

        $conf = $this->extension->getConfig();
        $singleSource = Minz_Request::param('source', '');

        $sourcesToProcess = $conf['sources'] ?? [];
        if ($singleSource !== '') {
            if (!isset($sourcesToProcess[$singleSource])) {
                echo json_encode(['status' => 'error', 'message' => _t('ext.error_invalid_source')]);
                exit;
            }
            $singleSrc = $sourcesToProcess[$singleSource];
            $singleSrc['enabled'] = true;
            $sourcesToProcess = [$singleSource => $singleSrc];
        }

        $jobId = bin2hex(random_bytes(4));
        $progressFile = $this->extension->getEpubDir() . '.push_progress_' . $jobId . '.json';
        $epubDir = $this->extension->getEpubDir();
        $screenWidth = (int)($conf['screenWidth'] ?? 800);
        $screenHeight = (int)($conf['screenHeight'] ?? 600);
        $fontSize = (float)($conf['fontSize'] ?? 1.0);
        $readabilityUrl = trim((string)($conf['readability_url'] ?? ''));

        $bgConfig = [
            'jobId' => $jobId,
            'mode' => 'generate',
            'endpoint' => '',
            'epubDir' => $epubDir,
            'sources' => $sourcesToProcess,
            'pushRetries' => 0,
            'pushRetryDelay' => 0,
            'screenWidth' => $screenWidth,
            'screenHeight' => $screenHeight,
            'fontSize' => $fontSize,
            'readabilityUrl' => $readabilityUrl,
            'username' => FreshRSS_Context::$user ?? 'shur3d',
            'step' => 'starting',
            'message' => 'Starting...',
            'time' => microtime(true),
        ];
        file_put_contents($progressFile, json_encode($bgConfig), LOCK_EX);

        $workerFile = __DIR__ . '/../FreshExtension_EinkPush_Worker.php';
        $phpBin = PHP_BINARY ?: '/usr/bin/php';
        $cmd = '/bin/sh -c "nohup ' . escapeshellarg($phpBin) . ' ' . escapeshellarg($workerFile) . ' ' . escapeshellarg($progressFile) . ' > /tmp/einkpush_worker.log 2>&1 &"';
        error_log('[EinkPush] spawning generate worker: ' . $cmd);
        exec($cmd);

        echo json_encode(['status' => 'ok', 'job' => $jobId]);
        exit;
    }

    private function doPushWork(string $progressFile, array $conf, string $endpoint, EinkPushHelper $helper): void {
        set_time_limit(0);
        error_log('[EinkPush] doPushWork START pid=' . (function_exists('posix_getpid') ? posix_getpid() : 'unknown'));

        $writeProgress = function($step, $extra = []) use ($progressFile) {
            $payload = ['step' => $step, 'time' => microtime(true)] + $extra;
            file_put_contents($progressFile, json_encode($payload), LOCK_EX);
            clearstatcache(true, $progressFile);
        };

        // Step 1: Test connection
        $writeProgress('test_connection', ['message' => 'Testing connection...']);
        error_log('[EinkPush] checking device: ' . $endpoint);
        $connOk = $helper->checkDeviceStatus($endpoint);
        error_log('[EinkPush] checkDeviceStatus result: ' . ($connOk ? 'ok' : 'fail'));
        if (!$connOk) {
            $writeProgress('error', ['message' => 'Device unreachable']);
            return;
        }
        $writeProgress('connection_ok', ['message' => 'Device online']);

        // Step 2: Generate EPUBs
        $totalSources = 0;
        foreach ($conf['sources'] as $srcCfg) {
            if (!empty($srcCfg['enabled'])) $totalSources++;
        }

        $paths = [];
        $totalArticles = 0;
        $processedArticles = 0;
        $currentSource = 0;

        foreach ($conf['sources'] as $key => $srcCfg) {
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
            return;
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
            if ($helper->pushToEndpoint($path, $endpoint, $conf['push_retries'], $conf['push_retryDelay'], $sourceName)) $success++; else $failed++;
        }

        // Save last push time
        if ($failed === 0) {
            $uconf = FreshRSS_Context::$user_conf ?? null;
            if ($uconf) { $uconf->EinkPush_last_push = time(); $uconf->EinkPush_last_push_type = 'manual'; $uconf->save(); }
        }

        if ($failed === 0) {
            $writeProgress('done', ['success' => $success, 'message' => 'Successfully pushed ' . $success . ' EPUB(s).']);
        } else {
            $writeProgress('done_with_errors', ['success' => $success, 'failed' => $failed,
                'message' => 'Pushed ' . $success . ', but ' . $failed . ' failed.']);
        }
    }

    public function pushStatusAction(): void {
        header('Content-Type: application/json');
        $jobId = Minz_Request::param('job', '');
        if (empty($jobId)) { echo json_encode(['status' => 'error']); exit; }

        $progressFile = $this->extension->getEpubDir() . '.push_progress_' . $jobId . '.json';
        if (!file_exists($progressFile)) { echo json_encode(['status' => 'unknown']); exit; }

        $data = json_decode(file_get_contents($progressFile), true);
        if ($data) {
            $step = $data['step'] ?? '';
            // Update user config on successful push (worker can't write to DB)
            if ($step === 'done' && ($data['success'] ?? 0) > 0) {
                $uconf = FreshRSS_Context::$user_conf ?? null;
                if ($uconf) { $uconf->EinkPush_last_push = time(); $uconf->EinkPush_last_push_type = 'manual'; $uconf->save(); }
            }
            // Don't delete file for done states - return data until it expires naturally
            // (worker may finish faster than first poll fires)
            if ($step === 'error' && !isset($data['time'])) {
                @unlink($progressFile);
            }
        }
        echo json_encode($data ?: ['step' => 'unknown']);
        exit;
    }

    public function pushAction(): void {
        $conf = $this->extension->getConfig();
        $endpoint = $this->getEndpoint($conf);
        $redirect = Minz_Request::param('r', '');
        $isSilent = Minz_Request::param('silent') === '1';
        $target = ['c' => 'extension', 'a' => 'configure', 'params' => ['e' => 'EinkPush']];
        if ($redirect === 'main') {
            $target = ['c' => 'index', 'a' => 'index'];
        }

        if (empty($endpoint)) {
            if ($isSilent) { header('Content-Type: application/json'); echo json_encode(['status' => 'error', 'message' => _t('ext.error_no_endpoint')]); exit; }
            Minz_Request::bad(_t('ext.error_no_endpoint'), $target);
        }

        try {
            $paths = $this->helper->generateAll($conf['sources']);
            if (empty($paths)) {
                if ($isSilent) { header('HTTP/1.1 204 No Content'); exit; }
                Minz_Request::good(_t('ext.msg_no_articles'), $target);
            }

            $success = 0; $failed = 0;
            foreach ($paths as $sourceKey => $path) {
                $sourceName = $sourceKey === 'favorites' ? _t('ext.source_favorites') : $sourceKey;
                if ($this->helper->pushToEndpoint($path, $endpoint, $conf['push_retries'], $conf['push_retryDelay'], $sourceName)) $success++;
                else $failed++;
            }

            if ($failed === 0) {
                $conf = FreshRSS_Context::$user_conf;
                if ($conf) {
                    $conf->EinkPush_last_push = time();
                    $conf->EinkPush_last_push_type = 'manual';
                    $conf->save();
                }
                if ($isSilent) { header('Content-Type: application/json'); echo json_encode(['status' => 'ok', 'message' => _t('ext.msg_push_success', $success)]); exit; }
                Minz_Request::good(_t('ext.msg_push_success', $success), $target);
            } else {
                if ($isSilent) { header('Content-Type: application/json'); echo json_encode(['status' => 'error', 'message' => _t('ext.msg_push_failed', $success, $failed)]); exit; }
                Minz_Request::bad(_t('ext.msg_push_failed', $success, $failed), $target);
            }
        } catch (Exception $e) {
            if ($isSilent) { header('Content-Type: application/json'); echo json_encode(['status' => 'error', 'message' => $e->getMessage()]); exit; }
            Minz_Request::bad($e->getMessage(), $target);
        }
    }

    public function pushSingleAction(): void {
        $sourceKey = Minz_Request::param('source');
        $conf = $this->extension->getConfig();
        $endpoint = $this->getEndpoint($conf);
        $isSilent = Minz_Request::param('silent') === '1';

        if (empty($endpoint)) {
            if ($isSilent) { header('Content-Type: application/json'); echo json_encode(['status' => 'error', 'message' => _t('ext.error_no_endpoint')]); exit; }
            Minz_Request::bad(_t('ext.error_no_endpoint'), ['c' => 'extension', 'a' => 'configure', 'params' => ['e' => 'EinkPush']]);
        }

        $srcCfg = $this->getSourceConfig($sourceKey, $conf);
        if (!$srcCfg) {
            if ($isSilent) { header('Content-Type: application/json'); echo json_encode(['status' => 'error', 'message' => _t('ext.error_invalid_source')]); exit; }
            Minz_Request::bad(_t('ext.error_invalid_source'), ['c' => 'extension', 'a' => 'configure', 'params' => ['e' => 'EinkPush']]);
        }

        try {
            $path = $this->helper->generateSingle($sourceKey, $srcCfg);
            if (!$path) {
                if ($isSilent) { header('HTTP/1.1 204 No Content'); exit; }
                Minz_Request::good(_t('ext.msg_no_articles'), ['c' => 'extension', 'a' => 'configure', 'params' => ['e' => 'EinkPush']]);
            }

            $sourceName = $sourceKey === 'favorites' ? _t('ext.source_favorites') : $sourceKey;
            if ($this->helper->pushToEndpoint($path, $endpoint, $conf['push_retries'], $conf['push_retryDelay'], $sourceName)) {
                $uconf = FreshRSS_Context::$user_conf;
                if ($uconf) {
                    $uconf->EinkPush_last_push = time();
                    $uconf->EinkPush_last_push_type = 'manual';
                    $uconf->save();
                }
                if ($isSilent) { header('Content-Type: application/json'); echo json_encode(['status' => 'ok', 'message' => _t('ext.msg_push_success_single')]); exit; }
                Minz_Request::good(_t('ext.msg_push_success_single'), ['c' => 'extension', 'a' => 'configure', 'params' => ['e' => 'EinkPush']]);
            } else {
                if ($isSilent) { header('Content-Type: application/json'); echo json_encode(['status' => 'error', 'message' => _t('ext.msg_push_failed_single')]); exit; }
                Minz_Request::bad(_t('ext.msg_push_failed_single'), ['c' => 'extension', 'a' => 'configure', 'params' => ['e' => 'EinkPush']]);
            }
        } catch (Exception $e) {
            if ($isSilent) { header('Content-Type: application/json'); echo json_encode(['status' => 'error', 'message' => $e->getMessage()]); exit; }
            Minz_Request::bad($e->getMessage(), ['c' => 'extension', 'a' => 'configure', 'params' => ['e' => 'EinkPush']]);
        }
    }

    public function clearHistoryAction(): void {
        $this->helper->clearHistory();
        Minz_Request::good(_t('ext.msg_history_cleared'), ['c' => 'extension', 'a' => 'configure', 'params' => ['e' => 'EinkPush']]);
    }

    public function regenerateTokenAction(): void {
        $conf = FreshRSS_Context::$user_conf;
        if ($conf) {
            $conf->EinkPush_push_token = bin2hex(random_bytes(16));
            $conf->save();
            Minz_Request::good(_t('ext.api_regenerate'), ['c' => 'extension', 'a' => 'configure', 'params' => ['e' => 'EinkPush']]);
        }
    }

    public function testEndpointAction(): void {
        $conf = $this->extension->getConfig();
        $endpoint = $this->getEndpoint($conf);
        $isSilent = Minz_Request::param('silent') === '1';

        if (empty($endpoint) || $endpoint === '/upload?path=/RSSFeeds') {
            if ($isSilent) { header('Content-Type: application/json'); echo json_encode(['status' => 'error', 'message' => _t('ext.error_no_endpoint')]); exit; }
            Minz_Request::bad(_t('ext.error_no_endpoint'), ['c' => 'extension', 'a' => 'configure', 'params' => ['e' => 'EinkPush']]);
        }

        // Create a dummy EPUB for testing
        $testPath = $this->extension->getEpubDir() . 'test_connection.epub';
        file_put_contents($testPath, 'Test EPUB content');

        if ($this->helper->pushToEndpoint($testPath, $endpoint, 1, 1, 'Connection Test')) {
            // On successful push, also fetch device status
            $deviceAddress = $conf['device_address'] ?? 'http://crosspoint.local';
            $statusUrl = rtrim($deviceAddress, '/') . '/api/status';
            
            $deviceInfo = null;
            try {
                // Use cURL for better error handling and CSP compliance
                $ch = curl_init();
                curl_setopt($ch, CURLOPT_URL, $statusUrl);
                curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
                curl_setopt($ch, CURLOPT_TIMEOUT, 5);
                curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
                curl_setopt($ch, CURLOPT_USERAGENT, 'EinkPush/1.0');
                curl_setopt($ch, CURLOPT_HTTPHEADER, ['Accept: application/json']);
                
                $statusResponse = curl_exec($ch);
                $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
                curl_close($ch);
                
                if ($statusResponse !== false && $httpCode === 200) {
                    $deviceInfo = json_decode($statusResponse, true);
                }
            } catch (Exception $e) {
                error_log('[EinkPush] Failed to fetch device status: ' . $e->getMessage());
            }
            
            if ($isSilent) { 
                header('Content-Type: application/json'); 
                $response = ['status' => 'ok', 'message' => _t('ext.push_test_sent')];
                if ($deviceInfo) {
                    $response['deviceInfo'] = $deviceInfo;
                }
                echo json_encode($response);
                exit; 
            }
            Minz_Request::good(_t('ext.push_test_sent'), ['c' => 'extension', 'a' => 'configure', 'params' => ['e' => 'EinkPush']]);
        } else {
            if ($isSilent) { header('Content-Type: application/json'); echo json_encode(['status' => 'error', 'message' => _t('ext.push_test_failed', 'Check logs')]); exit; }
            Minz_Request::bad(_t('ext.push_test_failed', 'Check logs'), ['c' => 'extension', 'a' => 'configure', 'params' => ['e' => 'EinkPush']]);
        }
        @unlink($testPath);
    }

    public function downloadFileAction(): void {
        $sourceKey = Minz_Request::param('source', '');
        if (empty($sourceKey)) {
            header('HTTP/1.1 400 Bad Request');
            exit;
        }
        $epubDir = $this->extension->getEpubDir();
        $label = $this->helper->sourceLabel($sourceKey);
        $pattern = $epubDir . '*' . preg_quote($label, '/') . '*.epub';
        $files = glob($pattern);
        if (empty($files)) {
            // Try without label
            $pattern = $epubDir . '*' . preg_quote($sourceKey, '/') . '*.epub';
            $files = glob($pattern);
        }
        if (empty($files)) {
            header('HTTP/1.1 404 Not Found');
            exit;
        }
        $path = max($files, function($a, $b) { return filemtime($a) - filemtime($b); });
        $this->downloadFile($path);
    }

    public function previewAction(): void {
        $sourceKey = Minz_Request::param('source');
        $conf = $this->extension->getConfig();
        $srcCfg = $this->getSourceConfig($sourceKey, $conf);
        
        if (!$srcCfg) {
            echo 'Invalid source';
            exit;
        }

        require_once $this->extension->getPath() . '/FreshExtension_EinkPush_Helper.php';
        $entries = $this->helper->collectForSource($sourceKey, 30, false);
        
        if (empty($entries)) {
            echo 'No articles found in this source.';
            exit;
        }

        $entry = $entries[0];
        $content = $entry->content(true);
        $title = $entry->title();
        $url = method_exists($entry, 'link') ? $entry->link() : '';

        $fetchResult = null;
        if ($srcCfg['fetchContent'] && !empty($conf['readability_url'])) {
            $fetchResult = $this->helper->fetchViaReadability($url);
            if ($fetchResult['ok']) {
                $content = $fetchResult['html'];
            }
        }

        $html = '<h2>' . htmlspecialchars($title) . '</h2>';
        if ($fetchResult && !$fetchResult['ok']) {
            $html .= '<div style="background:#fee;padding:10px;border:1px solid #f99;margin-bottom:15px;">';
            $html .= '<strong>Readability Error:</strong> ' . htmlspecialchars($fetchResult['error']);
            if (!empty($fetchResult['debug'])) {
                $html .= '<br><small>' . htmlspecialchars($fetchResult['debug']) . '</small>';
            }
            $html .= '</div>';
        }
        $html .= '<div class="preview-content">' . $content . '</div>';
        
        echo $html;
        exit;
    }

    public function apiAction(): void {
        $token = Minz_Request::param('token');
        $conf = $this->extension->getConfig();
        
        if (empty($token) || $token !== $conf['push_token']) {
            Minz_Error::error(403);
        }

        $action = Minz_Request::param('action', 'push'); // 'push' or 'download'
        $sourceKey = Minz_Request::param('source', 'all'); // 'all', 'favorites', 'cat_1', etc.

        if ($action === 'download') {
            if ($sourceKey === 'all') {
                $paths = $this->helper->generateAll($conf['sources']);
                if (empty($paths)) {
                    header('Content-Type: application/json');
                    echo json_encode(['status' => 'error', 'message' => 'No articles found']);
                    exit;
                }
                $latest = $this->helper->getLatestEpub();
                if ($latest) $this->downloadFile($latest);
            } else {
                $srcCfg = $this->getSourceConfig($sourceKey, $conf);
                if (!$srcCfg) {
                    header('Content-Type: application/json');
                    echo json_encode(['status' => 'error', 'message' => 'Invalid source']);
                    exit;
                }
                $path = $this->helper->generateSingle($sourceKey, $srcCfg);
                if ($path) $this->downloadFile($path);
                else {
                    header('Content-Type: application/json');
                    echo json_encode(['status' => 'error', 'message' => 'No articles found']);
                    exit;
                }
            }
        } else {
            // Default: Push
            $endpoint = $this->getEndpoint($conf);
            if (empty($endpoint) || $endpoint === '/upload?path=/RSSFeeds') {
                header('Content-Type: application/json');
                echo json_encode(['status' => 'error', 'message' => 'No endpoint configured']);
                exit;
            }

            if ($sourceKey === 'all') {
                $paths = $this->helper->generateAll($conf['sources']);
                if (empty($paths)) {
                    header('Content-Type: application/json');
                    echo json_encode(['status' => 'ok', 'message' => 'No articles found']);
                    exit;
                }
                $success = 0; $failed = 0;
                foreach ($paths as $sk => $path) {
                    $sourceName = $sk === 'favorites' ? _t('ext.source_favorites') : $sk;
                    if ($this->helper->pushToEndpoint($path, $endpoint, $conf['push_retries'], $conf['push_retryDelay'], $sourceName)) $success++;
                    else $failed++;
                }
                if ($success > 0) {
                    $uconf = FreshRSS_Context::$user_conf;
                    if ($uconf) {
                        $uconf->EinkPush_last_push = time();
                        $uconf->EinkPush_last_push_type = 'manual';
                        $uconf->save();
                    }
                }
                header('Content-Type: application/json');
                echo json_encode(['status' => 'ok', 'success' => $success, 'failed' => $failed]);
                exit;
            } else {
                $srcCfg = $this->getSourceConfig($sourceKey, $conf);
                if (!$srcCfg) {
                    header('Content-Type: application/json');
                    echo json_encode(['status' => 'error', 'message' => 'Invalid source']);
                    exit;
                }
                $path = $this->helper->generateSingle($sourceKey, $srcCfg);
                if (!$path) {
                    header('Content-Type: application/json');
                    echo json_encode(['status' => 'ok', 'message' => 'No articles found']);
                    exit;
                }
                $sourceName = $sourceKey === 'favorites' ? _t('ext.source_favorites') : $sourceKey;
                $res = $this->helper->pushToEndpoint($path, $endpoint, $conf['push_retries'], $conf['push_retryDelay'], $sourceName);
                if ($res) {
                    $uconf = FreshRSS_Context::$user_conf;
                    if ($uconf) {
                        $uconf->EinkPush_last_push = time();
                        $uconf->EinkPush_last_push_type = 'manual';
                        $uconf->save();
                    }
                }
                header('Content-Type: application/json');
                echo json_encode(['status' => $res ? 'ok' : 'error']);
                exit;
            }
        }
    }

    private function downloadFile(string $path, string $mimeType = 'application/epub+zip') {
        $filename = basename($path);
        $sourceKey = Minz_Request::param('source', 'unknown');
        setcookie('ep_dl_' . $sourceKey, '1', time() + 60, '/');
        setcookie('ep_dl_complete', '1', time() + 60, '/');
        header('Content-Type: ' . $mimeType);
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        header('Content-Length: ' . filesize($path));
        readfile($path);
        exit;
    }
}
