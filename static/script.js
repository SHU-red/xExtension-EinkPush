(function() {
    console.log('[EinkPush] Script loaded and initialized');
    if (window._epScriptLoaded) return;
    window._epScriptLoaded = true;

    // ── Loading / Status helpers ──
    function showLoading(btn) {
        if (!btn) return null;
        if (btn.classList.contains('ep-loading')) return null;
        const rect = btn.getBoundingClientRect();
        const originalHtml = btn.innerHTML;
        const originalWidth = btn.style.width;
        const originalHeight = btn.style.height;
        const originalClasses = Array.from(btn.classList);

        if (btn.id === 'ep-test-conn-btn' || btn.classList.contains('ep-inline-test-btn')) {
            btn.style.flexShrink = '0';
            btn.style.flexBasis = '130px';
        } else {
            btn.style.width = rect.width + 'px';
            btn.style.height = rect.height + 'px';
        }

        btn.classList.add('ep-loading');
        btn.innerHTML = '<span class="ep-spinner-inline"></span>';
        return { html: originalHtml, width: originalWidth, height: originalHeight, classes: originalClasses };
    }

    function setButtonStatus(btn, status, text, originalState) {
        if (!btn) return;
        btn.classList.remove('ep-loading', 'ep-btn-success', 'ep-btn-error', 'ep-btn-no-content');
        btn.style.pointerEvents = 'none';
        if (status === 'success') btn.classList.add('ep-btn-success');
        else if (status === 'error') btn.classList.add('ep-btn-error');
        else if (status === 'no-content') btn.classList.add('ep-btn-no-content');
        if (text) btn.innerHTML = text;
        setTimeout(() => hideLoading(btn, originalState), 3000);
    }

    function hideLoading(btn, originalState) {
        if (!btn) return;
        btn.classList.remove('ep-loading', 'ep-btn-success', 'ep-btn-error', 'ep-btn-no-content');
        btn.style.pointerEvents = 'auto';
        btn.style.opacity = '1';
        if (originalState) {
            btn.innerHTML = originalState.html;
            btn.style.width = originalState.width;
            btn.style.height = originalState.height;
            btn.style.flexShrink = '';
            btn.style.flexBasis = '';
            originalState.classes.forEach(c => btn.classList.add(c));
        }
    }

    function getLabels() {
        const script = document.querySelector('script[src*="EinkPush/static/script.js"]');
        if (!script) return {};
        const urlParams = new URLSearchParams(script.src.split('?')[1]);
        return {
            noArticles: urlParams.get('b_na') ? decodeURIComponent(urlParams.get('b_na')) : 'No articles',
            success: urlParams.get('b_s') ? decodeURIComponent(urlParams.get('b_s')) : 'Success',
            error: urlParams.get('b_e') ? decodeURIComponent(urlParams.get('b_e')) : 'Error'
        };
    }

    // ── Tab Switching ──
    function activateTab(navItem) {
        if (!navItem) return null;
        const wrapper = navItem.closest('.ep-wrapper');
        if (!wrapper) return null;
        const target = navItem.getAttribute('data-target');
        if (!target) return null;
        const navItems = wrapper.querySelectorAll('.ep-nav-item');
        const sections = wrapper.querySelectorAll('.ep-section');
        let sectionFound = false;
        sections.forEach(section => {
            const isTarget = section.id === target;
            section.classList.toggle('active', isTarget);
            if (isTarget) sectionFound = true;
        });
        navItems.forEach(item => item.classList.toggle('active', item === navItem));
        return sectionFound ? target : null;
    }

    // ── Progress Modal ──
    let activePushAbort = null;
    let pushPollTimer = null;

    function epShowProgressModal(title) {
        let overlay = document.getElementById('ep-progress-overlay');
        if (overlay) overlay.remove();
        overlay = document.createElement('div');
        overlay.id = 'ep-progress-overlay';
        overlay.className = 'ep-progress-overlay';
        const bodyStyle = getComputedStyle(document.body);
        const bg = bodyStyle.backgroundColor || '#ffffff';
        const fg = bodyStyle.color || '#333333';
        const accent = '#e66a19';
        const muted = '#888';
        overlay.innerHTML = `
            <div class="ep-progress-box">
                <div class="ep-progress-header">
                    <span id="ep-progress-title">${title || 'Processing...'}</span>
                    <span class="ep-progress-close">✕</span>
                </div>
                <div class="ep-progress-bar-bg">
                    <div id="ep-progress-bar-fill" class="ep-progress-bar-fill"></div>
                </div>
                <div id="ep-progress-status" class="ep-progress-status"></div>
                <div id="ep-progress-detail" class="ep-progress-detail"></div>
            </div>`;
        document.body.appendChild(overlay);
        const box = overlay.querySelector('.ep-progress-box');
        box.style.cssText = 'background-color:' + bg + ';color:' + fg + ';border:1px solid ' + muted +
            ';border-radius:8px;padding:16px;max-width:400px;width:90%;box-shadow:0 4px 24px rgba(0,0,0,0.3);font-family:inherit;';
        overlay.querySelector('.ep-progress-header').style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;';
        overlay.querySelector('#ep-progress-title').style.cssText = 'font-weight:bold;font-size:14px;';
        const closeBtn = overlay.querySelector('.ep-progress-close');
        closeBtn.style.cssText = 'cursor:pointer;opacity:0.6;';
        closeBtn.onclick = () => {
            if (activePushAbort) activePushAbort.abort();
            if (pushPollTimer) clearInterval(pushPollTimer);
            overlay.remove();
        };
        overlay.querySelector('.ep-progress-bar-bg').style.cssText = 'height:6px;border-radius:3px;overflow:hidden;margin-bottom:10px;background:' + muted + '33;';
        overlay.querySelector('#ep-progress-bar-fill').style.cssText = 'height:100%;width:0%;background:' + accent + ';border-radius:3px;transition:width 0.3s ease;';
        overlay.querySelector('#ep-progress-status').style.cssText = 'font-size:13px;margin-bottom:4px;font-weight:500;';
        overlay.querySelector('#ep-progress-detail').style.cssText = 'font-size:11px;color:' + muted + ';';
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
        return overlay;
    }

    function epUpdateProgress(percent, status, detail, isError) {
        const fill = document.getElementById('ep-progress-bar-fill');
        const statusEl = document.getElementById('ep-progress-status');
        const detailEl = document.getElementById('ep-progress-detail');
        if (fill) fill.style.width = percent + '%';
        if (statusEl) {
            statusEl.textContent = status;
            statusEl.style.color = isError ? '#d32f2f' : '';
        }
        if (detailEl) detailEl.textContent = detail || '';
    }

    function in_array(needle, haystack) {
        return haystack.indexOf(needle) !== -1;
    }

    function epHandleProgress(data) {
        switch(data.step) {
            case 'starting':
                epUpdateProgress(0, data.message || 'Starting...', '');
                break;
            case 'test_connection':
                epUpdateProgress(0, data.message || 'Testing connection...', '');
                break;
            case 'connection_ok':
                epUpdateProgress(5, data.message || 'Connection OK!', 'Starting EPUB generation...');
                break;
            case 'generating':
                epUpdateProgress(5, 'Generating EPUBs...', (data.source || '') + ' (' + (data.sourceIndex || 0) + '/' + (data.totalSources || 0) + ')');
                break;
            case 'collecting':
                epUpdateProgress(5, 'Collecting...', (data.source || '') + ' - fetching articles');
                break;
            case 'building':
                epUpdateProgress(10, 'Building EPUB...', (data.source || '') + ' (' + (data.articles || 0) + ' articles)');
                break;
            case 'source_progress':
                epUpdateProgress(5, 'Collecting articles...', (data.source || '') + ' (' + (data.totalArticles || 0) + ' articles)');
                break;
            case 'source_empty':
                epUpdateProgress(0, '', (data.source || '') + ': no articles');
                break;
            case 'article':
                const pct = data.percent || Math.round(((data.articleIndex || 0) / Math.max(1, data.totalInSource || 1)) * 100);
                epUpdateProgress(pct, 'Processing: ' + (data.source || ''),
                    'Article ' + (data.processedAllArticles || 0) + '/' + (data.totalAllArticles || 0) + ' (' + pct + '%)');
                break;
            case 'pushing':
                epUpdateProgress(90, 'Pushing to device...',
                    (data.source || '') + ' (' + (data.fileIndex || 0) + '/' + (data.totalFiles || 0) + ')');
                break;
            case 'no_content':
                epUpdateProgress(100, 'No articles', data.message || 'Nothing to push.');
                setTimeout(() => document.getElementById('ep-progress-overlay')?.remove(), 2000);
                break;
            case 'done':
                epUpdateProgress(100, data.message || 'Done!', (data.success || 0) + ' EPUB(s) ready');
                break;
            case 'done_with_errors':
                epUpdateProgress(100, data.message || 'Done with errors',
                    (data.success || 0) + ' ok, ' + (data.failed || 0) + ' failed', true);
                break;
            case 'error':
                epUpdateProgress(100, data.message || 'Error', '', true);
                setTimeout(() => document.getElementById('ep-progress-overlay')?.remove(), 3000);
                break;
        }
    }

    // ── Unified Push (with optional source) ──
    function epStreamPush(source) {
        if (activePushAbort) activePushAbort.abort();
        if (pushPollTimer) clearInterval(pushPollTimer);
        activePushAbort = new AbortController();
        epShowProgressModal('Pushing to device...');
        epUpdateProgress(0, 'Starting...', '');

        let url = './?c=EinkPush&a=pushRun&' + Date.now();
        if (source) url += '&source=' + encodeURIComponent(source);

        fetch(url, { signal: activePushAbort.signal })
            .then(r => r.json())
            .then(data => {
                if (data.status === 'error') {
                    epUpdateProgress(100, data.message || 'Error', '', true);
                    setTimeout(() => document.getElementById('ep-progress-overlay')?.remove(), 3000);
                    activePushAbort = null;
                    return;
                }
                if (data.job) startPushPoll(data.job, 'push');
            })
            .catch(err => {
                if (err.name !== 'AbortError') {
                    epUpdateProgress(100, 'Error: ' + err.message, '', true);
                }
                activePushAbort = null;
            });
    }

    // ── Unified Generate (EPUB generation with progress) ──
    function epStreamGenerate(source) {
        if (activePushAbort) activePushAbort.abort();
        if (pushPollTimer) clearInterval(pushPollTimer);
        activePushAbort = new AbortController();
        epShowProgressModal('Generating EPUB...');
        epUpdateProgress(0, 'Starting...', '');

        let url = './?c=EinkPush&a=generateRun&' + Date.now();
        if (source) url += '&source=' + encodeURIComponent(source);

        fetch(url, { signal: activePushAbort.signal })
            .then(r => r.json())
            .then(data => {
                if (data.status === 'error') {
                    epUpdateProgress(100, data.message || 'Error', '', true);
                    setTimeout(() => document.getElementById('ep-progress-overlay')?.remove(), 3000);
                    activePushAbort = null;
                    return;
                }
                if (data.job) startPushPoll(data.job, 'generate');
            })
            .catch(err => {
                if (err.name !== 'AbortError') {
                    epUpdateProgress(100, 'Error: ' + err.message, '', true);
                }
                activePushAbort = null;
            });
    }

    // ── Polling ──
    function startPushPoll(jobId, mode) {
        let lastStep = '';
        let lastTime = 0;
        let lastMessage = '';
        let timeout = 600000;
        let timedOut = false;

        pushPollTimer = setInterval(() => {
            if (timedOut) return;
            fetch('./?c=EinkPush&a=pushStatus&job=' + encodeURIComponent(jobId) + '&_=' + Date.now())
                .then(r => r.json())
                .then(data => {
                    if (!data || !data.step) return;
                    if (data.time) {
                        var ts = Math.floor(data.time * 1000);
                        if (lastTime > 0 && ts === lastTime && (Date.now() - lastTime) > timeout) {
                            timedOut = true;
                            clearInterval(pushPollTimer);
                            pushPollTimer = null;
                            epUpdateProgress(100, 'Timeout', 'Worker may have crashed.', true);
                            setTimeout(() => {
                                document.getElementById('ep-progress-overlay')?.remove();
                                window.location.reload();
                            }, 3000);
                            activePushAbort = null;
                            return;
                        }
                        lastTime = ts;
                    }
                    if (data.step !== lastStep || (data.message && data.message !== lastMessage)) {
                        lastStep = data.step;
                        lastMessage = data.message || '';
                        epHandleProgress(data);
                    } else {
                        const dots = '.'.repeat((Math.floor(Date.now() / 500) % 4));
                        const statusEl = document.getElementById('ep-progress-status');
                        if (statusEl && statusEl.textContent) {
                            statusEl.textContent = statusEl.textContent.replace(/\.+$/, '') + dots;
                        }
                    }
                    if (in_array(data.step, ['done', 'done_with_errors', 'no_content'])) {
                        clearInterval(pushPollTimer);
                        pushPollTimer = null;
                        if (mode === 'generate' && (data.step === 'done' || data.step === 'done_with_errors')) {
                            // Download generated EPUBs via iframe trigger
                            setTimeout(() => {
                                document.getElementById('ep-progress-overlay')?.remove();
                                triggerDownloads(jobId, data);
                            }, 1000);
                        } else if (data.step === 'done' || data.step === 'done_with_errors') {
                            setTimeout(() => {
                                document.getElementById('ep-progress-overlay')?.remove();
                                window.location.reload();
                            }, 1500);
                        } else {
                            setTimeout(() => document.getElementById('ep-progress-overlay')?.remove(), 2500);
                        }
                        activePushAbort = null;
                    } else if (data.step === 'error') {
                        clearInterval(pushPollTimer);
                        pushPollTimer = null;
                        setTimeout(() => document.getElementById('ep-progress-overlay')?.remove(), 3000);
                        activePushAbort = null;
                    }
                })
                .catch(() => {});
        }, 400);
    }

    // After generate completes, trigger browser downloads
    function triggerDownloads(jobId, data) {
        const sources = data.generatedSources || [];
        if (sources.length > 0) {
            sources.forEach(function(src) {
                const iframe = document.createElement('iframe');
                iframe.className = 'ep-hidden';
                iframe.src = './?c=EinkPush&a=downloadFile&source=' + encodeURIComponent(src) + '&_=' + Date.now();
                document.body.appendChild(iframe);
                setTimeout(() => iframe.remove(), 60000);
            });
        } else {
            window.location.reload();
        }
    }

    // ── Cookie polling (legacy for download) ──
    function pollCookie(expectedSources, btn, originalState) {
        const labels = getLabels();
        const errorMatch = document.cookie.match(/ep_dl_error=([^;]+)/);
        if (errorMatch) {
            document.cookie = 'ep_dl_error=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
            setButtonStatus(btn, 'error', labels.error, originalState);
            return;
        }
        if (expectedSources.length > 0) {
            let allDone = true;
            expectedSources.forEach(src => {
                if (document.cookie.indexOf('ep_dl_' + src + '=1') === -1) allDone = false;
            });
            if (allDone) {
                expectedSources.forEach(src => {
                    document.cookie = 'ep_dl_' + src + '=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
                });
                setButtonStatus(btn, 'success', labels.success, originalState);
            } else {
                setTimeout(() => pollCookie(expectedSources, btn, originalState), 1000);
            }
        } else {
            if (document.cookie.indexOf('ep_dl_complete=1') !== -1) {
                document.cookie = 'ep_dl_complete=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
                setButtonStatus(btn, 'success', labels.success, originalState);
            } else {
                setTimeout(() => pollCookie([], btn, originalState), 1000);
            }
        }
    }

    // ── Preview Modal ──
    function showPreview(html) {
        let overlay = document.getElementById('ep-preview-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'ep-preview-overlay';
            overlay.className = 'ep-modal-overlay';
            overlay.innerHTML = `
                <div class="ep-modal">
                    <div class="ep-modal-header">
                        <h3 id="ep-preview-title">Preview</h3>
                        <span class="ep-progress-close" id="ep-preview-close">✕</span>
                    </div>
                    <div id="ep-preview-body" class="ep-modal-body"></div>
                    <div class="ep-modal-footer">
                        <button type="button" class="ep-btn" id="ep-preview-close-btn">Close</button>
                    </div>
                </div>`;
            document.body.appendChild(overlay);
            const close = () => overlay.remove();
            document.getElementById('ep-preview-close').onclick = close;
            document.getElementById('ep-preview-close-btn').onclick = close;
            overlay.onclick = (e) => { if (e.target === overlay) close(); };
        }
        document.getElementById('ep-preview-body').innerHTML = html;
        return overlay;
    }

    // ── Main Click Handler (capture phase) ──
    document.addEventListener('click', function(e) {
        try {
            // Tab Switching
            const navItem = e.target.closest('.ep-nav-item');
            if (navItem) {
                e.preventDefault();
                e.stopPropagation();
                const activeTab = activateTab(navItem);
                if (activeTab) {
                    try { localStorage.setItem('ep_active_tab', activeTab); } catch(ex) {}
                }
                return;
            }

            const wrapper = e.target.closest('.ep-wrapper');
            if (wrapper) {
                // Regenerate Token
                const regenBtn = e.target.closest('.ep-btn-regenerate');
                if (regenBtn) {
                    e.preventDefault();
                    if (confirm('Are you sure? All existing API URLs will stop working.')) {
                        window.location.href = regenBtn.href;
                    }
                    return;
                }

                // Test Connection
                const testBtn = e.target.closest('.ep-btn-test');
                if (testBtn) {
                    e.preventDefault();
                    const orig = showLoading(testBtn);
                    const labels = getLabels();
                    const testUrl = testBtn.getAttribute('data-url') || testBtn.href;
                    fetch(testUrl + (testUrl.includes('?') ? '&' : '?') + 'silent=1')
                        .then(async r => {
                            let isError = !r.ok;
                            let testMessage = '';
                            let deviceInfo = null;
                            try {
                                const data = await r.clone().json();
                                if (data && data.status === 'error') {
                                    isError = true;
                                    testMessage = data.message || 'Test failed';
                                    throw new Error(testMessage);
                                } else {
                                    testMessage = data.message || labels.success;
                                    if (data.deviceInfo) deviceInfo = data.deviceInfo;
                                }
                            } catch (err) {
                                if (isError) throw new Error('HTTP ' + r.status);
                                testMessage = labels.success;
                            }
                            if (!isError && deviceInfo) {
                                const statusDiv = document.querySelector('.ep-device-status');
                                if (statusDiv) {
                                    statusDiv.innerHTML = '<div class="ep-device-badges">' +
                                        '<span class="ep-badge">📦 ' + (deviceInfo.version || 'N/A') + '</span>' +
                                        '<span class="ep-badge">📡 ' + (deviceInfo.ip || 'N/A') + '</span>' +
                                        '<span class="ep-badge">⚡ ' + (deviceInfo.mode || 'N/A') + '</span>' +
                                        '<span class="ep-badge">📶 ' + (deviceInfo.rssi !== undefined ? deviceInfo.rssi + ' dBm' : 'N/A') + '</span>' +
                                        '<span class="ep-badge">💾 ' + (deviceInfo.freeHeap !== undefined ? deviceInfo.freeHeap + ' B' : 'N/A') + '</span>' +
                                        '<span class="ep-badge">⏱ ' + (deviceInfo.uptime !== undefined ? Math.floor(deviceInfo.uptime/3600) + 'h ' + Math.floor((deviceInfo.uptime%3600)/60) + 'm' : 'N/A') + '</span>' +
                                        '</div>';
                                }
                            }
                            setButtonStatus(testBtn, isError ? 'error' : 'success', testMessage, orig);
                        })
                        .catch(err => setButtonStatus(testBtn, 'error', labels.error, orig));
                    return;
                }

                // Preview
                const previewBtn = e.target.closest('.ep-btn-preview');
                if (previewBtn) {
                    e.preventDefault();
                    const orig = showLoading(previewBtn);
                    const labels = getLabels();
                    fetch(previewBtn.href)
                        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
                        .then(html => { showPreview(html); hideLoading(previewBtn, orig); })
                        .catch(err => setButtonStatus(previewBtn, 'error', labels.error, orig));
                    return;
                }

                // ── Intercept individual Push buttons (pushSingle) ──
                const pushSingleBtn = e.target.closest('a[href*="a=pushSingle"]');
                if (pushSingleBtn) {
                    e.preventDefault();
                    e.stopPropagation();
                    const href = pushSingleBtn.href || '';
                    const srcMatch = href.match(/source=([^&]+)/);
                    const src = srcMatch ? decodeURIComponent(srcMatch[1]) : null;
                    epStreamPush(src);
                    return;
                }

                // ── Intercept "Push All" button ──
                const pushAllBtn = e.target.closest('#ep-push-all-btn, a[href*="a=push"]:not([href*="source="]):not([href*="a=pushSingle"])');
                if (pushAllBtn) {
                    e.preventDefault();
                    e.stopPropagation();
                    epStreamPush();
                    return;
                }

                // ── Intercept individual Download buttons (generate?source=X) ──
                const dlSingleBtn = e.target.closest('a[href*="a=generate"][href*="source="]');
                if (dlSingleBtn) {
                    e.preventDefault();
                    e.stopPropagation();
                    const href = dlSingleBtn.href || '';
                    const srcMatch = href.match(/source=([^&]+)/);
                    const src = srcMatch ? decodeURIComponent(srcMatch[1]) : null;
                    epStreamGenerate(src);
                    return;
                }

                // ── Intercept "Download All" (generate without source) ──
                const dlAllBtn = e.target.closest('a[href*="a=generate"]:not([href*="source="])');
                if (dlAllBtn) {
                    e.preventDefault();
                    e.stopPropagation();
                    epStreamGenerate();
                    return;
                }
            }

            // Unified push: sidebar button
            const pushTrigger = e.target.closest('#ep-sidebar-push-now');
            if (pushTrigger) {
                e.preventDefault();
                e.stopPropagation();
                epStreamPush();
                return;
            }
        } catch (err) {
            console.error('[EinkPush] Error in click handler:', err);
        }

        // Accordion for Source Details
        const sourceMain = e.target.closest('.ep-source-main');
        if (sourceMain) {
            if (e.target.closest('.ep-source-actions') || e.target.closest('.ep-switch')) return;
            const details = sourceMain.nextElementSibling;
            if (details && details.classList.contains('ep-source-details')) {
                details.classList.toggle('open');
            }
        }

        // Select all text in cron command input
        if (e.target.classList.contains('ep-cron-cmd-input')) {
            e.target.select();
        }
    }, true);

    // ── Restore tab on load ──
    function restoreTab() {
        try {
            const savedTab = localStorage.getItem('ep_active_tab');
            if (savedTab) {
                const tabBtn = document.querySelector('.ep-nav-item[data-target="' + savedTab + '"]');
                if (tabBtn) activateTab(tabBtn);
            }
        } catch (err) {}
    }
    document.addEventListener('DOMContentLoaded', restoreTab);

    // ── Sidebar Injection ──
    function injectSidebarButton() {
        const script = document.querySelector('script[src*="EinkPush/static/script.js"]');
        if (!script) return;
        const urlParams = new URLSearchParams(script.src.split('?')[1]);
        const showSidebar = urlParams.get('sb') === '1';

        if (!showSidebar) {
            const existingBtn = document.getElementById('ep-sidebar-btn-main');
            if (existingBtn) existingBtn.remove();
            return;
        }
        if (document.getElementById('ep-sidebar-btn-main')) return;

        // Check if on settings page
        const href = window.location.href;
        const isOnSettingsPage =
            document.querySelector('.setting-nav') ||
            document.querySelector('#settings-menu') ||
            document.querySelector('#extensions-container') ||
            document.querySelector('.extensions-list') ||
            document.querySelector('input[name="title_feed"]') ||
            document.querySelector('fieldset[data-formname="feed"]');
        const isSettingsUrl =
            href.includes('c=extension') ||
            href.includes('c=pref') ||
            href.includes('c=subscription') ||
            href.includes('p=login');

        if (isOnSettingsPage || isSettingsUrl) return;

        function createSidebarContent() {
            // Clone styles from native blue button (#btn-subscription)
            let nativeBtn = document.querySelector('#btn-subscription');
            let stick = document.querySelector('.stick.configure-feeds');

            let btnWidth = null;
            let btnBorderRadius = '2px';
            let btnBorder = '1px solid var(--frss-border-color, #333)';
            let btnPadding = '0.25rem 0.5rem';
            let btnFontFamily = '"OpenSans", Cantarell, Helvetica, Arial, sans-serif';
            let btnFontSize = '0.9rem';
            let btnLineHeight = '1.7';
            let btnMinHeight = '28px';

            if (nativeBtn) {
                let cs = window.getComputedStyle(nativeBtn);
                btnWidth = cs.width;
                btnBorderRadius = cs.borderRadius;
                btnBorder = cs.border;
                btnPadding = cs.paddingTop + ' ' + cs.paddingRight + ' ' + cs.paddingBottom + ' ' + cs.paddingLeft;
                btnFontFamily = cs.fontFamily;
                btnFontSize = cs.fontSize;
                btnLineHeight = cs.lineHeight;
                btnMinHeight = cs.height;
            } else if (stick) {
                let cs = window.getComputedStyle(stick);
                btnWidth = cs.width;
                btnBorderRadius = cs.borderRadius;
                btnBorder = cs.border;
                btnPadding = cs.paddingTop + ' ' + cs.paddingRight + ' ' + cs.paddingBottom + ' ' + cs.paddingLeft;
            }

            // Wrapper to sit below native buttons
            const wrapper = document.createElement('div');
            wrapper.style.padding = '4px 0';

            // Orange button - clone native button styles exactly
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.id = 'ep-sidebar-push-now';
            btn.title = 'E-INK PUSH';
            btn.className = nativeBtn ? nativeBtn.className : 'btn btn-important';
            if (btnWidth) btn.style.width = btnWidth;
            btn.style.boxSizing = 'border-box';
            btn.style.borderRadius = btnBorderRadius;
            btn.style.border = btnBorder;
            btn.style.background = '#e66a19';
            btn.style.color = '#fff';
            btn.style.minHeight = btnMinHeight;
            btn.style.cursor = 'pointer';
            btn.style.fontFamily = btnFontFamily;
            btn.style.fontSize = btnFontSize;
            btn.style.lineHeight = btnLineHeight;
            btn.style.fontWeight = 'normal';
            btn.style.padding = btnPadding;
            btn.style.display = 'flex';
            btn.style.alignItems = 'center';
            btn.style.justifyContent = 'space-between';
            btn.style.whiteSpace = 'nowrap';
            btn.style.overflow = 'hidden';
            btn.style.textOverflow = 'ellipsis';
            btn.style.margin = '0';
            btn.style.outline = 'none';
            btn.onmouseover = () => btn.style.background = '#d45d15';
            btn.onmouseout = () => btn.style.background = '#e66a19';

            // Left: E-INK PUSH text
            const textSpan = document.createElement('span');
            textSpan.style.flex = '1';
            textSpan.style.textAlign = 'left';
            textSpan.textContent = 'E-INK PUSH';

            // Right: gear icon (like + button on blue)
            const iconSpan = document.createElement('span');
            iconSpan.style.width = '36px';
            iconSpan.style.minWidth = '36px';
            iconSpan.style.display = 'flex';
            iconSpan.style.alignItems = 'center';
            iconSpan.style.justifyContent = 'center';
            iconSpan.textContent = '⚙️';

            btn.appendChild(textSpan);
            btn.appendChild(iconSpan);
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                epStreamPush();
            });

            wrapper.appendChild(btn);
            return wrapper;
        }

        const container = document.createElement('div');
        container.id = 'ep-sidebar-btn-main';
        container.appendChild(createSidebarContent());

        const asideFeed = document.querySelector('#aside_feed');
        if (asideFeed) {
            const stick = asideFeed.querySelector('.stick.configure-feeds');
            if (stick) {
                // Insert below native buttons (co-exist)
                stick.parentNode.insertBefore(container, stick.nextSibling);
            } else {
                const tree = asideFeed.querySelector('.tree');
                if (tree) tree.parentNode.insertBefore(container, tree);
                else asideFeed.insertBefore(container, asideFeed.firstChild);
            }
            return;
        }

        const subManage = Array.from(document.querySelectorAll('a')).find(a =>
            (a.getAttribute('href') || '').includes('a=subscription')
        );
        if (subManage) {
            const parent = subManage.closest('li, .item');
            if (parent) parent.parentNode.insertBefore(container, parent.nextSibling);
        }
    }

    const epObserver = new MutationObserver((mutations) => {
        for (let mutation of mutations) {
            if (mutation.type === 'childList') {
                injectSidebarButton();
            }
        }
    });

    function startInjection() {
        injectSidebarButton();
        if (document.body) {
            epObserver.observe(document.body, { childList: true, subtree: true });
        }
    }

    // Auto-update push endpoint
    function updatePushEndpoint() {
        const deviceAddressInput = document.querySelector('input[name="device_address"]');
        const folderNameInput = document.querySelector('input[name="folder_name"]');
        const pushEndpointInput = document.querySelector('input[name="push_endpoint"]');
        if (deviceAddressInput && folderNameInput && pushEndpointInput) {
            const cleanAddress = deviceAddressInput.value.trim().replace(/\/?$/, '');
            const cleanFolder = folderNameInput.value.trim().replace(/^\/*/, '').replace(/\/*$/, '');
            pushEndpointInput.value = cleanAddress + '/upload?path=/' + cleanFolder;
        }
    }

    function setupEndpointUpdater() {
        const deviceAddressInput = document.querySelector('input[name="device_address"]');
        const folderNameInput = document.querySelector('input[name="folder_name"]');
        if (deviceAddressInput && folderNameInput) {
            deviceAddressInput.addEventListener('input', updatePushEndpoint);
            folderNameInput.addEventListener('input', updatePushEndpoint);
            updatePushEndpoint();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            startInjection();
            setupEndpointUpdater();
        });
    } else {
        startInjection();
        setupEndpointUpdater();
    }

    setInterval(injectSidebarButton, 2000);
})();
