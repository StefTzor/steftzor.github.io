/**
 * Where the API lives. A module of its own, and that is not tidiness.
 *
 * It used to be exported from shell.js, which is the right home for it right up until something
 * outside the signed-in shell needs it. shell.js runs onAuthStateChanged the moment it is
 * imported and sends anyone without a session to /login/ - so importing it from the action page,
 * which is by definition visited by someone who is not signed in yet, would have bounced every
 * invitation link to the sign-in form before the invitee could set a password.
 *
 * A constant with no side effects can be imported from anywhere. shell.js re-exports it so
 * nothing that already imports it from there has to change.
 */
export const API_BASE = (location.hostname === "localhost" || location.hostname === "127.0.0.1")
  ? "http://localhost:3000"
  : "https://api.tzortzoglou.eu";
