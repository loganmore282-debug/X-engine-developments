#!/usr/bin/env python3
"""Re-break the "a member never reads raw provider prose" guarantee, one way
at a time.

Judged on the EXIT CODE, never on FAIL-line counts -- a mutation that crashes
the harness prints no FAIL line, and counting lines reads that as a pass.

Opens with a deliberate NO-OP asserted MISSED. If the control is ever CAUGHT,
the run is failing for a reason unrelated to the mutation and every other
CAUGHT in it means nothing.

ROUND 179c REWROTE THIS FILE. Round 178b's version mutated an inline ternary
in /deposit/marzpay and a detector keyed on the single phrase "phone number
format" -- and every one of its mutations was caught, while the actual bug
shipped anyway: the real MarzPay message says "Uganda only accepts Ugandan
numbers... Kenyan (+254) numbers are not allowed", which contains that phrase
nowhere. The mutations were all faithful to an implementation that was
answering the wrong question. The ones below target the GUARANTEE instead:
whatever MarzPay says, a member gets our own translated sentence unless the
message is one of the few families worth reading.
"""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SERVER = HERE / 'server.js'
CLIENT = HERE / 'user-src' / 'original_module.js'

# (label, target, old, new, expect_caught)
MUTATIONS = [
    ('CONTROL: a declared-and-unused constant (must be MISSED)', SERVER,
     'function marzIsPhoneFormatError(mp, region) {',
     'const _unusedControl = 0;\nfunction marzIsPhoneFormatError(mp, region) {',
     False),

    # ── the exact regression the owner caught live ──
    # Reverts the whole detector to 178b by short-circuiting at the first
    # line -- everything below becomes dead code, which is exactly the
    # behaviour being tested for. A first version tried to replace the real
    # body verbatim and its anchor spanned two comment blocks, so it matched
    # zero times and aborted the run; anchoring on one short line of CODE
    # cannot drift when a comment above it is reworded.
    ('the detector goes back to Round 178b: only the documented code and the phrase "phone number format"', SERVER,
     "  if (mp && MARZ_PHONE_ERROR_CODES.has(String(mp.error_code || ''))) return true;",
     "  if (mp && mp.error_code === 'INVALID_PHONE_FORMAT') return true;\n"
     "  return /invalid .*phone number format|phone number format/i.test(String((mp && (mp.message || mp.data?.message)) || ''));",
     True),

    ('the "only accepts ... numbers" / "not allowed" wording is no longer recognised', SERVER,
     'if (/phone number format|invalid .*phone|only accepts .*numbers|numbers are not allowed|not a valid .*number|wrong country|country mismatch|does not belong to/i.test(raw))',
     'if (/phone number format|invalid .*phone|wrong country|country mismatch|does not belong to/i.test(raw))',
     True),

    ('the structural foreign-dial-code signal is dropped', SERVER,
     """  const mine = String((region || currentRegion()).dialCode || '');
  const runs = raw.match(/\\+\\d+/g) || [];
  return !!mine && runs.some(r => !r.slice(1).startsWith(mine));""",
     '  return false;',
     True),

    ("the foreign-code test slices a fixed width again, so a member's OWN number reads as foreign", SERVER,
     'const runs = raw.match(/\\+\\d+/g) || [];\n  return !!mine && runs.some(r => !r.slice(1).startsWith(mine));',
     "const runs = raw.match(/\\+\\d{1,4}/g) || [];\n  return !!mine && runs.some(r => r.slice(1) !== mine);",
     True),

    # ── the structural guarantee: unforeseen prose is replaced, not shipped ──
    ('raw provider prose is passed straight through to the member again', SERVER,
     '  if (raw && marzMsgIsSafeForMember(raw)) return raw;\n  return fallback || DEPOSIT_FAILED_MSG;',
     '  return raw || fallback || DEPOSIT_FAILED_MSG;',
     True),

    ('a genuinely useful refusal (insufficient float, frozen account) is swallowed too', SERVER,
     'function marzMsgIsSafeForMember(raw) {\n  return /insufficient (balance|funds|float)|frozen|suspended|limit|minimum|maximum|too (small|large|low|high)/i.test(String(raw || \'\'));\n}',
     'function marzMsgIsSafeForMember(raw) {\n  return false;\n}',
     True),

    ('a transport failure is reported as a phone problem instead of "busy"', SERVER,
     '  if (marzIsBusy(mp)) return PROVIDER_BUSY_MSG;\n  if (marzIsPhoneFormatError(mp, region)) return marzPhoneFormatMsg(region);',
     '  if (marzIsPhoneFormatError(mp, region)) return marzPhoneFormatMsg(region);',
     True),

    ('a confirmed PERMANENT MarzPay refusal (DEPOSITS_NOT_ALLOWED) is told to the member as "try again in a moment"', SERVER,
     "  if (mp && MARZ_PERMANENT_ERROR_CODES.has(String(mp.error_code || ''))) return false;\n  const raw = String((mp && (mp.message || mp.data?.message || mp.error || mp.data?.error)) || '');",
     "  const raw = String((mp && (mp.message || mp.data?.message || mp.error || mp.data?.error)) || '');",
     True),

    # ── Round 182: the two codes added once the user-supplied MarzPay
    #    integration reference confirmed them, not guessed at ──
    ('SERVICE_NOT_SUBSCRIBED / SERVICE_NOT_AVAILABLE are dropped back out of the permanent set', SERVER,
     "const MARZ_PERMANENT_ERROR_CODES = new Set(['DEPOSITS_NOT_ALLOWED', 'SERVICE_NOT_SUBSCRIBED', 'SERVICE_NOT_AVAILABLE']);",
     "const MARZ_PERMANENT_ERROR_CODES = new Set(['DEPOSITS_NOT_ALLOWED']);",
     True),

    # ── the wiring, and the region it is decided against ──
    ('the deposit route records the raw admin/diagnostic text as the failure reason', SERVER,
     "      await markDepositFailed(depRef, userId,\n        marzMemberMsg(mpData, 'Could not start the payment', paymentRegion),\n        JSON.stringify(mpData));",
     "      await markDepositFailed(depRef, userId, marzUserMsg(mpData, 'Could not start the payment'));",
     True),

    ("the member's own region is no longer handed to the wrapper", SERVER,
     "marzMemberMsg(mpData, 'Could not start the payment', paymentRegion),",
     "marzMemberMsg(mpData, 'Could not start the payment'),",
     True),

    ('marzPhoneFormatMsg stops reusing badPhoneMessage and drifts into a second copy', SERVER,
     'function marzPhoneFormatMsg(region) {\n  return badPhoneMessage(region || currentRegion());\n}',
     "function marzPhoneFormatMsg(region) {\n  return 'Wrong phone number.';\n}",
     True),

    # ── the refusal a member gets BEFORE the gateway is ever asked ──
    ("a wrong-country number is refused with a sentence that never names the country's format", SERVER,
     '    return cleaned ? { phone: cleaned } : { error: badPhoneMessage(r) };',
     "    return cleaned ? { phone: cleaned } : { error: 'Enter a valid mobile-money phone number.' };",
     True),

    ('the fallback-to-account-number path loses the same wording', SERVER,
     '  const fallback = cleanPhone(accountPhone || \'\', r);\n  return fallback ? { phone: fallback } : { error: badPhoneMessage(r) };',
     "  const fallback = cleanPhone(accountPhone || '', r);\n  return fallback ? { phone: fallback } : { error: 'Enter a valid mobile-money phone number.' };",
     True),

    ('the number is validated against the request context instead of the region passed in', SERVER,
     '    const cleaned = cleanPhone(v, r);',
     '    const cleaned = cleanPhone(v);',
     True),

    ('the phone rule is no longer told which region to judge against', SERVER,
     'function depositSenderPhone(body, accountPhone, keys, region) {\n  const r = region || currentRegion();',
     'function depositSenderPhone(body, accountPhone, keys, region) {\n  const r = currentRegion();',
     True),

    # ── the sentence itself has to stay translatable ──
    ('the LANG_PATTERNS row is deleted, so the message goes back to untranslated English', CLIENT,
     "['That is not a valid {0} mobile-money number. Use the format {1} or {2}.',",
     "['SOMETHING_ELSE_ENTIRELY {0} {1} {2}',",
     True),

    ('the French translation drops the {2} placeholder, silently dropping a phone number', CLIENT,
     "\"Ce n'est pas un numéro mobile money {0} valide. Utilisez le format {1} ou {2}.\",",
     "\"Ce n'est pas un numéro mobile money {0} valide. Utilisez le format {1}.\",",
     True),

    # ── the admin-only provider diagnostic added after the sync finally
    #    reached production and "Could not start the payment" was still
    #    unreadable without Railway log access ──
    ('the raw provider detail is no longer stored at all', SERVER,
     "    if (adminDetail) update.providerDetail = String(adminDetail).slice(0, 2000);",
     '',
     True),

    ('providerDetail is stored even with no adminDetail, appearing on every failure', SERVER,
     "    if (adminDetail) update.providerDetail = String(adminDetail).slice(0, 2000);",
     "    update.providerDetail = String(adminDetail || '').slice(0, 2000);",
     True),

    ('providerDetail is stored unbounded, so a huge response is written to Mongo', SERVER,
     "update.providerDetail = String(adminDetail).slice(0, 2000);",
     "update.providerDetail = String(adminDetail);",
     True),

    ("MarzPay's create-failure branch stops passing its raw response", SERVER,
     "      await markDepositFailed(depRef, userId,\n        marzMemberMsg(mpData, 'Could not start the payment', paymentRegion),\n        JSON.stringify(mpData));",
     "      await markDepositFailed(depRef, userId,\n        marzMemberMsg(mpData, 'Could not start the payment', paymentRegion));",
     True),
]


def run():
    worst = 0
    for f in ('test-marz-phone-error.js', 'test-deposit-phone.js'):
        r = subprocess.run(['node', f], cwd=HERE, capture_output=True, text=True)
        worst = worst or r.returncode
    return worst


def main():
    if run() != 0:
        print('REFUSING TO RUN: the phone-error harnesses are not green at HEAD')
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
