// main.js
document.addEventListener('DOMContentLoaded', () => {
    // 1. Footer Year
    const yearSpan = document.getElementById('footer-year');
    if (yearSpan) yearSpan.textContent = new Date().getFullYear();

    // 2. Theme Toggle (Sync with Header IDs)
    const themeToggles = document.querySelectorAll('#theme-toggle, #theme-toggle-mobile');
    const htmlElement = document.documentElement;

    themeToggles.forEach(toggle => {
        toggle.addEventListener('click', () => {
            htmlElement.classList.toggle('dark');
            localStorage.setItem('theme', htmlElement.classList.contains('dark') ? 'dark' : 'light');
        });
    });

    // 3. Mobile Menu (Sync with Header IDs)
    const menuToggle = document.getElementById('menu-toggle');
    const closeMenu = document.getElementById('close-menu');
    const mobileNav = document.getElementById('mobile-nav');
    const overlay = document.getElementById('overlay');

    const toggleMenu = () => {
        mobileNav.classList.toggle('translate-x-full');
        overlay.classList.toggle('hidden');
        document.body.classList.toggle('overflow-hidden');
    };

    if (menuToggle) menuToggle.addEventListener('click', toggleMenu);
    if (closeMenu) closeMenu.addEventListener('click', toggleMenu);
    if (overlay) overlay.addEventListener('click', toggleMenu);

    // 4. Mobile Dropdown Accordion
    const exclusiveToggle = document.getElementById('exclusive-toggle');
    const mobileDropdown = document.getElementById('mobile-dropdown');
    if (exclusiveToggle && mobileDropdown) {
        exclusiveToggle.addEventListener('click', () => {
            mobileDropdown.classList.toggle('hidden');
        });
    }
});// main.js
document.addEventListener('DOMContentLoaded', () => {
    // 1. Footer Year
    const yearSpan = document.getElementById('footer-year');
    if (yearSpan) yearSpan.textContent = new Date().getFullYear();

    // 2. Theme Toggle (Sync with Header IDs)
    const themeToggles = document.querySelectorAll('#theme-toggle, #theme-toggle-mobile');
    const htmlElement = document.documentElement;

    themeToggles.forEach(toggle => {
        toggle.addEventListener('click', () => {
            htmlElement.classList.toggle('dark');
            localStorage.setItem('theme', htmlElement.classList.contains('dark') ? 'dark' : 'light');
        });
    });

    // 3. Mobile Menu (Sync with Header IDs)
    const menuToggle = document.getElementById('menu-toggle');
    const closeMenu = document.getElementById('close-menu');
    const mobileNav = document.getElementById('mobile-nav');
    const overlay = document.getElementById('overlay');

    const toggleMenu = () => {
        mobileNav.classList.toggle('translate-x-full');
        overlay.classList.toggle('hidden');
        document.body.classList.toggle('overflow-hidden');
    };

    if (menuToggle) menuToggle.addEventListener('click', toggleMenu);
    if (closeMenu) closeMenu.addEventListener('click', toggleMenu);
    if (overlay) overlay.addEventListener('click', toggleMenu);

    // 4. Mobile Dropdown Accordion
    const exclusiveToggle = document.getElementById('exclusive-toggle');
    const mobileDropdown = document.getElementById('mobile-dropdown');
    if (exclusiveToggle && mobileDropdown) {
        exclusiveToggle.addEventListener('click', () => {
            mobileDropdown.classList.toggle('hidden');
        });
    }
});