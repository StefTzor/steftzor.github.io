/**
 * Decides whether this page needs Firebase at all.
 *
 * Firebase used to load on every page: ~175 KB of SDK, a 94 KB auth iframe from
 * firebaseapp.com, 40 KB from apis.google.com, and a live call to Google's identity
 * toolkit - on the homepage, where nobody signs in. Its only job there was to show or
 * hide two header items.
 *
 * So it loads in two cases only:
 *   1. the page actually has auth UI (login, register, the gated area), or
 *   2. this browser has signed in before.
 *
 * Case 2 no longer earns its keep. This file ships only to tzortzoglou.eu, and since sign-in
 * moved to app.tzortzoglou.eu the module it loads does nothing there but maintain the very flag
 * that loaded it. A returning visitor still pays ~175 KB of Firebase SDK from gstatic for that.
 * Kept for now because removing it also narrows the CSP, which deserves its own change.
 *
 * Case 2 is a hint, not a permission. It only decides whether to fetch a script. The gate
 * itself is server-side: /exclusive/ content comes from an API that verifies a Firebase ID
 * token and re-reads the approval on every request, so a forged flag reveals nothing.
 */
(function () {
  "use strict";
  var FLAG = "auth-ui";

  function signedInBefore() {
    try { return localStorage.getItem(FLAG) === "1"; } catch (e) { return false; }
  }

  var required = document.body && document.body.dataset.auth === "required";
  if (required || signedInBefore()) {
    import("/scripts/auth.js").catch(function (err) {
      console.error("auth: could not load", err && err.message);
    });
  }
})();
