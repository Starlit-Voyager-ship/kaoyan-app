package com.kaoyan.studyhelper.plugins;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * 前台守护服务：即使 App 锁屏 / 退到后台，也持续轮询 Bmob 云端是否有新叫醒。
 * 收到新叫醒 → 直接拉起 WakeAlarmActivity（全屏 + 响铃 + 震动）。
 *
 * 为什么需要它：网页版（Capacitor WebView）在后台/锁屏时定时器会被系统挂起，
 * 导致"手机没收到叫醒"。原生前台服务持有前台通知 + 唤醒锁，能稳定保持轮询。
 */
public class WakeGuardService extends Service {

    public static final String PREFS = "wake_guard";
    public static final String CHANNEL_ID = "wake_guard_channel";
    public static final int NOTIFY_ID = 9002;

    private static final long POLL_INTERVAL_MS = 15000;

    private ScheduledExecutorService scheduler;
    private PowerManager.WakeLock wakeLock;

    private String appId;
    private String restKey;
    private String username;
    private long lastTs;

    @Override
    public void onCreate() {
        super.onCreate();
        SharedPreferences sp = getSharedPreferences(PREFS, MODE_PRIVATE);
        appId = sp.getString("appId", "");
        restKey = sp.getString("restKey", "");
        username = sp.getString("username", "");
        lastTs = sp.getLong("lastTs", 0);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            String a = intent.getStringExtra("appId");
            String r = intent.getStringExtra("restKey");
            String u = intent.getStringExtra("username");
            if (a != null) appId = a;
            if (r != null) restKey = r;
            if (u != null) username = u;
            if (intent.hasExtra("lastTs")) lastTs = intent.getLongExtra("lastTs", lastTs);
            // 持久化，供服务被系统重建后恢复
            SharedPreferences.Editor e = getSharedPreferences(PREFS, MODE_PRIVATE).edit();
            e.putString("appId", appId);
            e.putString("restKey", restKey);
            e.putString("username", username);
            e.putLong("lastTs", lastTs);
            e.apply();
        }

        startForeground(NOTIFY_ID, buildNotification());

        if (scheduler == null) {
            scheduler = Executors.newSingleThreadScheduledExecutor();
            scheduler.scheduleWithFixedDelay(this::poll, 0, POLL_INTERVAL_MS, TimeUnit.MILLISECONDS);
        }
        return START_STICKY; // 被系统杀掉后尽量自动重启
    }

    private android.app.Notification buildNotification() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null && nm.getNotificationChannel(CHANNEL_ID) == null) {
                NotificationChannel ch = new NotificationChannel(
                        CHANNEL_ID, "叫醒守护", NotificationManager.IMPORTANCE_LOW);
                ch.setDescription("保持后台轮询，锁屏也能收到好友叫醒");
                ch.setShowBadge(false);
                nm.createNotificationChannel(ch);
            }
        }
        Intent pi = new Intent(this, com.kaoyan.studyhelper.MainActivity.class);
        pi.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(this, 2, pi,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                .setContentTitle("⏰ 叫醒守护中")
                .setContentText("锁屏也能收到好友叫醒")
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setContentIntent(contentIntent)
                .setOngoing(true)
                .build();
    }

    private void poll() {
        if (username == null || username.isEmpty() || appId.isEmpty()) return;
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null && wakeLock == null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "WakeGuard::poll");
            wakeLock.setReferenceCounted(false);
        }
        try {
            if (wakeLock != null && !wakeLock.isHeld()) wakeLock.acquire(20000);

            String where = "{\"toUser\":\"" + username.replace("\"", "\\\"") +
                    "\",\"ts\":{\"$gt\":" + lastTs + "}}";
            String urlStr = "https://api.bmobcloud.com/1/classes/WakeMsg?where=" +
                    URLEncoder.encode(where, "UTF-8") + "&order=ts&limit=20";

            URL url = new URL(urlStr);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setRequestProperty("X-Bmob-Application-Id", appId);
            conn.setRequestProperty("X-Bmob-REST-API-Key", restKey);
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(10000);

            int code = conn.getResponseCode();
            if (code != 200) { conn.disconnect(); return; }

            InputStream is = conn.getInputStream();
            BufferedReader reader = new BufferedReader(new InputStreamReader(is, "UTF-8"));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) sb.append(line);
            reader.close();
            conn.disconnect();

            JSONObject json = new JSONObject(sb.toString());
            JSONArray results = json.optJSONArray("results");
            if (results == null || results.length() == 0) return;

            long maxTs = lastTs;
            String latestMsg = "该起床学习啦！";
            for (int i = 0; i < results.length(); i++) {
                JSONObject m = results.getJSONObject(i);
                long ts = m.optLong("ts", 0);
                if (ts > maxTs) {
                    maxTs = ts;
                    latestMsg = m.optString("message", latestMsg);
                }
            }
            lastTs = maxTs;
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putLong("lastTs", lastTs).apply();

            // 拉起全屏强提醒
            WakeAlarmHelper.fire(this, latestMsg, true, true, true);

        } catch (Exception e) {
            // 网络异常等，下一轮继续
        } finally {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        }
    }

    @Override
    public void onDestroy() {
        if (scheduler != null) { scheduler.shutdownNow(); scheduler = null; }
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        stopForeground(true);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
