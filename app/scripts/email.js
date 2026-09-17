/**
 * Is this an email address, and may it go into a URL we build?
 *
 * Two questions. There used to be one regex, `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`, copied into six
 * places across this repo and the API's, and it only ever answered the first. The Messages
 * screen turns a stored address into a `mailto:` link, which makes the address a fragment of a
 * URL supplied by whoever typed it into the public contact form - and mailto: has parameters
 * (`bcc`, `to`, `body`, `subject`) that decide who receives a reply and what it says.
 * `a@b.co?bcc=attacker%40evil.com` passed that regex on both sides.
 *
 * SHAPE stays exactly as loose as it was, because refusing a real address is the worse error:
 * on the contact form it means someone could not reach us at all. UNSAFE is the separate,
 * narrow question. `o'brien+tag@sub.example.co.uk` is fine; every known attack string is not.
 *
 * **This file and tzortzoglou-api/src/email.js must agree.** They are the same rule in two
 * repos, and the two disagreeing is its own bug: an address these forms accept and the API
 * refuses is an account that can be registered and can never reset its password.
 */

/** "Shaped like an address." Deliberately loose; see above. */
const SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Characters that carry structure in a URL or in the mailto grammar, and mean nothing in a real
 * address: the header separators `?` `&`, the fragment `#`, percent-encoding `%`, the path
 * separators `/` `\`, the recipient separators `,` `;`, the scheme separator `:`, the
 * address-list syntax `"` `<` `>`, and the C0/DEL control characters.
 */
const UNSAFE = /[?&#%/\\,;:"<>\u0000-\u001f\u007f]/;

/** RFC 5321's maximum address length. */
export const MAX_EMAIL = 254;

/** The one question every caller asks: type, length, shape and URL safety in a single check. */
export function isEmail(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= MAX_EMAIL
    && SHAPE.test(value)
    && !UNSAFE.test(value);
}
