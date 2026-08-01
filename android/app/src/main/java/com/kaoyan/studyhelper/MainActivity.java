package com.kaoyan.studyhelper;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.kaoyan.studyhelper.plugins.WakeAlarmPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WakeAlarmPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
