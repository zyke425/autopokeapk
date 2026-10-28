package io.github.zyke425.autopoke;

import android.annotation.SuppressLint;
import android.annotation.TargetApi;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.http.SslError;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.os.Build;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebViewRenderProcess;
import android.webkit.WebViewRenderProcessClient;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.IOException;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final String POKES = "https://www.facebook.com/pokes?ref=search";
    private static final int BG = Color.rgb(16, 26, 40);
    private static final int MUTED = Color.rgb(169, 185, 205);
    private static final int MINT = Color.rgb(142, 232, 203);
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService stateWriter = Executors.newSingleThreadExecutor();
    private final LoadRecovery recovery = new LoadRecovery();
    private final BrowserRecovery browserRecovery = new BrowserRecovery();
    private WebView web;
    private FrameLayout browserHost;
    private TextView browserNotice;
    private SharedPreferences prefs;
    private TextView status, count, address;
    private Button toggle;
    private ProgressBar progress;
    private String script, defaultUserAgent;
    private JSONObject loopState = new JSONObject();
    private boolean running, active, loading, failed, evaluating;
    private boolean keepAwake, desktop, adaptive, recovering, savingGuard;
    private boolean repairingBrowser, engineReady, pokesExpected = true;
    private int historyChecked = -1;
    private int emptyScriptResults;
    private int refreshSeconds, gapSeconds, navigation, loopEpoch, evaluationSequence;
    private String recoveryMessage = "";
    private final Runnable poll = this::scan;
    private final Runnable retryLoad = this::updateRecovery;
    private Runnable loadTimeout, evaluationTimeout;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences("autopoke", MODE_PRIVATE);
        running = prefs.getBoolean("running", false);
        keepAwake = prefs.getBoolean("keepAwake", true);
        desktop = prefs.getBoolean("desktop", false);
        adaptive = prefs.getBoolean("adaptive", true);
        refreshSeconds = clamp(prefs.getInt("refresh", 5), 1, 300);
        gapSeconds = clamp(prefs.getInt("gap", 7), 5, 300);
        try { loopState = new JSONObject(prefs.getString("state", "{}")); }
        catch (Exception ignored) { loopState = new JSONObject(); }
        if (loopState.optBoolean("held")) running = false;
        try (InputStream in = getAssets().open("autopoke.js")) {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192]; int length;
            while ((length = in.read(buffer)) != -1) bytes.write(buffer, 0, length);
            script = new String(bytes.toByteArray(), StandardCharsets.UTF_8);
        } catch (IOException error) {
            new AlertDialog.Builder(this).setMessage("The app's automation script could not be loaded.")
                .setPositiveButton("Close", (d, w) -> finish()).setCancelable(false).show();
            return;
        }
        buildUi();
        renderControls();
        if (savedInstanceState == null || web.restoreState(savedInstanceState) == null || !trusted(web.getUrl())) {
            web.loadUrl(POKES);
        }
    }

    private static int clamp(int value, int min, int max) { return Math.max(min, Math.min(max, value)); }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private LinearLayout column() { LinearLayout v = new LinearLayout(this); v.setOrientation(LinearLayout.VERTICAL); return v; }
    private TextView text(String value, int size, int color) {
        TextView v = new TextView(this); v.setText(value); v.setTextSize(size); v.setTextColor(color); return v;
    }
    private GradientDrawable rounded(int color, int radius) {
        GradientDrawable d = new GradientDrawable(); d.setColor(color); d.setCornerRadius(dp(radius)); return d;
    }
    private Button button(String label, int background, int foreground) {
        Button b = new Button(this); b.setText(label); b.setAllCaps(false); b.setTextSize(14);
        b.setTextColor(foreground); b.setMinHeight(dp(48)); b.setMinimumHeight(dp(48));
        b.setPadding(dp(12), 0, dp(12), 0); b.setBackground(rounded(background, 12)); return b;
    }
    private LinearLayout.LayoutParams weighted() { return new LinearLayout.LayoutParams(0, dp(48), 1); }

    @SuppressLint("SetJavaScriptEnabled")
    private void buildUi() {
        LinearLayout root = column(); root.setBackgroundColor(BG);
        // API 35 enforces edge-to-edge; keep native controls out of system bars/keyboard.
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        setContentView(root);
        LinearLayout panel = column(); panel.setPadding(dp(16), dp(10), dp(16), dp(12)); root.addView(panel);
        LinearLayout heading = new LinearLayout(this); heading.setGravity(Gravity.CENTER_VERTICAL);
        TextView title = text("AutoPoke 1.1.2", 25, Color.WHITE); title.setTypeface(null, Typeface.BOLD);
        heading.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        Button settings = button("Settings", Color.rgb(35, 50, 69), Color.WHITE);
        settings.setContentDescription("Open AutoPoke settings"); settings.setOnClickListener(v -> showSettings());
        heading.addView(settings); panel.addView(heading);
        TextView subtitle = text("POKE BACK. KEEP THE LOOP GOING.", 10, MINT);
        subtitle.setLetterSpacing(0.13f); subtitle.setPadding(0, dp(5), 0, dp(9)); panel.addView(subtitle);
        status = text("Sign in, open Pokes, then tap Start.", 13, Color.WHITE);
        status.setMinHeight(dp(36)); status.setMaxLines(3); panel.addView(status);
        count = text("0 click attempts · 0 detected", 12, MUTED); count.setPadding(0, dp(3), 0, dp(10)); panel.addView(count);
        LinearLayout actions = new LinearLayout(this);
        toggle = button("Start loop", MINT, BG); toggle.setTypeface(null, Typeface.BOLD);
        toggle.setOnClickListener(v -> toggleLoop()); actions.addView(toggle, weighted());
        Button open = button("Open Pokes", Color.rgb(35, 50, 69), Color.WHITE);
        LinearLayout.LayoutParams openParams = weighted(); openParams.leftMargin = dp(8);
        open.setOnClickListener(v -> { recovery.reset(); browserRecovery.reset(); openPokes(); }); actions.addView(open, openParams); panel.addView(actions);
        LinearLayout browserBar = new LinearLayout(this); browserBar.setGravity(Gravity.CENTER_VERTICAL);
        browserBar.setPadding(dp(12), 0, dp(6), 0); browserBar.setBackgroundColor(Color.rgb(25, 38, 55));
        address = text("facebook.com · secure connection", 11, MUTED); address.setSingleLine(true);
        browserBar.addView(address, new LinearLayout.LayoutParams(0, dp(40), 1)); address.setGravity(Gravity.CENTER_VERTICAL);
        Button reload = button("↻", Color.TRANSPARENT, MINT); reload.setContentDescription("Reload Facebook page");
        reload.setOnClickListener(v -> { recovery.reset(); browserRecovery.reset(); if (web != null) { failed = false; web.reload(); } else openPokes(); });
        browserBar.addView(reload, new LinearLayout.LayoutParams(dp(48), dp(44))); root.addView(browserBar);
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        root.addView(progress, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(2)));
        browserHost = new FrameLayout(this);
        root.addView(browserHost, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        browserNotice = text("", 15, MUTED); browserNotice.setGravity(Gravity.CENTER);
        browserNotice.setPadding(dp(24), dp(24), dp(24), dp(24)); browserNotice.setBackgroundColor(BG);
        browserNotice.setVisibility(View.GONE);
        browserHost.addView(browserNotice, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        createBrowser();
        TextView foot = text("Runs while this app is open · Counts show attempts", 10, MUTED);
        foot.setPadding(dp(12), dp(5), dp(12), dp(5)); foot.setGravity(Gravity.CENTER); root.addView(foot);
    }

    private void showBrowserNotice(String message) {
        browserNotice.setText(message); browserNotice.setVisibility(View.VISIBLE); browserNotice.bringToFront();
    }
    private void createBrowser() {
        web = new WebView(this); web.setBackgroundColor(Color.WHITE);
        browserHost.addView(web, 0, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        configureBrowser(); engineReady = false;
        if (!active) web.onPause();
    }
    private void discardBrowser(WebView view) {
        if (view == web) web = null;
        browserHost.removeView(view); view.destroy();
    }
    private void replaceBrowser() {
        navigation++; evaluationSequence++; evaluating = false; savingGuard = false; engineReady = false;
        if (web != null) discardBrowser(web);
        createBrowser();
        if (active) { web.onResume(); web.resumeTimers(); }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureBrowser() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true); s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false); s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSafeBrowsingEnabled(true); s.setMediaPlaybackRequiresUserGesture(true);
        s.setSupportMultipleWindows(false); s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setBuiltInZoomControls(true); s.setDisplayZoomControls(false);
        defaultUserAgent = s.getUserAgentString(); applyUserAgent();
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        // Intentionally no addJavascriptInterface: page frames get no native capabilities.
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int value) {
                if (view != web) return;
                progress.setProgress(value); progress.setVisibility(value == 100 ? View.GONE : View.VISIBLE);
            }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (view != web) return true;
                if (!request.isForMainFrame()) return false;
                String url = request.getUrl().toString();
                if (trusted(url)) { if (request.hasGesture() && !pokesUrl(url)) pokesExpected = false; return false; }
                // Never automatically launch apps/custom schemes from Facebook content.
                if (request.hasGesture() && "https".equals(request.getUrl().getScheme())) {
                    new AlertDialog.Builder(MainActivity.this).setMessage("Open this link in your browser?\n" + request.getUrl().getHost())
                        .setPositiveButton("Open", (d, w) -> {
                            try { startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl())); }
                            catch (Exception ignored) { Toast.makeText(MainActivity.this, "No browser available.", Toast.LENGTH_SHORT).show(); }
                        }).setNegativeButton("Cancel", null).show();
                }
                return true;
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                if (view != web) return;
                navigation++; evaluationSequence++; evaluating = false; savingGuard = false; loading = true; failed = false; recovering = false;
                engineReady = false; emptyScriptResults = 0; repairingBrowser = false; browserNotice.setVisibility(View.GONE);
                handler.removeCallbacks(poll); handler.removeCallbacks(retryLoad); cancelEvaluationTimeout(); armLoadTimeout();
                address.setText(trusted(url) ? Uri.parse(url).getHost() + " · secure connection" : "Page blocked");
                status.setText("Loading Facebook…");
                if (!trusted(url)) { view.stopLoading(); pageError("Only secure Facebook pages can open inside this app."); }
                else schedule(500);
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (view != web || !url.equals(view.getUrl())) return;
                cancelLoadTimeout();
                loading = false; CookieManager.getInstance().flush();
                view.requestLayout(); view.invalidate();
                if (!failed && active && trusted(url)) schedule(250);
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError error) {
                if (view != web || !req.isForMainFrame() || failed) return;
                int code = error.getErrorCode();
                if (pokesUrl(req.getUrl().toString()) && code != ERROR_FAILED_SSL_HANDSHAKE
                    && code != ERROR_UNSUPPORTED_SCHEME && code != ERROR_AUTHENTICATION && code != ERROR_BAD_URL) {
                    queueRecovery("Could not load Facebook.");
                } else pageError("Could not load Facebook. Check the page, then tap ↻.");
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest req, WebResourceResponse response) {
                if (view != web || !req.isForMainFrame()) return;
                if (response.getStatusCode() == 429) {
                    holdRestriction("Facebook limited page loads (HTTP 429).", "page-response");
                    pageError("Facebook limited page loads (HTTP 429). Loop paused.");
                }
                else if (response.getStatusCode() >= 500 && pokesUrl(req.getUrl().toString())) queueRecovery("Facebook returned a temporary server error.");
                else pageError("Facebook returned an error. Check the page, then tap ↻.");
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler ssl, SslError error) {
                ssl.cancel(); if (view == web) pageError("Facebook's secure connection could not be verified.");
            }
            @Override public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
                if (view != web) return true;
                discardBrowser(view);
                if (recovering && repairingBrowser) { updateRecovery(); return true; }
                queueBrowserRecovery("Android restarted the Facebook browser.", true);
                return true;
            }
        });
        if (Build.VERSION.SDK_INT >= 29) configureRendererRecovery();
    }

    @TargetApi(29)
    private void configureRendererRecovery() {
        web.setWebViewRenderProcessClient(new WebViewRenderProcessClient() {
            @Override public void onRenderProcessUnresponsive(WebView view, WebViewRenderProcess renderer) {
                if (view != web || !active || !running || recovering || loopState.optBoolean("held")) return;
                queueBrowserRecovery("The Facebook browser stopped responding.", true);
                if (renderer != null) renderer.terminate();
            }
            @Override public void onRenderProcessResponsive(WebView view, WebViewRenderProcess renderer) { }
        });
    }

    private boolean pokesUrl(String url) {
        if (!trusted(url)) return false;
        String path = Uri.parse(url).getPath();
        return path != null && path.matches(".*/pokes(?:\\.php)?/?");
    }
    private boolean hasNetwork() {
        ConnectivityManager manager = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        if (manager == null) return false;
        NetworkCapabilities capabilities = manager.getNetworkCapabilities(manager.getActiveNetwork());
        // Some VPNs block Android's validation probes even while Facebook works.
        // Check for an Internet-capable network; real load errors still use backoff.
        return capabilities != null && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }
    private void cancelLoadTimeout() { if (loadTimeout != null) handler.removeCallbacks(loadTimeout); loadTimeout = null; }
    private void armLoadTimeout() {
        cancelLoadTimeout();
        final int generation = navigation;
        loadTimeout = () -> {
            if (generation == navigation && active && running && loading && web != null && pokesUrl(web.getUrl())) queueRecovery("The Facebook page took too long to load.");
        };
        if (active) handler.postDelayed(loadTimeout, 45000);
    }
    private void cancelEvaluationTimeout() { if (evaluationTimeout != null) handler.removeCallbacks(evaluationTimeout); evaluationTimeout = null; }
    private void armEvaluationTimeout() {
        cancelEvaluationTimeout();
        final int sequence = evaluationSequence;
        evaluationTimeout = () -> {
            if (!active || !evaluating || sequence != evaluationSequence) return;
            evaluationSequence++; evaluating = false;
            queueBrowserRecovery("The Facebook browser stopped responding.", true);
        };
        handler.postDelayed(evaluationTimeout, 15000);
    }
    private void queueRecovery(String message) {
        if (recovering || web == null) return;
        if (!running || loopState.optBoolean("held")) { pageError(message + " Tap ↻ to retry."); return; }
        loading = false; failed = true; evaluating = false; savingGuard = false; recovering = true;
        navigation++; evaluationSequence++; handler.removeCallbacks(poll); cancelLoadTimeout(); cancelEvaluationTimeout();
        web.stopLoading();
        if (!recovery.queue(SystemClock.elapsedRealtime())) {
            recovering = false; setRunning(false); status.setText("Several page loads failed. Loop paused; check your connection and tap Start."); return;
        }
        recoveryMessage = message; updateRecovery();
    }
    private void queueBrowserRecovery(String message, boolean rendererLost) {
        if (recovering && repairingBrowser) return;
        navigation++; evaluationSequence++; evaluating = false; savingGuard = false; engineReady = false;
        handler.removeCallbacks(poll); handler.removeCallbacks(retryLoad); cancelLoadTimeout(); cancelEvaluationTimeout();
        loading = false; failed = true;
        if (!running || loopState.optBoolean("held")) {
            recovering = false; repairingBrowser = false;
            showBrowserNotice(message + "\nTap Open Pokes to reopen it."); return;
        }
        if (!browserRecovery.queue(SystemClock.elapsedRealtime(), rendererLost)) {
            setRunning(false);
            showBrowserNotice("Facebook could not be restored after several attempts.\nCheck your connection, then tap Open Pokes.");
            status.setText("Browser recovery paused. Tap Open Pokes to retry."); return;
        }
        recovering = true; repairingBrowser = true; recoveryMessage = message;
        if (web != null) web.stopLoading();
        updateRecovery();
    }
    private void updateRecovery() {
        handler.removeCallbacks(retryLoad);
        if (!active || !running || !recovering || loopState.optBoolean("held")) return;
        long remaining = repairingBrowser ? browserRecovery.remaining(SystemClock.elapsedRealtime()) : recovery.remaining(SystemClock.elapsedRealtime());
        if (!hasNetwork()) status.setText("Connection unavailable. Waiting for Internet access…");
        else if (remaining > 0) status.setText(recoveryMessage + " Retrying in " + ((remaining + 999) / 1000) + "s.");
        else {
            boolean replace = repairingBrowser && (web == null || browserRecovery.shouldRecreate());
            recovering = false; repairingBrowser = false;
            if (replace) replaceBrowser();
            openPokes(); return;
        }
        if (repairingBrowser) showBrowserNotice(status.getText().toString());
        handler.postDelayed(retryLoad, 1000);
    }

    static boolean trusted(String url) {
        if (url == null) return false;
        try {
            Uri u = Uri.parse(url); String host = u.getHost();
            return "https".equalsIgnoreCase(u.getScheme()) && host != null && u.getUserInfo() == null
                && (u.getPort() == -1 || u.getPort() == 443)
                && (host.equalsIgnoreCase("facebook.com") || host.toLowerCase(java.util.Locale.ROOT).endsWith(".facebook.com"));
        } catch (Exception ignored) { return false; }
    }

    private void pageError(String message) {
        loading = false; failed = true; recovering = false; handler.removeCallbacks(poll); handler.removeCallbacks(retryLoad);
        cancelLoadTimeout(); cancelEvaluationTimeout(); status.setText(message); showBrowserNotice(message);
    }
    private void schedule(long delay) {
        handler.removeCallbacks(poll);
        if (active && !failed && web != null) handler.postDelayed(poll, delay);
    }
    private void scan() {
        if (!active || failed || web == null || evaluating || savingGuard || !trusted(web.getUrl())) return;
        if (!running) { renderControls(); return; }
        if (!hasNetwork()) { status.setText("Connection unavailable. Waiting for Internet access…"); schedule(1000); return; }
        evaluateEngine(null);
    }
    private void evaluateEngine(String token) {
        if (!active || !running || web == null || evaluating || savingGuard || failed || !trusted(web.getUrl())) return;
        final int generation = navigation;
        final int epoch = loopEpoch;
        final int sequence = ++evaluationSequence;
        JSONObject cfg = new JSONObject();
        try {
            cfg.put("running", running); cfg.put("now", System.currentTimeMillis());
            cfg.put("refreshMs", refreshSeconds * 1000); cfg.put("gapMs", gapSeconds * 1000); cfg.put("adaptive", adaptive); cfg.put("pokesExpected", pokesExpected);
            if (!engineReady) cfg.put("state", loopState);
        } catch (Exception error) { pageError("Settings could not be loaded. Restart the app."); return; }
        evaluating = true;
        armEvaluationTimeout();
        String call = token == null ? "tick(" + cfg + ")" : "execute(" + cfg + "," + JSONObject.quote(token) + ")";
        String expression = "(function(){try{" + (engineReady ? "" : script)
            + "\nif(!window.__autoPokeAndroid)return JSON.stringify({kind:'reinject'});return JSON.stringify(window.__autoPokeAndroid." + call + ");}catch(e){return JSON.stringify({kind:'error',message:'Page script failed. Stop and reload Facebook.'});}})()";
        web.evaluateJavascript(expression, raw -> {
            // Never apply callbacks from a replaced document, stopped loop, or hidden activity.
            if (generation != navigation || sequence != evaluationSequence || web == null) return;
            evaluating = false; cancelEvaluationTimeout();
            try {
                Object decoded = new JSONTokener(raw).nextValue();
                if (!(decoded instanceof String)) {
                    if (++emptyScriptResults >= 3) queueBrowserRecovery("The Facebook page returned no response.", true);
                    else schedule(500);
                    return;
                }
                emptyScriptResults = 0;
                JSONObject result = new JSONObject((String) decoded);
                String kind = result.optString("kind");
                if ("reinject".equals(kind)) { engineReady = false; schedule(250); return; }
                engineReady = true;
                if (result.has("state")) {
                    JSONObject incoming = result.getJSONObject("state");
                    // A late script callback must not clear a page-level HTTP 429 pause.
                    if (loopState.optBoolean("held") && !incoming.optBoolean("held")) {
                        incoming.put("held", true); incoming.put("holdReason", restrictionReason());
                        incoming.put("holdSource", loopState.optString("holdSource", "legacy"));
                    }
                    loopState = incoming;
                    if (!"prepared".equals(kind)) persistState();
                }
                if ("prepared".equals(kind)) {
                    savingGuard = true;
                    if (active && running) status.setText("Preparing poke back…");
                    final String savedGuard = loopState.toString();
                    final String actionToken = result.getString("token");
                    // Commit on a worker, then click only after the guard is on disk.
                    stateWriter.execute(() -> {
                        boolean saved = prefs.edit().putString("state", savedGuard).commit();
                        handler.post(() -> {
                            if (web == null || generation != navigation) return;
                            savingGuard = false;
                            if (!saved) { setRunning(false); status.setText("Could not save the click guard. Loop paused."); return; }
                            if (active && running && epoch == loopEpoch && hasNetwork()) evaluateEngine(actionToken);
                            else if (active && running) schedule(500);
                        });
                    });
                    return;
                }
                if (!active || !running) { renderControls(); return; }
                if (result.optBoolean("blank")) showBrowserNotice("Facebook is loading…\nThe app will recover if the page stays blank.");
                else if (!"loading".equals(kind)) browserNotice.setVisibility(View.GONE);
                status.setText(result.optString("message", "Watching for Poke back…"));
                count.setText(result.optInt("attempts") + " click attempts · " + result.optInt("detected") + " detected");
                if ("restricted".equals(kind)) {
                    holdRestriction(result.optString("restrictionReason", "Earlier pause; its cause was not recorded."),
                        result.optString("restrictionSource", "legacy")); return;
                }
                if ("blank".equals(kind)) { queueBrowserRecovery(result.optString("message"), false); return; }
                if ("error".equals(kind)) { setRunning(false); status.setText(result.optString("message")); return; }
                if ("stalled".equals(kind)) { queueRecovery(result.optString("message")); return; }
                if ("watching".equals(kind) || "clicked".equals(kind) || "prepared".equals(kind)) {
                    pokesExpected = true; loading = false; cancelLoadTimeout(); recovery.reset(); browserRecovery.healthy(SystemClock.elapsedRealtime());
                    // Bound navigation history during long sessions of redirected refreshes.
                    if (historyChecked != navigation) {
                        historyChecked = navigation;
                        if (web.copyBackForwardList().getSize() > 8) web.clearHistory();
                        final WebView current = web;
                        current.postVisualStateCallback(navigation, new WebView.VisualStateCallback() {
                            @Override public void onComplete(long requestId) {
                                if (current == web && active) { current.requestLayout(); current.invalidate(); }
                            }
                        });
                    }
                }
                if ("refresh".equals(kind)) { openPokes(); return; }
            } catch (Exception error) {
                setRunning(false); status.setText("The page response could not be read. Reload Facebook to continue."); return;
            }
            schedule(500);
        });
    }
    private String restrictionReason() {
        return loopState.optString("holdReason", "Earlier pause; the previous version did not record its cause.");
    }
    private void holdRestriction(String reason, String source) {
        try { loopState.put("held", true); loopState.put("holdReason", reason); loopState.put("holdSource", source); }
        catch (Exception ignored) { }
        persistState();
        setRunning(false); status.setText("Paused: " + restrictionReason());
    }
    private void persistState() {
        // Serialize state writes with the pre-click journal so a late write cannot clear a restriction.
        final String serialized = loopState.toString();
        stateWriter.execute(() -> {
            if (!prefs.edit().putString("state", serialized).commit()) handler.post(() -> {
                if (web != null) { setRunning(false); status.setText("Settings could not be saved. Loop paused."); }
            });
        });
    }
    private void toggleLoop() {
        if (loopState.optBoolean("held")) {
            new AlertDialog.Builder(this).setTitle("Review AutoPoke pause")
                .setMessage("Pause reason: " + restrictionReason() + "\n\nCheck Facebook manually. Resume after a manual poke works.")
                .setPositiveButton("Manual poke works — resume", (d, w) -> {
                    try { loopState.put("held", false); loopState.remove("holdReason"); loopState.remove("holdSource"); }
                    catch (Exception ignored) { }
                    persistState();
                    // Reload removes the old document's held flag; keep duplicate guards.
                    setRunning(true); openPokes();
                }).setNegativeButton("Keep paused", null).show();
            return;
        }
        setRunning(!running);
        if (running && failed) openPokes();
    }
    private void setRunning(boolean value) {
        loopEpoch++;
        if (value && !running) { recovery.reset(); browserRecovery.reset(); }
        running = value; prefs.edit().putBoolean("running", running).apply();
        handler.removeCallbacks(poll);
        if (!running) { recovering = false; handler.removeCallbacks(retryLoad); cancelLoadTimeout(); }
        renderControls(); if (running) { if (loading) armLoadTimeout(); schedule(100); }
    }
    private void renderControls() {
        if (toggle == null) return;
        toggle.setText(loopState.optBoolean("held") ? "Review pause" : running ? "Stop loop" : "Start loop");
        toggle.setBackground(rounded(running ? Color.rgb(250, 185, 179) : MINT, 12));
        if (!running) status.setText(loopState.optBoolean("held") ? "Paused: " + restrictionReason() : "Loop stopped. Tap Start to watch for poke backs.");
        count.setText(loopState.optInt("attempts") + " click attempts · " + (adaptive ? "adaptive refresh" : "refresh " + refreshSeconds + "s"));
        if (running && active && keepAwake) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
    private void openPokes() {
        if (web == null) createBrowser();
        if (running && !hasNetwork()) { queueRecovery("Internet access is unavailable."); return; }
        failed = false; recovering = false; repairingBrowser = false; pokesExpected = true; handler.removeCallbacks(poll); handler.removeCallbacks(retryLoad);
        // loadUrl also reloads an identical URL, without repeatedly growing WebView history.
        if (POKES.equals(web.getUrl())) web.reload(); else web.loadUrl(POKES);
    }
    private void applyUserAgent() {
        if (desktop) {
            // Use the installed WebView's own Chrome version rather than a stale fixed UA.
            web.getSettings().setUserAgentString(defaultUserAgent.replaceFirst("\\([^)]*\\)", "(X11; Linux x86_64)")
                .replace("; wv", "").replace("Version/4.0 ", "").replace(" Mobile", ""));
        } else web.getSettings().setUserAgentString(defaultUserAgent);
        web.getSettings().setUseWideViewPort(desktop); web.getSettings().setLoadWithOverviewMode(desktop);
    }
    private EditText number(LinearLayout form, String label, int value) {
        TextView t = text(label, 14, Color.WHITE); t.setPadding(0, dp(12), 0, dp(2)); form.addView(t);
        EditText input = new EditText(this); input.setInputType(InputType.TYPE_CLASS_NUMBER);
        input.setText(String.valueOf(value)); input.setSelectAllOnFocus(true); form.addView(input); return input;
    }
    private void showSettings() {
        LinearLayout form = column(); form.setPadding(dp(20), dp(8), dp(20), dp(12));
        EditText refresh = number(form, "Refresh delay after page is ready (1–300 seconds)", refreshSeconds);
        EditText gap = number(form, "Minimum time between clicks (5–300 seconds)", gapSeconds);
        CheckBox awake = new CheckBox(this); awake.setText("Keep screen awake while running"); awake.setChecked(keepAwake); form.addView(awake);
        CheckBox desktopBox = new CheckBox(this); desktopBox.setText("Desktop Facebook layout"); desktopBox.setChecked(desktop); form.addView(desktopBox);
        CheckBox adaptiveBox = new CheckBox(this); adaptiveBox.setText("Increase refresh delay when idle"); adaptiveBox.setChecked(adaptive); form.addView(adaptiveBox);
        TextView info = text("Only Poke back is clicked. A click is an attempt, not confirmation. The loop pauses while the app is hidden and resumes when you return. Facebook sign-in and cookies stay in this app's WebView.", 12, MUTED);
        info.setPadding(0, dp(8), 0, dp(12)); form.addView(info);
        Button logout = button("Sign out / clear Facebook data", Color.rgb(35, 50, 69), Color.WHITE); form.addView(logout);
        ScrollView scroll = new ScrollView(this); scroll.addView(form);
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle("Loop settings").setView(scroll)
            .setPositiveButton("Save", null).setNegativeButton("Cancel", null).create();
        logout.setOnClickListener(v -> new AlertDialog.Builder(this).setTitle("Clear Facebook sign-in?")
            .setMessage("This stops the loop and removes this app's Facebook cookies, cached pages, and website storage.")
            .setPositiveButton("Clear", (d, w) -> {
                setRunning(false); dialog.dismiss(); navigation++; handler.removeCallbacks(poll);
                web.stopLoading(); web.loadUrl("about:blank");
                android.webkit.WebStorage.getInstance().deleteAllData(); web.clearCache(true); web.clearHistory();
                CookieManager.getInstance().removeAllCookies(done -> { CookieManager.getInstance().flush(); openPokes(); });
            }).setNegativeButton("Cancel", null).show());
        dialog.setOnShowListener(d -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            try {
                int nextRefresh = Integer.parseInt(refresh.getText().toString().trim());
                int nextGap = Integer.parseInt(gap.getText().toString().trim());
                if (nextRefresh < 1 || nextRefresh > 300) { refresh.setError("Enter 1 to 300"); return; }
                if (nextGap < 5 || nextGap > 300) { gap.setError("Enter 5 to 300"); return; }
                boolean layoutChanged = desktop != desktopBox.isChecked();
                refreshSeconds = nextRefresh; gapSeconds = nextGap; keepAwake = awake.isChecked(); desktop = desktopBox.isChecked(); adaptive = adaptiveBox.isChecked();
                prefs.edit().putInt("refresh", nextRefresh).putInt("gap", nextGap).putBoolean("keepAwake", keepAwake).putBoolean("desktop", desktop).putBoolean("adaptive", adaptive).apply();
                renderControls(); dialog.dismiss();
                if (layoutChanged) { applyUserAgent(); openPokes(); } else schedule(100);
            } catch (NumberFormatException error) { refresh.setError("Enter whole seconds in both fields"); }
        }));
        dialog.show();
    }
    @Override protected void onResume() {
        super.onResume(); active = true;
        renderControls();
        if (recovering) { if (web != null) { web.onResume(); web.resumeTimers(); } updateRecovery(); return; }
        if (web != null) {
            web.onResume(); web.resumeTimers(); renderControls();
            web.requestLayout(); web.invalidate();
            if (loading) { armLoadTimeout(); schedule(250); }
            else if (evaluating) armEvaluationTimeout();
            else if (savingGuard) { /* The saved-guard callback resumes polling. */ }
            else schedule(250);
        }
    }
    @Override protected void onPause() {
        active = false; loopEpoch++; handler.removeCallbacks(poll); handler.removeCallbacks(retryLoad); cancelLoadTimeout(); cancelEvaluationTimeout();
        if (web != null) { web.onPause(); web.pauseTimers(); CookieManager.getInstance().flush(); }
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); super.onPause();
    }
    @Override protected void onSaveInstanceState(Bundle out) {
        if (web != null) web.saveState(out); super.onSaveInstanceState(out);
    }
    @Override public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack(); else super.onBackPressed();
    }
    @Override protected void onDestroy() {
        handler.removeCallbacksAndMessages(null); stateWriter.shutdown();
        if (web != null) discardBrowser(web);
        super.onDestroy();
    }
}
