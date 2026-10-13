package com.kllcoco.ciro;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import org.json.JSONArray;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    // Back button: let the web app close dialogs, menus and the sidebar first (window.ciroHandleBack),
    // then navigate WebView history, and finally send the app to the background instead of killing it.
    private static final String HANDLE_BACK =
        "(function(){try{return !!(window.ciroHandleBack&&window.ciroHandleBack());}catch(e){return false;}})()";
    private static final String NOTIFY_SHARE =
        "(function(){try{window.ciroReceiveShare&&window.ciroReceiveShare();}catch(e){}})()";
    private static final int MAX_IMAGES = 5;
    private static final int MAX_IMAGE_BYTES = 15 * 1024 * 1024;

    private static final String CHANNEL = "replies";
    private static final String EXTRA_CHAT = "ciro_chat";
    private static final int REQ_NOTIFY = 7301;
    private volatile boolean inBackground = false;
    private volatile String pendingChat = null;

    // Content shared from another app ("Share → Ciro"), held until the web app takes it.
    private volatile String pendingShare = null;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView view = getBridge() == null ? null : getBridge().getWebView();
        if (view != null) {
            view.addJavascriptInterface(new ShareBridge(), "CiroShare");
            view.addJavascriptInterface(new NotifyBridge(), "CiroNotify");
        }
        captureShare(getIntent());
        captureChat(getIntent());
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = getBridge() == null ? null : getBridge().getWebView();
                if (webView == null) { moveTaskToBack(true); return; }
                webView.evaluateJavascript(HANDLE_BACK, value -> {
                    if ("true".equals(value)) return;
                    if (webView.canGoBack()) webView.goBack();
                    else moveTaskToBack(true);
                });
            }
        });
    }

    @Override
    public void onResume() {
        super.onResume();
        inBackground = false;
        openPendingChat();
    }

    @Override
    public void onPause() {
        super.onPause();
        inBackground = true;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != REQ_NOTIFY) return;
        evaluate("(function(){try{window.ciroNotifyResult&&window.ciroNotifyResult('" + notifyStatus() + "');}catch(e){}})()");
    }

    private void evaluate(String js) {
        WebView webView = getBridge() == null ? null : getBridge().getWebView();
        if (webView != null) webView.post(() -> webView.evaluateJavascript(js, null));
    }

    // Tapping a "reply finished" notification opens that chat (once the web app is ready).
    private void captureChat(Intent intent) {
        String id = intent == null ? null : intent.getStringExtra(EXTRA_CHAT);
        if (id == null || id.isEmpty()) return;
        pendingChat = id;
        intent.removeExtra(EXTRA_CHAT);
    }

    private void openPendingChat() {
        String id = pendingChat;
        if (id == null) return;
        pendingChat = null;
        evaluate("(function(){try{window.ciroOpenChat&&window.ciroOpenChat(" + JSONObject.quote(id) + ");}catch(e){}})()");
    }

    private String notifyStatus() {
        if (!NotificationManagerCompat.from(this).areNotificationsEnabled()) {
            if (Build.VERSION.SDK_INT >= 33
                && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
                return "default";
            return "denied";
        }
        return "granted";
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        captureChat(intent);
        if (captureShare(intent)) {
            WebView webView = getBridge() == null ? null : getBridge().getWebView();
            if (webView != null) webView.post(() -> webView.evaluateJavascript(NOTIFY_SHARE, null));
        }
    }

    private boolean captureShare(Intent intent) {
        if (intent == null) return false;
        String action = intent.getAction();
        if (!Intent.ACTION_SEND.equals(action) && !Intent.ACTION_SEND_MULTIPLE.equals(action)) return false;
        try {
            JSONObject share = new JSONObject();
            String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
            CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
            share.put("subject", subject == null ? "" : subject);
            share.put("text", text == null ? "" : text.toString());
            ArrayList<Uri> uris = new ArrayList<>();
            if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
                ArrayList<Uri> list = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
                if (list != null) uris.addAll(list);
            } else {
                Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
                if (uri != null) uris.add(uri);
            }
            JSONArray images = new JSONArray();
            for (Uri uri : uris) {
                if (images.length() >= MAX_IMAGES) break;
                String type = getContentResolver().getType(uri);
                if (type == null || !type.startsWith("image/")) continue;
                byte[] bytes = read(uri);
                if (bytes == null) continue;
                images.put("data:" + type + ";base64," + Base64.encodeToString(bytes, Base64.NO_WRAP));
            }
            share.put("images", images);
            if (share.getString("text").isEmpty() && images.length() == 0) return false;
            pendingShare = share.toString();
            intent.setAction(Intent.ACTION_MAIN); // don't re-deliver on recreate
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private byte[] read(Uri uri) {
        try (InputStream in = getContentResolver().openInputStream(uri)) {
            if (in == null) return null;
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) != -1) {
                out.write(buf, 0, n);
                if (out.size() > MAX_IMAGE_BYTES) return null;
            }
            return out.toByteArray();
        } catch (Exception e) {
            return null;
        }
    }

    private class NotifyBridge {
        @JavascriptInterface
        public String status() { return notifyStatus(); }

        @JavascriptInterface
        public boolean background() { return inBackground; }

        /** Shows the system prompt (Android 13+), or the app's notification settings when it was turned off there. */
        @JavascriptInterface
        public void request() {
            runOnUiThread(() -> {
                String state = notifyStatus();
                if (state.equals("granted")) {
                    evaluate("(function(){try{window.ciroNotifyResult&&window.ciroNotifyResult('granted');}catch(e){}})()");
                } else if (Build.VERSION.SDK_INT >= 33 && state.equals("default")) {
                    ActivityCompat.requestPermissions(MainActivity.this, new String[] { Manifest.permission.POST_NOTIFICATIONS }, REQ_NOTIFY);
                } else {
                    try {
                        Intent settings = new Intent("android.settings.APP_NOTIFICATION_SETTINGS");
                        settings.putExtra("android.provider.extra.APP_PACKAGE", getPackageName());
                        startActivity(settings);
                    } catch (Exception ignored) { }
                    evaluate("(function(){try{window.ciroNotifyResult&&window.ciroNotifyResult('denied');}catch(e){}})()");
                }
            });
        }

        @JavascriptInterface
        public void show(String title, String body, String tag) {
            if (!notifyStatus().equals("granted")) return;
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (Build.VERSION.SDK_INT >= 26 && manager != null && manager.getNotificationChannel(CHANNEL) == null) {
                manager.createNotificationChannel(new NotificationChannel(CHANNEL, "回答完成", NotificationManager.IMPORTANCE_DEFAULT));
            }
            Intent open = new Intent(MainActivity.this, MainActivity.class)
                .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP)
                .putExtra(EXTRA_CHAT, tag == null ? "" : tag);
            int id = tag == null ? 0 : tag.hashCode();
            PendingIntent pending = PendingIntent.getActivity(MainActivity.this, id, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            NotificationCompat.Builder builder = new NotificationCompat.Builder(MainActivity.this, CHANNEL)
                .setSmallIcon(R.drawable.ic_notify)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setContentIntent(pending)
                .setAutoCancel(true);
            try {
                NotificationManagerCompat.from(MainActivity.this).notify(id, builder.build());
            } catch (SecurityException ignored) { }
        }
    }

    private class ShareBridge {
        /** Returns the pending share as JSON once, or null. */
        @JavascriptInterface
        public String take() {
            String value = pendingShare;
            pendingShare = null;
            return value;
        }
    }
}
