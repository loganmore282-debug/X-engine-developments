#!/usr/bin/env python3
"""Prove this round's three tests would catch a regression.

Judged on the EXIT CODE -- a crashing test prints no FAIL line and would
otherwise read as a pass.
"""
import subprocess, shutil, sys, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
SRV = os.path.join(HERE, 'server.js')
CSS = os.path.join(HERE, 'user-src', 'index.html')
MOD = os.path.join(HERE, 'user-src', 'original_module.js')
ADM = os.path.join(HERE, 'admin-src', 'index.html')

WIT = 'test-withdraw-rules.js'
SNOWCSS = 'test-manualpay-matches-snow.js'

MUTATIONS = [
    # ── one cash-out at a time ──
    ("a pending cash-out stops blocking the next", SRV,
     "        .where('userId', '==', userId).where('status', 'in', ['pending', 'sending', 'processing'])\n"
     "        .limit(1).get();",
     "        .where('userId', '==', userId).where('status', 'in', ['nope'])\n"
     "        .limit(1).get();", WIT),

    ("only 'pending' blocks, so a sending one slips through", SRV,
     "['pending', 'sending', 'processing'])\n        .limit(1).get();",
     "['pending'])\n        .limit(1).get();", WIT),

    ("the block is checked but nothing is thrown", SRV,
     "        e.code = 'WITHDRAW_PENDING';\n        throw e;",
     "        e.code = 'WITHDRAW_PENDING';", WIT),

    # ── the window ──
    ("the window is no longer enforced on the server", SRV,
     "    if (win.enabled && !win.open)\n"
     "      return res.status(400).json({ status: 'error', code: 'WINDOW_CLOSED',",
     "    if (false && win.enabled && !win.open)\n"
     "      return res.status(400).json({ status: 'error', code: 'WINDOW_CLOSED',", WIT),

    ("the window stops wrapping past midnight", SRV,
     "  const open = from < to ? (now >= from && now < to) : (now >= from || now < to);\n"
     "  return { enabled: true, open, from: label.from, to: label.to };",
     "  const open = now >= from && now < to;\n"
     "  return { enabled: true, open, from: label.from, to: label.to };", WIT),

    # Retargeted at hhmmToMin, the helper that actually does the parsing --
    # the first version of this mutation edited a near-duplicate that has since
    # been deleted in favour of it, so its anchor simply stopped existing and
    # the harness reported the mutation as unnoticed rather than as unapplied.
    ("a bad time string silently becomes midnight", SRV,
     "  return m ? Number(m[1]) * 60 + Number(m[2]) : null;",
     "  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;", WIT),

    ("the hours are labelled on a 24-hour clock instead", SRV,
     "  return `${h12}:${String(mi).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;",
     "  return `${String(h24).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;", WIT),

    ("the app goes back to promising hours nobody keeps", MOD,
     "        <li>${withdrawHoursLine(s)}</li>",
     "        <li>Withdrawal time: 06:00:00 - 17:00:00.</li>", WIT),

    ("the admin loses the time inputs", ADM,
     '<div><label>Cash-out opens at</label><input id="sWitFrom" type="time"',
     '<div><label>Cash-out opens at</label><input id="sWitFrom" type="text"', WIT),

    ("a bad time is quietly repaired instead of refused", SRV,
     "        return res.status(400).json({ status: 'error', message: `${key} must be a 24-hour time like 18:00` });",
     "        { updates[key] = '09:00'; continue; }", WIT),

    # ── the Snow CSS ──
    ("the network tiles are rounded again", CSS,
     "border:1px solid #cfcfcf;border-radius:11px;",
     "border:1px solid #cfcfcf;border-radius:var(--r-card);", SNOWCSS),

    ("the submit-SMS box is rounded again", CSS,
     "border:1px solid #bdbdbd;border-radius:12px;padding:10px 12px;font-size:11px;",
     "border:1px solid #bdbdbd;border-radius:var(--r-ctl);padding:10px 12px;font-size:11px;", SNOWCSS),

    ("a single font weight is lightened again", CSS,
     ".mp-card-title{font-size:16.5px;font-weight:800;",
     ".mp-card-title{font-size:16.5px;font-weight:700;", SNOWCSS),

    ("the tile caption weight is lightened again", CSS,
     "color:#777;font-size:12px;font-weight:700;position:relative;",
     "color:#777;font-size:12px;font-weight:600;position:relative;", SNOWCSS),

    ("a rule is dropped from the flow entirely", CSS,
     "#manualPayFlow .mp-your-account{font-size:13px;font-weight:700;margin-top:6px}",
     "", SNOWCSS),

    ("one of Snow's own strings is reworded", MOD,
     "Please select a payment method", "Choose a payment method", SNOWCSS),
]

FILES = [SRV, CSS, MOD, ADM]


def build():
    for script in ('build-core.js', 'build-admin.js'):
        r = subprocess.run(['node', script], cwd=HERE, capture_output=True, text=True)
        if r.returncode != 0 or not re.search(r'round-trip\s*:?\s*OK', r.stdout + r.stderr):
            print(f'BUILD BROKE ({script}):', (r.stdout + r.stderr)[-400:])
            return False
    return True


def run(test):
    cmd = [sys.executable, test] if test.endswith('.py') else ['node', test]
    return subprocess.run(cmd, cwd=HERE, capture_output=True, text=True).returncode


def main():
    for p in FILES:
        shutil.copy(p, p + '.disc-bak')
    bad = []
    try:
        if not build():
            return 1
        for t in (WIT, SNOWCSS):
            if run(t) != 0:
                print(f'BASELINE ALREADY FAILING: {t}')
                return 1
        print('baseline: both green\n')
        for label, path, old, new, test in MUTATIONS:
            text = open(path, encoding='utf-8').read()
            if text.count(old) != 1:
                print(f'SETUP  {label}: anchor appears {text.count(old)} times, expected 1')
                bad.append(label)
                continue
            open(path, 'w', encoding='utf-8').write(text.replace(old, new))
            ok = build()
            code = run(test) if ok else 1
            shutil.copy(path + '.disc-bak', path)
            caught = code != 0
            print(('CAUGHT ' if caught else 'MISSED ') + label + f'  (exit {code}, {test})')
            if not caught:
                bad.append(label)
        build()
    finally:
        for p in FILES:
            shutil.copy(p + '.disc-bak', p)
            os.remove(p + '.disc-bak')
        build()

    print()
    if bad:
        print(f'{len(bad)} mutation(s) went unnoticed: {bad}')
        return 1
    print('every change is covered by an assertion that discriminates')
    return 0


if __name__ == '__main__':
    sys.exit(main())
