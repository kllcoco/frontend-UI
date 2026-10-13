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
    private static final Pattern WAKE = Pattern.compile("(ciro|siro|cyro|sero|ciru|西罗|希罗|西洛|希洛|席罗|赛罗|茜罗|夕罗|喜罗|熙罗|惜罗|溪罗|西若|希若|西柔|希柔)");
    static volatile boolean running = false;

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

    static void stop(Context ctx) {
        ctx.getSharedPreferences("ciro_pet", MODE_PRIVATE).edit().putBoolean("wake", false).apply();
        ctx.stopService(new Intent(ctx, WakeService.class));
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && STOP.equals(intent.getAction())) { stop(this); return START_NOT_STICKY; }
        Notification note = notification();
        if (Build.VERSION.SDK_INT >= 30) startForeground(NOTE_ID, note, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        else startForeground(NOTE_ID, note);
        running = true;
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
            .setContentText("喊一声“Ciro”，然后说你要做什么")
            .setOngoing(true)
            .setContentIntent(open)
            .addAction(0, "关闭语音唤醒", stop)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }

    private void listen() {
        if (!running || listening) return;
        if (Speaker.speaking()) { main.postDelayed(this::listen, 400); return; } // never listen to herself
        if (recognizer == null) {
            recognizer = SpeechRecognizer.createSpeechRecognizer(this);
            recognizer.setRecognitionListener(new Listener());
        }
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag())
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
            .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
            .putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getPackageName());
        try { recognizer.startListening(i); listening = true; }
        catch (Exception e) { listening = false; main.postDelayed(this::listen, 2000); }
    }

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
        for (String r : results) {
            String norm = r.toLowerCase(Locale.ROOT);
            Matcher m = WAKE.matcher(norm.replace(" ", ""));
            if (!m.find()) continue;
            // The command is whatever follows the wake word in the original text.
            Matcher inOriginal = WAKE.matcher(norm);
            String rest = inOriginal.find() ? r.substring(Math.min(r.length(), inOriginal.end())) : r.substring(Math.min(r.length(), m.end()));
            rest = rest.replaceFirst("^[\\s,，。.!！?？、:：]+", "").trim();
            if (rest.length() >= 2) command(rest);
            else {
                awaitingUntil = System.currentTimeMillis() + 9000;
                Speaker.say("我在");
                MainActivity.petEvent("progress", "{\"text\":\"我在，你说～\",\"attention\":true,\"source\":\"voice\"}");
            }
            return;
        }
    }

    private void command(String text) {
        MainActivity.petEvent("progress", "{\"text\":" + org.json.JSONObject.quote("“" + (text.length() > 24 ? text.substring(0, 24) + "…" : text) + "”") + ",\"source\":\"voice\"}");
        if (!MainActivity.voiceCommand(text)) Speaker.say("请先打开一次 Ciro");
    }

    private final class Listener implements RecognitionListener {
        @Override public void onReadyForSpeech(Bundle params) { errors = 0; }
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
            // No speech / no match are normal between sentences; back off on repeated real errors.
            boolean quiet = error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT;
            errors = quiet ? 0 : errors + 1;
            again(quiet ? 300 : Math.min(30_000, 1000L * errors * errors));
        }
    }
}
