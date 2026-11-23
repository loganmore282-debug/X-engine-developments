#!/usr/bin/env node
/**
 * Runs the real auth.js against a stub Mongo (no real database needed --
 * same discipline this whole account's test suites use: lift the real
 * function, stub the collection calls, run it for real).
 */
'use strict';

let bad = 0;
const ck = (ok, label) => { if (!ok) bad++; console.log((ok ? 'PASS  ' : 'FAIL  ') + label); };

// ── stub ./db before auth.js requires it ──
const dbPath = require.resolve('./db');
const store = { sessions: [] };
function fakeDb() {
  return {
    collection(name) {
      return {
        insertOne: async (doc) => { const d = { ...doc }; store[name] = store[name] || []; store[name].push(d); return { insertedId: 'x' }; },
        findOne: async (q) => (store[name] || []).find((d) => Object.keys(q).every((k) => d[k] === q[k])) || null,
        deleteOne: async (q) => { store[name] = (store[name] || []).filter((d) => !Object.keys(q).every((k) => d[k] === q[k])); },
        find: () => ({ toArray: async () => [] }),
        updateMany: async () => ({}), // (older-session marking is covered by test-single-device.js)
        deleteMany: async () => ({}),
      };
    },
  };
}
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { getDb: fakeDb } };

const auth = require('./auth');

console.log('— hashPassword / verifyPassword —');
const passwordChecks = (async () => {
  const stored = await auth.hashPassword('correct horse battery staple');
  ck(await auth.verifyPassword('correct horse battery staple', stored) === true, 'the right password verifies');
  ck(await auth.verifyPassword('wrong password', stored) === false, 'a wrong password is refused');
  ck(await auth.verifyPassword('', stored) === false, 'an empty password is refused');
  ck(await auth.verifyPassword('correct horse battery staple', 'garbage') === false, 'a malformed stored value fails safely, not throws');
  ck(await auth.verifyPassword('correct horse battery staple', '') === false, 'an empty stored value fails safely');
  ck(await auth.verifyPassword('correct horse battery staple', null) === false, 'a null stored value fails safely');
  const stored2 = await auth.hashPassword('correct horse battery staple');
  ck(stored !== stored2, 'the same password hashes differently each time (a fresh random salt)');
  ck(await auth.verifyPassword('correct horse battery staple', stored2) === true, 'and still verifies correctly');
  // A hash written by the old synchronous code (same settings) must still verify.
  const crypto = require('crypto');
  const legacy = 'aabbccddeeff00112233445566778899:' + crypto.scryptSync('old-password', 'aabbccddeeff00112233445566778899', 64).toString('hex');
  ck(await auth.verifyPassword('old-password', legacy) === true, 'passwords saved before this change still work');
})();

console.log('\n— session lifecycle —');
(async () => {
  await passwordChecks;
  const { token } = await auth.createSession('user-1');
  ck(typeof token === 'string' && token.length === 64, 'a 32-byte random token is issued, as hex (64 chars)');
  ck(await auth.resolveSession(token) === 'user-1', 'the token resolves back to the right user');
  ck(await auth.resolveSession('not-a-real-token') === null, 'a made-up token resolves to nothing');
  ck(await auth.resolveSession('') === null, 'an empty token resolves to nothing, never user-1 by accident');

  // The RAW token must never be stored -- only a hash of it, so a leaked
  // database cannot be used to sign in as anyone.
  const raw = store.sessions.find((s) => s.tokenHash);
  ck(!!raw && raw.tokenHash !== token, 'the stored session carries a HASH of the token, never the token itself');

  await auth.destroySession(token);
  ck(await auth.resolveSession(token) === null, 'after logout, the same token no longer resolves');

  // A session already past its expiry must not resolve, even if present.
  const expired = await auth.createSession('user-2');
  const idx = store.sessions.findIndex((s) => s.userId === 'user-2');
  store.sessions[idx].expiresAt = new Date(Date.now() - 1000);
  ck(await auth.resolveSession(expired.token) === null, 'an expired session token no longer resolves');

  console.log(bad ? `\n${bad} check(s) FAILED` : '\nall auth checks pass');
  process.exit(bad ? 1 : 0);
})();
