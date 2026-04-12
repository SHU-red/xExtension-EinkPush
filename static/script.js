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
        if (document.getElementById('ep-sidebar-group')) return;
        
        // Find the main sidebar navigation list
        const navList = document.querySelector('#nav_menu .nav-list') 
                     || document.querySelector('.aside .nav-list')
                     || document.querySelector('#nav_menu ul')
                     || document.querySelector('.aside ul');
                      
        if (navList) {
            const epGroup = document.createElement('div');
            epGroup.id = 'ep-sidebar-group';
            epGroup.style.marginTop = '10px';
            epGroup.style.borderTop = '1px solid rgba(0,0,0,0.1)';
            epGroup.style.paddingTop = '10px';

            // 1. Settings Button
            const settingsLi = document.createElement('li');
            settingsLi.className = 'item ep-sidebar-item';
            const settingsA = document.createElement('a');
            settingsA.href = './?a=extension&e=EinkPush';
            settingsA.innerHTML = '⚙️ EinkPush Settings';
            settingsA.className = 'ep-btn-sidebar ep-btn-blue';
            settingsLi.appendChild(settingsA);
            epGroup.appendChild(settingsLi);

            // 2. Push All Button
            const pushLi = document.createElement('li');
            pushLi.className = 'item ep-sidebar-item';
            const pushA = document.createElement('a');
            pushA.href = './?a=extension&e=EinkPush&get=push';
            pushA.className = 'ep-btn-sidebar ep-btn-amber';
            pushA.innerHTML = '🚀 ' + (window.EinkPushLabel || 'Push All to E-Ink');
            pushLi.appendChild(pushA);
            epGroup.appendChild(pushLi);
            
            // 3. Download Favorites Button
            const dlLi = document.createElement('li');
            dlLi.className = 'item ep-sidebar-item';
            const dlA = document.createElement('a');
            dlA.href = './?a=extension&e=EinkPush&get=generate&source=favorites';
            dlA.className = 'ep-btn-sidebar ep-btn-green';
            dlA.innerHTML = '📂 Download Favorites';
            dlLi.appendChild(dlA);
            epGroup.appendChild(dlLi);

            // Insert after subscription management or at the end
            const subManage = navList.querySelector('a[href*="a=subscription"]');
            if (subManage) {
                subManage.closest('li').after(epGroup);
            } else {
                navList.appendChild(epGroup);
            }
        }
    }
    
    // Run periodically to catch AJAX updates
    setInterval(injectSidebarButton, 1000);
})();
