# X-Engine SMS Forwarder

A minimal Android app that reads incoming Mobile Money SMS and forwards them to
the X-Engine server (`POST /sms/incoming`), so deposits can be collected on your
own SIM instead of a payment gateway.

It has **no external dependencies** and stores everything on the device.

## How it works
1. A Mobile Money payment arrives → the SIM gets a "you have received…" SMS.
2. `SmsReceiver` catches the SMS (even when the app is closed), checks the
   sender against the allow-list, and POSTs `{ secret, message, sender }` to the
   server webhook.
3. The server parses the amount, matches it to a pending deposit (by the unique
   tagged amount) and credits the user.

A small foreground service (`ForwardService`) keeps the app alive so the
receiver is not killed by battery optimisation; `BootReceiver` restarts it after
a reboot.

## Build the APK

### Option A — GitHub Actions (no tools needed)
Pushing this folder triggers `.github/workflows/build-sms-apk.yml`. When it
finishes, open the run → **Artifacts** → download `xengine-sms-forwarder`
(contains `app-debug.apk`). Copy it to the phone and install (allow
"unknown sources").

### Option B — Android Studio
Open `sms-forwarder-app/` in Android Studio and run **Build → Build APK(s)**.

## Configure on the phone
1. Install and open **X-Engine SMS**.
2. Grant the SMS and notification permissions.
3. Fill in:
   - **Server webhook URL**: `https://<your-railway>/sms/incoming`
   - **Shared secret**: the same value as `SMS_WEBHOOK_SECRET` on the server
   - **Forward SMS from**: keep the default MTN/Airtel senders, or blank to forward all
4. Tap **Save**, then **START forwarding**.
5. Tap **Send test ping** to confirm the server answers (`HTTP 200`/`HTTP 403`
   means it is reachable; `403` just means the secret/flag isn't set yet).

## Server side
Set these environment variables on the server to enable the feature:
- `SMS_DEPOSITS_ENABLED=true`
- `SMS_WEBHOOK_SECRET=<a long random string, 16+ chars>`
- `MOMO_RECEIVE_NUMBER=<your MoMo number>`

## Notes
- Keep the phone charged, online, and exclude the app from battery optimisation.
- Withdrawals are **not** automated — handle those via the admin panel.
