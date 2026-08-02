package com.kaoyan.studyhelper.plugins;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
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

/**
 * 前台播放服务：负责真正"出声 + 震动"的强提醒。
 *
 * 关键修复（v=s）：原实现把响铃/震动写在全屏 Activity 里，但 Android 10+ 在
 * 后台/锁屏时会拦截后台启动的 Activity，导致 Activity 起不来 → 无响铃、无全屏，
 * 用户只听到通知渠道自带的系统震动。
 * 这里改由「前台服务」播放：前台服务不受后台启动限制，且用
 * AudioAttributes.FLAG_BYPASS_DND 在勿扰下也能出声。
 * 全屏 Activity 退化为"停止"页（由高优先级通知的 fullScreenIntent 点开进入）。
 */
public class WakePlayerService extends Service {
    public static final String CHANNEL_ID = "wake_alarm_channel";
    public static final int NOTIFY_ID = 9001;

    private Ringtone ringtone;
    private Vibrator vibrator;
    private NotificationManager nm;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String message = intent != null ? intent.getStringExtra("message") : null;
        if (message == null || message.isEmpty()) message = "该起床学习啦！";
        boolean sound = intent == null || intent.getBooleanExtra("sound", true);
        boolean vibrate = intent == null || intent.getBooleanExtra("vibrate", true);

        nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        ensureChannel();

        // 高优先级全屏通知（点开进"停止"页 WakeAlarmActivity）
        Intent pi = new Intent(this, WakeAlarmActivity.class);
        pi.putExtra("message", message);
        PendingIntent contentIntent = PendingIntent.getActivity(this, 1, pi,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                .setContentTitle("⏰ 好友叫醒")
                .setContentText(message)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setContentIntent(contentIntent)
                .setAutoCancel(true);
        // Android 10+ 用 fullScreenIntent：前台时自动展开，后台时降级 heads-up（系统限制）
        b.setFullScreenIntent(contentIntent, true);

        try {
            startForeground(NOTIFY_ID, b.build());
        } catch (Exception e) {
            // 通知权限未授予时 startForeground 可能抛异常；仍尽量出声
        }

        // 播放闹钟声（USAGE_ALARM + FLAG_BYPASS_DND，勿扰下也能响）
        if (sound) {
            try {
                Uri uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
                if (uri == null) uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
                ringtone = RingtoneManager.getRingtone(this, uri);
                if (ringtone != null) {
                    AudioAttributes aa = new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ALARM)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .setFlags(AudioAttributes.FLAG_BYPASS_DND)
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
        if (ringtone != null && ringtone.isPlaying()) ringtone.stop();
        if (vibrator != null) vibrator.cancel();
        if (nm != null) nm.cancel(NOTIFY_ID);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
