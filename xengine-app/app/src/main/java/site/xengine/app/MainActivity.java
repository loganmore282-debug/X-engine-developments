package site.xengine.app;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.view.KeyEvent;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.Toast;

/**
 * Wraps https://www.x-engine.site in a native WebView so it installs and runs
 * as a real Android app. Keeps x-engine.site navigation inside the app and
 * sends external links (WhatsApp, Telegram, mailto, tel, other sites) out to
 * their own apps. Supports file uploads and downloads.
 */
public class MainActivity extends Activity {

    private static final String START_URL = "https://www.x-engine.site/";
    private static final int FILE_CHOOSER_REQ = 1001;

    private WebView web;
    private ProgressBar bar;
    private ValueCallback<Uri[]> filePathCallback;

    @Override
    @SuppressWarnings({"SetJavaScriptEnabled"})
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#0B0E11"));

        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100);
        FrameLayout.LayoutParams blp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, dp(3));
        root.addView(bar, blp);

        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setSupportMultipleWindows(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleUrl(request.getUrl().toString());
            }

            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleUrl(url);
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                bar.setProgress(newProgress);
                bar.setVisibility(newProgress >= 100 ? View.GONE : View.VISIBLE);
            }

            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = callback;
                try {
                    Intent intent = params.createIntent();
                    startActivityForResult(intent, FILE_CHOOSER_REQ);
                } catch (Exception e) {
                    filePathCallback = null;
                    Toast.makeText(MainActivity.this, "Cannot open file picker", Toast.LENGTH_SHORT).show();
                    return false;
                }
                return true;
            }
        });

        web.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition,
                                        String mimeType, long contentLength) {
                try {
                    DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
                    req.setMimeType(mimeType);
                    req.allowScanningByMediaScanner();
                    req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS,
                            "xengine-" + System.currentTimeMillis());
                    DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                    if (dm != null) dm.enqueue(req);
                    Toast.makeText(MainActivity.this, "Downloading...", Toast.LENGTH_SHORT).show();
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "Download failed", Toast.LENGTH_SHORT).show();
                }
            }
        });

        if (savedInstanceState == null) {
            web.loadUrl(START_URL);
        } else {
            web.restoreState(savedInstanceState);
        }
    }

    /** Returns true if we handled the URL externally (so the WebView should not load it). */
    private boolean handleUrl(String url) {
        if (url == null) return false;
        String u = url.toLowerCase();
        boolean internal = u.startsWith("http") && (u.contains("://x-engine.site") || u.contains(".x-engine.site"));
        if (internal) return false;   // let the WebView load it

        // Everything else (whatsapp/tg/mailto/tel/other sites) → open in its own app
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (Exception e) {
            Toast.makeText(this, "No app to open this link", Toast.LENGTH_SHORT).show();
        }
        return true;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQ) {
            if (filePathCallback == null) return;
            Uri[] results = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
        }
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && web != null && web.canGoBack()) {
            web.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (web != null) web.saveState(outState);
    }

    private int dp(int v) { return (int) (v * getResources().getDisplayMetrics().density); }
}
