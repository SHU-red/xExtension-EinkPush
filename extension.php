<?php

class EinkPushExtension extends Minz_Extension {
    const VERSION = '1.1.8';

    public function init() {
        $this->registerController('EinkPush');
        $this->registerTranslates();
        
        $conf = FreshRSS_Context::$user_conf;
        if ($conf) {
            $this->checkAutoPush($conf);
        }

        $showSidebarVal = ($conf && $conf->EinkPush_showSidebarButton !== null) ? (int)$conf->EinkPush_showSidebarButton : 1;
        $showSidebar = ($showSidebarVal !== 0) ? '1' : '0';
        
        $styleUrl = Minz_Url::display('/ext.php?f=xExtension-EinkPush/static/style.css', 'php');
        // Pass config via URL parameters to bypass strict CSP (Content Security Policy)
        $scriptUrl = Minz_Url::display('/ext.php?f=xExtension-EinkPush/static/script.js', 'php') . 
                     '&v=' . time() . 
                     '&sb=' . $showSidebar . 
                     '&l=' . urlencode(_t('ext.sidebar_push_all'));
        
        Minz_View::appendStyle($styleUrl . '&v=' . time());
        Minz_View::appendScript($scriptUrl);
    }

    public function handleConfigureAction() {
        $this->registerTranslates();
        $this->ensureDefaults();

        if (Minz_Request::isPost()) {
            $conf = FreshRSS_Context::$user_conf;
            if ($conf === null) {
                return;
            }

            // Global settings — 3rd param = true to get raw values (param() HTML-encodes by default)
            $conf->EinkPush_screenWidth = max(100, (int) Minz_Request::param('screenWidth', 480, true));
            $conf->EinkPush_screenHeight = max(100, (int) Minz_Request::param('screenHeight', 800, true));
            $conf->EinkPush_fontSize = max(0.5, min(3.0, (float) Minz_Request::param('fontSize', 1.0, true)));
            $conf->EinkPush_showSidebarButton = !empty($_POST['showSidebarButton']) ? 1 : 0;
            
            error_log('[EinkPush] Saving showSidebarButton: ' . $conf->EinkPush_showSidebarButton);

            // Push settings
            $endpoint = trim((string) Minz_Request::param('push_endpoint', 'http://crosspoint.local/upload?path=/RSSFeeds', true));
            if ($endpoint === '') {
                $endpoint = 'http://crosspoint.local/upload?path=/RSSFeeds';
            } elseif (!preg_match('#^https?://#i', $endpoint)) {
                $endpoint = 'http://crosspoint.local/upload?path=/RSSFeeds';
            }
            $conf->EinkPush_push_endpoint = $endpoint;
            $conf->EinkPush_ping_interval = max(1, (int) Minz_Request::param('ping_interval', 5, true));
            $conf->EinkPush_push_cooldown = max(1, (int) Minz_Request::param('push_cooldown', 20, true));
            $conf->EinkPush_push_retries = max(0, min(20, (int) Minz_Request::param('push_retries', 3, true)));
            $conf->EinkPush_push_retryDelay = max(1, min(300, (int) Minz_Request::param('push_retryDelay', 10, true)));

            // Readability API
            $readaUrl = trim((string) Minz_Request::param('readability_url', '', true));
            if ($readaUrl !== '' && !preg_match('#^https?://#i', $readaUrl)) {
                $readaUrl = '';
            }
            $conf->EinkPush_readability_url = rtrim($readaUrl, '/');

            // Per-source settings (read directly from $_POST to preserve nested arrays)
            $posted = isset($_POST['sources']) && is_array($_POST['sources']) ? $_POST['sources'] : [];
            $sources = [];

            // Favorites
            $fav = $posted['favorites'] ?? [];
            $sources['favorites'] = [
                'enabled'      => !empty($fav['enabled']),
                'historyDays'  => max(0, (int) ($fav['historyDays'] ?? 7)),
                'unreadOnly'   => !empty($fav['unreadOnly']),
                'markAsRead'   => !empty($fav['markAsRead']),
                'autoPush'     => !empty($fav['autoPush']),
                'fetchContent' => !empty($fav['fetchContent']),
                'addTimestamp' => !empty($fav['addTimestamp']),
                'maxArticles'  => max(0, (int) ($fav['maxArticles'] ?? 50)),
                'removeFromFavorites' => !empty($fav['removeFromFavorites']),
            ];

            // Categories
            $categoryDAO = FreshRSS_Factory::createCategoryDao();
            $categories = $categoryDAO->listCategories() ?: [];
            foreach ($categories as $cat) {
                $key = 'cat_' . $cat->id();
                $src = $posted[$key] ?? [];
                $sources[$key] = [
                    'enabled'      => !empty($src['enabled']),
                    'historyDays'  => max(0, (int) ($src['historyDays'] ?? 7)),
                    'unreadOnly'   => !empty($src['unreadOnly']),
                    'markAsRead'   => !empty($src['markAsRead']),
                    'autoPush'     => !empty($src['autoPush']),
                'fetchContent' => !empty($src['fetchContent']),
                'addTimestamp' => !empty($src['addTimestamp']),
                'maxArticles'  => max(0, (int) ($src['maxArticles'] ?? 50)),
            ];
            }

            $conf->EinkPush_sources = $sources;

            // Log what we're saving for diagnostics
            $sourcesSummary = [];
            foreach ($sources as $k => $v) {
                $sourcesSummary[$k] = 'en=' . (int)$v['enabled'] . ' unread=' . (int)$v['unreadOnly']
                    . ' mark=' . (int)$v['markAsRead'] . ' fetch=' . (int)$v['fetchContent']
                    . ' push=' . (int)$v['autoPush'] . ' days=' . $v['historyDays']
                    . ' max=' . $v['maxArticles'] . ' ts=' . (int)$v['addTimestamp'];
            }
            error_log('[EinkPush] Saving sources: ' . json_encode($sourcesSummary));

            $saveResult = $conf->save();
            error_log('[EinkPush] Config save result: ' . var_export($saveResult, true));
        }
    }

    public function getConfig() {
        $this->ensureDefaults();
        $conf = FreshRSS_Context::$user_conf;
        return [
            'screenWidth'     => $conf->EinkPush_screenWidth,
            'screenHeight'    => $conf->EinkPush_screenHeight,
            'fontSize'        => $conf->EinkPush_fontSize,
            'showSidebarButton'=> $conf->EinkPush_showSidebarButton,
            'sources'         => $conf->EinkPush_sources,
            'push_endpoint'   => $conf->EinkPush_push_endpoint,
            'ping_interval'   => $conf->EinkPush_ping_interval,
            'push_cooldown'   => $conf->EinkPush_push_cooldown,
            'push_retries'    => $conf->EinkPush_push_retries,
            'push_retryDelay' => $conf->EinkPush_push_retryDelay,
            'push_token'      => $conf->EinkPush_push_token,
            'readability_url' => $conf->EinkPush_readability_url,
        ];
    }

    private function ensureDefaults() {
        $conf = FreshRSS_Context::$user_conf;
        if ($conf === null) {
            return;
        }
        $defaults = [
            'EinkPush_screenWidth'    => 480,
            'EinkPush_screenHeight'   => 800,
            'EinkPush_fontSize'       => 1.0,
            'EinkPush_showSidebarButton' => 1,
            'EinkPush_sources'        => [
                'favorites' => ['enabled' => false, 'historyDays' => 7, 'unreadOnly' => true, 'markAsRead' => false, 'autoPush' => false, 'fetchContent' => true, 'addTimestamp' => false, 'maxArticles' => 50, 'removeFromFavorites' => false],
            ],
            'EinkPush_push_endpoint'  => 'http://crosspoint.local/upload?path=/RSSFeeds',
            'EinkPush_ping_interval'  => 5,
            'EinkPush_push_cooldown'  => 20,
            'EinkPush_last_ping'      => 0,
            'EinkPush_last_push'      => 0,
            'EinkPush_push_retries'   => 3,
            'EinkPush_push_retryDelay'=> 10,
            'EinkPush_push_token'     => '',
            'EinkPush_readability_url'=> '',
        ];
        $dirty = false;
        foreach ($defaults as $key => $value) {
            if ($conf->$key === null) {
                $conf->$key = $value;
                $dirty = true;
            }
        }
        // Auto-generate push token if empty
        if (empty($conf->EinkPush_push_token)) {
            $conf->EinkPush_push_token = bin2hex(random_bytes(16));
            $dirty = true;
        }
        if ($dirty) {
            $conf->save();
        }
    }

    public function getEpubDir() {
        $dir = USERS_PATH . '/' . Minz_User::name() . '/EinkPush/';
        if (!is_dir($dir)) {
            @mkdir($dir, 0770, true);
        }
        return $dir;
    }

    private function checkAutoPush($conf) {
        $now = time();
        $lastPing = (int) ($conf->EinkPush_last_ping ?? 0);
        $lastPush = (int) ($conf->EinkPush_last_push ?? 0);
        $pingInterval = (int) ($conf->EinkPush_ping_interval ?? 5) * 60;
        $cooldown = (int) ($conf->EinkPush_push_cooldown ?? 20) * 3600;

        // 1. Check cooldown
        if (($now - $lastPush) < $cooldown) {
            return;
        }

        // 2. Check ping interval
        if (($now - $lastPing) < $pingInterval) {
            return;
        }

        // 3. Update last ping time immediately to avoid concurrent pings if possible
        $conf->EinkPush_last_ping = $now;
        $conf->save();

        // 4. Ping device
        $endpoint = $conf->EinkPush_push_endpoint;
        if (empty($endpoint)) return;

        require_once $this->getPath() . '/FreshExtension_EinkPush_Helper.php';
        $helper = new EinkPushHelper($this->getEpubDir());
        
        if ($helper->checkDeviceStatus($endpoint)) {
            error_log('[EinkPush] Device is ONLINE. Triggering auto-push.');
            
            // Trigger push for all enabled sources that have autoPush=true
            $sources = $conf->EinkPush_sources;
            $paths = $helper->generateAll($sources);
            
            if (!empty($paths)) {
                $success = 0;
                foreach ($paths as $key => $path) {
                    $srcCfg = $sources[$key] ?? [];
                    if (empty($srcCfg['autoPush'])) continue;

                    $sourceName = $key === 'favorites' ? _t('ext.source_favorites') : $key;
                    if ($helper->pushToEndpoint($path, $endpoint, (int)$conf->EinkPush_push_retries, (int)$conf->EinkPush_push_retryDelay, $sourceName)) {
                        $success++;
                    }
                }
                
                if ($success > 0) {
                    $conf->EinkPush_last_push = time();
                    $conf->save();
                    error_log('[EinkPush] Auto-push completed. Success: ' . $success);
                }
            }
        } else {
            error_log('[EinkPush] Device is OFFLINE.');
        }
    }
}
