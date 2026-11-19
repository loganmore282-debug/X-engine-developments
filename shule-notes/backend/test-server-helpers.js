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
      const rows = () => (store[name] = store[name] || []);
      const matches = (q) => (d) => Object.keys(q).every((k) => String(d[k]) === String(q[k]));
      return {
        findOne: async (q) => rows().find(matches(q)) || null,
        updateOne: async (q, update) => { const row = rows().find(matches(q)); if (row && update.$set) Object.assign(row, update.$set); },
        deleteOne: async (q) => { const i = rows().findIndex(matches(q)); if (i >= 0) rows().splice(i, 1); },
        deleteMany: async (q) => { store[name] = rows().filter((d) => !matches(q)(d)); },
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
  const u = server.publicUser({ _id: 'u1', name: 'Asha', phone: '0700000000', passwordHash: 'should-never-appear' });
  ck(u.id === 'u1' && u.name === 'Asha' && u.phone === '0700000000', 'the public shape carries what a client needs');
  ck(JSON.stringify(u).indexOf('passwordHash') === -1 && JSON.stringify(u).indexOf('never-appear') === -1,
     'and the password hash is never present in it, even by accident');

  const n = server.publicNote({ _id: 'n1', title: 'Biology Notes', extractedText: 'lots of text', fileName: 'secret-uuid.pdf' });
  ck(n.hasAiContext === true, 'a note with extracted text reports AI is available');
  ck(JSON.stringify(n).indexOf('secret-uuid') === -1, 'the real server-side file NAME is never exposed to the client (only /notes/:id/file serves it)');
  const n2 = server.publicNote({ _id: 'n2', title: 'Scanned Notes', extractedText: '' });
  ck(n2.hasAiContext === false, 'a note with no extracted text (a scan) correctly reports AI is unavailable');
}

console.log('\n— one stored form per phone number —');
{
  const n = server.normalizePhone;
  ck(n('0772123456') === '0772123456', 'a local number is kept as typed');
  ck(n('+256772123456') === '0772123456' && n('256 772 123 456') === '0772123456', 'the same number with a country code matches it');
  ck(n('772123456') === '0772123456', 'so does the number typed without its leading 0');
  ck(n('0772-123 456') === '0772123456', 'spaces and dashes are ignored');
  ck(n('+254712345678') === '0712345678' && n('+255712345678') === '0712345678', 'Kenyan and Tanzanian country codes are handled the same way');
  ck(server.isValidPhone(n('0772123456')) && !server.isValidPhone(n('12345')) && !server.isValidPhone(n('amina@example.com')) && !server.isValidPhone(n('')),
     'a number that is too short, an email address, or nothing at all is refused');
}

console.log('\n— the class list and a student\'s class —');
{
  const { GROUPS, NAMES, isValidLevel } = require('./levels');
  ck(GROUPS.length === 3 && NAMES.length === 13, 'seven primary classes and six senior classes, in three groups');
  ck(isValidLevel('Primary 7') && isValidLevel('Senior 6') && !isValidLevel('Senior 7') && !isValidLevel('Form 3') && !isValidLevel('') && !isValidLevel(null),
     'only a class from the list is valid');
  ck(new Set(NAMES).size === NAMES.length && GROUPS.every((g) => g.levels.every((l) => l.id === l.name && l.short)), 'every class has a unique name and a short label');
  const subjectsOf = (name) => GROUPS.flatMap((g) => g.levels).find((l) => l.name === name).subjects;
  ck(GROUPS.every((g) => g.levels.every((l) => Array.isArray(l.subjects) && l.subjects.length >= 6)), 'every class has its list of subjects');
  ck(subjectsOf('Primary 2').includes('Reading') && !subjectsOf('Primary 2').includes('Science'), 'lower primary reads and counts but has no Science yet');
  ck(['English', 'Mathematics', 'Science', 'Social Studies'].every((x) => subjectsOf('Primary 6').includes(x)), 'upper primary has the four PLE subjects');
  ck(['Biology', 'Chemistry', 'Physics'].every((x) => subjectsOf('Senior 2').includes(x)) && !subjectsOf('Senior 2').includes('Science'), 'O-Level splits Science into Biology, Chemistry and Physics');
  ck(subjectsOf('Senior 5').includes('General Paper') && subjectsOf('Senior 6').includes('Subsidiary Mathematics') && subjectsOf('Senior 5').includes('Subsidiary ICT'), 'A-Level has General Paper and the subsidiaries');
  const { ALL_SUBJECTS } = require('./levels');
  ck(new Set(ALL_SUBJECTS).size === ALL_SUBJECTS.length && ALL_SUBJECTS.every((x) => GROUPS.flatMap((g) => g.levels).some((l) => l.subjects.includes(x))), 'the full list has each subject once and every one belongs to some class');
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

  console.log('\n— saving a student\'s class —');
  {
    const id = '65f0a1b2c3d4e5f6a7b8c9e0';
    store.users = [{ _id: id, name: 'Asha', phone: '0700000000', passwordHash: 'x' }, { _id: '65f0a1b2c3d4e5f6a7b8c9e1', name: 'Brian', passwordHash: 'x' }];
    const bad = await server.setClassLevel(id, 'Senior 9');
    ck(bad.ok === false && bad.status === 400 && !store.users[0].classLevel, 'a class that is not on the list is refused and nothing is saved');
    const good = await server.setClassLevel(id, 'Senior 2');
    ck(good.ok === true && store.users[0].classLevel === 'Senior 2' && good.user.classLevel === 'Senior 2', 'a valid class is saved on the account');
    ck(!store.users[1].classLevel, 'another student\'s account is untouched');
    ck(server.publicUser(store.users[0]).classLevel === 'Senior 2' && server.publicUser(store.users[1]).classLevel === null, 'the class is part of what the app is told about the account');
    const gone = await server.setClassLevel('65f0a1b2c3d4e5f6a7b8c9ff', 'Senior 2');
    ck(gone.ok === false && gone.status === 404, 'an account that does not exist reports 404');
  }

  console.log('\n— deleting an account removes everything about it, and only with the right password —');
  {
    const { hashPassword } = require('./auth');
    const id = '65f0a1b2c3d4e5f6a7b8c9d0';
    const other = '65f0a1b2c3d4e5f6a7b8c9d1';
    store.users = [
      { _id: id, name: 'Asha', passwordHash: hashPassword('right-password') },
      { _id: other, name: 'Brian', passwordHash: hashPassword('another-password') },
    ];
    store.sessions = [{ userId: id, tokenHash: 'a' }, { userId: id, tokenHash: 'b' }, { userId: other, tokenHash: 'c' }];
    store.aiUsage.push({ userId: id, date: '2026-01-01', count: 3 }, { userId: other, date: '2026-01-01', count: 1 });

    const wrong = await server.deleteAccount(id, 'wrong-password');
    ck(wrong.ok === false && wrong.status === 403, 'a wrong password is refused with 403 (401 would sign the app out)');
    ck(store.users.length === 2 && store.sessions.length === 3, 'and nothing is deleted');

    const right = await server.deleteAccount(id, 'right-password');
    ck(right.ok === true, 'the right password deletes the account');
    ck(!store.users.some((u) => u._id === id), 'the user record is gone');
    ck(!store.sessions.some((r) => r.userId === id), 'every sign-in session is gone');
    ck(!store.aiUsage.some((r) => r.userId === id), 'the AI usage records are gone');
    ck(store.users.some((u) => u._id === other) && store.sessions.some((r) => r.userId === other) && store.aiUsage.some((r) => r.userId === other),
       'another member\'s data is untouched');

    const again = await server.deleteAccount(id, 'right-password');
    ck(again.ok === false && again.status === 404, 'deleting an account that no longer exists reports 404');
  }

  console.log(bad ? `\n${bad} check(s) FAILED` : '\nall server-helper checks pass');
  process.exit(bad ? 1 : 0);
})();
