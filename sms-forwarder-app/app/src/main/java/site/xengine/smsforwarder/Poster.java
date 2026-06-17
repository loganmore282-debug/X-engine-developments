package site.nexusug.smsforwarder;

import android.util.Log;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Posts a single SMS to the server's /sms/incoming webhook. */
public final class Poster {
    private static final String TAG = "NexusSMS";

    /** Runs the network call on a background thread. */
    public static void post(final String url, final String secret,
                            final String message, final String sender,
                            final Callback cb) {
        new Thread(new Runnable() {
            @Override public void run() {
                String result = postSync(url, secret, message, sender);
                if (cb != null) cb.onResult(result);
            }
        }).start();
    }

    public static String postSync(String url, String secret, String message, String sender) {
        if (url == null || url.isEmpty()) return "No server URL set";
        HttpURLConnection c = null;
        try {
            JSONObject body = new JSONObject();
            body.put("secret", secret);
            body.put("message", message);
            body.put("sender", sender == null ? "" : sender);

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

    public interface Callback { void onResult(String result); }
}
