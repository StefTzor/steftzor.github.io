import { auth } from "./firebase-config.js";
import { EmailAuthProvider, reauthenticateWithCredential } from "https://www.gstatic.com/firebasejs/11.3.1/firebase-auth.js";
import { api, profile } from "./shell.js";
import { fieldError, clearField, clearAll, check, validateOnBlur, busy } from "./forms.js";

/**
 * The profile page: your name, the address you sign in with, and two preferences.
 *
 * The shell owns identity and navigation; this owns only what a person can change about
 * themselves. Every write goes through the API - firestore.rules refuses a browser writing its
 * own user document, deliberately, so there is exactly one definition of what is changeable and
 * it lives on the server.
 */

const el = (id) => document.getElementById(id);

/** One live region for the page, like the Admin view. */
function say(message, kind) {
  const box = el("status");
  if (!box) return;
  box.className = "mb-6 text-sm " + (kind === "error"
    ? "text-red-700 dark:text-red-400"
    : kind === "ok" ? "text-emerald-700 dark:text-emerald-400" : "text-brand-muted");
  box.textContent = message;
}

// --- name --------------------------------------------------------------------

function wireName(me) {
  const form = el("nameForm");
  const first = el("firstName");
  const last = el("lastName");
  if (!form) return;

  first.value = me.firstName || "";
  last.value = me.lastName || "";
  validateOnBlur(first, (v) => check.required(v, "first name"));
  validateOnBlur(last, (v) => check.required(v, "last name"));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearAll(form);
    let bad = false;
    for (const [input, what] of [[first, "first name"], [last, "last name"]]) {
      const message = check.required(input.value, what);
      if (message) { fieldError(input, message); bad = true; }
    }
    if (bad) { say("Check the fields marked above.", "error"); first.focus(); return; }

    busy(form, true, "Saving…");
    try {
      const res = await api("/me/profile", {
        method: "POST",
        body: JSON.stringify({ firstName: first.value.trim(), lastName: last.value.trim() }),
      });
      first.value = res.firstName || "";
      last.value = res.lastName || "";
      say("Your name has been saved.", "ok");
    } catch (err) {
      say(err.code === "bad_name"
        ? "A name must be between 1 and 60 characters."
        : "That could not be saved.", "error");
    }
    busy(form, false);
  });
}

// --- email -------------------------------------------------------------------

function wireEmail(me) {
  const toggle = el("emailToggle");
  const form = el("emailForm");
  const next = el("newEmail");
  const password = el("currentPassword");
  const current = el("currentEmail");
  if (current) current.textContent = me.email || "";
  if (!toggle || !form) return;

  toggle.addEventListener("click", () => {
    const open = form.classList.toggle("hidden") === false;
    toggle.setAttribute("aria-expanded", String(open));
    if (open) next.focus();
  });

  validateOnBlur(next, check.email);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearAll(form);
    const emailProblem = check.email(next.value);
    const passwordProblem = check.password(password.value);
    if (emailProblem) fieldError(next, emailProblem);
    if (passwordProblem) fieldError(password, passwordProblem);
    if (emailProblem || passwordProblem) {
      say("Check the fields marked above.", "error");
      (emailProblem ? next : password).focus();
      return;
    }

    busy(form, true, "Sending…");
    try {
      // Re-authenticate first, then force a token refresh: the server requires a recent
      // auth_time, and only a real sign-in moves it. This is why the password is asked for -
      // not to check it here, but so that Firebase will stamp the session as recent.
      const credential = EmailAuthProvider.credential(auth.currentUser.email, password.value);
      await reauthenticateWithCredential(auth.currentUser, credential);
      await auth.currentUser.getIdToken(true);

      await api("/me/email", { method: "POST", body: JSON.stringify({ email: next.value.trim() }) });

      // Deliberately the same words whether or not that address is already in use. The server
      // answers identically on purpose, and a client that said "already taken" would hand back
      // exactly the fact the server is withholding.
      say("If that address can be used, a confirmation link is on its way to it. " +
          "Nothing changes until you open it.", "ok");
      form.reset();
      form.classList.add("hidden");
      toggle.setAttribute("aria-expanded", "false");
    } catch (err) {
      const wrongPassword = err && typeof err.code === "string" && err.code.startsWith("auth/");
      say(wrongPassword ? "That password is not right."
        : err.code === "same_email" ? "That is already your address."
        : err.code === "invalid_email" ? "That is not a valid email address."
        : err.code === "reauth_required" ? "Please try again — your sign-in needs refreshing."
        : "That could not be sent.", "error");
      if (wrongPassword) { fieldError(password, "That password is not right."); password.focus(); }
    }
    busy(form, false);
  });
}

// --- theme -------------------------------------------------------------------

function wireTheme() {
  const btn = el("themeBtn");
  const value = el("themeValue");
  if (!btn || !value) return;

  const paint = () => {
    const dark = document.documentElement.classList.contains("dark");
    value.textContent = dark ? "Dark" : "Light";
    btn.setAttribute("aria-label", dark ? "Switch to the light theme" : "Switch to the dark theme");
  };
  paint();

  btn.addEventListener("click", () => {
    // Delegated to the header's own toggle rather than reimplemented, so there stays exactly one
    // writer of `theme` and `theme-at`. A second writer here would silently break the handoff
    // that carries the theme across to tzortzoglou.eu.
    const toggle = document.getElementById("theme-toggle") || document.getElementById("theme-toggle-mobile");
    if (toggle) toggle.click();
    paint();
  });
}

// --- home location -----------------------------------------------------------

function placeLabel(p) {
  return [p.name, p.admin1, p.countryCode].filter(Boolean).join(", ");
}

function wireLocation(me) {
  const search = el("placeSearch");
  const list = el("placeResults");
  const currentLine = el("homeCurrent");
  const clear = el("clearHome");
  if (!search || !list) return;

  let home = me.homeLocation || null;

  function paintHome() {
    currentLine.textContent = home
      ? `Currently showing ${home.name}.`
      : "No home location saved — the weather shows the default.";
    clear.classList.toggle("hidden", !home);
  }
  paintHome();

  async function save(location) {
    try {
      const res = await api("/me/profile", {
        method: "POST", body: JSON.stringify({ homeLocation: location }),
      });
      home = res.homeLocation;
      paintHome();
      say(home ? `The weather will show ${home.name}.` : "The weather will show the default location.", "ok");
      list.textContent = "";
      search.value = "";
      search.setAttribute("aria-expanded", "false");
    } catch (err) {
      say("That location could not be saved.", "error");
    }
  }

  function render(results) {
    list.textContent = "";
    search.setAttribute("aria-expanded", String(results.length > 0));
    // createElement and textContent: these names come from a third party and have no business
    // being parsed as markup.
    results.forEach((p) => {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", "false");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "w-full text-left rounded-lg border border-brand-muted/15 px-3 py-2 text-sm " +
        "text-brand-text hover:border-brand-accent hover:bg-brand-bg transition-colors duration-150";
      btn.textContent = placeLabel(p);
      btn.addEventListener("click", () => save({
        name: placeLabel(p), lat: p.lat, lon: p.lon, timezone: p.timezone,
      }));
      li.appendChild(btn);
      list.appendChild(li);
    });
  }

  let timer = null;
  let sequence = 0;
  search.addEventListener("input", () => {
    clearTimeout(timer);
    const q = search.value.trim();
    if (!q) { render([]); return; }
    // Debounced, because this is a proxied request per keystroke otherwise. 250ms is about the
    // gap between characters when someone is typing rather than thinking.
    timer = setTimeout(async () => {
      const mine = ++sequence;
      try {
        const { results } = await api("/geocode?q=" + encodeURIComponent(q));
        // A slower earlier request must not overwrite a faster later one.
        if (mine !== sequence) return;
        render(results);
        if (!results.length) say(`Nothing found for “${q}”.`, null);
      } catch (err) {
        if (mine === sequence) say("The location search is unavailable.", "error");
      }
    }, 250);
  });

  clear.addEventListener("click", () => save(null));
}

profile.then((me) => {
  wireName(me);
  wireEmail(me);
  wireTheme();
  wireLocation(me);
});
