package com.kllcoco.ciro;

import android.app.SearchManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.media.AudioManager;
import android.net.Uri;
import android.provider.AlarmClock;
import android.provider.CalendarContract;
import android.provider.Settings;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * What Ciro may do on the phone when asked by voice: a fixed list of actions, each through the system's own
 * apps (clock, dialer, messages, maps, calendar, settings). Calls and messages only open a prepared screen —
 * the user presses call / send. Returns "ok" or a short reason.
 */
final class PhoneActions {
    private PhoneActions() {}

    static String run(Context ctx, String json) {
        try {
            JSONObject a = new JSONObject(json);
            switch (a.optString("action")) {
                case "alarm": return alarm(ctx, a);
                case "timer": {
                    int seconds = a.optInt("seconds", 0);
                    if (seconds <= 0 || seconds > 24 * 3600) return "invalid timer";
                    Intent i = new Intent(AlarmClock.ACTION_SET_TIMER).putExtra(AlarmClock.EXTRA_LENGTH, seconds).putExtra(AlarmClock.EXTRA_SKIP_UI, true);
                    String label = a.optString("label", "");
                    if (!label.isEmpty()) i.putExtra(AlarmClock.EXTRA_MESSAGE, label.substring(0, Math.min(60, label.length())));
                    return start(ctx, i, "没有找到时钟应用");
                }
                case "alarms": return start(ctx, new Intent(AlarmClock.ACTION_SHOW_ALARMS), "没有找到时钟应用");
                case "open_app": return openApp(ctx, a.optString("name", ""));
                case "call": {
                    String n = a.optString("number", "").replaceAll("[^0-9+*#]", "");
                    if (n.isEmpty()) return "没有号码";
                    return start(ctx, new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + Uri.encode(n))), "没有拨号应用");
                }
                case "sms": {
                    String n = a.optString("number", "").replaceAll("[^0-9+]", "");
                    Intent i = new Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + Uri.encode(n)));
                    String body = a.optString("body", "");
                    if (!body.isEmpty()) i.putExtra("sms_body", body.substring(0, Math.min(500, body.length())));
                    return start(ctx, i, "没有短信应用");
                }
                case "navigate": {
                    String place = a.optString("place", "").trim();
                    if (place.isEmpty()) return "没有目的地";
                    return start(ctx, new Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=" + Uri.encode(place))), "没有地图应用");
                }
                case "web_search": {
                    String q = a.optString("query", "").trim();
                    if (q.isEmpty()) return "没有搜索内容";
                    String r = start(ctx, new Intent(Intent.ACTION_WEB_SEARCH).putExtra(SearchManager.QUERY, q), null);
                    return "ok".equals(r) ? r : start(ctx, new Intent(Intent.ACTION_VIEW, Uri.parse("https://www.bing.com/search?q=" + Uri.encode(q))), "没有浏览器");
                }
                case "open_url": {
                    String url = a.optString("url", "");
                    if (!url.matches("(?i)https?://[^\\s]+")) return "只能打开网页链接";
                    return start(ctx, new Intent(Intent.ACTION_VIEW, Uri.parse(url)), "没有浏览器");
                }
                case "flashlight": return flashlight(ctx, a.optBoolean("on", true));
                case "volume": return volume(ctx, a.opt("level"));
                case "settings": return start(ctx, new Intent(settingsAction(a.optString("page", "general"))), "打不开这个设置页");
                case "calendar": return calendar(ctx, a);
                default: return "不支持的操作";
            }
        } catch (Exception e) {
            return "出错了：" + e.getMessage();
        }
    }

    private static String start(Context ctx, Intent intent, String missing) {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        // Started directly: on Android 11+ resolveActivity() hides apps not listed in <queries> (settings pages…).
        try { ctx.startActivity(intent); } catch (android.content.ActivityNotFoundException e) { return missing == null ? "missing" : missing; }
        return "ok";
    }

    private static String alarm(Context ctx, JSONObject a) {
        int hour = a.optInt("hour", -1), minute = a.optInt("minute", 0);
        if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return "时间不对";
        Intent i = new Intent(AlarmClock.ACTION_SET_ALARM)
            .putExtra(AlarmClock.EXTRA_HOUR, hour).putExtra(AlarmClock.EXTRA_MINUTES, minute).putExtra(AlarmClock.EXTRA_SKIP_UI, true);
        String label = a.optString("label", "");
        if (!label.isEmpty()) i.putExtra(AlarmClock.EXTRA_MESSAGE, label.substring(0, Math.min(60, label.length())));
        JSONArray days = a.optJSONArray("days");
        if (days != null && days.length() > 0) {
            // 1 = Monday … 7 = Sunday  →  Calendar.MONDAY (2) … Calendar.SUNDAY (1)
            ArrayList<Integer> list = new ArrayList<>();
            for (int k = 0; k < days.length(); k++) {
                int d = days.optInt(k, 0);
                if (d >= 1 && d <= 7) list.add(d == 7 ? Calendar.SUNDAY : d + 1);
            }
            if (!list.isEmpty()) i.putExtra(AlarmClock.EXTRA_DAYS, list);
        }
        return start(ctx, i, "没有找到时钟应用");
    }

    /** Opens the installed app whose name best matches ("微信", "WeChat", "支付宝"…). */
    private static String openApp(Context ctx, String name) {
        String want = name.trim().toLowerCase(Locale.ROOT);
        if (want.isEmpty()) return "没有应用名";
        PackageManager pm = ctx.getPackageManager();
        Intent launcher = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> apps = pm.queryIntentActivities(launcher, 0);
        ResolveInfo best = null;
        int bestScore = 0;
        for (ResolveInfo r : apps) {
            String label = String.valueOf(r.loadLabel(pm)).toLowerCase(Locale.ROOT);
            String pkg = r.activityInfo.packageName.toLowerCase(Locale.ROOT);
            int score = label.equals(want) ? 3 : (label.contains(want) || (label.length() >= 2 && want.contains(label))) ? 2 : pkg.contains(want) ? 1 : 0;
            if (score > bestScore) { best = r; bestScore = score; }
        }
        if (best == null) return "没有找到“" + name + "”";
        Intent open = pm.getLaunchIntentForPackage(best.activityInfo.packageName);
        if (open == null) return "打不开“" + name + "”";
        return start(ctx, open, "打不开“" + name + "”");
    }

    private static String flashlight(Context ctx, boolean on) {
        try {
            CameraManager cm = (CameraManager) ctx.getSystemService(Context.CAMERA_SERVICE);
            if (cm == null) return "没有手电筒";
            for (String id : cm.getCameraIdList()) {
                Boolean flash = cm.getCameraCharacteristics(id).get(CameraCharacteristics.FLASH_INFO_AVAILABLE);
                if (Boolean.TRUE.equals(flash)) { cm.setTorchMode(id, on); return "ok"; }
            }
            return "没有手电筒";
        } catch (Exception e) {
            return "手电筒打不开";
        }
    }

    private static String volume(Context ctx, Object level) {
        AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
        if (am == null) return "调不了音量";
        int stream = AudioManager.STREAM_MUSIC;
        String l = String.valueOf(level);
        if ("up".equals(l)) am.adjustStreamVolume(stream, AudioManager.ADJUST_RAISE, AudioManager.FLAG_SHOW_UI);
        else if ("down".equals(l)) am.adjustStreamVolume(stream, AudioManager.ADJUST_LOWER, AudioManager.FLAG_SHOW_UI);
        else if ("mute".equals(l)) am.adjustStreamVolume(stream, AudioManager.ADJUST_MUTE, AudioManager.FLAG_SHOW_UI);
        else if ("unmute".equals(l)) am.adjustStreamVolume(stream, AudioManager.ADJUST_UNMUTE, AudioManager.FLAG_SHOW_UI);
        else {
            try {
                double pct = Math.max(0, Math.min(100, Double.parseDouble(l)));
                am.setStreamVolume(stream, (int) Math.round(am.getStreamMaxVolume(stream) * pct / 100), AudioManager.FLAG_SHOW_UI);
            } catch (NumberFormatException e) { return "音量值不对"; }
        }
        return "ok";
    }

    private static String settingsAction(String page) {
        switch (page) {
            case "wifi": return Settings.ACTION_WIFI_SETTINGS;
            case "bluetooth": return Settings.ACTION_BLUETOOTH_SETTINGS;
            case "display": return Settings.ACTION_DISPLAY_SETTINGS;
            case "sound": return Settings.ACTION_SOUND_SETTINGS;
            case "battery": return Intent.ACTION_POWER_USAGE_SUMMARY;
            case "location": return Settings.ACTION_LOCATION_SOURCE_SETTINGS;
            case "airplane": return Settings.ACTION_AIRPLANE_MODE_SETTINGS;
            case "notifications": return "android.settings.NOTIFICATION_SETTINGS";
            case "apps": return Settings.ACTION_APPLICATION_SETTINGS;
            default: return Settings.ACTION_SETTINGS;
        }
    }

    private static String calendar(Context ctx, JSONObject a) {
        String title = a.optString("title", "").trim();
        if (title.isEmpty()) return "没有日程标题";
        Intent i = new Intent(Intent.ACTION_INSERT).setData(CalendarContract.Events.CONTENT_URI)
            .putExtra(CalendarContract.Events.TITLE, title.substring(0, Math.min(120, title.length())));
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm", Locale.ROOT);
        try {
            Date start = f.parse(a.optString("start", ""));
            if (start != null) {
                i.putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, start.getTime());
                Date end = a.has("end") ? f.parse(a.optString("end")) : null;
                i.putExtra(CalendarContract.EXTRA_EVENT_END_TIME, end != null ? end.getTime() : start.getTime() + 3600_000L);
            }
        } catch (Exception ignored) { /* no time: the calendar app asks */ }
        String where = a.optString("location", "");
        if (!where.isEmpty()) i.putExtra(CalendarContract.Events.EVENT_LOCATION, where);
        return start(ctx, i, "没有日历应用");
    }
}
