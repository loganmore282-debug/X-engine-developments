package com.snowplatform.smsforwarder;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Asks the server whether ONE typed number is a real payment number.
 *
 * The app never receives the list. It cannot show a picker, and there is
 * nothing in it to read the numbers out of: the number has to be known and
 * typed, and the server answers only yes or no. That is deliberate -- the
 * saved numbers stay on the backend.
 *
 * WHY THIS EXISTS: orders are only ever assigned to saved numbers, so a
 * phone configured with anything else can never match a deposit -- yet it
 * forwards happily, returns HTTP 200 and looks perfectly healthy while every
 * payment to that SIM is lost. Checking at the moment the number is entered
 * turns a silent, permanent failure into an error on screen.
 *
 * Each answer is cached per number, so a phone that has already verified its
 * numbers still shows their state with no signal. The cache only ever holds
 * numbers somebody typed on this phone; it never learns any others.
 */
public final class NumberCheck {

    private static final String FILE = "snow_numcheck";

    /** What we currently believe about one typed number. */
    public enum State { UNKNOWN_YET, VALID, DISABLED, NOT_FOUND }

    private final SharedPreferences sp;

    public NumberCheck(Context ctx) {
        sp = ctx.getApplicationContext().getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    /** Last 9 digits: the part that is the same however a Ugandan number is written. */
    static String key(String s) {
        if (s == null) return "";
        String d = s.replaceAll("[^0-9]", "");
        if (d.length() > 9) d = d.substring(d.length() - 9);
        return d;
    }

    public State cached(String number) {
        String k = key(number);
        if (k.isEmpty()) return State.UNKNOWN_YET;
        String v = sp.getString(k, "");
        if ("valid".equals(v)) return State.VALID;
        if ("disabled".equals(v)) return State.DISABLED;
        if ("missing".equals(v)) return State.NOT_FOUND;
        return State.UNKNOWN_YET;
    }

    private void remember(String number, State st) {
        String k = key(number);
        if (k.isEmpty()) return;
        String v = st == State.VALID ? "valid" : st == State.DISABLED ? "disabled"
                : st == State.NOT_FOUND ? "missing" : "";
        if (v.isEmpty()) sp.edit().remove(k).apply();
        else sp.edit().putString(k, v).apply();
    }

    public interface Callback { void onResult(State state, String error); }

    public static void checkAsync(final Context ctx, final String number, final Callback cb) {
        final Context app = ctx.getApplicationContext();
        new Thread(new Runnable() {
            @Override public void run() {
                NumberCheck nc = new NumberCheck(app);
                String err = nc.checkSync(app, number);
                if (cb != null) cb.onResult(nc.cached(number), err);
            }
        }).start();
    }

    /** Returns null on success, or a message to show. Leaves the cache alone on failure. */
    String checkSync(Context ctx, String number) {
        if (number == null || number.trim().isEmpty()) return "No number";
        Prefs prefs = new Prefs(ctx);
        String url = prefs.url(), secret = prefs.secret();
        if (url == null || url.isEmpty()) return "No server URL set";
        if (secret == null || secret.isEmpty()) return "No shared secret set";
        HttpURLConnection c = null;
        try {
            String base = url.replace("/deposit/manual/sms-forwarder", "");
            URL u = new URL(base + "/deposit/manual/verify-number");
            JSONObject body = new JSONObject();
            body.put("secret", secret);
            body.put("number", number.trim());

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
            if (code == 429) return "Too many checks, wait a minute";
            if (code != 200) return "Server said HTTP " + code;

            StringBuilder sb = new StringBuilder();
            try (BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = r.readLine()) != null) sb.append(line);
            }
            JSONObject o = new JSONObject(sb.toString());
            boolean known = o.optBoolean("known", false);
            boolean active = o.optBoolean("active", false);
            remember(number, !known ? State.NOT_FOUND : (active ? State.VALID : State.DISABLED));
            return null;
        } catch (Exception e) {
            return "Could not reach the server";
        } finally {
            if (c != null) c.disconnect();
        }
    }
}
