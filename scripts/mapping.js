/**
 * /data-mapping/: three invented source records, the rules that map them, and the one profile
 * they merge into. The profile is computed here, in the browser, from the raw values and the
 * rules below; nothing on the page is a hand-typed result. scripts/mapping.test.js checks it.
 *
 * Every string on the page is set with textContent, never innerHTML.
 */
(function () {
  "use strict";

  var SOURCES = [
    { key: "ticket", label: "Ticketing order", id: "order_id", updated: "2026-03-14", fields: {
      order_id: "T-88213",
      buyer_email: "  Anna.Berg@Example.com",
      buyer_name: "ANNA BERG",
      buyer_phone: "070-123 45 67",
      purchased_at: "2026-03-14 18:02",
      amount: "500.00"
    } },
    { key: "shop", label: "Web-shop order", id: "id", updated: "2026-04-09", fields: {
      id: "WS-5531",
      email: "anna.berg@example.com",
      first_name: "anna",
      last_name: "berg",
      tel: "+46 70 123 45 67",
      created: "09/04/2026",
      total: "499,00",
      city: "Uppsala"
    } },
    { key: "crm", label: "CRM contact", id: "ContactId", updated: "2026-05-02", fields: {
      ContactId: "C-0042",
      Email: "a.berg@work.example",
      Mobile: "0046701234567",
      FirstName: "Anna",
      LastName: "BERG-LIND",
      BirthDate: "1990-07-02",
      Marketing_Opt_In: "Y",
      Modified: "2026-05-02"
    } }
  ];

  function titleWord(w) { return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(); }

  // Each transform: what it is called on the page, and what it does.
  var T = {
    trim: ["trim spaces", function (v) { return v.trim(); }],
    lower: ["lower-case", function (v) { return v.toLowerCase(); }],
    first: ["first word", function (v) { return v.trim().split(/\s+/)[0]; }],
    last: ["last word", function (v) { var p = v.trim().split(/\s+/); return p[p.length - 1]; }],
    title: ["name case", function (v) { return v.split(/([\s-])/).map(titleWord).join(""); }],
    // Swedish numbers: 07x local, 0046 international, +46 already. Spaces and dashes go.
    e164: ["E.164 phone", function (v) {
      var d = v.replace(/\D/g, "");
      if (/^\s*\+/.test(v)) return "+" + d;
      if (d.indexOf("00") === 0) return "+" + d.slice(2);
      if (d.charAt(0) === "0") return "+46" + d.slice(1);
      return "+" + d;
    }],
    iso: ["ISO date", function (v) {
      var m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(v);
      return m ? m[3] + "-" + m[2] + "-" + m[1] : v.slice(0, 10);
    }],
    decimal: ["decimal comma to point", function (v) { return Number(v.replace(",", ".")); }],
    yesno: ["Y/N to true/false", function (v) { return /^(y|yes|true|1)$/i.test(v.trim()); }]
  };

  // One rule per profile field: its inputs (source, field, transforms) and how they resolve.
  var RULES = [
    { target: "email", inputs: [["ticket", "buyer_email", ["trim", "lower"]], ["shop", "email", ["trim", "lower"]]],
      resolve: "agree" },
    { target: "secondary_email", inputs: [["crm", "Email", ["trim", "lower"]]], resolve: "only",
      why: "A different address for the same person is a second email, not a conflict. It is kept, not merged." },
    { target: "phone", inputs: [["ticket", "buyer_phone", ["e164"]], ["shop", "tel", ["e164"]], ["crm", "Mobile", ["e164"]]],
      resolve: "agree" },
    { target: "first_name", inputs: [["ticket", "buyer_name", ["first", "title"]], ["shop", "first_name", ["title"]], ["crm", "FirstName", ["title"]]],
      resolve: "agree" },
    { target: "last_name", inputs: [["ticket", "buyer_name", ["last", "title"]], ["shop", "last_name", ["title"]], ["crm", "LastName", ["title"]]],
      resolve: "crm",
      why: "The CRM owns identity fields and holds the newest record. Two sources saying Berg are two copies of an older truth, not a majority." },
    { target: "birth_date", inputs: [["crm", "BirthDate", ["iso"]]], resolve: "only" },
    { target: "city", inputs: [["shop", "city", ["trim"]]], resolve: "only" },
    { target: "marketing_consent", inputs: [["crm", "Marketing_Opt_In", ["yesno"]]], resolve: "only",
      why: "Consent comes only from the system that collected it. It is never inferred from a purchase." },
    { target: "first_purchase", inputs: [["ticket", "purchased_at", ["iso"]], ["shop", "created", ["iso"]]],
      resolve: "earliest" },
    { target: "lifetime_value_sek", inputs: [["ticket", "amount", ["decimal"]], ["shop", "total", ["decimal"]]],
      resolve: "sum" }
  ];

  var RESOLVE_WORDS = {
    agree: "Every source agrees once normalised.",
    only: "One source holds this field.",
    earliest: "The earliest date wins.",
    sum: "Summed across sources."
  };

  function source(key) { return SOURCES.filter(function (s) { return s.key === key; })[0]; }

  /** One input traced: the raw value, each step's output, and the final value. */
  function trace(input) {
    var v = source(input[0]).fields[input[1]];
    var steps = [];
    input[2].forEach(function (t) { v = T[t][1](v); steps.push({ name: T[t][0], value: v }); });
    return { src: input[0], field: input[1], raw: source(input[0]).fields[input[1]], steps: steps, value: v };
  }

  /** A rule applied: every input traced, the value that won, and from which source. */
  function apply(rule) {
    var traced = rule.inputs.map(trace);
    var values = traced.map(function (t) { return t.value; });
    var value, from = null, conflict = false;
    if (rule.resolve === "sum") {
      value = Math.round(values.reduce(function (a, b) { return a + b; }, 0) * 100) / 100;
    } else if (rule.resolve === "earliest") {
      value = values.slice().sort()[0];
      from = traced[values.indexOf(value)].src;
    } else if (rule.resolve === "agree" || rule.resolve === "only") {
      value = values[0];
      conflict = values.some(function (x) { return x !== value; });
    } else {
      // A source name: that source wins, and the inputs that lost are a conflict worth showing.
      var winner = traced.filter(function (t) { return t.src === rule.resolve; })[0];
      value = winner.value;
      from = winner.src;
      conflict = values.some(function (x) { return x !== value; });
    }
    return { target: rule.target, traced: traced, value: value, from: from, conflict: conflict,
      why: rule.why || RESOLVE_WORDS[rule.resolve] || "" };
  }

  /** Which normalised keys link each pair of records, and whether the raw values already did. */
  function matches() {
    var keys = { email: [], phone: [] };
    RULES.forEach(function (r) {
      if (r.target === "email" || r.target === "secondary_email") keys.email = keys.email.concat(r.inputs);
      if (r.target === "phone") keys.phone = keys.phone.concat(r.inputs);
    });
    var out = [];
    for (var i = 0; i < SOURCES.length; i++) {
      for (var j = i + 1; j < SOURCES.length; j++) {
        var a = SOURCES[i].key, b = SOURCES[j].key, on = [], raw = [];
        Object.keys(keys).forEach(function (k) {
          var ta = keys[k].filter(function (x) { return x[0] === a; }).map(trace)[0];
          var tb = keys[k].filter(function (x) { return x[0] === b; }).map(trace)[0];
          if (ta && tb && ta.value === tb.value) {
            on.push(k);
            if (ta.raw === tb.raw) raw.push(k);
          }
        });
        out.push({ a: a, b: b, on: on, raw: raw });
      }
    }
    return out;
  }

  function profile() { return RULES.map(apply); }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { T: T, profile: profile, matches: matches, SOURCES: SOURCES };
    return;
  }

  // ---- The page ---------------------------------------------------------------------------

  function node(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  // A raw value is shown quoted, so a leading space or a string "Y" is visible as what it is.
  function show(v) { return typeof v === "string" ? JSON.stringify(v) : String(v); }

  var result = profile();
  var byTarget = {};
  result.forEach(function (r) { byTarget[r.target] = r; });
  var buttons = { src: {}, out: {} };

  function select(target) {
    var r = byTarget[target];
    var lit = {};
    r.traced.forEach(function (t) { lit[t.src + "." + t.field] = true; });
    Object.keys(buttons.src).forEach(function (k) {
      buttons.src[k].setAttribute("data-lit", lit[k] ? "true" : "false");
    });
    Object.keys(buttons.out).forEach(function (k) {
      buttons.out[k].setAttribute("aria-pressed", k === target ? "true" : "false");
    });
    drawTrace(r);
  }

  function drawTrace(r) {
    var box = document.getElementById("dmTrace");
    box.textContent = "";
    var head = node("p", "text-sm text-brand-muted");
    head.appendChild(node("span", "font-mono font-semibold text-brand-text", r.target));
    head.appendChild(document.createTextNode(" comes from " + r.traced.length +
      (r.traced.length === 1 ? " field." : " fields.")));
    box.appendChild(head);

    var list = node("ol", "mt-3 space-y-3");
    r.traced.forEach(function (t) {
      var li = node("li", "dm-step");
      if (r.from && r.from !== t.src && r.conflict) li.setAttribute("data-lost", "true");
      if (r.from === t.src) li.setAttribute("data-won", "true");
      li.appendChild(node("p", "text-xs font-semibold uppercase tracking-wide text-brand-muted",
        source(t.src).label + " · " + t.field));
      li.appendChild(node("p", "dm-val", show(t.raw)));
      t.steps.forEach(function (s, i) {
        var p = node("p", i === t.steps.length - 1 ? "dm-val dm-final" : "dm-val");
        p.appendChild(node("span", "dm-op", s.name + " → "));
        p.appendChild(node("span", "dm-v", show(s.value)));
        li.appendChild(p);
      });
      if (r.from === t.src) li.appendChild(node("p", "dm-tag", "Won"));
      else if (r.from && r.conflict) li.appendChild(node("p", "dm-tag", "Lost"));
      list.appendChild(li);
    });
    box.appendChild(list);

    var res = node("div", "dm-result mt-4");
    res.appendChild(node("p", "text-xs font-semibold uppercase tracking-wide text-brand-muted",
      r.conflict ? "Conflict, resolved" : "Resolution"));
    res.appendChild(node("p", "mt-1 text-sm text-brand-text", r.why));
    res.appendChild(node("p", "dm-val mt-2 font-semibold", r.target + " = " + show(r.value)));
    box.appendChild(res);
  }

  function drawSources() {
    var wrap = document.getElementById("dmSources");
    SOURCES.forEach(function (s) {
      var card = node("section", "card dm-card");
      var head = node("div", "an-panel-head");
      head.appendChild(node("h3", "an-panel-title", s.label));
      head.appendChild(node("span", "text-xs text-brand-muted tabular-nums", "updated " + s.updated));
      card.appendChild(head);
      var ul = node("ul", "mt-2 space-y-1");
      Object.keys(s.fields).forEach(function (f) {
        var feeds = result.filter(function (r) {
          return r.traced.some(function (t) { return t.src === s.key && t.field === f; });
        })[0];
        var li = node("li");
        var b = node(feeds ? "button" : "div", "dm-field");
        if (feeds) {
          b.type = "button";
          b.setAttribute("aria-label", s.label + " " + f + ", feeds " + feeds.target);
          b.addEventListener("click", function () { select(feeds.target); });
        }
        b.appendChild(node("span", "dm-name", f));
        b.appendChild(node("span", "dm-val", show(s.fields[f])));
        b.setAttribute("data-lit", "false");
        if (!feeds) b.setAttribute("data-unused", "true");
        buttons.src[s.key + "." + f] = b;
        li.appendChild(b);
        ul.appendChild(li);
      });
      card.appendChild(ul);
      wrap.appendChild(card);
    });
  }

  function drawProfile() {
    var ul = document.getElementById("dmProfile");
    result.forEach(function (r) {
      var li = node("li");
      var b = node("button", "dm-field");
      b.type = "button";
      b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", function () { select(r.target); });
      b.appendChild(node("span", "dm-name", r.target + (r.conflict ? " ⚑" : "")));
      b.appendChild(node("span", "dm-val", show(r.value)));
      if (r.conflict) b.setAttribute("aria-label", r.target + ", " + show(r.value) + ", resolved from a conflict");
      buttons.out[r.target] = b;
      li.appendChild(b);
      ul.appendChild(li);
    });
  }

  function drawMatches() {
    var ul = document.getElementById("dmMatches");
    matches().forEach(function (m) {
      var li = node("li", "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2");
      li.appendChild(node("span", "font-medium text-brand-text",
        source(m.a).label + " ↔ " + source(m.b).label));
      var right = node("span", "text-sm text-brand-muted");
      right.textContent = m.on.length
        ? "Match on " + m.on.join(" and ") + (m.raw.length ? "" : ", only after normalising")
        : "No shared key";
      li.appendChild(right);
      ul.appendChild(li);
    });
  }

  drawSources();
  drawProfile();
  drawMatches();
  select("last_name");
})();
