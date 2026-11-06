import { API_BASE } from "./api-base.js";

/**
 * The chat panel, on both properties.
 *
 * The markup is in _includes/chrome/chat.njk, so the panel opens the moment it is pressed and this
 * module arrives behind it. It imports no sign-in code: the app hands in `app` (shell.js) when it
 * mounts this, and the public site hands in nothing. Keeping that one-way is what lets the public
 * build ship this file and still load no Firebase.
 *
 * It is fetch and a reader rather than EventSource, because the requests are POST and the app's
 * carry a token. Every word from the server goes in through textContent. State lives for the
 * page's lifetime and nothing is stored in the browser.
 */

const MAX = 500;
const COUNT_FROM = 400; // the counter stays out of the way until the limit is worth knowing about
const SITE = "https://tzortzoglou.eu";

export const LINES = {
  reading: "Reading the site...",
  busy: "A few people are asking right now. Try again in a minute.",
  resting: "The chat is resting. The rest of the site works as normal.",
  limited: "That's plenty of questions for now.",
  stopped: "Stopped.",
};

// The pages an answer can cite. Anything else the server sent is not shown, so the only links in
// the panel are ones written here. A Map, so "constructor" is not a key.
const SOURCES = new Map([
  ["/about/", { label: "About" }],
  ["/code/", { label: "Code" }],
  ["/docs/", { label: "How this is built", appOnly: true }],
  ["/remember/", { label: "What I remember", appOnly: true }],
  ["/status/", { label: "Status" }],
  ["/f1/", { label: "Formula 1", appOnly: true }],
  ["/sports/", { label: "Sports", appOnly: true }],
  ["/transit/", { label: "Transit", appOnly: true }],
  ["/", { label: "Home page", appOnly: true }], // the app's, where the weather is, not the portfolio's
  ["/profile/", { label: "Your profile", appOnly: true }],
  ["/login/", { label: "Sign in", sameBoth: true }], // the public /login/ redirects to the app's
]);

// --- the stream -----------------------------------------------------------------------------

/** Returns push(text). Events are separated by a blank line and may arrive in any size of piece. */
export function createParser(onEvent) {
  let held = "";
  return (text) => {
    const blocks = (held + text).split(/\r?\n\r?\n/);
    held = blocks.pop();
    for (const block of blocks) {
      for (const line of block.split(/\r?\n/)) {
        if (!line.startsWith("data:")) continue;
        let event;
        try { event = JSON.parse(line.slice(5)); } catch { continue; }
        onEvent(event);
      }
    }
  };
}

export async function readEvents(response, onEvent) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder(); // stream: true keeps a character split across two chunks whole
  const push = createParser(onEvent);
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    push(decoder.decode(value, { stream: true }));
  }
}

// --- one question and its answer ------------------------------------------------------------

export const newTurn = (question) => ({
  question, phase: "reading", position: 0, sentences: [], sources: [], notes: 0, conversation: null,
});

const OPEN = new Set(["reading", "queued", "answering"]);

/** Server events, plus three of ours: `limited` (a 429), `stopped` and `end` (the stream closed). */
export function reduce(turn, event) {
  if (!OPEN.has(turn.phase)) return turn;
  switch (event.type) {
    case "queued": return { ...turn, phase: "queued", position: event.position };
    case "notes": return { ...turn, notes: event.count };
    case "sentence": return { ...turn, phase: "answering", sentences: [...turn.sentences, event.text] };
    case "sources": return { ...turn, sources: event.sources };
    case "conversation": return { ...turn, conversation: event.id };
    case "done": case "busy": case "resting": case "limited": case "stopped":
      return { ...turn, phase: event.type === "done" ? "done" : event.type };
    case "end": return { ...turn, phase: "resting" }; // closed without saying done: it did not finish
    default: return turn;
  }
}

export function stateLine(turn) {
  if (turn.phase === "queued") return `Number ${turn.position} in the queue.`;
  return LINES[turn.phase] || "";
}

/** {label, href}, or null for anything that is not a known page. */
export function sourceView(source, app) {
  const known = SOURCES.get(source);
  if (!known) return null;
  if (known.sameBoth) return { label: known.label, href: source };
  if (known.appOnly) return { label: known.label, href: app ? source : null };
  return { label: known.label, href: app ? SITE + source : source };
}

const make = (tag, className, text = "") => {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
};

const link = (text, href) => {
  const a = make("a", "chat-link", text);
  a.href = href;
  return a;
};

function metaParts(turn, app) {
  const parts = [];
  if (turn.notes) {
    const text = `Using ${turn.notes} note${turn.notes === 1 ? "" : "s"}`;
    parts.push(app ? link(text, "/remember/") : text);
  }
  const sources = (Array.isArray(turn.sources) ? turn.sources : []).map((s) => sourceView(s, app)).filter(Boolean);
  if (sources.length) {
    if (parts.length) parts.push(" · ");
    parts.push(sources.length === 1 ? "Source: " : "Sources: ");
    sources.forEach((s, i) => {
      if (i) parts.push(", ");
      parts.push(s.href ? link(s.label, s.href) : s.label);
    });
  }
  return parts;
}

/**
 * The elements for one turn. paint() only adds what is new: this sits in a live region, so
 * redrawing an earlier sentence would read it out again.
 */
export function turnView(question) {
  const root = make("div", "chat-turn");
  const words = make("p", "chat-words");
  const state = make("p", "chat-state");
  const reply = make("div", "chat-reply");
  const meta = make("p", "chat-meta");
  reply.append(words, state);
  root.append(make("p", "chat-ask", question), reply, meta);

  let shown = 0;
  let metaKey = "";
  return {
    root,
    paint(turn, app) {
      for (; shown < turn.sentences.length; shown += 1) {
        words.append(make("span", "chat-sentence", turn.sentences[shown]), " ");
      }
      state.textContent = stateLine(turn);
      reply.className = "chat-reply" + (OPEN.has(turn.phase) && !shown ? " is-waiting" : "");
      const key = JSON.stringify([turn.notes, turn.sources]);
      if (key !== metaKey) {
        metaKey = key;
        meta.replaceChildren(...metaParts(turn, app));
      }
    },
  };
}

/** Stored messages, oldest first, as finished turns. */
export function turnsFrom(messages) {
  const turns = [];
  for (const m of messages) {
    if (m.role === "user") turns.push({ ...newTurn(m.text), phase: "done" });
    else if (turns.length) turns[turns.length - 1].sentences.push(m.text);
  }
  return turns;
}

// --- the panel ------------------------------------------------------------------------------

/**
 * @param {object} deps
 * @param {HTMLDialogElement} deps.panel
 * @param {HTMLElement} deps.opener  the corner button; data-conversation on it asks to reopen one
 * @param {object} [deps.app]        shell.js in the app; absent on the public site
 */
export function mount({ panel, opener, app }) {
  const log = panel.querySelector("#chatLog");
  const form = panel.querySelector("#chatForm");
  const input = panel.querySelector("#chatInput");
  const send = panel.querySelector("#chatSend");
  const count = panel.querySelector("#chatCount");

  const earlier = []; // public site: the questions so far, because nothing is kept for a visitor
  let conversationId = null; // app: the server holds the history, this names it
  let stopLive = null; // set while an answer is running

  const post = app
    ? (path, init) => app.api(path, { ...init, stream: true })
    : async (path, init) => {
      const res = await fetch(API_BASE + path, { ...init, headers: { "Content-Type": "application/json" } });
      if (!res.ok) throw Object.assign(new Error("chat " + res.status), { status: res.status });
      return res;
    };

  const atEnd = () => log.scrollHeight - log.scrollTop - log.clientHeight < 48;
  const toEnd = () => { log.scrollTop = log.scrollHeight; };

  function refresh() {
    const length = input.value.trim().length;
    const over = length > MAX;
    send.setAttribute("aria-disabled", String(Boolean(!stopLive && (!length || over))));
    input.setAttribute("aria-invalid", String(over));
    count.textContent = over ? `${length} of ${MAX} characters. Shorten it to send.`
      : length >= COUNT_FROM ? `${length} of ${MAX}` : "";
    count.classList.toggle("is-over", over);
  }

  // readOnly and not disabled: a disabled field loses focus, and on a phone that drops the keyboard
  // in the middle of every answer. The one button stays the same element for the same reason.
  function setBusy(busy) {
    input.readOnly = busy;
    send.toggleAttribute("data-busy", busy);
    send.setAttribute("aria-label", busy ? "Stop" : "Send");
    refresh();
  }

  async function ask(question) {
    panel.querySelector("#chatHint")?.remove();
    const view = turnView(question);
    const ctl = new AbortController();
    let turn = newTurn(question);

    const apply = (event) => {
      const follow = atEnd();
      turn = reduce(turn, event);
      view.paint(turn, Boolean(app));
      if (follow) toEnd();
      if (!OPEN.has(turn.phase)) { stopLive = null; setBusy(false); }
    };
    stopLive = () => { apply({ type: "stopped" }); ctl.abort(); };
    setBusy(true);
    log.append(view.root);
    view.paint(turn, Boolean(app));
    toEnd();

    const attempt = async () => {
      try {
        await app?.profile; // a question typed before /me has answered waits for it
        if (ctl.signal.aborted) return;
        const body = app ? { question, conversationId } : { question, earlier: earlier.slice(-2) };
        const res = await post(app ? "/me/chat" : "/chat", {
          method: "POST", body: JSON.stringify(body), signal: ctl.signal,
        });
        await readEvents(res, apply);
        apply({ type: "end" });
      } catch (err) {
        if (ctl.signal.aborted) return;
        // Forgotten or deleted while this page was open: carry on as a new conversation.
        if (err.status === 404 && conversationId) { conversationId = null; await attempt(); return; }
        apply({ type: err.status === 429 ? "limited" : "resting" });
      }
    };
    await attempt();
    if (turn.conversation) conversationId = turn.conversation;
    if (turn.phase === "done") earlier.push(question);
  }

  async function reopen(id) {
    stopLive?.();
    input.readOnly = true; // a question sent now would land in a log about to be replaced
    const wait = make("p", "chat-hint", "Opening the conversation...");
    log.replaceChildren(wait);
    conversationId = null;
    try {
      const found = await app.api(`/me/chat/conversations/${encodeURIComponent(id)}`);
      const views = turnsFrom(found.messages).map((turn) => {
        const view = turnView(turn.question);
        view.paint(turn, true);
        return view.root;
      });
      log.replaceChildren(...views);
      conversationId = found.id;
      toEnd();
    } catch (err) {
      wait.textContent = err.status === 404 ? "That conversation has gone." : LINES.resting;
    } finally {
      input.readOnly = false;
    }
  }

  function open() {
    if ("closing" in panel.dataset) delete panel.dataset.closing; // reverses from where it is
    else if (!panel.open) panel.showModal();
    opener.setAttribute("aria-expanded", "true");
    const id = opener.dataset.conversation;
    delete opener.dataset.conversation;
    if (id && app) reopen(id);
  }

  // The transition runs first, then the real close. Asking the element for its running animations
  // means the timing lives in one place, the stylesheet, and reduced motion needs no case here.
  function close() {
    stopLive?.(); // the answer holds the server's one model slot, and nobody is reading it now
    if (!panel.open || "closing" in panel.dataset) return;
    panel.dataset.closing = "";
    Promise.allSettled(panel.getAnimations().map((a) => a.finished)).then(() => {
      if ("closing" in panel.dataset) panel.close();
    });
  }

  panel.addEventListener("close", () => {
    stopLive?.(); // the browser can force a close without a `cancel`
    delete panel.dataset.closing;
    opener.setAttribute("aria-expanded", "false");
    // The browser puts focus back where it was; Safari never focused a pressed button.
    if (document.activeElement === document.body) opener.focus();
  });
  panel.addEventListener("cancel", (e) => { e.preventDefault(); close(); }); // Escape
  panel.querySelector("#chatCloseForm").addEventListener("submit", (e) => { e.preventDefault(); close(); });
  // A click landing on the dialog itself landed on its backdrop: the card fills the rest of it.
  panel.addEventListener("click", (e) => {
    if (e.target !== panel) return;
    if ("closing" in panel.dataset) open(); else close();
  });
  opener.addEventListener("click", open);

  input.addEventListener("input", refresh);
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    if (!stopLive) form.requestSubmit();
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (stopLive) { stopLive(); return; }
    if (input.readOnly) return; // a conversation is opening
    const question = input.value.trim();
    if (!question || question.length > MAX) return;
    input.value = "";
    ask(question);
  });

  // A phone's keyboard shrinks the visual viewport and nothing else, so a fixed sheet would sit
  // behind it. This lifts the sheet by exactly the part that is covered.
  const seen = window.visualViewport;
  if (seen) {
    const fit = () => panel.style.setProperty("--chat-keyboard",
      `${Math.max(0, window.innerHeight - seen.height - seen.offsetTop)}px`);
    seen.addEventListener("resize", fit);
    seen.addEventListener("scroll", fit);
    fit();
  }

  send.disabled = false;
  refresh();
  if (panel.open) open(); else opener.setAttribute("aria-expanded", "false");
}
