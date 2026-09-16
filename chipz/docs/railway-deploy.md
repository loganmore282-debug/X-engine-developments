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

## 1. Create the three services

For each one: **New → GitHub Repository → this repo**, then in the service's
settings:

- **Root directory:** `chipz`
- **Branch:** `claude/chipz-platform-build`
- **Config file path** (optional, if you want the settings in code rather than
  the dashboard): `railway.json` for the backend, `railway.app.json` for the
  app, `railway.admin.json` for the admin panel. They carry the build/start
  command, the health-check path and a restart policy.
- **Generate a domain** for each (Settings → Networking). Note all three.

Set the start command per the table above if you are not using the config
files. Build command for all three is `npm install` (the two static services
need no dependencies, but `npm install` is harmless and keeps the three
identical).

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
