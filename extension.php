<?php

class EinkPushExtension extends Minz_Extension {

    public function init() {
        $this->registerController('einkpush');
        $this->registerTranslates();
    }

    public function handleConfigureAction() {
        $this->registerTranslates();
        $this->ensureDefaults();

        if (Minz_Request::isPost()) {
            $conf = FreshRSS_Context::$user_conf;

            // Global settings — 3rd param = true to get raw values (param() HTML-encodes by default)
            $conf->EinkPush_screenWidth = max(100, (int) Minz_Request::param('screenWidth', 480, true));
            $conf->EinkPush_screenHeight = max(100, (int) Minz_Request::param('screenHeight', 800, true));
            $conf->EinkPush_fontSize = max(0.5, min(3.0, (float) Minz_Request::param('fontSize', 1.0, true)));

            // Push settings
            $endpoint = trim((string) Minz_Request::param('push_endpoint', '', true));
            if ($endpoint !== '' && !preg_match('#^https?://#i', $endpoint)) {
                $endpoint = '';
            }
            $conf->EinkPush_push_endpoint = $endpoint;
            $conf->EinkPush_push_cron = trim((string) Minz_Request::param('push_cron', '0 6 * * *', true));
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
                'historyDays'  => max(0, (int) ($fav['historyDays'] ?? 0)),
                'unreadOnly'   => !empty($fav['unreadOnly']),
                'markAsRead'   => !empty($fav['markAsRead']),
                'autoPush'     => !empty($fav['autoPush']),
                'fetchContent' => !empty($fav['fetchContent']),
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
                ];
            }

            $conf->EinkPush_sources = $sources;

            // Log what we're saving for diagnostics
            $sourcesSummary = [];
            foreach ($sources as $k => $v) {
                $sourcesSummary[$k] = 'en=' . (int)$v['enabled'] . ' unread=' . (int)$v['unreadOnly']
                    . ' mark=' . (int)$v['markAsRead'] . ' fetch=' . (int)$v['fetchContent']
                    . ' push=' . (int)$v['autoPush'] . ' days=' . $v['historyDays'];
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
            'sources'         => $conf->EinkPush_sources,
            'push_endpoint'   => $conf->EinkPush_push_endpoint,
            'push_cron'       => $conf->EinkPush_push_cron,
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
            'EinkPush_sources'        => [
                'favorites' => ['enabled' => true, 'historyDays' => 0, 'unreadOnly' => true, 'markAsRead' => false, 'autoPush' => false, 'fetchContent' => true],
            ],
            'EinkPush_push_endpoint'  => '',
            'EinkPush_push_cron'      => '0 6 * * *',
            'EinkPush_push_retries'   => 3,
            'EinkPush_push_retryDelay'=> 10,
            'EinkPush_push_token'     => '',
            'EinkPush_readability_url'=> '',
        ];
        $dirty = false;
        foreach ($defaults as $key => $value) {
            if (!$conf->hasParam($key)) {
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
}
