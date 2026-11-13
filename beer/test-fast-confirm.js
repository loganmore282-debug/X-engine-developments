'use strict';
// Faster deposit confirmation, without loosening any money rule: a SIGNED PesaJet webhook is acted on at once; every other webhook still asks PesaJet.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const acorn = require('acorn');
const source = fs.readFileSync(__dirname + '/server.js', 'utf8'), tree = acorn.parse(source, { ecmaVersion: 'latest' });
const fn = name => { const n = tree.body.find(x => x.type === 'FunctionDeclaration' && x.id.name === name); assert(n, 'missing ' + name); return source.slice(n.start, n.end); };
const marzHelper = source.slice(source.indexOf('const _MARZ_ENVELOPE_WORDS'), source.indexOf('function _marzExtractBankTransfer'));
function env(dep, extra = {}) {
  const calls = { ask: 0, credit: [], failed: [] };
  const list = Array.isArray(dep) ? dep : [dep];
  const rows = { d1: list[0] };
  const db = { collection: name => ({ where: () => ({ limit: () => ({ get: async () => { const hit = name === 'pendingDeposits' ? list.map((r, i) => ({ id: 'd' + (i + 1), ref: { id: 'd' + (i + 1) }, data: () => r })) : []; return { empty: !hit.length, docs: hit }; } }) }), doc: () => ({ get: async () => ({ exists: false }) }) }) };
  const c = vm.createContext({ db, console: { error() {}, log() {}, warn() {} }, DEPOSIT_FAILED_MSG: 'failed-msg',
    pesajetGetTx: async () => { calls.ask++; return extra.tx || { status: 'completed' }; },
    creditDeposit: async (doc, how) => { calls.credit.push(how + ':' + doc.id); }, markDepositFailed: async (ref, uid, msg) => { calls.failed.push(msg); return true; } });
  vm.runInContext(['pesajetStatusLabel', 'pesajetFailureMsg', 'pesajetWebhookClaim', 'pesajetWebhookWork'].map(fn).join('\n'), c);
  return { c, calls };
}
const live = { provider: 'pesajet', status: 'pending', pesajetTxId: 'tx1', userId: 'u1', amount: 30000 };
(async () => {
  // signed + completed: credited at once, PesaJet is not asked again
  let e = env(live); await e.c.pesajetWebhookWork({ event: 'payment.completed', status: 'COMPLETED', reference: 'R1', transactionId: 'tx1' }, true);
  assert.deepEqual(e.calls.credit, ['PesaJet webhook (signed):d1']); assert.equal(e.calls.ask, 0, 'a signed webhook needs no second trip to PesaJet');
  // the status can also come from the event name or a nested data.status
  e = env(live); await e.c.pesajetWebhookWork({ event: 'payment.completed', reference: 'R1' }, true); assert.equal(e.calls.credit.length, 1);
  e = env(live); await e.c.pesajetWebhookWork({ data: { status: 'COMPLETED' }, reference: 'R1' }, true); assert.equal(e.calls.credit.length, 1);
  // signed + failed / expired: marked failed with the gateway's wording, not credited
  e = env(live); await e.c.pesajetWebhookWork({ status: 'EXPIRED', reference: 'R1' }, true); assert.equal(e.calls.credit.length, 0); assert.match(e.calls.failed[0], /timed out/);
  e = env(live); await e.c.pesajetWebhookWork({ status: 'FAILED', reference: 'R1' }, true); assert.deepEqual(e.calls.failed, ['failed-msg']);
  // NOT signed (or signature unverifiable): the old way -- PesaJet is asked and ITS answer decides
  e = env(live, { tx: { status: 'pending' } }); await e.c.pesajetWebhookWork({ status: 'COMPLETED', reference: 'R1' }, false);
  assert.equal(e.calls.ask, 1); assert.equal(e.calls.credit.length, 0, 'an unsigned "completed" credits nothing while PesaJet says pending');
  e = env(live, { tx: { status: 'completed' } }); await e.c.pesajetWebhookWork({ status: 'COMPLETED', reference: 'R1' }, false);
  assert.deepEqual(e.calls.credit, ['PesaJet webhook:d1']); assert.equal(e.calls.ask, 1);
  // signed but naming a DIFFERENT transaction, or still in flight: ask PesaJet
  e = env(live, { tx: { status: 'pending' } }); await e.c.pesajetWebhookWork({ status: 'COMPLETED', reference: 'R1', transactionId: 'other' }, true);
  assert.equal(e.calls.ask, 1); assert.equal(e.calls.credit.length, 0);
  e = env(live, { tx: { status: 'pending' } }); await e.c.pesajetWebhookWork({ status: 'PROCESSING', reference: 'R1' }, true); assert.equal(e.calls.ask, 1); assert.equal(e.calls.credit.length, 0);
  // a deposit that is already settled, or belongs to another gateway, is left alone
  e = env({ ...live, status: 'matched' }); await e.c.pesajetWebhookWork({ status: 'COMPLETED', reference: 'R1' }, true); assert.equal(e.calls.credit.length, 0);
  e = env({ ...live, provider: 'marzpay' }); await e.c.pesajetWebhookWork({ status: 'COMPLETED', reference: 'R1' }, true); assert.equal(e.calls.credit.length, 0);
  // two rows sharing one reference (a collision): the transaction id picks the right row; with no id the signed shortcut is NOT used and PesaJet is asked
  const twin = { ...live, pesajetTxId: 'tx2' };
  e = env([live, twin], { tx: { status: 'pending' } }); await e.c.pesajetWebhookWork({ status: 'COMPLETED', reference: 'R1' }, true);
  assert.equal(e.calls.ask, 1, 'ambiguous reference, no transaction id: PesaJet is asked'); assert.equal(e.calls.credit.length, 0);
  e = env([live, twin]); await e.c.pesajetWebhookWork({ status: 'COMPLETED', reference: 'R1', transactionId: 'tx2' }, true);
  assert.deepEqual(e.calls.credit, ['PesaJet webhook (signed):d2'], 'the row whose transaction id matches is the one credited'); assert.equal(e.calls.ask, 0);
  // a MarzPay status read with no status of its own is NOT "success" (the API envelope's own "success" only says the call worked)
  { const c = vm.createContext({}); vm.runInContext(marzHelper + fn('_marzExtractTx'), c);
    assert.equal(c._marzExtractTx({ status: 'success', data: { transaction: { uuid: 'u' } } }).status, '', 'no status -> nothing');
    assert.equal(c._marzExtractTx({ status: 'success', data: { transaction: { uuid: 'u', status: null } } }).status, '');
    assert.equal(c._marzExtractTx({ status: 'success', data: { transaction: { status: 'completed' } } }).status, 'completed');
    assert.equal(c._marzExtractTx({ status: 'completed', reference: 'r' }).status, 'completed', 'a flat body keeps its own status');
    assert.equal(c._marzExtractTx({ transaction: { state: 'FAILED' } }).status, 'failed');
    for (const bad of [{ status: 'success', data: null }, { status: 'success' }, { status: 'success', data: {} }, { status: 'success', data: { collection: { uuid: 'u' } } }]) assert.equal(c._marzExtractTx(bad).status, '', 'no status of its own -> nothing: ' + JSON.stringify(bad));
    const c3 = vm.createContext({}); vm.runInContext(marzHelper + fn('_marzExtractBankTransfer'), c3);
    assert.equal(c3._marzExtractBankTransfer({ status: 'success' }).status, '', 'bank transfer: the envelope word is not a status');
    assert.equal(c3._marzExtractBankTransfer({ status: 'success', data: { bank_transfer_request: { status: 'COMPLETED' } } }).status, 'completed');
    assert.equal(c3._marzExtractBankTransfer({ status: 'success', data: { bank_transfer: { status: 'failed' } } }).status, 'failed'); }
  // two requests in the same instant are never handed the same payment reference
  { let k = 0; const c = vm.createContext({ stampRef: () => 'S' + (k++ < 2 ? 'SAME' : 'NEW' + k), crypto: { randomInt: () => 1 }, Date, Map,
      db: { collection: () => ({ where: () => ({ limit: () => ({ get: async () => { await new Promise(r => setTimeout(r, 5)); return { empty: true }; } }) }) }) } });
    vm.runInContext(fn('uniqueRef').replace('async function uniqueRef', 'const _issuedRefs = new Map();\nasync function uniqueRef'), c);
    const [a, b] = await Promise.all([c.uniqueRef('S'), c.uniqueRef('S')]); assert.notEqual(a, b, 'concurrent calls get different references'); }
  // the route hands the verification result on, and the credit path is shortened and wakes the waiting member at once
  assert.ok(/pesajetWebhookWork\(body, check\.verified === true\)/.test(source), 'the route passes check.verified');
  const credit = fn('_creditDepositNow');
  assert.ok(!/const user = await userRef\.get\(\)/.test(credit), 'no unused user read in the credit');
  assert.ok(/Promise\.all\(\[markerP, ledgerP\]\)/.test(credit), 'the marker write and the ledger row run together');
  assert.ok(credit.indexOf('_notifyDeposit(depDoc.id)') > 0 && credit.indexOf('_notifyDeposit(depDoc.id)') < credit.indexOf("needsManualCredit: FieldValue.delete()"), 'the waiting member is woken before the flag is cleared');
  assert.ok(/PESAJET_WATCH_EVERY_MS = 500/.test(source) && /cycleStart/.test(source) && /const snapP = db\.collection\('pendingDeposits'\)\.doc\(depositId\)\.get\(\);\s*const askP = /.test(source), 'the watcher asks every 0.5 s, counted from the start of a check, database and gateway together');
  console.log('PASS: fast deposit confirmation (signed webhook acted on at once; unsigned still re-read; shorter credit path; quicker watcher)');
})().catch(e => { console.error(e); process.exit(1); });
