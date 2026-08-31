# Snow SMS Forwarder

A minimal Android app that reads incoming Mobile Money SMS on one of Snow's
admin payment phones and forwards them to the Snow server
(`POST /deposit/manual/sms-forwarder`), so manual-method deposits are matched
and credited automatically.

This is a fork of the sibling Nexus project's own `sms-forwarder-app/`
(repo root), adapted for Snow's multi-number manual-deposit design. Install
one copy per admin payment phone. **A dual/triple-SIM phone can cover
several Snow payment numbers from a single install** — one number per SIM
slot — so you need fewer phones as the number pool grows. Never edit the
root `sms-forwarder-app/` from here; it's Nexus's own live deployment.

## Which messages get forwarded

Mobile-money SMS arrive from exactly two sender IDs, for money in and money out alike:
**MTNMobMoney** and **AirtelMoney**. The app forwards only those, and this is **fixed in
code, not a setting** — there is nothing to mistype or accidentally clear on one phone.

The match is deliberately loose (does the sender ID contain "mtn" or "airtel") rather
than an exact string, because an operator can change its sender ID without warning and
an exact match would silently forward nothing at all. Being slightly generous costs
nothing: the server decides what is actually a deposit, so any unrelated operator
message is simply ignored there.

## Multi-SIM: how a message gets attributed, and why it can refuse

Android tells the app which SIM subscription received each SMS; the app maps
that to a SIM slot and sends the number you configured for that slot.

If it *cannot* work out which SIM received a message and you have two or more
numbers configured, **it drops the message instead of guessing.** That is
deliberate. The server matches a payment by (receiving number, amount), and
Snow's own number-assignment deliberately gives different payment numbers the
same amount at the same time — so reporting the wrong number does not fail
harmlessly, it can credit a completely different member for someone else's
money. A dropped SMS is recoverable (the member's paste-SMS fallback and the
admin review queue both still catch it); a wrong credit is not.

In practice this only happens if the phone permission is denied. Grant
"phone" permission when asked, or configure just the one number that SIM
uses — a single-number install ignores slot detection entirely and always
works.

No external dependencies. Everything is stored on the device.

## Access password (optional)

Set `FORWARDER_PASSWORD` on the `snow-server` Render service and the app asks for it
every time someone opens it, before the settings screen appears. **Forwarding is not
gated by it** — a locked phone keeps receiving SMS, forwarding them and crediting
deposits exactly as before; the password only guards the settings screen.

Be clear about what this does and does not do. It stops someone **picking up an
unattended admin phone** and changing a receiving number to their own or stopping
forwarding. It is **not** anti-tamper: an APK can always be decompiled, patched and
resigned, so no check inside the app can stop someone determined who has the file.
What actually stops a modified app is `MANUAL_SMS_SECRET`, which the server verifies
on every forwarded message.

The password lives on the server, not in the APK, for two reasons: there is nothing in
the file to read it out of, and it can be changed centrally without rebuilding and
reinstalling on every phone.

- Leave `FORWARDER_PASSWORD` unset and the lock is off — the app opens straight to
  settings, exactly as before.
- Change it on Render and every phone picks up the new password the next time it is
  opened. Clear it and every phone opens freely again.
- After one successful unlock the password is cached on the phone as a PBKDF2 hash, so
  a phone with no signal can still be opened. The hash is only ever written **after the
  server has confirmed** the password, and it is dropped the moment the server rejects
  that password, so a stale one can never keep opening the app.
- Five wrong tries triggers a one-minute cooldown on the phone, and the server
  separately throttles guessing to 10 attempts a minute per address.
- A phone that has not been set up yet (no server URL or secret entered) is never
  locked — there is nothing to protect, and locking it would strand whoever is
  installing it.

## How it works
1. A member is assigned one of Snow's admin payment numbers and sends money to it.
2. That number's SIM receives an SMS:
   - **MTN:** `You have received UGX 50,000 from JOHN DOE, 256771234567 on ...`
   - **Airtel:** `RECEIVED. TID 149730678579. UGX 30,000 from 741234567, JOHN. Bal UGX ...`
3. `SmsReceiver` catches the SMS (even when the app is closed) and POSTs it to the
   server, along with which admin number it was received on.
4. The server matches (receiving number, amount) to a pending manual deposit order,
   credits the member's wallet, and (if the match is ambiguous or the sender phone
   disagrees) flags it for a human to review in the admin panel instead of guessing.

## Build the APK

### Option A — Android Studio
1. Clone the repo, open `snow/sms-forwarder-app/` in Android Studio
2. **Build → Build Bundle(s) / APK(s) → Build APK(s)**
3. APK appears at `app/build/outputs/apk/debug/app-debug.apk`

### Option B — Command line
```bash
cd snow/sms-forwarder-app
./gradlew assembleDebug
# APK: app/build/outputs/apk/debug/app-debug.apk
```

## Install & configure on each admin phone
1. Copy `app-debug.apk` to the phone → install it (allow "unknown sources" in settings)
2. Open **Snow SMS** → grant SMS, phone and notification permissions
3. Fill in:
   - **Server webhook URL**: `https://mylifeismyhappiness.onrender.com/deposit/manual/sms-forwarder`
   - **Shared secret**: the value of `MANUAL_SMS_SECRET` set on Render
   - **SIM slot 1 / SIM slot 2 / …**: the Snow payment number each SIM in this phone
     actually uses, exactly as saved in the admin panel's Settings → Manual payments →
     Payment numbers list (e.g. `0770000001`). The app labels each slot with the carrier
     it detects, so slot 1 might read "SIM slot 1 (MTN)" and slot 2 "SIM slot 2 (Airtel)".
     Leave a slot blank if that SIM is not a Snow payment number.
4. Tap **Save settings**, then **START forwarding**
5. Tap **Send test ping** — you should see `Test result: HTTP 200` if the server is reachable

**Each number must match the admin panel exactly** — the server matches an incoming SMS
to a pending order by (receiving number, amount), so a wrong or blank value means genuine
deposits on that number will never match. Putting a number in the wrong slot is worse
than leaving it blank: messages get attributed to the wrong number.

Since v1.7 the app checks this for you instead of leaving it to be discovered later:

- Each slot has a **Choose from saved numbers** button that lists the real payment
  numbers from the admin panel, so the number can be picked rather than typed.
- Under each slot the app says whether what is entered actually matches — *"Matches Snow
  MTN 1 (MTN Mobile Money)"*, or in red *"NOT a saved payment number"*. Matching ignores
  formatting, so `0770000001` and `+256770000001` are treated as the same number.
- If the carrier stored the SIM's own number, a blank slot is prefilled with it. Many
  Ugandan SIMs do not carry it, which is exactly why this is only a convenience and the
  check above is what decides.
- Starting forwarding with a number that is not in the list asks you to confirm first,
  explaining that deposits to it can never match. It warns rather than blocks, in case
  you are about to add the number in the panel.
- The list is cached after one successful fetch, so a second phone can still be checked
  somewhere with no signal. Tap **Save settings** while online to refresh it after adding
  a number in the panel.

The server is the backstop. If a message still arrives for a number that is not saved, it
is refused with `unknown-number` rather than being quietly treated as unmatched, logged as
`MANUAL_SMS_UNKNOWN_NUMBER`, and listed in **Analytics → Messages from numbers you have not
saved** so it cannot go unnoticed.

## Required Render environment variables (on the `snow-server` service)
| Variable | Value |
|----------|-------|
| `FIREBASE_SERVICE_ACCOUNT` | Full Firebase service account JSON (paste entire file) |
| `MONGODB_URI` | MongoDB Atlas connection string |
| `ADMIN_KEY` | Admin panel master password |
| `MANUAL_SMS_SECRET` | Random string (16+ chars) — must match what you enter in every forwarder app |
| `FORWARDER_PASSWORD` | Optional. Access password for the forwarder app's settings screen (see above). Leave unset to switch the lock off |
| `MARZPAY_KEY` | Base64-encoded MarzPay credentials (for the automatic deposit method + withdrawals) |

## What the admin panel can see about each phone

The app checks in every 15 minutes and every forwarded message carries a little
diagnostic detail, so **Analytics → Payment number activity** can show, per number:

- **Health** — Online (checked in within 45 minutes), Quiet, Offline, or Never seen.
  This is why the heartbeat exists: without it a phone that has been killed, run out
  of battery, or had its SIM pulled looks exactly like a number nobody sent money to.
- **Messages forwarded**, and what became of each — credited, unmatched, ambiguous,
  sender mismatch, duplicate, unreadable, or ignored (an advert).
- **Success rate**, measured only against messages that were real money arriving —
  an operator advert or a duplicate is not a failure of that number.
- **Orders assigned and completed**, deposits credited, and the amount received.
- **Forwarding delay** — how long the phone took between the SMS landing and the POST
  reaching the server, average and worst. Measured on the phone against its own clock,
  so it is not distorted by any difference between handset and server time.
- **Device model, app version, battery level**, and whether forwarding is switched on.
- A **day-by-day breakdown** of all of the above.

Nothing here identifies a member. The heartbeat carries only the numbers this install
already forwards for, the app version, the battery level, and whether forwarding is on.

## Updates

A sideloaded APK has no app store behind it, so nothing updates on its own. The app
therefore checks for itself:

- Every build publishes a small `version.json` next to the APK in the same release. The
  installed app reads it and compares `versionCode`.
- **When you open the app**, it checks quietly and only speaks up if there's a newer
  version, offering an "Update now" button. The APK downloads **inside the app** and
  Android's installer opens straight away — no browser round-trip. There's also a
  "Check for updates" button to ask on demand.
- The first time, Android asks you to allow Snow SMS to install apps ("Allow from this
  source"); the app links you to that exact settings screen. If anything about the
  in-app path is blocked on a given phone, it falls back to opening the download in a
  browser rather than leaving you stuck.
- **While it's running in the background**, the ongoing "Snow SMS active" notification
  changes to "Snow SMS update available (1.3)" — these phones sit untouched forwarding
  SMS, so the notification is the one thing an admin actually sees. Tapping it opens the
  app. It keeps forwarding normally either way; an update is never forced.

Installing over the top **keeps that phone's numbers, secret and settings** — the app is
signed with a fixed keystore committed alongside it, so Android treats each build as a
genuine upgrade rather than a different app.

To publish an update: change the code, bump BOTH `versionCode` and `versionName` in
`app/build.gradle`, and push. CI rebuilds, replaces the APK in the release, and updates
`version.json`; phones notice within about six hours, or immediately if opened.

## Important phone setup
- Keep each phone **charged** and **online** at all times
- Go to phone Settings → Battery → exclude **Snow SMS** from battery optimisation
- Do not clear the app from recents — the foreground service keeps it alive
- `BootReceiver` auto-restarts the service after a phone reboot
- If the forwarder is ever slow or the phone is offline, a member can still paste
  their own confirmation SMS text in the app as a fallback — that queues the
  deposit for admin review instead of leaving it stuck.
