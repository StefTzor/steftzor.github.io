/**
 * Renders the private area by fetching it from api.tzortzoglou.eu.
 *
 * Nothing private is in this page's HTML. The static file served to an anonymous
 * visitor contains only the locked notice — the message, the photos and the
 * question all arrive over an authenticated request, or not at all.
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
      return showLocked('Access Pending',
        'Your account is awaiting approval. Please check back later.');
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
  if (user) render(user);
  else showLocked('Authentication Required', 'You need to be logged in to view this content.');
});

window.addEventListener('pagehide', () => objectUrls.forEach(URL.revokeObjectURL));
