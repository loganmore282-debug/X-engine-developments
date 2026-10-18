'use strict';
// While Maintenance mode is on, visitors see an animated maintenance screen (turning gears, a rolling roller, a scanner sweep, a flying bug)
// instead of the app, and the app opens by itself when maintenance ends.
const fs = require('node:fs'), assert = require('node:assert/strict');
const html = fs.readFileSync(__dirname + '/user-src/index.html', 'utf8'), mod = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8'), src = fs.readFileSync(__dirname + '/server.js', 'utf8');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };
const screen = html.slice(html.indexOf('<div id="maintScreen"'), html.indexOf('<!-- ═══════════ AUTH'));
ok(/<svg class="mt-art"/.test(screen) && /id="maintMsg"/.test(screen) && /Under maintenance/.test(screen), 'the screen has the illustration, a title and the admin message');
ok((screen.match(/class="mt-g mt-g\d"/g) || []).length === 3, 'three gears');
ok(/class="mt-roll"/.test(screen) && /<animateTransform attributeName="transform" type="translate"/.test(screen), 'the roller moves along the bar');
ok(/class="mt-scan"/.test(screen) && /class="mt-wrench"/.test(screen) && /class="mt-bug"/.test(screen) && /mt-wing/.test(screen), 'scanner sweep, wrench and bug');
for (const k of ['mtSpin', 'mtScan', 'mtWrench', 'mtBug', 'mtWing']) ok(new RegExp('@keyframes ' + k + '\\{').test(html), 'keyframes ' + k);
ok(!/prefers-reduced-motion[^{]*\{[^}]*mt-/.test(html), 'it plays on every phone');
ok(/#maintScreen\{position:fixed;inset:0;z-index:600;display:none/.test(html), 'it covers everything (above the loader and the opening gate)');
// the gate
ok(/if \(ckMaintenanceOn\(\)\) \{ showMaintenanceScreen\(\); return true; \}/.test(mod), 'a visitor, signed in or not, gets it before login or the app');
ok(/data\.code === 'MAINTENANCE'\) \{ STATE\.settings = /.test(mod) && /showMaintenanceScreen\(data\.message\)/.test(mod), 'a member already inside gets it when the server says MAINTENANCE');
ok(/setInterval\(async \(\) => \{\s*let r; try \{ r = await api\('\/public\/settings'\)/.test(mod) && /!r\.settings\.maintenanceMode\) \{ clearInterval\(_maintTimer\); _maintTimer = null; location\.reload\(\)/.test(mod), 'it looks again every 20 seconds (a real read) and opens the app when maintenance ends');
ok(/\['authScreen', 'app', 'openingGate'\]\.forEach/.test(mod), 'login and the app are hidden behind it');
ok(/code: 'MAINTENANCE'/.test(src) && /maintenanceMsg: s\.maintenanceMode \? maintenanceMsg : ''/.test(src), 'the server blocks money and account routes and publishes the message only while it is on');
console.log(`PASS: maintenance screen (${n} checks)`);
