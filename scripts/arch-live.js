/**
 * /code/: lights the architecture drawing from api.tzortzoglou.eu/status, the same data as
 * /status/. A dot per box the API checks, and the same facts in words in #archLive, because a
 * state is never told by colour alone. If the API does not answer, the drawing stays as drawn
 * and the line says so; this script never invents an "up".
 */
(function () {
  "use strict";

  var API_BASE = (location.hostname === "localhost" || location.hostname === "127.0.0.1")
    ? "http://localhost:3000"
    : "https://api.tzortzoglou.eu";

  var NAMES = { site: "Site", app: "App", api: "API", database: "Postgres", upstreams: "Upstreams" };

  /** The four upstreams share one box: down if any is down, up if any answered, else unknown. */
  function upstreams(list) {
    if (list.some(function (c) { return c.status === "down"; })) return { status: "down" };
    if (list.some(function (c) { return c.status === "up"; })) return { status: "up" };
    return { status: "unknown" };
  }

  function draw(data) {
    var by = {};
    data.components.forEach(function (c) { if (c.group === "stack") by[c.id] = c; });
    by.upstreams = upstreams(data.components.filter(function (c) { return c.group === "upstream"; }));

    var words = [];
    Object.keys(NAMES).forEach(function (id) {
      var c = by[id];
      if (!c) return;
      var dot = document.querySelector('.dg-live[data-live="' + id + '"]');
      if (dot) dot.setAttribute("data-state", c.status);
      var w = NAMES[id] + " " + (c.status === "up" ? "up" : c.status === "down" ? "down" : "no recent data");
      if (c.avgMs && id !== "api") w += ", " + c.avgMs + " ms";
      words.push(w);
    });

    var line = document.getElementById("archLive");
    line.textContent = "Live, checked every five minutes: " + words.join(" · ") + ". ";
    var a = document.createElement("a");
    a.href = "/status/";
    a.className = "underline hover:text-brand-text";
    a.textContent = "Full status";
    line.appendChild(a);
  }

  fetch(API_BASE + "/status")
    .then(function (res) { if (!res.ok) throw new Error("status " + res.status); return res.json(); })
    .then(function (data) {
      if (!data || !Array.isArray(data.components)) throw new Error("shape");
      draw(data);
    })
    .catch(function () {
      document.getElementById("archLive").textContent = "Live status is unavailable right now.";
    });
})();
