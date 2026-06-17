package site.nexusug.smsforwarder;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Restarts the keep-alive service after the phone reboots. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        if (!"android.intent.action.BOOT_COMPLETED".equals(intent.getAction())) return;
        if (new Prefs(context).active()) {
            ForwardService.start(context);
        }
    }
}
