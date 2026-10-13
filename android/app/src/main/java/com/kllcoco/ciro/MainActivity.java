package com.kllcoco.ciro;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.DownloadManager;
import android.app.PendingIntent;
import android.database.Cursor;
import android.os.Environment;
import android.provider.Settings;
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
import java.net.HttpURLConnection;
import java.net.URL;
import java.io.File;
import java.io.FileOutputStream;
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
            view.addJavascriptInterface(new FilesBridge(), "CiroFiles");
            view.addJavascriptInterface(new UpdateBridge(), "CiroUpdate");
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

    /** Share a generated PNG (e.g. a conversation image) through the system share sheet, where it can also be saved. */
    private class FilesBridge {
        @JavascriptInterface
        public boolean shareImage(String base64, String name) {
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                if (bytes.length > 25 * 1024 * 1024) return false;
                File dir = new File(getCacheDir(), "shared");
                if (!dir.exists() && !dir.mkdirs()) return false;
                String safe = (name == null ? "ciro" : name).replaceAll("[^A-Za-z0-9._-]", "_");
                if (!safe.endsWith(".png")) safe = safe + ".png";
                File file = new File(dir, safe);
                try (FileOutputStream out = new FileOutputStream(file)) { out.write(bytes); }
                Uri uri = androidx.core.content.FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".fileprovider", file);
                Intent send = new Intent(Intent.ACTION_SEND).setType("image/png").putExtra(Intent.EXTRA_STREAM, uri)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                Intent chooser = Intent.createChooser(send, "Ciro");
                chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                runOnUiThread(() -> startActivity(chooser));
                return true;
            } catch (Exception e) {
                return false;
            }
        }
    }

    /** In-app update: download the newer APK from this project's GitHub release and hand it to the
     *  system installer (which only accepts it when it is signed with the same key as this app). */
    private static final String RELEASE_PREFIX = "https://github.com/kllcoco/frontend-UI/releases/download/";
    private volatile long updateDownloadId = -1;
    private volatile String updateFile = null;

    private class UpdateBridge {
        @JavascriptInterface
        public String version() {
            try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; }
            catch (Exception e) { return ""; }
        }

        /** Finds the latest release tag without the rate-limited GitHub API: the /releases/latest page
         *  redirects to /releases/tag/vX.Y.Z. Answers through window.ciroLatestResult(json). */
        @JavascriptInterface
        public void checkLatest() {
            new Thread(() -> {
                String result;
                HttpURLConnection conn = null;
                try {
                    conn = (HttpURLConnection) new URL("https://github.com/kllcoco/frontend-UI/releases/latest").openConnection();
                    conn.setInstanceFollowRedirects(false);
                    conn.setConnectTimeout(10000);
                    conn.setReadTimeout(10000);
                    conn.setRequestMethod("HEAD");
                    int code = conn.getResponseCode();
                    String location = conn.getHeaderField("Location");
                    java.util.regex.Matcher m = java.util.regex.Pattern.compile("/releases/tag/(v[0-9][0-9A-Za-z.\\-]*)$").matcher(location == null ? "" : location);
                    result = m.find() ? "{\"tag\":" + JSONObject.quote(m.group(1)) + "}" : "{\"error\":\"http-" + code + "\"}";
                } catch (Exception e) {
                    result = "{\"error\":\"network\"}";
                } finally {
                    if (conn != null) conn.disconnect();
                }
                evaluate("(function(){try{window.ciroLatestResult&&window.ciroLatestResult(" + result + ");}catch(e){}})()");
            }).start();
        }

        @JavascriptInterface
        public boolean download(String url, String name) {
            if (url == null || !url.startsWith(RELEASE_PREFIX) || name == null || !name.matches("[A-Za-z0-9._-]+\\.apk")) return false;
            try {
                File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                if (dir != null) { File old = new File(dir, name); if (old.exists()) old.delete(); }
                DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url))
                    .setTitle("Ciro " + name.replaceAll("^Android-Ciro-|\\.apk$", ""))
                    .setMimeType("application/vnd.android.package-archive")
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
                    .setDestinationInExternalFilesDir(MainActivity.this, Environment.DIRECTORY_DOWNLOADS, name);
                updateFile = name;
                updateDownloadId = dm.enqueue(request);
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        /** {"status":"running|done|failed|none","bytes":n,"total":n} */
        @JavascriptInterface
        public String progress() {
            if (updateDownloadId < 0) return "{\"status\":\"none\"}";
            DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
            try (Cursor c = dm.query(new DownloadManager.Query().setFilterById(updateDownloadId))) {
                if (c == null || !c.moveToFirst()) return "{\"status\":\"failed\"}";
                int status = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                long bytes = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
                long total = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
                String s = status == DownloadManager.STATUS_SUCCESSFUL ? "done" : status == DownloadManager.STATUS_FAILED ? "failed" : "running";
                return "{\"status\":\"" + s + "\",\"bytes\":" + bytes + ",\"total\":" + total + "}";
            } catch (Exception e) {
                return "{\"status\":\"failed\"}";
            }
        }

        /** "started", "need-permission" (the user must allow installs from Ciro first) or "missing". */
        @JavascriptInterface
        public String install() {
            File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            if (dir == null || updateFile == null) return "missing";
            File apk = new File(dir, updateFile);
            if (!apk.exists()) return "missing";
            if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
                runOnUiThread(() -> startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getPackageName()))));
                return "need-permission";
            }
            Uri uri = androidx.core.content.FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".fileprovider", apk);
            Intent intent = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            runOnUiThread(() -> startActivity(intent));
            return "started";
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
