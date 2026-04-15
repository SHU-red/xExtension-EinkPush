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
        
        // Lock dimensions to prevent shape change
        btn.style.width = rect.width + 'px';
        btn.style.height = rect.height + 'px';
        
        btn.classList.add('ep-loading');
        btn.innerHTML = '<span class="ep-spinner-inline"></span>';
        
        return { html: originalHtml, width: originalWidth, height: originalHeight };
    }

    function hideLoading(btn, originalState) {
        if (!btn) return;
        btn.classList.remove('ep-loading');
        btn.style.pointerEvents = 'auto';
        btn.style.opacity = '1';
        if (originalState) {
            btn.innerHTML = originalState.html;
            btn.style.width = originalState.width;
            btn.style.height = originalState.height;
        }
    }

    function pollCookie(expectedSources = [], btn = null, originalState = null) {
        console.log('[EinkPush] Polling cookies for:', expectedSources);
        
        // Check for error cookie first
        const errorMatch = document.cookie.match(/ep_dl_error=([^;]+)/);
        if (errorMatch) {
            console.error('[EinkPush] Download error:', decodeURIComponent(errorMatch[1]));
            document.cookie = 'ep_dl_error=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
            hideLoading(btn, originalState);
            alert('EinkPush Error:\n\n' + decodeURIComponent(errorMatch[1]));
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
                hideLoading(btn, originalState);
            } else {
                setTimeout(() => pollCookie(expectedSources, btn, originalState), 1000);
            }
        } else {
            if (document.cookie.indexOf('ep_dl_complete=1') !== -1) {
                console.log('[EinkPush] Single download complete');
                document.cookie = 'ep_dl_complete=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
                hideLoading(btn, originalState);
            } else {
                setTimeout(() => pollCookie([], btn, originalState), 1000);
            }
        }
    }

    function showProgress(total) {
        let overlay = document.getElementById('ep-progress-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'ep-progress-overlay';
            overlay.className = 'ep-progress-overlay';
            overlay.innerHTML = `
                <div class="ep-progress-header">
                    <span>EinkPush Delivery</span>
                    <span class="ep-progress-close">✕</span>
                </div>
                <div class="ep-progress-bar-bg">
                    <div id="ep-progress-bar-fill" class="ep-progress-bar-fill"></div>
                </div>
                <div id="ep-progress-status" class="ep-progress-status">Starting...</div>
            `;
            document.body.appendChild(overlay);
            overlay.querySelector('.ep-progress-close').onclick = () => overlay.remove();
        }
        return overlay;
    }

    function updateProgress(current, total, status) {
        const fill = document.getElementById('ep-progress-bar-fill');
        const statusEl = document.getElementById('ep-progress-status');
        if (fill) fill.style.width = (current / total * 100) + '%';
        if (statusEl) statusEl.innerText = status;
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
        
        try {
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
                    fetch(testBtn.href)
                        .then(r => r.text())
                        .then(() => window.location.reload())
                        .catch(err => {
                            alert('Test failed: ' + err.message);
                            hideLoading(testBtn, orig);
                        });
                    return;
                }

                // Preview
                const previewBtn = e.target.closest('.ep-btn-preview');
                if (previewBtn) {
                    e.preventDefault();
                    const orig = showLoading(previewBtn);
                    fetch(previewBtn.href)
                        .then(r => r.text())
                        .then(html => {
                            showPreview(html);
                            hideLoading(previewBtn, orig);
                        })
                        .catch(err => {
                            alert('Preview failed: ' + err.message);
                            hideLoading(previewBtn, orig);
                        });
                    return;
                }

                // Intercept "Push All" for progress bar
                const pushAllBtn = e.target.closest('a[href*="a=push"][href*="EinkPush"]');
                if (pushAllBtn && !pushAllBtn.href.includes('source=')) {
                    e.preventDefault();
                    const orig = showLoading(pushAllBtn);
                    
                    const sources = Array.from(document.querySelectorAll('.ep-source-item'))
                        .filter(item => item.querySelector('input[type="checkbox"]:checked'))
                        .map(item => {
                            const dlLink = item.querySelector('a[href*="a=generate"][href*="source="]');
                            if (!dlLink) return null;
                            const match = dlLink.href.match(/source=([^&]+)/);
                            return match ? match[1] : null;
                        })
                        .filter(s => s !== null);

                    if (sources.length === 0) {
                        alert('No sources enabled.');
                        hideLoading(pushAllBtn, orig);
                        return;
                    }

                    showProgress(sources.length);
                    let completed = 0;

                    const processNext = () => {
                        if (completed >= sources.length) {
                            updateProgress(sources.length, sources.length, 'Finished!');
                            setTimeout(() => window.location.reload(), 1500);
                            return;
                        }

                        const source = sources[completed];
                        updateProgress(completed, sources.length, 'Pushing ' + source + '...');
                        
                        // Use pushSingleAction for each
                        const url = pushAllBtn.href.replace('a=push', 'a=pushSingle') + '&source=' + encodeURIComponent(source);
                        
                        fetch(url)
                            .then(() => {
                                completed++;
                                processNext();
                            })
                            .catch(err => {
                                updateProgress(completed, sources.length, 'Error: ' + err.message);
                                setTimeout(() => window.location.reload(), 3000);
                            });
                    };

                    processNext();
                    return;
                }
            }

            // Intercept "Download all enabled"
            const dlAllBtn = e.target.closest('a[href*="a=generate"]:not([href*="source="])');
            if (dlAllBtn) {
                console.log('[EinkPush] Download All clicked:', dlAllBtn.href);
                e.preventDefault();
                e.stopPropagation();
                const enabledSources = document.querySelectorAll('input[name^="sources["][name$="][enabled]"]:checked');
                if (enabledSources.length === 0) {
                    alert('No sources are currently enabled.');
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
                            hideLoading(dlAllBtn, origState);
                            if (downloadedCount > 0) {
                                alert('Successfully saved ' + downloadedCount + ' EPUB(s) to the selected folder.');
                            } else {
                                alert('No new articles found to download.');
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
                                hideLoading(dlAllBtn, origState);
                            }, 120000); // 2 minutes timeout
                        }
                    } catch (err) {
                        console.error('[EinkPush] Error during Download All:', err);
                        hideLoading(dlAllBtn, origState);
                        alert('An error occurred during download: ' + err.message);
                    }
                })();
                
                return;
            }

            // Intercept single download or push
            const actionBtn = e.target.closest('a[href*="a=generate"][href*="source="], a[href*="a=push"]');
            if (actionBtn) {
                console.log('[EinkPush] Single action intercepted:', actionBtn.href);
                e.preventDefault();
                e.stopPropagation(); // Stop FreshRSS from hijacking
                const origHtml = showLoading(actionBtn);
                
                // Force a reflow so the browser paints the spinner immediately
                void actionBtn.offsetWidth;
                
                if (actionBtn.href.includes('a=generate')) {
                    console.log('[EinkPush] Single download mode');
                    // Clear cookie before polling
                    document.cookie = 'ep_dl_complete=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
                    pollCookie([], actionBtn, origHtml);
                    
                    // Trigger download via hidden iframe
                    const iframe = document.createElement('iframe');
                    iframe.className = 'ep-hidden';
                    iframe.src = actionBtn.href + '&silent=1';
                    document.body.appendChild(iframe);
                    setTimeout(() => iframe.remove(), 120000); // 2 minutes timeout
                } else {
                    console.log('[EinkPush] Push mode, fetching in background');
                    // For push, use fetch so the page doesn't navigate and the spinner keeps spinning
                    fetch(actionBtn.href)
                        .then(response => {
                            console.log('[EinkPush] Push fetch complete, reloading page to show notification');
                            window.location.reload();
                        })
                        .catch(err => {
                            console.error('[EinkPush] Push fetch failed:', err);
                            hideLoading(actionBtn, origHtml);
                            alert('Push failed: ' + err.message);
                        });
                }
                return;
        } catch (err) {
            console.error('[EinkPush] Error in click handler:', err);
        }

        // Tab Switching
        const navItem = e.target.closest('.ep-nav-item');
        if (navItem) {
            const target = navItem.getAttribute('data-target');
            
            const wrapper = navItem.closest('.ep-wrapper');
            if (!wrapper) return;

            const navItems = wrapper.querySelectorAll('.ep-nav-item');
            const sections = wrapper.querySelectorAll('.ep-section');
            
            navItems.forEach(n => n.classList.remove('active'));
            sections.forEach(s => s.classList.remove('active'));
            
            navItem.classList.add('active');
            const targetSection = wrapper.querySelector('#' + target);
            if (targetSection) targetSection.classList.add('active');
            
            // Save active tab to localStorage
            localStorage.setItem('ep_active_tab', target);
            return;
        }

        // Accordion for Source Details
        const sourceMain = e.target.closest('.ep-source-main');
        if (sourceMain) {
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
        const savedTab = localStorage.getItem('ep_active_tab');
        if (savedTab) {
            const tabBtn = document.querySelector(`.ep-nav-item[data-target="${savedTab}"]`);
            if (tabBtn && !tabBtn.classList.contains('active')) {
                tabBtn.click();
            }
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
    setInterval(restoreTab, 500);

    // Inject sidebar button in Main UI
    function injectSidebarButton() {
        // Read config from script URL parameters (CSP-friendly)
        const script = document.querySelector('script[src*="EinkPush/static/script.js"]');
        if (!script) return;
        
        const urlParams = new URLSearchParams(script.src.split('?')[1]);
        const showSidebar = urlParams.get('sb') === '1';
        const showPushNow = urlParams.get('spn') === '1';
        const label = urlParams.get('l') ? decodeURIComponent(urlParams.get('l')) : '📖 EinkPush';
        const pushNowLabel = urlParams.get('pn_l') ? decodeURIComponent(urlParams.get('pn_l')) : '🚀 Push Now';
        const lastPushTime = parseInt(urlParams.get('lpt') || '0');
        const lastPushType = urlParams.get('lpty') || '';
        const lastPushLabel = urlParams.get('lp_l') ? decodeURIComponent(urlParams.get('lp_l')) : 'Last Push';
        const typeManual = urlParams.get('ty_m') ? decodeURIComponent(urlParams.get('ty_m')) : 'Manual';
        const typeAuto = urlParams.get('ty_a') ? decodeURIComponent(urlParams.get('ty_a')) : 'Auto';
        
        // Robust check: if explicitly false, remove and stop
        if (!showSidebar) {
            const existingBtn = document.getElementById('ep-sidebar-btn-main');
            if (existingBtn) {
                console.log('[EinkPush] Removing sidebar button per settings');
                existingBtn.remove();
            }
            return;
        }
        
        // If already exists, stop
        if (document.getElementById('ep-sidebar-btn-main')) {
            // Check if we need to add/remove the second button
            const container = document.getElementById('ep-sidebar-btn-main');
            const existingPushNow = document.getElementById('ep-sidebar-push-now');
            
            if (showPushNow && !existingPushNow) {
                const a = document.createElement('a');
                a.id = 'ep-sidebar-push-now';
                a.href = './?c=EinkPush&a=push&r=main';
                a.className = 'btn ep-btn-push-now-orange ep-mt-5';
                a.innerHTML = pushNowLabel;
                container.appendChild(a);
            } else if (!showPushNow && existingPushNow) {
                existingPushNow.remove();
            }

            // Update last push info if exists
            let infoEl = document.getElementById('ep-sidebar-last-push-info');
            if (lastPushTime > 0) {
                if (!infoEl) {
                    infoEl = document.createElement('div');
                    infoEl.id = 'ep-sidebar-last-push-info';
                    infoEl.className = 'ep-sidebar-info-text';
                    container.appendChild(infoEl);
                }
                const date = new Date(lastPushTime * 1000);
                const timeStr = date.getHours().toString().padStart(2, '0') + ':' + date.getMinutes().toString().padStart(2, '0');
                const typeStr = lastPushType === 'auto' ? typeAuto : typeManual;
                infoEl.innerHTML = `${lastPushLabel}: ${timeStr} (${typeStr})`;
            } else if (infoEl) {
                infoEl.remove();
            }

            return;
        }

        // Target the specific FreshRSS 1.28.1 sidebar structure
        const targetDiv = document.querySelector('.configure-feeds');
        if (targetDiv) {
            const container = document.createElement('div');
            // Remove 'stick' to avoid flex-horizontal behavior
            container.className = 'ep-sidebar-container';
            container.id = 'ep-sidebar-btn-main';
            
            const a = document.createElement('a');
            a.href = './?c=extension&a=configure&e=EinkPush';
            a.className = 'btn ep-btn-settings-orange';
            a.innerHTML = label; 
            
            container.appendChild(a);

            if (showPushNow) {
                const aPush = document.createElement('a');
                aPush.id = 'ep-sidebar-push-now';
                aPush.href = './?c=EinkPush&a=push&r=main';
                aPush.className = 'btn ep-btn-push-now-orange ep-mt-5';
                aPush.innerHTML = pushNowLabel;
                container.appendChild(aPush);
            }

            if (lastPushTime > 0) {
                const infoEl = document.createElement('div');
                infoEl.id = 'ep-sidebar-last-push-info';
                infoEl.className = 'ep-sidebar-info-text';
                const date = new Date(lastPushTime * 1000);
                const timeStr = date.getHours().toString().padStart(2, '0') + ':' + date.getMinutes().toString().padStart(2, '0');
                const typeStr = lastPushType === 'auto' ? typeAuto : typeManual;
                infoEl.innerHTML = `${lastPushLabel}: ${timeStr} (${typeStr})`;
                container.appendChild(infoEl);
            }

            targetDiv.parentNode.insertBefore(container, targetDiv.nextSibling);
            return;
        }

        // Fallback for other themes/versions
        const subManage = Array.from(document.querySelectorAll('a')).find(a => 
            (a.getAttribute('href') || '').includes('a=subscription') || 
            a.textContent.trim().toLowerCase().includes('subscription management')
        );
        
        if (subManage) {
            const parent = subManage.closest('li') || subManage.parentNode;
            if (parent && parent.parentNode) {
                const li = document.createElement('li');
                li.className = 'item ep-sidebar-container';
                li.id = 'ep-sidebar-btn-main';
                
                const a = document.createElement('a');
                a.href = './?c=extension&a=configure&e=EinkPush';
                a.className = 'btn ep-btn-settings-orange';
                a.innerHTML = label; 
                
                li.appendChild(a);

                if (showPushNow) {
                    const aPush = document.createElement('a');
                    aPush.id = 'ep-sidebar-push-now';
                    aPush.href = './?c=EinkPush&a=push&r=main';
                    aPush.className = 'btn ep-btn-push-now-orange ep-mt-5';
                    aPush.innerHTML = pushNowLabel;
                    li.appendChild(aPush);
                }

                if (lastPushTime > 0) {
                    const infoEl = document.createElement('div');
                    infoEl.id = 'ep-sidebar-last-push-info';
                    infoEl.className = 'ep-sidebar-info-text';
                    const date = new Date(lastPushTime * 1000);
                    const timeStr = date.getHours().toString().padStart(2, '0') + ':' + date.getMinutes().toString().padStart(2, '0');
                    const typeStr = lastPushType === 'auto' ? typeAuto : typeManual;
                    infoEl.innerHTML = `${lastPushLabel}: ${timeStr} (${typeStr})`;
                    li.appendChild(infoEl);
                }

                parent.parentNode.insertBefore(li, parent.nextSibling);
            }
        }
    }

    
    // Survival in AJAX environment
    const epObserver = new MutationObserver(() => injectSidebarButton());
    
    function startInjection() {
        injectSidebarButton();
        if (document.body) {
            epObserver.observe(document.body, { childList: true, subtree: true });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startInjection);
    } else {
        startInjection();
    }
    
    setInterval(injectSidebarButton, 2000);
})();
