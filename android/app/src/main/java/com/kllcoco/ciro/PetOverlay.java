package com.kllcoco.ciro;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.InputStream;
import java.util.ArrayDeque;
import org.json.JSONObject;

/**
 * Ciro floating over other apps while the app is in the background (Settings → 桌宠, needs "display over other apps").
 * It is the same pet page (/?pet=1) as on the desktop, in its own small transparent WebView whose files come
 * straight from the app's bundled web assets; the app's main WebView forwards replies, progress and commands.
 */
final class PetOverlay {
    private static final String ORIGIN = "https://ciro-pet.local/";
    private static final String PREFS = "ciro_pet";
    private final Activity activity;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ArrayDeque<String> queue = new ArrayDeque<>();
    private WindowManager wm;
    private WebView view;
    private WindowManager.LayoutParams params;
    private boolean ready = false;
    private boolean expanded = false;
    volatile boolean enabled;

    PetOverlay(Activity activity) {
        this.activity = activity;
        enabled = prefs().getBoolean("enabled", false);
    }

    private SharedPreferences prefs() { return activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }
    boolean allowed() { return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(activity); }
    boolean showing() { return view != null; }

    void requestPermission() {
        if (allowed() || Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
        try {
            activity.startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + activity.getPackageName())));
        } catch (Exception ignored) { /* no such settings page on this device */ }
    }

    void setEnabled(boolean on) {
        enabled = on;
        prefs().edit().putBoolean("enabled", on).apply();
        if (!on) main.post(this::hide);
    }

    private float density() { return activity.getResources().getDisplayMetrics().density; }
    private float scale() { return Math.max(0.5f, Math.min(1.6f, prefs().getFloat("scale", 0.7f))); }
    private int widthPx() { float s = scale(); return Math.round(Math.max(expanded ? 280 : 150, 186 * s + 40) * density()); }
    private int heightPx() { float s = scale(); return Math.round((248 * s + (expanded ? 250 : 80)) * density()); }
    /** System bar heights: the screen edges there belong to the notification shade and home / back gestures. */
    private int dimen(String name) {
        int id = activity.getResources().getIdentifier(name, "dimen", "android");
        return id > 0 ? activity.getResources().getDimensionPixelSize(id) : 0;
    }
    private int gutterSide() { return Math.round(30 * density()); }
    private int gutterTop() { return dimen("status_bar_height") + Math.round(40 * density()); }
    private int gutterBottom() { return dimen("navigation_bar_height") + Math.round(48 * density()); }
    /** Where she sits when hiding at an edge: just inside the gesture areas, so she can always be dragged again. */
    private void snapTo(String edge) {
        Rect s = screen();
        int w = params.width, h = params.height;
        if (edge.equals("left")) params.x = gutterSide();
        else if (edge.equals("right")) params.x = s.right - w - gutterSide();
        else if (edge.equals("bottom")) params.y = s.bottom - h - gutterBottom();
        else if (edge.equals("top")) params.y = gutterTop();
    }
    private Rect screen() {
        DisplayMetrics m = activity.getResources().getDisplayMetrics();
        return new Rect(0, 0, m.widthPixels, m.heightPixels);
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    void show() {
        if (view != null || !enabled || !allowed()) return;
        wm = (WindowManager) activity.getSystemService(Context.WINDOW_SERVICE);
        if (wm == null) return;
        view = new WebView(activity);
        view.setBackgroundColor(Color.TRANSPARENT);
        // Her picture is drawn with WebGL: the floating window must be hardware accelerated, or it stays empty.
        view.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        WebSettings ws = view.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setAllowFileAccess(false);
        ws.setAllowContentAccess(false);
        view.addJavascriptInterface(new Host(), "CiroPetHost");
        view.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest request) { return asset(request.getUrl()); }
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) { return true; }
            @Override public void onPageFinished(WebView v, String url) { ready = true; flush(); }
        });
        Rect s = screen();
        int w = widthPx(), h = heightPx();
        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE;
        params = new WindowManager.LayoutParams(w, h, type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
                | WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED, PixelFormat.TRANSLUCENT);
        params.gravity = Gravity.TOP | Gravity.START;
        params.x = prefs().getInt("x", s.right - w - Math.round(8 * density()));
        params.y = prefs().getInt("y", s.bottom - h - Math.round(96 * density()));
        clamp();
        String saved = prefs().getString("edge", "");
        if (!saved.isEmpty()) snapTo(saved); // also moves a spot saved by an older version out of the gesture areas
        try { wm.addView(view, params); } catch (Exception e) { view.destroy(); view = null; return; }
        view.onResume();
        view.resumeTimers(); // the app's own WebView may have paused the shared JS timers when it went to the background
        String edge = prefs().getString("edge", "");
        view.loadUrl(ORIGIN + "index.html?pet=1&overlay=1&scale=" + scale() + (edge.isEmpty() ? "" : "&edge=" + edge));
    }

    /** New size (pinch on her, or the settings slider: then the page is told too). */
    void applyScale(float value, boolean tellPage) {
        float v = Math.max(0.5f, Math.min(1.6f, value));
        prefs().edit().putFloat("scale", v).apply();
        if (view == null) return;
        int oldW = params.width, oldH = params.height;
        params.width = widthPx(); params.height = heightPx();
        params.x += (oldW - params.width) / 2;
        params.y += oldH - params.height;
        clamp();
        apply();
        save();
        if (tellPage) send("scale", String.valueOf(v));
    }

    /** Settings → 桌宠 → 回到默认位置: forget the place, size and edge. */
    void resetPlace() {
        prefs().edit().remove("x").remove("y").remove("edge").remove("scale").apply();
        main.post(() -> { if (view != null) { hide(); show(); } });
    }

    void hide() {
        if (view == null) return;
        try { wm.removeView(view); } catch (Exception ignored) { /* already gone */ }
        view.destroy();
        view = null;
        ready = false;
        expanded = false;
        queue.clear();
    }

    /** Events for the page: command, progress, stream, signal, edge. Queued until the page has loaded. */
    void send(String kind, String json) {
        main.post(() -> {
            if (view == null) return;
            String js = "(function(){try{window.ciroPetHost&&window.ciroPetHost(" + JSONObject.quote(kind) + "," + JSONObject.quote(json) + ");}catch(e){}})()";
            if (!ready) { if (queue.size() > 40) queue.poll(); queue.add(js); return; }
            view.evaluateJavascript(js, null);
        });
    }
    private void flush() { while (view != null && !queue.isEmpty()) view.evaluateJavascript(queue.poll(), null); }

    /** Fully on screen and out of the system gesture areas (edges, status bar, navigation bar). */
    private void clamp() {
        Rect s = screen();
        int w = params.width, h = params.height;
        params.x = Math.max(gutterSide(), Math.min(params.x, s.right - w - gutterSide()));
        params.y = Math.max(gutterTop() - Math.round(40 * density()), Math.min(params.y, s.bottom - h - gutterBottom()));
    }
    private void apply() { if (view != null) try { wm.updateViewLayout(view, params); } catch (Exception ignored) { /* removed meanwhile */ } }
    private void save() { prefs().edit().putInt("x", params.x).putInt("y", params.y + (expanded ? Math.round(170 * density()) : 0)).apply(); }

    /** The app's own web files (index.html, /assets, /pet …) served to the overlay page. */
    private WebResourceResponse asset(Uri url) {
        if (url == null || !ORIGIN.startsWith(url.getScheme() + "://" + url.getHost())) return null;
        String path = url.getPath() == null || url.getPath().equals("/") ? "index.html" : url.getPath().substring(1);
        if (path.contains("..")) return null;
        try {
            InputStream in = activity.getAssets().open("public/" + path);
            String ext = MimeTypeMap.getFileExtensionFromUrl(path);
            String mime = "js".equals(ext) || "mjs".equals(ext) ? "text/javascript" : "css".equals(ext) ? "text/css" : "json".equals(ext) ? "application/json"
                : "webp".equals(ext) ? "image/webp" : "svg".equals(ext) ? "image/svg+xml" : "html".equals(ext) ? "text/html"
                : MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
            return new WebResourceResponse(mime == null ? "application/octet-stream" : mime, "UTF-8", in);
        } catch (Exception e) {
            return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", null, null);
        }
    }

    private void bringAppToFront(String js) {
        Intent intent = new Intent(activity, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        MainActivity.pendingPetJs = js;
        activity.startActivity(intent);
    }

    /** window.CiroPetHost: what the pet page asks the app to do. */
    private final class Host {
        @JavascriptInterface public void moveBy(double dx, double dy) {
            main.post(() -> {
                if (view == null) return;
                params.x += Math.round(dx * density());
                params.y += Math.round(dy * density());
                apply();
            });
        }
        @JavascriptInterface public void dragEnd() {
            main.post(() -> {
                if (view == null) return;
                Rect s = screen();
                int w = params.width, h = params.height;
                // Pulled partly past an edge: she hides there with only her head showing.
                String edge = params.x < -w / 4 ? "left" : params.x + w > s.right + w / 4 ? "right" : params.y + h > s.bottom + h / 5 ? "bottom" : params.y < -h / 4 ? "top" : "";
                clamp();
                if (!edge.isEmpty()) snapTo(edge);
                apply();
                save();
                prefs().edit().putString("edge", edge).apply();
                send("edge", edge.isEmpty() ? "null" : JSONObject.quote(edge));
            });
        }
        @JavascriptInterface public void edge(String what) {
            main.post(() -> {
                if (view == null) return;
                Rect s = screen();
                if ("auto".equals(what)) {
                    String edge = params.x + params.width / 2 < s.centerX() ? "left" : "right";
                    snapTo(edge);
                    prefs().edit().putString("edge", edge).apply();
                    send("edge", JSONObject.quote(edge));
                } else {
                    String prev = prefs().getString("edge", "");
                    if (prev.equals("top")) params.y += Math.round(params.height * 0.25f);
                    else if (prev.equals("bottom")) params.y -= Math.round(params.height * 0.15f);
                    clamp();
                    prefs().edit().putString("edge", "").apply();
                }
                apply();
                save();
            });
        }
        @JavascriptInterface public void resize(double value) { main.post(() -> applyScale((float) value, false)); }
        @JavascriptInterface public void expand(boolean on) {
            main.post(() -> {
                if (view == null || on == expanded) return;
                int oldW = params.width, oldH = params.height;
                expanded = on;
                params.width = widthPx(); params.height = heightPx();
                params.x += (oldW - params.width) / 2;
                params.y += oldH - params.height;
                clamp();
                apply();
            });
        }
        @JavascriptInterface public void action(String name) {
            main.post(() -> {
                if ("hide".equals(name)) {
                    setEnabled(false);
                    bringAppToFront("(function(){try{localStorage.setItem('ciro.pet.v1','off');window.dispatchEvent(new CustomEvent('ciro-pet-toggle',{detail:false}));}catch(e){}})()");
                } else if ("quick".equals(name)) {
                    bringAppToFront("(function(){try{var t=document.querySelector('textarea');t&&t.focus();}catch(e){}})()");
                } else bringAppToFront(null);
            });
        }
    }
}
