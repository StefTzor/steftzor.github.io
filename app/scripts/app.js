import { api, profile } from "./shell.js";

/**
 * The home view. The shell owns identity, navigation and signing out; this owns the greeting
 * and the forecast, and nothing else.
 */

const el = (id) => document.getElementById(id);

/** A name if we have one, otherwise the readable part of the address rather than the whole thing. */
function firstName(me) {
  if (me.name) return me.name.split(" ")[0];
  const local = (me.email || "").split("@")[0].split(/[.+_-]/)[0];
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : "there";
}

function greet(me) {
  const hour = new Date().getHours();
  const part = hour < 5 ? "Still up" : hour < 12 ? "Good morning"
             : hour < 18 ? "Good afternoon" : "Good evening";
  el("greeting").textContent = `${part}, ${firstName(me)}`;
}

// WMO codes, grouped rather than enumerated: the difference between slight and moderate
// drizzle is not worth thirty lines on a personal dashboard. Each group names a word and a
// symbol in _includes/chrome/weather-icons.njk.
function describe(code, isDay = true) {
  if (code === 0) return { text: "Clear", icon: isDay ? "clear" : "night" };
  if (code <= 2) return { text: "Mostly clear", icon: isDay ? "partly" : "night" };
  if (code === 3) return { text: "Overcast", icon: "cloud" };
  if (code <= 49) return { text: "Fog", icon: "fog" };
  if (code <= 59) return { text: "Drizzle", icon: "drizzle" };
  if (code <= 69) return { text: "Rain", icon: "rain" };
  if (code <= 79) return { text: "Snow", icon: "snow" };
  if (code <= 84) return { text: "Showers", icon: "rain" };
  if (code <= 94) return { text: "Snow showers", icon: "snow" };
  return { text: "Thunderstorm", icon: "thunder" };
}

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK = "http://www.w3.org/1999/xlink";

/**
 * A <use> pointing at one of the sprite's symbols. Decorative: every icon here sits beside the
 * same information in words, so announcing it twice would only be noise.
 */
function icon(name, cls) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", cls);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const use = document.createElementNS(SVG_NS, "use");
  use.setAttribute("href", `#wx-${name}`);
  // Safari below 16 only honours the namespaced form; harmless everywhere else.
  use.setAttributeNS(XLINK, "xlink:href", `#wx-${name}`);
  svg.appendChild(use);
  return svg;
}

const round = (n) => (typeof n === "number" ? Math.round(n) : null);
const deg = (n) => (round(n) === null ? "—" : `${round(n)}°`);

/** The eight points are plenty; nobody reads "west-south-west" off a dashboard. */
function bearing(d) {
  if (typeof d !== "number") return "";
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(d / 45) % 8];
}

/** Open-Meteo returns local wall-clock without a zone, so it must not be parsed as UTC. */
const clockOf = (iso) => (typeof iso === "string" && iso.includes("T") ? iso.slice(11, 16) : "");

const dayName = (iso, i) =>
  i === 0 ? "Today" : new Date(iso + "T12:00:00").toLocaleDateString(undefined, { weekday: "short" });

function node(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  // textContent, never innerHTML: this is upstream data and has no business being parsed as HTML.
  if (text !== undefined) n.textContent = text;
  return n;
}

/** label · value pairs, wrapping rather than scrolling on a narrow screen. */
function stats(pairs) {
  const dl = node("dl", "mt-5 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3");
  pairs.forEach(([label, value]) => {
    const wrap = node("div", "");
    wrap.append(
      node("dt", "text-xs uppercase tracking-wide text-brand-muted", label),
      node("dd", "text-sm font-semibold text-brand-text mt-0.5 tabular-nums", value),
    );
    dl.appendChild(wrap);
  });
  return dl;
}

function hourStrip(hours) {
  const wrap = node("div", "mt-6");
  wrap.appendChild(node("h3", "text-xs uppercase tracking-wide text-brand-muted mb-2", "Next 12 hours"));
  // The one place a horizontal scroll is right: a time series is ordered, and cutting it off
  // loses the later hours entirely. Snap points so it lands on an hour rather than between two.
  const row = node("ul", "flex gap-2 overflow-x-auto pb-1 snap-x");
  hours.forEach((h) => {
    const li = node("li", "snap-start shrink-0 w-16 rounded-lg border border-brand-muted/15 p-2 text-center");
    li.appendChild(node("p", "text-xs text-brand-muted tabular-nums", clockOf(h.time)));
    const g = icon(describe(h.code).icon, "mx-auto my-1 h-5 w-5 text-brand-accent");
    li.appendChild(g);
    li.appendChild(node("p", "text-sm font-semibold text-brand-text tabular-nums", deg(h.temperature)));
    if (typeof h.precipitation === "number" && h.precipitation >= 20) {
      li.appendChild(node("p", "text-[11px] text-brand-accent tabular-nums", `${round(h.precipitation)}%`));
    }
    row.appendChild(li);
  });
  wrap.appendChild(row);
  return wrap;
}

function dayGrid(days) {
  const wrap = node("div", "mt-6");
  wrap.appendChild(node("h3", "text-xs uppercase tracking-wide text-brand-muted mb-2", "Next days"));
  const list = node("ul", "grid grid-cols-3 sm:grid-cols-5 gap-2");
  days.forEach((d, i) => {
    const item = node("li", "rounded-lg border border-brand-muted/15 p-3 text-center");
    item.appendChild(node("p", "text-xs font-semibold text-brand-text", dayName(d.date, i)));
    item.appendChild(icon(describe(d.code).icon, "mx-auto my-1.5 h-6 w-6 text-brand-accent"));
    item.appendChild(node("p", "text-sm text-brand-text tabular-nums", `${deg(d.max)} / ${deg(d.min)}`));
    if (typeof d.precipitation === "number" && d.precipitation >= 20) {
      item.appendChild(node("p", "text-[11px] text-brand-accent tabular-nums", `${round(d.precipitation)}%`));
    }
    list.appendChild(item);
  });
  wrap.appendChild(list);
  return wrap;
}

function renderWeather(data) {
  const now = data.current || {};
  const today = (data.daily || [])[0] || {};
  const what = describe(now.code, now.isDay);

  el("weatherPlace").textContent = data.precise
    ? "Your location" + (data.timezone ? ` · ${data.timezone.replace(/_/g, " ")}` : "")
    : (data.place || "");

  const clock = el("weatherClock");
  clock.textContent = "";
  if (data.observedAt) {
    clock.append(
      node("span", "block text-lg font-semibold text-brand-text tabular-nums", clockOf(data.observedAt)),
      node("span", "block text-xs", "local time"),
    );
  }

  const box = el("weather");
  box.textContent = "";

  const head = node("div", "flex items-center gap-4");
  head.appendChild(icon(what.icon, "h-14 w-14 shrink-0 text-brand-accent"));
  const headText = node("div", "");
  headText.appendChild(node("p", "text-4xl font-bold text-brand-text leading-none tabular-nums", deg(now.temperature)));
  headText.appendChild(node("p", "text-sm text-brand-muted mt-1", what.text));
  head.appendChild(headText);
  box.appendChild(head);

  box.appendChild(stats([
    ["Feels like", deg(now.feelsLike)],
    ["Humidity", round(now.humidity) === null ? "—" : `${round(now.humidity)}%`],
    ["Wind", round(now.windSpeed) === null ? "—" : `${round(now.windSpeed)} km/h ${bearing(now.windDirection)}`.trim()],
    ["UV index", round(today.uv) === null ? "—" : String(round(today.uv))],
  ]));

  if (data.hourly && data.hourly.length) box.appendChild(hourStrip(data.hourly));
  if (data.daily && data.daily.length) box.appendChild(dayGrid(data.daily.slice(0, 5)));

  const sun = [];
  if (today.sunrise) sun.push(`Sunrise ${clockOf(today.sunrise)}`);
  if (today.sunset) sun.push(`Sunset ${clockOf(today.sunset)}`);
  if (sun.length) {
    box.appendChild(node("p", "mt-5 text-xs text-brand-muted tabular-nums", sun.join(" · ")));
  }
}

function unavailable() {
  const box = el("weather");
  box.textContent = "";
  box.appendChild(node("p", "text-sm text-brand-muted", "The forecast is unavailable right now."));
}

/**
 * Where to ask about. Remembered so that granting the permission once is enough - the browser
 * keeps the grant, and re-asking on every page load would be the nagging this avoids.
 * The coordinates themselves are never stored, only the fact that you chose to share them.
 */
const GEO_KEY = "weather-geo";
const wantsGeo = () => { try { return localStorage.getItem(GEO_KEY) === "1"; } catch (e) { return false; } };
const setGeo = (on) => { try { on ? localStorage.setItem(GEO_KEY, "1") : localStorage.removeItem(GEO_KEY); } catch (e) { /* private mode */ } };

function position() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      // A kilometre of accuracy is all the API keeps anyway, so there is no reason to spin up
      // GPS, drain the battery, and wait for it.
      enableHighAccuracy: false, timeout: 10000, maximumAge: 10 * 60 * 1000,
    });
  });
}

async function load(coords) {
  const q = coords ? `?lat=${encodeURIComponent(coords.lat)}&lon=${encodeURIComponent(coords.lon)}` : "";
  renderWeather(await api("/weather" + q));
}

/**
 * One button, two states, one handler.
 *
 * An earlier version added a second listener for the way back and left the first attached, so
 * returning to the fixed location also re-ran the "use my location" branch. One handler that
 * reads the current mode cannot drift like that.
 */
function setupGeo(usingMine) {
  const panel = el("geo");
  const btn = el("geoBtn");
  const note = el("geoNote");
  if (!panel || !btn || !navigator.geolocation) return;
  panel.classList.remove("hidden");

  const FIXED_NOTE = "Showing the forecast for a fixed location. Use your device's location for one " +
    "nearer to you \u2014 it is sent rounded to about a kilometre, and never stored.";
  const MINE_NOTE = "Showing the forecast for your device's location, rounded to about a kilometre.";

  let mine = !!usingMine;

  function show() {
    btn.textContent = mine ? "Use the fixed location" : "Use my location";
    note.textContent = mine ? MINE_NOTE : FIXED_NOTE;
  }
  show();

  btn.addEventListener("click", async () => {
    if (mine) {
      setGeo(false);
      mine = false;
      show();
      btn.disabled = true;
      try { await load(null); } catch (e) { unavailable(); }
      btn.disabled = false;
      return;
    }
    btn.disabled = true;
    btn.textContent = "Locating\u2026";
    try {
      const pos = await position();
      setGeo(true);
      await load({ lat: pos.coords.latitude, lon: pos.coords.longitude });
      mine = true;
      show();
    } catch (err) {
      setGeo(false);
      show();
      // PERMISSION_DENIED is a decision, not a failure, and must not be argued with.
      note.textContent = err && err.code === 1
        ? "No problem \u2014 staying with the fixed location. You can allow location access in your browser's site settings if you change your mind."
        : "Your location could not be determined, so the fixed location is still being shown.";
    }
    btn.disabled = false;
  });
}

profile.then(async (me) => {
  greet(me);

  let coords = null;
  if (wantsGeo() && navigator.geolocation) {
    // Already granted on a previous visit: use it without asking again. A refusal or a slow fix
    // must not hold up the forecast, so it falls through to the fixed location.
    try {
      const pos = await position();
      coords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
    } catch (e) { setGeo(false); }
  }

  setupGeo(!!coords);
  try {
    await load(coords);
  } catch (err) {
    // A missing forecast must not take the page with it.
    console.error("app: weather failed", err.message);
    unavailable();
  }
});
