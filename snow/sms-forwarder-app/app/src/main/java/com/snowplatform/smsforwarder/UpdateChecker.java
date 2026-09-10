package com.snowplatform.smsforwarder;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.util.Log;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Checks whether a newer APK has been published, so admin phones don't have
 * to be told by hand every time the forwarder changes.
 *
 * A sideloaded APK has no Play Store behind it, so nothing updates on its
 * own. The build publishes a tiny version.json next to the APK in the same
 * GitHub release; this reads it and compares against the installed
 * versionCode. Both files are public, so no token or login is needed on the
 * phone.
 *
 * This never installs anything by itself -- it only reports. The admin taps
 * through to the download and Android's own installer does the rest.
 */
public final class UpdateChecker {

    private static final String TAG = "SnowSMS";
    private static final String BASE =
            "https://github.com/loganmore282-debug/X-engine-developments/releases/download/snow-sms-app/";
    public static final String VERSION_URL = BASE + "version.json";
    public static final String APK_URL = BASE + "snow-sms-forwarder.apk";

    public interface Callback {
        /** latestName is null when the check simply failed (offline, etc). */
        void onResult(boolean updateAvailable, int latestCode, String latestName);
    }

    private UpdateChecker() {}

    public static int installedVersionCode(Context ctx) {
        try {
            PackageInfo pi = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            return (Build.VERSION.SDK_INT >= 28) ? (int) pi.getLongVersionCode() : pi.versionCode;
        } catch (Exception e) {
            return -1;
        }
    }

    public static String installedVersionName(Context ctx) {
        try {
            return ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "?";
        }
    }

    /** Runs the network call on a background thread; callback fires on that thread. */
    public static void checkAsync(final Context ctx, final Callback cb) {
        final int installed = installedVersionCode(ctx);
        new Thread(new Runnable() {
            @Override public void run() {
                HttpURLConnection c = null;
                try {
                    c = (HttpURLConnection) new URL(VERSION_URL).openConnection();
                    c.setConnectTimeout(15000);
                    c.setReadTimeout(20000);
                    c.setInstanceFollowRedirects(true);   // release assets redirect to a CDN host
                    c.setRequestProperty("Accept", "application/json");
                    int code = c.getResponseCode();
                    if (code != 200) {
                        Log.w(TAG, "Update check HTTP " + code);
                        if (cb != null) cb.onResult(false, -1, null);
                        return;
                    }
                    StringBuilder sb = new StringBuilder();
                    BufferedReader r = new BufferedReader(
                            new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8));
                    String line;
                    while ((line = r.readLine()) != null) sb.append(line);
                    r.close();

                    JSONObject o = new JSONObject(sb.toString());
                    int latest = o.optInt("versionCode", -1);
                    String name = o.optString("versionName", "");
                    if (latest < 0) {
                        if (cb != null) cb.onResult(false, -1, null);
                        return;
                    }
                    boolean newer = installed >= 0 && latest > installed;
                    Log.i(TAG, "Update check: installed=" + installed + " latest=" + latest);
                    if (cb != null) cb.onResult(newer, latest, name);
                } catch (Exception e) {
                    Log.w(TAG, "Update check failed: " + e.getMessage());
                    if (cb != null) cb.onResult(false, -1, null);
                } finally {
                    if (c != null) c.disconnect();
                }
            }
        }).start();
    }
}
