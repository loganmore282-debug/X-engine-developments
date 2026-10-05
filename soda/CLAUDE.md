# Soda -- Project Memory (read this first)

**What it is:** a mobile-money investment platform, built as a copy of **Petro** (`petro/`, which is itself Chipz plus a long run of fixes). It is its own app: own folder `soda/`, own database, own branch, own port. **Never edit `petro/`, `chipz/` or the other sibling folders from a Soda session.**

**Name is temporary.** "Soda" is a working name; the owner will rename it. Everything user-facing must read the name from one place (admin setting `brandName` + one build script), never hardcode it.

## Owner decisions (do not re-ask)
- **MongoDB only. No Firebase.** Members log in against MongoDB (scrypt-hashed passwords, our own short-lived tokens, logout/revoke, brute-force limits, SMS-code reset). This replaces Firebase Auth. Admin push (FCM) will later be replaced by standard Web Push with our own VAPID keys.
- **One subdomain for everything** (app + API + admin on one host, API under `/api`, admin at a secret path), e.g. `mysoda.p-colasoda.com`. The host is an admin-editable setting; DNS + HTTPS certificate are the only server-side steps when it changes. **No domain bought yet** (owner buys it after the build is finalised), so development runs on the VPS by IP/port over plain HTTP; push, PWA install and WebOTP need HTTPS and wait for the domain.
- **Payments:** same gateways as Petro -- PesaJet and MarzPay (+ USDT/card as Petro has). PesaJet's dashboard has ONE webhook URL; if Soda shares Petro's PesaJet account only one app gets the instant webhook (the poll/reconciler still credits the other). A separate PesaJet account is the clean fix.
- **Design:** the owner will send images; build exactly to them. Until then keep Petro's look.
- Work step by step; commit and push each step; tell the owner exactly which files changed and what was tested (including what could not be tested).

## Hosting (same Hostinger KVM1 as Petro, shared)
- Code: sparse git checkout of `soda/*` from branch `claude/soda-build` at `/srv/soda-src/soda`.
- Process: pm2 `soda-server`, **port 3001**, `instances: 1` (in-process money locks, same rule as Petro).
- Secrets: `/srv/soda-secrets/secrets.local.js` ONLY (never committed): `PORT`, `MONGODB_URI` (user `sodaapp`, readWrite on database `soda` only), `ADMIN_KEY`, later payment/SMS keys. Reload with `pm2 reload ecosystem.config.js --update-env` (reloading by name does not re-read it).
- Petro's own deploy webhook only fires for pushes to `claude/petro-platform-build`; pushes to `claude/soda-build` do not touch Petro.
- Atlas: same cluster as Petro, database `soda`, its own limited user.

## Status log
1. (done) Branch `claude/soda-build` created; `soda/` is a file copy of `petro/` at its latest commit (186 tracked files). Still entirely Petro inside (names, Firebase, design) -- the steps below change that.
2. (next) VPS prep: secrets file + folder + pm2 entry (owner runs commands). Atlas user `sodaapp` created by owner.
3. Rename pass: one-place brand name, remove Petro names/hosts/ids, new package name.
4. Replace Firebase auth with MongoDB auth (server + client + tests).
5. Single-host routing (/api, secret admin path), admin-editable host.
6. Design from the owner's images.
7. Web Push (own VAPID) for admin alerts.
