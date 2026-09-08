/**
 * Consent banner.
 *
 * The site sets no cookies, and the only device storage (theme preference, Firebase
 * session token) is strictly necessary and therefore exempt from consent under
 * ePrivacy Art. 5(3). Analytics is the one thing a visitor could reasonably object
 * to, so this banner gates exactly that and nothing else — a banner that controlled
 * nothing would be theatre.
 *
 * Analytics is OFF until explicitly accepted (opt-in, not opt-out). Rejecting is one
 * click, exactly like accepting, and the choice can be changed from /cookies/.
 */
(function () {
  var KEY = 'analytics-consent';           // 'granted' | 'denied'
  var GC = 'https://gc.zgo.at/count.js';

  function read() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function write(v) {
    try { localStorage.setItem(KEY, v); } catch (e) { /* private mode: session-only */ }
  }

  function loadAnalytics() {
    if (document.querySelector('script[data-goatcounter]')) return;
    var s = document.createElement('script');
    s.async = true;
    s.src = GC;
    s.setAttribute('data-goatcounter', 'https://steftzor.goatcounter.com/count');
    document.body.appendChild(s);
  }

  function decide(value) {
    write(value);
    if (value === 'granted') loadAnalytics();
    var b = document.getElementById('consent-banner');
    if (b) {
      b.remove();
      // Return focus to the page rather than dropping it on <body>.
      var main = document.getElementById('main-content');
      if (main) { main.setAttribute('tabindex', '-1'); main.focus(); }
    }
    render();
  }

  // Reflect the current choice on /cookies/, where it can be changed.
  function render() {
    var out = document.getElementById('consent-state');
    if (!out) return;
    var v = read();
    out.textContent = v === 'granted' ? 'Analytics is ON — you accepted.'
                    : v === 'denied'  ? 'Analytics is OFF — you declined.'
                    : 'Analytics is OFF — you have not chosen yet.';
    var btn = document.getElementById('consent-withdraw');
    if (btn) btn.textContent = v === 'granted' ? 'Turn analytics off' : 'Turn analytics on';
  }

  function banner() {
    var el = document.createElement('div');
    el.id = 'consent-banner';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'false');
    el.setAttribute('aria-labelledby', 'consent-title');
    el.className = 'fixed bottom-0 inset-x-0 z-[150] p-4 bg-brand-surface ' +
                   'border-t-2 border-brand-accent shadow-2xl';
    el.innerHTML =
      '<div class="container mx-auto max-w-4xl flex flex-col sm:flex-row sm:items-center gap-4">' +
        '<div class="flex-grow">' +
          '<h2 id="consent-title" class="font-bold text-brand-text mb-1">Analytics cookies? There aren’t any.</h2>' +
          '<p class="text-sm text-brand-muted leading-relaxed">' +
            'This site sets <strong class="text-brand-text">no cookies</strong> and runs no advertising. ' +
            'May I count this page view with a privacy-focused, cookieless analytics tool? ' +
            'Declining changes nothing about how the site works. ' +
            '<a href="/cookies/" class="text-brand-accent underline hover:no-underline">Details</a>.' +
          '</p>' +
        '</div>' +
        '<div class="flex gap-3 shrink-0">' +
          '<button type="button" id="consent-reject" class="btn-secondary px-5 py-2 text-sm">Decline</button>' +
          '<button type="button" id="consent-accept" class="btn-primary px-5 py-2 text-sm">Accept</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el);
    document.getElementById('consent-accept').addEventListener('click', function () { decide('granted'); });
    document.getElementById('consent-reject').addEventListener('click', function () { decide('denied'); });
    document.getElementById('consent-reject').focus();
  }

  document.addEventListener('DOMContentLoaded', function () {
    var v = read();
    if (v === 'granted') loadAnalytics();
    if (!v) banner();
    render();

    var toggle = document.getElementById('consent-withdraw');
    if (toggle) {
      toggle.addEventListener('click', function () {
        var next = read() === 'granted' ? 'denied' : 'granted';
        write(next);
        // Turning it off takes effect on the next page load; say so rather than pretend.
        if (next === 'granted') loadAnalytics();
        render();
        var note = document.getElementById('consent-note');
        if (note) {
          note.textContent = next === 'denied'
            ? 'Saved. Analytics will not load on any further page you visit.'
            : 'Saved. Analytics is now enabled.';
        }
      });
    }
  });
})();
