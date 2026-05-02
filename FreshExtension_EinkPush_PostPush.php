<?php
/**
 * Post-push/download cleanup: mark articles as read and un-favorite.
 *
 * Called after successful EPUB generation + push (or just generation for download).
 * Only acts on sources where markAsRead or removeFromFavorites is enabled.
 */
class EinkPush_PostPush {

    /**
     * Process all sources after push/generate.
     *
     * @param array $sourceEntryIds  sourceKey => [entry_id, ...]
     * @param array $sources         sourceKey => sourceConfig
     * @param array $paths           sourceKey => filePath (only generated sources)
     */
    public static function cleanupEntries(array $sourceEntryIds, array $sources, array $paths): void {
        if (empty($sourceEntryIds)) {
            return;
        }

        $entryDAO = FreshRSS_Factory::createEntryDao();
        $allIdsToMarkRead = [];
        $allIdsToUnfavorite = [];

        foreach ($sourceEntryIds as $sourceKey => $entryIds) {
            if (empty($entryIds)) {
                continue;
            }

            // Skip sources where EPUB was not generated
            if (!isset($paths[$sourceKey])) {
                continue;
            }

            $srcCfg = $sources[$sourceKey] ?? [];

            // Mark as read if enabled for this source
            if (!empty($srcCfg['markAsRead'])) {
                foreach ($entryIds as $id) {
                    $allIdsToMarkRead[] = $id;
                }
            }

            // Un-favorite: always for favorites source, or if removeFromFavorites enabled
            if ($sourceKey === 'favorites' || !empty($srcCfg['removeFromFavorites'])) {
                foreach ($entryIds as $id) {
                    $allIdsToUnfavorite[] = $id;
                }
            }
        }

        // Batch mark as read (deduplicate)
        if (!empty($allIdsToMarkRead)) {
            $allIdsToMarkRead = array_values(array_unique($allIdsToMarkRead));
            try {
                $entryDAO->markRead($allIdsToMarkRead, true);
                error_log('[EinkPush] PostPush: marked ' . count($allIdsToMarkRead) . ' articles as read');
            } catch (Exception $e) {
                error_log('[EinkPush] PostPush markAsRead error: ' . $e->getMessage());
            }
        }

        // Batch un-favorite (deduplicate)
        if (!empty($allIdsToUnfavorite)) {
            $allIdsToUnfavorite = array_values(array_unique($allIdsToUnfavorite));
            try {
                $entryDAO->markFavorite($allIdsToUnfavorite, false);
                error_log('[EinkPush] PostPush: unfavorited ' . count($allIdsToUnfavorite) . ' articles');
            } catch (Exception $e) {
                error_log('[EinkPush] PostPush removeFromFavorites error: ' . $e->getMessage());
            }
        }
    }
}
