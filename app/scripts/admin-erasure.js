import { api, profile } from "./shell.js";
import { el, say } from "./admin-status.js";
import { isEmail } from "./email.js";

/**
 * Admin -> Erasure: everything held for one email address, and the one way to remove it.
 *
 * Two steps, never one. Erasure crosses three stores - the contact messages in Postgres, the
 * profile document in Firestore, the sign-in account in Firebase Auth - and none of them can be
 * put back from here. A single button would mean a mistyped address is discovered afterwards.
 *
 * The confirmation asks the administrator to TYPE the address rather than to press yes. The
 * account page's confirmations name their target because naming is enough when the action is a
 * reversible email; this one cannot be undone by anybody, so the check has to be something a
 * hand on autopilot cannot get through. The typed value is compared trimmed and case-insensitively
 * because that is how the API matches the address - a confirmation stricter than the thing it
 * guards would refuse an address that will then be erased anyway.
 *
 * What this screen cannot do is the reason it exists. A contact message is stored AND emailed, so
 * the row can be erased and the copy in the mailbox cannot. Both the preview and the receipt print
 * the API's own sentence about those copies, unedited and never hidden. /docs/ states the rule
 * this follows: a comment may not claim a control the code does not have, and a receipt that said
 * "erased everything" while a copy sat in Gmail would be that failure with a wider audience.
 *
 * createElement and textContent throughout. The address comes from a public contact form and the
 * name on the account was typed at registration; innerHTML anywhere below would turn either into
 * script running in an administrator's session.
 */

/**
 * The address the last successful look-up was about, exactly as the API echoed it back.
 *
 * The erase request sends THIS, not whatever is in the input. Somebody can edit the field after
 * looking up, and erasing an address the operator never saw a preview of is the accident the
 * whole screen is built to prevent.
 */
let target = "";

// Said twice each: once beside a receipt, once without one. They were two near-copies that had
// already drifted ("the messages" against "the stored messages"), so they are one string now.
const PARTLY_DONE = "Partly done. The stored messages were deleted; the account was not fully "
  + "removed. Look the address up again to see what is left, then erase it again: running it "
  + "twice is safe.";
const ACCEPTED_UNSAID = "The erasure was accepted, but the API did not say what it removed. "
  + "Look the address up again to see what is left.";

const plural = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** "a, b and c" - a list read aloud the way a person would say it. */
const listed = (parts) => parts.length < 2
  ? parts.join("")
  : parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];

/** The same comparison the API makes, so the confirmation cannot be stricter than the action. */
const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

const line = (text) => {
  const li = document.createElement("li");
  li.textContent = text;
  return li;
};

// --- what is held -------------------------------------------------------------

/** One date chip per stored message. A full date: these span years, and "14 Sep" would not say which. */
function paintDates(dates) {
  const host = el("heldDates");
  host.textContent = "";
  dates.forEach((iso) => {
    const d = new Date(iso);
    const chip = document.createElement("time");
    chip.dateTime = iso;
    chip.className = "rounded border border-brand-border px-2 py-0.5 text-xs text-brand-muted tabular-nums";
    chip.textContent = Number.isNaN(d.getTime())
      ? iso
      : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
    host.appendChild(chip);
  });
}

/** The account block: the facts that decide whether this is the right person, and nothing more. */
function paintAccount(account) {
  const summary = el("heldAccount");
  const facts = el("heldAccountFacts");
  facts.textContent = "";

  if (!account) {
    // Not an error and not a warning. Most addresses that have written in never registered.
    summary.textContent = "This address has no account. Nothing to erase but the messages above.";
    return;
  }

  const name = [account.firstName, account.lastName].filter(Boolean).join(" ");
  summary.textContent = name
    ? `${name} signs in with this address.`
    : "An account signs in with this address, with no name on it.";

  facts.append(
    line(`Status: ${account.status || "unknown"}`),
    line(`Role: ${account.role || "User"}`),
    line(`Created: ${account.createdAt || "unknown"}`),
    line(`User id: ${account.uid}`));

  if (account.document === false) {
    // The state an interrupted erasure leaves: the sign-in survived and the profile did not. Worth
    // saying in words, because otherwise the preview simply shows blanks where a name should be
    // and reads as a bug in this page rather than as unfinished work on the account.
    const half = line("There is no stored profile for this account: only the sign-in survives. " +
      "That is what an erasure that stopped half-way leaves behind, and running it again finishes it.");
    half.className = "text-amber-700 dark:text-amber-300";
    facts.appendChild(half);
  }
}

/** The out-of-reach copies. `note` is the API's sentence and is printed as it arrived. */
function paintUnreachable(notified, countEl, noteEl) {
  el(countEl).textContent = notified.count
    ? `${plural(notified.count, "email")} about this address left this server.`
    : "No email about this address left this server.";
  // The note belongs to a count above zero: it is a claim about specific copies, and the API
  // stopped sending it when there are none. The fallback exists for the other case - a count that
  // IS above zero arriving without its sentence - because an empty string there would silently
  // drop the one line this feature exists to print, leaving a number with no explanation.
  el(noteEl).textContent = !notified.count ? ""
    : notified.note
      || "Each of these was emailed when it arrived, so a copy is in a mailbox and in the mail "
       + "provider's delivery log. Nothing here reaches either one; they must be deleted by hand.";
}

/** Whether there is anything at all to erase, and what the confirmation should name. */
function willGo(p) {
  const parts = [];
  if (p.messages.count) parts.push(plural(p.messages.count, "message"));
  if (p.account) {
    if (p.account.document) parts.push("the stored profile");
    parts.push("the sign-in account");
  }
  return parts;
}

function paintPreview(p) {
  target = p.email;

  el("heldWho").textContent = p.email;
  el("heldMessages").textContent = p.messages.count
    ? `${plural(p.messages.count, "message")} sent through the contact form.`
    : "No messages from this address.";
  paintDates(p.messages.dates || []);
  paintAccount(p.account);
  paintUnreachable(p.notified, "reachCount", "reachNote");

  const parts = willGo(p);
  el("eraseWhat").textContent = `${listed(parts)} for ${p.email}`;
  // No erase button for an address with nothing behind it. An empty result is a normal answer -
  // offering to delete nothing would invite a press that can only ever fail.
  el("erase").classList.toggle("hidden", parts.length === 0);

  // A second look-up closes any confirmation left open by the first. The typed address in it
  // belongs to the previous target, and a confirm button still enabled from that comparison would
  // now be armed against a different address.
  el("eraseConfirm").classList.add("hidden");
  el("eraseTyped").value = "";
  el("eraseGo").disabled = true;

  el("held").classList.remove("hidden");

  say(parts.length
    ? `Holding ${listed(parts)} for ${p.email}.`
    : `Nothing is held for ${p.email}. There is nothing to erase.`, "ok");
}

// --- step 1: look up ----------------------------------------------------------

el("lookupForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const field = el("target");
  const wanted = field.value.trim();
  const btn = e.target.querySelector('button[type="submit"]');

  // Checked here as well as at the API because this address later becomes part of a Gmail search
  // URL this page builds; isEmail() is the one rule in this repo that answers both "is it an
  // address" and "may it go into a URL", and both answers are needed before it is used.
  if (!isEmail(wanted)) {
    field.setAttribute("aria-invalid", "true");
    field.focus();
    say("That is not an email address this can look up.", "error");
    return;
  }
  field.removeAttribute("aria-invalid");

  btn.disabled = true;
  say("Reading…");
  // The previous erasure's receipt goes before the request, not when this one answers: a
  // receipt still reading "Removed for" the last address, sitting above a failed look-up for a
  // different one, is the same stale-answer trap the catch below guards against.
  el("receipt").classList.add("hidden");
  try {
    paintPreview(await api("/admin/erasure/preview", {
      method: "POST", body: JSON.stringify({ email: wanted }),
    }));
  } catch (err) {
    console.error("erasure: preview failed", err.status, err.code);
    // The panel goes rather than going stale: leaving the previous address's counts on screen
    // under a new address in the field is the one way this page could get somebody erased by
    // mistake.
    el("held").classList.add("hidden");
    target = "";
    say(err.code === "invalid_email" ? "That is not a valid email address."
      : err.status === 403 ? "This account is not allowed to run erasures."
      : "That address could not be looked up.", "error");
  } finally {
    btn.disabled = false;
  }
});

// --- step 2: erase ------------------------------------------------------------

const confirmBox = () => el("eraseConfirm");

el("eraseOpen").addEventListener("click", () => {
  confirmBox().classList.remove("hidden");
  el("eraseTyped").value = "";
  el("eraseGo").disabled = true;
  // Focus goes to the field rather than to the confirm button, unlike the account page: here the
  // button is disabled until the address is typed, and focusing a disabled control would land a
  // keyboard user on nothing.
  el("eraseTyped").focus();
});

el("eraseCancel").addEventListener("click", () => {
  confirmBox().classList.add("hidden");
  el("eraseOpen").focus();
});

// The button is a courtesy - the guard below refuses too. Both, because a disabled button that
// can be re-enabled in devtools is not a control, and an unguarded handler is not either.
el("eraseTyped").addEventListener("input", (e) => {
  el("eraseGo").disabled = !target || !same(e.target.value, target);
});

el("eraseGo").addEventListener("click", async () => {
  const go = el("eraseGo");
  if (!target || !same(el("eraseTyped").value, target)) return;

  go.disabled = true;
  el("eraseCancel").disabled = true;
  say("Erasing…");
  // The request is inside the try; drawing its answer is NOT. They used to share a block, which
  // meant a throw while rendering - a missing element, a shape the API changed - was reported as
  // "Nothing was erased" after the erasure had already happened. That is this feature's own
  // honesty rule inverted, and it is the one failure it must never produce.
  let res;
  try {
    res = await api("/admin/erasure", {
      method: "POST", body: JSON.stringify({ email: target }),
    });
  } catch (err) {
    console.error("erasure: erase failed", err.status, err.code);
    // `partial_erasure` is the one failure that must not be reported as a failure: the contact
    // rows are already gone and only the account steps did not finish, so "nothing was erased"
    // would be the opposite of the truth. The API sends the receipt for the half that DID happen
    // in the error body, so it is drawn exactly like a whole one rather than summarised into a
    // sentence - the receipt is the honest artefact here, and a partial one is still a receipt.
    if (err.code === "partial_erasure" && err.body && err.body.receipt) {
      paintReceipt(err.body.receipt);
      say(PARTLY_DONE, "error");
      go.disabled = false;
      el("eraseCancel").disabled = false;
      return;
    }
    say(err.code === "self_target" ? "An administrator may not erase their own account. Ask another one."
      : err.code === "invalid_email" ? "The API would not accept that address."
      : err.code === "partial_erasure" ? PARTLY_DONE
      : err.status === 403 ? "This account is not allowed to run erasures."
      : "Nothing was erased. The request failed.", "error");
    go.disabled = false;
    el("eraseCancel").disabled = false;
    return;
  }
  el("eraseCancel").disabled = false;
  paintReceipt(res || {});
});

// --- the receipt --------------------------------------------------------------

/**
 * What was actually removed, counted from the erase response alone.
 *
 * Never from the preview. The preview was true when it was read; between then and the press
 * another administrator may have deleted a message, or the account may have been removed from the
 * Firebase console. Reporting the preview's numbers would then hand somebody a receipt for work
 * that did not happen.
 */
function paintReceipt(res) {
  const { erased, notified } = res || {};
  el("receiptWho").textContent = (res && res.email) || target || "";

  const lines = el("receiptLines");
  lines.textContent = "";

  // A 2xx with no receipt in it. The erasure happened - the API would not have answered 2xx
  // otherwise - so this may not read as a failure; but nothing is known about what went, so it
  // may not itemise either. Saying both is the only honest answer, and the look-up is the screen
  // that can settle it.
  if (!erased) {
    lines.append(line(ACCEPTED_UNSAID));
    paintUnreachable(notified || { count: 0 }, "leftCount", "leftNote");
    const s = el("leftSearch");
    s.textContent = "";
    s.classList.add("hidden");
    // The same replacement the itemised path does: the preview describes data that is gone, and
    // it carries a button that would now act on an address already erased.
    el("held").classList.add("hidden");
    el("receipt").classList.remove("hidden");
    target = "";
    el("target").value = "";
    say(ACCEPTED_UNSAID, "error");
    el("receiptWho").scrollIntoView({ block: "center", behavior: "instant" });
    return;
  }

  lines.append(line(erased.messages
    ? `${plural(erased.messages, "contact message")} deleted.`
    : "No contact messages were deleted."));
  lines.append(line(erased.userDocument
    ? "The stored profile was deleted."
    : "There was no stored profile to delete."));
  lines.append(line(erased.authAccount
    ? `The sign-in account was deleted${erased.uid ? ` (${erased.uid})` : ""}.`
    : "There was no sign-in account to delete."));

  paintUnreachable(notified || { count: 0 }, "leftCount", "leftNote");

  const search = el("leftSearch");
  search.textContent = "";
  if (notified && notified.count > 0) {
    // A prefilled search rather than instructions: finishing this is a manual job in a mailbox
    // nothing here can log into, and the smallest way to help is to hand over the query already
    // written. It opens Gmail; it deletes nothing.
    const link = document.createElement("a");
    link.className = "link-action text-brand-accent";
    link.href = "https://mail.google.com/mail/u/0/#search/" + encodeURIComponent(res.email);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = `Open Gmail searching for ${res.email}`;
    search.appendChild(link);
    search.classList.remove("hidden");
  } else {
    search.classList.add("hidden");
  }

  // The preview panel is replaced rather than kept: it describes data that no longer exists, and
  // it carries the erase button, which would now act on an address already erased.
  el("held").classList.add("hidden");
  el("receipt").classList.remove("hidden");
  target = "";
  el("target").value = "";
  say(`Erasure finished for ${res.email}. Read what is still out there below.`, "ok");
  el("receiptWho").scrollIntoView({ block: "center", behavior: "instant" });
}

profile.then(() => {
  say("");
  el("target").focus();
});
