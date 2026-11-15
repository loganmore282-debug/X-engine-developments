# Shule Notes — Project Memory (read this first)

**What it is:** An Android app where students browse and read PDF notes, past papers and
revision material, with an AI helper that answers questions about whichever document is
open. Content is uploaded only by the owner, via a web admin panel.

**Repo / branch:** `loganmore282-debug/x-engine-developments` — same multi-project repo
as `chipz/`, `voltra/`, `snow/`, etc. This project's code lives under **`shule-notes/`**,
on its own dedicated branch: **`claude/shule-notes-build`**.

## Architecture — three parts

```
shule-notes/
  backend/   Node/Express + MongoDB, deployed on the owner's own VPS (not Railway/Render)
  admin/     one static HTML page -- upload/manage notes, admin-key login
  android/   native Kotlin + Jetpack Compose Android Studio project
```

### Why native Kotlin, and the one real limitation that comes with it
The owner explicitly chose native Kotlin over a web-wrapped app (the pattern every other
project in this repo uses). The sandboxed environment these sessions run in **has no
Android SDK and cannot download one** (`dl.google.com` is blocked by the environment's
network policy) — so Claude cannot compile this project locally the way it runs `node
test-*.js` for every other project here. **GitHub Actions is the verification loop
instead**: `.github/workflows/build-shule-notes-apk.yml` builds a real debug APK with the
real Android SDK on every push to `claude/shule-notes-build` that touches
`shule-notes/android/**`, and publishes it to a GitHub Release (tag `shule-notes-app`) as
a direct-download APK — useful both as Claude's own compile-check and as a way for the
owner to get an installable build without opening Android Studio. **After any Android
code change, check that workflow run before calling the change done** — writing
syntactically plausible Kotlin is not the same guarantee as every other test in this repo,
which is actually executed before being called passing.

### Backend (`backend/`)
- `server.js` — Express app: self-rolled auth (scrypt-hashed passwords + random session
  tokens, stored **hashed**, never raw — `auth.js`), subjects/notes CRUD, PDF upload with
  text extraction (`pdf.js`, via `pdf-parse`), and the AI endpoint (`claude.js`).
- Auth is self-rolled and MongoDB-backed, **not Firebase** — the owner's explicit choice
  for this project (unlike Voltra/Chipz, which use Firebase Auth). Sessions are a random
  32-byte token; only its SHA-256 hash is stored, with a Mongo TTL index doing expiry so
  nothing has to re-check `now < expiresAt` by hand at every call site.
- PDFs are stored as **files on the VPS's own disk** (`UPLOAD_DIR`, default
  `backend/uploads/notes/`), not in Mongo and not in cloud storage — a VPS has real
  persistent disk, unlike Railway/Render's free tiers, so this is the simplest correct
  choice. Served through an **authenticated** route (`GET /notes/:id/file`), never a
  public static directory, so downloads require a signed-in session.
- **The Claude API key lives on this server ONLY.** It is never sent to, or reachable
  from, the Android app — the app calls `/ai/ask` on this backend, which calls Claude
  server-side. This is not a style choice; a key shipped inside an APK is extractable by
  anyone who downloads the app.
- **AI cost control, the actual point of `/ai/ask`'s design:**
  - The note's PDF text is extracted **once**, at upload time, and cached on the note
    document (`extractedText`) — never re-parsed per question.
  - That same text is sent to Claude with **prompt caching**
    (`cache_control: {type: 'ephemeral'}`) on the system block holding it, since many
    students ask different questions about the *same* popular note — roughly 90% cheaper
    on every question after the first for a given document, for free.
  - A **per-user, per-day cap** (`AI_DAILY_LIMIT`, default 20) is enforced by a unique
    index on `(userId, date)` in Mongo (`consumeAiQuota()`), not trusted to in-process
    state — this process may not be the only one running.
  - `AI_MODEL` is a config value, not hardcoded. Anthropic's own current default is their
    most expensive tier; for a free, potentially high-volume student Q&A feature,
    `claude-sonnet-5-5` is the shipped default — change it per `.env.example`'s own note
    if quality or cost need to move.
- Password hashing: `crypto.scryptSync` + `crypto.timingSafeEqual`, same discipline this
  account's other projects use for admin auth (scrypt, salted, constant-time compare).
  A dummy hash is compared even when no account matches, so a login attempt costs the
  same time whether or not the identifier exists.
- Admin auth is a **single shared key** (`ADMIN_KEY`, like Voltra's), not per-admin
  accounts — correct for a one-operator panel; if a second admin is ever needed, that is
  a real feature to add deliberately, not to fake with a shared secret.
- Tests: `test-auth.js`, `test-claude.js`, `test-pdf.js`, `test-server-helpers.js` — all
  run the REAL functions (password hashing, session lifecycle, the AI daily quota, PDF
  text extraction, Claude error classification) against stubbed Mongo/pdf-parse, never a
  real database or a real Claude API call. Run with `npm test` (or `node test-*.js`
  individually) before any backend change is considered done. No real MongoDB server is
  available in the Claude session's sandbox, so every test stubs `./db` via
  `require.cache` rather than needing `mongodb-memory-server` or a live Atlas connection.

### Admin panel (`admin/index.html`)
One static page, no build step (unlike Chipz/Voltra's obfuscated bundles — nothing here
needs that). Set `localStorage.setItem('shule_api_base', 'https://your-backend-url')` in
the browser console once (or edit `window.SHULE_API_BASE` directly in the file) to point
it at the real backend before using it for real.

### Android app (`android/`)
- Kotlin + Jetpack Compose, Material 3. Package `com.shulenotes.app`.
- `data/` — Retrofit (`ApiService`/`ApiClient`) + a DataStore-backed `TokenStore`. The
  auth token is read **synchronously** by an OkHttp interceptor from an in-memory
  `SessionHolder` object (an interceptor cannot suspend to read DataStore), kept in sync
  by `TokenStore.saveToken`/`clearToken`/`primeSessionHolder` (called once at app start).
- `ui/note/PdfDocument.kt` + `PdfPagesView.kt` — the PDF viewer uses the **platform's own
  `android.graphics.pdf.PdfRenderer`** (API 21+), not a third-party PDF library. Keeps the
  APK smaller and avoids a dependency whose exact current Maven coordinates could not be
  verified from this sandbox. Pages render lazily as they scroll into view.
- `ui/chat/` — the "Ask AI" screen for a note. Keeps the last 8 turns of chat and resends
  them with every question (the server has no memory between requests) — capped so a long
  chat session doesn't grow the request, and the Claude bill, without bound.
- Gradle baseline (AGP 8.5.2, Kotlin 2.0.21, compileSdk 34, minSdk 24, targetSdk 34, JDK
  17) matches this repo's own `xengine-app/`, which is proven to build successfully in
  this account's CI — chosen deliberately to minimize the risk of an unverifiable
  dependency mismatch, since this project's own CI run is the only compile check it gets
  before the owner opens it in Android Studio.
- `app/build.gradle.kts`'s `API_BASE_URL` build config field currently points at
  `10.0.2.2:4000` for debug builds (the Android emulator's alias for the host machine's
  `localhost`) and a placeholder for release — **edit both to the real VPS URL** before
  building a release APK or testing against a real phone on the same network as the VPS.

## Deployment (owner does this manually)

### Backend → the owner's own VPS (not Railway/Render)
1. `cd shule-notes/backend && npm install --production`
2. Copy `.env.example` to `.env`, fill in `MONGODB_URI` (MongoDB Atlas, not self-hosted —
   every other project in this account uses Atlas and there is no reason to deviate),
   `ANTHROPIC_API_KEY`, `ADMIN_KEY`, `AI_MODEL`, `ALLOWED_ORIGINS` (the admin panel's URL).
3. Run with a process manager that restarts it (pm2 or a systemd unit) and put Nginx (or
   similar) in front for TLS via Let's Encrypt/certbot — this repo does not include that
   config yet; it is a standard Node-behind-Nginx setup, not specific to this app.
4. `node server.js` refuses to start with no `MONGODB_URI` set (`db.js`) — a fast, loud
   failure instead of a server that starts and then fails every single request.

### Admin panel → wherever the owner hosts static files
Just the one HTML file. Point it at the backend (see above).

### Android app → Google Play, via Android Studio
1. Open `shule-notes/android/` in Android Studio.
2. Edit `app/build.gradle.kts`'s release `API_BASE_URL` to the real backend URL.
3. Generate a signing key and build a release AAB (Android Studio: Build → Generate
   Signed App Bundle) — needed for the Play Console upload; the debug APK from CI is for
   testing only and is not signed for release.
4. Upload to the Play Console. A Google Play Developer account ($25 one-time) is required
   and is the owner's own account, not something this session can create.

## Secrets — never commit
`ANTHROPIC_API_KEY`, `MONGODB_URI`, `ADMIN_KEY` live ONLY in the VPS's `.env` (gitignored).
Android release signing keys live only with the owner, never in this repo.

## Known gaps / not built yet
- No password-reset flow (self-rolled auth has no email/SMS provider wired up yet).
- No Nginx/systemd config checked in — the VPS web-server setup is standard and
  deliberately left to the owner's own preferred approach.
- No app icon beyond a placeholder vector drawable (`android/app/src/main/res/drawable/ic_launcher.xml`) —
  replace with real artwork before a Play Store listing.
- No offline mode — a note's PDF is downloaded fresh each time it's opened (cached only
  for the duration it stays in the app's cache directory).
- Admin panel has no pagination on the notes list (fine at the scale of one school's
  worth of notes; would need it at a much larger library size).
