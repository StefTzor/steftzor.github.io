import { auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.3.1/firebase-auth.js";

/**
 * The chrome every signed-in page shares: who you are, what you may reach, and signing out.
 *
 * One module rather than a copy per page. Each page imports `profile` and awaits it; module
 * caching means /me is fetched once however many importers there are, and the nav cannot end up
 * saying different things on different pages because there is only one piece of code saying it.
 *
 * The role decides only what is drawn. Every byte that matters is refused by the API, which
 * re-reads approval and role from Firestore on every request - so hiding a link is a courtesy,
 * never a boundary. Anyone can unhide it and the endpoint will still say no.
 */

export const API_BASE = (location.hostname === "localhost" || location.hostname === "127.0.0.1")
  ? "http://localhost:3000"
  : "https://api.tzortzoglou.eu";

// A Map, not an object literal - the same reason as the server's gate. An object inherits
// Object.prototype, so RANK['constructor'] is a function rather than undefined, and comparing a
// function to a number gives NaN. Here it would fail closed by hiding links rather than
// revealing them, and gate() has already normalised the role to one of three strings, so this
// is consistency rather than a fix - but the shape that caused a real escalation should not
// survive anywhere in the codebase.
const RANK = new Map([["User", 1], ["SuperUser", 2], ["Admin", 3]]);
const el = (id) => document.getElementById(id);

/** Every call carries a fresh ID token; getIdToken refreshes it when it is near expiry. */
export async function api(path, options = {}) {
  const user = auth.currentUser;
  if (!user) throw Object.assign(new Error("not signed in"), { status: 401 });
  const res = await fetch(API_BASE + path, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      Authorization: "Bearer " + (await user.getIdToken()),
    },
  });
  if (!res.ok) {
    const err = Object.assign(new Error("api " + res.status), { status: res.status });
    try { err.code = (await res.json()).code; } catch (e) { /* non-JSON error body */ }
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

/** Resolves with the signed-in profile, or never resolves because the page is leaving. */
export const profile = new Promise((resolve) => {
  onAuthStateChanged(auth, async (user) => {
    if (!user) { forget(); location.replace("/login/"); return; }
    let me;
    try {
      me = await api("/me");
    } catch (err) {
      if (err.status === 403) { forget(); showPending(); return; }
      console.error("shell: /me failed", err.message);
      forget();
      await signOut(auth).catch(() => {});
      location.replace("/login/");
      return;
    }
    paint(me);
    resolve(me);
  });
});

/**
 * An account that exists but is not approved. The one failure worth explaining rather than
 * bouncing, because it is the normal state for someone who has just registered - and telling
 * them to sign in again would send them round a loop that cannot end.
 */
function showPending() {
  document.body.textContent = "";
  const wrap = document.createElement("main");
  wrap.className = "container mx-auto px-4 py-16 max-w-md text-center";
  const h = document.createElement("h1");
  h.className = "text-2xl font-bold mb-3 text-brand-text";
  h.textContent = "Waiting for approval";
  const p = document.createElement("p");
  p.className = "text-brand-muted";
  p.textContent = "Your account has been created. You will be able to use the app once it is approved.";
  wrap.append(h, p);
  document.body.appendChild(wrap);
}

/**
 * Remembers who you were, so the next page can draw the rail before it has asked anyone.
 *
 * A hint for rendering only, exactly like the `auth-ui` flag on the public site. Anyone can
 * write "Admin" into their own localStorage and the API will still refuse them, because it
 * re-reads role and approval from Firestore on every single request.
 */
function remember(me) {
  try {
    // The role and nothing else. It used to carry the email too, so that the rail could be drawn
    // complete before /me answered - which meant a browser whose session had since lapsed painted
    // the last person's address on screen for a moment to whoever opened the app next. A role is
    // not a name; an address is. The address now waits for the server to confirm there is a
    // session to attach it to.
    localStorage.setItem("app-profile", JSON.stringify({ role: me.role }));
  } catch (e) { /* private mode: the next page just paints a moment later */ }
}

function forget() {
  try { localStorage.removeItem("app-profile"); } catch (e) { /* nothing to do */ }
}

/**
 * The location preference key, read by the weather view and written by the profile page.
 * Exported so there is one definition rather than a copy per file.
 */
export const GEO_KEY = "weather-geo";

function paint(me) {
  remember(me);
  document.documentElement.classList.remove("app-unknown");
  const name = el("whoamiName");
  if (name) name.textContent = me.name || "";
  const who = el("whoami");
  if (who) who.textContent = me.email || "";
  // Its own line rather than a suffix on the address: as a suffix it was the first thing the
  // truncation ate, which is the opposite of what a role badge is for.
  const badge = el("whoamiRole");
  if (badge) {
    badge.textContent = me.role || "";
    badge.classList.toggle("hidden", !me.role);
  }

  const rank = RANK.get(me.role) ?? 1;
  document.querySelectorAll("[data-min-role]").forEach((item) => {
    // An unknown requirement hides the link: an item asking for a level this file does not
    // define is a mistake, and the safe reading of a mistake is the strict one.
    // Toggled rather than only revealed, because the early script in app-shell.njk may already
    // have drawn this from a stale cached role - a demotion has to take the link away again.
    const allowed = rank >= (RANK.get(item.dataset.minRole) ?? Infinity);
    item.classList.toggle("hidden", !allowed);
  });

  // "/" -> home, "/admin/" -> admin, "/admin/messages/" -> admin-messages. The nesting has to
  // survive, or every page under /admin/ collapses onto the same key and the rail marks Accounts
  // as current while you are reading Messages.
  const key = location.pathname.replace(/^\/+|\/+$/g, "").replace(/\//g, "-") || "home";
  // All of them, not the first. A section link exists twice on an admin page - in the rail and in
  // the row shown below lg - and querySelector marked whichever came first in the document, which
  // on a phone was always the hidden one.
  //
  // Compared rather than interpolated into a selector: the key comes from location.pathname, and
  // a stray quote in a URL should not be able to reach querySelector as syntax.
  document.querySelectorAll("[data-nav]").forEach((link) => {
    if (link.dataset.nav !== key) return;
    link.classList.add("bg-brand-bg", "font-semibold");
    link.setAttribute("aria-current", "page");
  });

  const main = el("main-content");
  if (main) main.setAttribute("aria-busy", "false");
}

document.querySelectorAll("[data-logout]").forEach((btn) =>
  btn.addEventListener("click", async () => {
    try {
      const token = await auth.currentUser?.getIdToken();
      if (token) {
        // Revoke server-side so the session is dead everywhere, not just in this browser.
        await fetch(API_BASE + "/session/revoke", {
          method: "POST", headers: { Authorization: "Bearer " + token }, keepalive: true,
        });
      }
    } catch (err) {
      // Must never trap someone in a signed-in state: log it and sign out anyway.
      console.warn("sign-out: revoke failed", err.message);
    }
    forget();
    await signOut(auth).catch(() => {});
    // Not /login/: arriving back at the sign-in form is indistinguishable from a failed attempt.
    // /signed-out/ says the thing happened, and offers signing in again or leaving.
    location.replace("/signed-out/");
  }));
