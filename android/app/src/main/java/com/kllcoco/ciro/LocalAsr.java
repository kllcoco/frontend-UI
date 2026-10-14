package com.kllcoco.ciro;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import org.json.JSONObject;
import org.vosk.Model;
import org.vosk.Recognizer;
import org.vosk.android.RecognitionListener;
import org.vosk.android.SpeechService;

/**
 * Offline Chinese speech recognition (Vosk) for phones without a working system speech service — most phones sold
 * in China have none, so voice input and voice wake would otherwise do nothing. The model (about 42 MB) is
 * downloaded once, the first time voice is used, from the Ciro release (or the Vosk site), and kept in the app's files.
 */
final class LocalAsr {
    interface Progress { void at(int percent); }
    interface Ready { void ok(Model model); void fail(String why); }

    private static final String[] SOURCES = {
        "https://github.com/kllcoco/frontend-UI/releases/latest/download/Android-voice-model-cn.zip",
        "https://alphacephei.com/vosk/models/vosk-model-small-cn-0.22.zip"
    };
    private static final Handler main = new Handler(Looper.getMainLooper());
    private static Model model;
    private static boolean loading = false;
    private static final List<Ready> waiting = new ArrayList<>();
    private static final List<Progress> watchers = new ArrayList<>();

    private LocalAsr() {}

    private static File dir(Context ctx) { return new File(ctx.getFilesDir(), "vosk-cn"); }
    static boolean installed(Context ctx) { return new File(dir(ctx), "ready").exists(); }

    /** The loaded model, downloading and unpacking it first when needed. Callbacks run on the main thread. */
    static synchronized void ensure(Context context, Progress progress, Ready ready) {
        if (model != null) { Model m = model; main.post(() -> ready.ok(m)); return; }
        waiting.add(ready);
        if (progress != null) watchers.add(progress);
        if (loading) return;
        loading = true;
        Context ctx = context.getApplicationContext();
        new Thread(() -> {
            String error = null;
            Model loaded = null;
            try {
                if (!installed(ctx)) download(ctx);
                loaded = new Model(dir(ctx).getAbsolutePath());
            } catch (Throwable e) {
                error = e.getMessage() == null ? e.toString() : e.getMessage();
            }
            final Model m = loaded; final String why = error;
            synchronized (LocalAsr.class) {
                loading = false;
                model = m;
                List<Ready> list = new ArrayList<>(waiting);
                waiting.clear(); watchers.clear();
                main.post(() -> { for (Ready r : list) { if (m != null) r.ok(m); else r.fail(why); } });
            }
        }, "ciro-asr-model").start();
    }

    private static void report(int percent) {
        List<Progress> list;
        synchronized (LocalAsr.class) { list = new ArrayList<>(watchers); }
        main.post(() -> { for (Progress p : list) p.at(percent); });
    }

    private static void download(Context ctx) throws Exception {
        File zip = new File(ctx.getCacheDir(), "vosk-cn.zip");
        Exception last = null;
        for (String source : SOURCES) {
            try { fetch(source, zip); last = null; break; }
            catch (Exception e) { last = e; }
        }
        if (last != null) throw new Exception("离线语音模型下载失败，请检查网络后再试");
        File target = dir(ctx), tmp = new File(ctx.getFilesDir(), "vosk-cn.tmp");
        deleteAll(tmp);
        tmp.mkdirs();
        try (ZipInputStream in = new ZipInputStream(new BufferedInputStream(new java.io.FileInputStream(zip)))) {
            ZipEntry e;
            byte[] buf = new byte[65536];
            while ((e = in.getNextEntry()) != null) {
                String name = e.getName();
                int slash = name.indexOf('/');
                String rel = slash >= 0 ? name.substring(slash + 1) : name; // drop the top folder
                if (rel.isEmpty() || rel.contains("..")) continue;
                File out = new File(tmp, rel);
                if (e.isDirectory()) { out.mkdirs(); continue; }
                out.getParentFile().mkdirs();
                try (OutputStream o = new FileOutputStream(out)) { int n; while ((n = in.read(buf)) > 0) o.write(buf, 0, n); }
            }
        }
        zip.delete();
        deleteAll(target);
        if (!tmp.renameTo(target)) throw new Exception("离线语音模型解压失败");
        new FileOutputStream(new File(target, "ready")).close();
    }

    private static void fetch(String source, File to) throws Exception {
        String url = source;
        for (int hop = 0; hop < 6; hop++) {
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(20_000);
            c.setReadTimeout(60_000);
            int code = c.getResponseCode();
            if (code >= 300 && code < 400) { url = new URL(new URL(url), c.getHeaderField("Location")).toString(); c.disconnect(); continue; }
            if (code != 200) { c.disconnect(); throw new Exception("HTTP " + code); }
            long total = c.getContentLengthLong();
            try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(to)) {
                byte[] buf = new byte[65536];
                long got = 0; int n, lastPct = -1;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    got += n;
                    if (total > 0) { int pct = (int) (got * 100 / total); if (pct != lastPct) { lastPct = pct; report(pct); } }
                }
            } finally { c.disconnect(); }
            if (to.length() < 1_000_000) throw new Exception("incomplete");
            return;
        }
        throw new Exception("too many redirects");
    }

    private static void deleteAll(File f) {
        if (!f.exists()) return;
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteAll(k);
        f.delete();
    }

    /** Starts listening with the model (16 kHz microphone); stop with service.stop() then shutdown(). */
    static SpeechService listen(Model m, RecognitionListener listener, int timeoutMs) throws Exception {
        SpeechService s = new SpeechService(new Recognizer(m, 16000.0f), 16000.0f);
        if (timeoutMs > 0) s.startListening(listener, timeoutMs); else s.startListening(listener);
        return s;
    }

    /** The text in a Vosk result ({"text": …} or {"partial": …}); Chinese words come with spaces between them. */
    static String text(String hypothesis) {
        try {
            JSONObject j = new JSONObject(hypothesis);
            String t = j.has("text") ? j.optString("text") : j.optString("partial");
            return t.replaceAll("(?<=[\\u4e00-\\u9fff]) +(?=[\\u4e00-\\u9fff])", "").trim();
        } catch (Exception e) { return ""; }
    }
}
