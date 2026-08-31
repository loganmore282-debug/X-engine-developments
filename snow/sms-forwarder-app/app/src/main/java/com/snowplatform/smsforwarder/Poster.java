package com.snowplatform.smsforwarder;

import android.content.Context;
import android.os.Build;
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
    public static void post(final String url, final String secret,
                            final String message, final String sender,
                            final String receivingNumber, final Callback cb) {
        post(url, secret, message, sender, receivingNumber, 0L, cb);
    }

    /**
     * receivedAtMs is when the SMS actually landed on this phone. Passing it
     * lets the server record how long forwarding took WITHOUT trusting that
     * the handset's clock agrees with the server's: the delay is measured
     * here, against one clock, and only the resulting duration is sent.
     */
    public static void post(final String url, final String secret,
                            final String message, final String sender,
                            final String receivingNumber, final long receivedAtMs,
                            final Callback cb) {
        new Thread(new Runnable() {
            @Override public void run() {
                String result = postSync(url, secret, message, sender, receivingNumber, receivedAtMs);
                if (cb != null) cb.onResult(result);
            }
        }).start();
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
