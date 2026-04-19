// Simplified tab activation
function activateTab(navItem) {
    const target = navItem.getAttribute('data-target') || 'ep-global';
    document.querySelectorAll('.ep-section').forEach(s => s.classList.remove('active'));
    const section = document.getElementById(target);
    if (section) section.classList.add('active');
}

// Install single click handler
document.addEventListener('click', e => {
    if (e.target.closest('.ep-nav-item')) {
        activateTab(e.target.closest('.ep-nav-item'));
    }
});