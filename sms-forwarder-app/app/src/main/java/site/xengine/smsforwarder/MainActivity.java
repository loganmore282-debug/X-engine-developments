package site.nexusug.smsforwarder;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

/**
 * Single-screen setup UI (built in code, no layout files needed):
 *  - server webhook URL + shared secret + sender allow-list
 *  - Start / Stop forwarding
 *  - Send a test ping to confirm the server is reachable
 */
public class MainActivity extends Activity {

    private static final String DEFAULT_URL =
            "https://nexus-server-production.up.railway.app/sms/incoming";

    private Prefs prefs;
    private EditText urlField, secretField, sendersField;
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
        root.setBackgroundColor(Color.parseColor("#0B0E11"));

        root.addView(title("Nexus SMS Forwarder"));
        root.addView(label("Server webhook URL"));
        urlField = input(prefs.url().isEmpty() ? DEFAULT_URL : prefs.url(), InputType.TYPE_TEXT_VARIATION_URI);
        root.addView(urlField);

        root.addView(label("Shared secret (must match SMS_WEBHOOK_SECRET)"));
        secretField = input(prefs.secret(), InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        root.addView(secretField);

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
        status.setTextColor(Color.parseColor("#848E9C"));
        status.setPadding(0, dp(16), 0, 0);
        root.addView(status);

        ScrollView scroll = new ScrollView(this);
        scroll.addView(root);
        setContentView(scroll);

        requestPerms();
        refreshUi();
    }

    private void saveSettings() {
        prefs.save(urlField.getText().toString(), secretField.getText().toString(),
                sendersField.getText().toString());
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
        status.setText("Testing...");
        Poster.post(url, secret,
                "TEST: You have received UGX 1 from NEXUS TEST. Transaction ID TEST000001.",
                "TEST",
                new Poster.Callback() {
                    @Override public void onResult(final String result) {
                        runOnUiThread(new Runnable() {
                            @Override public void run() { status.setText("Test result: " + result); }
                        });
                    }
                });
    }

    private void refreshUi() {
        boolean on = prefs.active();
        toggleBtn.setText(on ? "STOP forwarding" : "START forwarding");
        status.setText(on
                ? "Status: ACTIVE — listening for deposit SMS."
                : "Status: stopped.");
    }

    private void requestPerms() {
        java.util.ArrayList<String> need = new java.util.ArrayList<>();
        if (checkSelfPermission(Manifest.permission.RECEIVE_SMS) != PackageManager.PERMISSION_GRANTED)
            need.add(Manifest.permission.RECEIVE_SMS);
        if (checkSelfPermission(Manifest.permission.READ_SMS) != PackageManager.PERMISSION_GRANTED)
            need.add(Manifest.permission.READ_SMS);
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            need.add(Manifest.permission.POST_NOTIFICATIONS);
        if (!need.isEmpty()) requestPermissions(need.toArray(new String[0]), 1);
    }

    // ── tiny UI helpers ──
    private int dp(int v) { return (int) (v * getResources().getDisplayMetrics().density); }

    private TextView title(String t) {
        TextView tv = new TextView(this);
        tv.setText(t);
        tv.setTextColor(Color.parseColor("#2563EB"));
        tv.setTextSize(22);
        tv.setPadding(0, 0, 0, dp(16));
        return tv;
    }

    private TextView label(String t) {
        TextView tv = new TextView(this);
        tv.setText(t);
        tv.setTextColor(Color.parseColor("#C7CBD1"));
        tv.setPadding(0, dp(12), 0, dp(4));
        return tv;
    }

    private EditText input(String value, int type) {
        EditText e = new EditText(this);
        e.setText(value);
        e.setInputType(type);
        e.setTextColor(Color.WHITE);
        e.setBackgroundColor(Color.parseColor("#1A1F26"));
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
