package com.snowplatform.smsforwarder;

import android.content.Context;
import android.os.Build;
import android.os.PowerManager;
import android.util.Log;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Posts a single SMS to Snow's /deposit/manual/sms-forwarder webhook. */
public final class Poster {
    private static final String TAG = "SnowSMS";

    /** Runs the network call on a background thread. */
    public static void post(final Context context, final String url, final String secret,
                            final String message, final String sender,
                            final String receivingNumber, final Callback cb) {
        post(context, url, secret, message, sender, receivingNumber, 0L, cb);
    }

    /**
     * receivedAtMs is when the SMS actually landed on this phone. Passing it
     * lets the server record how long forwarding took WITHOUT trusting that
     * the handset's clock agrees with the server's: the delay is measured
     * here, against one clock, and only the resulting duration is sent.
     *
     * Subagent-audit-caught real bug: this used to fire a bare background
     * Thread with nothing keeping the process (or CPU) alive for its
     * duration -- SmsReceiver's own onReceive() returns almost immediately
     * once this call returns, and Android gives no guarantee the process
     * keeps running after that. This app's whole design relies on
     * ForwardService's foreground status to protect the process, but there
     * are real windows where that service isn't actually alive at the exact
     * moment an SMS arrives (a crash before START_STICKY restarts it, the
     * narrow window right after boot before BootReceiver starts it) -- and
     * since this app makes exactly ONE attempt with nothing persisted for
     * retry, any SMS caught in that gap is silently and permanently lost,
     * with no log even surviving since the process itself is gone. Fixed
     * with a short, self-timing-out PARTIAL_WAKE_LOCK held for the duration
     * of the POST (released the instant it completes, or by its own 40s
     * safety timeout -- comfortably past the 15s connect + 20s read timeout
     * this call can actually take) -- keeps the CPU (and, more importantly,
     * the process's own scheduling priority) alive independent of whatever
     * state ForwardService happens to be in at that exact moment.
     */
    public static void post(final Context context, final String url, final String secret,
                            final String message, final String sender,
                            final String receivingNumber, final long receivedAtMs,
                            final Callback cb) {
        final PowerManager.WakeLock wakeLock = acquireWakeLock(context);
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    String result = postSync(url, secret, message, sender, receivingNumber, receivedAtMs);
                    if (cb != null) cb.onResult(result);
                } finally {
                    if (wakeLock != null && wakeLock.isHeld()) {
                        try { wakeLock.release(); } catch (Exception ignored) {}
                    }
                }
            }
        }).start();
    }

    private static PowerManager.WakeLock acquireWakeLock(Context context) {
        if (context == null) return null;
        try {
            PowerManager pm = (PowerManager) context.getApplicationContext().getSystemService(Context.POWER_SERVICE);
            if (pm == null) return null;
            PowerManager.WakeLock wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SnowSMS:post");
            wl.setReferenceCounted(false);
            wl.acquire(40000L); // safety timeout -- always releases even if something above goes wrong
            return wl;
        } catch (Exception e) {
            return null;
        }
    }

    public static String postSync(String url, String secret, String message, String sender, String receivingNumber) {
        return postSync(url, secret, message, sender, receivingNumber, 0L);
    }

    public static String postSync(String url, String secret, String message, String sender,
                                  String receivingNumber, long receivedAtMs) {
        if (url == null || url.isEmpty()) return "No server URL set";
        HttpURLConnection c = null;
        try {
            JSONObject body = new JSONObject();
            body.put("secret", secret);
            body.put("message", message);
            body.put("sender", sender == null ? "" : sender);
            // Snow assigns members one of several admin payment numbers and
            // matches an incoming SMS to a pending order by
            // (receivingNumber, amount) -- the server has no other way to
            // know which of its own numbers this SIM corresponds to.
            body.put("receivingNumber", receivingNumber == null ? "" : receivingNumber);
            // Measured at the moment of the attempt, so a retry after a
            // dropped connection honestly reports the longer delay rather
            // than the first try's.
            if (receivedAtMs > 0) {
                long delay = System.currentTimeMillis() - receivedAtMs;
                if (delay >= 0) body.put("forwardDelayMs", delay);
            }
            body.put("device", deviceName());
            body.put("appVersion", BuildConfig.VERSION_NAME);

            byte[] out = body.toString().getBytes(StandardCharsets.UTF_8);
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setRequestMethod("POST");
            c.setConnectTimeout(15000);
            c.setReadTimeout(20000);
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            c.setRequestProperty("x-sms-secret", secret);
            try (OutputStream os = c.getOutputStream()) {
                os.write(out);
            }
            int code = c.getResponseCode();
            Log.i(TAG, "POST " + url + " -> " + code);
            return "HTTP " + code;
        } catch (Exception e) {
            Log.e(TAG, "post failed", e);
            return "Error: " + e.getMessage();
        } finally {
            if (c != null) c.disconnect();
        }
    }

    /** Something an admin can recognise in the panel, e.g. "Samsung SM-A047F". */
    static String deviceName() {
        String man = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER;
        String mod = Build.MODEL == null ? "" : Build.MODEL;
        if (mod.toLowerCase().startsWith(man.toLowerCase())) return mod;
        return (man + " " + mod).trim();
    }

    public interface Callback { void onResult(String result); }
}
