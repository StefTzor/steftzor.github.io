import { API_BASE } from "./api-base.js";

/**
 * One page view, counted by the API rather than by anyone else.
 *
 * This is the app's half of the beacon; the public site's copy is gated behind consent, and this
 * one is not. Counting page loads of a service you run, for the operation of that service, is not
 * audience measurement: everyone here is a known account holder who signed in, there is nothing
 * to profile them with, and the row that gets written cannot be tied back to them. That is why
 * there is no banner. It is documented on /docs/ and in /privacy/, which is the part that makes
 * it defensible - an undocumented count is the same count with the honesty removed.
 *
 * **Nothing is sent by importing this file.** It used to fire at import time, which made that
 * justification false: every page here is a static file that any stranger can fetch, and the
 * sign-in is a redirect that JavaScript performs afterwards - so somebody who never had an
 * account, and was about to be bounced to /login/, was counted as `app` first. shell.js calls
 * count() only once /me has answered for a real session, which is the earliest moment the word
 * "account holder" is true of whoever is reading.
 *
 * Which pages count therefore follows from which pages load shell.js: the signed-in ones. It is
 * off on /login/, /register/, /reset/, /signed-out/ and /action/, which belong to people who are
 * not signed in yet - and /action/ arrives from a password-reset email carrying a single-use code
 * in its query string, a URL not to go anywhere near.
 *
 * `location.pathname` alone, never `location.href`. Two app pages carry something in their query
 * string that has no business in a table - /admin/account/?uid= names a Firebase account, and
 * /action/?oobCode= is a single-use password-reset credential arriving from an email. The server
 * strips a query string before it stores anything, and this is the other side of that same rule:
 * the client does not send one either, so the credential never leaves the tab it arrived in
 * rather than being discarded at the far end of a request.
 *
 * The property is NOT sent. The server reads it from the Origin header, which CORS has already
 * checked; a property in this body would be a claim by a page rather than a fact about it.
 */

// One page load is one view, whatever calls this and however often.
let counted = false;

export function count() {
  if (counted) return;
  counted = true;

  const body = JSON.stringify({ path: location.pathname, referrer: document.referrer });

  try {
    // sendBeacon survives the page being closed mid-flight, which fetch() only does with
    // keepalive - so the fallback asks for the same thing the beacon gives for free.
    // A Blob typed text/plain, because that is one of the three types a CORS-simple request may
    // carry: the beacon then leaves with no OPTIONS in front of it, where application/json cost
    // a preflight on every counted page load and could drop the beacon silently if that
    // preflight ever failed. The route parses both, so the fetch fallback below still sends JSON.
    const sent = navigator.sendBeacon
      && navigator.sendBeacon(API_BASE + "/hit", new Blob([body], { type: "text/plain" }));
    if (!sent) {
      fetch(API_BASE + "/hit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
    }
  } catch (e) {
    // Silence is the whole contract. A counter that breaks a page it was only ever observing has
    // cost more than it could possibly be worth.
  }
}
