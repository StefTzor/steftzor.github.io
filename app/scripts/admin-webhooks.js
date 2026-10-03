import { api, profile } from "./shell.js";
import { el, say } from "./admin-status.js";

/**
 * Admin -> Webhooks: verified GitHub deliveries, each shown three ways - the payload as sent,
 * how it was verified, and the internal record it maps to. Text only, never innerHTML: every
 * string here came from GitHub.
 */

function node(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function when(iso) {
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "";
}

// A field name is shown as it is in the record (mono, as written); a label as a label.
function pairs(host, rows, asFields) {
  host.textContent = "";
  rows.filter(([, v]) => v !== null && v !== undefined && v !== "").forEach(([k, v]) => {
    const div = node("div");
    div.appendChild(node("dt", asFields ? "font-mono text-xs text-brand-muted"
      : "text-xs font-semibold uppercase tracking-wide text-brand-muted", k));
    div.appendChild(node("dd", "break-words font-mono text-xs text-brand-text", String(v)));
    host.appendChild(div);
  });
}

const buttons = new Map();

async function open(id) {
  buttons.forEach((b, k) => b.setAttribute("aria-pressed", k === id ? "true" : "false"));
  el("whRaw").textContent = "Loading…";
  try {
    const d = await api("/admin/webhooks/" + encodeURIComponent(id));
    el("whRaw").textContent = JSON.stringify(d.payload, null, 2);
    pairs(el("whVerify"), [
      ["Algorithm", "HMAC-SHA256 over the raw body"],
      ["Body", d.bytes + " bytes"],
      ["Signature", "matched (constant-time compare)"],
      ["Event", d.event],
      ["Delivery id", d.delivery],
      ["Received", when(d.at)],
    ]);
    pairs(el("whMapped"), Object.entries(d.mapped), true);
  } catch (err) {
    console.error("webhooks: one", err.status, err.code);
    el("whRaw").textContent = "This delivery could not be loaded.";
  }
}

function render(data) {
  el("whConfigured").textContent = data.configured ? "Yes" : "No";
  el("whCount").textContent = String(data.deliveries.length);
  el("whRejected").textContent = String(data.rejectedSinceBoot);
  ["whConfigured", "whCount", "whRejected"].forEach((id) => el(id).removeAttribute("data-loading"));

  const list = el("whList");
  list.textContent = "";
  if (!data.deliveries.length) {
    list.appendChild(node("li", "text-sm text-brand-muted", data.configured
      ? "None yet. GitHub sends a ping when the webhook is added."
      : "No secret is set on the API, so every delivery is refused."));
    return;
  }
  data.deliveries.forEach((d) => {
    const li = node("li");
    const b = node("button", "dm-field min-w-0 flex-col items-start");
    b.type = "button";
    b.setAttribute("aria-pressed", "false");
    const top = node("span", "flex w-full justify-between gap-2");
    top.appendChild(node("span", "font-mono text-xs text-brand-text", d.mapped.kind || d.event));
    top.appendChild(node("span", "text-xs text-brand-muted", when(d.at)));
    b.appendChild(top);
    b.appendChild(node("span", "block w-full truncate text-xs text-brand-muted", (d.repo || "") + " · " + (d.mapped.summary || "")));
    b.addEventListener("click", () => open(d.id));
    buttons.set(d.id, b);
    li.appendChild(b);
    list.appendChild(li);
  });
  open(data.deliveries[0].id);
}

profile.then(async () => {
  say("");
  try {
    render(await api("/admin/webhooks"));
  } catch (err) {
    console.error("webhooks:", err.status, err.code);
    say(err.status === 404
      ? "The webhook inspector needs the API's database, which is not configured."
      : "Webhook deliveries could not be loaded.", "error");
  }
});
