package io.github.lesumein.chessreplay;

import android.annotation.SuppressLint;
import android.content.Context;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.io.IOException;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * 앱을 닫아 둔 동안 화면 없는 WebView로 background.html을 열어 새 게임을 분석해 둔다.
 * 분석 코드는 앱 화면과 같은 JS(src/library.js)를 쓰고, 결과도 같은 저장소(IndexedDB)에 쌓인다.
 * 그래서 WebView의 주소를 앱 화면과 같은 https://localhost 로 맞춘다.
 */
public class AnalyzeWorker extends Worker {
    private static final String TAG = "AnalyzeWorker";
    private static final String NAME = "analyze-games";
    private static final String ORIGIN_HOST = "localhost";
    private static final long TIMEOUT_MIN = 9; // 안드로이드 작업은 10분 안에 끝나야 한다

    public AnalyzeWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    public static void schedule(Context context) {
        Constraints constraints = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .setRequiresBatteryNotLow(true)
                .build();
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(AnalyzeWorker.class, 1, TimeUnit.HOURS)
                .setConstraints(constraints)
                .build();
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, request);
    }

    @NonNull
    @Override
    public Result doWork() {
        CountDownLatch finished = new CountDownLatch(1);
        AtomicReference<String> outcome = new AtomicReference<>("timeout");
        AtomicReference<WebView> holder = new AtomicReference<>();
        Handler main = new Handler(Looper.getMainLooper());
        main.post(() -> holder.set(open(finished, outcome)));
        try {
            finished.await(TIMEOUT_MIN, TimeUnit.MINUTES);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        main.post(() -> {
            WebView view = holder.get();
            if (view != null) view.destroy();
        });
        Log.i(TAG, "result " + outcome.get());
        return outcome.get().startsWith("error") ? Result.retry() : Result.success();
    }

    @SuppressLint("SetJavaScriptEnabled")
    private WebView open(CountDownLatch finished, AtomicReference<String> outcome) {
        Context context = getApplicationContext();
        WebView view = new WebView(context);
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        view.addJavascriptInterface(new Object() {
            @JavascriptInterface
            public void done(String result) {
                outcome.set(result);
                finished.countDown();
            }
        }, "AndroidBackground");
        view.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (!ORIGIN_HOST.equals(url.getHost())) return null; // Chess.com API 등은 그대로
                String path = url.getPath() == null || url.getPath().equals("/") ? "/index.html" : url.getPath();
                try {
                    return new WebResourceResponse(mime(path), null, context.getAssets().open("public" + path));
                } catch (IOException e) {
                    return new WebResourceResponse("text/plain", null, 404, "Not Found", null, null);
                }
            }
        });
        view.loadUrl("https://" + ORIGIN_HOST + "/background.html");
        return view;
    }

    private static String mime(String path) {
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".js")) return "text/javascript";
        if (path.endsWith(".wasm")) return "application/wasm";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".json")) return "application/json";
        if (path.endsWith(".png")) return "image/png";
        return "application/octet-stream";
    }
}
