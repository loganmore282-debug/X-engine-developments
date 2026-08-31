package com.snowplatform.smsforwarder;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.util.Iterator;

/** Tiny wrapper around SharedPreferences for the app's settings. */
public final class Prefs {
    private static final String FILE = "snow_sms";
    private static final String K_URL = "url";
    private static final String K_SECRET = "secret";
    private static final String K_ACTIVE = "active";
    // Legacy single-number key (v1). Still read once, for migration only.
    private static final String K_RECEIVING_NUMBER = "receivingNumber";
    // v2: JSON object mapping SIM slot index -> that SIM's receiving number,
    // e.g. {"0":"+256770000001","1":"+256750000001"}. One install can now
    // cover every SIM in a dual/triple-SIM phone instead of needing one
    // phone per Snow payment number.
    private static final String K_NUMBERS = "numbersBySlot";

    private final SharedPreferences sp;

    public Prefs(Context ctx) {
        sp = ctx.getApplicationContext().getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    public String url() { return sp.getString(K_URL, ""); }
    public String secret() { return sp.getString(K_SECRET, ""); }
    public boolean active() { return sp.getBoolean(K_ACTIVE, false); }

    /**
     * The configured receiving numbers, keyed by SIM slot index as a string.
     * Transparently migrates a v1 single-number install into slot "0".
     */
    public JSONObject numbersBySlot() {
        String raw = sp.getString(K_NUMBERS, "");
        if (raw.isEmpty()) {
            JSONObject migrated = new JSONObject();
            String legacy = sp.getString(K_RECEIVING_NUMBER, "").trim();
            if (!legacy.isEmpty()) {
                try { migrated.put("0", legacy); } catch (Exception ignored) {}
            }
            return migrated;
        }
        try { return new JSONObject(raw); } catch (Exception e) { return new JSONObject(); }
    }

    public void saveNumbers(JSONObject numbers) {
        sp.edit().putString(K_NUMBERS, numbers == null ? "" : numbers.toString()).apply();
    }

    /** How many SIM slots actually have a number filled in. */
    public int configuredCount() {
        JSONObject o = numbersBySlot();
        int n = 0;
        for (Iterator<String> it = o.keys(); it.hasNext(); ) {
            String k = it.next();
            if (!o.optString(k, "").trim().isEmpty()) n++;
        }
        return n;
    }

    /** Every configured number, in no particular order. Used by the heartbeat. */
    public java.util.List<String> allNumbers() {
        java.util.List<String> out = new java.util.ArrayList<>();
        JSONObject o = numbersBySlot();
        for (Iterator<String> it = o.keys(); it.hasNext(); ) {
            String v = o.optString(it.next(), "").trim();
            if (!v.isEmpty()) out.add(v);
        }
        return out;
    }

    public String numberForSlot(int slot) {
        if (slot < 0) return "";
        return numbersBySlot().optString(String.valueOf(slot), "").trim();
    }

    /**
     * MONEY SAFETY -- the single most important method in this app.
     *
     * The server matches an incoming SMS to a pending deposit by
     * (receivingNumber, amount). Snow's own assignManualNumber() deliberately
     * hands DIFFERENT payment numbers the SAME amount at the same time (that
     * is exactly what its collision-skip does), so reporting the wrong
     * receiving number does not fail safe: it can match a genuine live order
     * belonging to a DIFFERENT member and credit them for someone else's
     * money.
     *
     * So this never guesses:
     *   - Exactly one number configured  -> single-SIM install, use it.
     *   - Two or more configured         -> the SIM slot MUST be known. If it
     *                                       could not be resolved, return ""
     *                                       and the caller drops the SMS.
     *
     * Dropping an SMS is a recoverable failure (the member's own paste-SMS
     * fallback and the admin review queue both still catch it). Crediting the
     * wrong member is not.
     */
    public String resolveReceivingNumber(int simSlot) {
        JSONObject o = numbersBySlot();
        int count = configuredCount();
        if (count == 0) return "";
        if (count == 1) {
            for (Iterator<String> it = o.keys(); it.hasNext(); ) {
                String v = o.optString(it.next(), "").trim();
                if (!v.isEmpty()) return v;
            }
            return "";
        }
        return numberForSlot(simSlot);
    }

    public void save(String url, String secret) {
        sp.edit().putString(K_URL, url.trim())
                 .putString(K_SECRET, secret.trim())
                 .apply();
    }

    public void setActive(boolean v) { sp.edit().putBoolean(K_ACTIVE, v).apply(); }
}
