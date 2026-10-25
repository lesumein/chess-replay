package io.github.lesumein.chessreplay;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // 앱을 닫아 둔 동안에도 가끔 새 게임을 분석해 두도록 예약한다
        AnalyzeWorker.schedule(this);
    }
}
