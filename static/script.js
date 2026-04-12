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
})();
