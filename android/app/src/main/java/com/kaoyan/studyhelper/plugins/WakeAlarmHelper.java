package com.kaoyan.studyhelper.plugins;

import android.content.Context;
import android.content.Intent;

/**
 * 叫醒强提醒桥接工具类。
 *
 * 关键修复（v=s）：不再直接 startActivity 拉全屏 Activity（后台会被系统拦截），
 * 改为启动前台播放服务 WakePlayerService 负责"响铃 + 震动"；
 * 全屏 Activity 退化为"停止"页（由通知的 fullScreenIntent 点开进入）。
 */
public class WakeAlarmHelper {

    /** 触发强提醒：启动前台服务播放闹钟声 + 震动 */
    public static void fire(Context ctx, String message, boolean sound, boolean fullScreen, boolean vibrate) {
        try {
            Intent svc = new Intent(ctx, WakePlayerService.class);
            svc.putExtra("message", message);
            svc.putExtra("sound", sound);
            svc.putExtra("vibrate", vibrate);
            ctx.startForegroundService(svc);
        } catch (Exception e) {
            // 兜底：极端情况下尝试直接启动 Activity（仅前台场景有效）
            try {
                Intent act = new Intent(ctx, WakeAlarmActivity.class);
                act.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                act.putExtra("message", message);
                act.putExtra("sound", sound);
                act.putExtra("vibrate", vibrate);
                ctx.startActivity(act);
            } catch (Exception ignore) {}
        }
    }
}
