import { api, profile } from "./shell.js";

/**
 * The endpoint list on /docs/.
 *
 * This is the only part of that page that is fetched, and the reason is the page it sits on.
 * app.tzortzoglou.eu is a directory of static files behind a redirect in JavaScript: the redirect
 * decides what is drawn and guards nothing, so every page here is served in full to anyone with
 * the URL. Most of what /docs/ says is fine that way — it is a portfolio describing its own
 * architecture, and the hostnames on it are the three you can read off the address bar.
 *
 * A complete inventory of endpoints with the role each one requires is not fine that way. It is
 * the single most useful thing on the page to somebody who has no account, so it comes from the
 * API, which asks who you are before answering.
 *
 * The list also lives beside the router now rather than in this repository, and the API's suite
 * fails if the two disagree in either direction. A reference nothing can check is a reference
 * that is wrong eventually.
 */

const el = (id) => document.getElementById(id);

function note(text) {
  const box = el("endpointsNote");
  if (box) box.textContent = text || "";
}

function row(r) {
  const div = document.createElement("div");
  div.className = "doc-row";

  const left = document.createElement("span");
  left.className = "flex items-center gap-2";
  const method = document.createElement("span");
  method.className = "doc-method";
  method.textContent = r.method;
  const path = document.createElement("code");
  path.className = "text-sm text-brand-text";
  path.textContent = r.path;
  left.append(method, path);

  const what = document.createElement("span");
  what.className = "text-sm text-brand-muted";
  what.textContent = r.what;

  const role = document.createElement("span");
  role.className = "doc-role";
  role.textContent = r.role;

  div.append(left, what, role);
  return div;
}

function render(reference) {
  const wrap = el("endpoints");
  wrap.textContent = "";

  // Open on a wide screen, closed on a phone. Thirty endpoints in five tables is seven screens
  // of scrolling on a 390px viewport, and nobody arrives here wanting all five at once - they
  // want one. <details> rather than a scripted accordion: the browser already handles the
  // toggle, the keyboard, and announcing the state.
  const roomy = window.matchMedia("(min-width: 640px)");
  const wide = roomy.matches;

  reference.groups.forEach((group) => {
    const box = document.createElement("details");
    box.className = "group mt-4 first:mt-0";
    box.open = wide;

    const head = document.createElement("summary");
    head.className = "flex cursor-pointer select-none items-center gap-2 rounded py-2 " +
      "font-semibold text-brand-text list-none [&::-webkit-details-marker]:hidden " +
      "hover:text-brand-accent focus-visible:outline-none focus-visible:ring-2 " +
      "focus-visible:ring-brand-accent";

    const name = document.createElement("span");
    name.className = "flex-1";
    name.textContent = group.name;
    const count = document.createElement("span");
    count.className = "text-xs font-normal text-brand-muted tabular-nums";
    count.textContent = group.routes.length + (group.routes.length === 1 ? " endpoint" : " endpoints");
    const chevron = document.createElement("span");
    chevron.className = "text-[10px] text-brand-muted transition-transform duration-150 " +
      "group-open:rotate-180";
    chevron.textContent = "▾";
    chevron.setAttribute("aria-hidden", "true");
    head.append(name, count, chevron);

    const blurb = document.createElement("p");
    blurb.className = "hint mb-3 max-w-prose";
    blurb.textContent = group.note;

    const card = document.createElement("div");
    card.className = "card";
    group.routes.forEach((r) => card.appendChild(row(r)));

    // Turning the phone sideways makes room, and the groups should use it. Only for the ones
    // nobody has touched: once you open or close a section by hand, that is your decision and a
    // rotation is not an instruction to undo it.
    //
    // "Touched" is a click on the summary, NOT the `toggle` event. `toggle` also fires when this
    // code sets `open` itself, so listening to it would mark the group as chosen the first time
    // a rotation opened it - the feature would work exactly once and then stop. It is no use
    // guarding with a flag either, because the spec queues `toggle` as a task: the flag would be
    // back to false by the time it ran. A click on the summary is unambiguous, and covers the
    // keyboard too, since Enter and Space on a <summary> dispatch one.
    head.addEventListener("click", () => { box.dataset.chosen = "1"; });
    roomy.addEventListener("change", (e) => {
      if (!box.dataset.chosen) box.open = e.matches;
    });

    box.append(head, blurb, card);
    wrap.appendChild(box);
  });

  const total = reference.groups.reduce((n, g) => n + g.routes.length, 0);
  note(`${total} endpoints, read from the API itself. The list lives beside the router, and the `
    + `API's tests fail if the two ever disagree.`);
}

profile.then(async () => {
  if (!el("endpoints")) return;
  try {
    render(await api("/docs/reference"));
  } catch (err) {
    console.error("docs: reference", err.status, err.code);
    note("The endpoint list could not be loaded.");
  }
});
