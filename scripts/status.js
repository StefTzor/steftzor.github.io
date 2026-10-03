/**
 * /status/: reads api.tzortzoglou.eu/status and draws one row per component.
 *
 * Every string on the page is set with textContent. A state is always said in words ("Up",
 * "Down", "No recent data") beside its colour, never by colour alone, and a failure to reach the
 * API is a result in its own right: this page is on GitHub Pages precisely so it can report it.
 */
(function () {
  "use strict";

  var API_BASE = (location.hostname === "localhost" || location.hostname === "127.0.0.1")
    ? "http://localhost:3000"
    : "https://api.tzortzoglou.eu";

  var WORD = { up: "Up", down: "Down", unknown: "No recent data" };

  function el(id) { return document.getElementById(id); }

  function node(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function pct(x) {
    if (x === null || x === undefined) return "—";
    var p = x * 100;
    return (p >= 99.95 ? "100" : p.toFixed(p >= 99 ? 2 : 1)) + "%";
  }

  function banner(state, text) {
    el("stBanner").setAttribute("data-state", state);
    el("stBannerText").textContent = text;
  }

  /** One component: state, name, what it is, the 24-hour strip, uptime and speed. */
  function row(c) {
    var li = node("li", "py-3");
    var top = node("div", "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1");
    var left = node("div", "flex min-w-0 items-baseline gap-2");
    var dot = node("span", "st-dot shrink-0");
    dot.setAttribute("data-state", c.status);
    dot.setAttribute("aria-hidden", "true");
    left.appendChild(dot);
    left.appendChild(node("span", "font-medium text-brand-text", c.name));
    left.appendChild(node("span", "truncate text-xs text-brand-muted", c.what));
    var right = node("div", "flex items-baseline gap-3 text-xs text-brand-muted tabular-nums");
    var word = node("span", "st-word font-semibold", WORD[c.status] || c.status);
    word.setAttribute("data-state", c.status);
    right.appendChild(word);
    if (c.avgMs !== null && c.id !== "api") right.appendChild(node("span", "", c.avgMs + " ms avg"));
    right.appendChild(node("span", "", pct(c.uptime24h) + " today"));
    right.appendChild(node("span", "", pct(c.uptime7d) + " 7d"));
    top.appendChild(left);
    top.appendChild(right);

    // The strip: 24 hourly cells, oldest left. A cell is all-up, some-down, all-down, or empty.
    var strip = node("div", "st-strip mt-2");
    strip.setAttribute("aria-hidden", "true");
    c.hours.forEach(function (h, i) {
      var cell = node("span", "st-cell");
      var level = h === null ? "none" : h === 1 ? "up" : h === 0 ? "down" : "partial";
      cell.setAttribute("data-level", level);
      var ago = 24 - i;
      cell.title = (ago === 1 ? "The last hour" : ago + " hours ago") + ": "
        + (h === null ? "no checks" : pct(h) + " of checks answered");
      strip.appendChild(cell);
    });

    // The same strip, in words, for a screen reader.
    var hoursDown = c.hours.filter(function (h) { return h !== null && h < 1; }).length;
    var sr = node("span", "sr-only", c.hours.every(function (h) { return h === null; })
      ? "No checks in the last 24 hours."
      : hoursDown ? hoursDown + " of the last 24 hours had a failed check."
        : "Every check in the last 24 hours answered.");

    li.appendChild(top);
    li.appendChild(strip);
    li.appendChild(sr);
    return li;
  }

  function draw(data) {
    var stack = el("stStack");
    var upstream = el("stUpstream");
    stack.textContent = "";
    upstream.textContent = "";
    data.components.forEach(function (c) {
      (c.group === "stack" ? stack : upstream).appendChild(row(c));
    });

    var down = data.components.filter(function (c) { return c.status === "down"; });
    if (down.length) {
      banner("down", (down.length === 1 ? "Down: " : "Some things are down: ")
        + down.map(function (c) { return c.name; }).join(", ") + ".");
    } else {
      banner("up", "Everything checked is working.");
    }
    el("stUpdated").textContent = "Last read "
      + new Date(data.generatedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
      + ".";
  }

  function unreachable() {
    banner("down", "The API is not answering, so the live checks cannot be read. This page is "
      + "served from GitHub Pages, and it is fine.");
    ["stStack", "stUpstream"].forEach(function (id) {
      el(id).textContent = "";
      el(id).appendChild(node("li", "py-3 text-sm text-brand-muted",
        "Unavailable while the API is not answering."));
    });
  }

  function load() {
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 8000) : 0;
    fetch(API_BASE + "/status", ctrl ? { signal: ctrl.signal } : {})
      .then(function (res) {
        if (!res.ok) throw new Error("status " + res.status);
        return res.json();
      })
      .then(function (data) {
        clearTimeout(timer);
        if (!data || !Array.isArray(data.components)) throw new Error("shape");
        draw(data);
      })
      .catch(function () {
        clearTimeout(timer);
        unreachable();
      });
  }

  // ---- Recent deploys: read beside the uptime, so a dip can be matched to the deploy behind it.

  var RESULT = { success: ["up", "Deployed"], failure: ["down", "Failed"], cancelled: ["unknown", "Cancelled"] };

  function ago(iso) {
    var mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (!isFinite(mins)) return "";
    if (mins < 60) return mins <= 1 ? "just now" : mins + " min ago";
    var hours = Math.round(mins / 60);
    if (hours < 48) return hours + " h ago";
    return Math.round(hours / 24) + " days ago";
  }

  function deployRow(d) {
    var r = RESULT[d.result] || ["unknown", d.result === "in_progress" || d.result === "queued" ? "In progress" : d.result];
    var li = node("li", "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3");
    var left = node("div", "flex min-w-0 items-baseline gap-2");
    var dot = node("span", "st-dot shrink-0");
    dot.setAttribute("data-state", r[0]);
    dot.setAttribute("aria-hidden", "true");
    left.appendChild(dot);
    left.appendChild(node("span", "font-medium text-brand-text", d.part));
    // A link only to GitHub, whatever the API sends: it is a run page, nothing else.
    if (d.message && typeof d.url === "string" && d.url.indexOf("https://github.com/") === 0) {
      var a = node("a", "truncate text-xs text-brand-muted underline decoration-brand-border hover:text-brand-text", d.message);
      a.href = d.url;
      a.rel = "noopener";
      left.appendChild(a);
    } else if (!d.message) {
      left.appendChild(node("span", "truncate text-xs text-brand-muted", "private repository"));
    }
    var right = node("div", "flex flex-wrap items-baseline gap-x-3 text-xs text-brand-muted tabular-nums");
    var word = node("span", "st-word font-semibold", r[1]);
    word.setAttribute("data-state", r[0]);
    right.appendChild(word);
    if (d.browser) {
      right.appendChild(node("span", "whitespace-nowrap", d.browser === "success" ? "checked in a browser" : "browser check failed"));
    }
    if (d.durationMs !== null && d.durationMs !== undefined) {
      right.appendChild(node("span", "whitespace-nowrap", Math.max(1, Math.round(d.durationMs / 1000)) + " s"));
    }
    if (d.startedAt) right.appendChild(node("span", "whitespace-nowrap", ago(d.startedAt)));
    li.appendChild(left);
    li.appendChild(right);
    return li;
  }

  function loadDeploys() {
    var list = el("stDeploys");
    fetch(API_BASE + "/status/deploys")
      .then(function (res) {
        if (!res.ok) throw new Error("deploys " + res.status);
        return res.json();
      })
      .then(function (data) {
        if (!data || !Array.isArray(data.deploys)) throw new Error("shape");
        list.textContent = "";
        if (!data.deploys.length) {
          list.appendChild(node("li", "py-3 text-sm text-brand-muted", "No deploys in the recent history."));
        }
        data.deploys.forEach(function (d) { list.appendChild(deployRow(d)); });
        if (data.unreachable && data.unreachable.length) {
          list.appendChild(node("li", "py-3 text-sm text-brand-muted",
            "Could not read the history of: " + data.unreachable.join(", ") + "."));
        }
      })
      .catch(function () {
        list.textContent = "";
        list.appendChild(node("li", "py-3 text-sm text-brand-muted", "Deploy history is unavailable right now."));
      });
  }

  load();
  loadDeploys();
  // A page left open keeps itself current, at the pace the checks themselves run.
  setInterval(load, 60000);
  setInterval(loadDeploys, 120000);
})();
