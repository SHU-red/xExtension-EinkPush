(function() {
    if (window._epScriptLoaded) return;
    window._epScriptLoaded = true;

    // We use event delegation because the DOM might be replaced via AJAX
    document.addEventListener('click', function(e) {
        // Intercept "Download all enabled"
        const dlAllBtn = e.target.closest('a[href*="a=generate"]:not([href*="source="])');
        if (dlAllBtn) {
            e.preventDefault();
            const enabledSources = document.querySelectorAll('input[name^="sources["][name$="][enabled]"]:checked');
            if (enabledSources.length === 0) {
                alert('No sources are currently enabled.');
                return;
            }
            
            let delay = 0;
            enabledSources.forEach(input => {
                const match = input.name.match(/sources\[(.*?)\]/);
                if (match && match[1]) {
                    const sourceKey = match[1];
                    const url = dlAllBtn.href + '&source=' + encodeURIComponent(sourceKey);
                    setTimeout(() => {
                        const iframe = document.createElement('iframe');
                        iframe.style.display = 'none';
                        iframe.src = url;
                        document.body.appendChild(iframe);
                        setTimeout(() => iframe.remove(), 15000);
                    }, delay);
                    delay += 1500; // 1.5 second delay between downloads
                }
            });
            return;
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
    });

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
        const configEl = document.getElementById('einkpush-config');
        if (!configEl) return; // Wait for config div

        const showSidebar = configEl.getAttribute('data-show-sidebar') === '1';
        const label = configEl.getAttribute('data-label') || '📖 EinkPush';
        
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
