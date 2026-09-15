#!/usr/bin/env python3
"""Re-break the PesaJet gateway one way at a time and require the tests to
notice.

A passing test proves nothing on its own. This is a money path, so every
assertion in test-pesajet.js is checked by reverting the thing it claims to
protect and requiring a NON-ZERO exit. Judged on the exit code, never on
FAIL-line counts: a harness that crashes prints no FAIL line at all and
counting them reads a crash as a pass.

The first entry is a deliberate NO-OP asserted to be reported MISSED. If that
is ever "caught", the harness is failing for some unrelated reason and every
other CAUGHT in the run is worthless.

Do not run anything else that reads these sources while this runs; it mutates
them in place and restores them in a finally block. Never SIGTERM it -- that
skips the restore.

Run:  python3 verify-pesajet-discriminates.py
"""
import os, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.join(HERE, 'server.js')
DB = os.path.join(HERE, 'db.js')
ADMIN = os.path.join(HERE, 'admin-src', 'index.html')
APP = os.path.join(HERE, 'user-src', 'original_module.js')
TOUCHED = [SERVER, DB, ADMIN, APP]

M = [
    ('CONTROL: a variable nobody reads (must be MISSED)', SERVER,
     'const PESAJET_READ_TIMEOUT = 7000;',
     'const PESAJET_READ_TIMEOUT = 7000; const _unusedControl = 1;'),

    # ── the contract ──
    ('the endpoint path is wrong', SERVER,
     "return _pesajetRequest('/payments', { method: 'POST', body: payload, idempotencyKey });",
     "return _pesajetRequest('/payment', { method: 'POST', body: payload, idempotencyKey });"),

    ('the auth header is wrong', SERVER,
     "const headers = { 'X-API-Key': PESAJET_KEY };",
     "const headers = { 'Authorization': 'Bearer ' + PESAJET_KEY };"),

    ('a payout is sent as a collection -- money the wrong way', SERVER,
     "    type: type === 'DISBURSEMENT' ? 'DISBURSEMENT' : 'COLLECTION',",
     "    type: 'COLLECTION',"),

    ('the phone is sent raw instead of E.164', SERVER,
     '    phoneNumber: pesajetPhone(phone),',
     '    phoneNumber: String(phone || ""),'),

    ('the idempotency key is dropped, so a retry can double-prompt', SERVER,
     "  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;",
     '  /* mutation */'),

    ('an unresolvable network is guessed as MTN rather than omitted', SERVER,
     "  if (/^(70|75|74)\\d{7}$/.test(local)) return 'airtel';\n  return null;",
     "  if (/^(70|75|74)\\d{7}$/.test(local)) return 'airtel';\n  return 'mtn';"),

    # ── the status vocabulary ──
    ('EXPIRED is treated as still in flight, so a dead prompt never resolves', SERVER,
     "  if (s === 'failed' || s === 'expired') return 'failed';",
     "  if (s === 'failed') return 'failed';"),

    ('an unknown status is treated as success', SERVER,
     "  if (s === 'pending' || s === 'processing') return 'processing';\n  return '';",
     "  if (s === 'pending' || s === 'processing') return 'processing';\n  return 'success';"),

    ('an expired prompt is reported as a plain failure', SERVER,
     "  return String(status || '').toLowerCase() === 'expired'",
     "  return false && String(status || '').toLowerCase() === 'expired'"),

    # ── busy is not refused ──
    ('a 5xx is treated as a refusal rather than an outage', SERVER,
     "  const down = resp.status >= 500 || resp.status === 408 || resp.status === 429;",
     '  const down = false;'),

    ('a dropped connection is reported as a clean failure', SERVER,
     "    return { ok: false, providerDown: true, httpStatus: 0, data: { message: e.message } };",
     "    return { ok: false, providerDown: false, httpStatus: 0, data: { message: e.message } };"),

    ('a busy gateway FAILS the deposit instead of leaving it pending', SERVER,
     "        if (!pj.providerDown) await markDepositFailed(depRef, userId, pesajetUserMsg(pj, 'Could not start the payment'));",
     "        await markDepositFailed(depRef, userId, pesajetUserMsg(pj, 'Could not start the payment'));"),

    ('the status re-read gives up after one attempt everywhere', SERVER,
     'async function pesajetGetTx(transactionId, { attempts = 2 } = {}) {',
     'async function pesajetGetTx(transactionId, { attempts = 1 } = {}) {'),

    # ── the webhook ──
    ('a forged signature is reported as unverifiable rather than refused', SERVER,
     "  return { verified: false, reason: 'mismatch' };\n}",
     "  return { verified: false, reason: 'checked' };\n}"),

    # ── the three corrections the live dashboard forced ──
    ('the raw payload is never hashed, only the re-serialised object', SERVER,
     '  if (rawBody && rawBody.length) candidates.push(rawBody);',
     '  /* mutation */'),

    ('the raw body is never captured, so the dashboard digest can never match', SERVER,
     "const keepRawBody = (req, res, buf) => { if (RAW_BODY_ROUTES.has(req.path)) req.rawBody = buf; };",
     'const keepRawBody = (req, res, buf) => {};'),

    ('the webhook is not routed to the raw-body parser', SERVER,
     "const RAW_BODY_ROUTES = new Set(['/pesajet/webhook']);",
     "const RAW_BODY_ROUTES = new Set([]);"),

    ('the 200 is sent only AFTER the re-read, past PesaJet\'s 30-second deadline', SERVER,
     "  res.status(200).json({ received: true });\n  // Everything past here runs after the ack. Nothing may throw out of it.\n  try {",
     "  try {"),

    ('the webhook stops handling payouts, so only deposits ever resolve', SERVER,
     "    const witDoc = await db.collection('withdrawals').doc(reference).get();",
     "    const witDoc = { exists: false };"),

    ('the webhook stops handling deposits', SERVER,
     "    const depQ = await db.collection('pendingDeposits').where('ref', '==', reference).limit(1).get();",
     "    const depQ = { empty: true, docs: [] };"),

    ('the signature field is included in its own digest, so nothing ever verifies', SERVER,
     '  const { signature: _omit, ...clean } = obj;',
     '  const clean = obj;'),

    ('an unconfigured secret reports a mismatch, 401-ing every real webhook', SERVER,
     "  if (!PESAJET_WEBHOOK_SECRET) return { verified: false, reason: 'no-secret' };",
     "  if (!PESAJET_WEBHOOK_SECRET) return { verified: false, reason: 'mismatch' };"),

    ('the webhook credits from its own body instead of re-reading', SERVER,
     "      const t = await pesajetGetTx(dep.pesajetTxId);\n      if (t.providerDown) return;   // unverifiable -- the reconciler and the member's own poll both retry\n      const realStatus = pesajetStatusLabel(t.status);",
     "      const realStatus = pesajetStatusLabel(body.status);"),

    ('the webhook re-reads whatever id the CALLER sent', SERVER,
     '      if (!dep.pesajetTxId) return;\n      const t = await pesajetGetTx(dep.pesajetTxId);',
     '      const t = await pesajetGetTx(String(body.transactionId || ""));'),

    ('a ping event falls through into the money path', SERVER,
     "    if (body.event === 'ping') return;                 // a delivery test",
     '    /* mutation */'),

    # ── the payout ──
    ("a 'sending' payout is auto-declined and refunded by the webhook", SERVER,
     "      if (wit.status === 'sending') return;            // ambiguous -- admin-only resolution, see the note above",
     '      /* mutation */'),

    ('the payout reference is written only AFTER the provider is called', SERVER,
     "      const sendingMarker = withdrawalId;\n      await witRef.update({ status: 'sending', sendingReference: sendingMarker, pesajetRef: sendingMarker, sendingBy: processedBy, sendingAt: FieldValue.serverTimestamp() });\n      const pj = await pesajetDisburse({",
     "      const sendingMarker = withdrawalId;\n      const pj = await pesajetDisburse({"),

    ('an unreachable gateway reverts the payout to pending, inviting a double-pay', SERVER,
     "        return { code: 500, body: { status: 'error', message: 'Lost contact with PesaJet mid-request. We cannot confirm whether this payout was actually sent. It stays on \"Sending\" (not pending) so nobody retries it blindly.', sendingReference: sendingMarker } };",
     "        await witRef.update({ status: 'pending' }).catch(() => {});\n        return { code: 500, body: { status: 'error', message: 'Lost contact with PesaJet.' } };"),

    ('acceptance is treated as completion', SERVER,
     "        await witRef.update({ status: 'processing', processedBy, processedAt: FieldValue.serverTimestamp(), pesajetRef: sendingMarker, pesajetTxId });",
     "        await witRef.update({ status: 'processed', processedBy, processedAt: FieldValue.serverTimestamp(), pesajetRef: sendingMarker, pesajetTxId });"),

    ('Verify no longer recognises a PesaJet payout', SERVER,
     '    if (w.pesajetRef) {', '    if (false && w.pesajetRef) {'),

    # ── the wiring ──
    ('the chokepoint drops pesajet, so the gateway is silently never used', SERVER,
     "  if (v === 'lipapay' || v === 'pesajet' || v === 'manual') return v;",
     "  if (v === 'lipapay' || v === 'manual') return v;"),

    ('PAY A cannot resolve to pesajet', SERVER,
     "  return (p === 'lipapay' || p === 'pesajet') ? p : 'marzpay';",
     "  return p === 'lipapay' ? p : 'marzpay';"),

    ('the settings route refuses to save the choice', SERVER,
     "    if ('depositMethod' in updates && !['marzpay', 'lipapay', 'pesajet'].includes(updates.depositMethod))",
     "    if ('depositMethod' in updates && !['marzpay', 'lipapay'].includes(updates.depositMethod))"),

    ('the webhook is no longer guard-exempt, so every one is refused', SERVER,
     "'/withdraw/lipapay/callback', '/pesajet/webhook',",
     "'/withdraw/lipapay/callback',"),

    ('the deposit reconciler stops sweeping pesajet rows', SERVER,
     "    const pjSnap = await db.collection('pendingDeposits').where('status', 'in', ['pending', 'initiating']).where('provider', '==', 'pesajet').where('pesajetTxId', '>', '').orderBy('createdAt', 'asc').limit(50).get();",
     "    const pjSnap = { docs: [] };"),

    ('the payout reconciler stops sweeping pesajet rows', SERVER,
     "    const pjSnap = await db.collection('withdrawals').where('status', '==', 'processing').where('pesajetTxId', '>', '').orderBy('createdAt', 'asc').limit(50).get();",
     "    const pjSnap = { docs: [] };"),

    ('the payout sweep picks up ambiguous sending rows too', SERVER,
     "    const pjSnap = await db.collection('withdrawals').where('status', '==', 'processing').where('pesajetTxId', '>', '')",
     "    const pjSnap = await db.collection('withdrawals').where('status', '==', 'sending').where('pesajetTxId', '>', '')"),

    # ── the speed fixes ──
    ('a status read goes back to the SDK\'s 30s blanket timeout', SERVER,
     'const PESAJET_READ_TIMEOUT = 7000;',
     'const PESAJET_READ_TIMEOUT = 30000;'),

    ('the status read stops using the short timeout', SERVER,
     "    const r = await _pesajetRequest(`/payments/${encodeURIComponent(transactionId)}`,\n      { timeoutMs: PESAJET_READ_TIMEOUT });",
     "    const r = await _pesajetRequest(`/payments/${encodeURIComponent(transactionId)}`);"),

    ("the member's own poll retries inside the request again", SERVER,
     '      const t = await pesajetGetTx(dep.pesajetTxId, { attempts: 1 });',
     '      const t = await pesajetGetTx(dep.pesajetTxId);'),

    ('the ledger write goes back in front of the redirect', SERVER,
     "    res.json({ status: 'success', depositId: depRef.id, reference: ref, message: 'Payment initiated. Check your phone.' });\n    // The Records row.",
     "    // The Records row."),

    ('the idempotency key is sent only as a header, not in the body', SERVER,
     '  if (idempotencyKey) payload.idempotencyKey = idempotencyKey;',
     '  /* mutation */'),

    ('the poll waits three seconds before its first check again', APP,
     'var DEP_POLL_FIRST_MS = 1200;',
     'var DEP_POLL_FIRST_MS = 3000;'),

    ('faster polling is bought by giving up on the payment sooner', APP,
     'for (let i = 0; i < 24; i++) {',
     'for (let i = 0; i < 8; i++) {'),

    # ── the database ──
    ('the unique index loses its partial filter', DB,
     "    ['withdrawals', { pesajetTxId: 1 }, { unique: true, name: 'pesajetTxId_unique',\n      partialFilterExpression: { pesajetTxId: { $type: 'string' } } }],",
     "    ['withdrawals', { pesajetTxId: 1 }, { unique: true, name: 'pesajetTxId_unique' }],"),

    # ── the admin panel ──
    ("the panel's normalizeProv forgets pesajet", ADMIN,
     "function normalizeProv(v){ return (v==='lipapay'||v==='pesajet'||v==='manual') ? v : 'marzpay'; }",
     "function normalizeProv(v){ return (v==='lipapay'||v==='manual') ? v : 'marzpay'; }"),

    ("MarzPay's radio goes back to \"checked unless lipapay\", selecting two at once", ADMIN,
     "value=\"marzpay\" ${normalizeProv(v('depositMethod','marzpay'))==='marzpay'?'checked':''}",
     "value=\"marzpay\" ${normalizeProv(v('depositMethod','marzpay'))!=='lipapay'?'checked':''}"),

    ('the payout option disappears from the panel', ADMIN,
     'name="witMethod" id="witMethodPesa" value="pesajet"',
     'name="witMethod" id="witMethodPesa" value="lipapay"'),

    # ── what has gone through PesaJet (NOT a balance) ──
    ('the summary calls a made-up PesaJet balance path', SERVER,
     '    const [depSnap, witSnap, sett] = await Promise.all([',
     "    const bal = await _pesajetRequest('/balance');\n"
     '    const [depSnap, witSnap, sett] = await Promise.all([')
    ,
    ('a deposit claimed but never credited counts as money collected', SERVER,
     '      if (depositFullyCredited(row)) { b.collected += amt; b.collectedCount++; }',
     "      if (row.status === 'success' || row.status === 'matched') { b.collected += amt; b.collectedCount++; }"),

    ('a recharge still in flight is counted as collected', SERVER,
     "      else if (row.status === 'pending' || row.status === 'initiating') { b.pendingIn += amt; b.pendingInCount++; }",
     "      else if (row.status === 'pending' || row.status === 'initiating') { b.collected += amt; b.collectedCount++; }"),

    ('a payout still sending is counted as paid out', SERVER,
     "      if (row.status === 'processed') { b.paidOut += amt; b.paidOutCount++; }",
     "      if (row.status === 'processed' || row.status === 'processing') { b.paidOut += amt; b.paidOutCount++; }"),

    ('a payout counts the gross, not what the member received', SERVER,
     '      const amt = finiteMoney(row.net != null ? row.net : row.amount);',
     '      const amt = finiteMoney(row.amount);'),

    ('every country lands in one bucket, mixing currencies', SERVER,
     '      const row = d.data(), key = rowRegionKey(row, userRegions);',
     "      const row = d.data(), key = 'ug';"),

    # Anchored with the line after it: `const want = adminRegionFilter(req);`
    # alone occurs eleven times in server.js, which aborts the run. Checking
    # the anchor COUNT before trusting a mutation is a standing lesson here.
    ('the country switch is ignored', SERVER,
     '    const want = adminRegionFilter(req);\n'
     '    const [depSnap, witSnap, sett] = await Promise.all([',
     '    const want = null;\n'
     '    const [depSnap, witSnap, sett] = await Promise.all(['),

    ('net is computed the wrong way round', SERVER,
     '.map(b => Object.assign(b, { net: round2(b.collected - b.paidOut) }));',
     '.map(b => Object.assign(b, { net: round2(b.paidOut - b.collected) }));'),

    ('a page cut short is reported as complete', SERVER,
     '    const truncated = depSnap.size >= PESAJET_SUMMARY_SCAN || witSnap.size >= PESAJET_SUMMARY_SCAN;',
     '    const truncated = false;'),

    ('the card claims to be in the payment path whether it is or not', SERVER,
     "      selected: depositProvider(sett) === 'pesajet' || withdrawProvider(sett) === 'pesajet',",
     '      selected: true,'),

    ('the reply stops saying this is not their float', SERVER,
     "      note: 'Chipz\\'s own record of money moved through PesaJet. PesaJet publishes no balance endpoint, so this is not the float in their account.',",
     "      note: 'PesaJet balance.',"),

    ("the card presents itself as PesaJet's own float", ADMIN,
     '<p class="muted" style="margin-top:0">PesaJet does not publish a balance endpoint, so this is our own record of what has gone through them &mdash; not the float in their account.</p>',
     '<p class="muted" style="margin-top:0">The real float sitting in PesaJet\'s own account.</p>'),

    ('the card ships visible, cluttering a panel that does not use PesaJet', ADMIN,
     '<div class="panel-card hidden" id="pesajetCard">',
     '<div class="panel-card" id="pesajetCard">'),

    ('a label drifts from the row that translates it', ADMIN,
     '<div class="l">Net through PesaJet</div>',
     '<div class="l">PesaJet net</div>'),
]


def run(cmd, timeout=600):
    try:
        r = subprocess.run(cmd, cwd=HERE, capture_output=True, text=True, timeout=timeout)
        return r.returncode
    except subprocess.TimeoutExpired:
        return 99


def judge():
    """Worst exit code across the harnesses that cover this work."""
    worst = 0
    for cmd in ([shutil.which('node'), 'test-pesajet.js'],
                [shutil.which('node'), 'test-cors-origins.js']):
        worst = max(worst, run(cmd))
    return worst


def main():
    backups = {p: open(p, 'rb').read() for p in TOUCHED}
    caught, missed, control_ok = [], [], None
    try:
        if judge():
            raise SystemExit('ABORT: the unmutated tests already fail')
        print('baseline: tests pass\n')
        for i, (label, path, old, new) in enumerate(M):
            s = open(path, encoding='utf8').read()
            n = s.count(old)
            if n != 1:
                raise SystemExit(f'ABORT: mutation {i} anchor occurs {n} times in '
                                 f'{os.path.basename(path)}: {label}')
            if old == new:
                raise SystemExit(f'ABORT: mutation {i} substitutes a string for itself')
            open(path, 'w', encoding='utf8').write(s.replace(old, new, 1))
            try:
                # A mutation that stops the file PARSING counts as caught: the
                # suite cannot run, which is itself a refusal to ship. Only
                # for .js -- `node --check` on admin-src/index.html always
                # fails, which reported three admin mutations as caught when
                # nothing had been measured at all.
                if path.endswith('.js') and run([shutil.which('node'), '--check', path]):
                    hit, verdict = True, 'CAUGHT (does not parse)'
                else:
                    hit = judge() != 0
                    verdict = 'CAUGHT' if hit else 'MISSED'
            finally:
                open(path, 'wb').write(backups[path])
            (caught if hit else missed).append(label)
            if i == 0:
                control_ok = not hit
            print(f'{verdict:22} {label}')
    finally:
        for p, b in backups.items():
            open(p, 'wb').write(b)

    print(f'\n{len(caught)} caught, {len(missed)} missed')
    if control_ok is False:
        print('THE CONTROL WAS "CAUGHT" -- the harness is failing for some other '
              'reason and every CAUGHT above is worthless.')
    bad = [m for m in missed if m != M[0][0]]
    for m in bad:
        print('  MISSED ' + m)
    return 1 if (bad or control_ok is False) else 0


if __name__ == '__main__':
    sys.exit(main())
