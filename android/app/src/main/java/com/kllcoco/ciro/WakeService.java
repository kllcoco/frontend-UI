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
    /** The last sentence the recogniser heard (shown in Settings, so a custom wake word can be copied from it). */
    static volatile String lastHeard = "";
    private String[] custom = new String[0];
    private boolean offline = false; // the phone's offline model first only after the online one keeps failing
    private int netErrors = 0;
    private long noteAt = 0;

    private final Handler main = new Handler(Looper.getMainLooper());
    private SpeechRecognizer recognizer;
    private boolean listening = false;
    private long awaitingUntil = 0; // after a bare "Ciro": the next sentence is the command
    private int errors = 0;

    static boolean available(Context ctx) { return SpeechRecognizer.isRecognitionAvailable(ctx); }

    static String start(Context ctx) {
        if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) return "no-permission";
        if (!available(ctx)) return "unavailable";
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
        main.post(this::listen);
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        main.removeCallbacksAndMessages(null);
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
            .setContentText(lastHeard.isEmpty() ? "喊一声“" + wakeName() + "”，然后说你要做什么" : "刚听到：" + lastHeard)
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
        if (!running) return;
        if (paused) {
            if (listening && recognizer != null) { try { recognizer.cancel(); } catch (Exception ignored) { /* gone */ } listening = false; }
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
        try { recognizer.startListening(i); listening = true; main.removeCallbacks(checkPause); main.postDelayed(checkPause, 300); }
        catch (Exception e) { listening = false; main.postDelayed(this::listen, 2000); }
    }

    private final Runnable checkPause = new Runnable() {
        @Override public void run() {
            if (!running || !listening) return;
            if (paused) { listen(); return; }
            main.postDelayed(this, 300);
        }
    };

    private void again(long delay) { listening = false; main.postDelayed(this::listen, delay); }

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
            errors = quiet ? 0 : errors + 1;
            again(quiet ? 300 : Math.min(30_000, 1000L * errors * errors));
        }
    }
}
