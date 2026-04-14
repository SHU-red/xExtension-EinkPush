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

    // We use event delegation with capture phase to beat FreshRSS AJAX
    document.addEventListener('click', function(e) {
        console.log('[EinkPush] Click detected in capture phase. Target:', e.target);
        
        try {
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
                
                const origHtml = showLoading(dlAllBtn);
                
                let expectedSources = [];
                enabledSources.forEach(input => {
                    const match = input.name.match(/sources\[(.*?)\]/);
                    if (match && match[1]) {
                        expectedSources.push(match[1]);
                    }
                });

                console.log('[EinkPush] Expected sources:', expectedSources);

                // Clear existing cookies for these sources to avoid immediate poll exit
                expectedSources.forEach(src => {
                    document.cookie = 'ep_dl_' + src + '=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
                });
                document.cookie = 'ep_dl_complete=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';

                let delay = 0;
                enabledSources.forEach(input => {
                    const match = input.name.match(/sources\[(.*?)\]/);
                    if (match && match[1]) {
                        const sourceKey = match[1];
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
                    }
                });
                pollCookie(expectedSources, dlAllBtn, origHtml);
                
                // Fallback timeout in case some downloads fail silently
                setTimeout(() => {
                    console.log('[EinkPush] Fallback timeout reached');
                    hideLoading(dlAllBtn, origHtml);
                }, 120000); // 2 minutes timeout
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
            }
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
        const label = urlParams.get('l') ? decodeURIComponent(urlParams.get('l')) : '📖 EinkPush';
        
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
        if (document.getElementById('ep-sidebar-btn-main')) return;

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
