// Gift codes pay cents (647.72), everything else stays whole shillings.
const fs = require('fs'), assert = require('assert');
const server = fs.readFileSync(__dirname + '/server.js', 'utf8'), admin = fs.readFileSync(__dirname + '/admin-src/index.html', 'utf8');
let n = 0; const ok = (c, m) => { assert(c, m); n++; };
const redeem = server.slice(server.indexOf("app.post('/redeem'"), server.indexOf("app.post('/redeem'") + 14000);
ok(!/roundWhole/.test(server), 'the whole-number rounding for gift codes is gone');
ok(/crypto\.randomInt\(Math\.round\(minReward \* 100\), Math\.round\(maxReward \* 100\) \+ 1\) \/ 100/.test(redeem), 'the reward is rolled in whole cents');
ok(/const minReward = round2\(Number\(req\.body\.minReward\)\);/.test(server) && /const maxReward = round2\(Number\(req\.body\.maxReward\)\);/.test(server), 'generate keeps cents');
ok(/id="cMinReward" type="number" step="0\.01"/.test(admin) && /id="cMaxReward" type="number" step="0\.01"/.test(admin), 'admin fields accept cents');
ok(!/Math\.round\(parseFloat\(\$\('cMinReward'\)\.value\|\|0\)\)/.test(admin), 'admin no longer rounds the typed amount to a whole number');
// the roll itself: always inside the range, two decimals at most
const roll = (min, max) => require('crypto').randomInt(Math.round(min * 100), Math.round(max * 100) + 1) / 100;
for (let i = 0; i < 2000; i++) { const r = roll(100.5, 500.75); assert(r >= 100.5 && r <= 500.75 && Math.abs(r * 100 - Math.round(r * 100)) < 1e-9); }
ok(roll(212.36, 212.36) === 212.36, 'a code with min = max pays exactly that amount');
console.log(`PASS: gift code cents (${n + 2000} checks)`);
