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

        // Target the specific FreshRSS 1.28.1 sidebar structure
        const targetDiv = document.querySelector('.configure-feeds');
        if (targetDiv) {
            const container = document.createElement('div');
            container.className = 'stick ep-sidebar-container';
            container.id = 'ep-sidebar-btn-main';
            container.style.marginTop = '10px'; // Spacing
            
            const a = document.createElement('a');
            a.href = './?c=extension&a=configure&e=EinkPush';
            a.className = 'btn ep-btn-settings-orange';
            a.style.width = '100%';
            a.style.display = 'block';
            a.innerHTML = 'EinkPush'; 
            
            container.appendChild(a);
            targetDiv.parentNode.insertBefore(container, targetDiv.nextSibling);
            console.log('[EinkPush] Sidebar button injected below .configure-feeds.');
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
                li.className = 'item ep-sidebar-item';
                li.id = 'ep-sidebar-btn-main';
                
                const a = document.createElement('a');
                a.href = './?c=extension&a=configure&e=EinkPush';
                a.className = subManage.className + ' ep-btn-settings-orange';
                a.innerHTML = 'EinkPush'; 
                
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
