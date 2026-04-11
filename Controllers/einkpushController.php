<?php

class FreshExtension_einkpush_Controller extends Minz_ActionController {

    public function generateAction() {
        $ext = Minz_ExtensionManager::findExtension('EinkPush');
        if (!$ext) {
            Minz_Error::error(404);
            return;
        }

        $cfg = $ext->getConfig();
        require_once $ext->getPath() . '/FreshExtension_EinkPush_Helper.php';

        $helper = new EinkPushHelper(
            $ext->getEpubDir(),
            $cfg['screenWidth'],
            $cfg['screenHeight'],
            $cfg['fontSize'],
            $cfg['readability_url'] ?? ''
        );

        $sourceKey = Minz_Request::param('source', '');

        // Single source download
        if ($sourceKey !== '') {
            $srcCfg = $cfg['sources'][$sourceKey] ?? [
                'enabled' => false, 'historyDays' => 7, 'unreadOnly' => false,
                'markAsRead' => false, 'autoPush' => false, 'fetchContent' => true,
                'addTimestamp' => false, 'maxArticles' => 0,
            ];
            $path = $helper->generateSingle($sourceKey, $srcCfg);
            if ($path === null) {
                Minz_Request::bad(_t('ext.einkpush.no_articles'), ['c' => 'extension', 'a' => 'configure', 'params' => ['e' => 'EinkPush']]);
                return;
            }
            $stats = $helper->getFetchStats();
            if ($stats['fail'] > 0) {
                error_log('[EinkPush] Fetch stats for ' . $sourceKey . ': ' . $stats['success'] . ' OK, ' . $stats['fail'] . ' failed');
            }
            header('Content-Type: application/epub+zip');
            header('Content-Disposition: attachment; filename="' . basename($path) . '"');
            header('Content-Length: ' . filesize($path));
            header('Cache-Control: no-store');
            readfile($path);
            exit;
        }

        // All enabled sources
        $results = $helper->generateAll($cfg['sources']);

        if (empty($results)) {
            Minz_Request::bad(_t('ext.einkpush.no_articles'), ['c' => 'extension', 'a' => 'configure', 'params' => ['e' => 'EinkPush']]);
            return;
        }

        // Single EPUB -> serve directly
        if (count($results) === 1) {
            $path = reset($results);
            header('Content-Type: application/epub+zip');
            header('Content-Disposition: attachment; filename="' . basename($path) . '"');
            header('Content-Length: ' . filesize($path));
            header('Cache-Control: no-store');
            readfile($path);
            exit;
        }

        // Multiple EPUBs -> bundle into a ZIP
        $zipPath = $ext->getEpubDir() . 'einkpush_bundle_' . date('Ymd_His') . '.zip';
        $zip = new ZipArchive();
        if ($zip->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
            Minz_Request::bad(_t('ext.einkpush.generate_error'), ['c' => 'extension', 'a' => 'configure', 'params' => ['e' => 'EinkPush']]);
            return;
        }
        foreach ($results as $path) {
            $zip->addFile($path, basename($path));
        }
        $zip->close();

        header('Content-Type: application/zip');
        header('Content-Disposition: attachment; filename="' . basename($zipPath) . '"');
        header('Content-Length: ' . filesize($zipPath));
        header('Cache-Control: no-store');
        readfile($zipPath);
        @unlink($zipPath);
        exit;
    }

    public function pushSingleAction() {
        $ext = Minz_ExtensionManager::findExtension('EinkPush');
        if (!$ext) {
            Minz_Error::error(404);
            return;
        }

        $cfg = $ext->getConfig();
        $endpoint = $cfg['push_endpoint'] ?? '';
        if ($endpoint === '') {
            Minz_Request::bad(_t('ext.einkpush.push_no_endpoint'), ['c' => 'extension', 'a' => 'configure', 'params' => ['e' => 'EinkPush']]);
            return;
        }

        require_once $ext->getPath() . '/FreshExtension_EinkPush_Helper.php';

        $helper = new EinkPushHelper(
            $ext->getEpubDir(),
            $cfg['screenWidth'],
            $cfg['screenHeight'],
            $cfg['fontSize'],
            $cfg['readability_url'] ?? ''
        );

        $retries    = (int) ($cfg['push_retries'] ?? 3);
        $retryDelay = (int) ($cfg['push_retryDelay'] ?? 10);

        $sourceKey = Minz_Request::param('source', '');
        if ($sourceKey === '') {
            Minz_Request::bad(_t('ext.einkpush.no_articles'), ['c' => 'extension', 'a' => 'configure', 'params' => ['e' => 'EinkPush']]);
            return;
        }

        $srcCfg = $cfg['sources'][$sourceKey] ?? [
            'enabled' => false, 'historyDays' => 7, 'unreadOnly' => false,
            'markAsRead' => false, 'autoPush' => false, 'fetchContent' => true,
            'addTimestamp' => false, 'maxArticles' => 0,
        ];

        $path = $helper->generateSingle($sourceKey, $srcCfg);
        if ($path === null) {
            Minz_Request::bad(_t('ext.einkpush.no_articles'), ['c' => 'extension', 'a' => 'configure', 'params' => ['e' => 'EinkPush']]);
            return;
        }

        if ($helper->pushToEndpoint($path, $endpoint, $retries, $retryDelay)) {
            Minz_Request::good(_t('ext.einkpush.push_result', 1, 0), ['c' => 'extension', 'a' => 'configure', 'params' => ['e' => 'EinkPush']]);
        } else {
            Minz_Request::bad(_t('ext.einkpush.push_result', 0, 1), ['c' => 'extension', 'a' => 'configure', 'params' => ['e' => 'EinkPush']]);
        }
    }

    public function pushAction() {
        $ext = Minz_ExtensionManager::findExtension('EinkPush');
        if (!$ext) {
            Minz_Error::error(404);
            return;
        }

        $cfg = $ext->getConfig();
        $endpoint = $cfg['push_endpoint'] ?? '';
        if ($endpoint === '') {
            Minz_Request::bad(_t('ext.einkpush.push_no_endpoint'), ['c' => 'extension', 'a' => 'configure', 'params' => ['e' => 'EinkPush']]);
            return;
        }

        require_once $ext->getPath() . '/FreshExtension_EinkPush_Helper.php';

        $helper = new EinkPushHelper(
            $ext->getEpubDir(),
            $cfg['screenWidth'],
            $cfg['screenHeight'],
            $cfg['fontSize'],
            $cfg['readability_url'] ?? ''
        );

        $retries    = (int) ($cfg['push_retries'] ?? 3);
        $retryDelay = (int) ($cfg['push_retryDelay'] ?? 10);

        $pushSources = [];
        foreach ($cfg['sources'] as $key => $srcCfg) {
            if (!empty($srcCfg['autoPush'])) {
                $pushSources[$key] = $srcCfg;
            }
        }

        if (empty($pushSources)) {
            Minz_Request::bad(_t('ext.einkpush.push_no_sources'), ['c' => 'extension', 'a' => 'configure', 'params' => ['e' => 'EinkPush']]);
            return;
        }

        $success = 0;
        $failed  = 0;

        foreach ($pushSources as $key => $srcCfg) {
            // Ensure we have the new parameters set
            if (!isset($srcCfg['addTimestamp'])) {
                $srcCfg['addTimestamp'] = false;
            }
            if (!isset($srcCfg['maxArticles'])) {
                $srcCfg['maxArticles'] = 0;
            }
            if (!isset($srcCfg['removeFromFavorites'])) {
                $srcCfg['removeFromFavorites'] = false;
            }
            
            $path = $helper->generateSingle($key, $srcCfg);
            if ($path === null) {
                continue;
            }
            if ($helper->pushToEndpoint($path, $endpoint, $retries, $retryDelay)) {
                $success++;
            } else {
                $failed++;
            }
        }

        if ($failed > 0) {
            Minz_Request::bad(_t('ext.einkpush.push_result', $success, $failed), ['c' => 'extension', 'a' => 'configure', 'params' => ['e' => 'EinkPush']]);
        } else {
            Minz_Request::good(_t('ext.einkpush.push_result', $success, $failed), ['c' => 'extension', 'a' => 'configure', 'params' => ['e' => 'EinkPush']]);
        }
    }

    public function downloadAction() {
        $ext = Minz_ExtensionManager::findExtension('EinkPush');
        if (!$ext) {
            Minz_Error::error(404);
            return;
        }

        require_once $ext->getPath() . '/FreshExtension_EinkPush_Helper.php';
        $cfg = $ext->getConfig();

        $helper = new EinkPushHelper(
            $ext->getEpubDir(),
            $cfg['screenWidth'],
            $cfg['screenHeight'],
            $cfg['fontSize'],
            $cfg['readability_url'] ?? ''
        );

        $sourceKey = Minz_Request::param('source', '');
        if ($sourceKey !== '') {
            $epub = $helper->getEpubBySource($sourceKey);
        } else {
            $epub = $helper->getLatestEpub();
        }

        if ($epub === null || !file_exists($epub)) {
            Minz_Request::bad(_t('ext.einkpush.no_epub'), ['c' => 'extension', 'a' => 'configure', 'params' => ['e' => 'EinkPush']]);
            return;
        }

        header('Content-Type: application/epub+zip');
        header('Content-Disposition: attachment; filename="' . basename($epub) . '"');
        header('Content-Length: ' . filesize($epub));
        header('Cache-Control: no-store');
        readfile($epub);
        exit;
    }
}