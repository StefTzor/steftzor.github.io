import { api, profile } from "./shell.js";

/**
 * A read-only browser for the Postgres schema.
 *
 * What this deliberately is not: a query box. The API accepts no SQL from anywhere, so there is
 * nothing here to type one into. That is a decision about blast radius rather than about effort —
 * losing this screen to a stolen session should cost a read of three tables, not a psql
 * prompt against production. An Admin session is worth plenty more than this screen; what is
 * bounded here is this screen.
 *
 * Everything the grid can do, the server decides it may do. The column list, what may be sorted,
 * what may be filtered and how many rows come back are all checked there against the real catalog;
 * this file reads that answer and draws it. Nothing here is a control — a disabled button is a
 * courtesy, and the endpoint refuses the request anyway.
 */

const el = (id) => document.getElementById(id);

let tables = [];
let current = null;      // the table being shown
let columns = [];        // its readable columns, from the server
let sort = null;
let dir = "desc";
let offset = 0;
let total = 0;
let limit = 25;
let filter = { column: "", op: "contains", value: "" };

function say(text, tone) {
  const box = el("status");
  box.textContent = text || "";
  box.className = "mb-6 text-sm " + (
    tone === "error" ? "text-red-700 dark:text-red-400" : "text-brand-muted");
}

// --- picking a table ----------------------------------------------------------

function renderPicker() {
  const wrap = el("tablePick");
  wrap.textContent = "";
  tables.forEach((t) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "seg border border-brand-muted/20";
    btn.setAttribute("aria-pressed", String(t.name === current));
    const name = document.createElement("span");
    name.className = "font-mono";
    name.textContent = t.name;
    const count = document.createElement("span");
    count.className = "ml-2 text-xs text-brand-muted tabular-nums";
    // toLocaleString so six figures is readable. It is a count, not an id.
    count.textContent = t.rowCount.toLocaleString();
    btn.append(name, count);
    btn.addEventListener("click", () => choose(t.name));
    wrap.appendChild(btn);
  });
}

function choose(name) {
  if (current === name) return;
  current = name;
  // A new table means new columns, so every choice made about the old one is meaningless here.
  // Carrying a sort column across tables would send a name the server would refuse.
  sort = null;
  dir = "desc";
  offset = 0;
  filter = { column: "", op: "contains", value: "" };
  el("filterValue").value = "";
  renderPicker();
  load();
}

// --- the grid -----------------------------------------------------------------

/**
 * The header row. Each column is a button that sorts by it.
 *
 * A button rather than a click handler on the <th>: sorting a table is an action, and an action
 * that only a mouse can reach is one a keyboard user does not have.
 */
function renderHead() {
  const head = el("gridHead");
  head.textContent = "";
  columns.forEach((c) => {
    const th = document.createElement("th");
    th.scope = "col";
    th.className = "whitespace-nowrap px-3 py-2 text-left align-bottom";
    // aria-sort on the header is what a screen reader reads out; the arrow is for everyone else.
    if (c.name === sort) th.setAttribute("aria-sort", dir === "asc" ? "ascending" : "descending");

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "group inline-flex items-center gap-1 font-semibold text-brand-text hover:text-brand-accent";
    const label = document.createElement("span");
    label.className = "font-mono text-xs";
    label.textContent = c.name;
    const arrow = document.createElement("span");
    arrow.className = "text-[10px] " + (c.name === sort ? "text-brand-accent" : "text-transparent group-hover:text-brand-muted");
    arrow.textContent = c.name === sort && dir === "asc" ? "▲" : "▼";
    arrow.setAttribute("aria-hidden", "true");
    btn.append(label, arrow);
    btn.addEventListener("click", () => {
      // Clicking the column already sorted flips it; a different column starts descending, which
      // is what people want from a table that is mostly timestamps and ids.
      if (sort === c.name) dir = dir === "asc" ? "desc" : "asc";
      else { sort = c.name; dir = "desc"; }
      offset = 0;
      load();
    });

    const type = document.createElement("span");
    type.className = "mt-0.5 block text-[10px] font-normal text-brand-muted";
    type.textContent = c.type + (c.nullable ? "" : " · not null");

    th.append(btn, type);
    head.appendChild(th);
  });
}

function renderRows(rows) {
  const body = el("gridBody");
  body.textContent = "";

  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = Math.max(columns.length, 1);
    td.className = "px-3 py-6 text-center text-brand-muted";
    td.textContent = filter.value ? "Nothing in this table matches that." : "This table is empty.";
    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    row.forEach((value, i) => {
      const td = document.createElement("td");
      td.className = "px-3 py-2 align-top " + (value === null ? "text-brand-muted italic" : "text-brand-text");
      // NULL is a value and "" is a different value; a grid that shows both as an empty cell is
      // lying about one of them.
      td.textContent = value === null ? "null" : value;
      // Long text wraps rather than stretching the table to the width of the longest message.
      if (columns[i] && /char|text/.test(columns[i].type)) td.className += " max-w-[24rem] whitespace-pre-wrap break-words";
      else td.className += " whitespace-nowrap tabular-nums";
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });
}

function renderPaging() {
  const first = total ? offset + 1 : 0;
  const last = Math.min(offset + limit, total);
  el("pageCount").textContent = total
    ? `${first.toLocaleString()}–${last.toLocaleString()} of ${total.toLocaleString()}`
    : "No rows";
  el("pageBack").disabled = offset === 0;
  el("pageNext").disabled = last >= total;
}

// --- loading ------------------------------------------------------------------

async function load() {
  say("Reading…");
  const params = new URLSearchParams({ table: current, limit: String(limit), offset: String(offset) });
  if (sort) { params.set("sort", sort); params.set("dir", dir); }
  if (filter.column && filter.value) {
    params.set("filterColumn", filter.column);
    params.set("filterOp", filter.op);
    params.set("filterValue", filter.value);
  }

  try {
    const data = await api("/admin/db/rows?" + params.toString());
    columns = data.columns;
    sort = data.sort;
    dir = data.dir;
    total = data.total;
    limit = data.limit;
    offset = data.offset;

    const table = tables.find((t) => t.name === current);
    el("tableName").textContent = current;
    el("tableNote").textContent = table ? table.note : "";
    renderFilterColumns();
    renderHead();
    renderRows(data.rows);
    renderPaging();
    el("tableBody").classList.remove("hidden");
    say("");
  } catch (err) {
    console.error("data:", err.status, err.code);
    // The rows on screen belong to whatever loaded last, which after a failed switch is not the
    // table the picker is now showing as chosen. Leaving them up would put one table's data under
    // another table's name, so the grid goes rather than going stale.
    el("tableBody").classList.add("hidden");
    say(err.code === "no_such_table" ? "That table cannot be read."
      : err.code === "bad_sort" || err.code === "bad_filter" ? "That column cannot be used that way."
      : err.status === 403 ? "This account may not read the database."
      : "Those rows could not be read.", "error");
  }
}

/** The filter's column list, which is this table's readable columns and nothing else. */
function renderFilterColumns() {
  const pick = el("filterColumn");
  const had = pick.value;
  pick.textContent = "";
  columns.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.name;
    opt.textContent = c.name;
    pick.appendChild(opt);
  });
  if (columns.some((c) => c.name === had)) pick.value = had;
}

profile.then(async () => {
  if (!el("tablePick")) return;

  el("pageBack").addEventListener("click", () => { offset = Math.max(offset - limit, 0); load(); });
  el("pageNext").addEventListener("click", () => { offset += limit; load(); });

  el("filterForm").addEventListener("submit", (e) => {
    e.preventDefault();
    filter = { column: el("filterColumn").value, op: el("filterOp").value, value: el("filterValue").value.trim() };
    offset = 0;
    load();
  });
  el("filterClear").addEventListener("click", () => {
    el("filterValue").value = "";
    filter = { column: "", op: "contains", value: "" };
    offset = 0;
    load();
  });

  say("Reading the schema…");
  try {
    const data = await api("/admin/db/tables");
    tables = data.tables;
    if (!tables.length) { say("This deployment has no readable tables.", "error"); return; }
    renderPicker();
    say("");
    choose(tables[0].name);
  } catch (err) {
    console.error("data: schema", err.status, err.code);
    say(err.status === 403 ? "This account may not read the database."
      : "The schema could not be read.", "error");
  }
});
