/**
 * What the app build has to contain for the chat. Runs at the end of `npm run build:app`, because
 * `npm test` runs before any build. It needs _app, and a missing page is a failure, not a skip.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', '_app');
const page = (f) => fs.readFileSync(path.join(APP, f), 'utf8');

const home = page('index.html');
assert.ok(home.includes('id="chatPanel"'), 'the app has the panel');
assert.ok(home.includes('import("/scripts/shell.js")'), 'and hands it the signed-in shell');
assert.ok(!page('remember/index.html').includes('only you can see'), 'the page may not claim more than the database does');
assert.ok(!page('login/index.html').includes('chatPanel'), 'the sign-in page has no session to chat with');
console.log('chat-app: signed-in pages have the panel, the sign-in page does not');
