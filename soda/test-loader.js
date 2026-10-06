'use strict';
// Start-up loader: admin-uploaded background + a bouncing "Loading . . ." (no letter animations);
// secondary pages end above the bottom navigation so their last card can be scrolled into view.
const fs = require('node:fs'), assert = require('node:assert/strict');
const built = process.argv.includes('--built');
const html = fs.readFileSync(__dirname + (built ? '/user/index.html' : '/user-src/index.html'), 'utf8');
const server = fs.readFileSync(__dirname + '/server.js', 'utf8');
const admin = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };
ok(/<span class="ld-txt"[^>]*>Loading \. \. \.<\/span>/.test(html), 'the loader says "Loading . . ."');
ok(/#loadingScreen\{[^}]*url\('\/api\/public\/loader-image'\)/.test(html), 'the loader background is the admin picture');
ok(/@keyframes ldBounce\{.*translateY\(-16px\)/.test(html) && /animation:ldBounce/.test(html), 'the word bounces in a small area');
ok((html.match(/ld-txt[^{]*\{[^}]*animation:/g) || []).length === 2, 'one bounce animation (plus its reduced-motion off switch), nothing else');
ok(/\.sr-only\{/.test(html), 'the screen-reader word is hidden');
ok(/body\.sheet-open \.sheet-bg\{bottom:var\(--nav-h\);\}/.test(html), 'secondary pages end above the bottom navigation');
ok(/'profilelogo', 'loaderbg'\]/.test(server) && /app\.get\('\/public\/loader-image'/.test(server), 'server stores and serves the loader picture');
ok(/id="loaderBgFile"/.test(admin) && /wireSodaImageSlot\('loaderbg'/.test(admin), 'admin can upload and remove it');
console.log(`PASS: loader and page bottom (${n} checks${built ? ', built bundle' : ''})`);
