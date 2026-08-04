package com.kaoyan.studyhelper.plugins;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.os.VibrationEffect;
import android.os.Vibrator;
import androidx.core.app.NotificationCompat;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * 前台播放服务：负责真正"出声 + 震动"的强提醒。
 *
 * 关键修复（v=s）：原实现把响铃/震动写在全屏 Activity 里，但 Android 10+ 在
 * 后台/锁屏时会拦截后台启动的 Activity，导致 Activity 起不来 → 无响铃、无全屏。
 * 这里改由「前台服务」播放：前台服务不受后台启动限制，闹钟声走 STREAM_ALARM
 * （系统默认按闹钟处理，多数情况下绕过免打扰）。
 *
 * 新增（v=t）：
 *   - 通知栏「停止」按钮（PendingIntent → WakeStopReceiver），锁屏/后台也能直接关闭；
 *   - 关闭时向发送方写一条云端回执 WakeMsg{type:'closed'}，发送方收到提示"对方已关闭闹钟"。
 */
public class WakePlayerService extends Service {
    public static final String CHANNEL_ID = "wake_alarm_channel";
    public static final int NOTIFY_ID = 9001;

    // 当前叫醒的收发双方（供停止回执使用）；从 fire() 的 intent extra 写入
    private static String sFromUser;   // 发送方账号（peer）
    private static String sToUser;     // 接收方自己（me）

    private Ringtone ringtone;
    private Vibrator vibrator;
    private NotificationManager nm;

    // 当前运行实例引用：stopAndNotify 可直接停掉正在播放的铃声/震动，最可靠
    private static WakePlayerService sInstance;

    @Override
    public void onCreate() {
        super.onCreate();
        sInstance = this;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String message = intent != null ? intent.getStringExtra("message") : null;
        if (message == null || message.isEmpty()) message = "该起床学习啦！";
        boolean sound = intent == null || intent.getBooleanExtra("sound", true);
        boolean vibrate = intent == null || intent.getBooleanExtra("vibrate", true);
        sFromUser = intent != null ? intent.getStringExtra("fromUser") : null;
        sToUser = intent != null ? intent.getStringExtra("toUser") : null;
        sInstance = this;

        nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        ensureChannel();

        // 高优先级全屏通知（点开进"停止"页 WakeAlarmActivity）
        Intent pi = new Intent(this, WakeAlarmActivity.class);
        pi.putExtra("message", message);
        PendingIntent contentIntent = PendingIntent.getActivity(this, 1, pi,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        // 通知栏「停止」按钮：BroadcastReceiver 处理，锁屏/后台也能直接关闭
        Intent stopIntent = new Intent(this, WakeStopReceiver.class);
        PendingIntent stopPI = PendingIntent.getBroadcast(this, 2, stopIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                .setContentTitle("⏰ 好友叫醒")
                .setContentText(message)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setContentIntent(contentIntent)
                .setAutoCancel(true)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "停止", stopPI);
        // Android 10+ 用 fullScreenIntent：前台时自动展开，后台时降级 heads-up（系统限制）
        b.setFullScreenIntent(contentIntent, true);

        try {
            startForeground(NOTIFY_ID, b.build());
        } catch (Exception e) {
            // 通知权限未授予时 startForeground 可能抛异常；仍尽量出声
        }

        // 播放闹钟声（USAGE_ALARM，多数系统默认绕过 DND）
        if (sound) {
            try {
                Uri uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
                if (uri == null) uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
                ringtone = RingtoneManager.getRingtone(this, uri);
                if (ringtone != null) {
                    AudioAttributes aa = new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ALARM)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .build();
                    ringtone.setAudioAttributes(aa);
                    // 闹钟音量为 0 时兜底调高，确保真能叫醒（需 MODIFY_AUDIO_SETTINGS）
                    try {
                        AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
                        if (am != null && am.getStreamVolume(AudioManager.STREAM_ALARM) == 0) {
                            int max = am.getStreamMaxVolume(AudioManager.STREAM_ALARM);
                            am.setStreamVolume(AudioManager.STREAM_ALARM, Math.max(1, (int) (max * 0.7)), 0);
                        }
                    } catch (Exception ignore) {}
                    ringtone.setLooping(true);
                    ringtone.play();
                }
            } catch (Exception ignore) {}
        }

        // 震动
        if (vibrate) {
            try {
                vibrator = (Vibrator) getSystemService(VIBRATOR_SERVICE);
                if (vibrator != null) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        vibrator.vibrate(VibrationEffect.createWaveform(new long[]{0, 800, 400, 800}, 0));
                    } else {
                        vibrator.vibrate(new long[]{0, 800, 400, 800}, 0);
                    }
                }
            } catch (Exception ignore) {}
        }

        return START_NOT_STICKY;
    }

    /**
     * 停止播放 + 向发送方写云端回执（供发送方提示"对方已关闭闹钟"）。
     * 可由 WakeAlarmActivity 的停止按钮、以及 WakeStopReceiver（通知栏按钮）调用。
     */
    /**
     * 停止播放 + 向发送方写云端回执（供发送方提示"对方已关闭闹钟"）。
     * 可由 WakeAlarmActivity 的停止按钮、以及 WakeStopReceiver（通知栏按钮）调用。
     *
     * 健壮性修复：先直接停掉当前实例的铃声/震动（不依赖 onDestroy 时机），
     * 再 stopService，确保即使系统延迟销毁服务，响铃也会立刻止住。
     */
    public static void stopAndNotify(Context ctx) {
        // 直接停掉正在播放的铃声与震动（最可靠，避免 onDestroy 未即时触发）
        if (sInstance != null) {
            try { sInstance.stopSound(); } catch (Exception ignore) {}
        }
        try { ctx.stopService(new Intent(ctx, WakePlayerService.class)); } catch (Exception ignore) {}
        sInstance = null;
        postClosed(ctx);
    }

    /** 立即停止铃声 + 震动 + 通知（无条件，不依赖 isPlaying 判断，避免循环铃声 isPlaying 误报导致停不掉） */
    private void stopSound() {
        if (ringtone != null) {
            try { ringtone.stop(); } catch (Exception ignore) {}
        }
        if (vibrator != null) {
            try { vibrator.cancel(); } catch (Exception ignore) {}
        }
        if (nm != null) {
            try { nm.cancel(NOTIFY_ID); } catch (Exception ignore) {}
        }
    }

    // 写一条 WakeMsg{type:'closed'} 给发送方（toUser=发送方，fromUser=接收方自己）
    private static void postClosed(Context ctx) {
        if (sFromUser == null || sFromUser.isEmpty() || sToUser == null || sToUser.isEmpty()) return;
        // 复用守护服务持久化的 Bmob 凭证
        SharedPreferences prefs = ctx.getSharedPreferences(WakeGuardService.PREFS, Context.MODE_PRIVATE);
        final String appId = prefs.getString("appId", "");
        final String restKey = prefs.getString("restKey", "");
        if (appId == null || appId.isEmpty()) return;
        final String from = sToUser;   // 接收方自己 = 回执发送者
        final String to = sFromUser;   // 发送方 = 回执接收者
        new Thread(() -> {
            try {
                URL url = new URL("https://api.bmobcloud.com/1/classes/WakeMsg");
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setRequestProperty("X-Bmob-Application-Id", appId);
                conn.setRequestProperty("X-Bmob-REST-API-Key", restKey);
                conn.setDoOutput(true);
                String body = "{\"type\":\"closed\",\"fromUser\":\"" + from.replace("\"", "\\\"")
                        + "\",\"toUser\":\"" + to.replace("\"", "\\\"")
                        + "\",\"ts\":" + System.currentTimeMillis() + "}";
                OutputStream os = conn.getOutputStream();
                os.write(body.getBytes("UTF-8"));
                os.flush();
                os.close();
                conn.getResponseCode();
                conn.disconnect();
            } catch (Exception ignore) {}
        }).start();
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm != null) {
            if (nm.getNotificationChannel(CHANNEL_ID) == null) {
                NotificationChannel ch = new NotificationChannel(
                        CHANNEL_ID, "好友叫醒", NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription("远程好友叫醒强提醒");
                ch.setBypassDnd(true); // 需 ACCESS_NOTIFICATION_POLICY 授权后才真正生效
                ch.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);
                nm.createNotificationChannel(ch);
            }
        }
    }

    @Override
    public void onDestroy() {
        stopSound();
        sInstance = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
