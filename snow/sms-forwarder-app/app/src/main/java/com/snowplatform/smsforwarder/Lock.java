package com.snowplatform.smsforwarder;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.security.spec.KeySpec;

import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;

/**
 * Screen lock for the forwarder's settings UI.
 *
 * WHAT THIS DEFENDS, honestly: someone picking up an unattended admin phone
 * and changing a receiving number to their own, or stopping forwarding. It
 * is NOT anti-tamper -- an APK can always be decompiled, patched and
 * resigned, so no in-app check can stop a determined attacker who has the
 * file. What actually stops a modified app is MANUAL_SMS_SECRET, which the
 * server verifies on every forwarded message.
 *
 * The password lives in FORWARDER_PASSWORD on the server, not in the APK:
 * it can be changed centrally without rebuilding and reinstalling on every
 * phone, and there is nothing in the APK to read it out of.
 *
 * Offline: after one successful unlock the password is cached as a PBKDF2
 * hash so a phone with no signal can still be opened. The hash is only ever
 * written after the server has confirmed the password, so it cannot be used
 * to set a password the server never agreed to.
 *
 * Forwarding is deliberately NOT gated by this. SmsReceiver and
 * ForwardService never consult it, so a locked phone keeps matching and
 * crediting deposits exactly as before.
 */
public final class Lock {

    private static final String FILE = "snow_lock";
    private static final String K_SALT = "salt";
    private static final String K_HASH = "hash";
    private static final String K_FAILS = "fails";
    private static final String K_LOCKED_UNTIL = "lockedUntil";

    private static final int ITERATIONS = 60000;
    private static final int KEY_BITS = 256;
    /** Failed attempts on the device before a cooldown kicks in. */
    private static final int MAX_FAILS = 5;
    private static final long COOLDOWN_MS = 60 * 1000L;

    /** Cleared when the app process dies, so reopening asks again. */
    private static boolean unlockedThisRun = false;

    private final SharedPreferences sp;

    public Lock(Context ctx) {
        sp = ctx.getApplicationContext().getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    public static boolean isUnlockedThisRun() { return unlockedThisRun; }
    public static void markUnlocked() { unlockedThisRun = true; }
    public static void forget() { unlockedThisRun = false; }

    public boolean hasCachedPassword() { return !sp.getString(K_HASH, "").isEmpty(); }

    /** Remaining cooldown in ms after too many wrong guesses, 0 when free. */
    public long cooldownRemaining() {
        long until = sp.getLong(K_LOCKED_UNTIL, 0);
        long left = until - System.currentTimeMillis();
        return left > 0 ? left : 0;
    }

    public void recordFailure() {
        int fails = sp.getInt(K_FAILS, 0) + 1;
        SharedPreferences.Editor e = sp.edit().putInt(K_FAILS, fails);
        if (fails >= MAX_FAILS) {
            e.putLong(K_LOCKED_UNTIL, System.currentTimeMillis() + COOLDOWN_MS).putInt(K_FAILS, 0);
        }
        e.apply();
    }

    public void clearFailures() {
        sp.edit().putInt(K_FAILS, 0).putLong(K_LOCKED_UNTIL, 0).apply();
    }

    /** Stores the password hash locally so later unlocks work with no signal. */
    public void cachePassword(String password) {
        try {
            byte[] salt = new byte[16];
            new SecureRandom().nextBytes(salt);
            String hash = hash(password, salt);
            sp.edit().putString(K_SALT, Base64.encodeToString(salt, Base64.NO_WRAP))
                     .putString(K_HASH, hash).apply();
        } catch (Exception ignored) { /* offline unlock simply stays unavailable */ }
    }

    /** True when the password matches the cached hash. False if none cached. */
    public boolean matchesCached(String password) {
        try {
            String stored = sp.getString(K_HASH, "");
            String saltB64 = sp.getString(K_SALT, "");
            if (stored.isEmpty() || saltB64.isEmpty()) return false;
            String got = hash(password, Base64.decode(saltB64, Base64.NO_WRAP));
            // Constant-time compare so a wrong guess leaks nothing by timing.
            if (got.length() != stored.length()) return false;
            int diff = 0;
            for (int i = 0; i < got.length(); i++) diff |= got.charAt(i) ^ stored.charAt(i);
            return diff == 0;
        } catch (Exception e) {
            return false;
        }
    }

    /** Clears the cached hash, e.g. once the server rejects that password. */
    public void clearCache() {
        sp.edit().remove(K_SALT).remove(K_HASH).apply();
    }

    private static String hash(String password, byte[] salt) throws Exception {
        KeySpec spec = new PBEKeySpec(password.toCharArray(), salt, ITERATIONS, KEY_BITS);
        SecretKeyFactory f = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA1");
        return Base64.encodeToString(f.generateSecret(spec).getEncoded(), Base64.NO_WRAP);
    }

    // ── Server check ──

    public enum Result { OK, WRONG, NOT_REQUIRED, UNREACHABLE }

    public interface Callback { void onResult(Result r); }

    /**
     * Asks the server whether this password is right. Runs off the UI thread;
     * the callback fires on that background thread.
     */
    public static void verifyAsync(final String url, final String secret,
                                   final String password, final Callback cb) {
        new Thread(new Runnable() {
            @Override public void run() { if (cb != null) cb.onResult(verifySync(url, secret, password)); }
        }).start();
    }

    private static Result verifySync(String url, String secret, String password) {
        if (url == null || url.isEmpty()) return Result.UNREACHABLE;
        HttpURLConnection c = null;
        try {
            // The unlock endpoint sits beside the forwarder webhook.
            String base = url.replace("/deposit/manual/sms-forwarder", "");
            URL u = new URL(base + "/deposit/manual/forwarder-unlock");
            JSONObject body = new JSONObject();
            body.put("secret", secret == null ? "" : secret);
            body.put("password", password == null ? "" : password);

            c = (HttpURLConnection) u.openConnection();
            c.setRequestMethod("POST");
            c.setConnectTimeout(12000);
            c.setReadTimeout(15000);
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            c.setRequestProperty("x-sms-secret", secret == null ? "" : secret);
            try (OutputStream os = c.getOutputStream()) {
                os.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }
            int code = c.getResponseCode();
            if (code == 200) {
                // required:false means no password is configured server-side.
                return Result.OK;
            }
            if (code == 401) return Result.WRONG;
            if (code == 429) return Result.WRONG;   // throttled; treat as a refusal
            return Result.UNREACHABLE;
        } catch (Exception e) {
            return Result.UNREACHABLE;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    /**
     * Whether the server has a password configured at all. Used on a fresh
     * install so the app never strands anyone behind a lock that is switched
     * off. Blank password is sent deliberately: the endpoint answers
     * required:false without needing a guess.
     */
    public static void requiredAsync(final String url, final String secret, final Callback cb) {
        new Thread(new Runnable() {
            @Override public void run() {
                Result r = verifySync(url, secret, "");
                // A blank password succeeding can only mean the lock is off.
                if (cb != null) cb.onResult(r == Result.OK ? Result.NOT_REQUIRED : r);
            }
        }).start();
    }
}
