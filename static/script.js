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

    // ── Progress Stack (compact, persistent, lower-right) ──
    let activeJobs = {}; // jobId -> { abort, poll, bar, mode }

    function getStack() {
        let s = document.getElementById('ep-progress-stack');
        if (!s) {
            s = document.createElement('div');
            s.id = 'ep-progress-stack';
            s.className = 'ep-progress-stack';
            document.body.appendChild(s);
        }
        return s;
    }

    function epCreateBar(jobId, title, mode) {
        const stack = getStack();
        const bar = document.createElement('div');
        bar.className = 'ep-progress-bar';
        bar.dataset.jobId = jobId;
        bar.innerHTML = `
            <div class="ep-progress-bar-inner">
                <div class="ep-progress-bar-fill-bg"></div>
                <div class="ep-progress-bar-fill"></div>
                <span class="ep-progress-bar-text">${title || 'Starting...'}</span>
                ${mode === 'generate' ? '<a class="ep-progress-bar-dl" title="Download EPUB">⬇</a>' : ''}
            </div>
            <button class="ep-progress-bar-close" title="Cancel">✕</button>`;
        bar.querySelector('.ep-progress-bar-close').onclick = () => {
            const jobRef = activeJobs[jobId];
            if (jobRef) {
                if (jobRef.abort) jobRef.abort.abort();
                if (jobRef.poll) clearInterval(jobRef.poll);
                delete activeJobs[jobId];
            }
            bar.remove();
            if (stack.children.length === 0) stack.remove();
        };
        stack.appendChild(bar);
        return bar;
    }

    function epFindBar(jobId) {
        const stack = document.getElementById('ep-progress-stack');
        if (!stack) return null;
        return stack.querySelector('[data-job-id="' + jobId + '"]') || stack.lastElementChild;
    }

    function epUpdateBar(bar, percent, text, isError) {
        if (!bar) return;
        const fill = bar.querySelector('.ep-progress-bar-fill');
        const txt = bar.querySelector('.ep-progress-bar-text');
        if (fill) fill.style.width = Math.min(100, Math.max(0, percent)) + '%';
        if (txt) {
            txt.textContent = text || '';
            txt.classList.toggle('error', !!isError);
        }
    }

    function epShowDownload(bar, sourceKey) {
        if (!bar) return;
        const dl = bar.querySelector('.ep-progress-bar-dl');
        if (dl) {
            dl.href = './?c=EinkPush&a=downloadFile&source=' + encodeURIComponent(sourceKey);
            dl.classList.add('ep-dl-visible');
        }
    }

    function in_array(needle, haystack) {
        return haystack.indexOf(needle) !== -1;
    }

    function epHandleProgress(data) {
        const bar = epFindBar(activeJobId);
        if (!bar) return;
        epHandleProgressForBar(bar, data);
    }

    function epHandleProgressForBar(bar, data, srcOverride) {
        const src = srcOverride || data.source || '';
        let pct = 0, text = '', isError = false;
        switch(data.step) {
            case 'starting':
                text = data.message || 'Starting...';
                break;
            case 'test_connection':
                text = data.message || 'Testing...';
                break;
            case 'connection_ok':
                pct = 5;
                text = 'Connection OK' + (src ? ' — ' + src : '');
                break;
            case 'generating':
                pct = 5;
                text = 'Generating — ' + src;
                break;
            case 'collecting':
                pct = 5;
                text = 'Collecting — ' + src;
                break;
            case 'building':
                pct = 10;
                text = 'Building — ' + src + ' (' + (data.articles || 0) + ' articles)';
                break;
            case 'source_progress':
                pct = 5;
                text = 'Collecting — ' + src;
                break;
            case 'source_empty':
                text = src + ': no articles';
                break;
            case 'article':
                pct = data.percent || 50;
                text = src + ' — Article ' + (data.processedAllArticles || 0) + '/' + (data.totalAllArticles || 0);
                break;
            case 'pushing':
                pct = 90;
                text = 'Pushing — ' + src;
                break;
            case 'no_content':
                pct = 100;
                text = src ? src + ': no articles' : 'No articles';
                break;
            case 'done':
                pct = 100;
                text = (data.message || 'Done!') + (src ? ' — ' + src : '');
                break;
            case 'done_with_errors':
                pct = 100;
                text = (data.success || 0) + ' ok, ' + (data.failed || 0) + ' failed' + (src ? ' — ' + src : '');
                isError = true;
                break;
            case 'error':
                pct = 100;
                text = (data.message || 'Error') + (src ? ' — ' + src : '');
                isError = true;
                break;
        }
        epUpdateBar(bar, pct, text, isError);
    }

    // ── Concurrent job spawner (push or generate) ──
    function epSpawnJobs(mode) {
        // Collect all enabled sources from DOM
        var sources = [];
        var items = document.querySelectorAll('.ep-source-item');
        items.forEach(function(item) {
            var chk = item.querySelector('input[name$="[enabled]"]');
            if (chk && chk.checked) {
                var nameEl = item.querySelector('.ep-source-name');
                var name = nameEl ? nameEl.textContent.trim() : 'Unknown';
                var keyMatch = chk.name.match(/sources\[(.+)\]\[enabled\]/);
                sources.push({ key: keyMatch ? keyMatch[1] : 'main', label: name });
            }
        });
        if (sources.length === 0) {
            var bar = epCreateBar('job_none', 'No sources enabled', mode);
            epUpdateBar(bar, 100, 'No sources enabled', false);
            return;
        }

        sources.forEach(function(src) {
            var jobId = 'job_' + Date.now() + '_' + src.key;
            var abort = new AbortController();
            var bar = epCreateBar(jobId, src.label + ': Starting...', mode);
            activeJobs[jobId] = { abort: abort, poll: null, bar: bar, mode: mode, sourceKey: src.key };

            var action = mode === 'push' ? 'pushRun' : 'generateRun';
            var url = './?c=EinkPush&a=' + action + '&source=' + encodeURIComponent(src.key) + '&_=' + Date.now();

            fetch(url, { signal: abort.signal })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (data.status === 'error') {
                        epUpdateBar(bar, 100, 'Error: ' + (data.message || ''), true);
                        return;
                    }
                    if (data.job) {
                        startPushPoll(data.job, mode, jobId, src.label);
                    }
                })
                .catch(function(err) {
                    if (err.name !== 'AbortError') {
                        epUpdateBar(bar, 100, err.message, true);
                    }
                });
        });
    }

    // ── Legacy single-source push/generate ──
    function epStreamPush(source) {
        if (source) {
            epSpawnJobsForSource('push', source);
        } else {
            epSpawnJobs('push');
        }
    }
    function epStreamGenerate(source) {
        if (source) {
            epSpawnJobsForSource('generate', source);
        } else {
            epSpawnJobs('generate');
        }
    }

    function epSpawnJobsForSource(mode, sourceKey) {
        var jobId = 'job_' + Date.now() + '_' + sourceKey;
        var abort = new AbortController();
        var bar = epCreateBar(jobId, sourceKey + ': Starting...', mode);
        activeJobs[jobId] = { abort: abort, poll: null, bar: bar, mode: mode, sourceKey: sourceKey };

        var action = mode === 'push' ? 'pushRun' : 'generateRun';
        var url = './?c=EinkPush&a=' + action + '&source=' + encodeURIComponent(sourceKey) + '&_=' + Date.now();

        fetch(url, { signal: abort.signal })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.status === 'error') {
                    epUpdateBar(bar, 100, 'Error: ' + (data.message || ''), true);
                    return;
                }
                if (data.job) {
                    startPushPoll(data.job, mode, jobId, sourceKey);
                }
            })
            .catch(function(err) {
                if (err.name !== 'AbortError') {
                    epUpdateBar(bar, 100, err.message, true);
                }
            });
    }

    // ── Polling (per-job, concurrent) ──
    function startPushPoll(jobId, mode, clientJobId, sourceLabel) {
        var bar = activeJobs[clientJobId] ? activeJobs[clientJobId].bar : null;
        if (!bar) return;

        var lastStep = '';
        var lastTime = 0;
        var lastMessage = '';
        var timeout = 600000;
        var timedOut = false;

        var pollTimer = setInterval(function() {
            if (timedOut) return;
            fetch('./?c=EinkPush&a=pushStatus&job=' + encodeURIComponent(jobId) + '&_=' + Date.now())
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    if (!data || !data.step) return;
                    if (data.time) {
                        var ts = Math.floor(data.time * 1000);
                        if (lastTime > 0 && ts === lastTime && (Date.now() - lastTime) > timeout) {
                            timedOut = true;
                            clearInterval(pollTimer);
                            epUpdateBar(bar, 100, 'Timeout', true);
                            return;
                        }
                        lastTime = ts;
                    }
                    if (data.step !== lastStep || (data.message && data.message !== lastMessage)) {
                        lastStep = data.step;
                        lastMessage = data.message || '';
                        epHandleProgressForBar(bar, data, sourceLabel || data.source || '');
                    }
                    // Done states — bar stays, show download icon for generate mode
                    if (in_array(data.step, ['done', 'done_with_errors', 'no_content'])) {
                        clearInterval(pollTimer);
                        if (mode === 'generate' && data.step === 'done') {
                            epShowDownload(bar, activeJobs[clientJobId] ? activeJobs[clientJobId].sourceKey : '');
                        }
                        // Bar stays — user clicks X to dismiss
                    } else if (data.step === 'error') {
                        clearInterval(pollTimer);
                        epUpdateBar(bar, 100, data.message || 'Error', true);
                        // Bar stays
                    }
                })
                .catch(function() {});
        }, 400);

        if (activeJobs[clientJobId]) activeJobs[clientJobId].poll = pollTimer;
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
            // Read width/font from native elements
            let stick = document.querySelector('.stick.configure-feeds');
            let nativeBtn = document.querySelector('#btn-subscription');

            let btnBorderRadius = '4px';
            let btnBorder = '1px solid #333';
            let btnPadding = '0.5rem';
            let btnFontFamily = '"OpenSans", Cantarell, Helvetica, Arial, sans-serif';
            let btnFontSize = '0.9rem';
            let btnLineHeight = '1.7';

            if (stick) {
                let cs = window.getComputedStyle(stick);
                btnBorderRadius = cs.borderRadius;
                btnBorder = cs.border;
                btnPadding = cs.paddingTop + ' ' + cs.paddingRight + ' ' + cs.paddingBottom + ' ' + cs.paddingLeft;
            }
            if (nativeBtn) {
                let cs = window.getComputedStyle(nativeBtn);
                btnFontFamily = cs.fontFamily;
                btnFontSize = cs.fontSize;
                btnLineHeight = cs.lineHeight;
            }

            // Wrapper - copy exact native stick style
            const wrapper = document.createElement('div');
            wrapper.className = 'stick';
            wrapper.style.display = 'inline-flex';
            wrapper.style.maxWidth = '100%';
            wrapper.style.whiteSpace = 'nowrap';
            wrapper.style.verticalAlign = 'middle';
            if (stick) {
                let cs = window.getComputedStyle(stick);
                wrapper.style.width = cs.width;
                wrapper.style.padding = cs.padding;
                wrapper.style.marginTop = cs.marginTop;
                wrapper.style.marginBottom = cs.marginBottom;
            }

            // Left: main text button - copy exact native btn-subscription style
            const btnMain = document.createElement('button');
            btnMain.type = 'button';
            btnMain.id = 'ep-sidebar-push-now';
            btnMain.className = 'btn btn-important';
            if (nativeBtn) {
                let cs = window.getComputedStyle(nativeBtn);
                btnMain.style.padding = cs.padding;
                btnMain.style.borderRadius = cs.borderRadius;
                btnMain.style.borderTopRightRadius = '0';
                btnMain.style.borderBottomRightRadius = '0';
                btnMain.style.fontFamily = cs.fontFamily;
                btnMain.style.fontSize = cs.fontSize;
                btnMain.style.lineHeight = cs.lineHeight;
                btnMain.style.fontWeight = cs.fontWeight;
            }
            btnMain.style.background = '#c45510';
            btnMain.style.color = '#ffffff';
            btnMain.style.border = '1px solid #e87a30';
            btnMain.style.cursor = 'pointer';
            btnMain.style.whiteSpace = 'nowrap';
            btnMain.style.overflow = 'hidden';
            btnMain.style.textOverflow = 'ellipsis';
            btnMain.style.outline = 'none';
            btnMain.style.flex = '1';
            btnMain.style.textAlign = 'center';
            btnMain.textContent = 'E-INK PUSH';
            btnMain.onmouseover = () => btnMain.style.background = '#a84810';
            btnMain.onmouseout = () => btnMain.style.background = '#c45510';

            // Right: gear icon button - copy exact native btn-add style
            const btnIcon = document.createElement('button');
            btnIcon.type = 'button';
            btnIcon.className = 'btn btn-important';
            btnIcon.title = 'Open settings';
            let addBtn = document.querySelector('#btn-add');
            if (addBtn) {
                let cs = window.getComputedStyle(addBtn);
                btnIcon.style.padding = cs.padding;
                btnIcon.style.borderRadius = cs.borderRadius;
                btnIcon.style.border = cs.border;
                btnIcon.style.fontSize = cs.fontSize;
                btnIcon.style.lineHeight = cs.lineHeight;
                btnIcon.style.fontWeight = cs.fontWeight;
                btnIcon.style.borderRadius = cs.borderRadius;
                btnIcon.style.borderTopLeftRadius = '0';
                btnIcon.style.borderBottomLeftRadius = '0';
            } else {
                btnIcon.style.fontSize = '1.2em';
                btnIcon.style.lineHeight = '1';
                btnIcon.style.padding = '0.5rem 0.7rem';
            }
            btnIcon.style.background = '#c45510';
            btnIcon.style.color = '#ffffff';
            btnIcon.style.border = '1px solid #e87a30';
            btnIcon.style.cursor = 'pointer';
            btnIcon.style.display = 'flex';
            btnIcon.style.alignItems = 'center';
            btnIcon.style.justifyContent = 'center';
            btnIcon.textContent = '⚙️';
            btnIcon.onmouseover = () => btnIcon.style.background = '#a84810';
            btnIcon.onmouseout = () => btnIcon.style.background = '#c45510';

            // Settings link
            const script = document.querySelector('script[src*="EinkPush/static/script.js"]');
            if (script) {
                const base = script.src.split('?')[0].replace(/static\/script\.js.*$/, '');
                btnIcon.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    window.location.href = './?c=extension&a=configure&e=EinkPush';
                };
            }

            btnMain.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                epStreamPush();
            });

            wrapper.appendChild(btnMain);
            wrapper.appendChild(btnIcon);
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

    // Next ping countdown timer (3 states: countdown, pushing, cooldown)
    function setupNextPingTimer() {
        const el = document.getElementById('ep-next-ping');
        if (!el) return;
        const daemonUrl = el.dataset.daemonUrl || '';
        const lastPing = parseInt(el.dataset.lastPing || '0');
        const intervalMin = parseInt(el.dataset.intervalMin || '5');
        const lastPush = parseInt(el.dataset.lastPush || '0');
        const cooldownH = parseInt(el.dataset.cooldownH || '20');

        const fmtTime = (diff) => {
            if (diff <= 0) return 'Due';
            const h = Math.floor(diff / 3600);
            const m = Math.floor((diff % 3600) / 60);
            const s = diff % 60;
            let t = '';
            if (h > 0) t = h + ':';
            t += (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
            return t;
        };

        const update = () => {
            // Fallback: compute from config timestamps
            const now = Math.floor(Date.now() / 1000);
            const baselinePing = lastPing > 0 ? lastPing : now;
            const baselinePush = lastPush > 0 ? lastPush : 0;
            const nextPing = baselinePing + (intervalMin * 60);
            const nextCoold = baselinePush + (cooldownH * 3600);
            const nextCheck = Math.max(nextPing, baselinePush > 0 ? nextCoold : nextPing);
            let diff = nextCheck - now;

            // Poll daemon status for real state (always when URL exists)
            if (daemonUrl) {
                fetch(daemonUrl, { cache: 'no-store' })
                    .then(r => r.json())
                    .then(d => {
                        const n = Math.floor(Date.now() / 1000);
                        if (d.state === 'pushing') {
                            el.textContent = '⚡ Pushing...';
                            el.style.color = '#28a745';
                        } else if (d.state === 'cooldown') {
                            const cd = (d.next || nextCoold) - n;
                            el.textContent = '⏸️ Cooldown: ' + (cd > 0 ? fmtTime(cd) : '0:00');
                            el.style.color = '#ff9800';
                        } else if (d.state === 'countdown') {
                            const pc = (d.next || nextPing) - n;
                            el.textContent = '🔔 Next: ' + (pc > 0 ? fmtTime(pc) : '0:00');
                            el.style.color = '#e66a19';
                        } else if (d.state === 'off') {
                            el.textContent = '🛑 ' + (d.msg || 'Daemon off');
                            el.style.color = '#dc3545';
                        } else {
                            // no daemon state — fallback to local calc
                            if (diff <= 0) {
                                el.textContent = '🔔 Ready';
                                el.style.color = '#28a745';
                            } else {
                                el.textContent = '🔔 Next: ' + fmtTime(diff);
                                el.style.color = '#e66a19';
                            }
                        }
                    })
                    .catch(() => {
                        // daemon unreachable — fallback to local calc
                        if (diff <= 0) {
                            el.textContent = '🔔 Ready';
                            el.style.color = '#28a745';
                        } else {
                            el.textContent = '🔔 Next: ' + fmtTime(diff);
                            el.style.color = '#e66a19';
                        }
                    });
            } else {
                if (diff <= 0) {
                    el.textContent = '🔔 Ready';
                    el.style.color = '#28a745';
                } else {
                    el.textContent = '🔔 Next: ' + fmtTime(diff);
                    el.style.color = '#e66a19';
                }
            }
        };

        update();
        setInterval(update, 2000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            startInjection();
            setupEndpointUpdater();
            setupNextPingTimer();
        });
    } else {
        startInjection();
        setupEndpointUpdater();
        setupNextPingTimer();
    }

    setInterval(injectSidebarButton, 2000);
})();
