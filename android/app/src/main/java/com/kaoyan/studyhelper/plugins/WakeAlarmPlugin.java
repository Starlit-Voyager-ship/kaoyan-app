package com.kaoyan.studyhelper.plugins;

import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.JSObject;
import android.app.Activity;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.provider.Settings;

/**
 * 好友叫醒原生插件（Capacitor 桥）
 * 前端通过 Capacitor.Plugins.WakeAlarm.triggerWake(...) 调用。
 * 真正的"强提醒"逻辑在 WakeAlarmHelper / WakeAlarmActivity 中。
 */
@CapacitorPlugin(name = "WakeAlarm")
public class WakeAlarmPlugin extends Plugin {

    /** 立即触发强提醒：点亮屏幕 + 锁屏全屏 + 播放闹钟声 + 震动 + 高优先级通知 */
    @PluginMethod
    public void triggerWake(PluginCall call) {
        String message = call.getString("message", "该起床学习啦！");
        boolean sound = call.getBoolean("sound", true);
        boolean fullScreen = call.getBoolean("fullScreen", true);
        boolean vibrate = call.getBoolean("vibrate", true);
        String fromUser = call.getString("fromUser", "");
        String toUser = call.getString("toUser", "");
        WakeAlarmHelper.fire(getContext(), message, sound, fullScreen, vibrate, fromUser, toUser);
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    /** 引导用户到系统"勿扰访问"设置页授权（授权后高优先级通知可绕过 DND） */
    @PluginMethod
    public void requestDndAccess(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    /** 查询是否已获得"覆盖勿扰"权限 */
    @PluginMethod
    public void canOverrideDnd(PluginCall call) {
        NotificationManager nm = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
        boolean granted = nm != null && nm.isNotificationPolicyAccessGranted();
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        call.resolve(ret);
    }

    /** 启动前台守护服务：锁屏/后台也持续轮询云端叫醒（真正的后台收叫醒） */
    @PluginMethod
    public void startGuard(PluginCall call) {
        String appId = call.getString("appId", "");
        String restKey = call.getString("restKey", "");
        String username = call.getString("username", "");
        long lastTs = call.getLong("lastTs", 0L);
        Intent intent = new Intent(getContext(), WakeGuardService.class);
        intent.putExtra("appId", appId);
        intent.putExtra("restKey", restKey);
        intent.putExtra("username", username);
        intent.putExtra("lastTs", lastTs);
        try {
            getContext().startForegroundService(intent);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception e) {
            JSObject ret = new JSObject();
            ret.put("ok", false);
            ret.put("error", e.getMessage());
            call.resolve(ret);
        }
    }

    /** 停止守护服务 */
    @PluginMethod
    public void stopGuard(PluginCall call) {
        // 停止守护时清空持久游标，避免系统重建后回退到旧账号 / 旧时间戳
        try {
            getContext().getSharedPreferences("wake_guard", Context.MODE_PRIVATE).edit().clear().apply();
        } catch (Exception ignore) {}
        Intent intent = new Intent(getContext(), WakeGuardService.class);
        getContext().stopService(intent);
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    /** 停止前台播放服务（响铃 + 震动） */
    @PluginMethod
    public void stopWake(PluginCall call) {
        try {
            getContext().stopService(new Intent(getContext(), WakePlayerService.class));
        } catch (Exception ignore) {}
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    /** 申请 Android 13+ 通知权限（POST_NOTIFICATIONS），用于正常弹出强提醒通知。
     *  应用在原生平台初始化时调用，系统会弹窗，用户允许即可。 */
    @PluginMethod
    public void requestNotifyPermission(PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                Activity act = getActivity();
                if (act != null) {
                    act.requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 2001);
                }
            }
        } catch (Exception ignore) {}
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }
}
