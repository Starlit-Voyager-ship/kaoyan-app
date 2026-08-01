package com.kaoyan.studyhelper.plugins;

import android.app.Activity;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Vibrator;
import android.os.VibrationEffect;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.TextView;

/**
 * 全屏叫醒 Activity：锁屏可见、点亮屏幕，播放系统闹钟声（TYPE_ALARM 在 DND 下通常仍响），
 * 并震动，直到用户点击"停止"。
 */
public class WakeAlarmActivity extends Activity {
    private Ringtone ringtone;
    private Vibrator vibrator;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 点亮屏幕 / 锁屏可见
        getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD);

        setContentView(R.layout.wake_alarm);

        String message = getIntent().getStringExtra("message");
        boolean sound = getIntent().getBooleanExtra("sound", true);
        boolean vibrate = getIntent().getBooleanExtra("vibrate", true);

        TextView tv = findViewById(R.id.wake_message);
        if (message != null) tv.setText(message);

        // 播放闹钟声（TYPE_ALARM 是系统给闹钟的特权音频流，DND 下通常不被静音）
        if (sound) {
            try {
                Uri uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
                if (uri == null) uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
                ringtone = RingtoneManager.getRingtone(this, uri);
                ringtone.play();
            } catch (Exception e) { /* 忽略 */ }
        }

        // 震动
        if (vibrate) {
            vibrator = (Vibrator) getSystemService(VIBRATOR_SERVICE);
            if (vibrator != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createWaveform(new long[]{0, 800, 400, 800}, 0));
                } else {
                    vibrator.vibrate(new long[]{0, 800, 400, 800}, 0);
                }
            }
        }

        Button stop = findViewById(R.id.wake_stop);
        stop.setOnClickListener(v -> stopAlarm());
    }

    private void stopAlarm() {
        if (ringtone != null && ringtone.isPlaying()) ringtone.stop();
        if (vibrator != null) vibrator.cancel();
        finish();
    }

    @Override
    protected void onDestroy() {
        if (ringtone != null && ringtone.isPlaying()) ringtone.stop();
        if (vibrator != null) vibrator.cancel();
        super.onDestroy();
    }
}
