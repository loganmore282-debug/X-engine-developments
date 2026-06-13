package site.xengine.smsforwarder;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.telephony.SmsMessage;
import android.util.Log;

/**
 * Fires on every incoming SMS (even when the app is closed). Reconstructs the
 * full message, checks the sender against the allow-list, and forwards it to
 * the X-Engine server. The server decides whether it is a deposit.
 */
public class SmsReceiver extends BroadcastReceiver {
    private static final String TAG = "XEngineSMS";

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

            Log.i(TAG, "Forwarding SMS from " + sender);
            Poster.post(prefs.url(), prefs.secret(), message, sender, null);
        } catch (Exception e) {
            Log.e(TAG, "onReceive error", e);
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
