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

/**
 * The arrival time in full, for the delete confirmation.
 *
 * The row shows "14 Sep", which is enough to scan a list by and not enough to decide on a
 * deletion: two messages from the same person on the same day read identically in the row.
 */
function fullWhen(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" });
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

  // --- deleting this one message ---
  //
  // Here rather than only in the erasure console, because the everyday case is reading something
  // and wanting it gone. Going through the console would mean typing the sender's address to
  // remove a message already open on the screen, and would take their other messages with it.
  // This removes exactly this row.
  const sender = named ? `${m.name} (${m.email})` : (m.email || m.name || "an unnamed sender");

  const del = document.createElement("button");
  del.type = "button";
  // Red in both themes rather than the muted grey the other two actions use: this is the one
  // control in the list that destroys something, and it should not look like the other two.
  del.className = "text-sm text-red-700 underline hover:no-underline dark:text-red-400";
  del.textContent = "Delete";
  actions.appendChild(del);

  // The confirmation names the sender and the arrival time. On a list where every row is the
  // same shape, those two facts are what tell you whether this is the message you meant - and a
  // confirm() can show neither, which is why there is not one anywhere in this codebase.
  const confirm = document.createElement("div");
  confirm.className = "hidden mt-4 rounded-lg border border-amber-600/60 bg-amber-600/10 p-4";

  const ask = document.createElement("p");
  ask.className = "text-sm text-brand-text";
  const whoStrong = document.createElement("strong");
  whoStrong.textContent = sender;
  const stamp = fullWhen(m.createdAt);
  ask.append(document.createTextNode("Delete the message from "), whoStrong,
    document.createTextNode(stamp ? `, received ${stamp}?` : "?"));

  const caveat = document.createElement("p");
  caveat.className = "hint";
  // Said before the deletion, not only in the receipt afterwards. A contact message is stored
  // and emailed; this button reaches the stored one. Offering "Delete" without saying that would
  // be the screen claiming a reach the code does not have.
  caveat.textContent = m.notified
    ? "This deletes the stored message. A copy was emailed when it arrived, and that copy is not reachable from here."
    : "This deletes the stored message, and cannot be undone. Nothing was emailed for this one.";

  const confirmActions = document.createElement("div");
  confirmActions.className = "mt-3 flex flex-wrap gap-3";
  const go = document.createElement("button");
  go.type = "button";
  go.className = "btn-primary text-sm";
  go.textContent = "Yes, delete it";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "btn-secondary text-sm";
  cancel.textContent = "Cancel";
  confirmActions.append(go, cancel);
  confirm.append(ask, caveat, confirmActions);

  /**
   * Take this row off the list and leave the page honest about what is left on it.
   *
   * Nothing here touches `before` or the cursor stack, and nothing re-fetches. Refilling the page
   * would pull a row up from the next page into a list somebody is in the middle of reading, and
   * the counter beneath the heading says "shown", not "total", so it stays true by counting what
   * is actually left.
   */
  function remove() {
    const i = rows.indexOf(m);
    if (i !== -1) rows.splice(i, 1);
    // Focus is about to be destroyed along with the row. It goes to the next message so the
    // keyboard stays where the reader was, and falls back to the filter only when the deletion
    // emptied the list and there is no message left to hold it.
    const neighbour = row.nextElementSibling || row.previousElementSibling;
    row.remove();
    if (!rows.length) {
      const host = el("messages");
      host.textContent = "";
      paintEmpty(host);
    }
    paintCount();
    (neighbour ? neighbour.querySelector("summary") : el("filterAll")).focus();
  }

  del.addEventListener("click", () => {
    confirm.classList.remove("hidden");
    go.focus();
  });
  cancel.addEventListener("click", () => {
    confirm.classList.add("hidden");
    del.focus();
  });

  go.addEventListener("click", async () => {
    go.disabled = true;
    say("Deleting…");
    try {
      const res = await api(`/admin/messages/${encodeURIComponent(m.id)}/delete`, { method: "POST" });
      remove();
      // The API's own sentence about the emailed copies, printed as it wrote it. Rewriting it
      // shorter here is how a receipt ends up describing a deletion wider than the one that
      // happened, so it is repeated rather than summarised.
      say(res.notified && res.notified.count
        ? `Message from ${sender} deleted. ${res.notified.note}`
        : `Message from ${sender} deleted.`, "ok");
    } catch (err) {
      console.error("messages: delete failed", err.status, err.code);
      if (err.status === 404) {
        // Already gone: deleted in another tab, or swept up by an erasure of this sender. The
        // row is taken away anyway, because leaving it would be the list claiming the database
        // still holds something it does not.
        remove();
        say("That message was already gone. It has been taken off the list.");
        return;
      }
      go.disabled = false;
      say(err.code === "bad_id" ? "That message could not be identified."
        : err.status === 403 ? "This account is not allowed to delete messages."
        : "That message could not be deleted. Nothing was removed.", "error");
    }
  });

  body.append(who, text, actions, confirm);
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
