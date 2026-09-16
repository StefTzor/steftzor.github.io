/**
 * The private view, moved here from tzortzoglou.eu/exclusive/.
 *
 * Nothing private is in this page's HTML. Everything - the message, the question, the photos -
 * arrives over an authenticated request or not at all, and the API now requires the superuser
 * role rather than mere approval, so an approved account this was not written for is refused
 * by the server and not merely by a hidden nav link.
 *
 * The modal and confetti behaviour used to be an inline script in the page's front matter.
 * It lives here instead: a module can be read, diffed and reasoned about, and the CSP hashes
 * it either way so there was never anything gained by inlining it.
 */
import { auth } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.3.1/firebase-auth.js";

const API = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
  ? 'http://localhost:3000'
  : 'https://api.tzortzoglou.eu';

const $ = (id) => document.getElementById(id);
const objectUrls = [];

async function apiGet(path, token, asBlob) {
  const res = await fetch(API + path, { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) {
    const err = new Error('request failed');
    err.status = res.status;
    try { err.code = (await res.json()).code; } catch (e) { /* non-JSON error body */ }
    throw err;
  }
  return asBlob ? res.blob() : res.json();
}

/** Fetch gated media as a blob so the URL is never a guessable public path. */
async function mediaUrl(name, token) {
  const blob = await apiGet('/exclusive/media/' + encodeURIComponent(name), token, true);
  const url = URL.createObjectURL(blob);
  objectUrls.push(url);
  return url;
}

function showLocked(title, message) {
  const locked = $('authRequired');
  const content = $('exclusiveContent');
  if (content) content.classList.add('hidden');
  if (!locked) return;
  locked.classList.remove('hidden');
  const h = locked.querySelector('h1, h2');
  const p = locked.querySelector('p');
  if (h) h.textContent = title;
  if (p) p.textContent = message;
}

async function render(user) {
  const locked = $('authRequired');
  const content = $('exclusiveContent');
  let token;
  try {
    token = await user.getIdToken();
  } catch (e) {
    return showLocked('Something went wrong', 'Please sign in again.');
  }

  let data;
  try {
    data = await apiGet('/exclusive/content', token);
  } catch (err) {
    if (err.status === 403) {
      // On the app you are already signed in, so a 403 is not "wait for approval" - it is
      // "this is not for you". Saying the former would be a lie that invites a wait.
      return showLocked('For Your Eyes Only', 'This is written for one person, and this account is not it.');
    }
    if (err.status === 401) {
      return showLocked('Authentication Required',
        'Your session has ended. Please log in again.');
    }
    return showLocked('Content unavailable',
      'The content could not be loaded right now. Please try again later.');
  }

  try {
    $('invite-greeting').textContent = data.invite.greeting;
    $('invite-lead').textContent = data.invite.lead;
    $('invite-caption').textContent = data.invite.coverCaption;
    $('openMessageBtn').querySelector('span').textContent = ' ' + data.invite.openLabel;

    $('question-title').textContent = data.question.title;
    const answers = $('question-answers');
    answers.innerHTML = '';
    data.question.answers.forEach((label, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.accept = '';
      b.className = 'w-full py-3 rounded-lg text-white font-bold transition-colors text-lg shadow-md transform hover:scale-105 ' +
        (i === 0 ? 'bg-pink-600 hover:bg-pink-700' : 'bg-rose-500 hover:bg-rose-600');
      b.textContent = label;
      answers.appendChild(b);
    });

    $('celebration-heading').textContent = data.celebration.heading;
    $('celebration-body').textContent = data.celebration.body;
    $('celebration-quote').textContent = '“' + data.celebration.quote + '”';
    $('celebration-signoff').textContent = data.celebration.signoff;

    const [cover, photo] = await Promise.all([
      mediaUrl(data.invite.coverMedia, token),
      mediaUrl(data.celebration.media, token),
    ]);
    $('invite-cover').src = cover;
    $('celebration-photo').src = photo;
    $('celebration-photo').alt = data.celebration.mediaAlt || '';
  } catch (e) {
    console.error('render failed', e);
    return showLocked('Content unavailable', 'The content could not be displayed.');
  }

  if (locked) locked.classList.add('hidden');
  if (content) content.classList.remove('hidden');
  window.dispatchEvent(new CustomEvent('exclusive:ready'));
}

onAuthStateChanged(auth, (user) => {
  // The shell sends signed-out visitors to /login/; this page only has to handle the case
  // where the session ends while it is open.
  if (user) render(user);
  else location.href = '/login/';
});

window.addEventListener('pagehide', () => objectUrls.forEach(URL.revokeObjectURL));

// --- the modal and the celebration ----------------------------------------

const modal = document.getElementById('questionModal');
let lastFocused = null;

function openQuestionModal() {
  lastFocused = document.activeElement;
  modal.classList.remove('hidden');
  // Force a style recalculation before focusing. Removing the class marks the style dirty but
  // does not apply it, so the button is still display:none when focus() runs and the call
  // silently does nothing - leaving the dialog open with focus stranded behind it. Same idiom
  // the celebration reveal below already uses.
  void modal.offsetWidth;
  // Focus the first action so the dialog is usable from the keyboard immediately.
  modal.querySelector('button[data-close-modal]').focus();
}

function closeQuestionModal() {
  modal.classList.add('hidden');
  if (lastFocused) lastFocused.focus();
}

// The answer buttons are created from API data, so bind once the content lands.
function bind() {
  const open = document.getElementById('openMessageBtn');
  if (open && !open.dataset.bound) {
    open.dataset.bound = '1';
    open.addEventListener('click', openQuestionModal);
  }
  modal.querySelectorAll('[data-close-modal]').forEach(el => {
    if (el.dataset.bound) return;
    el.dataset.bound = '1';
    el.addEventListener('click', closeQuestionModal);
  });
  document.querySelectorAll('[data-accept]').forEach(el => {
    if (el.dataset.bound) return;
    el.dataset.bound = '1';
    el.addEventListener('click', acceptValentine);
  });
}
document.addEventListener('DOMContentLoaded', bind);
window.addEventListener('exclusive:ready', bind);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeQuestionModal();
});

function acceptValentine() {
  closeQuestionModal();

  const inviteCard = document.getElementById('inviteCard');
  inviteCard.style.opacity = '0';
  inviteCard.style.transform = 'scale(0.9)';

  setTimeout(() => {
    inviteCard.classList.add('hidden');

    const celebration = document.getElementById('celebrationView');
    celebration.classList.remove('hidden');
    void celebration.offsetWidth;
    celebration.classList.remove('opacity-0');
    celebration.classList.add('opacity-100');
    // Move focus to the revealed content so the change is announced, not silent.
    celebration.querySelector('h2').setAttribute('tabindex', '-1');
    celebration.querySelector('h2').focus();

    launchConfetti();
  }, 500);
}

function launchConfetti() {
  // Respect a reduced-motion preference (WCAG 2.3.3) — skip the animation entirely.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (typeof confetti !== 'function') return;

  var duration = 3 * 1000;
  var animationEnd = Date.now() + duration;
  var defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 0 };

  var random = function (min, max) {
    return Math.random() * (max - min) + min;
  };

  var interval = setInterval(function () {
    var timeLeft = animationEnd - Date.now();

    if (timeLeft <= 0) {
      return clearInterval(interval);
    }

    var particleCount = 50 * (timeLeft / duration);
    confetti(Object.assign({}, defaults, { particleCount, origin: { x: random(0.1, 0.3), y: Math.random() - 0.2 }, colors: ['#ec4899', '#f43f5e'] }));
    confetti(Object.assign({}, defaults, { particleCount, origin: { x: random(0.7, 0.9), y: Math.random() - 0.2 }, colors: ['#ec4899', '#f43f5e'] }));
  }, 250);
}
