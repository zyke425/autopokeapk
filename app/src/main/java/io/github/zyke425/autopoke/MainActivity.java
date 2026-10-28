package io.github.zyke425.autopoke;

import android.annotation.SuppressLint;
import android.annotation.TargetApi;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Bitmap;
import android.graphics.Rect;
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
import android.view.PixelCopy;
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
    private static final int BG = Color.rgb(16, 26, 40);
    private static final int MUTED = Color.rgb(169, 185, 205);
    private static final int MINT = Color.rgb(142, 232, 203);
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService stateWriter = Executors.newSingleThreadExecutor();
    private final LoadRecovery recovery = new LoadRecovery();
    private final BrowserRecovery browserRecovery = new BrowserRecovery();
    private final MobileRecovery mobileRecovery = new MobileRecovery();
    private final WhiteFrameWatchdog whiteFrames = new WhiteFrameWatchdog();
    private final PageReadyWatchdog pageReady = new PageReadyWatchdog();
    private final LoadDiagnostics loadDiagnostics = new LoadDiagnostics();
    private WebView web;
    private FrameLayout browserHost;
    private TextView browserNotice;
    private SharedPreferences prefs;
    private TextView status, count, address, basicStatus;
    private Button toggle;
    private ProgressBar progress;
    private String script, basicScript, healthScript, entryScript, defaultUserAgent;
    private String lastBrowserUrl = "", basicOrigin = "", pokesLink = "", browserRepairUrl = "";
    private boolean browserRepairPokes;
    private boolean pendingPokesEntry, entryBusy, entryAwaiting, menuAttempted;
    private int entrySequence;
    private boolean uiPokesRefresh;
    private int uiRefreshCycle;
    private long nextUiRefreshAt;
    private String lastUiRefreshPhase = "idle";
    private String lastUiReturnSource = "unrecorded";
    private int reportSequence;
    private String lastBasicState = "unknown";
    private JSONObject loopState = new JSONObject();
    private boolean running, active, loading, failed, evaluating;
    private boolean keepAwake, desktop, adaptive, recovering, savingGuard;
    private boolean repairingBrowser, engineReady, pokesExpected = true;
    private boolean dataSaver;
    private boolean basicMode, carrierReading, basicSetupOpen;
    private int carrierSequence;
    private final Runnable carrierPoll = this::readCarrier;
    private boolean frameProbePending, clickPending, frameReady;
    private long lastFrameProbe;
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
        dataSaver = prefs.getBoolean("dataSaver", false);
        basicMode = prefs.getBoolean("basicMode", true);
        basicOrigin = BasicNavigation.origin(prefs.getString("basicOrigin", ""));
        if (savedInstanceState != null) {
            pokesExpected = savedInstanceState.getBoolean("pokesExpected", true);
            basicSetupOpen = savedInstanceState.getBoolean("basicSetupOpen", false);
            lastBrowserUrl = savedInstanceState.getString("lastBrowserUrl", "");
            pendingPokesEntry = savedInstanceState.getBoolean("pendingPokesEntry", false);
        }
        if (basicMode) desktop = false;
        prefs.edit().putBoolean("basicMode", basicMode).remove("freeMode").apply();
        adaptive = prefs.getBoolean("adaptive", true);
        refreshSeconds = clamp(prefs.getInt("refresh", 5), 1, 300);
        gapSeconds = clamp(prefs.getInt("gap", 7), 5, 300);
        try { loopState = new JSONObject(prefs.getString("state", "{}")); }
        catch (Exception ignored) { loopState = new JSONObject(); }
        // Retire every old request-error countdown/hold while keeping attempts and
        // duplicate reservations. A stopped loop still requires the Start button.
        for (String key : new String[]{"held", "holdReason", "holdSource", "failures", "retryAt"}) loopState.remove(key);
        prefs.edit().putString("state", loopState.toString()).apply();
        try {
            script = readAsset("autopoke.js"); basicScript = readAsset("basic-mode.js"); healthScript = readAsset("browser-health.js"); entryScript = readAsset("basic-entry.js");
        } catch (IOException error) {
            new AlertDialog.Builder(this).setMessage("The app's automation script could not be loaded.")
                .setPositiveButton("Close", (d, w) -> finish()).setCancelable(false).show();
            return;
        }
        buildUi();
        renderControls();
        if (basicMode && pokesExpected) beginBasicPokesEntry();
        else if (savedInstanceState == null || web.restoreState(savedInstanceState) == null || !trusted(web.getUrl()))
            web.loadUrl(pokesExpected ? pokesAddress() : BasicNavigation.home(lastBrowserUrl, basicOrigin));
    }

    private String readAsset(String name) throws IOException {
        try (InputStream in = getAssets().open(name)) {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192]; int length;
            while ((length = in.read(buffer)) != -1) bytes.write(buffer, 0, length);
            return new String(bytes.toByteArray(), StandardCharsets.UTF_8);
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
        TextView title = text("AutoPoke 1.1.11", 25, Color.WHITE); title.setTypeface(null, Typeface.BOLD);
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
        open.setOnClickListener(v -> { loadDiagnostics.clear(); recovery.reset(); browserRecovery.reset(); openPokes(); }); actions.addView(open, openParams); panel.addView(actions);
        LinearLayout modeBar = new LinearLayout(this); modeBar.setGravity(Gravity.CENTER_VERTICAL);
        basicStatus = text("Basic mode: checking Facebook…", 11, MUTED); basicStatus.setMaxLines(2);
        modeBar.addView(basicStatus, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        Button basic = button("Basic mode", Color.rgb(35, 50, 69), Color.WHITE);
        basic.setContentDescription("Set up Facebook carrier Basic mode"); basic.setOnClickListener(v -> showBasicSetup());
        modeBar.addView(basic); panel.addView(modeBar);
        LinearLayout browserBar = new LinearLayout(this); browserBar.setGravity(Gravity.CENTER_VERTICAL);
        browserBar.setPadding(dp(12), 0, dp(6), 0); browserBar.setBackgroundColor(Color.rgb(25, 38, 55));
        address = text("facebook.com · secure connection", 11, MUTED); address.setSingleLine(true);
        browserBar.addView(address, new LinearLayout.LayoutParams(0, dp(40), 1)); address.setGravity(Gravity.CENTER_VERTICAL);
        Button reload = button("↻", Color.TRANSPARENT, MINT); reload.setContentDescription("Reload Facebook page");
        reload.setOnClickListener(v -> {
            recovery.reset(); browserRecovery.reset();
            if (basicMode && pokesExpected && !basicSetupOpen) refreshPokes();
            else if (web != null) { finishPageWait(); failed = false; web.reload(); }
            else openPokes();
        });
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
                if (trusted(url)) {
                    if (uiPokesRefresh && !request.hasGesture() && !authenticationUrl(url)) {
                        // A refresh may activate the site's client router, but
                        // must not replace the working carrier document.
                        lastUiRefreshPhase = "document-blocked";
                        return true;
                    }
                    if (request.hasGesture()) {
                        pokesExpected = pokesUrl(url);
                        if (pokesExpected) basicSetupOpen = false; else finishPageWait();
                    }
                    return false;
                }
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
                entrySequence++; entryBusy = false;
                uiPokesRefresh = false; nextUiRefreshAt = 0;
                lastBrowserUrl = url;
                if (!BasicNavigation.origin(url).equals(BasicNavigation.origin(pokesLink))) pokesLink = "";
                if (pokesUrl(url)) { pokesExpected = true; basicSetupOpen = false; }
                navigation++; evaluationSequence++; evaluating = false; savingGuard = false; loading = true; failed = false; recovering = false;
                engineReady = false; emptyScriptResults = 0; repairingBrowser = false; browserNotice.setVisibility(View.GONE);
                frameReady = false; clickPending = false;
                carrierSequence++; carrierReading = false; handler.removeCallbacks(carrierPoll); updateBasicStatus("unknown");
                if (!pokesExpected && !pokesUrl(url)) whiteFrames.reset();
                handler.removeCallbacks(poll); handler.removeCallbacks(retryLoad); cancelEvaluationTimeout();
                if (authenticationUrl(url)) finishPageWait(); else armLoadTimeout();
                address.setText(trusted(url) ? Uri.parse(url).getHost() + (basicMode ? " · carrier access unverified" : " · secure connection") : "Page blocked");
                status.setText("Loading Facebook…");
                if (!trusted(url)) { view.stopLoading(); pageError("Only secure Facebook pages can open inside this app."); }
                else { schedule(500); scheduleCarrier(750); }
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (view != web || !url.equals(view.getUrl())) return;
                // A completed document may still be an empty SPA. Only the
                // engine's ready signal (or manual sign-in/setup) ends the deadline.
                loading = false; CookieManager.getInstance().flush();
                view.requestLayout(); view.invalidate();
                if (!failed && active && trusted(url)) { schedule(250); scheduleCarrier(250); }
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError error) {
                if (view != web) return;
                loadDiagnostics.network(req.getUrl().toString(), req.isForMainFrame(), error.getErrorCode());
                if (!req.isForMainFrame() || failed) return;
                int code = error.getErrorCode();
                if ((pokesUrl(req.getUrl().toString()) || pokesExpected) && code != ERROR_FAILED_SSL_HANDSHAKE
                    && code != ERROR_UNSUPPORTED_SCHEME && code != ERROR_AUTHENTICATION && code != ERROR_BAD_URL) {
                    queueRecovery("Could not load Facebook.");
                } else pageError("Could not load Facebook. Check the page, then tap ↻.");
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest req, WebResourceResponse response) {
                if (view != web) return;
                loadDiagnostics.http(req.getUrl().toString(), req.isForMainFrame(), response.getStatusCode());
                if (!req.isForMainFrame()) return;
                if (response.getStatusCode() == 429) {
                    queueRecovery("Facebook could not load the page (HTTP 429).");
                }
                else if (response.getStatusCode() >= 500 && (pokesUrl(req.getUrl().toString()) || pokesExpected)) queueRecovery("Facebook returned a temporary server error.");
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
                if (view != web || !active || recovering) return;
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
        return capabilities != null && (capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            || (basicMode && capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)));
    }
    private void cancelLoadTimeout() { if (loadTimeout != null) handler.removeCallbacks(loadTimeout); loadTimeout = null; }
    private void finishPageWait() { cancelLoadTimeout(); pageReady.cancel(); }
    private boolean authenticationUrl(String url) {
        if (!trusted(url)) return false;
        String path = Uri.parse(url).getPath();
        return path != null && path.matches("(?i)/(?:login|checkpoint|recover|two_step_verification|auth_platform)(?:[/.].*)?");
    }
    private void armLoadTimeout() {
        cancelLoadTimeout();
        if (!active || recovering || failed || web == null || authenticationUrl(web.getUrl())
            || !(pokesExpected || basicSetupOpen || pendingPokesEntry || pokesUrl(web.getUrl()))) return;
        pageReady.start(SystemClock.elapsedRealtime());
        loadTimeout = () -> {
            if (!active || recovering || failed || web == null || !pageReady.waiting()) return;
            if (pageReady.remaining(SystemClock.elapsedRealtime()) > 0) { armLoadTimeout(); return; }
            finishPageWait();
            recoverUnrenderedPage("Facebook did not show a usable Pokes page. Retrying the mobile browser…");
        };
        handler.postDelayed(loadTimeout, pageReady.remaining(SystemClock.elapsedRealtime()));
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
        if (!running) { queueBrowserRecovery(message, false); return; }
        loading = false; failed = true; evaluating = false; savingGuard = false; recovering = true;
        navigation++; evaluationSequence++; handler.removeCallbacks(poll); finishPageWait(); cancelEvaluationTimeout();
        web.stopLoading();
        if (!recovery.queue(SystemClock.elapsedRealtime())) {
            recovering = false; setRunning(false); status.setText("Several page loads failed. Loop paused; check your connection and tap Start."); return;
        }
        recoveryMessage = message; updateRecovery();
    }
    private void queueBrowserRecovery(String message, boolean rendererLost) {
        if (recovering && repairingBrowser) return;
        browserRepairPokes = pendingPokesEntry || pokesExpected || pokesUrl(lastBrowserUrl);
        browserRepairUrl = browserRepairPokes ? pokesAddress() : BasicNavigation.home(currentBrowserUrl(), basicOrigin);
        navigation++; evaluationSequence++; evaluating = false; savingGuard = false; engineReady = false;
        handler.removeCallbacks(poll); handler.removeCallbacks(retryLoad); finishPageWait(); cancelEvaluationTimeout();
        loading = false; failed = true;
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
        if (!active || !recovering || (!running && !repairingBrowser)) return;
        long remaining = repairingBrowser ? browserRecovery.remaining(SystemClock.elapsedRealtime()) : recovery.remaining(SystemClock.elapsedRealtime());
        if (!hasNetwork()) status.setText("Connection unavailable. Waiting for Internet access…");
        else if (remaining > 0) status.setText(recoveryMessage + " Retrying in " + ((remaining + 999) / 1000) + "s.");
        else {
            boolean browserRepair = repairingBrowser;
            boolean replace = browserRepair && (web == null || browserRecovery.shouldRecreate());
            String target = browserRepair ? browserRepairUrl : pokesAddress();
            boolean toPokes = !browserRepair || browserRepairPokes;
            recovering = false; repairingBrowser = false;
            if (replace) replaceBrowser();
            if (basicMode && toPokes) beginBasicPokesEntry(); else loadBrowserTarget(target, toPokes);
            return;
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
        finishPageWait(); cancelEvaluationTimeout(); status.setText(message); showBrowserNotice(message);
    }
    private void schedule(long delay) {
        handler.removeCallbacks(poll);
        if (active && !failed && web != null) handler.postDelayed(poll, delay);
    }
    private void scan() {
        if (!active || failed || web == null || evaluating || savingGuard || !trusted(web.getUrl())) return;
        if (pendingPokesEntry) { tryPokesEntry(); schedule(500); return; }
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
            cfg.put("refreshMs", (dataSaver ? Math.max(15, refreshSeconds) : refreshSeconds) * 1000); cfg.put("gapMs", gapSeconds * 1000); cfg.put("adaptive", adaptive); cfg.put("pokesExpected", pokesExpected);
            cfg.put("allowRefresh", !basicMode || SystemClock.elapsedRealtime() >= nextUiRefreshAt);
            if (!engineReady) cfg.put("state", loopState);
        } catch (Exception error) { pageError("Settings could not be loaded. Restart the app."); return; }
        evaluating = true;
        armEvaluationTimeout();
        String call = token == null ? "tick(" + cfg + ")" : "execute(" + cfg + "," + JSONObject.quote(token) + ")";
        String expression = "(function(){try{" + (engineReady ? "" : basicScript + "\n" + script)
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
                clickPending = result.optBoolean("requestPending");
                if (result.optBoolean("ready")) { rememberPokesLink(currentBrowserUrl()); loading = false; finishPageWait(); }
                if (basicMode) updateBasicStatus(result.optString("basicState", "unknown"));
                if ("reinject".equals(kind)) { engineReady = false; schedule(250); return; }
                engineReady = true;
                if (result.has("state")) {
                    loopState = result.getJSONObject("state");
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
                // Keep Facebook visible and interactive during the grace period.
                // An opaque native cover can conceal the page and occlude its renderer.
                browserNotice.setVisibility(View.GONE);
                status.setText(result.optString("message", "Watching for Poke back…"));
                count.setText(result.optInt("attempts") + " click attempts · " + result.optInt("detected") + " detected");
                if ("basic-setup".equals(kind) || "login".equals(kind)) { loading = false; finishPageWait(); }
                if ("blank".equals(kind)) { recoverUnrenderedPage(result.optString("message")); return; }
                if ("error".equals(kind)) { setRunning(false); status.setText(result.optString("message")); return; }
                if ("stalled".equals(kind)) { recoverUnrenderedPage(result.optString("message")); return; }
                if ("watching".equals(kind) || "clicked".equals(kind) || "prepared".equals(kind)) {
                    pokesExpected = true; loading = false; finishPageWait(); recovery.reset(); browserRecovery.healthy(SystemClock.elapsedRealtime());
                    ensureVisualReady();
                }
                if ("refresh".equals(kind)) { refreshPokes(); return; }
                if (basicMode && "offpage".equals(kind) && "notifications".equals(result.optString("pageView"))) {
                    refreshPokes(); return;
                }
                if ("watching".equals(kind) || "waiting".equals(kind)) checkVisibleFrame();
                else whiteFrames.reset();
            } catch (Exception error) {
                setRunning(false); status.setText("The page response could not be read. Reload Facebook to continue."); return;
            }
            schedule(500);
        });
    }
    private void recoverUnrenderedPage(String message) {
        if (!desktop) mobileRecovery.blank();
        // Recreate before applying the compatibility agent, so changing it cannot
        // start a second load in the old document. Cookies remain in the profile.
        queueBrowserRecovery(message, !desktop);
    }
    private void ensureVisualReady() {
        if (web == null || historyChecked == navigation) return;
        historyChecked = navigation;
        if (web.copyBackForwardList().getSize() > 8) web.clearHistory();
        final WebView current = web;
        final int generation = navigation;
        current.postVisualStateCallback(generation, new WebView.VisualStateCallback() {
            @Override public void onComplete(long requestId) {
                if (current == web && active && generation == navigation) {
                    frameReady = true; current.requestLayout(); current.invalidate();
                }
            }
        });
    }
    private void handleStoppedPage(JSONObject result) {
        if (running || !active || failed || recovering) return;
        String kind = result.optString("kind");
        if ("hidden".equals(kind)) {
            // With the app focused, a hidden WebView is a rendering problem, not
            // a reason to cancel its deadline forever. Native dialogs are handled
            // before inspection, while they have the window focus.
            web.onResume(); web.resumeTimers(); web.requestLayout(); web.invalidate(); armLoadTimeout();
            status.setText("Restoring Facebook’s page visibility. The poke loop stays stopped."); return;
        }
        if ("login".equals(kind) || "basic-setup".equals(kind)) {
            finishPageWait(); whiteFrames.reset(); loading = false;
            if ("login".equals(kind)) status.setText("Sign in to Facebook, then tap Open Pokes.");
            if ("basic-setup".equals(kind)) status.setText("Tap Continue on Facebook’s Basic mode offer when you are ready.");
            return;
        }
        if (result.optBoolean("ready")) {
            loading = false; finishPageWait(); browserNotice.setVisibility(View.GONE);
            if (result.optBoolean("pokes")) {
                rememberPokesLink(currentBrowserUrl());
                pokesExpected = true; basicSetupOpen = false;
                status.setText("Pokes is ready. Tap Start loop to begin.");
            } else renderControls();
            browserRecovery.healthy(SystemClock.elapsedRealtime());
            ensureVisualReady(); checkVisibleFrame();
            return;
        }
        if ("blank".equals(kind) || "stalled".equals(kind)) {
            recoverUnrenderedPage("Facebook did not render. Restoring the page; the poke loop stays stopped."); return;
        }
        if (pokesExpected || basicSetupOpen) {
            status.setText("Waiting for Facebook to render. Page recovery is active; no pokes are being sent.");
            armLoadTimeout();
        }
    }
    private void checkVisibleFrame() {
        // A compositor can show white even while DOM checks say the page is ready.
        // Sample only the browser rectangle, in memory; never save or transmit it.
        if (web == null || desktop || loading || clickPending || recovering || !active || !hasWindowFocus()
            || browserNotice.getVisibility() == View.VISIBLE) { whiteFrames.reset(); return; }
        long now = SystemClock.elapsedRealtime();
        if (!frameReady || frameProbePending || now - lastFrameProbe < 5_000
            || web.getWidth() < 1 || web.getHeight() < 1) return;
        lastFrameProbe = now; frameProbePending = true;
        final WebView current = web;
        final int generation = navigation;
        int[] position = new int[2]; current.getLocationInWindow(position);
        Rect area = new Rect(position[0], position[1], position[0] + current.getWidth(), position[1] + current.getHeight());
        final Bitmap sample = Bitmap.createBitmap(64, 64, Bitmap.Config.ARGB_8888);
        try {
            PixelCopy.request(getWindow(), area, sample, result -> {
                frameProbePending = false;
                try {
                    if (result != PixelCopy.SUCCESS || current != web || generation != navigation || !active
                        || clickPending || recovering || !hasWindowFocus()) { whiteFrames.reset(); return; }
                    int[] pixels = new int[64 * 64]; sample.getPixels(pixels, 0, 64, 0, 0, 64, 64);
                    if (whiteFrames.observe(SystemClock.elapsedRealtime(), pixels)) {
                        whiteFrames.reset(); recoverUnrenderedPage("The mobile browser kept displaying a white page.");
                    }
                } finally { sample.recycle(); }
            }, handler);
        } catch (IllegalArgumentException error) {
            frameProbePending = false; whiteFrames.reset(); sample.recycle();
        }
    }
    private void persistState() {
        // Keep preference writes ordered with the durable pre-click journal.
        final String serialized = loopState.toString();
        stateWriter.execute(() -> {
            if (!prefs.edit().putString("state", serialized).commit()) handler.post(() -> {
                if (web != null) { setRunning(false); status.setText("Settings could not be saved. Loop paused."); }
            });
        });
    }
    private void toggleLoop() {
        setRunning(!running);
        if (running && (failed || (basicMode && (web == null || !pokesUrl(web.getUrl()))))) openPokes();
    }
    private void setRunning(boolean value) {
        loopEpoch++;
        if (!value && running && pendingPokesEntry) {
            pendingPokesEntry = false; uiPokesRefresh = false; entryBusy = false; entryAwaiting = false; entrySequence++;
            if (!pokesUrl(currentBrowserUrl())) { pokesExpected = false; basicSetupOpen = true; }
        }
        if (value && !running) { recovery.reset(); browserRecovery.reset(); }
        running = value; prefs.edit().putBoolean("running", running).apply();
        handler.removeCallbacks(poll);
        if (!running) {
            whiteFrames.reset(); finishPageWait();
            if (!repairingBrowser) { recovering = false; handler.removeCallbacks(retryLoad); }
            scheduleCarrier(250);
        }
        renderControls(); armLoadTimeout(); if (running) schedule(100);
    }
    private void renderControls() {
        if (toggle == null) return;
        toggle.setText(running ? "Stop loop" : "Start loop");
        toggle.setBackground(rounded(running ? Color.rgb(250, 185, 179) : MINT, 12));
        if (!running) status.setText(basicSetupOpen ? "Finish Facebook’s Basic mode setup, then tap Open Pokes and Start loop."
            : "Loop stopped. Tap Start to watch for poke backs.");
        if (!basicMode) updateBasicStatus("off");
        count.setText(loopState.optInt("attempts") + " click attempts · " + (adaptive ? "adaptive refresh" : "refresh " + refreshSeconds + "s"));
        if (running && active && keepAwake) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
    private void updateBasicStatus(String state) {
        lastBasicState = state.matches("basic|data|offer|unknown") ? state : "unknown";
        if (basicStatus == null) return;
        if (!basicMode) { basicStatus.setText("Basic mode profile: off"); return; }
        switch (state) {
            case "offer": basicStatus.setText("Basic offer: tap Continue on Facebook"); break;
            case "basic": basicStatus.setText("Basic mode banner detected"); break;
            case "data": basicStatus.setText("Facebook shows Data mode"); break;
            default: basicStatus.setText("Basic mode: not confirmed"); break;
        }
    }
    private void scheduleCarrier(long delay) {
        handler.removeCallbacks(carrierPoll);
        if (active && !failed && web != null && trusted(web.getUrl())) handler.postDelayed(carrierPoll, delay);
    }
    private void readCarrier() {
        if (!active || failed || recovering || web == null || !trusted(web.getUrl())) return;
        if (pendingPokesEntry) { tryPokesEntry(); scheduleCarrier(750); return; }
        // The loop already returns this passive UI signal while it is running.
        if (running) { scheduleCarrier(1500); return; }
        if (!hasWindowFocus()) { finishPageWait(); scheduleCarrier(1500); return; }
        if (carrierReading) return;
        armLoadTimeout();
        carrierReading = true;
        final int generation = navigation, sequence = ++carrierSequence;
        final WebView current = web;
        JSONObject cfg = new JSONObject();
        try { cfg.put("now", System.currentTimeMillis()); cfg.put("pokesExpected", pokesExpected); cfg.put("browserExpected", basicSetupOpen || pokesExpected); }
        catch (Exception ignored) { }
        String expression = "(function(){try{" + basicScript + "\n" + healthScript
            + "\nreturn JSON.stringify(Object.assign(window.__autoPokeBasic.read(),window.__autoPokeHealth.read(" + cfg
            + "),{pokesLink:window.__autoPokeBasic.pokesLink()}));}catch(e){return JSON.stringify({state:'unknown',kind:'loading'});}})()";
        current.evaluateJavascript(expression, raw -> {
            if (current != web || generation != navigation || sequence != carrierSequence) return;
            carrierReading = false;
            if (!active) return;
            try {
                Object decoded = new JSONTokener(raw).nextValue();
                JSONObject result = decoded instanceof String ? new JSONObject((String) decoded) : new JSONObject();
                updateBasicStatus(result.optString("state", "unknown"));
                if ("basic".equals(result.optString("state"))) {
                    String origin = BasicNavigation.origin(currentBrowserUrl());
                    if (!origin.isEmpty() && !origin.equals(basicOrigin)) { basicOrigin = origin; prefs.edit().putString("basicOrigin", origin).apply(); }
                }
                rememberPokesLink(result.optString("pokesLink", ""));
                handleStoppedPage(result);
            } catch (Exception ignored) { updateBasicStatus("unknown"); }
            scheduleCarrier(1500);
        });
    }
    private void showBasicSetup() {
        new AlertDialog.Builder(this).setTitle("Facebook Basic mode / Basic mode plus")
            .setMessage("Use your carrier’s mobile data with Wi-Fi off.\n\nOpen Facebook here and sign in. If Facebook offers Basic mode, tap its Continue button yourself. Then tap Open Pokes and Start loop.\n\nAvailability, quota and charges are controlled by Facebook and your carrier. A banner is not billing verification. AutoPoke cannot enroll your SIM or transfer Chrome’s sign-in.")
            .setPositiveButton("Open Facebook setup", (d, w) -> {
                setRunning(false); pendingPokesEntry = false; uiPokesRefresh = false; entryBusy = false; entrySequence++; loadDiagnostics.clear();
                basicMode = true; desktop = false; basicSetupOpen = true;
                prefs.edit().putBoolean("basicMode", true).putBoolean("desktop", false).apply();
                String target = BasicNavigation.home(currentBrowserUrl(), basicOrigin);
                recovery.reset(); browserRecovery.reset(); whiteFrames.reset();
                if (web == null) createBrowser(); else { web.stopLoading(); applyUserAgent(); }
                renderControls(); updateBasicStatus("unknown");
                loadBrowserTarget(target, false);
            }).setNegativeButton("Cancel", null).show();
    }
    private String currentBrowserUrl() { return web != null && web.getUrl() != null ? web.getUrl() : lastBrowserUrl; }
    private void rememberPokesLink(String link) {
        if (BasicNavigation.pokesLink(link)) pokesLink = BasicNavigation.pokes(link, "", basicOrigin);
    }
    private void preparePokesEntry() {
        uiPokesRefresh = false;
        pendingPokesEntry = true; entryAwaiting = false; menuAttempted = false; entryBusy = false; entrySequence++;
    }
    private void beginBasicPokesEntry() {
        preparePokesEntry();
        // Bootstrap the carrier's Home document before following Facebook's UI.
        // Do not turn a client-side navigation link into a fresh deep-link GET.
        loadBrowserTarget(BasicNavigation.home(currentBrowserUrl(), basicOrigin), true);
    }
    private void refreshPokes() {
        if (!basicMode) { openPokes(); return; }
        if (web == null || failed || !trusted(currentBrowserUrl())) { openPokes(); return; }
        // Keep the already bootstrapped carrier document. Re-enter Pokes using
        // Facebook's rendered controls; no loadUrl/reload/history replay here.
        preparePokesEntry();
        uiPokesRefresh = true; uiRefreshCycle++; nextUiRefreshAt = 0; lastUiRefreshPhase = "start";
        finishPageWait(); whiteFrames.reset();
        tryPokesEntry(); schedule(500); scheduleCarrier(750);
    }
    private void tryPokesEntry() {
        if (!pendingPokesEntry || !active || failed || recovering || web == null || !trusted(web.getUrl()) || entryBusy) return;
        if (!hasWindowFocus()) { finishPageWait(); return; }
        armLoadTimeout(); entryBusy = true;
        final int generation = navigation, sequence = ++entrySequence;
        final WebView current = web;
        final boolean refreshing = uiPokesRefresh;
        JSONObject cfg = new JSONObject();
        try {
            cfg.put("now", System.currentTimeMillis()); cfg.put("allowMenu", !menuAttempted); cfg.put("awaiting", entryAwaiting);
            cfg.put("cycle", uiRefreshCycle); cfg.put("epoch", loopEpoch);
        }
        catch (Exception ignored) { }
        String expression = "(function(){try{" + basicScript + "\n" + healthScript + "\n" + entryScript
            + "\nreturn JSON.stringify(Object.assign(window.__autoPokeBasic.read(),window.__autoPokeEntry."
            + (refreshing ? "refresh" : "open") + "(" + cfg + ")));}catch(e){return JSON.stringify({kind:'error'});}})()";
        current.evaluateJavascript(expression, raw -> {
            if (current != web || generation != navigation || sequence != entrySequence) return;
            entryBusy = false;
            if (!active || !pendingPokesEntry) return;
            try {
                Object decoded = new JSONTokener(raw).nextValue();
                JSONObject result = decoded instanceof String ? new JSONObject((String) decoded) : new JSONObject();
                String kind = result.optString("kind");
                if (refreshing) {
                    String phase = result.optString("phase", "unknown");
                    lastUiRefreshPhase = phase.matches("start|back|entry|settling|done|unavailable") ? phase : "unknown";
                    String source = result.optString("returnSource", "unrecorded");
                    lastUiReturnSource = source.matches("notification|pokes-link|unrecorded") ? source : "unrecorded";
                }
                updateBasicStatus(result.optString("state", "unknown"));
                rememberPokesLink(result.optString("pokesLink", ""));
                if ("existing".equals(kind)) {
                    rememberPokesLink(currentBrowserUrl());
                    uiPokesRefresh = false; nextUiRefreshAt = 0;
                    pendingPokesEntry = false; entryAwaiting = false; pokesExpected = true; basicSetupOpen = false;
                    loading = false; finishPageWait(); ensureVisualReady();
                    status.setText(running ? "Pokes opened through Facebook. Watching for Poke back…" : "Pokes is ready. Tap Start loop.");
                    if (running) schedule(100);
                } else if ("refreshing".equals(kind)) {
                    finishPageWait(); status.setText("Updating Pokes through Facebook’s page controls…");
                } else if ("refresh-unavailable".equals(kind)) {
                    entryAwaiting = false; finishPageWait();
                    nextUiRefreshAt = SystemClock.elapsedRealtime() + 30_000;
                    if (result.optBoolean("pokes")) {
                        uiPokesRefresh = false;
                        pendingPokesEntry = false; pokesExpected = true; basicSetupOpen = false; loading = false;
                        ensureVisualReady();
                        status.setText("Keeping Pokes open and scanning. Facebook’s refresh controls are unavailable.");
                    } else status.setText("Open Pokes inside Facebook to continue; its navigation control is not available here.");
                } else if ("clicked".equals(kind)) {
                    entryAwaiting = true; status.setText("Opening Pokes through Facebook’s own link…");
                } else if ("menu".equals(kind)) {
                    menuAttempted = true; status.setText("Facebook menu opened. Looking for Pokes…");
                } else if ("login".equals(kind) || "basic-setup".equals(kind)) {
                    finishPageWait(); status.setText("login".equals(kind) ? "Sign in to Facebook to continue."
                        : "Tap Continue on Facebook’s Basic mode offer yourself.");
                } else if ("missing".equals(kind)) {
                    finishPageWait(); status.setText("Facebook loaded. Open Menu → Pokes inside Facebook; a Pokes link is not visible here.");
                } else if ("blank".equals(kind) || "stalled".equals(kind)) {
                    recoverUnrenderedPage("Facebook’s page stayed empty. Load details are available in Settings."); return;
                } else status.setText("Waiting for Facebook’s Home/Pokes view. No data-mode switch is being made.");
            } catch (Exception ignored) { status.setText("Facebook navigation returned no usable result. Check the load report in Settings."); }
            scheduleCarrier(750); if (running) schedule(500);
        });
    }
    private void copyLoadReport() {
        String version = "unknown";
        android.content.pm.PackageInfo info = WebView.getCurrentWebViewPackage();
        if (info != null) version = info.versionName;
        ConnectivityManager manager = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        NetworkCapabilities network = manager == null ? null : manager.getNetworkCapabilities(manager.getActiveNetwork());
        String transport = network == null ? "none" : network.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) ? "cellular"
            : network.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ? "Wi-Fi" : "other/VPN";
        String category = authenticationUrl(currentBrowserUrl()) ? "sign-in" : pokesUrl(currentBrowserUrl()) ? "Pokes" : "Home/other Facebook view";
        final String prefix = "AutoPoke 1.1.11 load report\nAndroid API: " + Build.VERSION.SDK_INT + "\nWebView: " + version
            + "\nNetwork: " + transport + "\nPage category: " + category + "\nBasic banner signal: " + lastBasicState
            + "\nLoop running: " + running + "\nUI entry pending: " + pendingPokesEntry
            + "\nRefresh strategy: " + (basicMode ? "Facebook page controls" : "Pokes URL")
            + "\nUI refresh active: " + uiPokesRefresh + "\nUI refresh phase: " + lastUiRefreshPhase
            + "\nRecorded Pokes entry: " + lastUiReturnSource
            + "\n" + loadDiagnostics.summary() + "\n";
        if (web == null) { putLoadReport(prefix + "DOM: browser unavailable"); return; }
        final int generation = navigation;
        final int reportId = ++reportSequence;
        Runnable timeout = () -> {
            if (reportId == reportSequence) { reportSequence++; putLoadReport(prefix + "DOM: browser did not answer within 5 seconds"); }
        };
        handler.postDelayed(timeout, 5000);
        web.evaluateJavascript("(function(){try{" + healthScript + "\nreturn JSON.stringify(window.__autoPokeHealth.diagnostics());}catch(e){return '{}';}})()", raw -> {
            if (reportId != reportSequence) return;
            handler.removeCallbacks(timeout);
            String sample = "DOM: sample unavailable";
            try {
                Object decoded = new JSONTokener(raw).nextValue();
                if (generation == navigation && decoded instanceof String) {
                    JSONObject rawCounts = new JSONObject((String) decoded), safeCounts = new JSONObject();
                    String state = rawCounts.optString("documentState", "unknown");
                    safeCounts.put("documentState", state.matches("loading|interactive|complete") ? state : "unknown");
                    for (String key : new String[]{"htmlCharacters", "bodyElements", "textCharacters", "scriptElements", "frames", "navigationBodyBytes"})
                        safeCounts.put(key, Math.max(-1L, Math.min(100_000_000L, rawCounts.optLong(key, -1))));
                    JSONObject rawScan = rawCounts.optJSONObject("pokeScan");
                    if (rawScan != null) {
                        JSONObject scan = new JSONObject();
                        String view = rawScan.optString("view", "unknown");
                        scan.put("view", view.matches("pokes|notifications|other") ? view : "unknown");
                        for (String key : new String[]{"detected", "identified", "enabled", "eligible", "guarded", "unidentified"})
                            scan.put(key, Math.max(0L, Math.min(100_000L, rawScan.optLong(key, 0))));
                        safeCounts.put("pokeScan", scan);
                    }
                    sample = "DOM counts: " + safeCounts;
                }
            } catch (Exception ignored) { }
            putLoadReport(prefix + sample);
        });
    }
    private void putLoadReport(String report) {
        ClipboardManager clipboard = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
        if (clipboard == null) return;
        clipboard.setPrimaryClip(ClipData.newPlainText("AutoPoke load report", report));
        Toast.makeText(this, "Load report copied. Paste it when reporting the blank page.", Toast.LENGTH_LONG).show();
    }
    private void openPokes() {
        if (basicMode) {
            preparePokesEntry();
            if (web == null || failed || loading || !trusted(currentBrowserUrl())) beginBasicPokesEntry();
            else { tryPokesEntry(); scheduleCarrier(250); }
            return;
        }
        String target = pokesAddress();
        if (web == null) createBrowser();
        if (running && !hasNetwork()) { queueRecovery("Internet access is unavailable."); return; }
        loadBrowserTarget(target, true);
    }
    private void loadBrowserTarget(String target, boolean toPokes) {
        finishPageWait(); basicSetupOpen = !toPokes; pokesExpected = toPokes;
        if (web == null) createBrowser();
        failed = false; recovering = false; repairingBrowser = false;
        handler.removeCallbacks(poll); handler.removeCallbacks(retryLoad);
        // Use a fresh GET rather than re-submitting a previous form action.
        web.loadUrl(target); armLoadTimeout(); scheduleCarrier(250);
    }
    private String pokesAddress() {
        return basicMode ? BasicNavigation.pokes(currentBrowserUrl(), pokesLink, basicOrigin) : mobileRecovery.address(desktop);
    }
    private void applyUserAgent() {
        web.setLayerType(!desktop && mobileRecovery.useSoftware() ? View.LAYER_TYPE_SOFTWARE : View.LAYER_TYPE_NONE, null);
        web.getSettings().setBlockNetworkImage(dataSaver);
        web.getSettings().setUserAgentString(mobileRecovery.userAgent(defaultUserAgent, desktop));
        web.getSettings().setUseWideViewPort(true); web.getSettings().setLoadWithOverviewMode(desktop);
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
        CheckBox saver = new CheckBox(this); saver.setText("Data saver: block images, refresh at least every 15s"); saver.setChecked(dataSaver); form.addView(saver);
        CheckBox free = new CheckBox(this); free.setText("Carrier Basic mode / Basic mode plus (mobile)"); free.setChecked(basicMode); form.addView(free);
        TextView freeInfo = text("Use the Basic mode button to open Facebook’s own setup. Accept its Continue offer manually. A detected banner does not verify carrier billing. Data saver only reduces downloads.", 12, MUTED); form.addView(freeInfo);
        CheckBox awake = new CheckBox(this); awake.setText("Keep screen awake while running"); awake.setChecked(keepAwake); form.addView(awake);
        CheckBox desktopBox = new CheckBox(this); desktopBox.setText("Desktop Facebook layout"); desktopBox.setChecked(desktop); desktopBox.setEnabled(!basicMode); form.addView(desktopBox);
        free.setOnCheckedChangeListener((box, enabled) -> { desktopBox.setEnabled(!enabled); if (enabled) desktopBox.setChecked(false); });
        CheckBox adaptiveBox = new CheckBox(this); adaptiveBox.setText("Increase refresh delay when idle"); adaptiveBox.setChecked(adaptive); form.addView(adaptiveBox);
        TextView info = text("Only Poke back is clicked. A click is an attempt, not confirmation. The loop pauses while the app is hidden and resumes when you return. Facebook sign-in and cookies stay in this app's WebView.", 12, MUTED);
        info.setPadding(0, dp(8), 0, dp(12)); form.addView(info);
        Button report = button("Copy load report", Color.rgb(35, 50, 69), Color.WHITE);
        report.setOnClickListener(v -> copyLoadReport()); form.addView(report);
        TextView reportInfo = text("If Pokes stays blank, share this report. It contains load errors and page counts, not page text, cookies or tokens.", 12, MUTED); form.addView(reportInfo);
        Button logout = button("Sign out / clear Facebook data", Color.rgb(35, 50, 69), Color.WHITE); form.addView(logout);
        ScrollView scroll = new ScrollView(this); scroll.addView(form);
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle("Loop settings").setView(scroll)
            .setPositiveButton("Save", null).setNegativeButton("Cancel", null).create();
        logout.setOnClickListener(v -> new AlertDialog.Builder(this).setTitle("Clear Facebook sign-in?")
            .setMessage("This stops the loop and removes this app's Facebook cookies, cached pages, and website storage.")
            .setPositiveButton("Clear", (d, w) -> {
                setRunning(false); dialog.dismiss(); navigation++; handler.removeCallbacks(poll);
                web.stopLoading(); web.loadUrl("about:blank");
                basicOrigin = ""; pokesLink = ""; prefs.edit().remove("basicOrigin").apply();
                android.webkit.WebStorage.getInstance().deleteAllData(); web.clearCache(true); web.clearHistory();
                CookieManager.getInstance().removeAllCookies(done -> { CookieManager.getInstance().flush(); openPokes(); });
            }).setNegativeButton("Cancel", null).show());
        dialog.setOnShowListener(d -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            try {
                int nextRefresh = Integer.parseInt(refresh.getText().toString().trim());
                int nextGap = Integer.parseInt(gap.getText().toString().trim());
                if (nextRefresh < 1 || nextRefresh > 300) { refresh.setError("Enter 1 to 300"); return; }
                if (nextGap < 5 || nextGap > 300) { gap.setError("Enter 5 to 300"); return; }
                boolean layoutChanged = desktop != desktopBox.isChecked() || dataSaver != saver.isChecked() || basicMode != free.isChecked();
                dataSaver = saver.isChecked(); basicMode = free.isChecked();
                prefs.edit().putBoolean("dataSaver", dataSaver).putBoolean("basicMode", basicMode).apply();
                refreshSeconds = nextRefresh; gapSeconds = nextGap; keepAwake = awake.isChecked(); desktop = desktopBox.isChecked(); adaptive = adaptiveBox.isChecked();
                prefs.edit().putInt("refresh", nextRefresh).putInt("gap", nextGap).putBoolean("keepAwake", keepAwake).putBoolean("desktop", desktop).putBoolean("adaptive", adaptive).apply();
                renderControls(); dialog.dismiss();
                if (layoutChanged) {
                    mobileRecovery.reset(); recovery.reset(); browserRecovery.reset(); carrierSequence++; carrierReading = false;
                    updateBasicStatus("unknown"); applyUserAgent(); openPokes(); scheduleCarrier(250);
                } else schedule(100);
            } catch (NumberFormatException error) { refresh.setError("Enter whole seconds in both fields"); }
        }));
        dialog.show();
    }
    @Override protected void onResume() {
        super.onResume(); active = true;
        renderControls(); scheduleCarrier(250);
        if (recovering) { if (web != null) { web.onResume(); web.resumeTimers(); } updateRecovery(); return; }
        if (web != null) {
            web.onResume(); web.resumeTimers(); renderControls();
            web.requestLayout(); web.invalidate(); armLoadTimeout();
            if (loading) { armLoadTimeout(); schedule(250); }
            else if (evaluating) armEvaluationTimeout();
            else if (savingGuard) { /* The saved-guard callback resumes polling. */ }
            else schedule(250);
        }
    }
    @Override protected void onPause() {
        entrySequence++; entryBusy = false;
        whiteFrames.reset(); carrierSequence++; carrierReading = false; handler.removeCallbacks(carrierPoll);
        active = false; loopEpoch++; handler.removeCallbacks(poll); handler.removeCallbacks(retryLoad); finishPageWait(); cancelEvaluationTimeout();
        if (web != null) { web.onPause(); web.pauseTimers(); CookieManager.getInstance().flush(); }
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); super.onPause();
    }
    @Override protected void onSaveInstanceState(Bundle out) {
        out.putBoolean("pendingPokesEntry", pendingPokesEntry);
        out.putBoolean("pokesExpected", pokesExpected); out.putBoolean("basicSetupOpen", basicSetupOpen);
        out.putString("lastBrowserUrl", lastBrowserUrl);
        if (web != null) web.saveState(out); super.onSaveInstanceState(out);
    }
    @Override public void onBackPressed() {
        pendingPokesEntry = false; uiPokesRefresh = false; entryBusy = false; entryAwaiting = false; entrySequence++; finishPageWait();
        if (web != null && web.canGoBack()) web.goBack(); else super.onBackPressed();
    }
    @Override protected void onDestroy() {
        handler.removeCallbacksAndMessages(null); stateWriter.shutdown();
        if (web != null) discardBrowser(web);
        super.onDestroy();
    }
}
