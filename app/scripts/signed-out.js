/**
 * The countdown on /signed-out/.
 *
 * It imports nothing. The page is reached by someone who has just signed out, so pulling the
 * Firebase SDK to render it would be both pointless and, if gstatic were blocked, a page that
 * never finishes telling them the sign-out worked.
 *
 * The redirect is a convenience, not a decision made for the visitor: WCAG 2.2.1 requires a
 * time limit to be cancellable, so the countdown is visible, announced, and stoppable - and
 * cancelling is sticky rather than restarting the moment they look away.
 */
const SECONDS = 10;

const countdown = document.getElementById('countdown');
const secs = document.getElementById('secs');
const stay = document.getElementById('stay');
const status = document.getElementById('status');
const leave = document.getElementById('leave');

// No JavaScript, no countdown, and the two links above still work - so the page is never a
// dead end. The controls only appear once something is actually going to happen.
if (countdown && secs && stay && leave) {
  let left = SECONDS;
  countdown.hidden = false;
  stay.hidden = false;
  secs.textContent = String(left);
  // Announced once, when the offer appears. The visible sentence is not a live region: it
  // contains a number that changes every second, and a screen reader would read the whole
  // sentence again on every tick.
  if (status) status.textContent =
    `Returning to tzortzoglou.eu in ${SECONDS} seconds. Select "Stay here" to cancel.`;

  const tick = setInterval(() => {
    left -= 1;
    if (left > 0) {
      secs.textContent = String(left);
      return;
    }
    clearInterval(tick);
    window.location.replace(leave.href);
  }, 1000);

  const cancel = () => {
    clearInterval(tick);
    countdown.hidden = true;
    stay.hidden = true;
    if (status) status.textContent = 'Automatic return cancelled. You can stay on this page.';
  };

  stay.addEventListener('click', cancel);
  // Someone who reaches for a link or the keyboard has shown what they want; do not yank the
  // page out from under them mid-decision.
  document.addEventListener('keydown', cancel, { once: true });
  document.addEventListener('pointerdown', cancel, { once: true });
}
