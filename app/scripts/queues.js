import { api } from "./shell.js";

/**
 * The two numbers that mean "something is waiting for you".
 *
 * Two pages ask: the Admin overview, which is about them, and the home view, which mentions
 * them in a sentence and on a tile. One definition, because "unread" being counted one way here
 * and another way there is how the same screen comes to disagree with itself.
 *
 * Both throw rather than returning a zero on failure. A zero is an answer - "nothing is
 * waiting" - and a page that cannot reach the API must not be able to say that.
 */

/** How many accounts are waiting to be approved. */
export async function pendingAccounts() {
  const { users } = await api("/admin/users");
  return users.filter((u) => u.status === "pending").length;
}

/**
 * How many unread messages, and whether there are older ones than the page we counted.
 *
 * `more` exists so a caller can say "on the most recent page" instead of implying a total it
 * does not have. A count that silently means "of the ones I happened to look at" reads as a
 * total and is not one.
 */
export async function unreadMessages() {
  const { messages, nextBefore } = await api("/admin/messages");
  return { count: messages.filter((m) => !m.read).length, more: !!nextBefore };
}
