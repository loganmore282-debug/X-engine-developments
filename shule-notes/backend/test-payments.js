#!/usr/bin/env node
/**
 * Runs the real payment code (plans, MarzPay calls, access rules, admin) against an in-memory database and a
 * pretend MarzPay: a student pays, the webhook and the status check race, a fake "paid" webhook is refused,
 * passes stack, and the server really answers 402 for a locked document -- including through the HTTP routes.
 */
'use strict';
process.env.UPLOAD_DIR = require('os').tmpdir() + '/shule-notes-test-pay-' + Date.now();
process.env.ADMIN_KEY = 'test-admin-key-123456';
const { makeDb, stubDb, ObjectId } = require('./fake-mongo.testlib');
const db = makeDb();
stubDb(db);

const fs = require('fs');
const path = require('path');
const pay = require('./payments');
const settingsLib = require('./settings');
const { createSession } = require('./auth');
const { hashPassword } = require('./auth');

let bad = 0;
const ck = (ok, label) => { if (!ok) bad++; console.log((ok ? 'PASS  ' : 'FAIL  ') + label); };
const MIN = 60000;

// A pretend MarzPay: remembers collections and answers status questions the way the test tells it to.
function fakeMarz() {
  const calls = { collect: [], status: [] };
  const state = {}; // uuid -> 'pending' | 'paid' | 'failed'
  let n = 0; let failNext = false;
  return {
    calls, state, failNext: () => { failNext = true; },
    async configured() { return true; },
    async collect(args) { calls.collect.push(args); if (failNext) { failNext = false; return { ok: false, message: 'Insufficient funds' }; } const uuid = 'uuid-' + (++n); state[uuid] = 'pending'; return { ok: true, uuid, message: '' }; },
    async status(uuid) { calls.status.push(uuid); return state[uuid] || ''; },
  };
}

(async () => {
  console.log('— plans and phone numbers —');
  const good = pay.cleanPlans(pay.DEFAULT_PLANS);
  ck(good.ok && good.plans.length === 5, 'the five standard passes are valid');
  ck(!pay.cleanPlans([{ id: 'a', name: 'x', price: 10, minutes: 60 }]).ok, 'a price under 500 is refused');
  ck(!pay.cleanPlans([{ id: 'a', name: 'x', price: 1000, minutes: 60 }, { id: 'a', name: 'y', price: 1000, minutes: 60 }]).ok, 'two passes with the same code are refused');
  ck(!pay.cleanPlans([{ id: 'a', name: 'x', price: 1000, minutes: 60, active: false }]).ok, 'every pass switched off is refused');
  ck(pay.mobileMoneyPhone('0772 123 456').intl === '+256772123456', 'a local MTN number becomes +256…');
  ck(pay.mobileMoneyPhone('+256700123456').ok, 'an Airtel number is accepted');
  ck(!pay.mobileMoneyPhone('0112345678').ok && !pay.mobileMoneyPhone('12345').ok, 'a landline or a short number is refused');
  ck(pay.normalizeStatus('SUCCESSFUL') === 'paid' && pay.normalizeStatus('declined') === 'failed' && pay.normalizeStatus('processing') === 'pending', 'MarzPay statuses are read correctly');
  ck(pay.credentialsFor('user:key') === Buffer.from('user:key').toString('base64'), 'user:key credentials are encoded');

  console.log('— who may read —');
  const now = new Date();
  const open = { paymentsEnabled: false };
  const closed = { paymentsEnabled: true };
  ck(pay.canRead({ settings: open, user: {}, note: {} }), 'payments off: everyone reads');
  ck(!pay.canRead({ settings: closed, user: {}, note: {} }), 'payments on, no pass: locked');
  ck(pay.canRead({ settings: closed, user: {}, note: { free: true } }), 'a free note stays open');
  ck(pay.canRead({ settings: closed, user: { accessUntil: new Date(now.getTime() + MIN) }, note: {} }), 'a pass in the future opens it');
  ck(!pay.canRead({ settings: closed, user: { accessUntil: new Date(now.getTime() - MIN) }, note: {} }), 'an ended pass locks it again');

  console.log('— paying —');
  const mk = async (name, phone) => (await db.collection('users').insertOne({ name, phone, passwordHash: await hashPassword('password1'), createdAt: new Date(), classLevel: 'Senior 2' })).insertedId;
  const aminaId = await mk('Amina Nakato', '0772000001');
  const amina = await db.collection('users').findOne({ _id: aminaId });
  const marz = fakeMarz();
  const cfg = { paymentsEnabled: true, plans: null };

  const off = await pay.startPayment({ settings: { paymentsEnabled: false }, user: amina, planId: '1d', phone: '0772000001', marz });
  ck(!off.ok, 'payments switched off: starting is refused');
  const wrongPlan = await pay.startPayment({ settings: cfg, user: amina, planId: 'nope', phone: '0772000001', marz });
  ck(!wrongPlan.ok, 'an unknown pass is refused');
  const badPhone = await pay.startPayment({ settings: cfg, user: amina, planId: '1d', phone: '12345', marz });
  ck(!badPhone.ok, 'a bad number is refused');
  ck(marz.calls.collect.length === 0, 'nothing was sent to MarzPay for those');

  marz.failNext();
  const declined = await pay.startPayment({ settings: cfg, user: amina, planId: '1d', phone: '0772000001', marz });
  ck(!declined.ok && /funds/.test(declined.message), 'MarzPay refusing the request is reported');
  ck((await db.collection('payments').find({ status: 'failed' }).toArray()).length === 1, 'and the attempt is stored as failed');

  const started = await pay.startPayment({ settings: cfg, user: amina, planId: '1d', phone: '0772 000 001', marz, callbackUrl: 'https://api.example/payments/callback' });
  ck(started.ok && started.payment.amount === 1500 && started.payment.minutes === 1440, 'the PRICE comes from the plan (1,500 for a day), not from the app');
  ck(marz.calls.collect[1].amount === 1500 && marz.calls.collect[1].phone === '+256772000001' && marz.calls.collect[1].callbackUrl, 'MarzPay is asked for 1,500 on +256772000001 with our callback address');
  const again = await pay.startPayment({ settings: cfg, user: amina, planId: '1d', phone: '0772000001', marz });
  ck(again.ok && again.resumed && String(again.payment._id) === String(started.payment._id) && marz.calls.collect.length === 2, 'tapping twice carries on with the same payment (no second prompt)');
  ck(!pay.hasAccess(await db.collection('users').findOne({ _id: aminaId })), 'no access before the money arrives');

  // the student has not approved yet
  await pay.refreshPayment(await db.collection('payments').findOne({ _id: started.payment._id }), marz);
  ck(!pay.hasAccess(await db.collection('users').findOne({ _id: aminaId })), 'still pending: still no access');

  // a forged "success" webhook while MarzPay says pending
  const forged = await pay.handleCallback({ transaction: { reference: started.payment.reference, status: 'successful' } }, marz);
  ck(forged.status === 'pending' && !pay.hasAccess(await db.collection('users').findOne({ _id: aminaId })), 'a webhook that SAYS paid is not trusted when MarzPay says pending');
  ck((await pay.handleCallback({ transaction: { reference: 'no-such-reference', status: 'successful' } }, marz)).handled === false, 'a webhook for an unknown reference is ignored');

  // now the money really arrives; the webhook and the status check land at the same moment
  marz.state[started.payment.marzUuid] = 'paid';
  const fresh = await db.collection('payments').findOne({ _id: started.payment._id });
  await Promise.all([
    pay.handleCallback({ transaction: { reference: started.payment.reference, status: 'successful' } }, marz),
    pay.refreshPayment(fresh, marz),
    pay.refreshPayment(fresh, marz),
    pay.handleCallback({ transaction: { reference: started.payment.reference, status: 'successful' } }, marz),
  ]);
  const afterPay = await db.collection('users').findOne({ _id: aminaId });
  const grantedMs = new Date(afterPay.accessUntil).getTime() - Date.now();
  ck(pay.hasAccess(afterPay), 'after MarzPay confirms: access');
  ck(grantedMs > 1440 * MIN - 5000 && grantedMs <= 1440 * MIN + 1000, 'exactly one day was granted, although four calls raced (no double grant)');
  const paidRow = await db.collection('payments').findOne({ _id: started.payment._id });
  ck(paidRow.status === 'paid' && paidRow.granted === true, 'the payment is stored as paid and granted');

  // paying again stacks on top of what is left
  const second = await pay.startPayment({ settings: cfg, user: afterPay, planId: '1w', phone: '0772000001', marz });
  ck(second.ok && !second.resumed || second.resumed, 'a second payment can start');
  // (the first was already paid, so this is a new row)
  marz.state[second.payment.marzUuid] = 'paid';
  await pay.refreshPayment(await db.collection('payments').findOne({ _id: second.payment._id }), marz);
  const stacked = await db.collection('users').findOne({ _id: aminaId });
  const stackedMs = new Date(stacked.accessUntil).getTime() - Date.now();
  ck(stackedMs > (1440 + 10080) * MIN - 5000, 'a week bought on top of a day: eight days in total');

  // failure
  const brianId = await mk('Brian Okello', '0772000002');
  const brian = await db.collection('users').findOne({ _id: brianId });
  const p3 = await pay.startPayment({ settings: cfg, user: brian, planId: '3h', phone: '0772000002', marz });
  marz.state[p3.payment.marzUuid] = 'failed';
  const failedRow = await pay.refreshPayment(await db.collection('payments').findOne({ _id: p3.payment._id }), marz);
  ck(failedRow.status === 'failed' && !pay.hasAccess(await db.collection('users').findOne({ _id: brianId })), 'a declined payment gives nothing');
  // a payment that was labelled expired but is then approved still counts
  const p4 = await pay.startPayment({ settings: cfg, user: brian, planId: '3h', phone: '0772000002', marz });
  await db.collection('payments').updateOne({ _id: p4.payment._id }, { $set: { createdAt: new Date(Date.now() - 20 * MIN) } });
  const expired = await pay.refreshPayment(await db.collection('payments').findOne({ _id: p4.payment._id }), marz);
  ck(expired.status === 'expired', 'an unapproved prompt is labelled expired after a while');
  marz.state[p4.payment.marzUuid] = 'paid';
  await pay.handleCallback({ transaction: { reference: p4.payment.reference, status: 'successful' } }, marz);
  ck(pay.hasAccess(await db.collection('users').findOne({ _id: brianId })), 'but a late approval still gives access (the money was taken)');

  console.log('— the admin —');
  const cissyId = await mk('Cissy Namuli', '0772000003');
  const g = await pay.adminGrant(cissyId, { planId: '1m' }, { plans: null });
  ck(g.ok && new Date(g.accessUntil).getTime() - Date.now() > 43200 * MIN - 5000, 'the owner can give a student a month');
  ck(pay.hasAccess(await db.collection('users').findOne({ _id: cissyId })), 'and it works');
  const r = await pay.adminRevoke(cissyId);
  ck(r.ok && !pay.hasAccess(await db.collection('users').findOne({ _id: cissyId })), 'taking the access away works');
  ck(!(await pay.adminGrant(cissyId, { minutes: 5 }, {})).ok, 'a grant under 30 minutes is refused');
  const list = await pay.listPayments({});
  ck(list.total >= 5 && list.payments.some((p) => p.student === 'Amina Nakato'), 'the payments list names the students');
  ck((await pay.listPayments({ q: 'Amina' })).payments.every((p) => p.student === 'Amina Nakato'), 'search by name works');
  const sum = await pay.paymentSummary();
  ck(sum.all === 1500 + 5000 + 1000 && sum.paidCount === 3, 'the revenue adds up (1,500 + 5,000 + 1,000); the free grant is not counted as money');
  ck(sum.withAccess === 2, 'students with a live pass are counted');

  console.log('— the settings —');
  ck((await settingsLib.saveSettings({ paymentsEnabled: true })).ok, 'payments can be switched on');
  ck(!(await settingsLib.saveSettings({ marzpayKey: 'has space inside' })).ok, 'a key with spaces is refused');
  ck((await settingsLib.saveSettings({ marzpayKey: 'dGVzdC1tYXJ6cGF5LWtleS0xMjM0NQ==' })).ok, 'a MarzPay key is saved');
  const view = settingsLib.adminView(await settingsLib.getSettings());
  ck(view.marzpayKeySet === true && !('marzpayKey' in view) && view.marzpayKeyHint === '…NQ==', 'the admin sees only that a key is saved and its last 4 characters, never the key');
  ck(Array.isArray(view.plans) && view.plans.length === 5, 'the admin sees the five passes');
  ck((await settingsLib.saveSettings({ plans: [{ id: 'd', name: 'Day', price: 2000, minutes: 1440 }] })).ok, 'the passes can be changed');
  ck(settingsLib.publicConfig(await settingsLib.getSettings()).paymentsEnabled === true, 'the app is told payments are on');
  ck(!('marzpayKey' in settingsLib.publicConfig(await settingsLib.getSettings())), 'the app never sees the key');
  await settingsLib.saveSettings({ plans: pay.DEFAULT_PLANS });

  console.log('— the real routes —');
  const { app } = require('./server');
  const server = app.listen(0);
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = (url, body, token, extra = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...extra }, body: JSON.stringify(body || {}) });
  const get = (url, token) => fetch(base + url, { headers: token ? { Authorization: 'Bearer ' + token } : {} });

  const davidId = await mk('David Mugisha', '0772000004');
  const davidToken = (await createSession(String(davidId))).token || (await createSession(String(davidId)));
  // a real PDF on disk so the file route has something to send
  const { PDFDocument } = require('pdf-lib');
  const doc = await PDFDocument.create(); doc.addPage([300, 300]);
  fs.mkdirSync(path.join(process.env.UPLOAD_DIR, 'notes'), { recursive: true });
  fs.writeFileSync(path.join(process.env.UPLOAD_DIR, 'notes', 'locked.pdf'), Buffer.from(await doc.save()));
  fs.writeFileSync(path.join(process.env.UPLOAD_DIR, 'notes', 'open.pdf'), Buffer.from(await doc.save()));
  const locked = (await db.collection('notes').insertOne({ title: 'Locked note', fileName: 'locked.pdf', active: true, textStatus: 'ready', extractedText: 'text about plants', pageCount: 1, uploadedAt: new Date() })).insertedId;
  const free = (await db.collection('notes').insertOne({ title: 'Free note', fileName: 'open.pdf', active: true, free: true, textStatus: 'ready', extractedText: 'text', pageCount: 1, uploadedAt: new Date() })).insertedId;

  await settingsLib.saveSettings({ paymentsEnabled: false });
  ck((await get(`/notes/${locked}/file`, davidToken)).status === 200, 'payments off: the file opens');
  await settingsLib.saveSettings({ paymentsEnabled: true });
  const r402 = await get(`/notes/${locked}/file`, davidToken);
  ck(r402.status === 402 && (await r402.json()).code === 'payment_required', 'payments on, no pass: the FILE route answers 402');
  ck((await get(`/notes/${locked}/pages`, davidToken)).status === 402, 'the PAGES (search) route answers 402');
  ck((await post('/ai/ask', { noteId: String(locked), question: 'hi' }, davidToken)).status === 402, 'the AI route answers 402 (no AI cost for a locked note)');
  ck((await get(`/notes/${free}/file`, davidToken)).status === 200, 'a note marked free opens without a pass');
  const meta = await (await get('/notes', davidToken)).json();
  ck(meta.notes.find((n) => n.id === String(free)).free === true && meta.notes.find((n) => n.id === String(locked)).free === false, 'the notes list says which notes are free');

  const plans = await (await get('/payments/plans', davidToken)).json();
  ck(plans.plans.length === 5 && plans.plans[1].price === 1500 && plans.hasAccess === false, 'the plans route lists the five passes');
  ck(!('marzpayKey' in plans), 'and shows no secret');
  await settingsLib.saveSettings({ clearMarzpayKey: true });
  const nokey = await post('/payments/start', { planId: '1d', phone: '0772000004' }, davidToken);
  ck(nokey.status === 503, 'with no MarzPay key saved, starting a payment is refused (' + nokey.status + ')');
  ck((await (await get('/payments/plans', davidToken)).json()).enabled === false, 'and the plans route says payments are not open');
  await settingsLib.saveSettings({ marzpayKey: 'dGVzdC1tYXJ6cGF5LWtleS0xMjM0NQ==' });

  // swap in the pretend MarzPay for the server's own client, then pay through the real routes
  const m = fakeMarz();
  const realCollect = require('./server').marz.collect; const realStatus = require('./server').marz.status; const realConfigured = require('./server').marz.configured;
  Object.assign(require('./server').marz, { collect: m.collect, status: m.status, configured: m.configured });
  const startRes = await post('/payments/start', { planId: '1d', phone: '0772 000 004', amount: 1 }, davidToken);
  const started2 = await startRes.json();
  ck(startRes.status === 200 && started2.payment.amount === 1500, 'through the route: the price is 1,500 whatever the app sends');
  const pend = await (await get(`/payments/${started2.payment.id}/status`, davidToken)).json();
  ck(pend.payment.status === 'pending' && pend.user.accessUntil === null, 'status: still waiting');
  const otherId = await mk('Esther Achieng', '0772000005');
  const otherToken = (await createSession(String(otherId))).token || (await createSession(String(otherId)));
  ck((await get(`/payments/${started2.payment.id}/status`, otherToken)).status === 404, "another student cannot read this student's payment");
  m.state[Object.keys(m.state)[0]] = 'paid';
  const done = await (await get(`/payments/${started2.payment.id}/status`, davidToken)).json();
  ck(done.payment.status === 'paid' && !!done.user.accessUntil, 'status: paid, and the student now has an access date');
  ck((await get(`/notes/${locked}/file`, davidToken)).status === 200, 'and the locked file now opens');
  ck((await post('/payments/callback', { transaction: { reference: 'x', status: 'successful' } })).status === 200, 'the webhook answers 200 at once');
  Object.assign(require('./server').marz, { collect: realCollect, status: realStatus, configured: realConfigured });

  console.log('— the admin routes —');
  const adm = { 'x-admin-key': process.env.ADMIN_KEY };
  const noKey = await post('/admin/payments/list', {});
  ck(noKey.status === 401, 'the payments list needs the admin key');
  const adminList = await (await post('/admin/payments/list', {}, null, adm)).json();
  ck(adminList.status === 'success' && adminList.summary && typeof adminList.summary.all === 'number', 'the admin gets the list and the totals');
  const grantRes = await post('/admin/users/grant', { id: String(otherId), planId: '1w' }, null, adm);
  ck(grantRes.status === 200 && pay.hasAccess(await db.collection('users').findOne({ _id: otherId })), 'the admin can grant a week');
  ck((await post('/admin/users/revoke', { id: String(otherId) }, null, adm)).status === 200 && !pay.hasAccess(await db.collection('users').findOne({ _id: otherId })), 'and take it away');
  ck((await post('/admin/notes/update', { id: String(locked), free: true }, null, adm)).status === 200 && (await db.collection('notes').findOne({ _id: locked })).free === true, 'the admin can mark a note free');

  server.close();
  console.log(bad ? `\n${bad} FAILED` : '\nall payment checks passed');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('crashed:', e); process.exit(1); });
