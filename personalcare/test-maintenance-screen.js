'use strict';
// While Maintenance mode is on, visitors see the owner's maintenance screen (light page, a blue refresh mark turning once every 4 seconds, "System Under
// Maintenance", "We are upgrading our system. Please try again in 30 minutes.") instead of the app; the admin sets the minutes; the app opens by itself when
// maintenance ends.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const acorn = require('acorn');
const html = fs.readFileSync(__dirname + '/user-src/index.html', 'utf8'), mod = fs.readFileSync(__dirname + '/user-src/original_module.js', 'utf8'), src = fs.readFileSync(__dirname + '/server.js', 'utf8'), adm = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8');
let n = 0; const ok = (c, m) => { n++; assert.ok(c, m); };
const screen = html.slice(html.indexOf('<div id="maintScreen"'), html.indexOf('<!-- ═══════════ AUTH'));
ok(/<h1 class="mt-title">System Under Maintenance<\/h1>/.test(screen) && /id="maintMsg">We are upgrading our system\. Please try again in 30 minutes\.<\/p>/.test(screen), 'the title and the sentence are the recording\'s');
ok(/<svg class="mt-icon"/.test(screen) && /stroke="#3297d9"/.test(screen) && /<animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="4s" repeatCount="indefinite"\/>/.test(screen), 'the blue mark turns once every 4 seconds');
ok(!/prefers-reduced-motion[^{]*\{[^}]*mt-/.test(html), 'it plays on every phone');
ok(/#maintScreen\{position:fixed;inset:0;z-index:600;display:none[^}]*background:#f4f5fa/.test(html) && /\.mt-title\{[^}]*font-size:26px[^}]*color:#323b47/.test(html) && /\.mt-msg\{[^}]*font-size:15\.43px[^}]*color:#55565b/.test(html), 'the page colour, the title and the sentence are measured from the recording');
ok(!/mt-art|mtSpin|mtScan|mt-bug/.test(html), 'the old illustration is gone');
// the wait, in words
const tree = acorn.parse(mod, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true });
const fnNode = tree.body.find(x => x.type === 'FunctionDeclaration' && x.id.name === 'maintenanceWait');
ok(fnNode, 'maintenanceWait exists');
const wait = vm.runInNewContext(mod.slice(fnNode.start, fnNode.end) + ';maintenanceWait');
for (const [m, t] of [[30, '30 minutes'], [1, '1 minute'], [60, '1 hour'], [90, '1 hour 30 minutes'], [120, '2 hours'], [0, '30 minutes'], [undefined, '30 minutes'], ['45', '45 minutes']]) ok(wait(m) === t, m + ' -> ' + t + ' (got ' + wait(m) + ')');
// the gate
ok(/if \(ckMaintenanceOn\(\)\) \{ showMaintenanceScreen\(\); return true; \}/.test(mod), 'a visitor, signed in or not, gets it before login or the app');
ok(/data\.code === 'MAINTENANCE'\) \{ STATE\.settings = /.test(mod) && /maintenanceMinutes: data\.minutes \|\| 30 \}\); showMaintenanceScreen\(\);/.test(mod), 'a member already inside gets it when the server says MAINTENANCE');
ok(/'We are upgrading our system\. Please try again in ' \+ maintenanceWait\(STATE\.settings && STATE\.settings\.maintenanceMinutes\) \+ '\.'/.test(mod), 'the sentence carries the admin\'s minutes');
ok(/setInterval\(async \(\) => \{\s*let r; try \{ r = await api\('\/public\/settings'\)/.test(mod) && /!r\.settings\.maintenanceMode\) \{ clearInterval\(_maintTimer\); _maintTimer = null; location\.re/.test(mod), 'it looks again every 20 seconds and the app opens by itself');
ok(/\['authScreen', 'app', 'openingGate'\]\.forEach/.test(mod), 'login and the app are hidden behind it');
// server + admin: the duration is a setting with a range
ok(/maintenanceMinutes: 30,/.test(src) && /maintenanceMinutes: \[1, 10080\]/.test(src) && /minutes: Number\(s\.maintenanceMinutes\) \|\| 30/.test(src), 'the server stores 1 to 10080 minutes (default 30) and sends them with MAINTENANCE');
ok(/code: 'MAINTENANCE'/.test(src) && /maintenanceMsg: s\.maintenanceMode \? maintenanceMsg : ''/.test(src), 'the server blocks money and account routes while it is on');
ok(/id="sMaintMin" type="number" min="1" max="10080"/.test(adm) && /maintenanceMinutes:Math\.max\(1,Math\.min\(10080,/.test(adm) && !/sMaintMsg/.test(adm), 'Admin > Settings has the duration box (minutes) and no free-text message');
console.log(`PASS: maintenance screen (${n} checks)`);
