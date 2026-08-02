package com.kaoyan.studyhelper.plugins;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.TextView;

import com.kaoyan.studyhelper.R;

/**
 * 全屏叫醒"停止"页：仅在用户点开通知时进入（前台或近期交互时系统会展开全屏）。
 * 真正的响铃 + 震动由 WakePlayerService 负责，这里只负责展示消息与"停止"。
 */
public class WakeAlarmActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 点亮屏幕 / 锁屏可见（进入此页即全屏展示）
        getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD);

        setContentView(R.layout.wake_alarm);

        String message = getIntent().getStringExtra("message");
        TextView tv = findViewById(R.id.wake_message);
        if (message != null) tv.setText(message);

        Button stop = findViewById(R.id.wake_stop);
        stop.setOnClickListener(v -> stopAlarm());
    }

    private void stopAlarm() {
        // 停止前台播放服务（响铃 + 震动），服务 onDestroy 会清理资源
        try {
            getApplicationContext().stopService(new Intent(getApplicationContext(), WakePlayerService.class));
        } catch (Exception ignore) {}
        finish();
    }
}
