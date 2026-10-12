package com.kllcoco.ciro;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    // Back button: let the web app close dialogs, menus and the sidebar first (window.ciroHandleBack),
    // then navigate WebView history, and finally send the app to the background instead of killing it.
    private static final String HANDLE_BACK =
        "(function(){try{return !!(window.ciroHandleBack&&window.ciroHandleBack());}catch(e){return false;}})()";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
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
}
