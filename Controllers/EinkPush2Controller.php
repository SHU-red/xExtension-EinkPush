<?php
error_log('[EinkPush2] einkpush2Controller.php is INCLUDED by PHP!');

class FreshRSS_EinkPush2_Controller extends Minz_ActionController {

    private ?EinkPush2Extension $extension;
    private ?EinkPushHelper $helper;

    public function firstAction(): void {
        $this->extension = Minz_ExtensionManager::findExtension('EinkPush2');
        if (!$this->extension) {
            $this->extension = Minz_ExtensionManager::findExtension('einkpush2');
        }
        
        if (!$this->extension) {
            foreach (Minz_ExtensionManager::listExtensions() as $ext) {
                if ($ext instanceof EinkPush2Extension) {
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
            return ['enabled' => true, 'historyDays' => 0, 'unreadOnly' => true, 'markAsRead' => false, 'autoPush' => false, 'fetchContent' => true, 'addTimestamp' => false, 'maxArticles' => 0, 'removeFromFavorites' => false];
        }
        if (strpos($sourceKey, 'cat_') === 0) {
            return ['enabled' => false, 'historyDays' => 7, 'unreadOnly' => true, 'markAsRead' => false, 'autoPush' => false, 'fetchContent' => true, 'addTimestamp' => false, 'maxArticles' => 0];
        }
        return null;
    }

    public function generateAction(): void {
        error_log('[EinkPush2] generateAction() called');
        $sourceKey = Minz_Request::param('source');
        $conf = $this->extension->getConfig();

        if ($sourceKey) {
            $srcCfg = $this->getSourceConfig($sourceKey, $conf);
            if (!$srcCfg) Minz_Request::bad(_t('ext.error_invalid_source'), _url('extension', 'configure', 'e', 'EinkPush2'));
            
            $path = $this->helper->generateSingle($sourceKey, $srcCfg);
            if ($path) $this->downloadFile($path);
            else Minz_Request::good(_t('ext.msg_no_articles'), _url('extension', 'configure', 'e', 'EinkPush2'));
        } else {
            $paths = $this->helper->generateAll($conf['sources']);
            if (empty($paths)) Minz_Request::good(_t('ext.msg_no_articles'), _url('extension', 'configure', 'e', 'EinkPush2'));
            
            $latest = $this->helper->getLatestEpub();
            if ($latest) $this->downloadFile($latest);
        }
    }

    public function pushAction(): void {
        $conf = $this->extension->getConfig();
        $endpoint = $conf['push_endpoint'];
        if (empty($endpoint)) Minz_Request::bad(_t('ext.error_no_endpoint'), _url('extension', 'configure', 'e', 'EinkPush2'));

        $paths = $this->helper->generateAll($conf['sources']);
        if (empty($paths)) Minz_Request::good(_t('ext.msg_no_articles'), _url('extension', 'configure', 'e', 'EinkPush2'));

        $success = 0; $failed = 0;
        foreach ($paths as $sourceKey => $path) {
            $sourceName = $sourceKey === 'favorites' ? _t('ext.source_favorites') : $sourceKey;
            if ($this->helper->pushToEndpoint($path, $endpoint, $conf['push_retries'], $conf['push_retryDelay'], $sourceName)) $success++;
            else $failed++;
        }

        if ($failed === 0) Minz_Request::good(_t('ext.msg_push_success', $success), _url('extension', 'configure', 'e', 'EinkPush2'));
        else Minz_Request::bad(_t('ext.msg_push_failed', $success, $failed), _url('extension', 'configure', 'e', 'EinkPush2'));
    }

    public function pushSingleAction(): void {
        $sourceKey = Minz_Request::param('source');
        $conf = $this->extension->getConfig();
        $endpoint = $conf['push_endpoint'];

        if (empty($endpoint)) Minz_Request::bad(_t('ext.error_no_endpoint'), _url('extension', 'configure', 'e', 'EinkPush2'));

        $srcCfg = $this->getSourceConfig($sourceKey, $conf);
        if (!$srcCfg) Minz_Request::bad(_t('ext.error_invalid_source'), _url('extension', 'configure', 'e', 'EinkPush2'));

        $path = $this->helper->generateSingle($sourceKey, $srcCfg);
        if (!$path) Minz_Request::good(_t('ext.msg_no_articles'), _url('extension', 'configure', 'e', 'EinkPush2'));

        $sourceName = $sourceKey === 'favorites' ? _t('ext.source_favorites') : $sourceKey;
        if ($this->helper->pushToEndpoint($path, $endpoint, $conf['push_retries'], $conf['push_retryDelay'], $sourceName)) {
            Minz_Request::good(_t('ext.msg_push_success_single'), _url('extension', 'configure', 'e', 'EinkPush2'));
        } else {
            Minz_Request::bad(_t('ext.msg_push_failed_single'), _url('extension', 'configure', 'e', 'EinkPush2'));
        }
    }

    public function clearHistoryAction(): void {
        $this->helper->clearHistory();
        Minz_Request::good(_t('ext.msg_history_cleared'), _url('extension', 'configure', 'e', 'EinkPush2'));
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
