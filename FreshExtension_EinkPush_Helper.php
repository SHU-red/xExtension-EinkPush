<?php

class EinkPushHelper {

    private string $outputDir;
    private int $screenWidth;
    private int $screenHeight;
    private float $fontSize;
    private string $readabilityUrl;
    /** @var string|null Detected API pattern: 'post_root', 'post_parse', 'get_extract', 'get_parse', 'post_api_parse' */
    private ?string $detectedApiPattern = null;
    private int $fetchSuccessCount = 0;
    private int $fetchFailCount = 0;

    public function __construct(string $outputDir, int $screenWidth = 480, int $screenHeight = 800, float $fontSize = 1.0, string $readabilityUrl = '') {
        $this->outputDir = rtrim($outputDir, '/') . '/';
        $this->screenWidth = max(100, $screenWidth);
        $this->screenHeight = max(100, $screenHeight);
        $this->fontSize = max(0.5, min(3.0, $fontSize));
        $this->readabilityUrl = rtrim($readabilityUrl, '/');
        if (!is_dir($this->outputDir)) {
            @mkdir($this->outputDir, 0770, true);
        }
    }

    /**
     * Generate one EPUB per enabled source.
     * Each source carries its own unreadOnly and markAsRead flags.
     * Returns [sourceKey => filePath] for each successfully generated EPUB.
     */
    public function generateAll(array $sources): array {
        // Clean old EPUBs
        foreach (glob($this->outputDir . '*.epub') as $old) {
            @unlink($old);
        }

        $results = [];
        foreach ($sources as $key => $srcCfg) {
            if (empty($srcCfg['enabled'])) {
                continue;
            }
            $historyDays = (int) ($srcCfg['historyDays'] ?? 7);
            $unreadOnly = !empty($srcCfg['unreadOnly']);
            $markAsRead = !empty($srcCfg['markAsRead']);
            $fetchContent = !empty($srcCfg['fetchContent']);
            $maxArticles = (int) ($srcCfg['maxArticles'] ?? 0);
            $addTimestamp = !empty($srcCfg['addTimestamp']);
            $entries = $this->collectForSource($key, $historyDays, $unreadOnly, $maxArticles);
            if (empty($entries)) {
                continue;
            }
            $label = $this->sourceLabel($key);
            $entryIds = array_map(function($entry) { return $entry->id(); }, $entries);
            $path = $this->buildEpub($key, $label, $entries, $markAsRead, $fetchContent, $addTimestamp);
            
            // Handle remove from favorites if enabled and this is the favorites source
            if ($key === 'favorites' && !empty($srcCfg['removeFromFavorites'])) {
                $this->removeFromFavorites($entryIds);
            }
            
            if ($path !== null) {
                $results[$key] = $path;
            }
        }
        return $results;
    }

    /**
     * Generate EPUB for a single source (ignores 'enabled' flag).
     * Cleans only that source's old EPUBs.
     */
    public function generateSingle(string $key, array $srcCfg): ?string {
        $label = $this->sourceLabel($key);
        $safeName = $this->sanitizeFilename($label);
        
        // Only clean old EPUBs if timestamp is enabled
        $addTimestamp = !empty($srcCfg['addTimestamp']);
        if ($addTimestamp) {
            foreach (glob($this->outputDir . $safeName . '_*.epub') as $old) {
                @unlink($old);
            }
        }

        $historyDays = (int) ($srcCfg['historyDays'] ?? 7);
        $unreadOnly = !empty($srcCfg['unreadOnly']);
        $markAsRead = !empty($srcCfg['markAsRead']);
        $fetchContent = !empty($srcCfg['fetchContent']);
        $maxArticles = (int) ($srcCfg['maxArticles'] ?? 0);
        $entries = $this->collectForSource($key, $historyDays, $unreadOnly, $maxArticles);
        if (empty($entries)) {
            return null;
        }
        
        $entryIds = array_map(function($entry) { return $entry->id(); }, $entries);
        $path = $this->buildEpub($key, $label, $entries, $markAsRead, $fetchContent, $addTimestamp);
        
        // Handle remove from favorites if enabled and this is the favorites source
        if ($key === 'favorites' && !empty($srcCfg['removeFromFavorites'])) {
            $this->removeFromFavorites($entryIds);
        }
        
        return $path;
    }

    /**
     * POST an EPUB file to a remote endpoint with retries.
     */
    public function pushToEndpoint(string $filePath, string $endpoint, int $retries = 3, int $retryDelay = 10, string $sourceName = 'Unknown'): bool {
        $success = false;
        if (!file_exists($filePath) || !function_exists('curl_init')) {
            $this->logPush($sourceName, false, 'File missing or cURL disabled');
            return false;
        }
        $parsed = parse_url($endpoint);
        if (!$parsed || !in_array($parsed['scheme'] ?? '', ['http', 'https'], true)) {
            return false;
        }

        $filename = basename($filePath);
        $attempts = max(1, $retries + 1);

        for ($i = 0; $i < $attempts; $i++) {
            if ($i > 0) {
                sleep($retryDelay);
            }
            $ch = curl_init();
            curl_setopt_array($ch, [
                CURLOPT_URL            => $endpoint,
                CURLOPT_POST           => true,
                CURLOPT_POSTFIELDS     => [
                    'file' => new \CURLFile($filePath, 'application/epub+zip', $filename),
                ],
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT        => 60,
                CURLOPT_CONNECTTIMEOUT => 15,
                CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_MAXREDIRS      => 3,
                CURLOPT_PROTOCOLS      => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            ]);

            $response = curl_exec($ch);
            $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);

            if ($httpCode >= 200 && $httpCode < 300) {
                $success = true;
                break;
            }
        }

        $this->logPush($sourceName, $success, $success ? 'HTTP ' . $httpCode : 'Failed after retries (Last: ' . $httpCode . ')');
        return $success;
    }
    /**
     * List currently available EPUB files with metadata.
     */
    public function getLatestEpub(): ?string {
        $files = glob($this->outputDir . '*.epub');
        if (empty($files)) {
            return null;
        }
        usort($files, function ($a, $b) { return filemtime($b) - filemtime($a); });
        return $files[0];
    }
    
    /**
     * Remove articles from favorites after successful export.
     */
    public function removeFromFavorites(array $entryIds): void {
        if (empty($entryIds)) {
            return;
        }
        
        try {
            $entryDAO = FreshRSS_Factory::createEntryDao();
            foreach ($entryIds as $entryId) {
                $entryDAO->toggleFavorite($entryId, false);
            }
        } catch (Exception $e) {
            error_log('[EinkPush] Failed to remove articles from favorites: ' . $e->getMessage());
        }
    }

    // ── private helpers ─────────────────────────────────────────────

    private function collectForSource(string $sourceKey, int $historyDays, bool $unreadOnly, int $maxArticles = 0): array {
        $entryDAO = FreshRSS_Factory::createEntryDao();
        $limit = 500;
        $idMin = '';
        if ($historyDays > 0) {
            $minDate = time() - ($historyDays * 86400);
            $idMin = $minDate . '000000';
        }

        if ($unreadOnly) {
            $state = FreshRSS_Entry::STATE_NOT_READ | FreshRSS_Entry::STATE_FAVORITE | FreshRSS_Entry::STATE_NOT_FAVORITE;
        } else {
            $state = FreshRSS_Entry::STATE_READ | FreshRSS_Entry::STATE_NOT_READ | FreshRSS_Entry::STATE_FAVORITE | FreshRSS_Entry::STATE_NOT_FAVORITE;
        }

        $entries = [];

        if ($sourceKey === 'favorites') {
            $result = $entryDAO->listWhere(
                type: 'S', id: 0, state: $state,
                filters: null, id_min: $idMin, order: 'DESC', limit: $limit
            );
            if ($result) {
                foreach ($result as $entry) {
                    $entries[] = $entry;
                }
            }
        } elseif (strpos($sourceKey, 'cat_') === 0) {
            $catId = (int) substr($sourceKey, 4);
            if ($catId > 0) {
                $result = $entryDAO->listWhere(
                    type: 'c', id: $catId, state: $state,
                    filters: null, id_min: $idMin, order: 'DESC', limit: $limit
                );
                if ($result) {
                    foreach ($result as $entry) {
                        $entries[] = $entry;
                    }
                }
            }
        }

        usort($entries, function ($a, $b) { return (int)$b->date() <=> (int)$a->date(); });
        
        // Apply max articles limit if set
        if ($maxArticles > 0 && count($entries) > $maxArticles) {
            $entries = array_slice($entries, 0, $maxArticles);
        }
        
        return $entries;
    }

    private function buildEpub(string $sourceKey, string $label, array $entries, bool $markAsRead, bool $fetchContent = false, bool $addTimestamp = true): ?string {
        $safeName = $this->sanitizeFilename($label);
        $filename = $addTimestamp ? $safeName . '_' . date('Ymd_His') . '.epub' : $safeName . '.epub';
        $fullPath = $this->outputDir . $filename;

        $lang = 'en';
        if (class_exists('FreshRSS_Context') && isset(FreshRSS_Context::$user_conf)) {
            $lang = FreshRSS_Context::$user_conf->language ?? 'en';
        }
        $langSafe = htmlspecialchars($lang, ENT_QUOTES, 'UTF-8');

        $bookId = 'freshrss-einkpush-' . $safeName . '-' . date('Ymd-His') . '-' . bin2hex(random_bytes(4));
        $bookTitle = $label . ' - ' . date('Y-m-d');
        $css = $this->buildCss();

        $chapters = [];
        $chapterIndex = 0;
        $feedDAOCache = null;

        foreach ($entries as $entry) {
            $chapterIndex++;
            $rawTitle = $entry->title();
            $safeTitle = htmlspecialchars($rawTitle, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');

            // Get the full article content including enclosures
            $rawContent = $entry->content(true);

            // If fetch-full-content is enabled and stored content is short, fetch via readability API
            $fetchError = '';
            $fetchDebug = '';
            if ($fetchContent && $this->readabilityUrl !== '') {
                $textLength = mb_strlen(strip_tags($rawContent));
                if ($textLength < 1000) {
                    $url = method_exists($entry, 'link') ? $entry->link() : '';
                    if (!empty($url)) {
                        // Check if this is an unresolvable Google News URL before wasting time
                        $isGoogleNews = (bool) preg_match('#^https?://news\.google\.com/rss/articles/#', $url);
                        $resolvedUrl = $this->resolveRedirects($url);
                        $wasResolved = ($resolvedUrl !== $url);

                        if ($isGoogleNews && !$wasResolved) {
                            // Google News encrypted URL — readability can't fetch it either
                            $this->fetchFailCount++;
                            $fetchError = 'Google News uses encrypted article links that cannot be resolved server-side. The RSS summary is shown instead.';
                            error_log('[EinkPush] Skipping readability for unresolvable Google News URL: ' . $url);
                        } else {
                            if ($wasResolved) {
                                error_log('[EinkPush] Resolved redirect: ' . $url . ' → ' . $resolvedUrl);
                            }
                            $result = $this->fetchViaReadability($resolvedUrl);
                            if ($result['ok']) {
                                $rawContent = $result['html'];
                                $this->fetchSuccessCount++;
                            } else {
                                $this->fetchFailCount++;
                                $fetchError = $result['error'];
                                $fetchDebug = $result['debug'] ?? '';
                                error_log('[EinkPush] Readability failed for: ' . $resolvedUrl . ' — ' . $fetchError);
                            }
                        }
                    }
                }
            } elseif ($fetchContent && $this->readabilityUrl === '') {
                if ($chapterIndex === 1) {
                    error_log('[EinkPush] Fetch content is enabled but no Readability API URL configured');
                }
                $fetchError = 'No Readability API URL configured in extension settings.';
            }

            $bodyXhtml = $this->htmlToXhtml($rawContent);

            // Build fetch-error banner to show in the EPUB article
            $errorBanner = '';
            if ($fetchError !== '') {
                $safeError = htmlspecialchars($fetchError, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
                $safeDebug = htmlspecialchars($fetchDebug, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
                $articleLink = method_exists($entry, 'link') ? htmlspecialchars($entry->link(), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') : '';
                $errorBanner = '<div class="fetch-error">'
                    . '<p><strong>&#9888; Content could not be fetched</strong></p>'
                    . '<p>' . $safeError . '</p>'
                    . ($safeDebug !== '' ? '<p class="fetch-debug"><small>' . $safeDebug . '</small></p>' : '')
                    . ($articleLink !== '' ? '<p><a href="' . $articleLink . '">Open original article</a></p>' : '')
                    . '</div>';
            }

            $feedName = '';
            try {
                if ($feedDAOCache === null) {
                    $feedDAOCache = FreshRSS_Factory::createFeedDao();
                }
                $feed = $feedDAOCache->searchById($entry->feedId());
                $feedName = $feed ? $feed->name() : '';
            } catch (Exception $e) {
                // ignore
            }

            $metaLine = '';
            if ($feedName !== '') {
                $metaLine = '<p class="feed-name">'
                    . htmlspecialchars($feedName, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8')
                    . ' &#x00B7; ' . date('Y-m-d', (int) $entry->date())
                    . '</p>';
            }

            $chapterFile = 'chapter_' . $chapterIndex . '.xhtml';
            $chapterBody = '<?xml version="1.0" encoding="UTF-8"?>' . "\n"
                . '<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="' . $langSafe . '">' . "\n"
                . '<head><meta charset="UTF-8"/>'
                . '<link rel="stylesheet" type="text/css" href="style.css"/>'
                . '<title>' . $safeTitle . '</title></head>' . "\n"
                . '<body>' . "\n"
                . '<article>' . "\n"
                . '<h1 class="article-title">' . $safeTitle . '</h1>' . "\n"
                . $metaLine . "\n"
                . $errorBanner . "\n"
                . '<div class="article-body">' . "\n" . $bodyXhtml . "\n" . '</div>' . "\n"
                . '</article>' . "\n"
                . '</body></html>';

            $chapters[] = ['file' => $chapterFile, 'title' => $safeTitle, 'body' => $chapterBody];

            if ($markAsRead && !$entry->isRead()) {
                $entryDAO = FreshRSS_Factory::createEntryDao();
                $entryDAO->markRead($entry->id(), true);
            }
        }

        if (empty($chapters)) {
            return null;
        }

        $zip = new ZipArchive();
        if ($zip->open($fullPath, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
            return null;
        }

        $zip->addFromString('mimetype', 'application/epub+zip');
        $zip->setCompressionName('mimetype', ZipArchive::CM_STORE);

        $zip->addFromString('META-INF/container.xml', '<?xml version="1.0" encoding="UTF-8"?>' . "\n"
            . '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
            . '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>'
            . '</container>');

        $zip->addFromString('OEBPS/style.css', $css);

        foreach ($chapters as $ch) {
            $zip->addFromString('OEBPS/' . $ch['file'], $ch['body']);
        }

        // Navigation document
        $bookTitleSafe = htmlspecialchars($bookTitle, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $labelSafe = htmlspecialchars($label, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $navBody = '<?xml version="1.0" encoding="UTF-8"?>' . "\n"
            . '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="' . $langSafe . '">' . "\n"
            . '<head><meta charset="UTF-8"/><title>' . $bookTitleSafe . '</title>'
            . '<link rel="stylesheet" type="text/css" href="style.css"/></head>' . "\n"
            . '<body><nav epub:type="toc" id="toc"><h1>' . $labelSafe . '</h1><ol>' . "\n";
        foreach ($chapters as $ch) {
            $navBody .= '<li><a href="' . $ch['file'] . '">' . $ch['title'] . '</a></li>' . "\n";
        }
        $navBody .= '</ol></nav></body></html>';
        $zip->addFromString('OEBPS/toc.xhtml', $navBody);

        // OPF package
        $manifest = '<item id="nav" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>' . "\n"
            . '<item id="css" href="style.css" media-type="text/css"/>' . "\n";
        $spine = '';
        foreach ($chapters as $i => $ch) {
            $itemId = 'ch' . ($i + 1);
            $manifest .= '<item id="' . $itemId . '" href="' . $ch['file'] . '" media-type="application/xhtml+xml"/>' . "\n";
            $spine .= '<itemref idref="' . $itemId . '"/>' . "\n";
        }

        $opf = '<?xml version="1.0" encoding="UTF-8"?>' . "\n"
            . '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">' . "\n"
            . '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
            . '<dc:identifier id="bookid">' . htmlspecialchars($bookId) . '</dc:identifier>'
            . '<dc:title>' . $bookTitleSafe . '</dc:title>'
            . '<dc:language>' . $langSafe . '</dc:language>'
            . '<dc:creator>FreshRSS</dc:creator>'
            . '<dc:description>Articles exported from FreshRSS for offline reading.</dc:description>'
            . '<meta property="dcterms:modified">' . gmdate('Y-m-d\TH:i:s\Z') . '</meta>'
            . '<meta name="viewport" content="width=' . $this->screenWidth . ', height=' . $this->screenHeight . '"/>'
            . '</metadata>' . "\n"
            . '<manifest>' . "\n" . $manifest . '</manifest>' . "\n"
            . '<spine>' . "\n" . '<itemref idref="nav"/>' . "\n" . $spine . '</spine>' . "\n"
            . '</package>';
        $zip->addFromString('OEBPS/content.opf', $opf);

        $zip->close();

        return file_exists($fullPath) ? $fullPath : null;
    }

    /**
     * Resolve URL redirect chains.
     * Handles Google News encoded article IDs (old format), HTTP 3xx, meta-refresh, JS redirects.
     */
    private function resolveRedirects(string $url): string {
        // ── Google News: try to decode the article URL from the base64 protobuf ──
        if (preg_match('#^https?://news\.google\.com/rss/articles/([A-Za-z0-9_-]+)#', $url, $m)) {
            $decoded = $this->decodeGoogleNewsUrl($m[1]);
            if ($decoded !== null) {
                error_log('[EinkPush] Decoded Google News URL: ' . $url . ' → ' . $decoded);
                return $decoded;
            }
            // New-format (encrypted) Google News URLs cannot be resolved server-side.
            // The page is a JS SPA with no extractable redirect — skip the heavy HTTP fetch.
            error_log('[EinkPush] Google News article uses encrypted format, cannot resolve: ' . $url);
            return $url;
        }

        if (!function_exists('curl_init')) {
            return $url;
        }

        // ── HTTP HEAD with redirect following ──
        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL            => $url,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS      => 10,
            CURLOPT_TIMEOUT        => 15,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_NOBODY         => true,
            CURLOPT_PROTOCOLS      => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_USERAGENT      => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ]);

        curl_exec($ch);
        $finalUrl = curl_getinfo($ch, CURLINFO_EFFECTIVE_URL);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($httpCode >= 200 && $httpCode < 400 && !empty($finalUrl) && $finalUrl !== $url) {
            return $finalUrl;
        }

        // ── HTTP GET — scrape body for meta-refresh / JS redirect ──
        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL            => $url,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS      => 10,
            CURLOPT_TIMEOUT        => 15,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_PROTOCOLS      => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_USERAGENT      => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ]);

        $body = curl_exec($ch);
        $finalUrl = curl_getinfo($ch, CURLINFO_EFFECTIVE_URL);
        $curlError = curl_error($ch);
        curl_close($ch);

        if ($body === false) {
            error_log('[EinkPush] resolveRedirects curl error for ' . $url . ': ' . $curlError);
            return $url;
        }

        if (!empty($finalUrl) && $finalUrl !== $url) {
            $url = $finalUrl;
        }

        // Meta-refresh redirect
        if (preg_match('/<meta[^>]+http-equiv\s*=\s*["\']?refresh["\']?[^>]+content\s*=\s*["\']?\d+;\s*url=([^"\'>\s]+)/i', $body, $m)) {
            $target = html_entity_decode($m[1], ENT_QUOTES, 'UTF-8');
            if (filter_var($target, FILTER_VALIDATE_URL)) {
                return $target;
            }
        }

        // JS redirect (window.location = "..." or location.href = "..." or location.replace("..."))
        if (preg_match('/(?:window\.location|location\.(?:href|replace))\s*[=(]\s*["\']([^"\']+)["\']/i', $body, $m)) {
            $target = $m[1];
            if (filter_var($target, FILTER_VALIDATE_URL)) {
                return $target;
            }
        }

        return $url;
    }

    /**
     * Decode a Google News article ID to extract the real article URL.
     * Only works for the old format where the URL is stored as plaintext in the protobuf.
     * The new encrypted format (since July 2024, "AU_" prefix) cannot be decoded server-side.
     */
    private function decodeGoogleNewsUrl(string $articleId): ?string {
        $b64 = str_replace(['-', '_'], ['+', '/'], $articleId);
        $b64 = str_pad($b64, (int) ceil(strlen($b64) / 4) * 4, '=');
        $decoded = base64_decode($b64, true);
        if ($decoded === false || strlen($decoded) < 10) {
            return null;
        }

        // Strip protobuf prefix: field 1 varint + field 4 header
        $prefix = "\x08\x13\x22";
        if (strpos($decoded, $prefix) === 0) {
            $decoded = substr($decoded, 3);
        }

        // Read varint (length of the inner string)
        $pos = 0;
        $len = 0;
        $shift = 0;
        while ($pos < strlen($decoded)) {
            $byte = ord($decoded[$pos]);
            $len |= ($byte & 0x7F) << $shift;
            $pos++;
            $shift += 7;
            if (($byte & 0x80) === 0) {
                break;
            }
        }

        $inner = substr($decoded, $pos, $len);

        // Old format: inner string IS the URL
        if (preg_match('#^https?://#', $inner)) {
            return $inner;
        }

        // New format (since July 2024): encrypted — cannot decode server-side
        if (strpos($inner, 'AU_') === 0) {
            error_log('[EinkPush] Google News article uses new encrypted format (AU_ prefix)');
            return null;
        }

        // Fallback: look for any URL in the raw decoded bytes
        if (preg_match('#(https?://[^\x00-\x1f\x7f-\x9f]{10,})#', $decoded, $m)) {
            $url = preg_replace('/[\x00-\x1f\x7f-\x9f].*$/', '', $m[1]);
            if (filter_var($url, FILTER_VALIDATE_URL) && strpos($url, 'news.google.com') === false) {
                return $url;
            }
        }

        return null;
    }

    /**
     * Fetch full article content via a readability API container.
     * Auto-detects the API pattern on the first call by trying common formats.
     * Returns ['ok' => true, 'html' => '...'] or ['ok' => false, 'error' => '...', 'debug' => '...'].
     */
    private function fetchViaReadability(string $articleUrl): array {
        if ($this->readabilityUrl === '' || !function_exists('curl_init')) {
            return ['ok' => false, 'error' => 'No Readability API URL configured or curl not available', 'debug' => ''];
        }

        // If we already know the working pattern, use it directly
        if ($this->detectedApiPattern !== null) {
            return $this->callReadabilityApi($articleUrl, $this->detectedApiPattern);
        }

        // Try common API patterns in order of likelihood
        $patterns = [
            'post_root'      => 'POST /',
            'post_parse'     => 'POST /parse',
            'get_extract'    => 'GET /extract?url=',
            'get_parse'      => 'GET /parse?url=',
            'post_api_parse' => 'POST /api/parse',
        ];

        $lastResult = null;
        foreach ($patterns as $pattern => $desc) {
            $r = $this->callReadabilityApi($articleUrl, $pattern);

            // 'ok' = got content → lock in and return
            if ($r['ok']) {
                $this->detectedApiPattern = $pattern;
                error_log('[EinkPush] Readability API pattern detected (with content): ' . $desc);
                return $r;
            }

            // 'reachable' = endpoint exists (200 OK) but couldn't extract content
            // Lock in this pattern — it works, just this article has no content
            if (!empty($r['reachable'])) {
                $this->detectedApiPattern = $pattern;
                error_log('[EinkPush] Readability API pattern detected (reachable): ' . $desc);
                return $r;
            }

            // 'fail' (4xx, 5xx, curl error) = try next pattern
            $lastResult = $r;
        }

        // None worked at all
        $msg = 'None of the API patterns returned HTTP 200 on ' . $this->readabilityUrl
            . '. Tried: ' . implode(', ', array_values($patterns))
            . '. Last error: ' . ($lastResult['error'] ?? 'unknown');
        error_log('[EinkPush] ' . $msg);
        return ['ok' => false, 'error' => $msg, 'debug' => $lastResult['debug'] ?? ''];
    }

    /**
     * Call the readability API using a specific pattern.
     * Returns:
     *   ['ok' => true, 'html' => '...'] — content extracted
     *   ['ok' => false, 'reachable' => true, 'error' => '...', 'debug' => '...'] — endpoint works but no content
     *   ['ok' => false, 'error' => '...', 'debug' => '...'] — endpoint failed (4xx/5xx/curl)
     */
    private function callReadabilityApi(string $articleUrl, string $pattern): array {
        $ch = curl_init();
        $baseOpts = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 30,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_PROTOCOLS      => CURLPROTO_HTTP | CURLPROTO_HTTPS,
        ];

        switch ($pattern) {
            case 'post_parse':
                $baseOpts[CURLOPT_URL] = $this->readabilityUrl . '/parse';
                $baseOpts[CURLOPT_POST] = true;
                $baseOpts[CURLOPT_POSTFIELDS] = json_encode(['url' => $articleUrl]);
                $baseOpts[CURLOPT_HTTPHEADER] = ['Content-Type: application/json', 'Accept: application/json'];
                break;
            case 'get_parse':
                $baseOpts[CURLOPT_URL] = $this->readabilityUrl . '/parse?url=' . urlencode($articleUrl);
                break;
            case 'post_api_parse':
                $baseOpts[CURLOPT_URL] = $this->readabilityUrl . '/api/parse';
                $baseOpts[CURLOPT_POST] = true;
                $baseOpts[CURLOPT_POSTFIELDS] = json_encode(['url' => $articleUrl]);
                $baseOpts[CURLOPT_HTTPHEADER] = ['Content-Type: application/json', 'Accept: application/json'];
                break;
            case 'get_extract':
                $baseOpts[CURLOPT_URL] = $this->readabilityUrl . '/extract?url=' . urlencode($articleUrl);
                break;
            case 'post_root':
                $baseOpts[CURLOPT_URL] = $this->readabilityUrl . '/';
                $baseOpts[CURLOPT_POST] = true;
                $baseOpts[CURLOPT_POSTFIELDS] = json_encode(['url' => $articleUrl]);
                $baseOpts[CURLOPT_HTTPHEADER] = ['Content-Type: application/json', 'Accept: application/json'];
                break;
            default:
                return ['ok' => false, 'error' => 'Unknown pattern: ' . $pattern, 'debug' => ''];
        }

        $requestUrl = $baseOpts[CURLOPT_URL];
        curl_setopt_array($ch, $baseOpts);
        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        $curlErrno = curl_errno($ch);
        curl_close($ch);

        $debugSnippet = 'Pattern: ' . $pattern . ' | URL: ' . $requestUrl
            . ' | HTTP ' . $httpCode
            . ' | Response: ' . mb_substr((string)$response, 0, 300);

        if ($response === false || $curlErrno !== 0) {
            return ['ok' => false, 'error' => 'Curl error: ' . $curlError . ' (errno=' . $curlErrno . ')', 'debug' => $debugSnippet];
        }

        if ($httpCode < 200 || $httpCode >= 300) {
            return ['ok' => false, 'error' => 'HTTP ' . $httpCode, 'debug' => $debugSnippet];
        }

        // HTTP 200 — endpoint is reachable, now check for content
        $data = json_decode($response, true);
        if (!is_array($data)) {
            return ['ok' => false, 'reachable' => true, 'error' => 'Response is not valid JSON', 'debug' => $debugSnippet];
        }

        // Try common response field names
        $html = $data['content'] ?? $data['html'] ?? $data['article'] ?? null;
        if (empty($html) || !is_string($html)) {
            $keys = implode(', ', array_keys($data));
            return ['ok' => false, 'reachable' => true, 'error' => 'No content in API response (keys: ' . $keys . '). The readability server could not extract article text — the page may be paywalled, require JavaScript, or block bots.', 'debug' => $debugSnippet];
        }

        if (mb_strlen(strip_tags($html)) < 50) {
            return ['ok' => false, 'reachable' => true, 'error' => 'Extracted content too short (' . mb_strlen(strip_tags($html)) . ' chars)', 'debug' => $debugSnippet];
        }

        return ['ok' => true, 'html' => $html];
    }

    public function getFetchStats(): array {
        return ['success' => $this->fetchSuccessCount, 'fail' => $this->fetchFailCount];
    }

    /**
     * Convert arbitrary HTML (from RSS feeds) into well-formed XHTML body content.
     * Uses DOMDocument to parse and re-serialize, which handles unclosed tags,
     * invalid entities, and produces clean XML output.
     */
    private function htmlToXhtml(string $html): string {
        if (trim($html) === '') {
            return '<p><em>(no content)</em></p>';
        }

        // Strip dangerous tags before DOM parsing
        $html = preg_replace('#<(script|style|iframe|object|embed|form)\b[^>]*>.*?</\1\s*>#si', '', $html);
        $html = preg_replace('#<(script|style|iframe|object|embed|form)\b[^>]*\s*/?\s*>#si', '', $html);

        // Remove event handlers
        $html = preg_replace('/\s+on[a-z]+\s*=\s*"[^"]*"/i', '', $html);
        $html = preg_replace("/\s+on[a-z]+\s*=\s*'[^']*'/i", '', $html);

        // Remove inline style attributes
        $html = preg_replace('/\s+style\s*=\s*"[^"]*"/i', '', $html);
        $html = preg_replace("/\s+style\s*=\s*'[^']*'/i", '', $html);

        // Wrap in a container so DOMDocument parses it as a fragment
        $wrapped = '<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"></head>'
            . '<body>' . $html . '</body></html>';

        // Suppress warnings from malformed HTML
        $prev = libxml_use_internal_errors(true);
        $dom = new DOMDocument('1.0', 'UTF-8');
        $dom->recover = true;
        $dom->substituteEntities = true;
        $dom->loadHTML($wrapped, LIBXML_NONET | LIBXML_NOWARNING);
        libxml_clear_errors();
        libxml_use_internal_errors($prev);

        // Remove width/height attributes from images
        $imgs = $dom->getElementsByTagName('img');
        for ($i = $imgs->length - 1; $i >= 0; $i--) {
            $img = $imgs->item($i);
            $img->removeAttribute('width');
            $img->removeAttribute('height');
        }

        // Extract just the inner content of <body>
        $body = $dom->getElementsByTagName('body')->item(0);
        if ($body === null) {
            return '<p><em>(no content)</em></p>';
        }

        $output = '';
        foreach ($body->childNodes as $child) {
            $output .= $dom->saveXML($child);
        }

        // If everything was stripped, show fallback
        if (trim($output) === '') {
            return '<p><em>(no content)</em></p>';
        }

        return $output;
    }

    private function buildCss(): string {
        $fs = $this->fontSize;
        return <<<CSS
body {
    margin: 8px;
    padding: 0;
    font-family: serif;
    font-size: {$fs}em;
    line-height: 1.45;
    color: #000;
    background: #fff;
}
.article-title {
    font-size: 1.15em;
    margin: 0 0 0.3em 0;
    line-height: 1.2;
}
.feed-name {
    font-size: 0.8em;
    color: #555;
    margin: 0 0 0.8em 0;
}
.article-body {
    font-size: 1em;
}
img {
    max-width: 100%;
    height: auto;
    display: block;
    margin: 0.5em auto;
}
table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85em;
}
pre, code {
    font-size: 0.85em;
    white-space: pre-wrap;
    word-break: break-all;
}
a {
    color: #000;
    text-decoration: underline;
}
.fetch-error {
    border: 1px solid #666;
    padding: 0.5em;
    margin: 0.5em 0;
    font-size: 0.85em;
}
.fetch-error p {
    margin: 0.2em 0;
}
.fetch-debug {
    word-break: break-all;
    color: #555;
}
CSS;
    }

    private function sourceLabel(string $key): string {
        if ($key === 'favorites') {
            return _t('ext.source_favorites');
        }
        if (strpos($key, 'cat_') === 0) {
            $catId = (int) substr($key, 4);
            try {
                $categoryDAO = FreshRSS_Factory::createCategoryDao();
                $cat = $categoryDAO->searchById($catId);
                if ($cat) {
                    return $cat->name();
                }
            } catch (Exception $e) {
                // ignore
            }
            return 'Category #' . $catId;
        }
        return $key;
    }

    private function sanitizeFilename(string $name): string {
        $name = str_replace(' ', '_', $name);
        $name = preg_replace('/[^\p{L}\p{N}_-]/u', '', $name);
        $name = preg_replace('/_+/', '_', $name);
        return trim($name, '_-') ?: 'export';
    }

    private function formatSize(int $bytes): string {
        if ($bytes < 1024) return $bytes . ' B';
        if ($bytes < 1048576) return round($bytes / 1024, 1) . ' KB';
        return round($bytes / 1048576, 1) . ' MB';
    }

    private function logPush(string $source, bool $success, string $message): void {
        $logFile = $this->outputDir . 'push_history.json';
        $history = [];
        if (file_exists($logFile)) {
            $history = json_decode(file_get_contents($logFile), true) ?: [];
        }
        
        array_unshift($history, [
            'time'    => date('Y-m-d H:i:s'),
            'source'  => $source,
            'success' => $success,
            'message' => $message
        ]);
        
        $history = array_slice($history, 0, 50);
        file_put_contents($logFile, json_encode($history));
    }

    public function getHistory(): array {
        $logFile = $this->outputDir . 'push_history.json';
        if (!file_exists($logFile)) return [];
        return json_decode(file_get_contents($logFile), true) ?: [];
    }

    public function clearHistory(): void {
        $logFile = $this->outputDir . 'push_history.json';
        if (file_exists($logFile)) @unlink($logFile);
    }
}