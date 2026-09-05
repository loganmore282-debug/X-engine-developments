package com.snowplatform.smsforwarder;

import android.content.Context;
import android.database.Cursor;
import android.provider.Telephony;
import android.util.Log;

/**
 * Owner: "l want it to catch out even previous messages for matching" --
 * SmsReceiver only ever sees an SMS at the exact instant Android delivers the
 * live broadcast for it. If forwarding was off at that moment (not yet
 * activated, or a phone that sat untouched for a while), that message is
 * gone: Android does not redeliver a broadcast later, and nothing here was
 * ever persisted for a retry. This closes that gap from the other end -- the
 * PHONE re-reading its OWN SMS inbox, rather than the server trying to pull
 * from a device that sits behind carrier NAT with no public IP (which is
 * genuinely impossible; see this app's own README history).
 *
 * Runs the exact same sender-allow-list and SIM-attribution rules
 * SmsReceiver uses live, then posts each qualifying message through the same
 * Poster.postSync() call to the same webhook -- so the server's own
 * TID/content-hash dedup safely no-ops on anything already matched earlier,
 * and correctly matches/credits or reversal-processes anything it never saw.
 * No server-side change was needed for this: the webhook has never cared
 * WHEN a message is submitted, only what it says.
 */
final class InboxScanner {
    private static final String TAG = "SnowSMS";

    // Bounds one scan pass so a phone with a very large inbox can't block the
    // service startup path for an unreasonable time. Harmless if it's ever
    // actually hit -- the watermark still advances to the newest message
    // examined, so the NEXT scan (the next activation, or another tap of
    // "Scan for missed messages") picks up exactly where this one stopped.
    private static final int MAX_PER_PASS = 3000;

    private InboxScanner() {}

    interface Callback { void onDone(int examined, int forwarded, int skipped); }

    static void scanAndForwardAsync(final Context context, final boolean forceFullRescan, final Callback cb) {
        final Context app = context.getApplicationContext();
        new Thread(new Runnable() {
            @Override public void run() {
                int[] r = scanAndForwardSync(app, forceFullRescan);
                if (cb != null) cb.onDone(r[0], r[1], r[2]);
            }
        }).start();
    }

    /** @return {examined, forwarded, skipped} */
    static int[] scanAndForwardSync(Context context, boolean forceFullRescan) {
        Prefs prefs = new Prefs(context);
        String url = prefs.url();
        String secret = prefs.secret();
        if (url.isEmpty() || secret.isEmpty() || prefs.configuredCount() == 0) return new int[]{0, 0, 0};

        // 0 (never scanned) already means "the whole inbox" on its own --
        // forceFullRescan just re-applies that same behaviour on demand, for
        // a deliberate re-sweep, without permanently resetting the watermark
        // backwards (it still only ever advances forward once this pass
        // finishes).
        long since = forceFullRescan ? 0L : prefs.lastScannedSmsDate();
        boolean singleSim = SmsReceiver.isSingleSimHardware(context);

        int examined = 0, forwarded = 0, skipped = 0;
        long newestSeen = since;

        Cursor c = null;
        try {
            c = context.getContentResolver().query(
                    Telephony.Sms.Inbox.CONTENT_URI,
                    new String[]{ Telephony.Sms._ID, Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE },
                    Telephony.Sms.DATE + " > ?",
                    new String[]{ String.valueOf(since) },
                    Telephony.Sms.DATE + " ASC");
            if (c == null) return new int[]{0, 0, 0};

            int addrIdx = c.getColumnIndex(Telephony.Sms.ADDRESS);
            int bodyIdx = c.getColumnIndex(Telephony.Sms.BODY);
            int dateIdx = c.getColumnIndex(Telephony.Sms.DATE);
            // Not every device/OEM populates this column, even though the
            // constant itself has existed since API 22 -- read defensively,
            // same as every other "the phone might just not tell us" signal
            // in this app (SIM number detection, carrier name).
            int subIdx = c.getColumnIndex(Telephony.Sms.SUBSCRIPTION_ID);

            while (c.moveToNext() && examined < MAX_PER_PASS) {
                examined++;
                String address = addrIdx >= 0 ? c.getString(addrIdx) : null;
                String body = bodyIdx >= 0 ? c.getString(bodyIdx) : null;
                long date = dateIdx >= 0 ? c.getLong(dateIdx) : 0L;
                if (date > newestSeen) newestSeen = date;

                if (body == null || body.isEmpty() || !SmsReceiver.isMoneySender(address)) {
                    skipped++;
                    continue;
                }

                int subId = -1;
                if (subIdx >= 0) { try { subId = c.getInt(subIdx); } catch (Exception ignored) {} }
                int slot = SmsReceiver.resolveSimSlotFromSubId(context, subId);
                String receivingNumber = prefs.resolveReceivingNumber(slot, singleSim);
                if (receivingNumber.isEmpty()) {
                    Log.w(TAG, "InboxScanner DROPPED a backlog SMS: could not tell which SIM "
                            + "received it. Not guessing -- same rule as live forwarding.");
                    skipped++;
                    continue;
                }

                // No receivedAtMs passed -- this message may be hours or days
                // old, and reporting that as "forward delay" would corrupt
                // the per-number average-delay analytics. Omitting it is the
                // same graceful degradation an older app build already gets.
                String result = Poster.postSync(url, secret, body, address, receivingNumber);
                Log.i(TAG, "Backlog SMS from " + address + " -> " + result);
                forwarded++;
            }
        } catch (SecurityException se) {
            Log.w(TAG, "InboxScanner: READ_SMS not granted, cannot scan the inbox");
            return new int[]{0, 0, 0};
        } catch (Exception e) {
            Log.e(TAG, "InboxScanner error", e);
        } finally {
            if (c != null) try { c.close(); } catch (Exception ignored) {}
        }

        if (newestSeen > prefs.lastScannedSmsDate()) prefs.setLastScannedSmsDate(newestSeen);
        return new int[]{examined, forwarded, skipped};
    }
}
