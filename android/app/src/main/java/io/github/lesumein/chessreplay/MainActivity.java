package io.github.lesumein.chessreplay;

import android.content.Intent;
import android.os.Bundle;
import android.webkit.JavascriptInterface;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    // 공유로 받은 글(게임 링크나 PGN). 웹 쪽이 AndroidShare.take()로 한 번 가져간다.
    private volatile String sharedText = null;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // 앱을 닫아 둔 동안에도 가끔 새 게임을 분석해 두도록 예약한다
        AnalyzeWorker.schedule(this);
        bridge.getWebView().addJavascriptInterface(new Object() {
            @JavascriptInterface
            public String take() {
                String text = sharedText;
                sharedText = null;
                return text;
            }
        }, "AndroidShare");
        keepShared(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // 앱이 이미 열려 있을 때 공유로 들어오면 웹 쪽에 알린다
        if (keepShared(intent)) bridge.triggerWindowJSEvent("shared");
    }

    private boolean keepShared(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return false;
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        if (text == null || text.isEmpty()) return false;
        sharedText = text;
        return true;
    }
}
