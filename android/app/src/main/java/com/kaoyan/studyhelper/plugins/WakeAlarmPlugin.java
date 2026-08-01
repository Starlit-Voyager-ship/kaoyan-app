package com.kaoyan.studyhelper.plugins;

import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.JSObject;
import android.content.Context;
import android.content.Intent;
import android.provider.Settings;
import android.app.NotificationManager;

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
        WakeAlarmHelper.fire(getContext(), message, sound, fullScreen, vibrate);
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
}
