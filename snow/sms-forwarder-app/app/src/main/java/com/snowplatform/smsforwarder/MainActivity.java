package com.snowplatform.smsforwarder;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
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
 *  - server webhook URL + shared secret + sender allow-list
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

    private Prefs prefs;
    private EditText urlField, secretField, sendersField;
    private final List<EditText> slotFields = new ArrayList<>();
    private LinearLayout slotBox;
    private TextView status;
    private Button toggleBtn;

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

        root.addView(label("Forward SMS from (comma separated, blank = all)"));
        sendersField = input(prefs.senders(), InputType.TYPE_CLASS_TEXT);
        root.addView(sendersField);

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

        status = new TextView(this);
        status.setTextColor(Color.parseColor("#9A9A9A"));
        status.setPadding(0, dp(16), 0, 0);
        root.addView(status);

        ScrollView scroll = new ScrollView(this);
        scroll.addView(root);
        setContentView(scroll);

        requestPerms();
        refreshUi();
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

        for (int i = 0; i < rows; i++) {
            String carrier = (i < carriers.length && carriers[i] != null) ? carriers[i] : null;
            slotBox.addView(label("SIM slot " + (i + 1)
                    + (carrier != null ? " (" + carrier + ")" : " (no SIM detected)")));
            EditText f = input(saved.optString(String.valueOf(i), ""), InputType.TYPE_CLASS_PHONE);
            slotBox.addView(f);
            slotFields.add(f);
        }
    }

    /** Carrier name per slot index, or nulls when unreadable (permission not yet granted). */
    private String[] detectCarriers() {
        String[] out = new String[MAX_SLOT_ROWS];
        try {
            if (checkSelfPermission(Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED)
                return out;
            SubscriptionManager sm = (SubscriptionManager) getSystemService(TELEPHONY_SUBSCRIPTION_SERVICE);
            if (sm == null) return out;
            List<SubscriptionInfo> list = sm.getActiveSubscriptionInfoList();
            if (list == null) return out;
            for (SubscriptionInfo si : list) {
                int slot = si.getSimSlotIndex();
                if (slot >= 0 && slot < out.length) {
                    CharSequence name = si.getCarrierName();
                    out[slot] = (name == null || name.length() == 0) ? "SIM present" : name.toString();
                }
            }
        } catch (Exception ignored) {}
        return out;
    }

    private void saveSettings() {
        prefs.save(urlField.getText().toString(), secretField.getText().toString(),
                sendersField.getText().toString());
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
            prefs.setActive(true);
            ForwardService.start(this);
        } else {
            prefs.setActive(false);
            ForwardService.stop(this);
        }
        refreshUi();
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
