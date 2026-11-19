#!/usr/bin/env node
// The change counter phones poll: it must move when the admin changes something and stay still when
// the admin only looks.
'use strict';
const { current, bump, adminChangeTracker } = require('./revision');
let bad = 0;
const ck = (ok, label) => { if (!ok) bad++; console.log((ok ? 'PASS  ' : 'FAIL  ') + label); };

// A stand-in for one admin request passing through the middleware.
function request(method, path, statusCode) {
  const finishers = [];
  const res = { statusCode, on: (ev, fn) => { if (ev === 'finish') finishers.push(fn); } };
  adminChangeTracker({ method, path }, res, () => {});
  finishers.forEach((f) => f());
}

const a = current();
const b = bump(); const c = bump();
ck(b > a && c > b, 'every change gives a new, larger number, even twice in the same millisecond');
let before = current();
for (const p of ['/notes/list', '/users/list', '/settings/get', '/stats', '/check-key', '/onboarding/list', '/feedback/list']) request('POST', p, 200);
ck(current() === before, 'looking at the admin panel (lists, stats, settings) changes nothing');
for (const p of ['/notes/update', '/announcements/save', '/subjects/create', '/settings/save', '/notes/upload', '/onboarding/delete']) {
  before = current(); request('POST', p, 200);
  ck(current() > before, `a change through ${p} moves the number`);
}
before = current(); request('POST', '/notes/update', 400); request('POST', '/notes/update', 401); request('POST', '/notes/update', 500);
ck(current() === before, 'a request that failed or was refused changes nothing');
before = current(); request('GET', '/anything', 200);
ck(current() === before, 'a GET never changes it');
console.log(bad ? `\n${bad} check(s) FAILED` : '\nall revision checks pass');
process.exit(bad ? 1 : 0);
