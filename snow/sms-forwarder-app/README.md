# Snow SMS Forwarder

A minimal Android app that reads incoming Mobile Money SMS on one of Snow's
admin payment phones and forwards them to the Snow server
(`POST /deposit/manual/sms-forwarder`), so manual-method deposits are matched
and credited automatically.

This is a fork of the sibling Nexus project's own `sms-forwarder-app/`
(repo root), adapted for Snow's multi-number manual-deposit design — install
ONE copy of this app per admin payment phone, each configured with that
phone's own receiving number. Never edit the root `sms-forwarder-app/`
from here; it's Nexus's own live deployment.

No external dependencies. Everything is stored on the device.

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
2. Open **Snow SMS** → grant SMS and notification permissions
3. Fill in:
   - **Server webhook URL**: `https://mylifeismyhappiness.onrender.com/deposit/manual/sms-forwarder`
   - **Shared secret**: the value of `MANUAL_SMS_SECRET` set on Render
   - **This phone's receiving number**: the SAME number saved for this phone in the
     admin panel's Settings → Manual payments → Payment numbers list (e.g. `0770000001`)
   - **Forward SMS from**: e.g. `MTN,MTNMoMo,Airtel,AirtelMoney` — or leave blank to forward all
4. Tap **Save settings**, then **START forwarding**
5. Tap **Send test ping** — you should see `Test result: HTTP 200` if the server is reachable

**Every admin payment phone needs the receiving number field set correctly** — the
server matches an incoming SMS to a pending order by (receiving number, amount), so a
wrong or blank value here means genuine deposits on that number will never match.

## Required Render environment variables (on the `snow-server` service)
| Variable | Value |
|----------|-------|
| `FIREBASE_SERVICE_ACCOUNT` | Full Firebase service account JSON (paste entire file) |
| `MONGODB_URI` | MongoDB Atlas connection string |
| `ADMIN_KEY` | Admin panel master password |
| `MANUAL_SMS_SECRET` | Random string (16+ chars) — must match what you enter in every forwarder app |
| `MARZPAY_KEY` | Base64-encoded MarzPay credentials (for the automatic deposit method + withdrawals) |

## Important phone setup
- Keep each phone **charged** and **online** at all times
- Go to phone Settings → Battery → exclude **Snow SMS** from battery optimisation
- Do not clear the app from recents — the foreground service keeps it alive
- `BootReceiver` auto-restarts the service after a phone reboot
- If the forwarder is ever slow or the phone is offline, a member can still paste
  their own confirmation SMS text in the app as a fallback — that queues the
  deposit for admin review instead of leaving it stuck.
