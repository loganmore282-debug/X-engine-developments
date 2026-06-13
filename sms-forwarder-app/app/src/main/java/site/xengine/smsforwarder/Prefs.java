package site.xengine.smsforwarder;

import android.content.Context;
import android.content.SharedPreferences;

/** Tiny wrapper around SharedPreferences for the app's settings. */
public final class Prefs {
    private static final String FILE = "xe_sms";
    private static final String K_URL = "url";
    private static final String K_SECRET = "secret";
    private static final String K_ACTIVE = "active";
    private static final String K_SENDERS = "senders";

    private final SharedPreferences sp;

    public Prefs(Context ctx) {
        sp = ctx.getApplicationContext().getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    public String url() { return sp.getString(K_URL, ""); }
    public String secret() { return sp.getString(K_SECRET, ""); }
    public boolean active() { return sp.getBoolean(K_ACTIVE, false); }
    // Comma-separated list of sender names/numbers to forward. Empty = forward all.
    public String senders() { return sp.getString(K_SENDERS, "MTN,MTNMoMo,m-money,MoMo,Airtel,AirtelMoney,Airtel Money"); }

    public void save(String url, String secret, String senders) {
        sp.edit().putString(K_URL, url.trim())
                 .putString(K_SECRET, secret.trim())
                 .putString(K_SENDERS, senders.trim())
                 .apply();
    }

    public void setActive(boolean v) { sp.edit().putBoolean(K_ACTIVE, v).apply(); }
}
