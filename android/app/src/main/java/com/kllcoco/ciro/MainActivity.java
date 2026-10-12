package com.kllcoco.ciro;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
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

    // Content shared from another app ("Share → Ciro"), held until the web app takes it.
    private volatile String pendingShare = null;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView view = getBridge() == null ? null : getBridge().getWebView();
        if (view != null) view.addJavascriptInterface(new ShareBridge(), "CiroShare");
        captureShare(getIntent());
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
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
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
