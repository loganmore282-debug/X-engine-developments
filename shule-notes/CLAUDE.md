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
- **AI providers:** Claude (`claude.js`) or Google Gemini (`gemini.js`, plain REST, key in the `x-goog-api-key` header); the owner picks which answers first in
  admin > Settings > AI helper (`aiProvider`), pastes each key there (stored in the settings document, never shown again), and `aiFallback` uses the other as a
  backup when it is set up (`ai.js`; a declined question is not passed on). `POST /admin/ai/test` is the panel's "Test the AI helper" button. Gemini Flash models
  are called with thinking off (`thinkingBudget: 0`); Gemini 3 models get `thinkingLevel: 'low'`. A Gemini model that is overloaded (503), slow (30 s timeout) or
  retired (404) is set aside for 3 minutes and the next best Flash from Google's own model list answers instead (`alternatives()` in gemini.js; the admin's
  "Load models from Google" button and "Last problem" line show the real reasons). Gemini is shown only the PAGES that matter (`context.js`: relevant pages,
  or pages spread across the document for a summary question); Claude keeps the whole document because its prompt cache makes that cheap.
  Tests: `test-gemini.js`, `test-context.js`.
- Password hashing: **bcrypt, cost 12** (the owner's explicit requirement; `auth.js`: native `bcrypt` with `bcryptjs` as automatic fallback; both are
  dependencies; hashes are `$2b$12$...`). Max 72 BYTES (bcrypt's limit; refused at sign-up/reset, not silently cut). Old accounts saved as `salt:scrypt`
  still sign in and are upgraded to bcrypt at that sign-in (`needsRehash`), so nobody had to reset. A real bcrypt dummy hash is compared when no account
  matches (and the old scrypt path burns a dummy compare too), so a login attempt costs the same time whether or not the identifier exists.
  Tests: `test-passwords.js`.
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
- **Account and help** (Profile tab): change name via a pencil on the profile card (`/auth/update-profile`; there is NO change-password for
  students, by the owner's choice: a forgotten or unwanted password is reset in the admin Students tab), Help and support and the sign-in
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
- **In-app updates** (`data/AppUpdater.kt`, `ui/components/UpdateScreens.kt`): when `/config` says a newer `latestVersion` exists (or the owner set an oldest allowed
  version), "Update" downloads `API/download/shule-notes.apk` inside the app (progress bar on the Home banner / the blocking screen), checks with
  `getPackageArchiveInfo` that it is THIS package with a HIGHER versionCode, and opens Android's installer through a `FileProvider` (`res/xml/update_paths.xml`,
  cache `updates/` only). The student still taps Install, allows "install unknown apps" for Shule Notes once (`REQUEST_INSTALL_PACKAGES`), and Android only accepts
  an APK signed with the same key. An admin "Update link" that is not an `.apk` (the Google Play page) opens in the browser instead. The very first install of a
  version that has this still has to be done by hand. Once on Google Play, Play updates the app itself.
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

### Payments (passes, MarzPay)
Students buy a TIME PASS with MTN/Airtel mobile money through MarzPay (`backend/payments.js`; routes `/payments/plans`, `/payments/start`,
`/payments/:id/status`, webhook `POST /payments/callback`). Prices (owner's decision): 3 hours 1,000; 1 day 1,500; 1 week 5,000; 1 month 12,500;
3 months 30,000 -- stored in settings (`plans`), edited in admin > Settings > Payments (price + hours + on/off), never trusted from the app.
- **Off by default** (`paymentsEnabled`): nothing is locked until the owner ticks it and pastes the MarzPay key (admin Settings; stored in the
  settings document, never shown again, like the Firebase/Claude keys; `user:key` or the base64 credentials string).
- **The server decides.** `mayRead()` in server.js answers **402 `payment_required`** on `/notes/:id/file`, `/notes/:id/pages` and `/ai/ask`
  for a student with no live pass (`users.accessUntil`) on a note that is not `free`. Notes marked **Free** in admin stay open. Apps and the website
  only show locks (`AccessHolder.kt`, `web/src/Pay.tsx`).
- **Money safety:** a payment goes pending -> paid with ONE atomic `updateOne({status in [pending, expired]})` that only one caller wins; a webhook that
  says "paid" is never trusted -- MarzPay's own status endpoint is asked first; `grantAccess` is serialised per student and STACKS time on any remaining
  pass; `granted:false` payments show "Access missing" in admin with a "Check again" button. `/payments/start` resumes a payment <60s old (double tap).
- Admin: Payments tab (totals, list, search, recheck), Students > Give access / Remove access (a free grant is stored as a `manual` payment and is not
  counted as revenue), Notes > Free tick. Tests: `test-payments.js` (72 checks incl. HTTP routes + the racing webhook/status case).
- **Play Store:** Google requires Play Billing for digital goods sold inside a Play app; the owner chose MarzPay. Do not assume it is allowed in
  Uganda; alternatives are paying on the website only or Google's alternative-billing programs. The server logic does not change either way.

### Speed (server and website)
- `backend/perf.js`: answers that are the same for every student (`/notes`, `/subjects`, `/config`, `/announcements` per class) are built ONCE per
  owner change (revision) and at least every 60 s, kept in memory and sent with an ETag, so a phone that has the current copy gets a **304** and the
  database is not touched; simultaneous callers share one build. `/levels` is static + ETag. `compression` middleware gzips JSON.
- `auth.resolveSession` remembers a found session for 5 s; sign-out, ban, password reset and account removal clear it at once (`forgetUser`) -- any NEW
  code that deletes sessions must call `forgetUser`. `/notes/:id/file` uses `res.sendFile` (304s and Range resume); `?prefetch=1` or a Range request is
  not counted as a read; `POST /notes/:id/opened` counts a read for a prefetched copy. Keep-alive 65 s (above nginx's), graceful SIGTERM, Mongo pool 40.
  Slow requests (>1.5 s) are logged ("slow request:"). Single process on purpose: payment/login locks are in-process (do not cluster without moving them to Mongo).
  Tests: `test-perf.js`.
- Website: the reader (pdf.js) is a lazy chunk (main bundle 609 KB -> 242 KB), preloaded when Home shows; hovering/touching a document starts its PDF download
  (`prefetch.ts`); a service worker (`public/sw.js`) keeps the site's own files (never API data) so repeat visits are instant; Home restores filters and scroll;
  keyboard in the reader (arrows/PageUp/PageDown, +/-, /, A, B, Esc); nginx gzip for text (needs `./setup-web.sh` re-run when nginx-web.conf changes).

### Admin security (admin-session.js, totp.js, audit.js)
- The admin KEY is typed once (`POST /admin/login`); the panel then holds a random session token (stored hashed in `adminSessions`; 8 h idle, 3 days
  absolute, revocable, "sign out other devices"). The key is never kept in the browser. `app.use('/admin', ...)` in server.js authenticates BEFORE any route
  or multer upload runs (`req.isAdmin`; `verifyAdmin(req)` only reads it). The key in a URL or body is NOT accepted; the `x-admin-key` HEADER still works
  for scripts/CI while two-step is off (and `ADMIN_ALLOW_KEY_HEADER=0` turns it off completely).
- 5 wrong keys/codes from an address lock it out 15 min, doubling each time up to 24 h (even the right key is refused while locked); every failed and
  successful sign-in goes to the Activity log (never the key). Optional two-step sign-in (TOTP, RFC 6238 tested against its own vectors, replay-proof):
  Settings > Security. Lost phone: set `ADMIN_DISABLE_2FA=1` in `/etc/shule-notes/.env`, restart, sign in, switch it back on properly.
  Optional `ADMIN_ALLOWED_IPS=1.2.3.4,...` closes the panel to other addresses. Admin answers are `Cache-Control: no-store`.
- The panel page has a CSP meta tag (its API address is the `http://localhost:4000` placeholder that apply.sh rewrites with a NON-global sed: only the FIRST match on each line is replaced, so every `http://localhost:4000` in admin/index.html must be on its own line -- the CSP's img-src and connect-src are on separate lines for this reason; two on one line broke sign-in once),
  a frame-buster, no referrer, and escapes every student-supplied value. Tests: `test-admin-security.js` (36 checks).
- Admin actions are recorded in `auditLog` (kept 1 year); new admin routes that change data should be added to LABELS in `audit.js`.

### Security (read before adding payments)
**Principle: an Android app can never be made impossible to hack or edit. The server must decide everything that matters.**
Sign-in, the AI daily quota, admin rights and (later) who has paid are all enforced on the server; an edited app gains nothing.
When payments arrive: a payment is "paid" ONLY when the provider's signed webhook (or a server-side status check) says so,
never because the app says so; keep paid notes behind the authenticated file route and check entitlement there.
What exists now:
- Backend: bcrypt passwords, hashed session tokens, per-IP limits, **per-phone lock** (`login-guard.js`: 10 wrong passwords in
  15 min locks that number for the rest of the window), admin key compared in constant time with wrong-key limits on ALL admin
  routes, Mongo-operator stripping, helmet, uploads must start with `%PDF-`, avatars/slide images checked by magic bytes.
- App: `signingConfigs.shuletest` = ONE fixed test key committed at `android/app/shule-test-signing.keystore` (password in
  build.gradle.kts; it is a TEST key, not secret) so builds install over each other. The live APK is `assembleRelease`
  (not debuggable) and `Integrity.kt` refuses to run if the signing certificate's SHA-256 differs from `EXPECTED_CERT_SHA256`
  (set in `build-shule-notes-apk.yml`). `SecureWindow` (FLAG_SECURE) blocks screenshots/recording in the reader and AI chat
  (`BuildConfig.SECURE_SCREENS`, off in the debug/emulator build so CI can photograph it). allowBackup=false, no cleartext in release.
- **When publishing to Google Play:** the owner creates a PRIVATE upload key (never commit it), Google re-signs with its own
  app-signing key, so the certificate hash changes: update `EXPECTED_CERT_SHA256` to Google's key (Play Console > App integrity)
  or the app will refuse to run. Then also turn on **R8** (`isMinifyEnabled` + keep rules for the Gson models in `data/`, Retrofit,
  Coil, Firebase) and walk the minified build on the emulator, and add **Play Integrity API** (server verifies the token) before
  any paid feature. R8 and Play Integrity are NOT done yet.
- PDFs: opened PDFs are cached in the app's private cache and "Downloaded for offline" copies live in the app's private storage
  (not visible to other apps or the gallery; readable only with root). They are not encrypted at rest.

### Website (`web/`)
The same app in the browser (owner's request: "exactly like the app"). React + TypeScript + Vite, plain static files, NO server
of its own: it talks to the SAME backend as the phone app (same accounts, notes, subjects, announcements, intro slides, settings),
so anything the owner changes in the admin panel shows on the site and the app together. (Website CODE does not reach the app:
the app is native and only changes when a new APK is installed.) Screens match the app: intro, sign in/up, choose class, Home
(hero, search, announcement, Continue reading, subjects, kind chips, sort), Saved, notifications inbox, Profile (pencil to edit
name, photo, appearance, help, feedback, log out, delete), reader (pdf.js; lazy pages, zoom, page bookmarks, in-document
search from `/notes/:id/pages`, Ask AI drawer, restores the last page). Same look: tokens in `src/styles.css`, light/dark.
Auth: bearer token in localStorage (`api.ts`); `/sync` is polled every 15 s while the tab is visible and reloads the library
when the owner changed anything. The PDF the server sends already carries the footer + logo (stamped server-side).
- API address: `VITE_API_BASE` at build time (default the sslip.io API). The API's `ALLOWED_ORIGINS` MUST list the site's origin.
- Dev: `cd web && npm ci && VITE_API_BASE=http://localhost:4010 npm run dev`.
- **e2e:** `web/e2e/mock-server.cjs` runs the REAL backend (`server.js`) on `fake-mongo` with seeded notes; `e2e/smoke.cjs` drives
  the built site in Chromium (intro -> register -> class -> home -> PDF draws -> search -> profile -> log out -> desktop). CI:
  `.github/workflows/build-shule-notes-web.yml` (also keeps screenshots). Found and fixed real bugs (dialogs trapped under the
  bottom bar by a lingering animation: use `createPortal`; bottom bar hiding the last items).
- Deploy: `deploy/setup-web.sh` (once: nginx site + HTTPS for `web.<ip>.sslip.io`, adds the origin to `ALLOWED_ORIGINS`, writes
  `WEB_DOMAIN` into `/etc/shule-notes/deploy.conf`), then `webhook/setup-webhook.sh` again (installs the updated build/apply
  scripts, keeps the secret). After that every push that changes `shule-notes/web` is built on the VPS (`npm ci --ignore-scripts`,
  type check, `vite build`) and swapped into `/var/www/shule-web`. nginx sends a strict CSP (`deploy/nginx-web.conf`).
- Not built yet on the website: offline downloads, "My progress", sort/recent-search niceties of the app, push notifications,
  PWA install prompt/service worker. PDFs cannot be screenshot-blocked in a browser (the app blocks them with FLAG_SECURE).

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
