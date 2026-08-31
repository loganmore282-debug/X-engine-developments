# Snow — full-platform review brief

Hand this to Codex together with repository access. It is written to be read
by a reviewer who has never seen this codebase.

**Repository:** `loganmore282-debug/x-engine-developments`
**Branch:** `claude/snow-platform-build`
**Everything in scope lives under `snow/`.** Sibling folders in this repo
(`space8/`, `voltra/`, `nexus/`, `choco-mcc/`, the repo-root
`sms-forwarder-app/` and `xengine-app/`) are *different live products*. Do not
review them, and do not propose changes to them.

---

## What Snow is

A Uganda mobile-money investment platform. Members deposit by mobile money,
buy one of ten fixed-term products, earn daily cashback over a 150-day cycle,
withdraw to a mobile-money number, and earn 3-level referral commission.

It is **live with real money**. Correctness of money movement outranks every
other consideration in this review, including style, architecture and
performance.

## What to review

| Part | Path | Size |
|---|---|---|
| Backend API | `snow/server.js` | 5,667 lines, 111 routes (69 admin) |
| Data layer | `snow/db.js` | 389 lines |
| Member app logic | `snow/user-src/original_module.js` | 2,365 lines |
| Member app shell/CSS | `snow/user-src/index.html` | 441 lines |
| Admin panel | `snow/admin-src/index.html` | 2,070 lines |
| Android SMS forwarder | `snow/sms-forwarder-app/` | 10 Java files, 1,992 lines, v1.9 |
| Build pipeline | `snow/build-core.js`, `snow/build-admin.js`, `snow/guard-src.js` | |
| Deploy config | `snow/render.yaml`, `snow/package.json` | |
| CI | `.github/workflows/build-snow-sms-apk.yml` | |

`snow/user/` and `snow/admin/` are **generated artifacts** (obfuscated builds of
`user-src/` and `admin-src/`). Review the `-src` files; flag the built ones only
if they have drifted from their source.

## Read these first

- **`snow/CLAUDE.md`** — the project's memory. 86 numbered rounds of decisions,
  including every bug found and fixed, and *why* specific designs were chosen.
  Long, but it is the difference between a useful review and one that
  re-reports settled ground.
- **`snow/AGENT_LOG.md`** — earlier design history.

**Please do not re-report anything already documented as fixed or as a
deliberate, accepted trade-off, unless you believe the reasoning is wrong — in
which case say so explicitly and explain why.** Several rounds were spent on
exactly that, and repeat findings cost the owner time.

---

## The single most important constraint

**MongoDB Atlas M0 has no multi-document transactions.** `db.runTransaction()`
in `db.js` is *sequential writes with no rollback*. It does not do what its name
suggests. Any code that reads it as a real transaction is a bug.

What the codebase uses instead, and what you should hold it to:

1. **`updateIf(extraFilter, updates)`** — one atomic conditional single-document
   update. This is the only true compare-and-set available.
2. **`withLock(key, fn)` / `withLock2(a, b, fn)`** — per-key in-process mutexes.
   **These only work because the backend runs as a single instance**
   (`render.yaml`). If you see anything that would break under horizontal
   scaling, note it — but as a documented constraint, not a surprise.
3. **CLAIM-BEFORE-CREDIT** — flip a status/flag *before* moving money, so a
   retry is a safe no-op rather than a second payment.
4. **Idempotency tokens** — e.g. `creditedDepositIds`, `refundedWithdrawalIds`,
   `redeemedGiftCodeIds` arrays on the user document, written in the *same*
   atomic update as the balance change.

## What we most want you to find

Ranked. Depth on 1–3 is worth far more than breadth across 6–8.

1. **Any path that can pay a member twice, or fail to pay them at all.**
   Deposits (automatic and manual), withdrawals, daily cashback, referral
   commission, gift codes, check-in, Mission Center and Task Center claims.
2. **Any path that can credit the *wrong* member.** Specifically:
   `assignManualNumber()` deliberately gives *different* payment numbers the
   *same* amount concurrently, so an SMS attributed to the wrong number does not
   fail harmlessly — it can match a live order belonging to somebody else. Trace
   this end to end: Android SIM-slot resolution → webhook → matching → credit.
3. **Silent failures.** This platform's worst bugs have all been things that
   looked healthy while losing money: a phone forwarding to a number nobody
   saved, a daily stat filed under 1970, a stuck refund that reported success.
   Look for anything that swallows an error, or that cannot distinguish "nothing
   happened" from "something failed".
4. **Authorization.** 69 admin routes. `verifyAuth` (member), `verifyAdmin`
   (staff), `verifyOwner` (owner-only). Find any route whose gate is weaker than
   the action it performs, or any UI-only restriction with no server check
   behind it.
5. **Injection and input handling.** `stripMongoOperators` runs globally before
   every handler. Find anything that reaches a query or `innerHTML` around it.
6. **Money arithmetic.** Rounding, float drift, and string concatenation into
   numeric fields (a real past bug produced `1,000,000,500` from `"1000000" +
   "500"`).
7. **The Android forwarder.** Multi-SIM attribution, the access-password lock,
   the update path, and what happens when the phone is offline, killed, or has
   its SIM removed.
8. **Frontend.** Race conditions, stale-state clobbering, double-submit,
   cross-session data leaking on a shared device.

## Specific things worth tracing

- `creditDeposit()`, `markDepositFailed()`, `processWithdrawalCore()`,
  `declineWithdrawalAndRefund()`, `completeWithdrawalRefund()`,
  `markWithdrawalProcessed()`, `settleInvestmentIfDue()`,
  `creditReferralCommission()`, `recountAllTotals()`, `computeRealTotals()`.
- The two webhooks — `/deposit/callback` and `/withdraw/callback` — are
  unauthenticated by nature. Safety is supposed to come from independently
  re-checking the transaction against MarzPay's own API before acting. Verify
  that holds on every branch.
- **Manual deposits**, the newest and least battle-tested subsystem:
  `/deposit/manual/init`, `/sms-forwarder`, `/paste-sms`, `/verify-number`,
  `/forwarder-heartbeat`, `/forwarder-unlock`, plus `reconcileManualDeposits()`.
- The SMS parsers (`parseMoMoSms`, `parseSentMoMoSms` and the `_sms*` helpers).
  **Eight real captured operator formats** are locked into
  `snow/test-momo-sms-parsers.js`. Every one differs in layout. The helpers scan
  rather than assume positions, deliberately. Before proposing a "simplification"
  there, check it against all eight.

## Known and accepted — don't re-report as new

- In-process locks require a single backend instance. Documented.
- `db.runTransaction()` is not atomic. Documented; the question is whether any
  *caller* wrongly assumes otherwise.
- Several reward paths credit the wallet before writing the ledger row, so a
  failure there leaves the money correct but the Records entry missing. Known,
  and mitigated by claim-before-credit. A concrete case where this *loses or
  duplicates money* would be a real finding; restating the pattern is not.
- `/admin/integrity` deliberately surfaces a wallet-vs-ledger mismatch and
  refuses to auto-"fix" it, because choosing which side is right needs a human.
- The forwarder's access password is not anti-tamper. An APK can be decompiled
  and resigned. `MANUAL_SMS_SECRET` is the real control.
- The debug signing keystore is committed on purpose so updates install over the
  top. It is a public debug key and grants nothing.

## How to report

For each finding:

1. **Severity** — Critical / High / Medium / Low.
2. **File and line.**
3. **A concrete failure scenario** — inputs, ordering, and the resulting wrong
   state. "This looks racy" is not actionable; "if A lands between B's read and
   write, `totalWithdrawn` ends up short by the net amount, permanently" is.
4. **Why the existing guard does not already cover it.** Most of these paths
   have a guard; say which one you checked and why it is insufficient.
5. **A suggested fix**, consistent with the four patterns listed above.

Please also say plainly what you checked and found **correct** — knowing which
areas were examined and cleared is as useful as the findings.

## Testing

Committed: `snow/test-momo-sms-parsers.js` (70 checks) and
`snow/test-admin-obfuscated-build.js` (jsdom, runs against the *built,
obfuscated* admin panel). `snow/sms-forwarder-app/check-java-symbols.py` runs in
CI ahead of Gradle.

There is **no live MongoDB, Firebase or MarzPay in review conditions**, and no
Android handset. Several behaviours are therefore proven only by construction:
multi-SIM attribution, the forwarder lock screen, the in-app update path, and
the manual-deposit flow end to end against real operator SMS. **Gaps in test
coverage around money paths are themselves worth reporting.**

## Secrets

`MONGODB_URI`, `FIREBASE_SERVICE_ACCOUNT`, `ADMIN_KEY`, `MARZPAY_KEY`,
`MANUAL_SMS_SECRET`, `FORWARDER_PASSWORD` live only in Render environment
variables. The Firebase **web** config in the frontend is intentionally public
and is not a finding. If you find any other real secret committed, that is
Critical — say so immediately.
