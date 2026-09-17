import { api, profile } from "./shell.js";
import { el, say } from "./admin-status.js";
import { isEmail } from "./email.js";

/**
 * Admin -> Messages: what people sent through the contact form, on either site.
 *
 * One page at a time, and the list is REPLACED rather than appended to. It used to load older
 * messages onto the end, which meant the page grew for as long as you kept pressing and the
 * browser held every message you had ever scrolled past.
 *
 * Paging is by cursor, because that is what the API offers: it answers with `nextBefore` and no
 * total. So there are no page numbers - a numbered pager would have to know how many pages there
 * are, and nothing here does. "Newer" walks back down a stack of the cursors this session has
 * already used, which is the only way back with a forward-only cursor.
 *
 * There is no sort control either, and that is a decision rather than an omission. The API
 * returns newest first; a control here could only reorder the twenty-five rows already fetched,
 * which would look like sorting the inbox and would not be.
 */

const PAGE_SIZES = [25, 50, 100];

// Cursors for the pages behind this one. Empty means this is the newest page.
let stack = [];
let before = null;
let unreadOnly = false;
let limit = 25;
let rows = [];

// --- what the URL says --------------------------------------------------------

/** The view, in the address bar, so it can be linked, bookmarked and gone back to. */
function pushUrl(replace) {
  const params = new URLSearchParams();
  if (unreadOnly) params.set("unread", "1");
  if (limit !== 25) params.set("limit", String(limit));
  if (before) params.set("before", before);
  const url = location.pathname + (params.toString() ? "?" + params : "");
  history[replace ? "replaceState" : "pushState"]({ stack, before, unreadOnly, limit }, "", url);
}

function readUrl() {
  const p = new URLSearchParams(location.search);
  unreadOnly = p.get("unread") === "1";
  const size = Number(p.get("limit"));
  limit = PAGE_SIZES.includes(size) ? size : 25;
  // A cursor is a message id. Anything else is discarded rather than sent, so a hand-edited URL
  // gets the newest page instead of an error from the API.
  const cursor = p.get("before");
  before = cursor && /^[0-9]{1,15}$/.test(cursor) ? cursor : null;
  // Arriving directly at a cursor means there is no history to walk back through. "Newer" stays
  // off until this session has paged forward itself, rather than pretending it knows the way.
  stack = [];
}

// --- rendering ----------------------------------------------------------------

const MAILTO_SUBJECT = "Re: your message";

/** A mailto: URL for an address, or null if that address has no business being in one. */
function mailto(email, subject) {
  if (!isEmail(email)) return null;
  return "mailto:" + email + (subject ? "?subject=" + encodeURIComponent(subject) : "");
}

/** A short, local rendering of when something arrived. */
function when(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  const sameYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleDateString(undefined,
    sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
}

/** The first line of a message, for the collapsed row. */
function preview(text) {
  const line = String(text || "").replace(/\s+/g, " ").trim();
  return line.length > 160 ? line.slice(0, 160) + "…" : line;
}

/**
 * One message, collapsed to a row that opens.
 *
 * createElement and textContent throughout. Every field below was typed by a stranger into a
 * public form; this is the one screen in the product where that text is read back, and innerHTML
 * would make the contact form a way to run script in an administrator's session.
 */
function messageRow(m) {
  const row = document.createElement("details");
  row.className = "msg";
  row.dataset.read = String(Boolean(m.read));

  const head = document.createElement("summary");
  head.className = "msg-row";

  const dot = document.createElement("span");
  dot.className = "msg-dot";
  // The dot is decoration; the row says "unread" in words to anything that reads it aloud.
  dot.setAttribute("aria-hidden", "true");

  const from = document.createElement("span");
  from.className = "msg-from";
  from.textContent = m.name || m.email || "";

  const line = document.createElement("span");
  line.className = "msg-preview";
  line.textContent = preview(m.message);

  const meta = document.createElement("span");
  meta.className = "msg-when flex items-center gap-2";
  if (!m.notified) {
    const warn = document.createElement("span");
    warn.className = "rounded-full bg-amber-600/15 px-2 py-0.5 text-[11px] font-semibold " +
      "text-amber-700 dark:text-amber-300";
    // Stored but never mailed: the only sign that a message arrived and the notification did not.
    warn.textContent = "not emailed";
    meta.appendChild(warn);
  }
  const time = document.createElement("time");
  time.dateTime = m.createdAt || "";
  time.textContent = when(m.createdAt);
  meta.appendChild(time);

  const state = document.createElement("span");
  state.className = "sr-only";
  state.textContent = m.read ? "Read. " : "Unread. ";

  head.append(state, dot, from, line, meta);

  // --- the opened message ---
  const body = document.createElement("div");
  body.className = "msg-body";

  const who = document.createElement("p");
  who.className = "text-sm";
  const href = mailto(m.email);
  const addr = document.createElement(href ? "a" : "span");
  addr.textContent = m.email || "";
  addr.className = href
    ? "text-brand-accent underline hover:no-underline break-all"
    : "text-brand-muted break-all";
  if (href) addr.href = href;
  // The name only when it is one. Messages sent from the in-app widget carry the sender's
  // profile name, which falls back to their address when they have not set one - so this read
  // "someone@example.com — someone@example.com" for anybody without a name.
  const named = m.name && m.name !== m.email;
  who.append(document.createTextNode(named ? m.name + " — " : ""), addr);

  const text = document.createElement("p");
  // A measure, not the width of the page: this is prose somebody wrote.
  text.className = "mt-3 max-w-prose whitespace-pre-wrap break-words text-sm text-brand-text";
  text.textContent = m.message;

  const actions = document.createElement("div");
  actions.className = "mt-4 flex flex-wrap items-center gap-4";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "text-sm text-brand-muted underline hover:text-brand-accent";
  toggle.textContent = m.read ? "Mark unread" : "Mark read";
  toggle.addEventListener("click", async () => {
    toggle.disabled = true;
    try {
      const res = await api(`/admin/messages/${encodeURIComponent(m.id)}/read`, {
        method: "POST", body: JSON.stringify({ read: !m.read }),
      });
      m.read = res.read;
      row.dataset.read = String(m.read);
      toggle.textContent = m.read ? "Mark unread" : "Mark read";
      state.textContent = m.read ? "Read. " : "Unread. ";
      paintCount();
      // On the unread-only list a message that has just been read no longer belongs here. It is
      // left in place rather than vanishing under the pointer that marked it - taking it away
      // would move everything below it, and the next click would land on the wrong message.
    } catch (err) {
      console.error("messages: read toggle failed", err.status);
      say("That could not be saved.", "error");
    } finally {
      toggle.disabled = false;
    }
  });
  actions.appendChild(toggle);

  const replyHref = mailto(m.email, MAILTO_SUBJECT);
  if (replyHref) {
    const reply = document.createElement("a");
    reply.className = "text-sm text-brand-accent underline hover:no-underline";
    reply.href = replyHref;
    reply.textContent = "Reply by email";
    actions.appendChild(reply);
  }

  body.append(who, text, actions);
  row.append(head, body);
  return row;
}

/** Counted from the rows on screen, and said as what it is rather than as a total. */
function paintCount() {
  const unread = rows.filter((m) => !m.read).length;
  el("messageCount").textContent = rows.length
    ? `${rows.length} shown · ${unread} unread on this page`
    : "";
}

function paintEmpty(host) {
  const p = document.createElement("p");
  p.className = "py-8 text-sm text-brand-muted";
  p.textContent = unreadOnly
    ? "Nothing unread. Switch to All to see the rest."
    : before ? "No messages this far back." : "No messages yet.";
  host.appendChild(p);
}

// --- loading ------------------------------------------------------------------

async function load() {
  const host = el("messages");
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  if (unreadOnly) params.set("unread", "1");
  if (before) params.set("before", before);

  const { messages, nextBefore } = await api("/admin/messages?" + params);
  rows = messages;

  host.textContent = "";
  if (!messages.length) {
    paintEmpty(host);
  } else {
    const list = document.createElement("div");
    list.className = "border-t border-brand-border";
    messages.forEach((m) => list.appendChild(messageRow(m)));
    host.appendChild(list);
  }

  paintCount();
  el("older").disabled = !nextBefore;
  el("older").dataset.next = nextBefore || "";
  el("newer").disabled = stack.length === 0;
  el("pageWhere").textContent = stack.length ? `Page ${stack.length + 1}` : "Newest";
  // The list was replaced under the reader; put them at the top of it rather than wherever the
  // previous page happened to leave them.
  host.scrollIntoView({ block: "start", behavior: "instant" });
}

async function go(fn, replaceUrl) {
  fn();
  pushUrl(replaceUrl);
  say("");
  try {
    await load();
  } catch (err) {
    console.error("messages: load failed", err.status);
    el("messages").textContent = "";
    say(err.status === 404 ? "Messages are unavailable — the database is not configured."
      : err.status === 403 ? "This account is not allowed to read messages."
      : "Messages could not be loaded.", "error");
  }
}

// --- controls -----------------------------------------------------------------

function paintControls() {
  el("filterAll").setAttribute("aria-pressed", String(!unreadOnly));
  el("filterUnread").setAttribute("aria-pressed", String(unreadOnly));
  el("pageSize").value = String(limit);
}

profile.then(() => {
  readUrl();
  paintControls();

  // Changing the filter or the page size starts again at the newest page: the cursor belonged to
  // the old list, and carrying it over would land somewhere arbitrary in the new one.
  const restart = (change) => go(() => { change(); stack = []; before = null; paintControls(); });

  el("filterAll").addEventListener("click", () => { if (unreadOnly) restart(() => { unreadOnly = false; }); });
  el("filterUnread").addEventListener("click", () => { if (!unreadOnly) restart(() => { unreadOnly = true; }); });
  el("pageSize").addEventListener("change", (e) => {
    const size = Number(e.target.value);
    if (PAGE_SIZES.includes(size) && size !== limit) restart(() => { limit = size; });
  });

  el("older").addEventListener("click", (e) => {
    const next = e.currentTarget.dataset.next;
    if (!next) return;
    go(() => { stack.push(before); before = next; });
  });

  el("newer").addEventListener("click", () => {
    if (!stack.length) return;
    go(() => { before = stack.pop() || null; });
  });

  // The back button should move between pages of the list, not out of it.
  addEventListener("popstate", (e) => {
    const s = e.state;
    if (s) { stack = s.stack || []; before = s.before || null; unreadOnly = !!s.unreadOnly; limit = s.limit || 25; }
    else readUrl();
    paintControls();
    load().catch(() => say("Messages could not be loaded.", "error"));
  });

  go(() => {}, true);
});
