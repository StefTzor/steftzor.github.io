/**
 * Contact form submission.
 *
 * Deliberately not a module and not dependent on Firebase — this form is for people who
 * have no account and never will. It posts to the same API that serves /exclusive/, which
 * validates everything again server-side; nothing here is a security control.
 */
(function () {
  "use strict";

  var API_BASE = (location.hostname === "localhost" || location.hostname === "127.0.0.1")
    ? "http://localhost:3000"
    : "https://api.tzortzoglou.eu";

  // One generic failure message. A form that reports "that address is already known" or
  // echoes a provider error tells a prober more than it tells a visitor.
  var FAILED = "Sorry — the message could not be sent. Please email stefanos@tzortzoglou.eu instead.";
  var SENT = "Thank you. Your message has been sent — I will reply to the address you gave.";

  document.addEventListener("DOMContentLoaded", function () {
    var form = document.getElementById("contactForm");
    if (!form) return;

    var loadedAt = Date.now();
    var status = document.getElementById("contactStatus");
    var submit = document.getElementById("contactSubmit");

    function show(message, ok) {
      status.textContent = message;
      status.className = "mb-4 text-sm " + (ok
        ? "text-green-700 dark:text-green-400"
        : "text-red-700 dark:text-red-400");
    }

    form.addEventListener("submit", async function (event) {
      event.preventDefault();

      var name = document.getElementById("contactName").value.trim();
      var email = document.getElementById("contactEmail").value.trim();
      var message = document.getElementById("contactMessage").value.trim();
      var consent = document.getElementById("contactConsent");

      // Checked here as well as by `required` so the message is ours and is announced.
      if (!consent || !consent.checked) {
        show("Please agree to the privacy terms before sending.", false);
        return;
      }
      if (!name || !email || message.length < 10) {
        show("Please fill in your name, email address, and a message of at least 10 characters.", false);
        return;
      }

      submit.disabled = true;
      show("Sending…", true);

      try {
        var res = await fetch(API_BASE + "/contact", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name,
            email: email,
            message: message,
            consent: true,
            website: document.getElementById("website").value,
            // Bots submit instantly; the API drops anything under its minimum fill time.
            elapsedMs: Date.now() - loadedAt
          })
        });

        if (!res.ok) {
          // 429 is worth distinguishing: it is the one failure the visitor can act on.
          show(res.status === 429
            ? "Too many messages from this connection. Please try again later."
            : FAILED, false);
          submit.disabled = false;
          return;
        }

        form.reset();
        loadedAt = Date.now();
        show(SENT, true);
      } catch (err) {
        // Network failure, CORS rejection, API down — the visitor gets one honest message
        // and a route that does not depend on any of it.
        show(FAILED, false);
        submit.disabled = false;
      }
    });
  });
})();
