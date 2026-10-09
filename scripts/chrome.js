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
    if (overlay) overlay.classList.remove('opacity-0', 'pointer-events-none');
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
    if (overlay) overlay.classList.add('opacity-0', 'pointer-events-none');
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

  // Swipe it shut. The drawer follows the finger 1:1 from where it was grabbed, and on release
  // the flick is projected forward (Apple's decay projection, rate 0.998) so a short fast flick
  // closes it and a slow drag that stops short springs back. Clearing the inline transform hands
  // over to the CSS transition, which starts from the on-screen position rather than jumping.
  // Touch and pen only: a mouse has the close button, Escape and the scrim.
  if (mobileNav && overlay) {
    const rubberband = (o, d) => (o * d * 0.55) / (d + 0.55 * Math.abs(o));
    let startX = null, startY = 0, dx = 0, lastX = 0, lastT = 0, v = 0, dragging = false;

    mobileNav.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || mobileNav.hasAttribute('inert')) return;
      startX = lastX = e.clientX; startY = e.clientY; lastT = e.timeStamp;
      dx = v = 0; dragging = false;
    });

    mobileNav.addEventListener('pointermove', (e) => {
      if (startX === null) return;
      const mx = e.clientX - startX, my = e.clientY - startY;
      if (!dragging) {
        // 10px before committing, and only to a mostly sideways move: vertical is the list scrolling.
        if (Math.abs(mx) < 10 && Math.abs(my) < 10) return;
        if (Math.abs(mx) <= Math.abs(my)) { startX = null; return; }
        dragging = true;
        mobileNav.setPointerCapture(e.pointerId);
        mobileNav.style.transition = overlay.style.transition = 'none';
      }
      const dt = e.timeStamp - lastT;
      if (dt > 0) v = 0.8 * ((e.clientX - lastX) / dt) * 1000 + 0.2 * v;
      lastX = e.clientX; lastT = e.timeStamp;
      const w = mobileNav.offsetWidth;
      // Dragging further open than open resists instead of stopping dead.
      dx = mx > 0 ? mx : rubberband(mx, w);
      mobileNav.style.transform = `translateX(${dx}px)`;
      overlay.style.opacity = String(1 - Math.max(0, dx) / w);
    });

    const release = (e) => {
      if (startX === null) return;
      startX = null;
      if (!dragging) return;
      dragging = false;
      // A finger that stopped before lifting has no velocity left to project.
      if (e.timeStamp - lastT > 80) v = 0;
      const projected = dx + (v / 1000) * 0.998 / (1 - 0.998);
      mobileNav.style.transition = overlay.style.transition = '';
      mobileNav.style.transform = overlay.style.opacity = '';
      if (projected > mobileNav.offsetWidth / 2) closeMenuFunc(false);
    };
    mobileNav.addEventListener('pointerup', release);
    mobileNav.addEventListener('pointercancel', release);
  }

  // --- where you are -------------------------------------------------------
  // Keyed on data-nav rather than href, so the app's absolute links back to tzortzoglou.eu do
  // not need special-casing, and so both properties mark the active item the same way.
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const key = path === '/' ? 'home' : path.replace(/\//g, '');
  document.querySelectorAll(`[data-nav="${key}"]`).forEach((link) => {
    link.setAttribute('aria-current', 'page');
  });

  // --- the status badge in the footer --------------------------------------
  // Asks the API's /status only once the footer is on screen, and at most once a page: the
  // answer is cached for 30 seconds by the browser, and /status/ itself keeps the live view.
  // A failure leaves the badge as the plain link it is without script.
  const badge = document.getElementById('stBadge');
  if (badge && 'IntersectionObserver' in window) {
    const api = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
      ? 'http://localhost:3000' : 'https://api.tzortzoglou.eu';
    const seen = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      seen.disconnect();
      fetch(api + '/status')
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error('status ' + res.status))))
        .then((data) => drawBadge(badge, data))
        .catch(() => { badge.dataset.state = 'unknown'; });
    });
    seen.observe(badge);
  }
});

/** Fills the footer badge from a /status answer. Every string is set with textContent. */
function drawBadge(badge, data) {
  const all = Array.isArray(data && data.components) ? data.components : [];
  if (!all.length) { badge.dataset.state = 'unknown'; return; }
  const down = all.filter((c) => c.status === 'down');
  badge.dataset.state = down.length ? 'down' : 'up';
  document.getElementById('stBadgeTitle').textContent = down.length
    ? (down.length === 1 ? down[0].name + ' is down' : down.length + ' services down')
    : 'All systems working';

  // Uptime of the stack itself (site, app, API, database), over the week.
  const week = all.filter((c) => c.group === 'stack' && typeof c.uptime7d === 'number').map((c) => c.uptime7d);
  const uptime = week.length ? week.reduce((a, b) => a + b, 0) / week.length : null;
  const parts = [];
  if (uptime !== null) parts.push((uptime >= 0.9995 ? '100' : (uptime * 100).toFixed(2)) + '% uptime, 7 days');
  const last = Math.max(...all.map((c) => (c.checkedAt ? Date.parse(c.checkedAt) : 0)));
  if (last > 0) {
    const mins = Math.max(0, Math.round((Date.now() - last) / 60000));
    parts.push(mins < 1 ? 'checked just now' : 'checked ' + mins + ' min ago');
  }
  if (parts.length) document.getElementById('stBadgeMeta').textContent = parts.join(' · ');

  // 24 hourly bars, every component together: the worst share answered in that hour.
  const strip = document.getElementById('stBadgeStrip');
  strip.textContent = '';
  for (let i = 0; i < 24; i++) {
    const hour = all.map((c) => (Array.isArray(c.hours) ? c.hours[i] : null)).filter((h) => typeof h === 'number');
    const worst = hour.length ? Math.min(...hour) : null;
    const bar = document.createElement('span');
    bar.dataset.level = worst === null ? 'none' : worst === 1 ? 'up' : worst === 0 ? 'down' : 'partial';
    bar.style.setProperty('--i', i);
    strip.appendChild(bar);
  }
}
