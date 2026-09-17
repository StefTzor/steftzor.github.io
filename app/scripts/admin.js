import { api, profile } from "./shell.js";

/**
 * The Admin view: approve accounts, and set what each one may see.
 *
 * Built with createElement and textContent throughout. Every string here - names, email
 * addresses - was typed by whoever registered, and an admin screen is precisely where you do
 * not want someone else's input parsed as markup.
 *
 * Rendered as a table from sm upward and as stacked cards below it: this table carries actions,
 * and a wide one on a phone either overflows the viewport or shrinks the controls past the point
 * of being tappable.
 */

const el = (id) => document.getElementById(id);
// Must match the server's canonical spellings in tzortzoglou-api/src/gate.js.
const ROLES = ["User", "SuperUser", "Admin"];
const STATUS_LABEL = { pending: "Pending", approved: "Approved", rejected: "Rejected", suspended: "Suspended" };

let me = null;
let rows = [];

function say(message, kind) {
  const box = el("status");
  box.textContent = message;
  box.className = "mb-6 text-sm " + (
    kind === "error" ? "text-red-700 dark:text-red-400"
    : kind === "ok" ? "text-emerald-700 dark:text-emerald-400"
    : "text-brand-muted");
}

function fullName(u) {
  return [u.firstName, u.lastName].filter(Boolean).join(" ");
}

function statusPill(status) {
  const span = document.createElement("span");
  const tone = status === "approved" ? "bg-emerald-600/15 text-emerald-700 dark:text-emerald-300"
    : status === "pending" ? "bg-amber-600/15 text-amber-700 dark:text-amber-300"
    : "bg-red-600/15 text-red-700 dark:text-red-300";
  span.className = "inline-block rounded-full px-2 py-0.5 text-xs font-semibold " + tone;
  span.textContent = STATUS_LABEL[status] || status;
  return span;
}

/** The controls for one account, shared by both layouts so they cannot drift apart. */
function controls(u) {
  const wrap = document.createElement("div");
  wrap.className = "flex flex-wrap items-center gap-2";

  if (u.uid === me.uid) {
    // The API refuses this outright; saying so is kinder than a button that always fails.
    const note = document.createElement("span");
    note.className = "text-xs text-brand-muted";
    note.textContent = "This is you";
    wrap.appendChild(note);
    return wrap;
  }

  const roleId = "role-" + u.uid;
  const label = document.createElement("label");
  label.className = "sr-only";
  label.htmlFor = roleId;
  label.textContent = `Role for ${u.email || u.uid}`;

  const select = document.createElement("select");
  select.id = roleId;
  select.className = "field w-auto text-sm py-1.5";
  ROLES.forEach((r) => {
    const opt = document.createElement("option");
    opt.value = r;
    opt.textContent = r;
    if (r === u.role) opt.selected = true;
    select.appendChild(opt);
  });
  // A confirmation step, not a change on `change`. Selecting from a dropdown is how people read
  // a list of options - the old binding turned reading into doing, so brushing a trackpad or
  // arrowing through the options to see them demoted somebody. Now the select only proposes,
  // and nothing is sent until Apply is pressed.
  const apply = document.createElement("button");
  apply.type = "button";
  apply.className = "btn-primary text-sm px-3 py-1.5 hidden";
  apply.textContent = "Apply";

  const sync = () => {
    const changed = select.value !== u.role;
    apply.classList.toggle("hidden", !changed);
    // Named for what it will do, because "Apply" alone is a mystery to a screen reader that has
    // not just watched the dropdown move.
    apply.setAttribute("aria-label", `Change ${u.email || u.uid} to ${select.value}`);
    select.classList.toggle("ring-2", changed);
    select.classList.toggle("ring-brand-accent", changed);
  };
  select.addEventListener("change", sync);
  apply.addEventListener("click", () => change(u, { role: select.value }, apply));
  sync();

  wrap.append(label, select, apply);

  const action = (text, patch, className) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = className + " text-sm px-3 py-1.5 rounded";
    b.textContent = text;
    b.addEventListener("click", () => change(u, patch, b));
    wrap.appendChild(b);
    return b;
  };

  if (u.status !== "approved") {
    action("Approve", { status: "approved" }, "bg-emerald-600 hover:bg-emerald-700 text-white font-semibold");
  } else {
    action("Suspend", { status: "suspended" },
      "border border-red-600/60 text-red-700 dark:text-red-300 hover:bg-red-600 hover:text-white");
  }
  return wrap;
}

/** Re-read the list; a failure here is about the view, not about the change that just landed. */
async function reload() {
  try {
    await load();
  } catch (err) {
    console.error("admin: reload failed", err.status);
    say("The change was saved, but the list could not be refreshed. Reload the page to see it.", "error");
  }
}

/** Apply a change, then re-render from the server's answer rather than from an assumption. */
async function change(u, patch, control) {
  const what = patch.status ? `${patch.status} ${u.email || u.uid}` : `set ${u.email || u.uid} to ${patch.role}`;
  control.disabled = true;
  say(`Saving — ${what}…`);
  try {
    const res = await api(`/admin/users/${encodeURIComponent(u.uid)}`, {
      method: "POST",
      body: JSON.stringify(patch),
    });
    say(res.sessionsRevoked
      ? `Done — ${what}. Their sessions were ended immediately.`
      : `Done — ${what}.`, "ok");
    // Refresh outside the try. The change is already committed by this point, and a hiccup on
    // the reload would otherwise be reported as the change having failed - leaving the admin
    // looking at a stale row, believing the opposite of what happened.
    reload();
  } catch (err) {
    console.error("admin: change failed", err.status, err.code);
    say(err.code === "self_target"
      ? "You cannot change your own role or status."
      : `That change could not be saved${err.status === 403 ? " — you are not allowed to make it." : "."}`, "error");
    control.disabled = false;
  }
}

function render() {
  const host = el("accounts");
  host.textContent = "";

  const pending = rows.filter((u) => u.status === "pending").length;
  el("count").textContent = rows.length + (pending ? ` · ${pending} awaiting approval` : "");

  if (!rows.length) {
    const p = document.createElement("p");
    p.className = "text-sm text-brand-muted";
    p.textContent = "No accounts yet.";
    host.appendChild(p);
    return;
  }

  // --- cards, below sm ----------------------------------------------------
  const cards = document.createElement("ul");
  cards.className = "sm:hidden space-y-3";
  rows.forEach((u) => {
    const li = document.createElement("li");
    li.className = "rounded-lg border border-brand-muted/15 bg-brand-surface p-4";
    const top = document.createElement("div");
    top.className = "flex items-start justify-between gap-3 mb-1";
    const who = document.createElement("div");
    who.className = "min-w-0";
    const name = document.createElement("p");
    name.className = "font-semibold text-brand-text truncate";
    name.textContent = fullName(u) || u.email || u.uid;
    const mail = document.createElement("p");
    mail.className = "text-xs text-brand-muted truncate";
    mail.textContent = u.email || "";
    who.append(name, mail);
    top.append(who, statusPill(u.status));
    li.append(top, controls(u));
    cards.appendChild(li);
  });

  // --- table, sm and up ---------------------------------------------------
  const table = document.createElement("table");
  table.className = "hidden sm:table w-full text-left text-sm";
  const thead = document.createElement("thead");
  const hrow = document.createElement("tr");
  ["Name", "Status", "Actions"].forEach((h) => {
    const th = document.createElement("th");
    th.scope = "col";
    th.className = "pb-2 font-semibold text-brand-text border-b border-brand-muted/20";
    th.textContent = h;
    hrow.appendChild(th);
  });
  thead.appendChild(hrow);

  const tbody = document.createElement("tbody");
  rows.forEach((u) => {
    const tr = document.createElement("tr");
    tr.className = "border-b border-brand-muted/10";

    const who = document.createElement("td");
    who.className = "py-3 pr-4 align-top";
    const name = document.createElement("p");
    name.className = "font-medium text-brand-text";
    name.textContent = fullName(u) || "—";
    const mail = document.createElement("p");
    mail.className = "text-xs text-brand-muted";
    mail.textContent = u.email || u.uid;
    who.append(name, mail);

    const st = document.createElement("td");
    st.className = "py-3 pr-4 align-top";
    st.appendChild(statusPill(u.status));

    const act = document.createElement("td");
    act.className = "py-3 align-top";
    act.appendChild(controls(u));

    tr.append(who, st, act);
    tbody.appendChild(tr);
  });
  table.append(thead, tbody);

  host.append(cards, table);
}

async function load() {
  const { users } = await api("/admin/users");
  rows = users;
  render();
}

/** Invite someone: one address, one role, and a clear answer either way. */
function wireInvite() {
  const form = el("inviteForm");
  if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (form.dataset.submitting === "1") return;

    const field = el("inviteEmail");
    field.removeAttribute("aria-invalid");
    const email = field.value.trim();
    const role = el("inviteRole").value;
    if (!email) {
      field.setAttribute("aria-invalid", "true");
      field.focus();
      say("Enter an email address to invite.", "error");
      return;
    }

    const btn = form.querySelector('button[type="submit"]');
    form.dataset.submitting = "1";
    btn.disabled = true;
    const idle = btn.textContent;
    btn.textContent = "Sending…";
    say(`Inviting ${email}…`);
    try {
      const res = await api("/admin/invites", { method: "POST", body: JSON.stringify({ email, role }) });
      say(res.sent
        ? `Invited ${email} as ${res.role}. They have been emailed a link to choose a password.`
        : `Account created for ${email} as ${res.role}, but the email could not be sent. Use Reset password to try again.`,
        res.sent ? "ok" : "error");
      form.reset();
      reload();
    } catch (err) {
      console.error("admin: invite failed", err.status, err.code);
      field.setAttribute("aria-invalid", "true");
      say(err.code === "already_exists"
        ? "That address already has an account — it is in the list above."
        : err.code === "invalid_email" ? "That is not a valid email address."
        : "The invitation could not be sent.", "error");
      field.focus();
    } finally {
      btn.disabled = false;
      btn.textContent = idle;
      form.dataset.submitting = "0";
    }
  });
}

// --- messages ----------------------------------------------------------------

let oldest = null;     // the cursor for the next page, handed to us by the server
let inbox = [];        // every message rendered so far, so "unread" is counted from data

// The API validated this shape on the way in, so an address that reaches here has no spaces and
// no newlines. Re-checking anyway, because this builds an href: if it ever does not match, the
// address is rendered as plain text rather than as a link to something unexpected.
const MAILTO = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;

/** A mailto: URL, or null if the address is not one. Deliberately NOT percent-encoded: the
 *  address is the path of a mailto URL, and encoding it turns a@b.com into a%40b.com. */
function mailto(email, subject) {
  if (typeof email !== "string" || !MAILTO.test(email)) return null;
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

profile.then(async (profileData) => {
  me = profileData;
  wireInvite();

  const more = el("moreMessages");
  if (more) {
    more.addEventListener("click", async () => {
      more.disabled = true;
      try { await loadMessages({ append: true }); } catch (err) { say("Older messages could not be loaded.", "error"); }
      more.disabled = false;
    });
  }
  // Separate from the account list on purpose: a database that is not configured must not stop
  // the accounts view - the two are unrelated features that happen to share a page.
  loadMessages().catch((err) => {
    console.error("admin: messages failed", err.status);
    el("messages").textContent = "";
    const p = document.createElement("p");
    p.className = "text-sm text-brand-muted";
    p.textContent = err.status === 404
      ? "Messages are unavailable — the database is not configured."
      : "Messages could not be loaded.";
    el("messages").appendChild(p);
  });

  try {
    await load();
    say("");
  } catch (err) {
    console.error("admin: load failed", err.status);
    el("accounts").textContent = "";
    say(err.status === 403
      ? "This account is not allowed to manage accounts."
      : "The account list could not be loaded.", "error");
  }
});
