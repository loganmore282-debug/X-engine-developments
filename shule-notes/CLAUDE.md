# Shule Notes — Project Memory (read this first)

**What it is:** An Android app where students browse and read PDF notes, past papers and
revision material, with an AI helper that answers questions about whichever document is
open. Content is uploaded only by the owner, via a web admin panel.

**Repo / branch:** `loganmore282-debug/x-engine-developments` — same multi-project repo
as `chipz/`, `voltra/`, `snow/`, etc. This project's code lives under **`shule-notes/`**,
on branch **`claude/space8-rename-frontend-rebuild-juurd7`** (it started on
`claude/shule-notes-build`, which is now behind).

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
real Android SDK on every push to the project branch that touches
`shule-notes/android/**`, and publishes it to a GitHub Release (tag `shule-notes-app`) as
a direct-download APK — useful both as Claude's own compile-check and as a way for the
owner to get an installable build without opening Android Studio. **After any Android
code change, check that workflow run before calling the change done** — writing
syntactically plausible Kotlin is not the same guarantee as every other test in this repo,
which is actually executed before being called passing.

### Seeing the app actually run (`ci/` + `shule-notes-screenshots.yml`)
`.github/workflows/shule-notes-screenshots.yml` is the only place the product runs end to
end: it starts the backend against a real MongoDB, drives the admin panel in Chrome
(`ci/admin_capture.js` signs in, creates subjects and uploads the sample PDFs from
`ci/make_sample_pdfs.py`), then installs the debug APK on an emulator and walks through it
(`ci/capture.py`: register, choose a class, browse, switch class, search, open a PDF, Ask AI, log out, wrong password).
Screenshots land on the GitHub Release tagged `shule-notes-screens`. There is no Claude API
key in CI, so a real AI answer is NOT exercised there -- only that a failed answer shows a
readable message.

### Backend (`backend/`)
- `server.js` — Express app: self-rolled auth (scrypt-hashed passwords + random session
  tokens, stored **hashed**, never raw — `auth.js`), subjects/notes CRUD, PDF upload with
  text extraction (`pdf.js`, via `pdfjs-dist` directly -- NOT `pdf-parse`, whose bundled
  2018 pdf.js failed at random with "bad XRef entry" on valid PDFs; needs Node 20+), and
  the AI endpoint (`claude.js`).
- **Accounts are name + phone number + password only. No email anywhere** (the owner asked
  for this). `normalizePhone()` in `server.js` stores one form per number, so 0772123456,
  772123456 and +256772123456 all reach the same account.
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
  text extraction on a real generated PDF, Claude error classification) against stubbed Mongo, never a
  real database or a real Claude API call. Run with `npm test` (or `node test-*.js`
  individually) before any backend change is considered done. No real MongoDB server is
  available in the Claude session's sandbox, so every test stubs `./db` via
  `require.cache` rather than needing `mongodb-memory-server` or a live Atlas connection.

### Admin panel (`admin/index.html`)
One static page, no build step (unlike Chipz/Voltra's obfuscated bundles — nothing here
needs that). Set `localStorage.setItem('shule_api_base', 'https://your-backend-url')` in
the browser console once (or edit `window.SHULE_API_BASE` directly in the file) to point
it at the real backend before using it for real.

Tabs (left sidebar; top strip on phones): **Dashboard** (students, joined this week, AI
questions today, notes live, a 7-day AI chart, students by class, most-read notes, newest
students), **Students** (search name/phone, filter class/status, paging; Reset password
dialog with a generated password + copy, Ban/Unban, Delete), **Notes** (upload, edit
title/description/class/subject, hide/show, delete, views), **Subjects** (+ the "Add
Uganda's standard subjects" button), **Announcements** (one message shown on every
student's Home; on/off, optional end date), **Settings** (AI on/off, per-student daily
AI limit, support phone/WhatsApp/email/hours). Dialogs are our own (`modal()`); never
use `window.confirm`. Server logic lives in `backend/admin-data.js`, `settings.js`,
`accounts.js`; settings are read through a 15-second cache so changes need no restart.
With no SMS provider a forgotten password is reset by the owner in the Students tab; the
app's "Forgot password?" just shows the support contacts from Settings (`GET /config`).
`ci/admin_capture.js` walks all of these tabs and seeds 7 students.

### Android app (`android/`)
- Kotlin + Jetpack Compose, Material 3. Package `com.shulenotes.app`.
- **The owner rejected the first, default-styled version as unprofessional.** The design
  below is deliberate; keep new screens to the same standard and check them on the
  emulator screenshots, not just by compiling.
- **Identity** (`ui/theme/`): green primary, the logo's teal as tertiary, amber for
  anything AI, warm paper background, white cards with a hairline border, light AND dark
  schemes. Poppins (bundled, OFL licence in `android/licenses/`) for headings, titles and
  buttons; the system font for body text.
- **Logo:** the owner supplied it (`android/branding/logo-source.png`: graduation cap on a
  notebook with "SN"). He asked for its dark blue to be green, so
  `branding/make_logo_assets.py` recolours it, removes the white background and writes
  the in-app mark, the launcher icon and the launch-screen icon. Re-run it if the logo
  changes; do not hand-edit the generated PNGs. On the sign-in screens the logo sits
  centred at the top with the "ShuleNotes" wordmark under it (owner's request).
- **Messages to the user** (the owner rejected an inline coloured error box as dated):
  a mistake in one field is shown UNDER that field with a red outline
  (`ShuleTextField(error = ...)`); everything else -- wrong password, no connection,
  "Added to Saved" -- is a floating card that slides down from the top and leaves by
  itself (`Notifier` / `NotifierHost` in `ui/components/Notifier.kt`). Do not add inline
  banners.
- **Classes** (the owner noticed there was no way to choose one): `backend/levels.js` is the
  ONE list (Primary 1-7, Senior 1-6, Uganda's system; edit only that file to change it). It
  is served at `GET /levels`; the admin panel's Class menu and the app both read it. The
  student's class is stored on the account (`POST /auth/class-level`) and mirrored on the
  phone. After the first sign-in (or on launch, for an account with no class) the app shows
  `ChooseClassScreen`; afterwards the class chip in the Home header opens
  `ClassPickerSheet`. Home shows that class's notes plus notes with NO class ("All
  classes") and notes whose class is not in the list; "Show notes from every class" widens
  it for the session only. Subjects have no class (Biology runs across classes). Subject
  tiles only list subjects that have notes in the class on screen.
- **Home design** (modelled on Khan Academy / Quizlet / Studocu patterns): dark green
  gradient header under the status bar with greeting, class chip and a search bar that
  half overlaps it; a "Continue reading" card (last document and page, remembered in
  `SessionStore.recent`; the reader restores that page); subject tiles with an icon
  (`subjectIcon`) in the subject's colour; document cards with a coloured "book cover".
  The header needs light status-bar icons (`StatusBarIcons`), and `MainScreen` turns off
  the Scaffold's top inset so each tab handles the status bar itself.
- **Account and help** (Profile tab): change name (`/auth/update-profile`), change password
  (`/auth/change-password`; 403 = wrong current password), Help and support and the sign-in
  "Forgot password?" both use `SupportDialog` with the contacts from `GET /config`
  (`AppConfigHolder`), Terms (`/terms`) and Privacy pages. Home shows the admin's
  announcement (`GET /announcement`) until dismissed (`SessionStore.dismissedAnnouncement`).
- **Screens:** `ui/auth/` sign in and create account; `ui/main/` one screen with bottom
  tabs Home, Saved (bookmarks, stored on the phone only) and Profile (my class, privacy
  policy, log out, delete account); `ui/note/` the reader; `ui/chat/` the AI helper.
  Shared pieces live in `ui/components/`.
- **Subjects and their icons** (the owner supplied another app's subject list and design as a
  reference and asked for our OWN artwork, so never copy that app's look): `backend/levels.js`
  lists the standard subjects of each level (lower primary, upper primary, O-Level, A-Level,
  checked against NCDC/UNEB sources) and the admin has an "Add Uganda's standard subjects"
  button; its upload form shows only the subjects taught in the chosen class. The icons are
  our own, drawn in `android/branding/subject_icons.py` (one line style, 30% soft fill) and
  generated as `ic_subject_*.xml` vector drawables plus editable SVGs in
  `branding/subject-icons/`. Do not hand-edit the XML; edit the script and re-run it.
  `SubjectTint.kt` picks an icon AND a colour from the subject's NAME (keyword rules, order
  matters), so a subject keeps its look when others are added. A name with no rule gets an
  open book and a colour from its hash.
- `LibraryViewModel` loads the whole library once and filters by class, subject and search
  on the phone. `NoteCache` lets the reader and chat show a note's title without refetching.
- `data/` — Retrofit (`ApiService`/`ApiClient`) + `SessionStore` (DataStore: token, name,
  bookmarks). The token is read **synchronously** by an OkHttp interceptor from the
  in-memory `SessionHolder` (an interceptor cannot suspend). A 401 on a signed-in request
  sets `SessionHolder.expired`, and the nav graph signs the user out. That is why
  `/auth/delete-account` answers a wrong password with 403, not 401.
- **Reader** (`PdfDocument.kt`, `PdfPagesView.kt`): the platform's own `PdfRenderer`, no
  PDF library. Pinch or double-tap zoom WIDENS the pages and re-renders them at higher
  resolution instead of magnifying a bitmap. Two-finger gestures are read in the Initial
  pointer pass so the list cannot steal them. Downloaded PDFs are kept in the cache
  directory and reused (a note's file never changes), so reopening is instant.
- Gradle baseline: AGP 8.5.2, Kotlin 2.0.21, compileSdk/targetSdk 34, minSdk 24, JDK 17.
- `API_BASE_URL` in `app/build.gradle.kts` points at `10.0.2.2:4000` for debug builds (the
  emulator's alias for the host) and a placeholder for release. `src/debug/` allows plain
  HTTP for debug builds only. The privacy policy link is `API_BASE_URL + /privacy`.

### Features added after the first release (all built and walked on the emulator unless noted)
- **Bell + inbox** (`NotificationsScreen`): the owner's live announcements (`GET /announcements`, filtered
  for the student's class), unread badge from `SessionStore.notificationsSeenAt`. Appearance (system/light/dark)
  and Share are in Profile.
- **Notes vs Past papers:** a note has a `kind` (`NOTE_KINDS` in server.js), chosen in the admin upload form;
  Home shows All/Notes/Past papers chips when a class has both. Sort: Newest / Most read (`views`) / A to Z.
- **Offline downloads** (`data/Downloads.kt`): the PDF is copied to app storage, marked on cards, listed in Saved > Downloads.
- **Reader:** in-PDF search over per-page text (`GET /notes/:id/pages`, `note-pages.js`, `PageSearch.kt`),
  single-page bookmarks (stored as "noteId:page"), thin progress bar, last page restored.
- **My progress** (`ProgressScreen`, `StudyStats`): streak, pages this week, notes finished, subjects, 7-day chart,
  all computed on the phone from pages actually read. Recent searches are remembered (max 8).
- **Feedback:** Profile > Send feedback -> `POST /feedback` -> admin Feedback tab (`feedback.js`).
- **Update prompt:** `app-version.js` reads the newest APK version published by the download page; the app shows a
  banner, or a blocking screen if the owner sets "oldest version allowed" in admin Settings (`UpdateScreens.kt`).
  `versionCode` = the CI run number.
- **Push notifications (FCM):** the backend sends with FCM HTTP v1 (`backend/push.js`: service-account JWT ->
  access token -> `messages:send`, no SDK). The owner pastes the service-account JSON ONLY into admin Settings >
  Push notifications (stored in the settings document, never sent to the app or shown again; only
  `project_id`, `client_email`, `private_key` are kept). An announcement can target one class (`classLevel`) and has an
  "Also send a notification" tick-box (only on creating). Topics: `all` and `class_<slug>` (`topicFor`, e.g.
  "Senior 2" -> `class_senior_2`); the app (`push/Push.kt`) subscribes to `all` + its class, re-syncs when the class or
  the Profile > Notifications switch changes, and unsubscribes on log out/delete. `google-services.json`
  (NOT secret) goes in `android/app/`; the google-services plugin is applied only when that file exists, so the
  app still builds and runs without it (Push.sync then does nothing). Channel id `announcements`.

- **Introduction (onboarding):** shown once, before the first sign-in (`SessionStore.introSeen`; never to someone already
  signed in). Slides are made in admin > Introduction (picture shrunk in the browser to 1400px, heading <= 60, text <= 160,
  max 8, reorder, on/off) and stored in the `slides` collection with pictures on disk (`backend/onboarding.js`,
  `media.js`); `GET /onboarding` is public and says `configured` (false = the owner made none, so the app shows its own three
  built-in slides; true with none switched on = no introduction). Design is our own (full-bleed picture, story-style bars,
  one wide button), `ui/onboarding/IntroScreen.kt`. Images load with Coil.
- **Profile photo:** the default picture is the Shule Notes logo (`ProfileAvatar` in `ui/components/Brand.kt`); a student can choose
  a photo (system photo picker, shrunk/straightened to 512px square on the phone, `AvatarImage`), stored on the server disk
  (`POST /auth/avatar`, `GET /auth/avatar` authenticated, `avatarVersion` on the user busts caches, removed with the
  account). No photo on Home any more: its header has the bell only. Profile: centred photo with camera badge, a Log out
  button, a quiet "Delete account" link and the version at the bottom (not rows in a card).

### Not done yet for a Play Store upload
- **Target API level:** still 34. Google Play requires new apps to target a recent Android
  version; check the current requirement and raise compileSdk/targetSdk (needs a newer
  AGP and Gradle) before uploading.
- **Release build:** not minified and never run. Turn on R8 (`isMinifyEnabled`) with keep
  rules for the Gson models in `data/`, and walk that build on the emulator too.
- **AI answers:** never exercised against the real Claude API (no key in CI).
- No self-service password reset (no SMS or email provider wired up); the owner resets it
  from the admin Students tab and the app's "Forgot password?" shows the support contacts.

## Deployment (owner does this manually)

### Backend → the owner's Contabo VPS (not Railway/Render)
Everything is scripted in `shule-notes/deploy/` (read its `README.md`): `setup.sh <api-domain>
<admin-domain> <email>` on a fresh Ubuntu 22.04/24.04 VPS installs Node 20, nginx, HTTPS
(certbot), a locked-down `shule` service user, a systemd unit and the firewall, and writes
`/etc/shule-notes/.env` (generated `ADMIN_KEY`; the owner then adds `MONGODB_URI` and
`ANTHROPIC_API_KEY`). `update.sh` puts new code live; `install-backup.sh` installs `/usr/local/sbin/shule-backup` (nightly 03:17
server time, db + PDFs, verified, 14 days kept, fails loudly, `/var/backups/shule-notes`). The server listens on `127.0.0.1` behind nginx
(`HOST`, `TRUST_PROXY=1`): trust proxy is REQUIRED there, otherwise every student shares one
rate-limit bucket. MongoDB: `deploy/mongodb/setup-mongodb.sh` runs Shule Notes' OWN mongod (service
`shule-mongod`, port 27018, 127.0.0.1 only, auth on, `shule_app` user, writes `MONGODB_URI`);
Atlas is the documented alternative. **The owner's VPS (Contabo) already runs other projects:**
the deploy scripts must only ADD (own user, own port from 4000 up, two new nginx sites, own
Node/Mongo, ufw only if already active) and never remove, replace or reconfigure anything;
`preflight.sh` is a read-only survey. Never SSH into it -- there is no access from here.
`node server.js` refuses to start with no `MONGODB_URI` (`db.js`).
**App download page:** `deploy/publish-apk.sh` serves `/download/` on the API address (nginx, cron `shule-fetch-apk` every 10 min from the `shule-notes-live` GitHub release).
**Auto-deploy:** `deploy/webhook/` (setup-webhook.sh) -- a GitHub push webhook (HMAC-verified, watched branch only)
runs `build.sh` as an unprivileged user (sparse clone, `npm install --ignore-scripts`, `npm test`), then
`apply.sh` as root via one sudo rule (copy live, restart, health check, rollback). Backend + admin only;
infra changes are never auto-applied. `node deploy/webhook/test-webhook.js` tests the hook.

### Admin panel → the same VPS (nginx serves it on its own subdomain)
Just the one HTML file; `setup.sh`/`update.sh` copy it to `/var/www/shule-admin` with the
API address filled in.

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
- No self-service password reset (see above).
- Admin notes list is not paged (fine for one school's worth of notes).
- Backend tests use an in-memory Mongo fake (`fake-mongo.testlib.js`) for admin features;
  it covers only the query operators the code uses -- extend it if a new one is needed.
