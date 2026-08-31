package com.snowplatform.smsforwarder;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.Settings;
import android.telephony.SubscriptionInfo;
import android.telephony.SubscriptionManager;
import android.text.InputType;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Single-screen setup UI (built in code, no layout files needed):
 *  - server webhook URL + shared secret (the money sender IDs are fixed in code)
 *  - one receiving-number field PER SIM SLOT, so a dual/triple-SIM phone
 *    covers several Snow payment numbers from one install
 *  - Start / Stop forwarding
 *  - Send a test ping to confirm the server is reachable
 */
public class MainActivity extends Activity {

    private static final String DEFAULT_URL =
            "https://mylifeismyhappiness.onrender.com/deposit/manual/sms-forwarder";
    /** Slot fields always shown, even on a phone reporting fewer active SIMs. */
    private static final int MIN_SLOT_ROWS = 2;
    private static final int MAX_SLOT_ROWS = 4;

    private static final String APK_MIME = "application/vnd.android.package-archive";
    private static final String APK_FILENAME = "snow-sms-forwarder.apk";

    private Prefs prefs;
    private long downloadId = -1;
    private BroadcastReceiver downloadWatcher;
    private EditText urlField, secretField;
    private final List<EditText> slotFields = new ArrayList<>();
    private LinearLayout slotBox;
    private TextView status;
    private Button toggleBtn;
    private final List<TextView> slotStatuses = new ArrayList<>();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = new Prefs(this);

        int pad = dp(16);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad, pad, pad);
        root.setBackgroundColor(Color.parseColor("#111111"));

        root.addView(title("Snow SMS Forwarder"));
        root.addView(label("Server webhook URL"));
        urlField = input(prefs.url().isEmpty() ? DEFAULT_URL : prefs.url(), InputType.TYPE_TEXT_VARIATION_URI);
        root.addView(urlField);

        root.addView(label("Shared secret (must match MANUAL_SMS_SECRET on the server)"));
        secretField = input(prefs.secret(), InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        root.addView(secretField);

        root.addView(label("Receiving numbers, one per SIM in this phone"));
        root.addView(hint("Enter the Snow payment number each SIM actually uses, exactly as saved "
                + "in the admin panel. Leave a slot blank if that SIM is not a Snow payment number."));
        slotBox = new LinearLayout(this);
        slotBox.setOrientation(LinearLayout.VERTICAL);
        root.addView(slotBox);
        buildSlotRows();

        root.addView(hint("Forwards only mobile-money messages, from MTNMobMoney and "
                + "AirtelMoney. Fixed in the app on purpose so it cannot be mistyped or "
                + "cleared on one phone."));

        Button saveBtn = button("Save settings");
        saveBtn.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { saveSettings(); }
        });
        root.addView(saveBtn);

        toggleBtn = button("");
        toggleBtn.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { toggleActive(); }
        });
        root.addView(toggleBtn);

        Button testBtn = button("Send test ping");
        testBtn.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { sendTest(); }
        });
        root.addView(testBtn);

        Button updateBtn = button("Check for updates");
        updateBtn.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { checkForUpdate(true); }
        });
        root.addView(updateBtn);

        TextView ver = new TextView(this);
        ver.setText("Installed version " + UpdateChecker.installedVersionName(this));
        ver.setTextColor(Color.parseColor("#6E6E6E"));
        ver.setTextSize(12);
        ver.setPadding(0, dp(10), 0, 0);
        root.addView(ver);

        status = new TextView(this);
        status.setTextColor(Color.parseColor("#9A9A9A"));
        status.setPadding(0, dp(16), 0, 0);
        root.addView(status);

        ScrollView scroll = new ScrollView(this);
        scroll.addView(root);
        setContentView(scroll);

        requestPerms();
        refreshUi();
        checkForUpdate(false);   // quiet on open: only speaks up if there IS one
        verifyEnteredNumbers(true);   // so each slot can say whether its number is real
        maybeAskForPassword(root);
    }

    /**
     * Screen lock. Only guards THIS settings screen -- SmsReceiver and
     * ForwardService never consult it, so a locked phone keeps forwarding and
     * crediting deposits exactly as before.
     *
     * Skipped entirely on a phone that has not been configured yet: a fresh
     * install holds nothing worth protecting, and it avoids stranding someone
     * behind a lock before the server URL and secret are even entered.
     */
    private void maybeAskForPassword(final View content) {
        if (Lock.isUnlockedThisRun()) return;
        if (prefs.url().isEmpty() || prefs.secret().isEmpty()) return;   // not set up yet
        showLockScreen(content);
    }

    private void showLockScreen(final View content) {
        content.setVisibility(View.GONE);

        final LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(24);
        box.setPadding(pad, dp(80), pad, pad);
        box.setBackgroundColor(Color.parseColor("#111111"));

        box.addView(title("Snow SMS"));
        final TextView msg = new TextView(this);
        msg.setTextColor(Color.parseColor("#9A9A9A"));
        msg.setText("Enter the access password to change settings. Forwarding keeps running either way.");
        msg.setPadding(0, 0, 0, dp(16));
        box.addView(msg);

        final EditText pwField = input("", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        box.addView(pwField);

        final Button unlockBtn = button("Unlock");
        box.addView(unlockBtn);

        final ScrollView lockScroll = new ScrollView(this);
        lockScroll.setBackgroundColor(Color.parseColor("#111111"));
        lockScroll.addView(box);
        addContentView(lockScroll, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.MATCH_PARENT));

        final Lock lock = new Lock(this);

        // The server is the authority on whether a password is required at all.
        // If the owner clears FORWARDER_PASSWORD on Render, every phone must
        // open again -- including one still holding a hash of the old password,
        // so the cache is dropped here rather than left to keep asking for a
        // password that no longer exists anywhere.
        Lock.requiredAsync(prefs.url(), prefs.secret(), new Lock.Callback() {
            @Override public void onResult(final Lock.Result r) {
                runOnUiThread(new Runnable() {
                    @Override public void run() {
                        if (isFinishing()) return;
                        if (r == Lock.Result.NOT_REQUIRED) {
                            lock.clearCache();
                            lock.clearFailures();
                            Lock.markUnlocked();
                            lockScroll.setVisibility(View.GONE);
                            content.setVisibility(View.VISIBLE);
                        }
                    }
                });
            }
        });

        unlockBtn.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                long wait = lock.cooldownRemaining();
                if (wait > 0) {
                    msg.setText("Too many wrong tries. Wait " + ((wait / 1000) + 1) + "s.");
                    return;
                }
                final String pw = pwField.getText().toString();
                if (pw.isEmpty()) { msg.setText("Enter the password."); return; }

                // Cached hash first, so a phone with no signal still opens.
                if (lock.matchesCached(pw)) {
                    lock.clearFailures();
                    Lock.markUnlocked();
                    lockScroll.setVisibility(View.GONE);
                    content.setVisibility(View.VISIBLE);
                    return;
                }

                unlockBtn.setEnabled(false);
                msg.setText("Checking...");
                Lock.verifyAsync(prefs.url(), prefs.secret(), pw, new Lock.Callback() {
                    @Override public void onResult(final Lock.Result r) {
                        runOnUiThread(new Runnable() {
                            @Override public void run() {
                                if (isFinishing()) return;
                                unlockBtn.setEnabled(true);
                                if (r == Lock.Result.OK || r == Lock.Result.NOT_REQUIRED) {
                                    lock.cachePassword(pw);   // only ever after the server agreed
                                    lock.clearFailures();
                                    Lock.markUnlocked();
                                    lockScroll.setVisibility(View.GONE);
                                    content.setVisibility(View.VISIBLE);
                                } else if (r == Lock.Result.WRONG) {
                                    // The password may have been changed on the
                                    // server; a stale cached hash must not keep
                                    // opening the app.
                                    lock.clearCache();
                                    lock.recordFailure();
                                    msg.setText("Wrong password.");
                                } else {
                                    msg.setText(lock.hasCachedPassword()
                                            ? "Wrong password (offline)."
                                            : "No connection, and no password saved on this phone yet.");
                                    lock.recordFailure();
                                }
                            }
                        });
                    }
                });
            }
        });
    }

    /** A sideloaded APK never updates itself, so the app asks. */
    private void checkForUpdate(final boolean announceWhenUpToDate) {
        if (announceWhenUpToDate) status.setText("Checking for updates...");
        UpdateChecker.checkAsync(this, new UpdateChecker.Callback() {
            @Override public void onResult(final boolean available, final int latestCode, final String latestName) {
                runOnUiThread(new Runnable() {
                    @Override public void run() {
                        if (isFinishing()) return;
                        if (available) {
                            showUpdateDialog(latestName);
                        } else if (announceWhenUpToDate) {
                            status.setText(latestName == null
                                    ? "Could not check for updates. Check the connection."
                                    : "Up to date (version " + UpdateChecker.installedVersionName(MainActivity.this) + ").");
                        }
                    }
                });
            }
        });
    }

    private void showUpdateDialog(String latestName) {
        new AlertDialog.Builder(this)
                .setTitle("Update available")
                .setMessage("Version " + latestName + " is out. You have "
                        + UpdateChecker.installedVersionName(this) + ".\n\n"
                        + "It downloads here in the app, then Android asks you to confirm "
                        + "the install. Your numbers and secret are kept.")
                .setPositiveButton("Update now", new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface d, int which) { startInAppUpdate(); }
                })
                .setNegativeButton("Later", null)
                .show();
    }

    /**
     * Downloads the new APK inside the app and hands it straight to Android's
     * installer, instead of bouncing the admin out to a browser.
     *
     * Uses DownloadManager plus getUriForDownloadedFile(), which hands back a
     * content:// URI the installer can already read -- so this needs no
     * FileProvider and keeps the app's zero-dependency build. Android still
     * shows its own confirmation screen; nothing installs silently.
     *
     * Every failure path falls back to opening the download in a browser, so
     * a phone that blocks any part of this is never left with no way to update.
     */
    private void startInAppUpdate() {
        // Android 8+ requires per-app permission to install APKs. Send the
        // admin to the exact settings screen rather than failing quietly.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getPackageManager().canRequestPackageInstalls()) {
            new AlertDialog.Builder(this)
                    .setTitle("Allow installing updates")
                    .setMessage("Android needs permission for Snow SMS to install its own updates. "
                            + "Turn on \"Allow from this source\", then tap Update again.")
                    .setPositiveButton("Open settings", new DialogInterface.OnClickListener() {
                        @Override public void onClick(DialogInterface d, int w) {
                            try {
                                startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                        Uri.parse("package:" + getPackageName())));
                            } catch (Exception e) { openInBrowser(); }
                        }
                    })
                    .setNegativeButton("Use browser instead", new DialogInterface.OnClickListener() {
                        @Override public void onClick(DialogInterface d, int w) { openInBrowser(); }
                    })
                    .show();
            return;
        }
        try {
            DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
            if (dm == null) { openInBrowser(); return; }
            // Clear any previous copy so a stale download can never be installed.
            if (downloadId != -1) dm.remove(downloadId);

            DownloadManager.Request req = new DownloadManager.Request(Uri.parse(UpdateChecker.APK_URL));
            req.setTitle("Snow SMS update");
            req.setDescription("Downloading the new version");
            req.setMimeType(APK_MIME);
            req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE);
            req.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, APK_FILENAME);
            downloadId = dm.enqueue(req);

            registerDownloadWatcher();
            status.setText("Downloading update...");
        } catch (Exception e) {
            openInBrowser();
        }
    }

    private void registerDownloadWatcher() {
        if (downloadWatcher != null) return;
        downloadWatcher = new BroadcastReceiver() {
            @Override public void onReceive(Context ctx, Intent intent) {
                long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                if (id != downloadId) return;
                launchInstaller();
            }
        };
        IntentFilter f = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        // Android 14 requires an explicit export flag on runtime receivers.
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(downloadWatcher, f, Context.RECEIVER_EXPORTED);
        else registerReceiver(downloadWatcher, f);
    }

    private void launchInstaller() {
        try {
            DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
            if (dm == null) { openInBrowser(); return; }
            Uri uri = dm.getUriForDownloadedFile(downloadId);
            if (uri == null) { status.setText("Download failed."); openInBrowser(); return; }
            Intent install = new Intent(Intent.ACTION_VIEW);
            install.setDataAndType(uri, APK_MIME);
            install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(install);
            status.setText("Confirm the install when Android asks.");
        } catch (Exception e) {
            status.setText("Could not open the installer.");
            openInBrowser();
        }
    }

    private void openInBrowser() {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(UpdateChecker.APK_URL)));
        } catch (Exception e) {
            toast("No browser to open the download");
        }
    }

    @Override
    protected void onDestroy() {
        if (downloadWatcher != null) {
            try { unregisterReceiver(downloadWatcher); } catch (Exception ignored) {}
            downloadWatcher = null;
        }
        super.onDestroy();
    }

    /** One labelled number field per SIM slot, naming the carrier when the phone tells us. */
    private void buildSlotRows() {
        slotBox.removeAllViews();
        slotFields.clear();
        JSONObject saved = prefs.numbersBySlot();
        String[] carriers = detectCarriers();

        int rows = MIN_SLOT_ROWS;
        for (int i = 0; i < MAX_SLOT_ROWS; i++) {
            if (!saved.optString(String.valueOf(i), "").isEmpty()) rows = Math.max(rows, i + 1);
            if (i < carriers.length && carriers[i] != null) rows = Math.max(rows, i + 1);
        }

        String[] simNumbers = detectSimNumbers();
        slotStatuses.clear();

        for (int i = 0; i < rows; i++) {
            String carrier = (i < carriers.length && carriers[i] != null) ? carriers[i] : null;
            slotBox.addView(label("SIM slot " + (i + 1)
                    + (carrier != null ? " (" + carrier + ")" : " (no SIM detected)")));

            String value = saved.optString(String.valueOf(i), "");
            // Only ever fills a BLANK field. A number already entered is the
            // admin's decision and must not be quietly overwritten by whatever
            // the SIM happens to claim.
            if (value.isEmpty() && i < simNumbers.length && simNumbers[i] != null) value = simNumbers[i];

            final EditText f = input(value, InputType.TYPE_CLASS_PHONE);
            slotBox.addView(f);
            slotFields.add(f);

            final TextView st = hint("");
            slotBox.addView(st);
            slotStatuses.add(st);

        }
        updateSlotStatuses();
    }

    /**
     * Says, per slot, whether the number typed there is a real payment
     * number. The app never holds the list -- it asks the server about the
     * one number entered and is told only yes or no, so there is nothing
     * here to read the saved numbers out of.
     *
     * This is the whole point: a number that is not saved can never match a
     * deposit, because orders are only ever assigned to real saved numbers.
     * Without this the app forwards happily, looks perfectly healthy, and
     * every payment to that phone is quietly lost.
     */
    private void updateSlotStatuses() {
        NumberCheck nc = new NumberCheck(this);
        for (int i = 0; i < slotFields.size() && i < slotStatuses.size(); i++) {
            String typed = slotFields.get(i).getText().toString().trim();
            TextView st = slotStatuses.get(i);
            if (typed.isEmpty()) {
                st.setText("Not used for Snow payments.");
                st.setTextColor(Color.parseColor("#6E6E6E"));
                continue;
            }
            switch (nc.cached(typed)) {
                case VALID:
                    st.setText("Verified: this is a Snow payment number.");
                    st.setTextColor(Color.parseColor("#5BD08A"));
                    break;
                case DISABLED:
                    st.setText("This number is saved but switched off, so no orders are sent "
                            + "to it and nothing will match.");
                    st.setTextColor(Color.parseColor("#E8C468"));
                    break;
                case NOT_FOUND:
                    st.setText("NOT a Snow payment number. Deposits to it can never match. "
                            + "Check the number, or add it in the admin panel.");
                    st.setTextColor(Color.parseColor("#FF6B6B"));
                    break;
                default:
                    st.setText("Not checked yet. Tap Save settings while online to verify it.");
                    st.setTextColor(Color.parseColor("#E8C468"));
            }
        }
    }

    /**
     * Verifies each entered number, one at a time, against the server.
     * Nothing is downloaded: each call sends one number and gets back yes or
     * no, so the saved list never leaves the backend.
     */
    private void verifyEnteredNumbers(final boolean quiet) {
        final List<String> nums = prefs.allNumbers();
        if (nums.isEmpty()) { updateSlotStatuses(); return; }
        for (final String n : nums) {
            NumberCheck.checkAsync(this, n, new NumberCheck.Callback() {
                @Override public void onResult(final NumberCheck.State state, final String error) {
                    runOnUiThread(new Runnable() {
                        @Override public void run() {
                            if (isFinishing()) return;
                            if (error != null && !quiet) toast("Could not check " + n + ": " + error);
                            updateSlotStatuses();
                        }
                    });
                }
            });
        }
    }

    private void saveSettings() {
        prefs.save(urlField.getText().toString(), secretField.getText().toString());
        JSONObject numbers = new JSONObject();
        for (int i = 0; i < slotFields.size(); i++) {
            String v = slotFields.get(i).getText().toString().trim();
            if (!v.isEmpty()) {
                try { numbers.put(String.valueOf(i), v); } catch (Exception ignored) {}
            }
        }
        prefs.saveNumbers(numbers);
        toast("Saved");
        refreshUi();
        // Re-check on every save, so a number added in the panel a moment ago
        // is recognised without touching the phone again.
        verifyEnteredNumbers(false);
    }

    private void toggleActive() {
        if (!prefs.active()) {
            saveSettings();
            if (prefs.url().isEmpty() || prefs.secret().isEmpty()) {
                toast("Enter URL and secret first");
                return;
            }
            if (prefs.configuredCount() == 0) {
                toast("Enter at least one receiving number");
                return;
            }
            // With two or more numbers on one phone, every incoming SMS has to
            // be attributed to the right SIM or it could credit the wrong
            // member -- and that attribution needs READ_PHONE_STATE.
            if (prefs.configuredCount() > 1
                    && checkSelfPermission(Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED) {
                toast("Allow the phone permission to use more than one number");
                requestPerms();
                return;
            }
            // A number that is not saved in the panel can never match a
            // deposit. Warn rather than block: the admin may be about to add
            // it, and refusing outright would strand a legitimate setup.
            String bad = unknownConfiguredNumber();
            if (bad != null) {
                confirmStartAnyway(bad);
                return;
            }
            prefs.setActive(true);
            ForwardService.start(this);
        } else {
            prefs.setActive(false);
            ForwardService.stop(this);
        }
        refreshUi();
    }

    /** The first configured number the server has told us it does not know. */
    private String unknownConfiguredNumber() {
        NumberCheck nc = new NumberCheck(this);
        for (String n : prefs.allNumbers()) {
            // Only a definite NO blocks. A number not yet checked (offline,
            // first setup) must not be treated as wrong -- that would strand
            // a legitimate phone over a question we never got to ask.
            if (nc.cached(n) == NumberCheck.State.NOT_FOUND) return n;
        }
        return null;
    }

    private void confirmStartAnyway(final String bad) {
        new AlertDialog.Builder(this)
                .setTitle("That number is not in the admin panel")
                .setMessage(bad + " is not one of the saved payment numbers.\n\n"
                        + "Members are never told to pay it, so deposits on this SIM can never "
                        + "match and would be lost. Fix the number here, or add it in the admin "
                        + "panel first.\n\nStart forwarding anyway?")
                .setNegativeButton("Go back", null)
                .setPositiveButton("Start anyway", new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface d, int w) {
                        prefs.setActive(true);
                        ForwardService.start(MainActivity.this);
                        refreshUi();
                    }
                })
                .show();
    }

    private void sendTest() {
        saveSettings();
        final String url = prefs.url();
        final String secret = prefs.secret();
        // Test ping goes out as the first configured number -- it only proves
        // the server is reachable and the secret matches.
        final String receivingNumber = prefs.resolveReceivingNumber(0).isEmpty()
                ? firstConfiguredNumber() : prefs.resolveReceivingNumber(0);
        status.setText("Testing...");
        Poster.post(url, secret,
                "TEST: You have received UGX 1 from SNOW TEST. Transaction ID TEST000001.",
                "TEST", receivingNumber,
                new Poster.Callback() {
                    @Override public void onResult(final String result) {
                        runOnUiThread(new Runnable() {
                            @Override public void run() { status.setText("Test result: " + result); }
                        });
                    }
                });
    }

    private String firstConfiguredNumber() {
        JSONObject o = prefs.numbersBySlot();
        for (int i = 0; i < MAX_SLOT_ROWS; i++) {
            String v = o.optString(String.valueOf(i), "").trim();
            if (!v.isEmpty()) return v;
        }
        return "";
    }

    private void refreshUi() {
        boolean on = prefs.active();
        int n = prefs.configuredCount();
        toggleBtn.setText(on ? "STOP forwarding" : "START forwarding");
        status.setText(on
                ? "Status: ACTIVE — listening on " + n + (n == 1 ? " number." : " numbers.")
                : "Status: stopped.");
    }

    private void requestPerms() {
        java.util.ArrayList<String> need = new java.util.ArrayList<>();
        if (checkSelfPermission(Manifest.permission.RECEIVE_SMS) != PackageManager.PERMISSION_GRANTED)
            need.add(Manifest.permission.RECEIVE_SMS);
        if (checkSelfPermission(Manifest.permission.READ_SMS) != PackageManager.PERMISSION_GRANTED)
            need.add(Manifest.permission.READ_SMS);
        if (checkSelfPermission(Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED)
            need.add(Manifest.permission.READ_PHONE_STATE);
        // Only this one exposes a SIM's own number on API 30+, and only when
        // the carrier bothered to write it there -- which many do not. Used
        // purely to prefill a blank field; nothing depends on it.
        if (Build.VERSION.SDK_INT >= 30
                && checkSelfPermission(Manifest.permission.READ_PHONE_NUMBERS) != PackageManager.PERMISSION_GRANTED)
            need.add(Manifest.permission.READ_PHONE_NUMBERS);
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            need.add(Manifest.permission.POST_NOTIFICATIONS);
        if (!need.isEmpty()) requestPermissions(need.toArray(new String[0]), 1);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        // Carrier names only become readable once READ_PHONE_STATE is granted.
        buildSlotRows();
        refreshUi();
    }

    // ── tiny UI helpers ──
    private int dp(int v) { return (int) (v * getResources().getDisplayMetrics().density); }

    private TextView title(String t) {
        TextView tv = new TextView(this);
        tv.setText(t);
        tv.setTextColor(Color.parseColor("#941827"));
        tv.setTextSize(22);
        tv.setPadding(0, 0, 0, dp(16));
        return tv;
    }

    private TextView label(String t) {
        TextView tv = new TextView(this);
        tv.setText(t);
        tv.setTextColor(Color.parseColor("#C7C7C7"));
        tv.setPadding(0, dp(12), 0, dp(4));
        return tv;
    }

    private TextView hint(String t) {
        TextView tv = new TextView(this);
        tv.setText(t);
        tv.setTextColor(Color.parseColor("#8A8A8A"));
        tv.setTextSize(12);
        tv.setPadding(0, 0, 0, dp(4));
        return tv;
    }

    private EditText input(String value, int type) {
        EditText e = new EditText(this);
        e.setText(value);
        e.setInputType(type);
        e.setTextColor(Color.WHITE);
        e.setBackgroundColor(Color.parseColor("#1F1F1F"));
        e.setPadding(dp(12), dp(12), dp(12), dp(12));
        return e;
    }

    private Button button(String t) {
        Button b = new Button(this);
        b.setText(t);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(12);
        b.setLayoutParams(lp);
        return b;
    }

    private void toast(String t) { Toast.makeText(this, t, Toast.LENGTH_SHORT).show(); }
}
