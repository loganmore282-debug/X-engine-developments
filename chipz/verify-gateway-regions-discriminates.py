#!/usr/bin/env python3
"""Re-break the gateway/country rule, one way at a time.

Judged on the EXIT CODE, never on FAIL-line counts: a mutation that makes a
harness CRASH prints no FAIL line, and counting lines reads that as a pass.

Runs BOTH test-gateway-regions.js and test-regions.js and takes the worst exit
code -- the second owns the per-region settings model these resolvers read, so
a mutation that satisfies one can still be caught by the other.

Opens with a deliberate NO-OP asserted to be MISSED. If the control is ever
reported CAUGHT, the run is failing for some reason unrelated to the mutation
and every other CAUGHT in it means nothing.
"""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SERVER = HERE / 'server.js'

HARNESSES = ['test-gateway-regions.js', 'test-regions.js']

# (label, old, new, expect_caught)
MUTATIONS = [
    # A genuine no-op. The first version of this control read
    #   Object.freeze({}) || Object.freeze({ marzpay: ... })
    # which is NOT inert: an empty frozen object is truthy, so `||` short-
    # circuits and the map really did come back empty. It was reported CAUGHT,
    # correctly, and that is exactly what a control is for.
    ('CONTROL: a declared-and-unused constant (must be MISSED)',
     'const GATEWAY_DIAL_CODES = Object.freeze({',
     'const _unusedControl = 0;\nconst GATEWAY_DIAL_CODES = Object.freeze({',
     False),

    ('the whole rule is off: every gateway serves everywhere',
     "  const allowed = GATEWAY_DIAL_CODES[gateway];\n  // 'manual' -- and anything not listed -- is admin-run, so it works anywhere.\n  if (!allowed) return true;",
     "  const allowed = GATEWAY_DIAL_CODES[gateway];\n  if (true) return true;",
     True),

    # MarzPay's twelve markets are its documented `country` values, so a market
    # invented here would send real money at a wallet that does not exist.
    # Tanzania is in none of the three providers' lists.
    ('MarzPay claims a market it does not have',
     "  '232': { code: 'SL', currency: 'SLE' },",
     "  '232': { code: 'SL', currency: 'SLE' },\n  '255': { code: 'TZ', currency: 'TZS' },",
     True),

    ('Congo-Brazzaville is mapped onto DRC -- adjacent codes, different money',
     "  '242': { code: 'CG', currency: 'XAF' },",
     "  '242': { code: 'CD', currency: 'CDF' },",
     True),

    ('a gateway with no declared countries is silently allowed anywhere',
     "  pesajet: ['256'],", "", True),

    ('the request body goes back to a hardcoded UG',
     "    country: market.code,", "    country: 'UG',", True),

    ('an unserved country gets a body anyway, defaulting the market',
     "  const market = marzMarket(region);\n  if (!market) return null;",
     "  const market = marzMarket(region) || MARZPAY_MARKETS['256'];",
     True),

    ('DRC stops naming its wallet currency',
     "  if (market.currencies) body.currency = market.currency;", "", True),

    ('every market sends a currency, not just the dual-wallet one',
     "  if (market.currencies) body.currency = market.currency;",
     "  body.currency = market.currency;",
     True),

    ("LipaPay inherits MarzPay's markets although it serves only Uganda",
     "  lipapay: ['256'],", "  lipapay: Object.keys(MARZPAY_MARKETS),", True),

    ('the balance card reads whichever wallet the API defaults to',
     "  const q = new URLSearchParams({ country: market.code });",
     "  const q = new URLSearchParams();",
     True),

    ('PAY A ignores whether a gateway can reach the country',
     '  return gatewayServesRegion(depositAutomaticProvider(sett), region);',
     '  return true;',
     True),

    ('PAY A turns itself ON even where the admin switched it off',
     "  if (!sett || sett.depositPayAEnabled === false) return false;",
     "  if (!sett) return false;",
     True),

    ('payouts go to an unsupported gateway instead of falling back to manual',
     "  if (chosen !== 'manual' && !gatewayServesRegion(chosen, region)) return 'manual';",
     "  return chosen;",
     True),

    ("the fallback swallows an explicitly manual payout too (Uganda regression)",
     "  if (chosen !== 'manual' && !gatewayServesRegion(chosen, region)) return 'manual';",
     "  if (!gatewayServesRegion(chosen, region)) return chosen;",
     True),

    ('the rule is keyed on the region KEY, so a second Ugandan region breaks',
     "function gatewayServesRegion(gateway, region) {\n  const r = region || currentRegion();\n  return gatewayServesDial(gateway, r && r.dialCode);\n}",
     "function gatewayServesRegion(gateway, region) {\n  const r = region || currentRegion();\n  return (GATEWAY_DIAL_CODES[gateway] ? String(r && r.key) === 'ug' : true);\n}",
     True),

    ('a blank dial code is treated as Uganda',
     "  return allowed.includes(String(dial == null ? '' : dial).replace(/\\D/g, ''));",
     "  return allowed.includes(String(dial == null ? '256' : dial).replace(/\\D/g, '') || '256');",
     True),

    ('a dial code is matched loosely, so 2560 passes as 256',
     "  return allowed.includes(String(dial == null ? '' : dial).replace(/\\D/g, ''));",
     "  return allowed.some(a => String(dial == null ? '' : dial).replace(/\\D/g, '').startsWith(a));",
     True),

    ('the deposit route stops refusing an unreachable gateway',
     "    if (!gatewayServesRegion(provider, paymentRegion)) {",
     "    if (false) {",
     True),

    ('the app is served the RAW PAY A flag again',
     '      depositPayAEnabled: payAAvailable(s),', '', True),

    ('the admin save accepts a gateway the country cannot use',
     '      if (!gatewayServesRegion(value, targetRegion)) {',
     '      if (false) {',
     True),

    ('the admin save judges the request host instead of the region being saved',
     '      if (!gatewayServesRegion(value, targetRegion)) {',
     '      if (!gatewayServesRegion(value, currentRegion())) {',
     True),

    ('a country whose currency disagrees with the market is accepted',
     "      const market = value === 'marzpay' ? marzMarket(targetRegion) : null;",
     "      const market = null;",
     True),
]


def run():
    worst = 0
    for h in HARNESSES:
        r = subprocess.run(['node', h], cwd=HERE, capture_output=True, text=True)
        worst = max(worst, r.returncode)
    return worst


def main():
    if run() != 0:
        print('REFUSING TO RUN: the harnesses are not green at HEAD')
        return 1

    fails = 0
    for label, old, new, expect_caught in MUTATIONS:
        text = SERVER.read_text()
        hits = text.count(old)
        if hits != 1:
            print('ABORT  anchor matches %d times (need exactly 1): %s' % (hits, label))
            return 1
        SERVER.write_text(text.replace(old, new, 1))
        try:
            code = run()
        finally:
            SERVER.write_text(text)
        caught = code != 0
        ok = caught == expect_caught
        if not ok:
            fails += 1
        want = '' if ok else '   <-- WRONG, wanted %s' % ('CAUGHT' if expect_caught else 'MISSED')
        print('%-7s %s%s' % ('CAUGHT' if caught else 'MISSED', label, want))

    print()
    print('%d mutation(s) behaved wrongly' % fails if fails
          else 'all %d mutations behaved as intended' % len(MUTATIONS))
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
