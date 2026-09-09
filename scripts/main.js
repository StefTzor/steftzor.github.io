// main.js - Comprehensive script for all pages
document.addEventListener('DOMContentLoaded', () => {
    // 1. Footer Year
    const yearSpan = document.getElementById('footer-year');
    if (yearSpan) yearSpan.textContent = new Date().getFullYear();

    // 2. Theme Toggle (Desktop and Mobile)
    const themeToggle = document.getElementById('theme-toggle');
    const themeToggleMobile = document.getElementById('theme-toggle-mobile');
    const htmlElement = document.documentElement;

    // Load saved theme or default to dark. Reading localStorage THROWS when site
    // data is blocked, and an uncaught throw here would kill every listener below.
    let savedTheme = null;
    try { savedTheme = localStorage.getItem('theme'); } catch (e) { /* session-only theme */ }
    if (savedTheme === 'dark' || !savedTheme) {
        htmlElement.classList.add('dark');
    } else {
        htmlElement.classList.remove('dark');
    }

    // Keep the toggles' accessible state/label in sync with the actual theme,
    // so a screen reader announces what the button will do next.
    const syncThemeButtons = () => {
        const isDark = htmlElement.classList.contains('dark');
        [themeToggle, themeToggleMobile].forEach(btn => {
            if (!btn) return;
            btn.setAttribute('aria-pressed', String(isDark));
            const label = btn.querySelector('.sr-only');
            if (label) label.textContent = isDark ? 'Switch to light theme' : 'Switch to dark theme';
        });
    };
    syncThemeButtons();

    // Theme toggle function
    const toggleTheme = (e) => {
        e.preventDefault();
        e.stopPropagation();
        htmlElement.classList.toggle('dark');
        const isDark = htmlElement.classList.contains('dark');
        try { localStorage.setItem('theme', isDark ? 'dark' : 'light'); } catch (e) { /* not persisted */ }
        syncThemeButtons();
    };

    // Add event listeners for both desktop and mobile theme toggles
    if (themeToggle) themeToggle.addEventListener('click', toggleTheme);
    if (themeToggleMobile) themeToggleMobile.addEventListener('click', toggleTheme);

    // 3. Mobile Menu
    const menuToggle = document.getElementById('menu-toggle');
    const closeMenu = document.getElementById('close-menu');
    const mobileNav = document.getElementById('mobile-nav');
    const overlay = document.getElementById('overlay');

    const openMenu = () => {
        if (!mobileNav || !overlay) return;
        mobileNav.classList.remove('translate-x-full');
        mobileNav.classList.add('translate-x-0');
        // `inert` while closed keeps the off-screen links out of the tab order.
        mobileNav.removeAttribute('inert');
        overlay.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        if (menuToggle) menuToggle.setAttribute('aria-expanded', 'true');
        if (closeMenu) closeMenu.focus();
    };

    const closeMenuFunc = ({ restoreFocus = true } = {}) => {
        if (!mobileNav || !overlay) return;
        // Move focus out before making the panel inert, or the browser drops it to <body>.
        if (mobileNav.contains(document.activeElement)) {
            if (restoreFocus && menuToggle) menuToggle.focus();
            else document.activeElement.blur();
        }
        mobileNav.classList.remove('translate-x-0');
        mobileNav.classList.add('translate-x-full');
        mobileNav.setAttribute('inert', '');
        overlay.classList.add('hidden');
        document.body.style.overflow = '';
        if (menuToggle) menuToggle.setAttribute('aria-expanded', 'false');
    };

    if (menuToggle) menuToggle.addEventListener('click', openMenu);
    if (closeMenu) closeMenu.addEventListener('click', () => closeMenuFunc());
    if (overlay) overlay.addEventListener('click', () => closeMenuFunc());

    // 4. Exclusive dropdowns — click/keyboard driven, not hover-only.
    const bindDisclosure = (btn, panel, chevron) => {
        if (!btn || !panel) return null;
        const setOpen = (open) => {
            panel.classList.toggle('hidden', !open);
            btn.setAttribute('aria-expanded', String(open));
            if (chevron) chevron.classList.toggle('rotate-180', open);
        };
        btn.addEventListener('click', () => {
            setOpen(panel.classList.contains('hidden'));
        });
        return setOpen;
    };

    const closeDesktopMenu = bindDisclosure(
        document.getElementById('desktop-exclusive-toggle'),
        document.getElementById('desktop-exclusive-menu'),
        document.getElementById('desktop-exclusive-chevron')
    );
    bindDisclosure(
        document.getElementById('exclusive-toggle'),
        document.getElementById('mobile-dropdown'),
        document.getElementById('exclusive-chevron')
    );

    // Close the desktop dropdown on an outside click.
    document.addEventListener('click', (e) => {
        const wrapper = document.getElementById('exclusive-nav-item');
        if (closeDesktopMenu && wrapper && !wrapper.contains(e.target)) closeDesktopMenu(false);
    });

    // 5. Escape closes whatever overlay is open (WCAG 2.1.2, no keyboard trap).
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (mobileNav && !mobileNav.hasAttribute('inert')) closeMenuFunc();
        if (closeDesktopMenu) {
            const btn = document.getElementById('desktop-exclusive-toggle');
            if (btn && btn.getAttribute('aria-expanded') === 'true') {
                closeDesktopMenu(false);
                btn.focus();
            }
        }
    });

    // 6. Active Page Highlighting
    highlightActivePage();
});

/**
 * Automatically highlights the navigation link for the current page.
 * Desktop: Adds a bottom border.
 * Mobile: Adds a background tint and left border.
 */
function highlightActivePage() {
    const currentPath = window.location.pathname;
    const navLinks = document.querySelectorAll('nav a');

    navLinks.forEach(link => {
        const linkPath = link.getAttribute('href');

        // Logic: Exact match OR sub-path match (excluding root '/' so Home doesn't light up everywhere)
        const isActive = linkPath === currentPath || (linkPath !== '/' && currentPath.startsWith(linkPath));

        if (isActive) {
            // 1. Common Styles (Text Color & Bold)
            link.classList.remove('text-brand-text');
            link.classList.add('text-brand-accent', 'font-bold');
            // Announce the current page to assistive tech, not just visually.
            link.setAttribute('aria-current', 'page');

            // 2. Desktop Specifics (inside .md:flex container)
            if (link.closest('.md\\:flex')) {
                link.classList.add('border-b-2', 'border-brand-accent');
            }

            // 3. Mobile Specifics (inside #mobile-nav container)
            if (link.closest('#mobile-nav')) {
                link.classList.add('bg-brand-accent/10', 'border-l-4', 'border-brand-accent');
            }
        }
    });
}
