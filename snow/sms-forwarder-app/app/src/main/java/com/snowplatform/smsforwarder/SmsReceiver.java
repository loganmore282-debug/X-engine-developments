package com.snowplatform.smsforwarder;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.telephony.SmsMessage;
import android.telephony.SubscriptionInfo;
import android.telephony.SubscriptionManager;
import android.util.Log;

/**
 * Fires on every incoming SMS (even when the app is closed). Reconstructs the
 * full message, works out WHICH SIM in this phone received it, checks the
 * sender against the allow-list, and forwards it to the Snow server. The
 * server decides whether it is a deposit and which pending order it matches.
 */
public class SmsReceiver extends BroadcastReceiver {
    private static final String TAG = "SnowSMS";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !"android.provider.Telephony.SMS_RECEIVED".equals(intent.getAction())) return;

        Prefs prefs = new Prefs(context);
        if (!prefs.active()) return;

        Bundle bundle = intent.getExtras();
        if (bundle == null) return;

        try {
            Object[] pdus = (Object[]) bundle.get("pdus");
            if (pdus == null) return;
            String format = bundle.getString("format");

            StringBuilder fullBody = new StringBuilder();
            String sender = "";
            for (Object pdu : pdus) {
                SmsMessage sms = (format != null)
                        ? SmsMessage.createFromPdu((byte[]) pdu, format)
                        : SmsMessage.createFromPdu((byte[]) pdu);
                if (sms == null) continue;
                fullBody.append(sms.getMessageBody());
                if (sender.isEmpty()) {
                    String addr = sms.getOriginatingAddress();
                    sender = (addr == null) ? "" : addr;
                }
            }

            final String message = fullBody.toString();
            if (message.isEmpty()) return;

            if (!senderAllowed(sender, prefs.senders())) {
                Log.i(TAG, "Ignored SMS from " + sender + " (not in allow-list)");
                return;
            }

            int slot = resolveSimSlot(context, bundle);
            String receivingNumber = prefs.resolveReceivingNumber(slot);

            // See Prefs.resolveReceivingNumber() for why this refuses rather
            // than falling back to "probably the first number" -- guessing
            // here can credit the wrong member for someone else's payment.
            if (receivingNumber.isEmpty()) {
                Log.w(TAG, "DROPPED an allowed SMS: could not tell which SIM received it "
                        + "(subscription slot=" + slot + ", " + prefs.configuredCount()
                        + " numbers configured). Not guessing. Grant the phone permission, "
                        + "or configure only the one number this SIM actually uses.");
                return;
            }

            Log.i(TAG, "Forwarding SMS from " + sender + " received on slot " + slot);
            Poster.post(prefs.url(), prefs.secret(), message, sender, receivingNumber, null);
        } catch (Exception e) {
            Log.e(TAG, "onReceive error", e);
        }
    }

    /**
     * Which physical SIM slot took this message. Android puts the subscription
     * id on the broadcast; SubscriptionManager turns that into a slot index
     * (needs READ_PHONE_STATE). Returns -1 when it cannot be determined, which
     * the caller treats as "do not guess".
     */
    private int resolveSimSlot(Context context, Bundle bundle) {
        int subId = -1;
        try {
            if (bundle.containsKey(SubscriptionManager.EXTRA_SUBSCRIPTION_INDEX))
                subId = bundle.getInt(SubscriptionManager.EXTRA_SUBSCRIPTION_INDEX, -1);
            if (subId < 0 && bundle.containsKey("subscription"))
                subId = bundle.getInt("subscription", -1);
        } catch (Exception ignored) {}
        if (subId < 0) return -1;

        try {
            SubscriptionManager sm = (SubscriptionManager)
                    context.getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE);
            if (sm == null) return -1;
            SubscriptionInfo info = sm.getActiveSubscriptionInfo(subId);
            if (info == null) return -1;
            return info.getSimSlotIndex();
        } catch (SecurityException se) {
            // READ_PHONE_STATE not granted -- a single-number install still
            // works fine (resolveReceivingNumber ignores the slot when only
            // one number is configured); a multi-number one will correctly
            // refuse rather than mis-attribute.
            Log.w(TAG, "Cannot read SIM slot (permission not granted)");
            return -1;
        } catch (Exception e) {
            return -1;
        }
    }

    private boolean senderAllowed(String sender, String csv) {
        if (csv == null) return true;
        String list = csv.trim();
        if (list.isEmpty()) return true;            // empty allow-list = forward all
        String s = (sender == null ? "" : sender).toLowerCase();
        for (String part : list.split(",")) {
            String p = part.trim().toLowerCase();
            if (!p.isEmpty() && s.contains(p)) return true;
        }
        return false;
    }
}
