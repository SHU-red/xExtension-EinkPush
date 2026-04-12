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
                if ($isSilent) { header('HTTP/1.1 204 No Content'); exit; }
                Minz_Request::good(_t('ext.msg_no_articles'), ['c' => 'extension', 'a' => 'configure', 'params' => ['e' => 'EinkPush']]);
            }
        } else {
            $paths = $this->helper->generateAll($conf['sources']);
            if (empty($paths)) {
                if ($isSilent) { header('HTTP/1.1 204 No Content'); exit; }
                Minz_Request::good(_t('ext.msg_no_articles'), ['c' => 'extension', 'a' => 'configure', 'params' => ['e' => 'EinkPush']]);
            }
            
            $latest = $this->helper->getLatestEpub();
            if ($latest) $this->downloadFile($latest);
        }
    }

    public function pushAction(): void {
        $conf = $this->extension->getConfig();
        $endpoint = $conf['push_endpoint'];
        if (empty($endpoint)) Minz_Request::bad(_t('ext.error_no_endpoint'), ['c' => 'extension', 'a' => 'configure', 'params' => ['e' => 'EinkPush']]);

        $paths = $this->helper->generateAll($conf['sources']);
        if (empty($paths)) Minz_Request::good(_t('ext.msg_no_articles'), ['c' => 'extension', 'a' => 'configure', 'params' => ['e' => 'EinkPush']]);

        $success = 0; $failed = 0;
        foreach ($paths as $sourceKey => $path) {
            $sourceName = $sourceKey === 'favorites' ? _t('ext.source_favorites') : $sourceKey;
            if ($this->helper->pushToEndpoint($path, $endpoint, $conf['push_retries'], $conf['push_retryDelay'], $sourceName)) $success++;
            else $failed++;
        }

        if ($failed === 0) Minz_Request::good(_t('ext.msg_push_success', $success), ['c' => 'extension', 'a' => 'configure', 'params' => ['e' => 'EinkPush']]);
        else Minz_Request::bad(_t('ext.msg_push_failed', $success, $failed), ['c' => 'extension', 'a' => 'configure', 'params' => ['e' => 'EinkPush']]);
    }

    public function pushSingleAction(): void {
        $sourceKey = Minz_Request::param('source');
        $conf = $this->extension->getConfig();
        $endpoint = $conf['push_endpoint'];

        if (empty($endpoint)) Minz_Request::bad(_t('ext.error_no_endpoint'), ['c' => 'extension', 'a' => 'configure', 'params' => ['e' => 'EinkPush']]);

        $srcCfg = $this->getSourceConfig($sourceKey, $conf);
        if (!$srcCfg) Minz_Request::bad(_t('ext.error_invalid_source'), ['c' => 'extension', 'a' => 'configure', 'params' => ['e' => 'EinkPush']]);

        $path = $this->helper->generateSingle($sourceKey, $srcCfg);
        if (!$path) Minz_Request::good(_t('ext.msg_no_articles'), ['c' => 'extension', 'a' => 'configure', 'params' => ['e' => 'EinkPush']]);

        $sourceName = $sourceKey === 'favorites' ? _t('ext.source_favorites') : $sourceKey;
        if ($this->helper->pushToEndpoint($path, $endpoint, $conf['push_retries'], $conf['push_retryDelay'], $sourceName)) {
            Minz_Request::good(_t('ext.msg_push_success_single'), ['c' => 'extension', 'a' => 'configure', 'params' => ['e' => 'EinkPush']]);
        } else {
            Minz_Request::bad(_t('ext.msg_push_failed_single'), ['c' => 'extension', 'a' => 'configure', 'params' => ['e' => 'EinkPush']]);
        }
    }

    public function clearHistoryAction(): void {
        $this->helper->clearHistory();
        Minz_Request::good(_t('ext.msg_history_cleared'), ['c' => 'extension', 'a' => 'configure', 'params' => ['e' => 'EinkPush']]);
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
                header('Content-Type: application/json');
                echo json_encode(['status' => $res ? 'ok' : 'error']);
                exit;
            }
        }
    }

    private function downloadFile(string $path) {
        $filename = basename($path);
        header('Content-Type: application/epub+zip');
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        header('Content-Length: ' . filesize($path));
        readfile($path);
        exit;
    }
}
