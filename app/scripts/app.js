import { auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.3.1/firebase-auth.js";

/**
 * The signed-in app shell: who you are, what you may see, and the home view.
 *
 * The role decides only what is *drawn*. Every byte that matters is refused by the API, which
 * re-reads approval and role from Firestore on every request - so hiding the admin link is a
 * courtesy to the viewer, never a security boundary. Anyone can unhide it; the endpoint behind
 * it will still say no.
 */

const API_BASE = (location.hostname === "localhost" || location.hostname === "127.0.0.1")
  ? "http://localhost:3000"
  : "https://api.tzortzoglou.eu";

const RANK = { user: 1, superuser: 2, admin: 3 };
const el = (id) => document.getElementById(id);

/** Every call carries a fresh ID token; getIdToken refreshes it when it is close to expiry. */
async function api(path) {
  const user = auth.currentUser;
  if (!user) throw new Error("not signed in");
  const res = await fetch(API_BASE + path, {
    headers: { Authorization: "Bearer " + (await user.getIdToken()) },
  });
  if (!res.ok) throw Object.assign(new Error("api " + res.status), { status: res.status });
  return res.json();
}

/** "stefanos.tzortzoglou@..." with no name set is still better greeted as Stefanos. */
function firstName(me) {
  if (me.name) return me.name.split(" ")[0];
  const local = (me.email || "").split("@")[0].split(/[.+_-]/)[0];
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : "there";
}

function greet(me) {
  const hour = new Date().getHours();
  const part = hour < 5 ? "Still up" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  el("greeting").textContent = `${part}, ${firstName(me)}`;
  el("whoami").textContent = me.email + (me.role === "user" ? "" : ` · ${me.role}`);
}

function revealNav(role) {
  const rank = RANK[role] || 1;
  document.querySelectorAll("[data-min-role]").forEach((item) => {
    if (rank >= (RANK[item.dataset.minRole] || 99)) item.classList.remove("hidden");
  });
  const here = document.querySelector(`[data-nav="${location.pathname === "/" ? "home" : location.pathname.replace(/\//g, "")}"]`);
  if (here) {
    here.classList.add("border-brand-accent", "font-semibold");
    here.setAttribute("aria-current", "page");
  }
  el("appHeader").classList.remove("hidden");
}

// WMO weather codes, grouped rather than enumerated: the difference between "slight" and
// "moderate" drizzle is not worth thirty lines on a personal dashboard.
function describe(code) {
  if (code === 0) return "Clear";
  if (code <= 2) return "Mostly clear";
  if (code === 3) return "Overcast";
  if (code <= 49) return "Fog";
  if (code <= 59) return "Drizzle";
  if (code <= 69) return "Rain";
  if (code <= 79) return "Snow";
  if (code <= 84) return "Showers";
  if (code <= 94) return "Snow showers";
  return "Thunderstorm";
}

const round = (n) => (typeof n === "number" ? Math.round(n) : null);
const dayName = (iso, i) =>
  i === 0 ? "Today" : new Date(iso + "T12:00:00").toLocaleDateString(undefined, { weekday: "short" });

function renderWeather(data) {
  el("weatherPlace").textContent = data.place || "";
  const now = data.current || {};
  const days = (data.daily || []).slice(0, 3);

  // textContent everywhere: this is upstream data, and none of it is trusted enough for HTML.
  const box = el("weather");
  box.textContent = "";

  const headline = document.createElement("p");
  headline.className = "text-3xl font-bold text-brand-text";
  headline.textContent = round(now.temperature) !== null ? `${round(now.temperature)}°C` : "—";
  box.appendChild(headline);

  const detail = document.createElement("p");
  detail.className = "text-sm text-brand-muted mt-1";
  const bits = [describe(now.code)];
  if (round(now.feelsLike) !== null) bits.push(`feels like ${round(now.feelsLike)}°`);
  if (round(now.windSpeed) !== null) bits.push(`wind ${round(now.windSpeed)} km/h`);
  detail.textContent = bits.join(" · ");
  box.appendChild(detail);

  if (days.length) {
    const list = document.createElement("ul");
    list.className = "mt-6 grid grid-cols-3 gap-3";
    days.forEach((d, i) => {
      const item = document.createElement("li");
      item.className = "rounded border border-brand-muted/15 p-3 text-center";
      const name = document.createElement("p");
      name.className = "text-xs font-semibold text-brand-text";
      name.textContent = dayName(d.date, i);
      const temps = document.createElement("p");
      temps.className = "text-sm text-brand-muted mt-1";
      temps.textContent = `${round(d.max) ?? "—"}° / ${round(d.min) ?? "—"}°`;
      const what = document.createElement("p");
      what.className = "text-xs text-brand-muted mt-1";
      what.textContent = describe(d.code);
      item.append(name, temps, what);
      list.appendChild(item);
    });
    box.appendChild(list);
  }
}

function weatherUnavailable() {
  const box = el("weather");
  box.textContent = "";
  const p = document.createElement("p");
  p.className = "text-sm text-brand-muted";
  p.textContent = "The forecast is unavailable right now.";
  box.appendChild(p);
}

async function start(user) {
  let me;
  try {
    me = await api("/me");
  } catch (err) {
    // 403 means the account exists but is not approved - the one failure worth explaining,
    // because it is the normal state for someone who has just registered.
    if (err.status === 403) {
      document.body.textContent = "";
      const p = document.createElement("p");
      p.className = "container mx-auto px-4 py-16 max-w-md text-brand-muted";
      p.textContent = "This account is waiting to be approved. You will be able to use the app once it is.";
      document.body.appendChild(p);
      return;
    }
    console.error("app: /me failed", err.message);
    await signOut(auth);
    location.href = "/login/";
    return;
  }

  greet(me);
  revealNav(me.role);
  document.getElementById("main-content").setAttribute("aria-busy", "false");

  try {
    renderWeather(await api("/weather"));
  } catch (err) {
    console.error("app: weather failed", err.message);
    weatherUnavailable();
  }
}

onAuthStateChanged(auth, (user) => {
  if (!user) { location.href = "/login/"; return; }
  start(user);
});

document.querySelectorAll("[data-logout]").forEach((btn) =>
  btn.addEventListener("click", async () => {
    try {
      const token = await auth.currentUser?.getIdToken();
      if (token) {
        await fetch(API_BASE + "/session/revoke", {
          method: "POST", headers: { Authorization: "Bearer " + token }, keepalive: true,
        });
      }
    } catch (err) {
      console.warn("sign-out: revoke failed", err.message);
    }
    await signOut(auth).catch(() => {});
    location.href = "/login/";
  }));
