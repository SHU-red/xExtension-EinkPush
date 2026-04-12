(function() {
    if (window._epScriptLoaded) return;
    window._epScriptLoaded = true;

    // We use event delegation because the DOM might be replaced via AJAX
    document.addEventListener('click', function(e) {
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
        if (document.getElementById('ep-sidebar-btn-main')) return;
        
        console.log('[EinkPush] Searching for sidebar button insertion point...');
        
        const allLinks = document.querySelectorAll('a');
        let subManage = null;
        
        for (const a of allLinks) {
            const href = a.getAttribute('href') || '';
            const txt = a.textContent.trim().toLowerCase();
            
            // Patterns for Subscription Management (EN/DE/FR...)
            if (href.includes('a=subscription') || 
                txt === 'subscription management' || 
                txt === 'abonnements verwalten' ||
                txt === 'abonnement-verwaltung' ||
                txt === 'gestion des abonnements') {
                
                // Ensure it is in the sidebar area
                if (a.closest('.aside') || a.closest('#nav_menu') || a.closest('.nav-list')) {
                    subManage = a;
                    console.log('[EinkPush] Found subscription button:', a);
                    break;
                }
            }
        }
        
        if (subManage) {
            const parentLi = subManage.closest('li');
            if (parentLi && parentLi.parentNode) {
                const li = document.createElement('li');
                li.className = 'item ep-sidebar-item';
                li.id = 'ep-sidebar-btn-main';
                
                const a = document.createElement('a');
                a.href = './?a=extension&e=EinkPush';
                // Copy classes from the original button if possible, then add our own
                a.className = subManage.className + ' ep-btn-settings-orange';
                a.innerHTML = window.EinkSettingsLabel || 'EinkPush Settings';
                
                li.appendChild(a);
                parentLi.parentNode.insertBefore(li, parentLi.nextSibling);
                console.log('[EinkPush] Sidebar button injected successfully.');
            }
        } else {
            // Very final fallback: if we can't find it, append to the first ul in aside
            const asideUl = document.querySelector('.aside ul, #nav_menu ul');
            if (asideUl) {
                const li = document.createElement('li');
                li.className = 'item ep-sidebar-item';
                li.id = 'ep-sidebar-btn-main';
                const a = document.createElement('a');
                a.href = './?a=extension&e=EinkPush';
                a.className = 'btn ep-btn-settings-orange';
                a.innerHTML = window.EinkSettingsLabel || 'EinkPush Settings';
                li.appendChild(a);
                asideUl.appendChild(li);
                console.log('[EinkPush] Sidebar button injected via fallback.');
            }
        }
    }

    // Use MutationObserver for AJAX-intensive themes
    const epObserver = new MutationObserver(() => {
        injectSidebarButton();
    });
    
    window.addEventListener('load', () => {
        console.log('[EinkPush] Extension script initialized.');
        injectSidebarButton();
        epObserver.observe(document.body, { childList: true, subtree: true });
    });
    
    // Safety interval
    setInterval(injectSidebarButton, 2500);
})();
