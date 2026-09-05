package com.snowplatform.smsforwarder;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.telephony.SmsMessage;
import android.telephony.SubscriptionInfo;
import android.telephony.SubscriptionManager;
import android.telephony.TelephonyManager;
import android.util.Log;

/**
 * Fires on every incoming SMS (even when the app is closed). Reconstructs the
 * full message, works out WHICH SIM in this phone received it, checks the
 * sender against the allow-list, and forwards it to the Snow server. The
 * server decides whether it is a deposit and which pending order it matches.
 */
public class SmsReceiver extends BroadcastReceiver {
    private static final String TAG = "SnowSMS";

    /**
     * Mobile-money SMS arrive from exactly two sender IDs, both for money in
     * AND money out: "MTNMobMoney" and "AirtelMoney". Fixed in code on
     * purpose -- it is not an app setting, so it cannot be mistyped or
     * cleared on one phone and quietly stop that number matching deposits.
     *
     * Matched loosely (does the sender contain "mtn" or "airtel") rather
     * than as an exact string, because an operator can tweak its sender ID
     * without warning and an exact match would silently forward nothing.
     * Being slightly generous is cheap: the SERVER decides what is actually
     * a deposit, so an unrelated operator message just gets ignored there.
     */
    private static final String[] MONEY_SENDERS = { "mtn", "airtel" };

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

            if (!isMoneySender(sender)) {
                Log.i(TAG, "Ignored SMS from " + sender + " (not a mobile-money sender)");
                return;
            }

            int slot = resolveSimSlot(context, bundle);
            String receivingNumber = prefs.resolveReceivingNumber(slot, isSingleSimHardware(context));

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
            // Stamped here, the instant the broadcast fired, so the server can
            // be told how long forwarding actually took on this phone.
            Poster.post(context, prefs.url(), prefs.secret(), message, sender, receivingNumber,
                    System.currentTimeMillis(), null);
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
        return resolveSimSlotFromSubId(context, subId);
    }

    /**
     * Shared with InboxScanner, which reads a subscription id straight out of
     * a stored SMS row's own column rather than a live broadcast's Bundle --
     * the id-to-slot lookup below is identical either way.
     */
    static int resolveSimSlotFromSubId(Context context, int subId) {
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

    /**
     * Whether this DEVICE physically has only one SIM slot -- a hardware
     * capability query (getPhoneCount(), deprecated in favor of
     * getActiveModemCount() on API 30+ but still fully functional, kept for
     * simplicity across this app's supported API range), NOT how many
     * numbers are configured in the app and NOT which SIMs currently have a
     * card inserted. Needs no runtime permission. See
     * Prefs.resolveReceivingNumber()'s own comment for why this distinction
     * is the actual money-safety fix: a dual-SIM phone with only one Snow
     * number configured must still require the SIM slot to be known, not be
     * treated the same as a phone that only HAS one SIM slot to begin with.
     * Unknown (null manager, or any exception) fails toward "not single-SIM"
     * -- i.e. toward requiring slot resolution -- matching this file's own
     * "never guess, drop rather than misattribute" posture throughout.
     */
    @SuppressWarnings("deprecation")
    static boolean isSingleSimHardware(Context context) {
        try {
            TelephonyManager tm = (TelephonyManager) context.getSystemService(Context.TELEPHONY_SERVICE);
            if (tm == null) return false;
            return tm.getPhoneCount() <= 1;
        } catch (Exception e) {
            return false;
        }
    }

    static boolean isMoneySender(String sender) {
        String s = (sender == null ? "" : sender).toLowerCase();
        if (s.isEmpty()) return false;
        for (String m : MONEY_SENDERS) {
            if (s.contains(m)) return true;
        }
        return false;
    }
}
