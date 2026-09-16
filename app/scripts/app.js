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
// drizzle is not worth thirty lines on a personal dashboard.
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
  const box = el("weather");
  box.textContent = "";

  // createElement and textContent throughout: this is upstream data and has no business being
  // parsed as HTML.
  const headline = document.createElement("p");
  headline.className = "text-4xl font-bold text-brand-text";
  headline.textContent = round(now.temperature) !== null ? `${round(now.temperature)}°C` : "—";

  const detail = document.createElement("p");
  detail.className = "text-sm text-brand-muted mt-1";
  const bits = [describe(now.code)];
  if (round(now.feelsLike) !== null) bits.push(`feels like ${round(now.feelsLike)}°`);
  if (round(now.windSpeed) !== null) bits.push(`wind ${round(now.windSpeed)} km/h`);
  detail.textContent = bits.join(" · ");
  box.append(headline, detail);

  const days = (data.daily || []).slice(0, 3);
  if (days.length) {
    const list = document.createElement("ul");
    list.className = "mt-6 grid grid-cols-3 gap-3";
    days.forEach((d, i) => {
      const item = document.createElement("li");
      item.className = "rounded-lg border border-brand-muted/15 p-3 text-center";
      const name = document.createElement("p");
      name.className = "text-xs font-semibold text-brand-text";
      name.textContent = dayName(d.date, i);
      const temps = document.createElement("p");
      temps.className = "text-sm text-brand-text mt-1";
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

function unavailable() {
  const box = el("weather");
  box.textContent = "";
  const p = document.createElement("p");
  p.className = "text-sm text-brand-muted";
  p.textContent = "The forecast is unavailable right now.";
  box.appendChild(p);
}

profile.then(async (me) => {
  greet(me);
  try {
    renderWeather(await api("/weather"));
  } catch (err) {
    // A missing forecast must not take the page with it.
    console.error("app: weather failed", err.message);
    unavailable();
  }
});
