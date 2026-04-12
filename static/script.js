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

    // Inject sidebar button
    function injectSidebarButton() {
        if (document.getElementById('ep-sidebar-btn')) return;
        
        // Target specifically the subscription management link in the sidebar
        // Try multiple selectors as themes might vary
        const subManage = document.querySelector('.aside li.item a[href*="a=subscription"]') 
                      || document.querySelector('#nav_menu .item a[href*="a=subscription"]');
                      
        if (subManage) {
            const container = subManage.closest('li');
            
            // 1. Settings Button
            const settingsLi = document.createElement('li');
            settingsLi.className = 'item ep-sidebar-item';
            settingsLi.id = 'ep-settings-btn';
            const settingsA = document.createElement('a');
            settingsA.href = './?a=extension&e=EinkPush';
            settingsA.innerHTML = '⚙️ EinkPush Settings';
            settingsA.className = 'ep-btn-sidebar ep-btn-blue';
            settingsLi.appendChild(settingsA);
            container.after(settingsLi);

            // 2. Push All Button
            const pushLi = document.createElement('li');
            pushLi.className = 'item ep-sidebar-item';
            pushLi.id = 'ep-sidebar-btn';
            const pushA = document.createElement('a');
            pushA.href = './?a=extension&e=EinkPush&get=push';
            pushA.className = 'ep-btn-sidebar ep-btn-amber';
            pushA.innerHTML = '🚀 ' + (window.EinkPushLabel || 'Push All to E-Ink');
            pushLi.appendChild(pushA);
            settingsLi.after(pushLi);
            
            // 3. Download Favorites Button
            const dlLi = document.createElement('li');
            dlLi.className = 'item ep-sidebar-item';
            dlLi.id = 'ep-dl-fav-btn';
            const dlA = document.createElement('a');
            dlA.href = './?a=extension&e=EinkPush&get=generate&source=favorites';
            dlA.className = 'ep-btn-sidebar ep-btn-green';
            dlA.innerHTML = '📂 Download Favorites';
            dlLi.appendChild(dlA);
            pushLi.after(dlLi);
        }
    }
    
    // Run periodically to catch AJAX updates
    setInterval(injectSidebarButton, 1000);
})();
