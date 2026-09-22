#!/usr/bin/env python3
"""Re-break the "recent rejected deposit attempts" diagnostic (Round 184),
one way at a time.

Judged on the EXIT CODE, never on FAIL-line counts -- a mutation that crashes
the harness prints no FAIL line, and counting lines reads that as a pass.

Opens with a deliberate NO-OP asserted MISSED. If the control is ever CAUGHT,
the run is failing for a reason unrelated to the mutation and every other
CAUGHT in it means nothing.
"""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SERVER = HERE / 'server.js'
ADMIN = HERE / 'admin-src' / 'index.html'

# (label, target, old, new, expect_caught)
MUTATIONS = [
    ('CONTROL: a declared-and-unused constant (must be MISSED)', SERVER,
     'function recordDepositRejection(userId, route, region, body, reason) {',
     'const _unusedControl = 0;\nfunction recordDepositRejection(userId, route, region, body, reason) {',
     False),

    ('the write goes into pendingDeposits instead of its own collection, polluting the real money list', SERVER,
     "db.collection('depositAttempts').add({",
     "db.collection('pendingDeposits').add({",
     True),

    ('the raw body is no longer stored, so there is nothing left to diagnose from', SERVER,
     "body: JSON.stringify(body || {}).slice(0, 2000),",
     "body: '',",
     True),

    ('the body is stored unbounded, so a huge or malicious payload is written straight to Mongo', SERVER,
     "body: JSON.stringify(body || {}).slice(0, 2000),",
     "body: JSON.stringify(body || {}),",
     True),

    ('a write failure is no longer swallowed, so a down database turns a refusal into a 500', SERVER,
     "  }).catch(e => console.error('recordDepositRejection error:', e.message));\n}",
     "  });\n}",
     True),

    ('the gateway-region refusal in /deposit/marzpay stops recording the request', SERVER,
     "      const msg = 'Automatic recharge is not available in ' + (paymentRegion.name || 'this country') + ' yet. Please use the other payment method.';\n      recordDepositRejection(userId, 'marzpay', paymentRegion, req.body, msg);\n      return res.status(400).json({ status: 'error', code: 'GATEWAY_REGION', message: msg });",
     "      return res.status(400).json({ status: 'error', code: 'GATEWAY_REGION', message: 'Automatic recharge is not available in ' + (paymentRegion.name || 'this country') + ' yet. Please use the other payment method.' });",
     True),

    ("marzpay's phone-format refusal -- the exact bug this feature exists for -- stops recording the member's own request", SERVER,
     "    const _ph = depositSenderPhone(req.body, uSnap.data().phone, ['phone'], paymentRegion);\n    if (_ph.error) {\n      recordDepositRejection(userId, 'marzpay', paymentRegion, req.body, _ph.error);\n      return res.status(400).json({ status: 'error', message: _ph.error });\n    }",
     "    const _ph = depositSenderPhone(req.body, uSnap.data().phone, ['phone'], paymentRegion);\n    if (_ph.error) return res.status(400).json({ status: 'error', message: _ph.error });",
     True),

    ("manual's phone-format refusal stops recording the member's own request", SERVER,
     "    const _sph = depositSenderPhone(req.body, uSnap.data().phone, ['senderPhone', 'phone'], depositRegion);\n    if (_sph.error) {\n      recordDepositRejection(userId, 'manual', depositRegion, req.body, _sph.error);\n      return res.status(400).json({ status: 'error', message: _sph.error });\n    }",
     "    const _sph = depositSenderPhone(req.body, uSnap.data().phone, ['senderPhone', 'phone'], depositRegion);\n    if (_sph.error) return res.status(400).json({ status: 'error', message: _sph.error });",
     True),

    ('/admin/deposit-attempts/list loses its verifyAdmin gate', SERVER,
     "app.post('/admin/deposit-attempts/list', async (req, res) => {\n  if (!verifyAdmin(req)) return res.status(401).json({ status: 'error', message: 'Unauthorized' });",
     "app.post('/admin/deposit-attempts/list', async (req, res) => {",
     True),

    ('the admin route stops filtering by country, so one country sees every other one\'s rejected attempts', SERVER,
     'rows = scopeRowsToRegion(rows, want, userRegions);',
     '/* no region scoping */',
     True),

    ("the admin route's truncated flag is always false, so a cut-short page silently claims to be complete", SERVER,
     'const truncated = snap.docs.length >= 500;',
     'const truncated = false;',
     True),

    ('the admin panel shows an empty card instead of hiding it entirely when nothing has ever been rejected', ADMIN,
     "function depositAttemptsCard(rows){\n  if(!rows.length) return '';",
     "function depositAttemptsCard(rows){",
     True),

    ('the raw JSON body is no longer escaped before being written into the page, a stored-XSS opening for a crafted request body', ADMIN,
     '${esc(a.body||\'\')}',
     '${a.body||\'\'}',
     True),

    ('a PAY A attempt is labelled with the internal gateway name instead of the member-facing PAY A/PAY B wording', ADMIN,
     "${a.route==='manual'?'Manual (PAY B)':'Automatic (PAY A)'}",
     "${a.route}",
     True),
]


def run():
    worst = 0
    for f in ('test-deposit-attempts.js', 'test-deposit-phone.js', 'test-marz-phone-error.js'):
        r = subprocess.run(['node', f], cwd=HERE, capture_output=True, text=True)
        worst = worst or r.returncode
    return worst


def main():
    if run() != 0:
        print('REFUSING TO RUN: the deposit-attempt harnesses are not green at HEAD')
        return 1
    fails = 0
    for label, target, old, new, expect in MUTATIONS:
        text = target.read_text()
        hits = text.count(old)
        if hits != 1:
            print('ABORT  anchor matches %d times (need exactly 1): %s' % (hits, label))
            return 1
        target.write_text(text.replace(old, new, 1))
        try:
            code = run()
        finally:
            target.write_text(text)
        caught = code != 0
        ok = caught == expect
        if not ok:
            fails += 1
        print('%-7s %s%s' % ('CAUGHT' if caught else 'MISSED', label,
                             '' if ok else '   <-- WRONG, wanted %s' % ('CAUGHT' if expect else 'MISSED')))
    print()
    print('%d mutation(s) behaved wrongly' % fails if fails
          else 'all %d mutations behaved as intended' % len(MUTATIONS))
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
