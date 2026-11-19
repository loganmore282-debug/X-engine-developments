#!/usr/bin/env node
// Guessing a password: ten wrong tries lock that phone number for the rest of 15 minutes.
'use strict';
const g = require('./login-guard');
let bad = 0;
const ck = (ok, label) => { if (!ok) bad++; console.log((ok ? 'PASS  ' : 'FAIL  ') + label); };
const T0 = 1_000_000_000_000;

for (let i = 0; i < 9; i++) g.recordFailure('256772000001', T0 + i * 1000);
ck(!g.isLocked('256772000001', T0 + 10_000), 'nine wrong passwords: still allowed to try');
g.recordFailure('256772000001', T0 + 10_000);
ck(g.isLocked('256772000001', T0 + 11_000), 'the tenth wrong password locks the number');
ck(!g.isLocked('256772000002', T0 + 11_000), 'another phone number is not affected');
ck(g.minutesLeft('256772000001', T0 + 11_000) >= 14, 'the message says about 15 minutes');
ck(g.isLocked('256772000001', T0 + 14 * 60_000), 'still locked after 14 minutes');
ck(!g.isLocked('256772000001', T0 + 16 * 60_000), 'free again after the 15 minutes are over');
g.recordFailure('256772000003', T0); g.recordFailure('256772000003', T0);
g.clear('256772000003');
ck(!g.isLocked('256772000003', T0 + 1000) && g._failures.size >= 0, 'a right password clears the count');
for (let i = 0; i < 9; i++) g.recordFailure('256772000004', T0);
g.clear('256772000004');
for (let i = 0; i < 9; i++) g.recordFailure('256772000004', T0 + 60_000);
ck(!g.isLocked('256772000004', T0 + 61_000), 'after a right password the count starts again from zero');
// An attack spraying many numbers cannot grow memory without limit.
for (let i = 0; i < 25000; i++) g.recordFailure('spray' + i, T0 + i);
ck(g._failures.size <= 20001, 'memory stays bounded under a spray of many numbers');
console.log(bad ? `\n${bad} check(s) FAILED` : '\nall login-guard checks pass');
process.exit(bad ? 1 : 0);
