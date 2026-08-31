package com.snowplatform.smsforwarder;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * The payment numbers saved in the admin panel.
 *
 * WHY THIS EXISTS: a number typed into this app that is not saved in the
 * panel fails in complete silence. Orders are only ever assigned to real
 * saved numbers, so a message reporting some other number can never match
 * anything -- yet the phone forwards happily, the app looks fine, and the
 * member's money simply never arrives. Checking what was typed against the
 * real list at the moment it is entered turns that into an error you can
 * see and fix in ten seconds.
 *
 * The list is cached on the device after one successful fetch, so setting up
 * a second phone in a spot with no signal still gets checked.
 *
 * These numbers are not secret -- every member is shown one to pay into --
 * so a device that already holds the shared secret learns nothing new.
 */
public final class Directory {

    private static final String FILE = "snow_directory";
    private static final String K_JSON = "numbers";
    private static final String K_AT = "fetchedAt";

    public static final class Entry {
        public final String number, holderName, network;
        public final boolean active;
        Entry(String number, String holderName, String network, boolean active) {
            this.number = number; this.holderName = holderName;
            this.network = network; this.active = active;
        }
        public String label() {
            String s = holderName == null || holderName.isEmpty() ? number : holderName + "  " + number;
            if (!active) s += "  (disabled)";
            return s;
        }
    }

    private final SharedPreferences sp;

    public Directory(Context ctx) {
        sp = ctx.getApplicationContext().getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    public boolean hasCache() { return !sp.getString(K_JSON, "").isEmpty(); }
    public long fetchedAt() { return sp.getLong(K_AT, 0); }

    public List<Entry> cached() {
        List<Entry> out = new ArrayList<>();
        try {
            String raw = sp.getString(K_JSON, "");
            if (raw.isEmpty()) return out;
            JSONArray arr = new JSONArray(raw);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                out.add(new Entry(o.optString("number", ""), o.optString("holderName", ""),
                        o.optString("network", ""), o.optBoolean("active", true)));
            }
        } catch (Exception ignored) {}
        return out;
    }

    /**
     * Is this number one of the saved ones? Compared on digits only, so a
     * "+256770000001" saved in the panel still matches "0770000001" typed on
     * the phone -- the server normalises both to the same value anyway, and
     * rejecting a correct number over its formatting would be its own bug.
     */
    public Entry find(String typed) {
        String want = digits(typed);
        if (want.isEmpty()) return null;
        for (Entry e : cached()) if (digits(e.number).equals(want)) return e;
        return null;
    }

    /** Last 9 digits: the part that is the same however a Ugandan number is written. */
    static String digits(String s) {
        if (s == null) return "";
        String d = s.replaceAll("[^0-9]", "");
        if (d.length() > 9) d = d.substring(d.length() - 9);
        return d;
    }

    public interface Callback { void onResult(boolean ok, List<Entry> numbers, String error); }

    public static void refreshAsync(final Context ctx, final Callback cb) {
        final Context app = ctx.getApplicationContext();
        new Thread(new Runnable() {
            @Override public void run() {
                Directory d = new Directory(app);
                String err = d.refreshSync(app);
                if (cb != null) cb.onResult(err == null, d.cached(), err);
            }
        }).start();
    }

    /** Returns null on success, or a message to show the admin. */
    String refreshSync(Context ctx) {
        Prefs prefs = new Prefs(ctx);
        String url = prefs.url(), secret = prefs.secret();
        if (url == null || url.isEmpty()) return "No server URL set";
        if (secret == null || secret.isEmpty()) return "No shared secret set";
        HttpURLConnection c = null;
        try {
            String base = url.replace("/deposit/manual/sms-forwarder", "");
            URL u = new URL(base + "/deposit/manual/payment-numbers");
            JSONObject body = new JSONObject();
            body.put("secret", secret);

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
            int code = c.getResponseCode();
            if (code == 403) return "The shared secret is wrong";
            if (code != 200) return "Server said HTTP " + code;

            StringBuilder sb = new StringBuilder();
            try (BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = r.readLine()) != null) sb.append(line);
            }
            JSONArray arr = new JSONObject(sb.toString()).optJSONArray("numbers");
            if (arr == null) return "Unexpected reply from the server";
            sp.edit().putString(K_JSON, arr.toString()).putLong(K_AT, System.currentTimeMillis()).apply();
            return null;
        } catch (Exception e) {
            return "Could not reach the server";
        } finally {
            if (c != null) c.disconnect();
        }
    }
}
