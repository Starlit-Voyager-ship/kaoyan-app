package com.kaoyan.studyhelper.plugins;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * 通知栏「停止」按钮的广播接收器：锁屏/后台也能直接关闭叫醒并报备发送方。
 */
public class WakeStopReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        WakePlayerService.stopAndNotify(context);
    }
}
