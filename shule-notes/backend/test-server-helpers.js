#!/usr/bin/env node
/**
 * Runs the real server.js helpers against a stub Mongo -- the AI daily quota
 * in particular, since that's the one thing standing between a single
 * enthusiastic student and an unbounded Claude API bill.
 */
'use strict';
process.env.UPLOAD_DIR = require('os').tmpdir() + '/shule-notes-test-uploads-' + Date.now();

let bad = 0;
const ck = (ok, label) => { if (!ok) bad++; console.log((ok ? 'PASS  ' : 'FAIL  ') + label); };

const dbPath = require.resolve('./db');
const store = { aiUsage: [] };
function fakeDb() {
  return {
    collection(name) {
      return {
        findOneAndUpdate: async (q, update, opts) => {
          store[name] = store[name] || [];
          let row = store[name].find((d) => Object.keys(q).every((k) => d[k] === q[k]));
          if (!row) {
            if (!opts || !opts.upsert) return { value: null };
            row = { ...(update.$setOnInsert || {}), count: 0 };
            store[name].push(row);
          }
          if (update.$inc) for (const k of Object.keys(update.$inc)) row[k] = (row[k] || 0) + update.$inc[k];
          return { value: row };
        },
      };
    },
  };
}
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { getDb: fakeDb, connect: async () => {} } };

const server = require('./server.js');

console.log('— publicUser / publicNote never leak internal fields —');
{
  const u = server.publicUser({ _id: 'u1', name: 'Asha', phone: '0700000000', email: null, passwordHash: 'should-never-appear' });
  ck(u.id === 'u1' && u.name === 'Asha' && u.phone === '0700000000', 'the public shape carries what a client needs');
  ck(JSON.stringify(u).indexOf('passwordHash') === -1 && JSON.stringify(u).indexOf('never-appear') === -1,
     'and the password hash is never present in it, even by accident');

  const n = server.publicNote({ _id: 'n1', title: 'Biology Notes', extractedText: 'lots of text', fileName: 'secret-uuid.pdf' });
  ck(n.hasAiContext === true, 'a note with extracted text reports AI is available');
  ck(JSON.stringify(n).indexOf('secret-uuid') === -1, 'the real server-side file NAME is never exposed to the client (only /notes/:id/file serves it)');
  const n2 = server.publicNote({ _id: 'n2', title: 'Scanned Notes', extractedText: '' });
  ck(n2.hasAiContext === false, 'a note with no extracted text (a scan) correctly reports AI is unavailable');
}

console.log('\n— the AI daily quota actually caps spend —');
(async () => {
  const limit = server.AI_DAILY_LIMIT;
  let allowedCount = 0;
  for (let i = 0; i < limit + 5; i++) {
    if (await server.consumeAiQuota('student-1')) allowedCount++;
  }
  ck(allowedCount === limit, `exactly ${limit} of ${limit + 5} requests were allowed (got ${allowedCount})`);
  ck(await server.consumeAiQuota('student-1') === false, 'a further request the same day is still refused');
  ck(await server.consumeAiQuota('student-2') === true, 'but a DIFFERENT student has their own, untouched quota');

  // Tomorrow's key must be a different row, or everyone would be frozen
  // out forever after their first day's limit.
  const row = store.aiUsage.find((r) => r.userId === 'student-1');
  ck(!!row && row.date === server.todayKey(), 'the quota row is keyed on today\'s date, not a fixed id');

  console.log(bad ? `\n${bad} check(s) FAILED` : '\nall server-helper checks pass');
  process.exit(bad ? 1 : 0);
})();
