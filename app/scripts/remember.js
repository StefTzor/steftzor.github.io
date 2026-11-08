import { api, profile } from "./shell.js";
import { el, say } from "./admin-status.js";

/**
 * What I remember: the notes and conversations the chat holds for you, and the way to remove them.
 *
 * Deleting is immediate and needs no confirmation: the row goes at once and comes back if the
 * server refuses. "Forget everything" alone asks first, because it is the one action that takes
 * everything. There is no undo: the API deletes for real, and a delayed delete would be a row that
 * outlives the press if the page closes. createElement and textContent throughout, because notes
 * are written from what people typed.
 */

const FAILED = "That did not work, and nothing changed. Try again in a minute.";
const REJECTED = "That note can't be kept. Keep it to a short fact about you.";

const button = (text, onClick, kind = "text-brand-accent") => {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `link-action text-sm ${kind}`;
  b.textContent = text;
  b.addEventListener("click", onClick);
  return b;
};

const empty = (text) => {
  const li = document.createElement("li");
  li.className = "py-4 text-sm text-brand-muted";
  li.textContent = text;
  return li;
};

const row = (main, ...actions) => {
  const li = document.createElement("li");
  li.className = "flex items-baseline justify-between gap-4 py-4";
  const side = document.createElement("div");
  side.className = "flex shrink-0 gap-4";
  side.append(...actions);
  li.append(main, side);
  return li;
};

/** Takes a row out now, moves focus somewhere that still exists, and puts it back on failure. */
async function removeRow(li, what, id, doneText) {
  const list = li.parentElement;
  const after = li.nextElementSibling;
  const nextFocus = (after || li.previousElementSibling)?.querySelector("button");
  const heading = el(list.id === "notes" ? "notes-heading" : "conversations-heading");
  (nextFocus || heading).focus();
  li.remove();
  if (!list.children.length) list.append(empty(list.id === "notes" ? NO_NOTES : NO_TALKS));
  try {
    await api("/me/chat/forget", { method: "POST", body: JSON.stringify({ what, id }) });
  } catch (err) {
    if (err.status !== 404) { // a 404 is gone already, which is what was asked for
      if (!list.querySelector("button")) list.replaceChildren();
      list.insertBefore(li, after && after.isConnected ? after : null);
      say(FAILED, "error");
      return;
    }
  }
  say(doneText, "ok");
  if (what === "conversation") refreshNotes();
}

/**
 * A conversation takes its unedited notes with it on the server, so the list has to be asked again.
 * Its own failure, because the delete has already happened and must not read as if it had not. An
 * edit in progress is left alone: repainting would throw away what is being typed.
 */
async function refreshNotes() {
  if (el("notes").querySelector("form")) return;
  try {
    paintNotes((await api("/me/chat/memory")).notes);
  } catch (err) {
    console.error("remember: notes not refreshed", err.status, err.code);
    say("Conversation deleted. Reload to see which notes went with it.", "error");
  }
}

const NO_NOTES = "No notes yet. They are written a while after a conversation ends.";
const NO_TALKS = "No conversations yet.";

function noteRow(note) {
  const text = document.createElement("p");
  text.className = "min-w-0 break-words text-sm text-brand-text";
  text.textContent = note.text;
  const li = row(text,
    button("Edit", () => editNote(li, note)),
    button("Delete", () => removeRow(li, "note", note.id, "Note deleted."), "text-brand-muted"));
  return li;
}

function editNote(li, note) {
  const field = document.createElement("input");
  field.type = "text";
  field.className = "field text-sm";
  field.value = note.text;
  field.setAttribute("aria-label", "Edit note");
  const form = document.createElement("form");
  form.className = "min-w-0 flex-1";
  form.append(field);

  const cancel = () => { const back = noteRow(note); editing.replaceWith(back); back.querySelector("button").focus(); };
  const save = async () => {
    try {
      const saved = await api(`/me/chat/notes/${encodeURIComponent(note.id)}`, {
        method: "POST", body: JSON.stringify({ text: field.value }),
      });
      note.text = saved.text;
      cancel();
      say("Note saved.", "ok");
    } catch (err) {
      if (err.code === "note_rejected") {
        field.setAttribute("aria-invalid", "true");
        say(REJECTED, "error");
      } else say(FAILED, "error");
    }
  };
  form.addEventListener("submit", (e) => { e.preventDefault(); save(); });
  field.addEventListener("input", () => field.removeAttribute("aria-invalid"));
  field.addEventListener("keydown", (e) => { if (e.key === "Escape") cancel(); });

  const editing = row(form, button("Save", save), button("Cancel", cancel, "text-brand-muted"));
  editing.classList.replace("items-baseline", "items-center");
  li.replaceWith(editing);
  field.focus();
}

const shortDate = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};

function conversationRow(c) {
  const main = document.createElement("div");
  main.className = "min-w-0";
  const title = document.createElement("p");
  title.className = "truncate text-sm text-brand-text";
  title.textContent = c.title || "Conversation";
  const date = document.createElement("time");
  date.dateTime = c.lastActive;
  date.className = "text-xs tabular-nums text-brand-muted";
  date.textContent = shortDate(c.lastActive);
  main.append(title, date);
  // The panel is on this page already; a press on its button with an id on it reopens that one.
  const li = row(main,
    button("Open", () => { const b = el("chatOpen"); b.dataset.conversation = c.id; b.click(); }),
    button("Delete", () => removeRow(li, "conversation", c.id, "Conversation deleted."), "text-brand-muted"));
  return li;
}

function paintNotes(notes) {
  el("notes").replaceChildren(...(notes.length ? notes.map(noteRow) : [empty(NO_NOTES)]));
}

function paint({ memory, notes, conversations }) {
  el("memory").checked = memory;
  el("memory").disabled = false;
  paintNotes(notes);
  el("conversations").replaceChildren(...(conversations.length ? conversations.map(conversationRow) : [empty(NO_TALKS)]));
}

el("memory").addEventListener("change", async (e) => {
  const on = e.target.checked;
  try {
    await api("/me/chat/settings", { method: "POST", body: JSON.stringify({ memory: on }) });
    say(on ? "Memory is on." : "Memory is off.", "ok");
  } catch {
    e.target.checked = !on;
    say(FAILED, "error");
  }
});

el("forget").addEventListener("click", () => {
  el("forgetConfirm").classList.remove("hidden");
  el("forgetNo").focus();
});
el("forgetNo").addEventListener("click", () => {
  el("forgetConfirm").classList.add("hidden");
  el("forget").focus();
});
el("forgetYes").addEventListener("click", async () => {
  try {
    await api("/me/chat/forget", { method: "POST", body: JSON.stringify({ what: "everything" }) });
    el("notes").replaceChildren(empty(NO_NOTES));
    el("conversations").replaceChildren(empty(NO_TALKS));
    el("forgetConfirm").classList.add("hidden");
    el("forget").focus();
    say("Everything is forgotten.", "ok");
  } catch {
    say(FAILED, "error");
  }
});

profile.then(async () => {
  try {
    paint(await api("/me/chat/memory"));
  } catch (err) {
    console.error("remember: load failed", err.status, err.code);
    el("notes").replaceChildren();
    el("conversations").replaceChildren();
    say("This could not be loaded. Try again in a minute.", "error");
  }
});
