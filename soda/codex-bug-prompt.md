You are auditing and fixing bugs in "Soda", a live production Uganda mobile-money investment PWA. Treat every change as a change to real money.

REPO AND BRANCH
- Repo: loganmore282-debug/X-engine-developments, branch `claude/soda-build`. Work ONLY under the `soda/` folder. Ignore everything else in the repo root (old, unrelated apps).
- Read `soda/CLAUDE.md` first. It is the project memory. Entries 6a to 6q are the latest decisions.
- Pushes to this branch auto-deploy to the live VPS. Do NOT push to `claude/soda-build`. Create your own branch from it (for example `codex/soda-bugfix`), commit there, and give me a list of changes. I will review and merge.

WHAT THE APP IS
- `server.js` (about 10k lines): Express backend on one host for app, API and admin. MongoDB through `db.js`, a Firestore-style layer.
- Member app source: `user-src/index.html` + `user-src/original_module.js`.
- Admin panel source: `admin-src/index.html`.
- Never hand-edit the built files `user/index.html` or `admin/index.html`. Build them with:
  - `node build-core.js` (member app)
  - `node build-admin.js` (admin)
- After changing the member shell, bump `user/sw.js` (`soda-shell-vN`). After changing the admin shell, bump `admin/sw.js` (`soda-admin-shell-vN`).
- Test everything with `npm run test:audit`. It must pass at the end. Add a test for every bug you fix.

HARD RULES (money safety, do not regress)
1. MongoDB M0 has NO ACID transactions. `runTransaction` does not lock. Anything that credits or debits money must use the in-process lock (`withLock`, `_creditingDeposits`, `_creditingPayouts`, `_completingWithdrawals`), atomic `updateIf` / `FieldValue.increment`, and idempotency tokens (`creditedDepositIds`, `debitedWithdrawalIds`, `creditedCommissionKeys`). pm2 runs a single instance, so in-process locks are valid.
2. Withdrawals require the 6-digit Trade Password (`transactionPinHash`, `pinCheck` lock: 5 failures per 15 minutes). Do not weaken this.
3. Member sessions are random 32-byte hex tokens in `memberSessions`, not JWTs. Admin sessions are in `adminSessions`.
4. Never commit secrets. They live only in environment variables (`MONGODB_URI`, `ADMIN_KEY`, `MARZPAY_KEY`, and others). Do not print or log them.
5. USDT and card deposit features are gated off by default. Keep them off.
6. Do not add emoji, abbreviations in money ("UGX 23,000", never "23k"), or new invented wording to the UI. Do not change the design (royal blue `#1739b8`, Roboto font, SVG icons only).

ALREADY FIXED (commit 483455b). Do not redo these, but verify they are correct
- Rate-limit key `rlKeyByUser` now hashes the session token. Pre-sign-in routes stay IP-keyed.
- `/checkin` and `/team/milestone/claim` money routes deleted.
- `/admin/user/set-phone` now moves the `authAccounts` login document and ends sessions.
- `sanitizeProductInput` now requires a cycle and a multiplier or total payout.
- Removed a stray `_walletEditing` assignment in the member app.

YOUR TASK
Audit every line of these files and fix real bugs: `server.js`, `db.js`, `session-policy.js`, `user-src/original_module.js`, `user-src/index.html` (script and CSS), `admin-src/index.html`, `build-core.js`, `build-admin.js`, `user/sw.js`, `admin/sw.js`.

Priorities, highest first:
1. Money correctness. Look for double credit, double debit, lost update, race between webhook, status poll and reconciler, refund paths, commission paths, maturity payout, withdrawal fee maths (15%), minimum and multiple rules, and idempotency gaps.
2. Auth and permissions. Look for admin routes missing `verifyOwner` / `verifyAdmin`, member routes missing a session check, banned-user bypass, session revoke gaps, and rate-limit bypass.
3. Data integrity. Look for places where a profile field and the login document can disagree, orphaned records on delete, wrong totals in `recountAllTotals` / `/admin/integrity`, and unvalidated admin input.
4. Client crashes. Look for undefined variables (run ESLint `no-undef` over the extracted scripts), null dereferences, broken event handlers, back-button and overlay-stack bugs, and stale-state bugs after a network failure.
5. Unescaped data in `innerHTML` (member app and admin panel).
6. Dead code that is truly unreachable. Remove it only if no test or screen uses it.

HOW TO WORK
- Prove each bug before fixing it: show the failing input or sequence, or write a failing test first.
- Keep each fix minimal. Do not refactor. Do not rename. Do not reformat.
- Do not "fix" the items under KNOWN AND INTENTIONAL.
- Run `npm run test:audit` after each group of fixes.
- Do not claim something is tested if you did not run it.

KNOWN AND INTENTIONAL (do not change)
- The 500 ms maturity sweep (`reconcileCashback`) is the owner's explicit request.
- Daily cashback is disabled. Earnings are paid in full at maturity only.
- The language tables are English-only in practice. Leave them.
- Unused legacy helpers (`phoneToEmail`, `looksLikeRegionMobile`, `turntableDailyReward`) are still pinned by old tests. Leave them unless you also update those tests cleanly.
- The turntable code stays but is off by default.

OUTPUT FORMAT
Report plainly:
1. A table of bugs found: file and line, what was wrong, the concrete failure scenario, and the fix.
2. Files changed.
3. Tests you added, and the final `npm run test:audit` result (quote the last lines).
4. Anything you suspected but did not change, with the reason.
5. Anything you could not test.
