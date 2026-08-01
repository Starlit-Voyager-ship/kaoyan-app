package com.kaoyan.studyhelper.plugins;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;

/**
 * 叫醒强提醒工具类
 * - 创建高优先级通知渠道（IMPORTANCE_HIGH），并尽量 setBypassDnd(true)
 * - 直接启动全屏 Activity（点亮屏幕 / 锁屏可见）
 * - 同时发一条高优先级通知做兜底（全屏意图 + 通知栏常驻）
 */
public class WakeAlarmHelper {
    public static final String CHANNEL_ID = "wake_alarm_channel";
    public static final int NOTIFY_ID = 9001;

    /** 确保通知渠道存在（高优先级 + 尝试绕过 DND） */
    public static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
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

    /** 触发强提醒 */
    public static void fire(Context ctx, String message, boolean sound, boolean fullScreen, boolean vibrate) {
        ensureChannel(ctx);

        // 1) 直接启动全屏 Activity（点亮屏幕 + 锁屏可见），由 Activity 负责播放闹钟声与震动
        Intent act = new Intent(ctx, WakeAlarmActivity.class);
        act.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_TASK_ON_HOME);
        act.putExtra("message", message);
        act.putExtra("sound", sound);
        act.putExtra("vibrate", vibrate);
        ctx.startActivity(act);

        // 2) 发高优先级通知兜底（全屏意图 + 通知栏常驻，点开回到叫醒页）
        Intent pi = new Intent(ctx, WakeAlarmActivity.class);
        pi.putExtra("message", message);
        pi.putExtra("sound", sound);
        pi.putExtra("vibrate", vibrate);
        PendingIntent contentIntent = PendingIntent.getActivity(ctx, 1, pi,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                .setContentTitle("⏰ 好友叫醒")
                .setContentText(message)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setContentIntent(contentIntent)
                .setAutoCancel(true);
        if (fullScreen) {
            b.setFullScreenIntent(contentIntent, true);
        }

        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(NOTIFY_ID, b.build());
    }
}
