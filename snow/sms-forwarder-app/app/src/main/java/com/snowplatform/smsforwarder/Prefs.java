package com.snowplatform.smsforwarder;

import android.content.Context;
import android.content.SharedPreferences;

/** Tiny wrapper around SharedPreferences for the app's settings. */
public final class Prefs {
    private static final String FILE = "snow_sms";
    private static final String K_URL = "url";
    private static final String K_SECRET = "secret";
    private static final String K_ACTIVE = "active";
    private static final String K_SENDERS = "senders";
    private static final String K_RECEIVING_NUMBER = "receivingNumber";

    private final SharedPreferences sp;

    public Prefs(Context ctx) {
        sp = ctx.getApplicationContext().getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    public String url() { return sp.getString(K_URL, ""); }
    public String secret() { return sp.getString(K_SECRET, ""); }
    public boolean active() { return sp.getBoolean(K_ACTIVE, false); }
    // Comma-separated list of sender names/numbers to forward. Empty = forward all.
    public String senders() { return sp.getString(K_SENDERS, "MTN,MTNMoMo,m-money,MoMo,Airtel,AirtelMoney,Airtel Money"); }
    // Which of Snow's own admin payment numbers this SIM actually is -- the
    // server matches an incoming SMS to a pending order by (receivingNumber,
    // amount), so this MUST match the number saved for this phone in the
    // admin panel's Payment numbers list (e.g. "0770000001" or
    // "+256770000001" -- either local or international form is accepted,
    // the server normalizes it the same way it normalizes every other
    // phone field).
    public String receivingNumber() { return sp.getString(K_RECEIVING_NUMBER, ""); }

    public void save(String url, String secret, String senders, String receivingNumber) {
        sp.edit().putString(K_URL, url.trim())
                 .putString(K_SECRET, secret.trim())
                 .putString(K_SENDERS, senders.trim())
                 .putString(K_RECEIVING_NUMBER, receivingNumber.trim())
                 .apply();
    }

    public void setActive(boolean v) { sp.edit().putBoolean(K_ACTIVE, v).apply(); }
}
