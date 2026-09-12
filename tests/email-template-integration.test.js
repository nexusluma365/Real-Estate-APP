const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const welcomeTemplate = fs.readFileSync(path.join(root, 'app/public/rentready-emails/welcome-email.html'), 'utf8');
const guideTemplate = fs.readFileSync(path.join(root, 'app/public/rentready-emails/guide-ready-email.html'), 'utf8');
const appsScript = fs.readFileSync(path.join(root, 'google-apps-script/code.gs'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'cloudflare/download-email-worker/src/worker.js'), 'utf8');

assert.match(welcomeTemplate, /WELCOME TO RENTREADY/);
assert.match(welcomeTemplate, /Your next move starts here\./);
assert.match(welcomeTemplate, /{{GET_STARTED_URL}}/);
assert.doesNotMatch(welcomeTemplate, /{{HERO_IMAGE_URL}}/);
assert.match(welcomeTemplate, /class="cta-cell" align="center"/);
assert.match(welcomeTemplate, /class="cta-table"[\s\S]*?align="center"[\s\S]*?style="margin:0 auto; float:none;"/);
assert.match(welcomeTemplate, /class="cta-link"/);

assert.match(guideTemplate, /Your RentReady Guide is ready\./);
assert.match(guideTemplate, /{{DOWNLOAD_URL}}/);
assert.match(guideTemplate, /{{BOOK_IMAGE_URL}}/);
assert.match(guideTemplate, /class="cta-cell" align="center"/);
assert.match(guideTemplate, /class="cta-wrap"[\s\S]*?align="center"[\s\S]*?style="margin:0 auto;float:none;"/);
assert.match(guideTemplate, /class="cta-link"/);
assert.ok(fs.existsSync(path.join(root, 'app/public/rentready-emails/rentready-guide-book.png')));

assert.match(appsScript, /\/rentready-emails\/welcome-email\.html/);
assert.match(appsScript, /\/rentready-emails\/guide-ready-email\.html/);
assert.match(appsScript, /htmlBody/);

assert.match(worker, /\/rentready-emails\/guide-ready-email\.html/);
assert.match(worker, /\/rentready-emails\/welcome-email\.html/);
assert.match(worker, /\/send-welcome/);
assert.match(worker, /paid10 !== true/);
assert.doesNotMatch(worker, /<p>\$\{greeting\}<\/p>/);

console.log('email template integration test passed');
