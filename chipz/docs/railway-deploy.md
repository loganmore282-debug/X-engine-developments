# Running Chipz on Railway

Render suspended the account (for "suspicious activity", under review), so this
is the whole platform from scratch on Railway. Nothing here needs Render to be
working.

**Three services, all from this one repo, all with root directory `chipz`:**

| service | what it is | start command |
|---|---|---|
| `chipz-server` | the backend (Express + Mongo + Firebase) | `npm start` |
| `chipz-app` | the member app (`chipz/user/`) | `node static-server.js user` |
| `chipz-admin` | the admin panel (`chipz/admin/`) | `node static-server.js admin` |

Railway has no "static site" type, so the two front-ends are ordinary Node
services. `static-server.js` is a zero-dependency file that serves a folder and
applies the same security headers Render used to apply from `render.yaml`. That
is the only structural difference from the Render setup.

---

## 0. If Railway is on a different GitHub account than the repo

Railway's trial had expired on the account that owns the repo, so a second
GitHub account (`temubrazil599-rgb`) deploys it. **That account needs a FORK.**

**Adding it as a collaborator does NOT work, and this was tried first.** The
Railway GitHub App is installed on an *account*, and an App can only be granted
access to repositories that account **owns**. Collaborator access is a
permission on the person, not on the App, so the shared repo never appears in
Railway's repository list at all — the symptom is "No repositories found" with
the invite already accepted, which looks like a Railway bug and is not one.

So:

1. On `loganmore282-debug/X-engine-developments`, signed in as the deploying
   account: **Fork**, and **untick "Copy the default branch only."** The default
   branch is `claude/voltra-session-continue-mk95gw` (a sibling project) and
   Chipz lives on `claude/chipz-platform-build` — with that box left ticked the
   fork arrives without a single line of Chipz in it. Check the fork's branch
   selector afterwards and confirm `claude/chipz-platform-build` is listed.
2. In Railway, signed in as that account: **Configure GitHub App** → grant it the
   fork → **Refresh**. A repository the App has not been given access to
   specifically does not appear, even when the account owns it.

**The fork is a deploy mirror, not a second codebase.** Development stays on
`loganmore282-debug`; the fork's **Sync fork** button pulls each push across, and
Railway deploys from it. Nothing is ever committed to the fork directly — two
codebases drift, and only one of them gets the next fix.

If the deploying account ever becomes the one doing the work, the honest move is
to start a session sourced from the fork so pushes land there directly, rather
than syncing by hand every round.

## 1. Create the three services

For each one: **New → GitHub Repository → this repo**, then in the service's
settings:

- **Root directory:** `chipz`. Not optional — see the note below on what
  happens when it is left at the repo root.
- **Branch:** `claude/chipz-platform-build`. Also not optional: the repo's
  DEFAULT branch belongs to a sibling project and contains no Chipz at all.
  Railway offers the default branch until you change it.
- **Config file path** — blank for `chipz-server` (it picks up `railway.json`
  from its root directory automatically), and **`railway.app.json` /
  `railway.admin.json` set EXPLICITLY** on the app and the admin panel. This
  one is a trap: with it blank, all three services read the same
  `railway.json`, so both front-ends run `npm start` — the backend — and crash
  on a missing `MONGODB_URI`. Three services, one config file, two of them
  quietly being the wrong app.
- **Generate a domain** for each (Settings → Networking). Note all three.

The config files carry the build command, start command, health-check path and
restart policy, so there is nothing else to set. If you would rather use the
dashboard, the start commands are in the table above; build command is
`npm install` for the backend and nothing at all for the two front-ends, which
have no dependencies by design.

### If the build fails before it reaches any Chipz code

**"Railpack failed to prepare the build"**, failing in 8 seconds, means Railway
looked at the directory it was given and found nothing it recognises as an app.
It is almost always the root directory: the REPO root holds seven unrelated
projects and a `package.json` with **no `start` script**, so there is genuinely
nothing there to run.

Check which commit the failed deployment names. If it is not one of yours, the
branch is wrong as well — both settings tend to be wrong together, because both
default to something.

The root `package.json` is deliberately left without a `start` script. A
service pointed at the wrong directory failing loudly at build time is far
better than one that boots a sibling project's server against Chipz's
database.

---

## 2. Backend environment variables

Set these on **`chipz-server` only**. Railway supplies `PORT` itself — do not
set it.

**Required — nothing works without these:**

| variable | what it is |
|---|---|
| `MONGODB_URI` | Atlas connection string. **Must end in `/chipz`** — `db.js` refuses to boot without that path segment, because the cluster is shared with other apps. |
| `FIREBASE_SERVICE_ACCOUNT` | the whole service-account JSON, as one line |
| `ADMIN_KEY` | the master admin password |

**Payments — set the ones you use:**

| variable | for |
|---|---|
| `MARZPAY_KEY` | MarzPay wallet, base64 of `api_key:api_secret` |
| `PESAJET_API_KEY` | PesaJet, the `pk_…` key |
| `PESAJET_WEBHOOK_SECRET` | PesaJet, the `whsec_…` secret |
| `LIPAPAY_MCHID`, `LIPAPAY_PRIVATE_KEY`, `LIPAPAY_SANDBOX` | LipaPay |
| `MARZSMS_KEY` | admin text alerts on a new withdrawal (optional; skipped silently if unset) |
| `QUOTAGUARDSTATIC_URL` | only if a provider needs a fixed egress IP (LipaPay is why this exists) |

**Manual deposits:**

| variable | for |
|---|---|
| `MANUAL_SMS_SECRET` | authenticates the SMS-forwarder app |
| `FORWARDER_PASSWORD` | optional lock on the forwarder app's settings screen |

**`PUBLIC_URL` — you do not need to set it.** `server.js` now falls back to
`RAILWAY_PUBLIC_DOMAIN`, which Railway sets for you. Set it explicitly only
once a custom domain is live, so payment callbacks point at the domain rather
than the `up.railway.app` address.

Why it matters: `PUBLIC_URL` is what MarzPay and LipaPay are told to call back
on. If it is empty the callback URL is simply **omitted** — the deposit is
still created and the prompt still reaches the phone, so the only symptom is
money taking minutes (the reconciler's next sweep) instead of seconds.

---

## 3. Front-end environment variables

On **`chipz-app` and `chipz-admin`**, set one variable each:

```
CHIPZ_API_ORIGIN = https://<your chipz-server domain>
```

No trailing slash. This is what the `Content-Security-Policy` header names in
`connect-src`, i.e. the only backend the browser will let those pages call.

---

## 4. Point the code at the new backend

The backend origin is also written **inside** the built files — in `API_BASE`,
in the admin panel's `SERVER`, in both `<meta http-equiv="Content-Security-Policy">`
tags, in the icon links, the `og:image`, and both manifests. One command does
all of it:

```
cd chipz
node set-backend-url.js https://<your chipz-server domain>
node build-core.js && node build-admin.js
git add -A . && git commit -m "point Chipz at Railway" && git push
```

`node set-backend-url.js --check` prints where things point now, and fails if
the files disagree with each other.

**The meta tag is the one that catches people out.** A page must satisfy *both*
its meta CSP and the server's header — they intersect, they do not override. So
setting `CHIPZ_API_ORIGIN` alone is not enough: if the meta still names the old
origin, every API call is blocked in the browser with **nothing at all showing
server-side**, and the app displays its own "Network error" over a healthy
backend.

---

## 5. The four things outside Railway that will break if you skip them

1. **Firebase → Authentication → Settings → Authorised domains.** Add the app
   and admin domains. Firebase refuses sign-in from a domain not on that list,
   so without this **nobody can log in** — including you.
2. **MongoDB Atlas → Network Access.** Railway's egress addresses are not
   Render's. If the allowlist is not `0.0.0.0/0`, add Railway's or the server
   cannot reach the database at all.
3. **PesaJet dashboard → Webhook Destination URL** →
   `https://<chipz-server domain>/pesajet/webhook`. There is only one field, and
   the old one points at Render. Their *Test endpoint* button is a safe check —
   a `ping` is answered 200 and touches no money.
4. **MarzPay / LipaPay dashboards** — any callback or IP allowlist entries
   naming the Render host.

Also worth doing, not urgent:

- **The SMS-forwarder app** has the Render URL as its default
  (`MainActivity.java`, `DEFAULT_URL`). The phone's own settings screen can be
  pointed at the new host without rebuilding the APK; the default only matters
  for a fresh install.
- **Admin → Settings → Allowed website domains** needs nothing for Railway —
  `.up.railway.app` and `.railway.app` are built into `CORS_ALLOWED_SUFFIXES`,
  exactly as `.onrender.com` was, so a mistake in that box can never lock you
  out of the panel.

---

## 6. Check it worked, in this order

1. `https://<chipz-server>/health` returns JSON. If not, the backend never
   started — read the deploy log.
2. Open the admin panel and sign in with `ADMIN_KEY`. If it says "Network
   error", it is CORS or CSP, not the server: check step 3 and step 4.
3. Open the member app. The product list and prices come from the backend, and
   **every photo travels inside that JSON** — so "no images" means the API is
   blocked, not that the pictures are missing.
4. Sign in as a member. A failure here is almost always Firebase authorised
   domains.
5. Admin → Countries: confirm Uganda's **Clock offset is 180**. The form shows
   the country's live time as you type, so a wrong value is visible.
6. One real deposit and one real cash-out, smallest amounts.

---

## What did NOT change

`render.yaml` is still in the repo. It is the record of what the headers and
routes were, and it is what you would use if Render's review restores the
account. `static-server.js` reproduces its header set line for line, and
`test-static-server.js` drives the real server over a socket to prove they are
actually sent — not merely written down.

Both hosts have a quirk in common worth knowing: `onrender.com` and
`up.railway.app` are both on the Public Suffix List, so `chipz-app` and
`chipz-server` are separate *sites*, not just separate origins. That is why the
home-banner video route sets `Cross-Origin-Resource-Policy: cross-origin` for
itself — anything else the app ever loads straight from the backend as an
`<img src>`, `<video>`, font or script will need the same treatment.
