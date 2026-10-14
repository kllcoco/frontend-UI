package com.kllcoco.ciro;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Point;
import android.graphics.Rect;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.MotionEvent;
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
    // Room the page asks for above her (or below, hanging from the top) for a bubble, an answer or her menu, in dp;
    // the window is exactly her size plus that, so nothing else on the home screen is covered.
    private float extraW = 0, extraH = 0;
    // How far her sprite sits from the middle of a widened window (it could not be centred on her near a screen side).
    private int shiftPx = 0;
    // Fixed window origin for one drag gesture; pointer deltas are totals, not per-frame ticks.
    private boolean dragging = false;
    private int dragStartX, dragStartY;
    // Where the finger is on the physical screen (MotionEvent raw coordinates), read natively: the page's own
    // coordinates move with the window while it is dragged, so they cannot be trusted for the window position.
    private float downRawX = Float.NaN, downRawY = Float.NaN, lastRawX, lastRawY;
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

    /** 在手机桌面上显示 (Settings → 桌宠): off keeps her inside the app only. */
    boolean floating() { return prefs().getBoolean("floating", true); }
    void setFloating(boolean on) {
        prefs().edit().putBoolean("floating", on).apply();
        if (!on) main.post(this::hide);
    }

    void setEnabled(boolean on) {
        enabled = on;
        prefs().edit().putBoolean("enabled", on).apply();
        if (!on) main.post(this::hide);
    }

    private float density() { return activity.getResources().getDisplayMetrics().density; }
    private float scale() { return Math.max(0.5f, Math.min(1.6f, prefs().getFloat("scale", 0.85f))); }
    /** Her window takes touches everywhere inside it (Android has no click-through for overlays), so it hugs her:
     *  just her sprite (102 × 136 dp at size 1), only the part that shows when she hides at an edge, and the larger
     *  size only while a bubble, an answer or her menu is open (the page asks for it with expand). */
    private int[] sizeFor(String edge) {
        float s = scale(), sw = 102 * s, sh = 136 * s;
        float w, h;
        if (expanded && extraH <= 0) { w = Math.max(280, sw + 38); h = sh + 250; }
        else if ("left".equals(edge) || "right".equals(edge)) { w = sw * 0.8f + 8; h = sh + 16; }
        else if ("top".equals(edge) || "bottom".equals(edge)) { w = sw + 16; h = sh * 0.5f + 8; }
        else { w = sw + 16; h = sh + 16; }
        if (extraH > 0) { w = Math.max(w, extraW); h += extraH; }
        return new int[] { Math.round(w * density()), Math.round(h * density()) };
    }
    private String currentEdge() { return prefs().getString("edge", ""); }
    private int widthPx() { return sizeFor(currentEdge())[0]; }
    private int heightPx() { return sizeFor(currentEdge())[1]; }
    /** Resizes for a state, keeping her centre where it was (or her bottom, when it grows for a bubble). */
    private void fitSize(String edge) {
        int[] size = sizeFor(edge);
        params.x += (params.width - size[0]) / 2;
        params.y += params.height - size[1];
        params.width = size[0]; params.height = size[1];
    }
    /** System bar heights: the screen edges there belong to the notification shade and home / back gestures. */
    private int dimen(String name) {
        int id = activity.getResources().getIdentifier(name, "dimen", "android");
        return id > 0 ? activity.getResources().getDimensionPixelSize(id) : 0;
    }
    private int gutterSide() { return Math.round(30 * density()); }
    private int gutterTop() { return dimen("status_bar_height") + Math.round(40 * density()); }
    private int gutterBottom() { return dimen("navigation_bar_height") + Math.round(48 * density()); }
    /** The edge mode leaves part of the sprite available for grabbing; no extra gesture gutter here.
     * Free-floating positions remain clamped away from system gesture areas. */
    private void snapTo(String edge) {
        fitSize(edge);
        Rect s = screen();
        int w = params.width, h = params.height;
        if (edge.equals("left")) params.x = s.left;
        else if (edge.equals("right")) params.x = s.right - w;
        else if (edge.equals("bottom")) params.y = s.bottom - h;
        else if (edge.equals("top")) params.y = s.top;
        if (edge.equals("left") || edge.equals("right"))
            params.y = Math.max(s.top, Math.min(params.y, s.bottom - h));
        else
            params.x = Math.max(s.left, Math.min(params.x, s.right - w));
    }
    private Rect screen() {
        // Resources DisplayMetrics can exclude the status/navigation bars. Overlay positions
        // are absolute: use full physical display bounds for true edge alignment.
        if (wm != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R)
                return wm.getMaximumWindowMetrics().getBounds();
            Point size = new Point();
            wm.getDefaultDisplay().getRealSize(size);
            return new Rect(0, 0, size.x, size.y);
        }
        DisplayMetrics m = activity.getResources().getDisplayMetrics();
        return new Rect(0, 0, m.widthPixels, m.heightPixels);
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface", "ClickableViewAccessibility"})
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
        view.setOnTouchListener((v, e) -> {
            int a = e.getActionMasked();
            if (a == MotionEvent.ACTION_DOWN) { downRawX = lastRawX = e.getRawX(); downRawY = lastRawY = e.getRawY(); }
            else if (a == MotionEvent.ACTION_MOVE) {
                lastRawX = e.getRawX(); lastRawY = e.getRawY();
                if (dragging) followFinger();
            }
            return false; // the page still gets every touch (taps, pats, pinch)
        });
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
        view.loadUrl(ORIGIN + "index.html?pet=1&overlay=1&scale=" + scale() + (edge.isEmpty() ? "" : "&edge=" + edge)
            + (prefs().getBoolean("quiet", false) ? "&quiet=1" : ""));
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
        String edge = prefs().getString("edge", "");
        if (edge.isEmpty()) clamp(); else snapTo(edge);
        apply();
        save();
        if (tellPage) send("scale", String.valueOf(v));
    }

    /** Settings → 桌宠 → 更少对话 */
    void setQuiet(boolean on) {
        prefs().edit().putBoolean("quiet", on).apply();
        send("quiet", on ? "true" : "false");
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
        extraW = 0; extraH = 0; shiftPx = 0;
        dragging = false;
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
    private void save() {
        // Her own spot (not the widened window's): the window's base size around her sprite.
        String edge = currentEdge();
        float ew = extraW, eh = extraH; boolean ex = expanded;
        extraW = 0; extraH = 0; expanded = false;
        int[] base = sizeFor(edge);
        extraW = ew; extraH = eh; expanded = ex;
        int x = "left".equals(edge) ? params.x : "right".equals(edge) ? params.x + params.width - base[0] : params.x + params.width / 2 + shiftPx - base[0] / 2;
        int y = "top".equals(edge) ? params.y : params.y + params.height - base[1];
        prefs().edit().putInt("x", x).putInt("y", y).apply();
    }

    /** Resizes the window to her size plus the room asked for, keeping her exactly where she is on screen. */
    private void refit(float w, float h) {
        String edge = currentEdge();
        int oldW = params.width, oldH = params.height;
        int spriteCenter = params.x + oldW / 2 + shiftPx;
        extraW = w; extraH = h;
        int[] size = sizeFor(edge);
        params.width = size[0]; params.height = size[1];
        if (!"top".equals(edge)) params.y += oldH - params.height;
        if ("left".equals(edge)) shiftPx = 0;
        else if ("right".equals(edge)) { params.x += oldW - params.width; shiftPx = 0; }
        else {
            Rect s = screen();
            int x = spriteCenter - params.width / 2;
            // Widened near a screen side: the window stays on screen and her sprite moves off its middle instead.
            if (params.width > size[0] || h > 0) x = Math.max(s.left, Math.min(x, s.right - params.width));
            params.x = x;
            shiftPx = spriteCenter - (x + params.width / 2);
        }
        if (h <= 0) shiftPx = 0;
        send("shift", String.valueOf(Math.round(shiftPx / density())));
        apply();
    }

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

    /** During a drag the window follows the finger: start position plus how far the finger moved since it went down. */
    private void followFinger() {
        if (view == null || Float.isNaN(downRawX)) return;
        params.x = dragStartX + Math.round(lastRawX - downRawX);
        params.y = dragStartY + Math.round(lastRawY - downRawY);
        apply();
    }

    /** window.CiroPetHost: what the pet page asks the app to do. */
    private final class Host {
        /** Walking sends per-frame increments. Dragging sends total displacement from the gesture origin. */
        @JavascriptInterface public void moveBy(double dx, double dy) {
            if (!Double.isFinite(dx) || !Double.isFinite(dy)) return;
            main.post(() -> {
                if (view == null || dragging) return;
                params.x += (int) Math.round(dx * density());
                params.y += (int) Math.round(dy * density());
                apply();
            });
        }
        @JavascriptInterface public void beginDrag() {
            main.post(() -> {
                if (view == null) return;
                // Picked up from an edge: her whole body shows again while she is carried.
                if (extraH > 0) refit(0, 0);
                if (!currentEdge().isEmpty() && !expanded) { fitSize(""); apply(); }
                dragStartX = params.x;
                dragStartY = params.y;
                dragging = true;
                followFinger(); // catch up with the distance moved before the page called it a drag
            });
        }
        @JavascriptInterface public void dragTo(double dx, double dy) {
            if (!Double.isFinite(dx) || !Double.isFinite(dy)) return;
            main.post(() -> {
                if (view == null || !dragging) return;
                if (!Float.isNaN(downRawX)) { followFinger(); return; } // native finger position wins
                params.x = dragStartX + (int) Math.round(dx * density());
                params.y = dragStartY + (int) Math.round(dy * density());
                apply();
            });
        }
        @JavascriptInterface public void dragEnd() {
            main.post(() -> {
                if (view == null) return;
                dragging = false;
                Rect s = screen();
                int w = params.width, h = params.height;
                // Pulled partly past an edge: she hides there with only her head showing.
                String edge = params.x < -w / 4 ? "left" : params.x + w > s.right + w / 4 ? "right" : params.y + h > s.bottom + h / 5 ? "bottom" : params.y < -h / 4 ? "top" : "";
                if (edge.isEmpty()) fitSize("");
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
                if (extraH > 0) { refit(0, 0); }
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
                    fitSize("");
                    clamp();
                    prefs().edit().putString("edge", "").apply();
                }
                apply();
                save();
            });
        }
        @JavascriptInterface public void resize(double value) { main.post(() -> applyScale((float) value, false)); }
        /** Room for a bubble / answer / menu (dp; 0, 0 = just her). */
        @JavascriptInterface public void fit(double w, double h) {
            if (!Double.isFinite(w) || !Double.isFinite(h)) return;
            main.post(() -> {
                if (view == null || dragging) return;
                float nw = (float) Math.max(0, Math.min(w, 340)), nh = (float) Math.max(0, Math.min(h, 400));
                if (nh <= 0) nw = 0;
                // Never above the status bar: an answer near the top of the screen gets what room there is.
                if (nh > 0 && !"top".equals(currentEdge())) {
                    int baseH = params.height - Math.round(extraH * density());
                    float room = (params.y + params.height - baseH - dimen("status_bar_height")) / density();
                    nh = Math.max(40, Math.min(nh, room));
                }
                if (Math.abs(nw - extraW) < 2 && Math.abs(nh - extraH) < 2) return;
                refit(nw, nh);
            });
        }
        @JavascriptInterface public void expand(boolean on) {
            main.post(() -> {
                if (view == null || on == expanded) return;
                int oldW = params.width, oldH = params.height;
                expanded = on;
                params.width = widthPx(); params.height = heightPx();
                params.x += (oldW - params.width) / 2;
                params.y += oldH - params.height;
                String edge = prefs().getString("edge", "");
                if (edge.isEmpty()) clamp(); else snapTo(edge);
                apply();
            });
        }
        @JavascriptInterface public void action(String name) {
            main.post(() -> {
                if ("hide".equals(name)) {
                    setEnabled(false);
                    bringAppToFront("(function(){try{localStorage.setItem('ciro.pet.v1','off');window.dispatchEvent(new CustomEvent('ciro-pet-toggle',{detail:false}));}catch(e){}})()");
                } else if ("work".equals(name)) {
                    bringAppToFront("(function(){try{window.dispatchEvent(new Event('ciro-open-work'));}catch(e){}})()");
                } else if ("quick".equals(name)) {
                    bringAppToFront("(function(){try{var t=document.querySelector('textarea');t&&t.focus();}catch(e){}})()");
                } else bringAppToFront(null);
            });
        }
    }
}
