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

  reference.groups.forEach((group) => {
    const h3 = document.createElement("h3");
    h3.className = "font-semibold text-brand-text mt-6 mb-1 first:mt-0";
    h3.textContent = group.name;

    const blurb = document.createElement("p");
    blurb.className = "hint mb-3 max-w-prose";
    blurb.textContent = group.note;

    const card = document.createElement("div");
    card.className = "card";
    group.routes.forEach((r) => card.appendChild(row(r)));

    wrap.append(h3, blurb, card);
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
