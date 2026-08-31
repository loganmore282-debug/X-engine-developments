package com.snowplatform.smsforwarder;

import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.BatteryManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Periodic "this phone is alive" ping.
 *
 * Without it, a phone that has stopped working is indistinguishable from a
 * quiet one: no SMS arriving looks exactly the same whether the number is
 * simply idle or the app was killed, the SIM pulled, or the handset left on
 * a dead battery. The admin panel can only claim a number is healthy if the
 * phone actually says so on a timer.
 *
 * Carries nothing sensitive: the numbers this install covers (which the
 * server already knows), the app version, whether forwarding is switched on,
 * and the battery level, so an admin can see a phone about to die before it
 * does.
 */
public final class Heartbeat {

    /** Every 15 minutes. The server treats 45 minutes of silence as stale. */
    public static final long INTERVAL_MS = 15 * 60 * 1000L;

    private Heartbeat() {}

    public static void sendAsync(final Context ctx) {
        final Context app = ctx.getApplicationContext();
        new Thread(new Runnable() {
            @Override public void run() { sendSync(app); }
        }).start();
    }

    static void sendSync(Context ctx) {
        Prefs prefs = new Prefs(ctx);
        String url = prefs.url();
        String secret = prefs.secret();
        if (url == null || url.isEmpty() || secret == null || secret.isEmpty()) return;
        if (prefs.configuredCount() == 0) return;

        HttpURLConnection c = null;
        try {
            // The heartbeat endpoint sits beside the forwarder webhook.
            String base = url.replace("/deposit/manual/sms-forwarder", "");
            URL u = new URL(base + "/deposit/manual/forwarder-heartbeat");

            JSONArray nums = new JSONArray();
            for (String n : prefs.allNumbers()) if (n != null && !n.isEmpty()) nums.put(n);

            JSONObject body = new JSONObject();
            body.put("secret", secret);
            body.put("numbers", nums);
            body.put("device", Poster.deviceName());
            body.put("appVersion", BuildConfig.VERSION_NAME);
            body.put("forwarding", prefs.active());
            int bat = batteryPercent(ctx);
            if (bat >= 0) body.put("battery", bat);

            c = (HttpURLConnection) u.openConnection();
            c.setRequestMethod("POST");
            c.setConnectTimeout(15000);
            c.setReadTimeout(20000);
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            c.setRequestProperty("x-sms-secret", secret);
            try (OutputStream os = c.getOutputStream()) {
                os.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }
            c.getResponseCode();   // fire and forget; a missed beat is not an error
        } catch (Exception ignored) {
            // A failed heartbeat is itself the signal -- the server notices
            // the silence. Never let it disturb forwarding.
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static int batteryPercent(Context ctx) {
        try {
            Intent i = ctx.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
            if (i == null) return -1;
            int level = i.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
            int scale = i.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
            if (level < 0 || scale <= 0) return -1;
            return Math.round(level * 100f / scale);
        } catch (Exception e) {
            return -1;
        }
    }
}
