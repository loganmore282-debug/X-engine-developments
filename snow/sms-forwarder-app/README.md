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
   - **Forward SMS from**: e.g. `MTN,MTNMoMo,Airtel,AirtelMoney` — or leave blank to forward all
4. Tap **Save settings**, then **START forwarding**
5. Tap **Send test ping** — you should see `Test result: HTTP 200` if the server is reachable

**Each number must match the admin panel exactly** — the server matches an incoming SMS
to a pending order by (receiving number, amount), so a wrong or blank value means genuine
deposits on that number will never match. Putting a number in the wrong slot is worse
than leaving it blank: messages get attributed to the wrong number.

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
