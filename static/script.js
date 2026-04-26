(function() {
    console.log('[EinkPush] Script loaded and initialized');
    if (window._epScriptLoaded) return;
    window._epScriptLoaded = true;

    function showLoading(btn) {
        console.log('[EinkPush] showLoading called on button', btn);
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
            // Lock dimensions to prevent shape change
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
        
        setTimeout(() => {
            hideLoading(btn, originalState);
        }, 3000);
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
            // Restore original classes if they were removed
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

        navItems.forEach(item => {
            item.classList.toggle('active', item === navItem);
        });

        return sectionFound ? target : null;
    }

    function pollCookie(expectedSources = [], btn = null, originalState = null) {
        console.log('[EinkPush] Polling cookies for:', expectedSources);
        const labels = getLabels();
        
        // Check for error cookie first
        const errorMatch = document.cookie.match(/ep_dl_error=([^;]+)/);
        if (errorMatch) {
            console.error('[EinkPush] Download error:', decodeURIComponent(errorMatch[1]));
            document.cookie = 'ep_dl_error=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
            setButtonStatus(btn, 'error', labels.error, originalState);
            return;
        }

        if (expectedSources.length > 0) {
            let allDone = true;
            expectedSources.forEach(src => {
                if (document.cookie.indexOf('ep_dl_' + src + '=1') === -1) {
                    allDone = false;
                }
            });
            if (allDone) {
                console.log('[EinkPush] All downloads complete');
                expectedSources.forEach(src => {
                    document.cookie = 'ep_dl_' + src + '=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
                });
                setButtonStatus(btn, 'success', labels.success, originalState);
            } else {
                setTimeout(() => pollCookie(expectedSources, btn, originalState), 1000);
            }
        } else {
            if (document.cookie.indexOf('ep_dl_complete=1') !== -1) {
                console.log('[EinkPush] Single download complete');
                document.cookie = 'ep_dl_complete=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
                setButtonStatus(btn, 'success', labels.success, originalState);
            } else {
                setTimeout(() => pollCookie([], btn, originalState), 1000);
            }
        }
    }

    // ── Unified Push (sidebar + settings share same flow) ──
    let activePushAbort = null;
    let pushPollTimer = null;

    function epShowProgressModal() {
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
                    <span id="ep-progress-title">Pushing to device...</span>
                    <span class="ep-progress-close">✕</span>
                </div>
                <div class="ep-progress-bar-bg">
                    <div id="ep-progress-bar-fill" class="ep-progress-bar-fill"></div>
                </div>
                <div id="ep-progress-status" class="ep-progress-status"></div>
                <div id="ep-progress-detail" class="ep-progress-detail"></div>
            </div>
        `;
        document.body.appendChild(overlay);

        const box = overlay.querySelector('.ep-progress-box');
        box.style.cssText = 'background-color:' + bg + ';color:' + fg + ';border:1px solid ' + muted +
            ';border-radius:8px;padding:16px;max-width:400px;width:90%;box-shadow:0 4px 24px rgba(0,0,0,0.3);font-family:inherit;';

        overlay.querySelector('.ep-progress-header').style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;';
        overlay.querySelector('#ep-progress-title').style.cssText = 'font-weight:bold;font-size:14px;';
        overlay.querySelector('.ep-progress-close').style.cssText = 'cursor:pointer;opacity:0.6;';
        overlay.querySelector('.ep-progress-close').onclick = () => {
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

    function epStreamPush() {
        if (activePushAbort) activePushAbort.abort();
        if (pushPollTimer) clearInterval(pushPollTimer);
        activePushAbort = new AbortController();

        epShowProgressModal();
        epUpdateProgress(0, 'Starting...', '');

        fetch('./?c=EinkPush&a=pushRun&' + Date.now(), { signal: activePushAbort.signal })
            .then(r => r.json())
            .then(data => {
                if (data.status === 'error') {
                    epUpdateProgress(100, data.message || 'Error', '', true);
                    setTimeout(() => document.getElementById('ep-progress-overlay')?.remove(), 3000);
                    activePushAbort = null;
                    return;
                }
                if (data.job) {
                    startPushPoll(data.job);
                }
            })
            .catch(err => {
                if (err.name !== 'AbortError') {
                    epUpdateProgress(100, 'Error: ' + err.message, '', true);
                }
                activePushAbort = null;
            });
    }

    function startPushPoll(jobId) {
        let lastStep = '';
        let lastTime = 0;
        let lastMessage = '';
        let timeout = 600000; // 10 min hard timeout (readability fetching is slow)
        let timedOut = false;

        pushPollTimer = setInterval(() => {
            if (timedOut) return;

            fetch('./?c=EinkPush&a=pushStatus&job=' + encodeURIComponent(jobId) + '&_=' + Date.now())
                .then(r => r.json())
                .then(data => {
                    if (!data || !data.step) return;

                    // Check timeout: reset on ANY new data.time (worker is alive)
                    if (data.time && lastTime > 0) {
                        if (data.time === lastTime && (Date.now() - lastTime) > timeout) {
                            timedOut = true;
                            clearInterval(pushPollTimer);
                            pushPollTimer = null;
                            epUpdateProgress(100, 'Timeout', 'Push took too long. Worker may have crashed.', true);
                            setTimeout(() => {
                                document.getElementById('ep-progress-overlay')?.remove();
                                window.location.reload();
                            }, 3000);
                            activePushAbort = null;
                            return;
                        }
                    }
                    if (data.time) lastTime = data.time;

                    if (data.step !== lastStep) {
                        lastStep = data.step;
                        epHandleProgress(data);
                    } else if (data.message && data.message !== lastMessage) {
                        // Same step but message changed (e.g. bootstrapping details)
                        lastMessage = data.message;
                        epHandleProgress(data);
                    } else {
                        // Worker alive but same step+message: show dots pulse
                        const dots = '.'.repeat((Math.floor(Date.now() / 500) % 4));
                        const statusEl = document.getElementById('ep-progress-status');
                        if (statusEl && statusEl.textContent) {
                            statusEl.textContent = statusEl.textContent.replace(/\.+$/, '') + dots;
                        }
                    }

                    if (in_array(data.step, ['done', 'done_with_errors', 'no_content'])) {
                        clearInterval(pushPollTimer);
                        pushPollTimer = null;
                        if (data.step === 'done' || data.step === 'done_with_errors') {
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
                epUpdateProgress(5, 'Generating EPUBs...', data.source + ' (' + (data.sourceIndex || 0) + '/' + (data.totalSources || 0) + ')');
                break;
            case 'collecting':
                epUpdateProgress(5, 'Collecting...', data.source + ' - fetching articles');
                break;
            case 'building':
                epUpdateProgress(10, 'Building EPUB...', data.source + ' (' + data.articles + ' articles)');
                break;
            case 'source_progress':
                epUpdateProgress(5, 'Collecting articles...', data.source + ' (' + data.totalArticles + ' articles)');
                break;
            case 'source_empty':
                epUpdateProgress(0, '', data.source + ': no articles');
                break;
            case 'article':
                const pct = data.percent || Math.round(((data.articleIndex || 0) / Math.max(1, data.totalInSource || 1)) * 100);
                epUpdateProgress(pct, 'Processing: ' + data.source,
                    'Article ' + data.processedAllArticles + '/' + data.totalAllArticles + ' (' + pct + '%)');
                break;
            case 'pushing':
                epUpdateProgress(90, 'Pushing to device...',
                    data.source + ' (' + data.fileIndex + '/' + data.totalFiles + ')');
                break;
            case 'no_content':
                epUpdateProgress(100, 'No articles', data.message || 'Nothing to push.');
                setTimeout(() => document.getElementById('ep-progress-overlay')?.remove(), 2000);
                break;
            case 'done':
                epUpdateProgress(100, data.message || 'Done!', data.success + ' EPUB(s) pushed');
                break;
            case 'done_with_errors':
                epUpdateProgress(100, data.message || 'Done with errors',
                    data.success + ' ok, ' + data.failed + ' failed', true);
                break;
            case 'error':
                epUpdateProgress(100, data.message || 'Error', '', true);
                setTimeout(() => document.getElementById('ep-progress-overlay')?.remove(), 3000);
                break;
        }
    }

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
                </div>
            `;
            document.body.appendChild(overlay);
            const close = () => overlay.remove();
            document.getElementById('ep-preview-close').onclick = close;
            document.getElementById('ep-preview-close-btn').onclick = close;
            overlay.onclick = (e) => { if (e.target === overlay) close(); };
        }
        document.getElementById('ep-preview-body').innerHTML = html;
        return overlay;
    }

    // We use event delegation with capture phase to beat FreshRSS AJAX
    document.addEventListener('click', function(e) {
        console.log('[EinkPush] Click detected in capture phase. Target:', e.target);
        
        // Always process clicks for EinkPush elements
        // if (window._epScriptLoaded) return;
        // window._epScriptLoaded = true;
        
        try {
            // Tab Switching
            const navItem = e.target.closest('.ep-nav-item');
            if (navItem) {
                e.preventDefault();
                e.stopPropagation();

                const target = navItem.getAttribute('data-target');
                const wrapper = navItem.closest('.ep-wrapper');
                if (!wrapper) {
                    console.warn('[EinkPush] No wrapper found for tab navigation');
                    return;
                }

                const activeTab = activateTab(navItem);
                if (activeTab) {
                    console.log('[EinkPush] Activated section:', activeTab);
                } else {
                    console.warn('[EinkPush] Target section not found:', target);
                }
                
                // Save active tab to localStorage
                try {
                    localStorage.setItem('ep_active_tab', activeTab || target);
                } catch (err) {
                    console.warn('[EinkPush] Could not save active tab to localStorage:', err);
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
                    
                    // Get URL from data-url attribute or href
                    const testUrl = testBtn.getAttribute('data-url') || testBtn.href;
                    
                    // Get device address from input
                    const deviceAddressInput = document.querySelector('input[name="device_address"]');
                    const deviceAddress = deviceAddressInput ? deviceAddressInput.value.trim() : 'http://crosspoint.local';
                    
                    // First, try the test endpoint
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
                                    // Check if device info was returned from server
                                    if (data.deviceInfo) {
                                        deviceInfo = data.deviceInfo;
                                    }
                                }
                            } catch (e) {
                                if (isError) {
                                    testMessage = 'HTTP ' + r.status;
                                    throw new Error(testMessage);
                                }
                                // If it's a parsing error, might be a successful test returning non-JSON
                                testMessage = labels.success;
                            }
                            
                            // Display device status if available
                            if (!isError && deviceInfo) {
                                // Update UI with status data
                                const statusDiv = document.querySelector('.ep-device-status');
                                if (statusDiv) {
                                    statusDiv.innerHTML = `
                                        <div class="ep-status-item">
                                            <span class="ep-status-label">Version:</span>
                                            <span class="ep-status-value">${deviceInfo.version || 'N/A'}</span>
                                        </div>
                                        <div class="ep-status-item">
                                            <span class="ep-status-label">IP:</span>
                                            <span class="ep-status-value">${deviceInfo.ip || 'N/A'}</span>
                                        </div>
                                        <div class="ep-status-item">
                                            <span class="ep-status-label">Mode:</span>
                                            <span class="ep-status-value">${deviceInfo.mode || 'N/A'}</span>
                                        </div>
                                        <div class="ep-status-item">
                                            <span class="ep-status-label">RSSI:</span>
                                            <span class="ep-status-value">${deviceInfo.rssi !== undefined ? deviceInfo.rssi + ' dBm' : 'N/A'}</span>
                                        </div>
                                        <div class="ep-status-item">
                                            <span class="ep-status-label">Free Heap:</span>
                                            <span class="ep-status-value">${deviceInfo.freeHeap !== undefined ? deviceInfo.freeHeap + ' bytes' : 'N/A'}</span>
                                        </div>
                                        <div class="ep-status-item">
                                            <span class="ep-status-label">Uptime:</span>
                                            <span class="ep-status-value">${deviceInfo.uptime !== undefined ? Math.floor(deviceInfo.uptime/3600) + 'h ' + Math.floor((deviceInfo.uptime%3600)/60) + 'm' : 'N/A'}</span>
                                        </div>`;
                                }
                            }
                            
                            setButtonStatus(testBtn, isError ? 'error' : 'success', testMessage, orig);
                            // Don't reload the page - keep the user on the same view to see device status
                        })
                        .catch(err => {
                            setButtonStatus(testBtn, 'error', labels.error, orig);
                            console.error('Test failed: ' + err.message);
                        });
                    return;
                }

                // Preview
                const previewBtn = e.target.closest('.ep-btn-preview');
                if (previewBtn) {
                    e.preventDefault();
                    const orig = showLoading(previewBtn);
                    const labels = getLabels();
                    fetch(previewBtn.href)
                        .then(r => {
                            if (!r.ok) throw new Error('HTTP ' + r.status);
                            return r.text();
                        })
                        .then(html => {
                            showPreview(html);
                            hideLoading(previewBtn, orig);
                        })
                        .catch(err => {
                            setButtonStatus(previewBtn, 'error', labels.error, orig);
                            console.error('Preview failed: ' + err.message);
                        });
                    return;
                }

                // Intercept "Push All" for progress bar
                // Intercept "Push All" for progress bar
                const pushAllBtn = e.target.closest('a[href*="a=push"][href*="EinkPush"]');
                if (pushAllBtn && !pushAllBtn.href.includes('source=')) {
                    e.preventDefault();
                    e.stopPropagation();
                    epStreamPush();
                    return;
                }
            }

            // Intercept "Download all enabled"
            const dlAllBtn = e.target.closest('a[href*="a=generate"]:not([href*="source="])');
            if (dlAllBtn) {
                console.log('[EinkPush] Download All clicked:', dlAllBtn.href);
                e.preventDefault();
                e.stopPropagation();
                const labels = getLabels();
                const enabledSources = document.querySelectorAll('input[name^="sources["][name$="][enabled]"]:checked');
                if (enabledSources.length === 0) {
                    const orig = showLoading(dlAllBtn);
                    setButtonStatus(dlAllBtn, 'no-content', labels.noArticles, orig);
                    return;
                }
                
                const origState = showLoading(dlAllBtn);
                
                let expectedSources = [];
                enabledSources.forEach(input => {
                    const match = input.name.match(/sources\[(.*?)\]/);
                    if (match && match[1]) {
                        expectedSources.push(match[1]);
                    }
                });

                console.log('[EinkPush] Expected sources:', expectedSources);

                (async () => {
                    try {
                        let dirHandle = null;
                        if ('showDirectoryPicker' in window) {
                            try {
                                dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
                            } catch (err) {
                                console.log('[EinkPush] Directory picker cancelled or failed', err);
                                hideLoading(dlAllBtn, origState);
                                return;
                            }
                        }

                        if (dirHandle) {
                            // Modern approach: fetch each file and save to directory
                            let downloadedCount = 0;
                            for (const sourceKey of expectedSources) {
                                const url = dlAllBtn.href + '&source=' + encodeURIComponent(sourceKey) + '&silent=1';
                                console.log('[EinkPush] Fetching download for: ' + sourceKey);
                                const response = await fetch(url);
                                
                                // Check for error cookie
                                const errorMatch = document.cookie.match(/ep_dl_error=([^;]+)/);
                                if (errorMatch) {
                                    document.cookie = 'ep_dl_error=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
                                    throw new Error(decodeURIComponent(errorMatch[1]));
                                }

                                if (response.status === 204) {
                                    console.log('[EinkPush] No content for: ' + sourceKey);
                                    continue; // No articles
                                }
                                if (!response.ok) throw new Error('Network response was not ok');
                                
                                const blob = await response.blob();
                                const contentDisposition = response.headers.get('Content-Disposition');
                                let filename = sourceKey + '.epub';
                                if (contentDisposition) {
                                    const match = contentDisposition.match(/filename="([^"]+)"/);
                                    if (match) filename = match[1];
                                }
                                
                                const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
                                const writable = await fileHandle.createWritable();
                                await writable.write(blob);
                                await writable.close();
                                console.log('[EinkPush] Saved: ' + filename);
                                downloadedCount++;
                            }
                            
                            if (downloadedCount > 0) {
                                setButtonStatus(dlAllBtn, 'success', labels.success, origState);
                            } else {
                                setButtonStatus(dlAllBtn, 'no-content', labels.noArticles, origState);
                            }
                        } else {
                            // Fallback approach: iframes
                            // Clear existing cookies for these sources to avoid immediate poll exit
                            expectedSources.forEach(src => {
                                document.cookie = 'ep_dl_' + src + '=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
                            });
                            document.cookie = 'ep_dl_complete=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';

                            let delay = 0;
                            expectedSources.forEach(sourceKey => {
                                const url = dlAllBtn.href + '&source=' + encodeURIComponent(sourceKey) + '&silent=1';
                                setTimeout(() => {
                                    console.log('[EinkPush] Triggering download for: ' + sourceKey + ' via URL: ' + url);
                                    const iframe = document.createElement('iframe');
                                    iframe.className = 'ep-hidden';
                                    iframe.src = url;
                                    document.body.appendChild(iframe);
                                    setTimeout(() => iframe.remove(), 120000); // 2 minutes timeout
                                }, delay);
                                delay += 1500;
                            });
                            pollCookie(expectedSources, dlAllBtn, origState);
                            
                            // Fallback timeout in case some downloads fail silently
                            setTimeout(() => {
                                console.log('[EinkPush] Fallback timeout reached');
                                if (dlAllBtn.classList.contains('ep-loading')) {
                                    hideLoading(dlAllBtn, origState);
                                }
                            }, 120000); // 2 minutes timeout
                        }
                    } catch (err) {
                        console.error('[EinkPush] Error during Download All:', err);
                        setButtonStatus(dlAllBtn, 'error', labels.error, origState);
                    }
                })();
                
                return;
            }

            // Intercept single download
            const dlActionBtn = e.target.closest('a[href*="a=generate"][href*="source="]');
            if (dlActionBtn) {
                console.log('[EinkPush] Single download intercepted:', dlActionBtn.href);
                e.preventDefault();
                e.stopPropagation();
                const origState = showLoading(dlActionBtn);
                const labels = getLabels();
                void dlActionBtn.offsetWidth;

                document.cookie = 'ep_dl_complete=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
                pollCookie([], dlActionBtn, origState);

                const iframe = document.createElement('iframe');
                iframe.className = 'ep-hidden';
                iframe.src = dlActionBtn.href + '&silent=1';
                document.body.appendChild(iframe);
                setTimeout(() => iframe.remove(), 120000);
                return;
            }

            // Unified push: sidebar button OR "Push all" in settings
            const pushTrigger = e.target.closest('#ep-sidebar-push-now, #ep-push-all-btn');
            if (pushTrigger) {
                e.preventDefault();
                e.stopPropagation();
                epStreamPush();
                return;
            }
    } catch (err) {
            console.error('[EinkPush] Error in click handler:', err);
        }

        // Tab Switching
        const navItem = e.target.closest('.ep-nav-item');
        if (navItem) {
            e.preventDefault();
            e.stopPropagation();
            const activeTab = activateTab(navItem);
            if (activeTab) {
                localStorage.setItem('ep_active_tab', activeTab);
            } else {
                const target = navItem.getAttribute('data-target');
                console.warn('[EinkPush] Target section not found during fallback:', target);
            }
            return;
        }

        // Accordion for Source Details
        const sourceMain = e.target.closest('.ep-source-main');
        if (sourceMain) {
            console.log('[EinkPush] Source main click detected');
            // Prevent toggle when clicking actions or switch
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
    }, true); // USE CAPTURE PHASE

    // Restore active tab on load/ajax-load
    function restoreTab() {
        try {
            const savedTab = localStorage.getItem('ep_active_tab');
            if (savedTab) {
                const tabBtn = document.querySelector(`.ep-nav-item[data-target="${savedTab}"]`);
                if (tabBtn) {
                    const activeTab = activateTab(tabBtn);
                    if (!activeTab) {
                        console.warn('[EinkPush] Failed to restore saved tab:', savedTab);
                    }
                }
            }
        } catch (err) {
            console.warn('[EinkPush] Error in restoreTab:', err);
        }
    }

    // History Auto-refresh
    let historyInterval = null;
    function startHistoryRefresh() {
        if (historyInterval) return;
        historyInterval = setInterval(() => {
            const historyTab = document.querySelector('.ep-nav-item[data-target="history"].active');
            if (historyTab) {
                console.log('[EinkPush] Refreshing history...');
                // We can't easily refresh just the history div without a dedicated endpoint,
                // but we can reload the page if the user is idle.
                // For now, let's just refresh the whole page if history is active and user is not interacting.
                // A better way would be a fetch to a history-only endpoint.
                // Let's stick to manual refresh or a small fetch if we add the endpoint.
            }
        }, 30000);
    }

    // Run on initial load
    document.addEventListener('DOMContentLoaded', restoreTab);
    // Run periodically in case of AJAX load (FreshRSS doesn't always fire a clean event)
    // setInterval(restoreTab, 500);

    // Inject sidebar button in Main UI
    function injectSidebarButton() {
        console.log('[EinkPush] injectSidebarButton called');
        // Read config from script URL parameters (CSP-friendly)
        const script = document.querySelector('script[src*="EinkPush/static/script.js"]');
        if (!script) return;
        
        const urlParams = new URLSearchParams(script.src.split('?')[1]);
        const showSidebar = urlParams.get('sb') === '1';
        const label = urlParams.get('l') ? decodeURIComponent(urlParams.get('l')) : '⚙️ Settings';
        const pushNowLabel = urlParams.get('pn_l') ? decodeURIComponent(urlParams.get('pn_l')) : 'Push';
        const lastPushTime = parseInt(urlParams.get('lpt') || '0');
        const lastPushType = urlParams.get('lpty') || '';
        const lastPushLabel = urlParams.get('lp_l') ? decodeURIComponent(urlParams.get('lp_l')) : 'Last Push';
        const typeManual = urlParams.get('ty_m') ? decodeURIComponent(urlParams.get('ty_m')) : 'Manual';
        const typeAuto = urlParams.get('ty_a') ? decodeURIComponent(urlParams.get('ty_a')) : 'Auto';
        
        // Robust check: if explicitly false, remove and stop
        if (!showSidebar) {
            const existingBtn = document.getElementById('ep-sidebar-btn-main');
            if (existingBtn) {
                console.log('[EinkPush] Removing sidebar buttons per settings');
                existingBtn.remove();
            }
            return;
        }
        
        // If already exists, do nothing on re-run (AJAX navigation)
        if (document.getElementById('ep-sidebar-btn-main')) {
            return;
        }

        function createSidebarContent() {
            // Find Subscription button and use its OWN width (not parent li)
            let subBtn = document.querySelector('#btn-subscription, .feed-tree-btn[href*="a=subscription"]');
            // Measure full li width (text + + icon) for exact match
            let subLi = subBtn ? subBtn.closest('li') : null;
            let btnWidth = subLi ? Math.round(subLi.getBoundingClientRect().width) + 'px' : '190px';

            const btnFontSize = subBtn ? window.getComputedStyle(subBtn).fontSize : '0.75rem';
            const btnPadding = subBtn ? window.getComputedStyle(subBtn).padding : '5px 0';
            const btnBorderRadius = subBtn ? window.getComputedStyle(subBtn).borderRadius : '4px';

            const box = document.createElement('div');
            box.className = 'ep-sidebar-box';
            box.style.setProperty('width', btnWidth, 'important');
            box.style.setProperty('max-width', btnWidth, 'important');
            box.style.display = 'inline-block';
            box.style.boxSizing = 'border-box';

            const btnContainer = document.createElement('div');
            btnContainer.style.display = 'flex';
            btnContainer.style.justifyContent = 'center';
            btnContainer.style.width = btnWidth;

            // Split button: left=Push (big), right=Settings (small square)
            // Matches FreshRSS "Subscription management" + "+" icon style
            const gearSize = '32px';
            const btn = document.createElement('div');
            btn.className = 'ep-split-container';
            btn.style.width = btnWidth;
            btn.style.display = 'flex';
            btn.style.borderRadius = btnBorderRadius;
            btn.style.overflow = 'hidden';
            btn.style.boxSizing = 'border-box';

            // LEFT - push feeds (big orange button)
            const left = document.createElement('a');
            left.id = 'ep-sidebar-push-now';
            left.className = 'ep-split-left';
            left.href = '#';
            left.textContent = 'E-INK PUSH';
            left.style.flex = '1';
            left.style.display = 'flex';
            left.style.alignItems = 'center';
            left.style.justifyContent = 'center';
            left.style.color = '#fff';
            left.style.textDecoration = 'none';
            left.style.fontSize = '0.75rem';
            left.style.padding = btnPadding;
            left.style.fontWeight = '700';
            left.style.letterSpacing = '0.5px';
            left.style.backgroundColor = '#e66a19';
            left.style.borderRadius = btnBorderRadius + ' 0 0 ' + btnBorderRadius;
            left.style.border = '1px solid #e66a19';
            left.style.borderRight = '1px solid rgba(0,0,0,0.25)';
            left.style.transition = 'background-color 0.15s ease';
            left.onmouseover = () => left.style.backgroundColor = '#d45d15';
            left.onmouseout = () => left.style.backgroundColor = '#e66a19';

            // RIGHT - settings (small square gear)
            const right = document.createElement('a');
            right.href = './?c=extension&a=configure&e=EinkPush';
            right.className = 'ep-split-right';
            right.textContent = '⚙️';
            right.style.display = 'flex';
            right.style.alignItems = 'center';
            right.style.justifyContent = 'center';
            right.style.color = '#fff';
            right.style.textDecoration = 'none';
            right.style.fontSize = '1.1rem';
            right.style.width = gearSize;
            right.style.minWidth = gearSize;
            right.style.backgroundColor = '#343a40';
            right.style.borderRadius = '0 ' + btnBorderRadius + ' ' + btnBorderRadius + ' 0';
            right.style.border = '1px solid #343a40';
            right.style.transition = 'background-color 0.15s ease';
            right.onmouseover = () => right.style.backgroundColor = '#4a5058';
            right.onmouseout = () => right.style.backgroundColor = '#343a40';

            btn.appendChild(left);
            btn.appendChild(right);
            btnContainer.appendChild(btn);
            box.appendChild(btnContainer);

            return box;
        }

        // Check URL params
        const href = window.location.href;
        
        // Check DOM for settings page markers (FreshRSS uses AJAX, URL stays same)
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

        const hasSettingNav = isOnSettingsPage || isSettingsUrl;

        // Remove button from settings pages
        if (hasSettingNav || !showSidebar) {
            const existingBtn = document.getElementById('ep-sidebar-btn-main');
            if (existingBtn) existingBtn.remove();
            return;
        }

        // Plain wrapper — no li clone (li = full sidebar width)
        const wrapper = document.createElement('div');
        wrapper.id = 'ep-sidebar-btn-main';
        wrapper.style.textAlign = 'center';
        wrapper.appendChild(createSidebarContent());

        // FreshRSS Default theme: insert before the tree
        const asideFeed = document.querySelector('#aside_feed');
        if (asideFeed) {
            const tree = asideFeed.querySelector('.tree');
            if (tree) tree.parentNode.insertBefore(wrapper, tree);
            else asideFeed.insertBefore(wrapper, asideFeed.firstChild);
            return;
        }

        // Fallback: insert after subscription button
        const subManage = Array.from(document.querySelectorAll('a')).find(a =>
            (a.getAttribute('href') || '').includes('a=subscription')
        );
        if (subManage) {
            const parent = subManage.closest('li, .item');
            if (parent) {
                parent.parentNode.insertBefore(wrapper, parent.nextSibling);
                return;
            }
        }
    }

    // Survival in AJAX environment
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

    // Auto-update push endpoint when device address or folder name changes
    function updatePushEndpoint() {
        const deviceAddressInput = document.querySelector('input[name="device_address"]');
        const folderNameInput = document.querySelector('input[name="folder_name"]');
        const pushEndpointInput = document.querySelector('input[name="push_endpoint"]');
        
        if (deviceAddressInput && folderNameInput && pushEndpointInput) {
            const deviceAddress = deviceAddressInput.value.trim() || 'http://crosspoint.local';
            const folderName = folderNameInput.value.trim() || 'RSSFeeds';
            
            // Clean up the address and folder name
            const cleanAddress = deviceAddress.replace(/\/?$/, ''); // Remove trailing slash
            const cleanFolder = folderName.replace(/^\/*/, '').replace(/\/*$/, ''); // Remove leading/trailing slashes
            
            const newEndpoint = `${cleanAddress}/upload?path=/${cleanFolder}`;
            pushEndpointInput.value = newEndpoint;
        }
    }
    
    // Set up event listeners for auto-updating push endpoint
    function setupEndpointUpdater() {
        const deviceAddressInput = document.querySelector('input[name="device_address"]');
        const folderNameInput = document.querySelector('input[name="folder_name"]');
        
        if (deviceAddressInput && folderNameInput) {
            deviceAddressInput.addEventListener('input', updatePushEndpoint);
            folderNameInput.addEventListener('input', updatePushEndpoint);
            
            // Initial update
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
