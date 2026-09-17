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

// Defined in api-base.js and re-exported here, because this module cannot be imported by a page
// where nobody is signed in - see the note in that file.
export { API_BASE } from "./api-base.js";
import { API_BASE } from "./api-base.js";
import { forgetRows } from "./rows.js";
// The page-view beacon. Imported here rather than loaded as its own script tag, because the one
// thing it must not do is fire for somebody who is not signed in - and this module is the only
// place that knows when that is settled. Importing it sends nothing; count() does.
import { count } from "./hit.js";

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
    // The body as well as the code. Some failures are not empty: an erasure that deleted the
    // contact rows and then could not finish answers 500 with the receipt for the half that DID
    // happen, and a caller that only had the code would have to report that as nothing happening.
    try {
      const body = await res.json();
      err.code = body.code;
      err.body = body;
    } catch (e) { /* non-JSON error body */ }
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
      // 401 is the only answer that means this session is genuinely no longer valid - the token
      // was rejected - and the only one worth signing out for.
      //
      // Everything else is the server having a moment: a 429, a 502, a dropped connection. Those
      // used to end the session too, which meant a rate limit or a thirty-second outage logged
      // you out and bounced you to the form, and signing in again immediately failed the same
      // way. Nothing is protected by that: the API re-reads role and approval on every single
      // request, so a browser holding a session it cannot currently use gains nothing at all.
      if (err.status === 401) {
        console.error("shell: the session was rejected");
        forget();
        await signOut(auth).catch(() => {});
        location.replace("/login/");
        return;
      }
      console.error("shell: /me failed", err.status, err.message);
      showUnreachable(err.status);
      return;
    }
    paint(me);
    // Here and nowhere earlier. /me answering means the API re-read this session against
    // Firestore and accepted it, so the claim /privacy/ §3.2 rests on - that everyone counted in
    // the app is an approved account holder - is true at exactly this line and not before it.
    // Every other path out of this callback is a stranger, an unapproved account or a server
    // that did not answer, and none of them counts.
    count();
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
 * The server could not be reached, or refused to answer.
 *
 * Deliberately not a sign-out. The session is still good; the API is the thing that is not
 * answering, and the honest thing is to say so and offer to try again rather than to take the
 * account away from somebody because a proxy hiccuped.
 */
function showUnreachable(status) {
  const main = el("main-content");
  if (main) main.setAttribute("aria-busy", "false");
  document.documentElement.classList.remove("app-unknown");
  document.body.textContent = "";
  const wrap = document.createElement("main");
  wrap.className = "container mx-auto px-4 py-16 max-w-md text-center";
  const h = document.createElement("h1");
  h.className = "text-2xl font-bold mb-3 text-brand-text";
  h.textContent = status === 429 ? "Too many requests" : "Cannot reach the server";
  const p = document.createElement("p");
  p.className = "text-brand-muted";
  p.textContent = status === 429
    ? "The API is rate-limiting this address. You are still signed in — wait a minute and try again."
    : "You are still signed in. The API did not answer, which is usually brief.";
  const again = document.createElement("button");
  again.type = "button";
  again.className = "btn-primary mt-6";
  again.textContent = "Try again";
  again.addEventListener("click", () => location.reload());
  wrap.append(h, p, again);
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
  forgetRows();
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
  if (name) {
    // An account with no name left this line empty, so the block measured 53px filled against
    // the skeleton's 73 and the rail shrank by the difference - the same jump as before, just
    // in the other direction. The slot is always occupied now, and when there is nothing to put
    // in it the prompt is useful: the whole block is already a link to /profile/, which is
    // where you would go to fix it.
    name.textContent = me.name || "Add your name";
    name.classList.toggle("text-brand-muted", !me.name);
    name.classList.toggle("font-normal", !me.name);
    name.classList.toggle("font-semibold", !!me.name);
  }
  const who = el("whoami");
  if (who) who.textContent = me.email || "";
  // Its own line rather than a suffix on the address: as a suffix it was the first thing the
  // truncation ate, which is the opposite of what a role badge is for.
  const badge = el("whoamiRole");
  if (badge) {
    badge.textContent = me.role || "";
    badge.classList.toggle("hidden", !me.role);
  }
  // The skeleton goes and the real block appears, in the space the skeleton was already
  // holding. Set after the three fields above rather than before, or the block is revealed
  // empty for a frame and the flash this replaced comes back a hundredth of the length.
  document.querySelectorAll('[data-profile="loading"]')
    .forEach((box) => box.setAttribute("data-profile", "ready"));

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
