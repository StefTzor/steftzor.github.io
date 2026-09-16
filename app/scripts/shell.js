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

const RANK = { user: 1, superuser: 2, admin: 3 };
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
    if (!user) { location.replace("/login/"); return; }
    let me;
    try {
      me = await api("/me");
    } catch (err) {
      if (err.status === 403) { showPending(); return; }
      console.error("shell: /me failed", err.message);
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

function paint(me) {
  const who = el("whoami");
  if (who) who.textContent = me.email + (me.role === "user" ? "" : ` · ${me.role}`);

  const rank = RANK[me.role] || 1;
  document.querySelectorAll("[data-min-role]").forEach((item) => {
    if (rank >= (RANK[item.dataset.minRole] || 99)) item.classList.remove("hidden");
  });

  const key = location.pathname === "/" ? "home" : location.pathname.replace(/\//g, "");
  const here = document.querySelector(`[data-nav="${key}"]`);
  if (here) {
    here.classList.add("bg-brand-bg", "font-semibold");
    here.setAttribute("aria-current", "page");
  }

  const header = el("appHeader");
  if (header) header.classList.remove("hidden");
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
    await signOut(auth).catch(() => {});
    location.replace("/login/");
  }));
