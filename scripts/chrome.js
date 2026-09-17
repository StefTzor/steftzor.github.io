/**
 * The chrome both properties share: the theme toggle, the mobile drawer, and marking where you
 * are. Loaded by the public site and by the app.
 *
 * It deliberately imports nothing. app/scripts/shell.js pulls the Firebase SDK from gstatic, and
 * if that request fails the module never executes - so anything living inside it dies with it.
 * Navigation is presentation: it must keep working when the auth stack does not.
 */
document.addEventListener('DOMContentLoaded', () => {

  const yearEl = document.getElementById('footer-year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // --- theme ---------------------------------------------------------------
  // Every localStorage access is wrapped: reading it THROWS when site data is blocked, and an
  // uncaught throw here would kill every listener below it.
  const themeButtons = [document.getElementById('theme-toggle'), document.getElementById('theme-toggle-mobile')].filter(Boolean);

  function syncThemeButtons() {
    const isDark = document.documentElement.classList.contains('dark');
    themeButtons.forEach((btn) => {
      btn.setAttribute('aria-pressed', String(isDark));
      const label = btn.querySelector('.sr-only');
      if (label) label.textContent = isDark ? 'Switch to light theme' : 'Switch to dark theme';
    });
  }

  function toggleTheme() {
    const isDark = document.documentElement.classList.toggle('dark');
    // theme-at is what makes the handoff last-write-wins across the two origins, rather than
    // working once and then never again. See _includes/chrome/theme-boot.njk.
    try {
      localStorage.setItem('theme', isDark ? 'dark' : 'light');
      localStorage.setItem('theme-at', String(Date.now()));
    } catch (e) { /* blocked */ }
    syncThemeButtons();
    syncCrossLinks();
  }

  // --- handing the theme to the other property --------------------------
  // localStorage is per-origin, so the choice made here is invisible on the other side and
  // crossing over used to flip you back to dark. The link carries the answer instead, with the
  // time it was chosen so the two origins can tell whose is newer; the receiving end adopts it
  // and takes it back out of the address bar, both in _includes/chrome/theme-boot.njk.
  // Written on load and after every toggle rather than on click, so that opening the link in
  // a new tab or copying its address carries the theme too.
  function syncCrossLinks() {
    const theme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    let at = '0';
    try { at = localStorage.getItem('theme-at') || '0'; } catch (e) { /* blocked */ }
    document.querySelectorAll('a[data-cross]').forEach((a) => {
      try {
        const url = new URL(a.href);
        url.searchParams.set('theme', theme);
        url.searchParams.set('theme-at', at);
        a.href = url.toString();
      } catch (e) { /* a relative or malformed href is not ours to fix */ }
    });
  }

  themeButtons.forEach((btn) => btn.addEventListener('click', toggleTheme));
  syncThemeButtons();
  syncCrossLinks();

  // --- mobile drawer -------------------------------------------------------
  const menuToggle = document.getElementById('menu-toggle');
  const mobileNav = document.getElementById('mobile-nav');
  const overlay = document.getElementById('overlay');
  const closeMenu = document.getElementById('close-menu');

  function openMenu() {
    if (!mobileNav) return;
    mobileNav.removeAttribute('inert');
    mobileNav.classList.replace('translate-x-full', 'translate-x-0');
    if (overlay) overlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    if (menuToggle) menuToggle.setAttribute('aria-expanded', 'true');
    if (closeMenu) closeMenu.focus();
  }

  function closeMenuFunc(restoreFocus) {
    if (!mobileNav) return;
    // Move focus out BEFORE marking it inert, or the browser is left with focus on an element
    // it has just been told to ignore.
    if (mobileNav.contains(document.activeElement)) {
      if (restoreFocus && menuToggle) menuToggle.focus();
      else if (document.activeElement.blur) document.activeElement.blur();
    }
    mobileNav.setAttribute('inert', '');
    mobileNav.classList.replace('translate-x-0', 'translate-x-full');
    if (overlay) overlay.classList.add('hidden');
    document.body.style.overflow = '';
    if (menuToggle) menuToggle.setAttribute('aria-expanded', 'false');
  }

  if (menuToggle) menuToggle.addEventListener('click', openMenu);
  if (closeMenu) closeMenu.addEventListener('click', () => closeMenuFunc(true));
  if (overlay) overlay.addEventListener('click', () => closeMenuFunc(false));

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (mobileNav && !mobileNav.hasAttribute('inert')) closeMenuFunc(true);
  });

  // --- where you are -------------------------------------------------------
  // Keyed on data-nav rather than href, so the app's absolute links back to tzortzoglou.eu do
  // not need special-casing, and so both properties mark the active item the same way.
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const key = path === '/' ? 'home' : path.replace(/\//g, '');
  document.querySelectorAll(`[data-nav="${key}"]`).forEach((link) => {
    link.setAttribute('aria-current', 'page');
  });
});
