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

  // Same rule as contact.js, so there is one convention for "which API am I talking to".
  var API_BASE = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? 'http://localhost:3000'
    : 'https://api.tzortzoglou.eu';

  var memory = null;                       // fallback when storage is blocked
  var counted = false;                     // one page load is one view, however consent arrived

  function read() {
    try { return localStorage.getItem(KEY); } catch (e) { return memory; }
  }
  // Returns false when the choice could not be persisted, so the UI can say so
  // instead of claiming "Saved."
  function write(v) {
    memory = v;
    try { localStorage.setItem(KEY, v); return true; } catch (e) { return false; }
  }

  // The beacon carries which page and where the visitor came from, and nothing else.
  // `location.pathname` leaves out this page's own query string and fragment, so a search
  // term sitting in the address bar is never sent. The referrer is a different matter and
  // this used to claim otherwise: it is sent whole, because the browser gives it whole, and
  // a referring URL is exactly where somebody's search terms ride. The server reduces it to
  // its host before anything is written and discards the rest - so the trimming is real, it
  // just happens one hop later than here. What is NOT sent is a referrer from this same site:
  // the server drops a same-site one as self-referral anyway, so sending it could only ever
  // carry the previous page's query string somewhere it is not wanted.
  // The property (site or app) is decided server-side
  // from the Origin header: a client that named its own property would be making a claim
  // rather than reporting a fact.
  // The referring URL, but only when it came from somewhere else. Wrapped because an opaque or
  // malformed referrer makes URL() throw, and a counter may not be the thing that breaks a page.
  function fromElsewhere() {
    var ref = document.referrer;
    if (!ref) return '';
    try {
      return new URL(ref).origin === location.origin ? '' : ref;
    } catch (e) {
      return '';
    }
  }

  function count() {
    if (counted) return;
    counted = true;
    var url = API_BASE + '/hit';
    var body = JSON.stringify({ path: location.pathname, referrer: fromElsewhere() });
    try {
      // sendBeacon survives the page being closed the instant after this runs; keepalive
      // gives the fetch fallback the same property.
      // Typed text/plain, which is one of the three content types a CORS-simple request may
      // carry, so the beacon leaves with no OPTIONS in front of it. As application/json it
      // cost a preflight on every counted page view, and a preflight that fails takes the
      // beacon with it silently. The endpoint parses both, so the fallback below still sends
      // JSON with the header that names it.
      if (navigator.sendBeacon &&
          navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }))) return;
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        keepalive: true
      }).catch(function () {});
    } catch (e) {
      // A counter is not worth an error in a visitor's console.
    }
  }

  function decide(value) {
    var saved = write(value);
    if (value === 'granted') count();
    var b = document.getElementById('consent-banner');
    if (b) {
      b.remove();
      // Return focus to the page rather than dropping it on <body>.
      var main = document.getElementById('main-content');
      if (main) { main.setAttribute('tabindex', '-1'); main.focus(); }
    }
    render();
    return saved;
  }

  // Reflect the current choice on /cookies/, where it can be changed.
  function render() {
    var out = document.getElementById('consent-state');
    if (!out) return;
    var v = read();
    out.textContent = v === 'granted' ? 'Analytics is ON. You accepted.'
                    : v === 'denied'  ? 'Analytics is OFF. You declined.'
                    : 'Analytics is OFF. You have not chosen yet.';
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
          '<h2 id="consent-title" class="font-bold text-brand-text mb-1">May I count this page view?</h2>' +
          '<p class="text-sm text-brand-muted leading-relaxed">' +
            'This site sets <strong class="text-brand-text">no cookies</strong> and runs no advertising. ' +
            'The count goes to <strong class="text-brand-text">my own server</strong>: ' +
            'no third party, no cookie, and one visitor number that stays the same for this browser all day. ' +
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
  }

  document.addEventListener('DOMContentLoaded', function () {
    var v = read();
    if (v === 'granted') count();
    if (!v) banner();
    render();

    var toggle = document.getElementById('consent-withdraw');
    if (toggle) {
      toggle.addEventListener('click', function () {
        var next = read() === 'granted' ? 'denied' : 'granted';
        var saved = decide(next);
        var note = document.getElementById('consent-note');
        if (note) {
          note.textContent = !saved
            ? 'Applied to this page only. Your browser is blocking site storage, so this choice cannot be remembered.'
            : next === 'denied'
              ? 'Saved. Nothing further you visit will be counted.'
              : 'Saved. Analytics is now enabled.';
        }
      });
    }
  });
})();
