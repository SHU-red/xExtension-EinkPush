<?php
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

    public function pushAction(): void {
        $conf = $this->extension->getConfig();
        $endpoint = $conf['push_endpoint'];
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
        $endpoint = $conf['push_endpoint'];
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
        $endpoint = $conf['push_endpoint'];
        $isSilent = Minz_Request::param('silent') === '1';
        
        if (empty($endpoint)) {
            if ($isSilent) { header('Content-Type: application/json'); echo json_encode(['status' => 'error', 'message' => _t('ext.error_no_endpoint')]); exit; }
            Minz_Request::bad(_t('ext.error_no_endpoint'), ['c' => 'extension', 'a' => 'configure', 'params' => ['e' => 'EinkPush']]);
        }

        // Create a dummy EPUB for testing
        $testPath = $this->extension->getEpubDir() . 'test_connection.epub';
        file_put_contents($testPath, 'Test EPUB content');

        if ($this->helper->pushToEndpoint($testPath, $endpoint, 1, 1, 'Connection Test')) {
            if ($isSilent) { header('Content-Type: application/json'); echo json_encode(['status' => 'ok', 'message' => _t('ext.push_test_sent')]); exit; }
            Minz_Request::good(_t('ext.push_test_sent'), ['c' => 'extension', 'a' => 'configure', 'params' => ['e' => 'EinkPush']]);
        } else {
            if ($isSilent) { header('Content-Type: application/json'); echo json_encode(['status' => 'error', 'message' => _t('ext.push_test_failed', 'Check logs')]); exit; }
            Minz_Request::bad(_t('ext.push_test_failed', 'Check logs'), ['c' => 'extension', 'a' => 'configure', 'params' => ['e' => 'EinkPush']]);
        }
        @unlink($testPath);
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
            $endpoint = $conf['push_endpoint'];
            if (empty($endpoint)) {
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
