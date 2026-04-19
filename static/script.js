function activateTab(navItem) {
    const target = navItem.getAttribute('data-target');
    if (!target) return null;
    const section = document.getElementById(target);
    if (section) {
        document.querySelectorAll('.ep-section').forEach(s => s.classList.remove('active'));
        section.classList.add('active');
    }
    return target;
}