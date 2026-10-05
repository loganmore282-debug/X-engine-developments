# Prompt for Codex: rebuild Soda's design from the owner's screenshots

Copy everything below the line into Codex, then attach the screenshots.

---

You are working on **Soda**, a Uganda mobile-money investment web app (PWA). Repo: `loganmore282-debug/X-engine-developments`. Branch: **`claude/soda-build`**. Work ONLY inside the **`soda/`** folder. **Never edit `petro/`, `chipz/` or any other sibling folder.** Read `soda/CLAUDE.md` first: it has the decisions already made.

## Your job
Rebuild the **look and structure of the member app** (and any admin screen I mention) so it matches the screenshots I attach, screen by screen. This is like rebuilding the outside of a house: new design, new layout, some features and screens removed, but the plumbing (money logic, login, API) stays correct. The screenshots are the source of truth. If a screen in the current app differs from a screenshot, change the app to match the screenshot. Do not keep the old look unless I say so. If something in a screenshot is unclear, say exactly what is unclear and ask me, instead of guessing.

## Where things live
- Member app source: `soda/user-src/index.html` (markup + CSS) and `soda/user-src/original_module.js` (all app logic). Built output goes to `soda/user/`.
- Admin panel source: `soda/admin-src/index.html`. Built output goes to `soda/admin/`.
- Backend: `soda/server.js`, `soda/db.js`, `soda/session-policy.js`. **Do not change server behaviour unless a screenshot truly needs a new field, and tell me first.**
- **Never hand-edit `soda/user/index.html` or `soda/admin/index.html`**: they are generated. Edit the `-src` files, then build.

## Build and check (run after every batch of changes)
```
cd soda
node build-core.js      # member app -> user/
node build-admin.js     # admin panel -> admin/
npm run test:audit      # the full test suite
```
- Bump the cache name in `soda/user/sw.js` (`soda-shell-vN` -> `vN+1`) whenever the member app changes, and in `soda/admin/sw.js` (`soda-admin-shell-vN`) whenever the admin panel changes. Phones keep old files otherwise.
- Many tests read the screen text and structure. When a test fails because I **intentionally** changed or removed something, update that test to the new design and keep its purpose (never delete a check just to get green). If a test failure points at a real bug (money, login, session), fix the bug.

## Rules that must not break
1. **Money safety:** do not touch deposit, withdrawal, investment, bonus or commission calculations, the in-process locks (`withLock`, `_creditingDeposits`, `_completingWithdrawals`), or `instances: 1`. Design changes only change how things look and are arranged, not what the numbers do. If a screenshot shows different numbers or rules (fees, minimums, percentages), **list them for me and wait**; do not change money rules silently.
2. **Login stays MongoDB-based** (no Firebase). Keep the `/auth/*` calls, the session token handling and the sign-out behaviour as they are.
3. **One host:** the app calls the relative path `/api`; the admin panel lives under a secret path with relative asset URLs. Do not add absolute backend addresses.
4. **No emoji in the UI; use SVG icons.** Show full numbers ("UGX 23,000", never "23k"). No abbreviations the screenshots don't use.
5. **The name "Soda" is temporary.** Keep reading the visible name from the brand setting/`brand.config.json`; never hardcode a new name in many places.
6. **Do not copy wording, icons or layout from the old Nexus, Petro or Chipz apps** where a screenshot gives me something different.
7. Removed features: remove the screen, its menu entry, its code paths and its tests, so nothing is left hidden. If removing a feature would orphan data or an API route, tell me and do not delete the backend route without asking.
8. Keep it fast and light on a cheap phone: no big new libraries, no huge images (compress), keep the page working offline-shell style as it does now (service worker).
9. Never commit secrets, passwords, keys, or anything from `/srv/soda-secrets/`.

## How to work
- Work in **small steps**: one screen (or a few related screens) at a time. After each step: build, run `npm run test:audit`, commit with a clear message, and push to `claude/soda-build`. Pushing deploys automatically to my test server.
- After each step, write me a **plain report**: which files changed, what the screen now does, what you removed, what you tested, and **what you could not test** (for example real phone browser, HTTPS-only features).
- Start by listing the screens you see in my screenshots, what you plan to change on each, and what you plan to remove. Wait for my "go" before large deletions.
- Update `soda/CLAUDE.md` with a short status entry for every step, so the next session knows what exists.

Another assistant (Claude) also commits to this branch. Always `git pull --rebase origin claude/soda-build` before you start and before each push. Do not force-push.
