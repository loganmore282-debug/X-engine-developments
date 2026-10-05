#!/usr/bin/env python3
"""Prove this round's two tests would catch a regression.

Judged on the EXIT CODE -- a crashing test prints no FAIL line and would
otherwise read as a pass.
"""
import subprocess, shutil, sys, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
SRV = os.path.join(HERE, 'server.js')
CSS = os.path.join(HERE, 'user-src', 'index.html')

SPIN = 'test-spin-sources.js'
SHEEN = 'test-wallet-sheen.py'

MUTATIONS = [
    # ── the spin sources ──
    ("the balance is guessed from the pre-credit snapshot again", SRV,
     "      let newBalance = null;\n"
     "      try {\n"
     "        const after = await ref.get();\n"
     "        if (after.exists) newBalance = round2(Number(after.data().walletBalance) || 0);\n"
     "      } catch (_) { newBalance = null; }",
     "      const newBalance = (Number(u.walletBalance) || 0) + reward;", SPIN),

    ("a daily spin also burns an earned product spin", SRV,
     "        reward = turntableDailyReward(sett);\n        source = 'daily';",
     "        const st = await db.collection('turntableSpins')\n"
     "          .where('userId', '==', uid).where('used', '==', false)\n"
     "          .orderBy('createdAt', 'asc').limit(1).get();\n"
     "        if (!st.empty) spinDoc = st.docs[0];\n"
     "        reward = turntableDailyReward(sett);\n        source = 'daily';", SPIN),

    ("a product spin is repriced from the DAILY band", SRV,
     "        reward = (d.spinMin != null || d.spinMax != null)\n"
     "          ? rollSpinReward(d.spinMin, d.spinMax)\n"
     "          : round2(Number(d.reward) || 0);",
     "        reward = turntableDailyReward(sett);", SPIN),

    ("the earned spin is no longer burnt with a conditional write", SRV,
     "        const burnt = await spinDoc.ref.updateIf({ used: false }, { used: true, usedAt: now });\n"
     "        if (!burnt) {",
     "        await spinDoc.ref.update({ used: true, usedAt: now });\n"
     "        const burnt = true;\n"
     "        if (!burnt) {", SPIN),

    ("the daily claim is no longer a conditional write", SRV,
     "        const claimed = await ref.updateIf(\n"
     "          { lastTurntableAt: u.lastTurntableAt == null ? null : u.lastTurntableAt },\n"
     "          { lastTurntableAt: now });",
     "        await ref.update({ lastTurntableAt: now });\n        const claimed = true;", SPIN),

    ("one purchase can grant its spins twice", SRV,
     "    await withLock('spingrant:' + investmentId, async () => {\n"
     "      const already = await db.collection('turntableSpins')\n"
     "        .where('investmentId', '==', investmentId).limit(1).get();\n"
     "      if (!already.empty) return;\n"
     "      await writeTurntableSpinDocs(userId, product, investmentId);\n"
     "    });",
     "    await writeTurntableSpinDocs(userId, product, investmentId);", SPIN),

    # ── the wallet sweep ──
    ("the wallet sheen goes back to a static highlight", CSS,
     "  animation:wcSheenSweep 5.2s ease-in-out infinite;}",
     "  animation:none;}", SHEEN),

    ("the sheen animates but the band fills the whole card", CSS,
     ".wallet-card .sheen{position:absolute;top:-20%;bottom:-20%;left:0;width:55%;pointer-events:none;",
     ".wallet-card .sheen{position:absolute;top:-20%;bottom:-20%;left:0;width:100%;pointer-events:none;",
     SHEEN),

    ("the sweep runs once and stops", CSS,
     "  animation:wcSheenSweep 5.2s ease-in-out infinite;}",
     "  animation:wcSheenSweep 5.2s ease-in-out 1;}", SHEEN),

    ("reduced motion loses the highlight entirely", CSS,
     "  .wallet-card .sheen{animation:none;top:0;bottom:0;width:100%;\n"
     "    transform:none;\n"
     "    background:linear-gradient(115deg,transparent 30%,rgba(255,255,255,.22) 48%,transparent 62%);}}",
     "  .wallet-card .sheen{display:none;}}", SHEEN),
]

FILES = [SRV, CSS]


def build():
    r = subprocess.run(['node', 'build-core.js'], cwd=HERE, capture_output=True, text=True)
    if r.returncode != 0 or not re.search(r'round-trip\s*:?\s*OK', r.stdout + r.stderr):
        print('BUILD BROKE:', (r.stdout + r.stderr)[-400:])
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
        for t in (SPIN, SHEEN):
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
