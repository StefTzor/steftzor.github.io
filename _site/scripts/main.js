// main.js - Comprehensive script for all pages
document.addEventListener('DOMContentLoaded', () => {
    // 1. Footer Year
    const yearSpan = document.getElementById('footer-year');
    if (yearSpan) yearSpan.textContent = new Date().getFullYear();

    // 2. Theme Toggle (Desktop and Mobile)
    const themeToggle = document.getElementById('theme-toggle');
    const themeToggleMobile = document.getElementById('theme-toggle-mobile');
    const htmlElement = document.documentElement;

    // Load saved theme or default to dark
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        htmlElement.classList.add('dark');
    } else {
        htmlElement.classList.remove('dark');
    }

    // Theme toggle function
    const toggleTheme = (e) => {
        e.preventDefault();
        e.stopPropagation();
        htmlElement.classList.toggle('dark');
        const isDark = htmlElement.classList.contains('dark');
        localStorage.setItem('theme', isDark ? 'dark' : 'light');
        console.log('Theme toggled to:', isDark ? 'dark' : 'light'); // Debug log
    };

    // Add event listeners for both desktop and mobile theme toggles
    if (themeToggle) {
        themeToggle.addEventListener('click', toggleTheme);
        console.log('Desktop theme toggle attached'); // Debug log
    }
    if (themeToggleMobile) {
        themeToggleMobile.addEventListener('click', toggleTheme);
        console.log('Mobile theme toggle attached'); // Debug log
    }

    // 3. Mobile Menu
    const menuToggle = document.getElementById('menu-toggle');
    const closeMenu = document.getElementById('close-menu');
    const mobileNav = document.getElementById('mobile-nav');
    const overlay = document.getElementById('overlay');

    const openMenu = () => {
        if (mobileNav && overlay) {
            mobileNav.classList.remove('translate-x-full');
            mobileNav.classList.add('translate-x-0');
            overlay.classList.remove('hidden');
            document.body.style.overflow = 'hidden';
        }
    };

    const closeMenuFunc = () => {
        if (mobileNav && overlay) {
            mobileNav.classList.remove('translate-x-0');
            mobileNav.classList.add('translate-x-full');
            overlay.classList.add('hidden');
            document.body.style.overflow = '';
        }
    };

    if (menuToggle) menuToggle.addEventListener('click', openMenu);
    if (closeMenu) closeMenu.addEventListener('click', closeMenuFunc);
    if (overlay) overlay.addEventListener('click', closeMenuFunc);

    // 4. Mobile Dropdown Accordion
    const exclusiveToggle = document.getElementById('exclusive-toggle');
    const mobileDropdown = document.getElementById('mobile-dropdown');
    const exclusiveChevron = document.getElementById('exclusive-chevron');

    if (exclusiveToggle && mobileDropdown) {
        exclusiveToggle.addEventListener('click', () => {
            mobileDropdown.classList.toggle('hidden');
            
            // Rotate chevron icon
            if (exclusiveChevron) {
                if (mobileDropdown.classList.contains('hidden')) {
                    exclusiveChevron.classList.remove('fa-chevron-up');
                    exclusiveChevron.classList.add('fa-chevron-down');
                } else {
                    exclusiveChevron.classList.remove('fa-chevron-down');
                    exclusiveChevron.classList.add('fa-chevron-up');
                }
            }
        });
    }
});