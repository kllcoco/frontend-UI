package com.kllcoco.ciro;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import java.util.ArrayList;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Voice wake: while turned on (Settings → 桌宠 → 语音唤醒) this foreground service listens for "Ciro" with the
 * phone's speech recogniser. "Ciro, set an alarm for 7:30" goes straight to the app; a bare "Ciro" makes her
 * answer "我在" and the next sentence is the command. A notification shows it is listening and can stop it.
 */
public class WakeService extends Service {
    static final String STOP = "com.kllcoco.ciro.WAKE_STOP";
    private static final String CHANNEL = "wake";
    private static final int NOTE_ID = 7402;
    // "Ciro" as recognisers tend to write it (Chinese and English).
    private static final Pattern WAKE = Pattern.compile("(ciro|siro|cyro|sero|ciru|cirro|sirro|kiro|chiro|cielo|sierro|seero|sih?ro|c罗|西罗|希罗|西洛|希洛|席罗|赛罗|赛洛|茜罗|夕罗|喜罗|熙罗|惜罗|溪罗|西若|希若|西柔|希柔|西萝|希萝|西楼|希楼|细罗|思罗|斯罗|丝罗|司罗|私罗|四罗|吸罗|洗罗|习罗|息罗|锡罗|昔罗|悉罗|晰罗|犀罗|稀罗|兮罗|蜥罗|晞罗|西鲁|希露|西露|西诺|塞罗|瑟罗|色罗|赛若|赛柔)");
    static volatile boolean running = false;
    /** The app is taking speech input itself: let go of the microphone until it is done. */
    static volatile boolean paused = false;
    /** Set once the wake listener has let go of the microphone (or is not listening). */
    static volatile boolean micFree = true;
    /** The last sentence the recogniser heard (shown in Settings, so a custom wake word can be copied from it). */
    static volatile String lastHeard = "";
    private String[] custom = new String[0];
    private boolean offline = false; // the phone's offline model first only after the online one keeps failing
    private int netErrors = 0;
    private long noteAt = 0;
    /** What the listener is doing, for Settings ("正在下载离线语音模型 37%"…). */
    static volatile String status = "";
    // Offline recogniser instead of the system one (none on the phone, or it keeps failing).
    private boolean local = false;
    private org.vosk.android.SpeechService localSvc;
    private int hardErrors = 0;
    private boolean everHeard = false;
    // Offline: listening for the wake word only (grammar) or, right after it, for the command (free speech).
    private boolean localCommand = false;
    // How "Ciro" sounds to a Chinese recogniser (the offline model does not know the word itself).
    private static final String[] WAKE_SOUNDS = { "西罗", "希罗", "赛罗", "塞罗", "思罗", "斯罗", "席罗", "西洛", "希洛", "喜罗", "吸罗",
        "西若", "细罗", "肌肉", "鸡肉", "基罗", "吉罗", "西柔", "赛洛", "丝罗", "四罗", "息肉", "希若", "习罗" };

    private final Handler main = new Handler(Looper.getMainLooper());
    private SpeechRecognizer recognizer;
    private boolean listening = false;
    private long awaitingUntil = 0; // after a bare "Ciro": the next sentence is the command
    private int errors = 0;

    static boolean available(Context ctx) { return SpeechRecognizer.isRecognitionAvailable(ctx); }

    static String start(Context ctx) {
        if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) return "no-permission";
        // No system speech service (most phones sold in China): the offline recogniser (LocalAsr) takes over.
        ContextCompat.startForegroundService(ctx, new Intent(ctx, WakeService.class));
        ctx.getSharedPreferences("ciro_pet", MODE_PRIVATE).edit().putBoolean("wake", true).apply();
        return "ok";
    }

    /** Custom wake words (Settings → 语音唤醒), one per line or comma separated; "Ciro" always works too. */
    static String[] words(Context ctx) {
        String raw = ctx.getSharedPreferences("ciro_pet", MODE_PRIVATE).getString("wake_words", "");
        ArrayList<String> out = new ArrayList<>();
        for (String w : raw.split("[\\n,，、;；]+")) { String n = norm(w); if (n.length() >= 2 && out.size() < 10) out.add(n); }
        return out.toArray(new String[0]);
    }
    static void setWords(Context ctx, String raw) {
        ctx.getSharedPreferences("ciro_pet", MODE_PRIVATE).edit().putString("wake_words", raw == null ? "" : raw.trim()).apply();
        if (running) ctx.startService(new Intent(ctx, WakeService.class).setAction(RELOAD));
    }
    static final String RELOAD = "com.kllcoco.ciro.WAKE_RELOAD";
    private static String norm(String s) { return s == null ? "" : s.toLowerCase(Locale.ROOT).replaceAll("[\\s\\p{Punct}，。！？、：；“”‘’（）·…~～]+", ""); }

    static void stop(Context ctx) {
        ctx.getSharedPreferences("ciro_pet", MODE_PRIVATE).edit().putBoolean("wake", false).apply();
        ctx.stopService(new Intent(ctx, WakeService.class));
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && STOP.equals(intent.getAction())) { stop(this); return START_NOT_STICKY; }
        if (intent != null && RELOAD.equals(intent.getAction())) { custom = words(this); if (running) return START_NOT_STICKY; }
        Notification note = notification();
        if (Build.VERSION.SDK_INT >= 30) startForeground(NOTE_ID, note, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        else startForeground(NOTE_ID, note);
        running = true;
        custom = words(this);
        Speaker.init(this);
        local = !available(this) || getSharedPreferences("ciro_pet", MODE_PRIVATE).getBoolean("wake_local", false);
        main.post(local ? this::listenLocal : this::listen);
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        micFree = true;
        main.removeCallbacksAndMessages(null);
        stopLocal();
        status = "";
        if (recognizer != null) { try { recognizer.destroy(); } catch (Exception ignored) { /* gone */ } recognizer = null; }
        super.onDestroy();
    }

    private Notification notification() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm != null && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "语音唤醒", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        int imm = Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0;
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT), imm);
        PendingIntent stop = PendingIntent.getService(this, 1, new Intent(this, WakeService.class).setAction(STOP), imm);
        return new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("Ciro 在听")
            .setContentText(!status.isEmpty() ? status : lastHeard.isEmpty() ? "喊一声“" + wakeName() + "”，然后说你要做什么" : "刚听到：" + lastHeard)
            .setOngoing(true)
            .setContentIntent(open)
            .addAction(0, "关闭语音唤醒", stop)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }

    private String wakeName() {
        String raw = getSharedPreferences("ciro_pet", MODE_PRIVATE).getString("wake_words", "");
        String first = raw.split("[\\n,，、;；]+")[0].trim();
        return first.isEmpty() ? "Ciro" : first;
    }

    private void listen() {
        if (!running || local) return;
        if (paused) {
            if (listening && recognizer != null) { try { recognizer.cancel(); } catch (Exception ignored) { /* gone */ } listening = false; }
            micFree = true;
            main.postDelayed(this::listen, 500); return;
        }
        if (listening) return;
        if (Speaker.speaking()) { main.postDelayed(this::listen, 400); return; } // never listen to herself
        if (recognizer == null) {
            recognizer = SpeechRecognizer.createSpeechRecognizer(this);
            recognizer.setRecognitionListener(new Listener());
        }
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag())
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
            .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, offline)
            .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            .putExtra("android.speech.extra.SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS", 1200L)
            .putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getPackageName());
        try { recognizer.startListening(i); listening = true; micFree = false; main.removeCallbacks(checkPause); main.postDelayed(checkPause, 300); }
        catch (Exception e) { listening = false; main.postDelayed(this::listen, 2000); }
    }

    private final Runnable checkPause = new Runnable() {
        @Override public void run() {
            if (!running || !listening) return;
            if (paused) { listen(); return; }
            main.postDelayed(this, 300);
        }
    };

    // ---- Offline recogniser (Vosk): one continuous session, each sentence arrives as onResult. ----
    private void listenLocal() {
        if (!running) return;
        if (paused || Speaker.speaking()) { stopLocal(); main.postDelayed(this::listenLocal, 500); return; }
        if (localSvc != null) return;
        if (!LocalAsr.installed(this)) setStatus("正在下载离线语音模型（约 42MB，只需一次）…");
        LocalAsr.ensure(this, (pct) -> setStatus("正在下载离线语音模型 " + pct + "%（只需一次）"), new LocalAsr.Ready() {
            @Override public void ok(org.vosk.Model m) {
                if (!running || localSvc != null) return;
                if (paused || Speaker.speaking()) { main.postDelayed(WakeService.this::listenLocal, 500); return; }
                try {
                    localCommand = System.currentTimeMillis() < awaitingUntil;
                    // Waiting for the wake word: only its sounds (and the user's own words) can come out, anything
                    // else is "[unk]" — far fewer false matches than free recognition of a word the model lacks.
                    localSvc = localCommand ? LocalAsr.listen(m, new LocalListener(), 9000)
                        : LocalAsr.listen(m, new LocalListener(), 0, wakeGrammar());
                    micFree = false;
                    setStatus("");
                    main.removeCallbacks(watchLocal); main.postDelayed(watchLocal, 400);
                } catch (Exception e) { localSvc = null; setStatus("麦克风打不开：" + e.getMessage()); main.postDelayed(WakeService.this::listenLocal, 5000); }
            }
            @Override public void fail(String why) { setStatus(why == null ? "离线语音模型加载失败" : why); main.postDelayed(WakeService.this::listenLocal, 60_000); }
        });
    }
    // While listening offline: let go of the microphone when the app takes speech input or she talks.
    private final Runnable watchLocal = new Runnable() {
        @Override public void run() {
            if (!running || localSvc == null) return;
            if (paused || Speaker.speaking()) { stopLocal(); main.postDelayed(WakeService.this::listenLocal, 500); return; }
            main.postDelayed(this, 400);
        }
    };
    private void stopLocal() {
        main.removeCallbacks(watchLocal);
        if (localSvc == null) { micFree = true; return; }
        try { localSvc.stop(); localSvc.shutdown(); } catch (Exception ignored) { /* gone */ }
        localSvc = null;
        micFree = true;
    }
    private void setStatus(String text) {
        status = text;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        try { if (nm != null) nm.notify(NOTE_ID, notification()); } catch (Exception ignored) { /* not allowed */ }
    }
    /** The system recogniser does not work on this phone: from now on the offline one. */
    private void switchToLocal() {
        local = true;
        getSharedPreferences("ciro_pet", MODE_PRIVATE).edit().putBoolean("wake_local", true).apply();
        if (recognizer != null) { try { recognizer.destroy(); } catch (Exception ignored) { /* gone */ } recognizer = null; }
        listening = false;
        main.post(this::listenLocal);
    }
    /** The wake grammar: Ciro's sounds plus the custom wake words, one character per word, and "[unk]". */
    private String wakeGrammar() {
        org.json.JSONArray g = new org.json.JSONArray();
        for (String w : WAKE_SOUNDS) g.put(spaced(w));
        for (String w : custom) if (w.matches("[\\u4e00-\\u9fff]{2,8}")) g.put(spaced(w));
        g.put("[unk]");
        return g.toString();
    }
    private static String spaced(String w) {
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < w.length(); i++) { if (i > 0) b.append(' '); b.append(w.charAt(i)); }
        return b.toString();
    }
    private final class LocalListener implements org.vosk.android.RecognitionListener {
        @Override public void onPartialResult(String hypothesis) {}
        @Override public void onResult(String hypothesis) {
            String text = LocalAsr.text(hypothesis).replace("[unk]", "").trim();
            if (text.isEmpty()) return;
            if (!localCommand) {
                // A wake sound heard with little certainty is more often other speech.
                if (LocalAsr.confidence(hypothesis) < 0.6) { heardNote(text + "（不确定）"); return; }
                text = "西罗"; // any of Ciro's sounds or a custom word: she was called
                boolean custom = false;
                String said = LocalAsr.text(hypothesis).replace("[unk]", "").replace(" ", "");
                for (String w : WakeService.this.custom) if (said.contains(w)) custom = true;
                if (custom) text = said;
            }
            ArrayList<String> list = new ArrayList<>();
            list.add(text);
            heard(list);
            // Called: listen for the command next (free speech); after the command: back to the wake word.
            boolean wantCommand = System.currentTimeMillis() < awaitingUntil;
            if (wantCommand != localCommand) { stopLocal(); main.postDelayed(WakeService.this::listenLocal, 300); }
        }
        @Override public void onFinalResult(String hypothesis) {}
        @Override public void onError(Exception e) { stopLocal(); main.postDelayed(WakeService.this::listenLocal, 3000); }
        @Override public void onTimeout() {
            // No command after "我在": back to waiting for the wake word.
            if (localCommand) awaitingUntil = 0;
            stopLocal(); main.postDelayed(WakeService.this::listenLocal, 300);
        }
    }

    private void again(long delay) { listening = false; micFree = true; main.postDelayed(this::listen, delay); }

    private void heard(ArrayList<String> results) {
        if (results == null || results.isEmpty()) return;
        // A bare "Ciro" a moment ago: this sentence is the command.
        if (System.currentTimeMillis() < awaitingUntil) {
            awaitingUntil = 0;
            String text = results.get(0).trim();
            if (!text.isEmpty()) command(text);
            return;
        }
        heardNote(results.get(0));
        for (String r : results) {
            int end = wakeEnd(r);
            if (end < 0) continue;
            // The command is whatever follows the wake word.
            String rest = r.substring(Math.min(r.length(), end)).replaceFirst("^[\\s,，。.!！?？、:：~～啊呀]+", "").trim();
            if (rest.length() >= 2) command(rest);
            else {
                awaitingUntil = System.currentTimeMillis() + 9000;
                Speaker.say("我在");
                MainActivity.petEvent("progress", "{\"text\":\"我在，你说～\",\"attention\":true,\"source\":\"voice\"}");
            }
            return;
        }
    }

    /** Where the wake word ends in the text (custom words first, then the ways recognisers write "Ciro"), or -1. */
    private int wakeEnd(String text) {
        String lower = text.toLowerCase(Locale.ROOT);
        // Map each kept character of the normalised text back to its place in the original.
        StringBuilder flat = new StringBuilder();
        ArrayList<Integer> at = new ArrayList<>();
        for (int i = 0; i < lower.length(); i++) {
            String c = lower.substring(i, i + 1);
            if (norm(c).isEmpty()) continue;
            flat.append(c); at.add(i);
        }
        String f = flat.toString();
        int best = -1, bestStart = Integer.MAX_VALUE;
        for (String w : custom) {
            int i = f.indexOf(w);
            if (i >= 0 && i < bestStart) { bestStart = i; best = at.get(i + w.length() - 1) + 1; }
        }
        if (best >= 0) return best;
        Matcher m = WAKE.matcher(f);
        return m.find() ? at.get(m.end() - 1) + 1 : -1;
    }

    private void heardNote(String text) {
        lastHeard = text.length() > 30 ? text.substring(0, 30) + "…" : text;
        long now = System.currentTimeMillis();
        if (now - noteAt < 3000) return;
        noteAt = now;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        try { if (nm != null) nm.notify(NOTE_ID, notification()); } catch (Exception ignored) { /* not allowed */ }
    }

    private void command(String text) {
        MainActivity.petEvent("progress", "{\"text\":" + org.json.JSONObject.quote("“" + (text.length() > 24 ? text.substring(0, 24) + "…" : text) + "”") + ",\"source\":\"voice\"}");
        if (!MainActivity.voiceCommand(text)) Speaker.say("请先打开一次 Ciro");
    }

    private final class Listener implements RecognitionListener {
        @Override public void onReadyForSpeech(Bundle params) { errors = 0; netErrors = 0; }
        @Override public void onBeginningOfSpeech() {}
        @Override public void onRmsChanged(float rmsdB) {}
        @Override public void onBufferReceived(byte[] buffer) {}
        @Override public void onEndOfSpeech() {}
        @Override public void onPartialResults(Bundle partialResults) {}
        @Override public void onEvent(int eventType, Bundle params) {}
        @Override public void onResults(Bundle results) {
            everHeard = true; hardErrors = 0;
            heard(results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION));
            again(250);
        }
        @Override public void onError(int error) {
            if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) { stop(WakeService.this); return; }
            if (error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY || error == SpeechRecognizer.ERROR_CLIENT) {
                if (recognizer != null) { try { recognizer.destroy(); } catch (Exception ignored) { /* gone */ } recognizer = null; }
            }
            // Offline language pack missing → online; network / server failing again and again → the offline model.
            if (error == 12 || error == 13) offline = false;
            else if (error == SpeechRecognizer.ERROR_NETWORK || error == SpeechRecognizer.ERROR_NETWORK_TIMEOUT || error == SpeechRecognizer.ERROR_SERVER) {
                if (++netErrors >= 3) { offline = !offline; netErrors = 0; }
            }
            // No speech / no match are normal between sentences; back off on repeated real errors.
            boolean quiet = error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT;
            // A system service that never works here (missing, blocked, no network to Google): the offline one.
            if (!quiet && error != SpeechRecognizer.ERROR_RECOGNIZER_BUSY && !everHeard && ++hardErrors >= 3) { switchToLocal(); return; }
            errors = quiet ? 0 : errors + 1;
            again(quiet ? 300 : Math.min(30_000, 1000L * errors * errors));
        }
    }
}
