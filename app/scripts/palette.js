import { api, profile } from "./shell.js";

/**
 * The command palette: Cmd-K on a Mac, Ctrl-K everywhere else.
 *
 * A native <dialog> opened with showModal(), which is most of the reason this file is short.
 * The browser already does the hard parts - trapping focus, making the rest of the page inert,
 * closing on Escape, restoring focus to whatever opened it, and painting a backdrop. A
 * hand-rolled overlay has to reimplement all five and usually gets the focus trap wrong.
 *
 * Two kinds of entry, and the difference matters:
 *
 *   - **Going somewhere** is free. Nothing is fetched to build the list, so opening the palette
 *     costs no requests however often it is opened.
 *   - **Doing something** runs only when chosen. "Approve the oldest account waiting" does not
 *     preview the queue - it reads it at the moment you press Enter. A palette that fetched to
 *     decorate itself would spend the API's rate limit on being looked at.
 *
 * The role decides only what is listed. Every one of these lands on an endpoint or a page the
 * API gates on its own, so a hidden entry is a courtesy rather than a boundary.
 */

const RANK = new Map([["User", 1], ["SuperUser", 2], ["Admin", 3]]);
const el = (id) => document.getElementById(id);

let me = null;
let shown = [];
let active = 0;

const dialog = () => el("palette");
const input = () => el("paletteInput");
const list = () => el("paletteList");

/** Mac writes ⌘K; everything else writes Ctrl K. Read once - keyboards do not change. */
const IS_MAC = /mac/i.test(navigator.userAgentData?.platform || navigator.platform || "");
const CHORD = IS_MAC ? "⌘K" : "Ctrl K";

function say(text, tone) {
  const box = el("paletteStatus");
  box.textContent = text || "";
  box.className = "px-4 pb-3 text-sm " + (
    tone === "error" ? "text-red-700 dark:text-red-400"
    : tone === "ok" ? "text-emerald-700 dark:text-emerald-300"
    : "text-brand-muted");
}

const go = (href) => () => { close(); location.assign(href); };

/**
 * Approve whoever has been waiting longest.
 *
 * The oldest rather than "a" pending account: if two people are waiting, the one who has waited
 * longer is the one this should act on, and picking by list order would depend on how the API
 * happened to sort. It reports who it approved by name - an action fired from a palette gives no
 * other confirmation that it hit the right person.
 */
async function approveOldest() {
  say("Looking for the oldest account waiting…");
  try {
    const { users } = await api("/admin/users");
    const waiting = users
      .filter((u) => u.status === "pending")
      .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
    if (!waiting.length) { say("Nobody is waiting for approval.", "ok"); return; }
    const who = waiting[0];
    const name = [who.firstName, who.lastName].filter(Boolean).join(" ") || who.email || who.uid;
    await api(`/admin/users/${encodeURIComponent(who.uid)}`, {
      method: "POST", body: JSON.stringify({ status: "approved" }),
    });
    say(`Approved ${name}.` + (waiting.length > 1 ? ` ${waiting.length - 1} still waiting.` : ""), "ok");
  } catch (err) {
    console.error("palette: approve failed", err.status, err.code);
    say(err.status === 403 ? "This account may not approve people." : "That could not be done.", "error");
  }
}

/**
 * Every entry, in the order they are offered when nothing is typed.
 *
 * `keywords` exist so a command can be found by the word somebody actually reaches for -
 * "logout" for Sign out, "dark" for the theme - without those words cluttering the label.
 */
const COMMANDS = [
  { label: "Home", hint: "The forecast and what is waiting", keywords: "start dashboard", run: go("/") },
  { label: "Your profile", hint: "Name, email address, home location", keywords: "account settings name password", run: go("/profile/") },
  { label: "Formula 1", hint: "The season, standings and results", keywords: "f1 race grand prix motorsport", run: go("/f1/") },
  { label: "Private", hint: "For your eyes only", keywords: "exclusive", minRole: "SuperUser", run: go("/private/") },

  { label: "Admin · Overview", hint: "Queues and service health", keywords: "status services", minRole: "Admin", run: go("/admin/") },
  { label: "Admin · Accounts", hint: "Approve, suspend, change a role", keywords: "users people roles", minRole: "Admin", run: go("/admin/accounts/") },
  { label: "Admin · Messages", hint: "Everything sent through the contact form", keywords: "inbox contact", minRole: "Admin", run: go("/admin/messages/") },
  { label: "Unread messages", hint: "Messages you have not read", keywords: "inbox new", minRole: "Admin", run: go("/admin/messages/?unread=1") },
  { label: "Admin · Invites", hint: "Create an approved account", keywords: "invite new user", minRole: "Admin", run: go("/admin/invites/") },
  { label: "Admin · Analytics", hint: "Traffic to the public site", keywords: "stats visits goatcounter", minRole: "Admin", run: go("/admin/analytics/") },

  {
    label: "Approve the oldest account waiting",
    hint: "Acts immediately", keywords: "pending queue accept", minRole: "Admin",
    run: approveOldest, keepOpen: true,
  },
  {
    label: "Switch theme",
    hint: "Light and dark", keywords: "dark light appearance",
    // Clicks the real control rather than reimplementing it: the toggle also writes `theme-at`,
    // which is what makes the handoff to the public site last-write-wins. Two copies of that
    // handshake is one too many.
    run: () => { close(); (el("theme-toggle") || el("theme-toggle-mobile"))?.click(); },
  },
  { label: "The public site", hint: "tzortzoglou.eu", keywords: "portfolio home www", run: go("https://tzortzoglou.eu/") },
  {
    label: "Sign out",
    hint: "Ends the session everywhere", keywords: "logout leave exit",
    run: () => { close(); document.querySelector("[data-logout]")?.click(); },
  },
];

/** What this account may be offered. An unknown requirement is refused, never assumed. */
function allowed() {
  const rank = RANK.get(me && me.role) ?? 1;
  return COMMANDS.filter((c) => !c.minRole || rank >= (RANK.get(c.minRole) ?? Infinity));
}

/** Is `query` a subsequence of `text`? "amsg" is one of "admin · messages". */
function subsequence(text, query) {
  let at = 0;
  for (const ch of query) {
    at = text.indexOf(ch, at);
    if (at === -1) return false;
    at += 1;
  }
  return true;
}

/**
 * How well an entry answers what was typed. Lower is better; null means it does not.
 *
 * This was plain subsequence matching over the label, hint and keywords joined together, on the
 * reasoning that a short fixed list needs no ranking. It needed ranking immediately: typing
 * "invit" put "Admin · Overview" first, because i-n-v-i-t happens to be a subsequence of it and
 * nothing preferred the entry with the word actually in its name.
 *
 * Subsequence is now the last resort and applies to the LABEL only. Across the joined blob it
 * matched almost everything - "amsg" returned five entries - because the more words an entry
 * carries, the easier it is to find any sequence of letters somewhere inside it.
 */
function score(cmd, query) {
  const label = cmd.label.toLowerCase();
  if (label.startsWith(query)) return 0;
  // The part after "Admin · ", so typing "mess" finds "Admin · Messages" as readily as
  // somebody would expect it to.
  const tail = label.split("\u00b7").pop().trim();
  if (tail.startsWith(query)) return 1;
  if (label.includes(query)) return 2;
  if (`${cmd.hint || ""} ${cmd.keywords || ""}`.toLowerCase().includes(query)) return 3;
  if (subsequence(label, query)) return 4;
  return null;
}

function render() {
  const query = input().value.trim().toLowerCase();
  // Sorted by how well each answers, and by the original order within a band - so equally good
  // matches stay in the order the list is written in rather than shuffling as you type.
  shown = query
    ? allowed()
      .map((c, i) => ({ c, i, s: score(c, query) }))
      .filter((r) => r.s !== null)
      .sort((a, b) => a.s - b.s || a.i - b.i)
      .map((r) => r.c)
    : allowed();
  active = 0;

  const ul = list();
  ul.textContent = "";
  if (!shown.length) {
    const li = document.createElement("li");
    li.className = "px-4 py-6 text-center text-sm text-brand-muted";
    li.textContent = "Nothing matches that.";
    ul.appendChild(li);
    input().removeAttribute("aria-activedescendant");
    return;
  }

  shown.forEach((cmd, i) => {
    const li = document.createElement("li");
    li.id = "pal-" + i;
    li.role = "option";
    li.className = "palette-item";
    li.setAttribute("aria-selected", String(i === active));

    const label = document.createElement("span");
    label.className = "truncate text-brand-text";
    label.textContent = cmd.label;
    const hint = document.createElement("span");
    hint.className = "truncate text-xs text-brand-muted";
    hint.textContent = cmd.hint || "";
    li.append(label, hint);

    // Pointer users get the same list. mousedown rather than click so the input does not lose
    // focus first, which would close the dialog before the choice registered.
    li.addEventListener("mousedown", (e) => { e.preventDefault(); choose(i); });
    li.addEventListener("mousemove", () => setActive(i));
    ul.appendChild(li);
  });
  setActive(0);
}

function setActive(i) {
  const items = list().querySelectorAll("[role=option]");
  if (!items.length) return;
  active = (i + items.length) % items.length;
  items.forEach((item, n) => item.setAttribute("aria-selected", String(n === active)));
  // aria-activedescendant rather than moving focus: focus stays in the text box so typing keeps
  // working, and the screen reader still announces the row that would run.
  input().setAttribute("aria-activedescendant", items[active].id);
  items[active].scrollIntoView({ block: "nearest" });
}

function choose(i) {
  const cmd = shown[i];
  if (!cmd) return;
  if (!cmd.keepOpen) close();
  cmd.run();
}

function open() {
  const d = dialog();
  if (d.open) return;
  input().value = "";
  say("");
  render();
  d.showModal();
  input().focus();
}

function close() {
  const d = dialog();
  if (d.open) d.close();
}

profile.then((who) => {
  me = who;
  const d = dialog();
  if (!d) return;

  el("paletteChord").textContent = CHORD;
  const opener = el("paletteOpen");
  if (opener) opener.addEventListener("click", open);

  addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      // Chrome puts Cmd-K in the address bar and Firefox in its search field; without this the
      // palette would open behind the browser's own thing.
      e.preventDefault();
      d.open ? close() : open();
    }
  });

  input().addEventListener("input", render);
  input().addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(active + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(active - 1); }
    else if (e.key === "Home" && !e.shiftKey) { e.preventDefault(); setActive(0); }
    else if (e.key === "End" && !e.shiftKey) { e.preventDefault(); setActive(shown.length - 1); }
    else if (e.key === "Enter") { e.preventDefault(); choose(active); }
  });

  // Clicking the backdrop closes it. The dialog fills its own box, so a click landing on the
  // <dialog> element itself is a click outside the panel.
  d.addEventListener("mousedown", (e) => { if (e.target === d) close(); });
});
