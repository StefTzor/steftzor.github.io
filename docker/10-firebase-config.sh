#!/bin/sh
# Writes the Firebase web config the app imports, from the environment, at container start.
#
# The nginx image runs everything in /docker-entrypoint.d before starting nginx, so this lands
# before the first request. Generated at run time rather than baked at build time so rotating a
# value is a restart, not a rebuild - and so the image itself carries no project identifiers.
#
# None of this is secret: the Firebase *web* config ships to every browser by design, and access
# is decided by Firestore rules and by the API, not by whether these strings are known. The
# committed copy holds {{PLACEHOLDER}} values purely to keep them out of git.
set -eu

OUT=/usr/share/nginx/html/scripts/firebase-config.js
mkdir -p "$(dirname "$OUT")"

if [ -z "${FIREBASE_API_KEY:-}" ] || [ -z "${FIREBASE_PROJECT_ID:-}" ]; then
  # Fail loudly in the browser console rather than serving an app that half-works: every auth
  # call would otherwise reject with an opaque error and look like a Firebase outage.
  cat > "$OUT" <<'EOF'
console.error("firebase-config: the container was started without FIREBASE_* environment variables.");
throw new Error("Firebase is not configured on this deployment.");
EOF
  echo "firebase-config: MISSING FIREBASE_* env vars - the app will not authenticate" >&2
  exit 0
fi

cat > "$OUT" <<EOF
// Generated at container start by docker/10-firebase-config.sh. Do not edit.
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.3.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.3.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "${FIREBASE_API_KEY}",
  authDomain: "${FIREBASE_AUTH_DOMAIN:-}",
  projectId: "${FIREBASE_PROJECT_ID}",
  storageBucket: "${FIREBASE_STORAGE_BUCKET:-}",
  messagingSenderId: "${FIREBASE_MESSAGING_SENDER_ID:-}",
  appId: "${FIREBASE_APP_ID:-}"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { auth, db };
EOF
echo "firebase-config: written for project ${FIREBASE_PROJECT_ID}"
