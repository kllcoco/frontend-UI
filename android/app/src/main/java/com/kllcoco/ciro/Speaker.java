package com.kllcoco.ciro;

import android.content.Context;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import java.util.Locale;

/** Ciro's voice: the phone's text-to-speech, shared by the app and the wake service. */
final class Speaker {
    private static TextToSpeech tts;
    private static boolean ready = false;
    private static volatile boolean speaking = false;
    private static String pending = null;

    private Speaker() {}

    static synchronized void init(Context ctx) {
        if (tts != null) return;
        tts = new TextToSpeech(ctx.getApplicationContext(), (status) -> {
            synchronized (Speaker.class) {
                ready = status == TextToSpeech.SUCCESS;
                if (ready) {
                    tts.setLanguage(Locale.getDefault());
                    tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                        @Override public void onStart(String id) { speaking = true; }
                        @Override public void onDone(String id) { speaking = false; }
                        @Override public void onError(String id) { speaking = false; }
                    });
                    if (pending != null) { say(pending); pending = null; }
                }
            }
        });
    }

    static synchronized void say(String text) {
        if (text == null || text.trim().isEmpty()) return;
        String t = text.length() > 600 ? text.substring(0, 600) : text;
        if (tts == null || !ready) { pending = t; return; }
        speaking = true;
        // Refused (no engine / bad state): no progress callbacks will come, so never leave the wake listener waiting.
        if (tts.speak(t, TextToSpeech.QUEUE_FLUSH, new Bundle(), "ciro-" + System.nanoTime()) != TextToSpeech.SUCCESS) speaking = false;
    }

    static synchronized void stop() { if (tts != null) tts.stop(); speaking = false; }

    /** While she talks the wake listener waits, so she does not hear herself. */
    static boolean speaking() { return speaking; }
}
