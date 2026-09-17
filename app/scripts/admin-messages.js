import { api, profile } from "./shell.js";
import { el, say } from "./admin-status.js";

/**
 * Admin → Messages: what people sent through the contact form, on either site.
 *
 * Its own page rather than a section beneath the account list. The two are unrelated features
 * that happened to share a screen, and messages are the part that grows without limit - a
 * hundred of them used to sit below the accounts table and bury it.
 */

let oldest = null;     // the cursor for the next page, handed to us by the server
let inbox = [];        // every message rendered so far, so "unread" is counted from data

// An allowlist, and the allowlist is the point.
//
// This used to be a blocklist - anything without a space, an @ or an angle bracket - which is a
// reasonable test of "is this an email address" and no test at all of "may this go in a URL".
// `a@b.co?bcc=attacker%40evil.com` passes that test, passes the API's identical check on the way
// in, and is stored as somebody's address; the mailto it builds silently blind-copies a stranger
// on your reply. `?body=` writes the reply for you, `?to=` adds a recipient. `%40` is why the
// "only one @" shape of the old pattern did not stop any of it.
//
// A mailto cannot be fixed by appending: the FIRST `?` wins, so our own `?subject=` below lands
// after theirs and changes nothing. The address itself has to be refused.
//
// Still not percent-encoded, for the original reason - encodeURIComponent turns a@b.com into
// a%40b.com. An address that cannot go into a URL as written is refused instead, and
// messageCard() already renders a null href as a plain <span>: such an address loses its link,
// never its text, and the message is still readable and still says who sent it.
const MAILTO = /^[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
const MAX_EMAIL = 254;   // RFC 5321, the same ceiling the API applies on the way in

/** A mailto: URL for an address, or null if that address has no business being in one. */
function mailto(email, subject) {
  if (typeof email !== "string" || email.length > MAX_EMAIL || !MAILTO.test(email)) return null;
  return "mailto:" + email + (subject ? "?subject=" + encodeURIComponent(subject) : "");
}

/** A short, local rendering of when something arrived. */
function when(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) + " " +
      d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/**
 * One message.
 *
 * createElement and textContent throughout, like the rest of this file - and here it is not a
 * stylistic preference. Every field below was typed by a stranger into a public form; this is
 * the one screen in the product where that text is read back, and innerHTML would make the
 * contact form a way to run script in an administrator's session.
 */
function messageCard(m) {
  const li = document.createElement("li");
  li.className = "rounded-lg border p-4 " + (m.read
    ? "border-brand-muted/15 bg-brand-surface"
    : "border-brand-accent/30 bg-brand-accent/5");

  const head = document.createElement("div");
  head.className = "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1";

  const who = document.createElement("div");
  who.className = "min-w-0";
  const name = document.createElement("p");
  name.className = "font-semibold text-brand-text truncate";
  name.textContent = m.name;
  const href = mailto(m.email);
  const from = document.createElement(href ? "a" : "span");
  from.className = "block text-sm text-brand-accent underline hover:no-underline break-all";
  if (href) from.href = href; else from.className = "block text-sm text-brand-muted break-all";
  from.textContent = m.email;
  who.append(name, from);

  const meta = document.createElement("div");
  meta.className = "flex items-center gap-2 shrink-0";
  const time = document.createElement("span");
  time.className = "text-xs text-brand-muted tabular-nums";
  time.textContent = when(m.createdAt);
  meta.appendChild(time);
  if (!m.notified) {
    const warn = document.createElement("span");
    warn.className = "inline-block rounded-full px-2 py-0.5 text-xs font-semibold " +
      "bg-amber-600/15 text-amber-700 dark:text-amber-300";
    // Stored but never mailed. Worth surfacing: it is the only sign that a message arrived and
    // the notification did not.
    warn.textContent = "not emailed";
    meta.appendChild(warn);
  }
  head.append(who, meta);

  const body = document.createElement("p");
  body.className = "mt-3 whitespace-pre-wrap break-words text-sm text-brand-text";
  body.textContent = m.message;

  const actions = document.createElement("div");
  actions.className = "mt-3 flex items-center gap-3";
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
      li.replaceWith(messageCard(m));
      paintUnread();
    } catch (err) {
      say("That could not be saved.", "error");
      toggle.disabled = false;
    }
  });
  actions.appendChild(toggle);
  const replyHref = mailto(m.email, "Re: your message");
  if (replyHref) {
    const reply = document.createElement("a");
    reply.className = "text-sm text-brand-accent underline hover:no-underline";
    reply.href = replyHref;
    reply.textContent = "Reply by email";
    actions.appendChild(reply);
  }

  li.append(head, body, actions);
  return li;
}

/** Counted from the messages themselves. Counting rendered elements by class name works right
 *  up until a class changes, and then it reports zero forever without failing. */
function paintUnread() {
  const unread = inbox.filter((m) => !m.read).length;
  el("messageCount").textContent = unread ? `${unread} unread` : "";
}

async function loadMessages({ append = false } = {}) {
  const host = el("messages");
  const more = el("moreMessages");
  const { messages, nextBefore } = await api(
    "/admin/messages" + (append && oldest ? `?before=${encodeURIComponent(oldest)}` : ""));
  oldest = nextBefore;

  if (!append) {
    inbox = [];
    host.textContent = "";
    if (!messages.length) {
      const empty = document.createElement("p");
      empty.className = "text-sm text-brand-muted";
      empty.textContent = "No messages yet.";
      host.appendChild(empty);
    }
  }
  let list = host.querySelector("ul");
  if (!list) {
    list = document.createElement("ul");
    list.className = "space-y-3";
    host.appendChild(list);
  }
  inbox = inbox.concat(messages);
  messages.forEach((m) => list.appendChild(messageCard(m)));

  paintUnread();
  more.classList.toggle("hidden", !nextBefore);
}

profile.then(() => {
  const more = el("moreMessages");
  more.addEventListener("click", async () => {
    more.disabled = true;
    try { await loadMessages({ append: true }); } catch (err) { say("Older messages could not be loaded.", "error"); }
    more.disabled = false;
  });

  loadMessages().catch((err) => {
    console.error("admin: messages failed", err.status);
    el("messages").textContent = "";
    const p = document.createElement("p");
    p.className = "text-sm text-brand-muted";
    p.textContent = err.status === 403
      ? "This account is not allowed to read messages."
      : err.status === 404
      ? "Messages are unavailable — the database is not configured."
      : "Messages could not be loaded.";
    el("messages").appendChild(p);
  });
});
