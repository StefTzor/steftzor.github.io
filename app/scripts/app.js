import { api, profile, GEO_KEY } from "./shell.js";
import { pendingAccounts, unreadMessages } from "./queues.js";

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

/**
 * The sentence under the greeting.
 *
 * Composed from whatever is known at the moment it runs, and rebuilt whenever another piece
 * arrives - the weather and the two queue counts land at different times, and waiting for the
 * slowest would leave the line empty for as long as the slowest takes.
 *
 * Every clause is dropped rather than guessed. No weather yet means no weather clause, not
 * "loading"; a queue that failed is simply not mentioned, because the alternative is a sentence
 * that says "0 people are waiting" when the truth is "I could not find out".
 */
let lastWeather = null;
let lastQueues = null;

function paintDigest() {
  const box = el("digest");
  if (!box) return;
  box.textContent = "";

  const parts = [];
  if (lastWeather && lastWeather.temp !== null && lastWeather.temp !== undefined) {
    // Temperature first, condition second: describe() returns nouns ("Drizzle", "Mostly clear",
    // "Thunderstorm"), and a noun after "It is" reads as a verb that is missing - "it is drizzle
    // and 16°C". Putting the number first makes the noun a complement, which every one of them
    // fits: "It is 16°C and drizzle", "and mostly clear", "and thunderstorm".
    const where = lastWeather.place ? ` in ${lastWeather.place}` : "";
    const what = lastWeather.text ? ` and ${lastWeather.text.toLowerCase()}` : "";
    parts.push({ text: `It is ${Math.round(lastWeather.temp)}°C${what}${where}.` });
  }
  if (lastQueues) {
    const { pending, unread } = lastQueues;
    if (pending > 0) {
      parts.push({
        text: pending === 1 ? "1 account is waiting for you" : `${pending} accounts are waiting for you`,
        href: "/admin/accounts/",
        tail: unread > 0 ? " and " : ".",
      });
    }
    if (unread > 0) {
      parts.push({
        text: unread === 1 ? "1 message is unread" : `${unread} messages are unread`,
        href: "/admin/messages/",
        tail: ".",
      });
    }
    if (pending === 0 && unread === 0) parts.push({ text: "Nothing is waiting for you." });
  }

  // createElement and textContent, like everywhere else that composes a line out of values
  // that came back from the network.
  parts.forEach((part, i) => {
    if (i > 0 && !parts[i - 1].tail) box.appendChild(document.createTextNode(" "));
    if (part.href) {
      const a = document.createElement("a");
      a.href = part.href;
      a.textContent = part.text;
      box.appendChild(a);
    } else {
      box.appendChild(document.createTextNode(part.text));
    }
    if (part.tail) box.appendChild(document.createTextNode(part.tail + (part.tail === "." ? " " : "")));
  });
}

/** A count on a tile, landing in a slot that was already the right size. */
function setTile(id, value) {
  const box = el(id);
  if (!box) return;
  box.textContent = String(value);
  box.removeAttribute("data-loading");
}

/**
 * The two queues, for the tiles and for the sentence.
 *
 * Only for an admin: the endpoints answer 403 to everyone else, and asking anyway would put a
 * guaranteed failure in the console of every ordinary sign-in. The tiles that show them are
 * hidden from those roles by the same data-min-role the rail uses.
 */
async function loadQueues(me) {
  if (me.role !== "Admin") return;
  const [pending, unread] = await Promise.allSettled([pendingAccounts(), unreadMessages()]);
  if (pending.status === "fulfilled") setTile("tilePending", pending.value);
  if (unread.status === "fulfilled") setTile("tileUnread", unread.value.count);
  // The sentence needs both to be sure of what it is saying. One of them failing means the
  // line keeps to the weather rather than half-reporting.
  if (pending.status === "fulfilled" && unread.status === "fulfilled") {
    lastQueues = { pending: pending.value, unread: unread.value.count };
    paintDigest();
  } else {
    console.error("home: queue counts failed",
      pending.status === "rejected" ? pending.reason?.status : unread.reason?.status);
  }
}

function greet(me) {
  const hour = new Date().getHours();
  const part = hour < 5 ? "Still up" : hour < 12 ? "Good morning"
             : hour < 18 ? "Good afternoon" : "Good evening";
  el("greeting").textContent = `${part}, ${firstName(me)}`;
}

/**
 * Which skyline stands behind the hero card.
 *
 * **Matched on position, not on the name**, for two reasons. The saved home is a display string
 * that profile.js flattens out of the geocoder's structured answer - "Uppsala, Uppsala län, SE" -
 * so matching text means guessing at "Gamla Uppsala", a stop name, or a localised spelling. And
 * the name is missing entirely in the case that matters most: somebody who granted the browser
 * their location has coordinates and no label at all, and the chip beside this says "Your
 * location".
 *
 * Thirty kilometres is far coarser than the coordinates themselves, which are already rounded to
 * two decimals on both sides of the wire, so this reads nothing more precise than the page holds.
 *
 * Anything unmatched gets `generic`, which is a skyline too. A card with no city on it would look
 * half-built rather than deliberately plain.
 */
const CITIES = [
  { id: "uppsala", lat: 59.86, lon: 17.64 },
  { id: "stockholm", lat: 59.33, lon: 18.07 },
];
const CITY_RADIUS_KM = 30;

/** Equirectangular, which is exact enough at 30 km and needs no trigonometry beyond one cosine. */
function nearestCity(coords) {
  if (!coords || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lon)) return null;
  let best = null;
  for (const city of CITIES) {
    const dy = (city.lat - coords.lat) * 111;
    const dx = (city.lon - coords.lon) * 111 * Math.cos((coords.lat * Math.PI) / 180);
    const km = Math.sqrt(dx * dx + dy * dy);
    if (km <= CITY_RADIUS_KM && (!best || km < best.km)) best = { id: city.id, km };
  }
  return best && best.id;
}

/** The fallback for the third state: no coordinates at all, and the API named its own place. */
function cityFromName(name) {
  if (typeof name !== "string") return null;
  const town = name.split(",")[0].trim().toLowerCase();
  if (!town) return null;
  const hit = CITIES.find((c) => town === c.id || town.startsWith(c.id) || town.endsWith(c.id));
  return hit && hit.id;
}

/**
 * Point the card's skyline at one of the symbols in chrome/city-skylines.njk.
 *
 * Sets `href` and nothing else: the script never builds SVG, so a place name cannot become
 * markup. `data-city` on the card is what fades the layer in, so the skyline appears once it is
 * the right one rather than a generic town correcting itself a moment later.
 */
function drawCity(data) {
  const art = el("cityArt");
  const hero = el("hero");
  if (!art || !hero) return;
  const id = nearestCity(at) || cityFromName(label) || cityFromName(data && data.place) || "generic";
  art.setAttribute("href", `#city-${id}`);
  art.setAttributeNS(XLINK, "xlink:href", `#city-${id}`);
  hero.dataset.city = id;
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

/**
 * The actual time where the forecast is, now.
 *
 * NOT data.current.time, which is what this used to show and label "local time". That is the
 * observation stamp and Open-Meteo publishes it on a 900-second interval, so it reads 11:00
 * when it is 11:14 - close enough to look like a clock and wrong enough to be irritating.
 */
function localNow(timeZone) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit", minute: "2-digit", hour12: false, timeZone: timeZone || undefined,
    }).format(new Date());
  } catch (e) {
    // An unknown zone name throws rather than falling back, and a wrong clock is worse than none.
    return "";
  }
}

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
    const li = node("li", "snap-start shrink-0 w-16 rounded-lg border border-brand-border p-2 text-center");
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
    const item = node("li", "rounded-lg border border-brand-border p-3 text-center");
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

// Ticking rather than painted once: the panel is open for as long as someone hovers it, and a
// clock that stopped when the page loaded is worse than no clock.
let tick = null;
function startClock(timeZone) {
  const paint = () => {
    const t = localNow(timeZone);
    const target = el("wxChipTime");
    if (target) target.textContent = t ? ` · ${t}` : "";
  };
  paint();
  if (tick) clearInterval(tick);
  // Twenty seconds: the display is minutes, so a full minute could show the wrong one for
  // most of its life, and a second would be a wasted wake-up sixty times a minute.
  tick = setInterval(paint, 20000);
}

/** The compact form: icon, temperature, condition, place, time. Everything else is in the panel. */
function renderChip(data) {
  const now = data.current || {};
  const what = describe(now.code, now.isDay);

  const use = document.querySelector("#wxChipIcon use");
  if (use) {
    use.setAttribute("href", `#wx-${what.icon}`);
    use.setAttributeNS(XLINK, "xlink:href", `#wx-${what.icon}`);
  }
  // The hero's sky, from the same describe() result that just chose the icon. One fact drawn
  // twice rather than two guesses that can disagree.
  const hero = el("hero");
  if (hero) {
    hero.dataset.wx = what.icon;
    // describe() only forks on day and night for a clear sky, because that is all the chip's
    // icon needs. The card needs more: without this a rainy midnight looks exactly like a rainy
    // afternoon. `isDay` is a boolean from the API, and an absent one reads as day.
    hero.dataset.night = now.isDay === false ? "true" : "false";
  }
  drawCity(data);
  lastWeather = { temp: now.temperature, text: what.text, place: label ? label.split(",")[0].trim()
    : (data.precise ? "your location" : (data.place || "")) };
  paintDigest();
  el("wxChipTemp").textContent = deg(now.temperature);
  el("wxChipWhat").textContent = what.text ? ` · ${what.text}` : "";
  // The chip gets the town, not the whole label. The region and country are saved because the
  // profile needs them to tell three Uppsalas apart; a chip two lines tall does not.
  el("wxChipPlace").textContent = label ? label.split(",")[0].trim()
    : (data.precise ? "Your location" : (data.place || ""));
  startClock(data.timezone);
}

/**
 * The European AQI, as a word.
 *
 * The bands are the ones the index itself defines, so "Fair" here means what it means in every
 * other European report of the same number. Said in words beside the figure, never as a colour
 * alone - a coloured dot tells somebody who cannot distinguish it precisely nothing.
 */
function aqiBand(aqi) {
  if (aqi <= 20) return "Good";
  if (aqi <= 40) return "Fair";
  if (aqi <= 60) return "Moderate";
  if (aqi <= 80) return "Poor";
  if (aqi <= 100) return "Very poor";
  return "Extremely poor";
}

/**
 * How much daylight is left, or when it comes back.
 *
 * Both halves matter in Uppsala, where in December the honest answer is usually the second one.
 * Returns null when the times are unreadable rather than guessing at a duration.
 */
function daylight(sunrise, sunset, now = Date.now()) {
  const up = Date.parse(sunrise);
  const down = Date.parse(sunset);
  if (!Number.isFinite(up) || !Number.isFinite(down)) return null;
  if (now < up) return `dark until ${clockOf(sunrise)}`;
  if (now >= down) return "dark now";
  const mins = Math.round((down - now) / 60000);
  const h = Math.floor(mins / 60);
  return (h ? `${h} h ${mins % 60} m` : `${mins} m`) + " of daylight left";
}

function renderWeather(data) {
  renderChip(data);

  const now = data.current || {};
  const today = (data.daily || [])[0] || {};

  // The panel has room for both: which place this is, and when it was measured. The chip shows
  // only the town, so this is where "which Uppsala?" gets an answer.
  el("weatherPlace").textContent = [
    label || (data.precise ? "Your location" : data.place),
    data.observedAt ? `observed ${clockOf(data.observedAt)}` : "",
    data.timezone ? data.timezone.replace(/_/g, " ") : "",
  ].filter(Boolean).join(" · ");

  const box = el("weather");
  box.textContent = "";

  const what = describe(now.code, now.isDay);
  const head = node("div", "flex items-center gap-4");
  head.appendChild(icon(what.icon, "h-14 w-14 shrink-0 text-brand-accent"));
  const headText = node("div", "");
  headText.appendChild(node("p", "text-4xl font-bold text-brand-text leading-none tabular-nums", deg(now.temperature)));
  headText.appendChild(node("p", "text-sm text-brand-muted mt-1", what.text));
  head.appendChild(headText);
  box.appendChild(head);

  const figures = [
    ["Feels like", deg(now.feelsLike)],
    ["Humidity", round(now.humidity) === null ? "—" : `${round(now.humidity)}%`],
    ["Wind", round(now.windSpeed) === null ? "—" : `${round(now.windSpeed)} km/h ${bearing(now.windDirection)}`.trim()],
    ["UV index", round(today.uv) === null ? "—" : String(round(today.uv))],
  ];
  // Only when there is one. Air quality is fetched alongside the forecast and allowed to fail on
  // its own, so an empty slot here is a normal state rather than an error to report.
  if (data.air && typeof data.air.aqi === "number") {
    figures.push(["Air quality", `${Math.round(data.air.aqi)} · ${aqiBand(data.air.aqi)}`]);
  }
  box.appendChild(stats(figures));

  if (data.hourly && data.hourly.length) box.appendChild(hourStrip(data.hourly));
  if (data.daily && data.daily.length) box.appendChild(dayGrid(data.daily.slice(0, 5)));

  const sun = [];
  if (today.sunrise) sun.push(`Sunrise ${clockOf(today.sunrise)}`);
  if (today.sunset) sun.push(`Sunset ${clockOf(today.sunset)}`);
  const left = daylight(today.sunrise, today.sunset);
  if (left) sun.push(left);
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

/**
 * Two decimals, about 1.1 km, rounded HERE.
 *
 * The API rounds too, and would be wrong to trust a client that promised it had. But the note
 * beside the button says your location "is sent rounded to about a kilometre", and until this
 * existed that sentence was not true - full GPS precision left the device and was rounded after
 * arrival. Rounding on both sides costs one line and makes the sentence accurate: the extra
 * digits are never transmitted at all.
 */
const coarse = (n) => Number(n.toFixed(2));

/**
 * Where the forecast is for, and what to call it.
 *
 * The server names only its own configured location - `place: precise ? '' : place` in
 * weather.js, which will not invent a name for a coordinate a caller sent. So when we asked for
 * somewhere, we are the ones who know what it is called, and we carry the label rather than
 * expecting one back.
 */
let label = null;

/**
 * And where it is for, kept for the same reason the label is: the response does not echo the
 * coordinates back, so if this page does not remember what it asked about, nothing does. The
 * skyline is matched on this.
 */
let at = null;

async function load(coords, name) {
  label = name || null;
  at = coords || null;
  const q = coords
    ? `?lat=${encodeURIComponent(coarse(coords.lat))}&lon=${encodeURIComponent(coarse(coords.lon))}`
    : "";
  renderWeather(await api("/weather" + q));
}

/**
 * One button, two states, one handler.
 *
 * An earlier version added a second listener for the way back and left the first attached, so
 * returning to the fixed location also re-ran the "use my location" branch. One handler that
 * reads the current mode cannot drift like that.
 */
function setupGeo(usingMine, home) {
  const panel = el("geo");
  const btn = el("geoBtn");
  const note = el("geoNote");
  if (!panel || !btn || !navigator.geolocation) return;
  panel.classList.remove("hidden");

  const back = home ? home.name : "the default location";
  const FIXED_NOTE = `Showing ${back}. Use your device's location for this visit \u2014 it is ` +
    "rounded to about a kilometre before it is sent, never stored, and your saved home is not changed.";
  const MINE_NOTE = "Showing the forecast for your device's location, rounded to about a kilometre.";

  let mine = !!usingMine;

  function show() {
    btn.textContent = mine ? `Show ${back} again` : "Use my location";
    note.textContent = mine ? MINE_NOTE : FIXED_NOTE;
  }
  show();

  btn.addEventListener("click", async () => {
    if (mine) {
      setGeo(false);
      mine = false;
      show();
      btn.disabled = true;
      try {
        await load(home ? { lat: home.lat, lon: home.lon } : null, home ? home.name : null);
      } catch (e) { unavailable(); }
      btn.disabled = false;
      return;
    }
    btn.disabled = true;
    btn.textContent = "Locating\u2026";
    try {
      const pos = await position();
      setGeo(true);
      await load({ lat: pos.coords.latitude, lon: pos.coords.longitude }, null);
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

/**
 * Opening the panel: hover, click, tap, keyboard.
 *
 * Hover is what was asked for and it is here, but only as one of the ways in. The skill's own
 * guidance rates relying on hover alone as a High-severity mistake, and it is right for a
 * concrete reason rather than a general one: this panel is the only route to the location
 * control, and a phone has no hover at all.
 *
 * `aria-expanded` is driven from the same state as the class, not from CSS, so it can never
 * describe a panel that is open while claiming to be shut.
 */
function setupPanel() {
  const wrap = el("wx");
  const chip = el("wxChip");
  if (!wrap || !chip) return;

  let shut = null;
  const set = (open) => {
    clearTimeout(shut);
    wrap.dataset.open = String(open);
    chip.setAttribute("aria-expanded", String(open));
  };

  /**
   * Is the message form open? These two panels are the only floating things in the app and
   * they share the right-hand side of the screen, so one has to give way.
   *
   * Read from the DOM rather than mirrored in a variable here: the class IS the state, and a
   * copy of it in this file is a copy that can be wrong.
   */
  const contactOpen = () => {
    const panel = document.getElementById("cwPanel");
    return !!panel && !panel.classList.contains("hidden");
  };

  chip.addEventListener("click", () => {
    const opening = wrap.dataset.open !== "true";
    // A click is a decision, so it wins - but it takes the form down with it rather than
    // landing on top of it. The draft survives; the panel is only hidden.
    if (opening && contactOpen()) document.dispatchEvent(new CustomEvent("app:collapse"));
    set(opening);
  });

  // Pointer devices only. On a touch screen `pointerenter` fires on tap, which would fight the
  // click handler and leave the panel toggling twice.
  const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
  wrap.addEventListener("pointerenter", () => {
    // Not while the message form is open. A pointer crossing the chip on its way somewhere else
    // is an accident, and an accident must not shut a form somebody is typing into - which is
    // what the two panels overlapping came down to.
    if (fine.matches && !contactOpen()) set(true);
  });
  wrap.addEventListener("pointerleave", () => {
    // A grace period, because the gap between the chip and the panel is a place the pointer
    // passes through on the way to the panel, not a decision to leave.
    if (fine.matches) { clearTimeout(shut); shut = setTimeout(() => set(false), 180); }
  });

  // Keyboard needs no opener of its own: Enter and Space on a <button> fire click, which is
  // handled above. There used to be a `focusin` handler that opened the panel, and it made
  // Escape do nothing visible - it closed, then `chip.focus()` fired focusin and reopened it in
  // the same tick. Closing has to be able to win.
  wrap.addEventListener("focusout", (e) => {
    if (!wrap.contains(e.relatedTarget)) set(false);
  });
  wrap.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    set(false);
    chip.focus();
  });

  // Tapping elsewhere shuts it, which is the only way out on a touch screen.
  document.addEventListener("click", (e) => { if (!wrap.contains(e.target)) set(false); });
}

profile.then(async (me) => {
  greet(me);
  setupPanel();
  // Not awaited: the forecast below is the slow part and must not queue behind this, nor this
  // behind it. Each paints the moment it has something to say.
  loadQueues(me);

  // Your saved home wins. It is a setting; the button in the panel is a one-off for this
  // session and deliberately does not overwrite it. That is the entire difference between the
  // two, and it is why travelling does not silently move where "home" is.
  const home = me.homeLocation || null;

  let coords = null;
  let name = null;
  if (wantsGeo() && navigator.geolocation) {
    // Asked for, this session. A refusal or a slow fix must not hold up the forecast.
    try {
      const pos = await position();
      coords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
    } catch (e) { setGeo(false); }
  }
  if (!coords && home) {
    coords = { lat: home.lat, lon: home.lon };
    name = home.name;
  }

  setupGeo(Boolean(coords) && !name, home);
  try {
    await load(coords, name);
  } catch (err) {
    // A missing forecast must not take the page with it.
    console.error("app: weather failed", err.message);
    unavailable();
  }
});
