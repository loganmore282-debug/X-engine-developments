#!/usr/bin/env node
// Push notifications: the signed token request, the Firebase call, who gets what,
// and that the Firebase key is stored safely. No network: fetch is replaced.
'use strict';
const crypto = require('crypto');
const { makeDb, stubDb } = require('./fake-mongo.testlib');
const db = makeDb();
stubDb(db);
const push = require('./push');
const settings = require('./settings');
const admin = require('./admin-data');

let bad = 0;
const ck = (ok, label) => { if (!ok) bad++; console.log((ok ? 'PASS  ' : 'FAIL  ') + label); };

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const account = { project_id: 'shule-test', client_email: 'push@shule-test.iam.gserviceaccount.com', private_key: pem };

function fakeFetch(plan) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const step = plan(url, init, calls.length);
    return { ok: step.ok !== false, status: step.status || 200, json: async () => step.body || {} };
  };
  fn.calls = calls;
  return fn;
}
const goodPlan = (url) => (url.includes('oauth2') ? { body: { access_token: 'tok-1', expires_in: 3600 } } : { body: { name: 'projects/shule-test/messages/1' } });

(async () => {
  console.log('— which group gets it —');
  ck(push.topicFor(null) === 'all' && push.topicFor('') === 'all', 'no class means everyone');
  ck(push.topicFor('Senior 2') === 'class_senior_2' && push.topicFor('Primary 7') === 'class_primary_7', 'a class becomes a topic name like class_senior_2');

  console.log('\n— the signed request to Google —');
  const jwt = push.signJwt(account, 1700000000000);
  const [h, c, sig] = jwt.split('.');
  const header = JSON.parse(Buffer.from(h, 'base64url').toString());
  const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
  ck(header.alg === 'RS256' && claims.iss === account.client_email && claims.scope.includes('firebase.messaging') && claims.exp - claims.iat === 3600, 'it names the account, the Firebase messaging scope and lasts an hour');
  const verifier = crypto.createVerify('RSA-SHA256').update(`${h}.${c}`);
  ck(verifier.verify(publicKey, Buffer.from(sig, 'base64url')), 'its signature verifies with the matching public key');

  console.log('\n— sending —');
  push.clearTokenCache();
  const f1 = fakeFetch(goodPlan);
  const sent = await push.sendPush({ account, title: 'Mock exams start Monday', body: 'Revise the exams.', classLevel: 'Senior 4', announcementId: 'abc123', fetchFn: f1 });
  ck(sent.ok === true && f1.calls.length === 2, 'it asks Google for a token, then sends one message');
  const tokenCall = f1.calls[0];
  ck(tokenCall.url === 'https://oauth2.googleapis.com/token' && String(tokenCall.init.body).includes('jwt-bearer') && String(tokenCall.init.body).includes('assertion='), 'the token request carries the signed assertion');
  const sendCall = f1.calls[1];
  const message = JSON.parse(sendCall.init.body).message;
  ck(sendCall.url === 'https://fcm.googleapis.com/v1/projects/shule-test/messages:send' && sendCall.init.headers.Authorization === 'Bearer tok-1', 'the message goes to the project with the access token');
  ck(message.topic === 'class_senior_4' && message.notification.title === 'Mock exams start Monday' && message.data.announcementId === 'abc123' && message.android.notification.channel_id === 'announcements', 'it targets the class topic, with the title, text and channel');
  const again = await push.sendPush({ account, title: 't', body: 'b', fetchFn: f1 });
  ck(again.ok && f1.calls.length === 3 && JSON.parse(f1.calls[2].init.body).message.topic === 'all', 'a second message reuses the token (no new token request) and goes to everyone');
  const long = fakeFetch(goodPlan); push.clearTokenCache();
  await push.sendPush({ account, title: 'T'.repeat(200), body: 'B'.repeat(500), fetchFn: long });
  const trimmed = JSON.parse(long.calls[1].init.body).message.notification;
  ck(trimmed.title.length === 65 && trimmed.body.length === 178, 'a very long title or text is shortened to what phones show');

  console.log('\n— when it goes wrong —');
  ck((await push.sendPush({ account: null, title: 't', body: 'b' })).skipped === true, 'with no key saved nothing is attempted, and it says why');
  push.clearTokenCache();
  const refused = await push.sendPush({ account, title: 't', body: 'b', fetchFn: fakeFetch((url) => (url.includes('oauth2') ? { ok: false, status: 400, body: { error_description: 'Invalid JWT Signature.' } } : {})) });
  ck(refused.ok === false && /Invalid JWT/.test(refused.message), 'a key Google refuses is reported in plain words');
  push.clearTokenCache();
  const down = await push.sendPush({ account, title: 't', body: 'b', fetchFn: fakeFetch((url) => (url.includes('oauth2') ? goodPlan(url) : { ok: false, status: 404, body: { error: { message: 'Requested entity was not found.' } } })) });
  ck(down.ok === false && /not found/.test(down.message), 'a Firebase error is passed on');
  push.clearTokenCache();
  const broken = await push.sendPush({ account, title: 't', body: 'b', fetchFn: async () => { throw new Error('network down'); } });
  ck(broken.ok === false && /network down/.test(broken.message), 'a network failure never throws');

  console.log('\n— saving the key —');
  const file = JSON.stringify({ type: 'service_account', ...account, private_key_id: 'x', client_id: '1' });
  ck((await settings.saveSettings({ firebaseServiceAccount: 'not json' })).ok === false, 'something that is not JSON is refused');
  ck((await settings.saveSettings({ firebaseServiceAccount: JSON.stringify({ type: 'service_account', project_id: 'x' }) })).ok === false, 'a file with no private key is refused');
  const saved = await settings.saveSettings({ firebaseServiceAccount: file });
  ck(saved.ok, 'the real key file is accepted');
  const stored = (await settings.getSettings()).firebaseServiceAccount;
  ck(stored.project_id === 'shule-test' && stored.private_key.includes('BEGIN PRIVATE KEY') && !('private_key_id' in stored), 'only the three fields needed are kept');
  const view = settings.adminView(await settings.getSettings());
  ck(view.firebaseSet === true && view.firebaseProject === 'shule-test' && !JSON.stringify(view).includes('BEGIN PRIVATE KEY'), 'the panel is told it is connected, never given the key');
  ck(!JSON.stringify(settings.publicConfig(await settings.getSettings())).includes('PRIVATE KEY'), 'the app is never sent it');
  await settings.saveSettings({ supportHours: 'Mon-Fri' });
  ck((await settings.getSettings()).firebaseServiceAccount.project_id === 'shule-test', 'saving other settings leaves it alone');
  await settings.saveSettings({ clearFirebase: true });
  ck(settings.adminView(await settings.getSettings()).firebaseSet === false, 'it can be removed');

  console.log('\n— announcements for one class —');
  await admin.saveAnnouncement({ title: 'Everyone', message: 'hello all', active: true });
  await admin.saveAnnouncement({ title: 'Senior 4 only', message: 'revise', active: true, classLevel: 'Senior 4' });
  ck((await admin.saveAnnouncement({ title: 'x', message: 'y', classLevel: 'Senior 9' })).ok === false, 'a class that does not exist is refused');
  const s4 = (await admin.listActiveAnnouncements('Senior 4')).map((a) => a.title).sort();
  const s2 = (await admin.listActiveAnnouncements('Senior 2')).map((a) => a.title);
  const none = (await admin.listActiveAnnouncements(null)).map((a) => a.title);
  ck(s4.length === 2 && s2.length === 1 && s2[0] === 'Everyone' && none.length === 1, 'a Senior 4 announcement is in Senior 4\'s inbox only; "everyone" is in all of them');

  console.log(bad ? `\n${bad} check(s) FAILED` : '\nall push checks pass');
  process.exit(bad ? 1 : 0);
})();
