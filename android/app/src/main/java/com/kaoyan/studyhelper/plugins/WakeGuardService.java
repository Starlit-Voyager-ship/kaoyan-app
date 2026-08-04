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
 * 关键修复（v=r）：
 *   1. lastTs 按 username 隔离持久化，避免切换账号时串扰；
 *   2. 新账号首次轮询（lastTs 仍为 0）会把游标推进到当前时刻并跳过历史，
 *      防止"一登录就把历史/调试垃圾当成新叫醒"疯狂触发；
 *   3. 过滤掉 fromUser 为空 / 自己发给自己 的脏数据。
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
        // lastTs 不在此读取：按 username 隔离，在 onStartCommand 拿到账号后再恢复，
        // 避免跨账号串扰；新账号首次为 0，首轮 poll 会跳过历史。
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
            // 按账号隔离恢复游标；首次（从未处理过）为 0
            if (username != null && !username.isEmpty()) {
                lastTs = getSharedPreferences(PREFS, MODE_PRIVATE).getLong("lastTs_" + username, 0);
            }
            persist();
        }

        startForeground(NOTIFY_ID, buildNotification());

        if (scheduler == null) {
            scheduler = Executors.newSingleThreadScheduledExecutor();
            scheduler.scheduleWithFixedDelay(this::poll, 0, POLL_INTERVAL_MS, TimeUnit.MILLISECONDS);
        }
        return START_STICKY; // 被系统杀掉后尽量自动重启
    }

    private void persist() {
        SharedPreferences.Editor e = getSharedPreferences(PREFS, MODE_PRIVATE).edit();
        e.putString("appId", appId);
        e.putString("restKey", restKey);
        e.putString("username", username);
        if (username != null && !username.isEmpty()) e.putLong("lastTs_" + username, lastTs);
        e.apply();
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
        if (username == null || username.isEmpty() || appId == null || appId.isEmpty()) return;
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

            long now = System.currentTimeMillis();
            long maxTs = lastTs;
            long latestValidTs = lastTs;
            String latestMsg = "该起床学习啦！";
            String latestFrom = "";
            boolean hasValid = false;

            for (int i = 0; i < results.length(); i++) {
                JSONObject m = results.getJSONObject(i);
                long ts = m.optLong("ts", 0);
                if (ts > maxTs) maxTs = ts;
                String from = m.optString("fromUser", "");
                String type = m.optString("type", "");
                // 关闭回执（type='closed'）：仅推进游标，不触发响铃。
                // 叫醒端只需文字提示（"对方已关闭闹钟"由前端 JS 弹），绝不在此端响铃。
                if ("closed".equals(type)) continue;
                // 有效性过滤：来自非空、且非自己、且确实比游标新；排除脏数据 / 自环
                if (ts > lastTs && ts > latestValidTs &&
                        from != null && !from.isEmpty() && !from.equals(username)) {
                    latestValidTs = ts;
                    latestMsg = m.optString("message", latestMsg);
                    latestFrom = from;
                    hasValid = true;
                }
            }

            // 新账号首次轮询（lastTs 仍为 0）：把游标推进到当前时刻，跳过历史垃圾，避免误触发
            if (lastTs == 0) {
                lastTs = now;
                persist();
                return;
            }

            lastTs = maxTs;
            persist();

            // 仅当存在真正有效的新叫醒才拉起强提醒
            // fromUser=发送方，toUser=接收方自己（username），供停止回执定位发送方
            if (hasValid) {
                WakeAlarmHelper.fire(this, latestMsg, true, true, true, latestFrom, username);
            }

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
