# Nexus SMS Forwarder

A minimal Android app that reads incoming Mobile Money SMS and forwards them to
the Nexus server (`POST /sms/incoming`), so deposits are detected automatically
on your own SIM.

No external dependencies. Everything is stored on the device.

## How it works
1. A customer sends MoMo to your MTN or Airtel number.
2. The SIM receives an SMS:
   - **MTN:** `You have received UGX 5000 from JOHN DOE, 256771234567 on ...`
   - **Airtel:** `RECEIVED. TID 149730678579. UGX 5,000 from 741234567, JOHN. Bal UGX ...`
3. `SmsReceiver` catches the SMS (even when the app is closed) and POSTs it to the server.
4. The server matches the sender phone to a `pendingDeposit`, credits the user wallet, and notifies them.

## Build the APK

### Option A — Android Studio
1. Clone the repo, open `sms-forwarder-app/` in Android Studio
2. **Build → Build Bundle(s) / APK(s) → Build APK(s)**
3. APK appears at `app/build/outputs/apk/debug/app-debug.apk`

### Option B — Command line
```bash
cd sms-forwarder-app
./gradlew assembleDebug
# APK: app/build/outputs/apk/debug/app-debug.apk
```

## Install & configure on the phone
1. Copy `app-debug.apk` to the phone → install it (allow "unknown sources" in settings)
2. Open **Nexus SMS** → grant SMS and notification permissions
3. Fill in:
   - **Server webhook URL**: `https://nexus-server-production-921f.up.railway.app/sms/incoming`
   - **Shared secret**: the value of `SMS_SECRET` set in Railway Variables
   - **Forward SMS from**: e.g. `MoMoPay,AirtelMoney` — or leave blank to forward all
4. Tap **Save settings**, then **START forwarding**
5. Tap **Send test ping** — you should see `Test result: ok` if the server is reachable

## Required Railway environment variables
| Variable | Value |
|----------|-------|
| `FIREBASE_SERVICE_ACCOUNT` | Full Firebase service account JSON (paste entire file) |
| `ADMIN_KEY` | Admin panel password |
| `SMS_SECRET` | Random string — must match what you enter in the app |
| `MARZPAY_KEY` | Base64-encoded MarzPay credentials (for withdrawals + phone verify) |

## Important phone setup
- Keep the phone **charged** and **online** at all times
- Go to phone Settings → Battery → exclude **Nexus SMS** from battery optimisation
- Do not clear the app from recents — the foreground service keeps it alive
- `BootReceiver` auto-restarts the service after a phone reboot
