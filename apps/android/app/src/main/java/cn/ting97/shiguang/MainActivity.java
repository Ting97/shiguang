package cn.ting97.shiguang;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/**
 * 「拾光复利」WebView 壳：加载线上 https://shiguang.ting97.cn，无任何后端改动。
 *
 * 兼容点：
 * 1. 麦克风（语音记账 getUserMedia/MediaRecorder）—— RECORD_AUDIO 运行时权限 + onPermissionRequest 授权
 * 2. Cookie 会话（HttpOnly shiguang_session）—— CookieManager 持久化 + onPause flush
 * 3. CSV 账单导入 —— onShowFileChooser + ACTION_GET_CONTENT(content:// URI)
 * 4. 数据导出 /api/export —— DownloadListener → 系统 DownloadManager（透传 Cookie）
 * 5. localStorage 主题记忆 —— domStorageEnabled
 * 6. 返回键（goBack/双击退出）与断网原生重试浮层
 */
public class MainActivity extends Activity {

    private static final String BASE_URL = "https://shiguang.ting97.cn";
    private static final String HOST_SUFFIX = "ting97.cn";
    private static final int REQ_MIC = 1;
    private static final int REQ_FILE_CHOOSER = 2;
    private static final long BACK_EXIT_INTERVAL = 2000L;

    private FrameLayout root;
    private WebView webView;
    private View offlineOverlay;

    /** WebView 发起的文件选择回调（同一时刻只能有一个） */
    private ValueCallback<Uri[]> filePathCallback;
    /** 等原生权限结果期间挂起的 WebView 录音授权请求 */
    private PermissionRequest pendingMicRequest;

    private long lastBackAt;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#020617"));

        setupWebView();
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        // 系统栏区域由 fitsSystemWindows 让位，页面自身的 safe-area CSS 在此模式下取值为 0，不会双重留白
        webView.setFitsSystemWindows(true);

        offlineOverlay = buildOfflineOverlay();
        offlineOverlay.setVisibility(View.GONE);
        root.addView(offlineOverlay, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        setContentView(root);
        registerDownloadCompleteReceiver();
        webView.loadUrl(BASE_URL);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void setupWebView() {
        webView = new WebView(this);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        // localStorage（主题记忆、提醒dismiss记录）
        s.setDomStorageEnabled(true);
        // 语音按钮自动开录不被“需用户手势”拦截（长按/点击交互由页面自身控制）
        s.setMediaPlaybackRequiresUserGesture(false);
        // 安全收紧：壳内页面不需要本地文件能力
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true); // 文件选择器回传 content:// URI 需要

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true); // 登录会话 HttpOnly cookie，默认持久化到 WebView 数据目录

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme() == null ? "" : uri.getScheme();
                if (("http".equals(scheme) || "https".equals(scheme))
                        && uri.getHost() != null && uri.getHost().endsWith(HOST_SUFFIX)) {
                    return false; // 站内导航留在壳内
                }
                try { // 外站链接与 tel:/mailto: 等交给系统应用
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "没有应用能打开该链接", Toast.LENGTH_SHORT).show();
                }
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                offlineOverlay.setVisibility(View.GONE);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                // 只处理主文档的网络性失败（图片等子资源失败不影响页面）
                if (!request.isForMainFrame()) return;
                int code = error.getErrorCode();
                if (code == WebViewClient.ERROR_HOST_LOOKUP
                        || code == WebViewClient.ERROR_CONNECT
                        || code == WebViewClient.ERROR_TIMEOUT
                        || code == WebViewClient.ERROR_IO
                        || code == WebViewClient.ERROR_UNKNOWN) {
                    offlineOverlay.setVisibility(View.VISIBLE);
                }
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                // 渲染进程崩溃后 WebView 会白屏，重建恢复
                if (webView != null) {
                    root.removeView(webView);
                    webView.destroy();
                }
                setupWebView();
                webView.setFitsSystemWindows(true);
                root.addView(webView, 0, new FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                webView.loadUrl(BASE_URL);
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            // —— 麦克风授权：getUserMedia 触发 ——
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                boolean audio = false;
                for (String r : request.getResources()) {
                    if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) audio = true;
                }
                if (!audio) { // 本站只用麦克风，其余一律拒绝
                    request.deny();
                    return;
                }
                if (checkSelfPermission(android.Manifest.permission.RECORD_AUDIO)
                        == android.content.pm.PackageManager.PERMISSION_GRANTED) {
                    runOnUiThread(() -> request.grant(request.getResources()));
                } else {
                    pendingMicRequest = request;
                    requestPermissions(new String[]{android.Manifest.permission.RECORD_AUDIO}, REQ_MIC);
                }
            }

            @Override
            public void onPermissionRequestCanceled(PermissionRequest request) {
                if (request.equals(pendingMicRequest)) pendingMicRequest = null;
            }

            // —— CSV 账单导入：<input type="file"> 触发 ——
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null); // 旧回调必须消费，否则后续无法再弹
                filePathCallback = callback;

                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*"); // 支付宝/微信导出的 csv 常被识别成 excel/plain，mime 过滤过严会选不到
                intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{
                        "text/csv", "text/comma-separated-values", "text/plain",
                        "application/csv", "application/vnd.ms-excel"});
                try {
                    startActivityForResult(Intent.createChooser(intent, "选择账单文件"), REQ_FILE_CHOOSER);
                } catch (Exception e) {
                    filePathCallback = null;
                    Toast.makeText(MainActivity.this, "没有可用的文件选择器", Toast.LENGTH_SHORT).show();
                    return false;
                }
                return true;
            }
        });

        // —— 数据导出 /api/export：WebView 不会自动下载，转 DownloadManager ——
        webView.setDownloadListener((DownloadListener) (url, userAgent, contentDisposition, mimetype, contentLength) -> {
            try {
                DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
                String cookie = CookieManager.getInstance().getCookie(url);
                if (cookie != null) req.addRequestHeader("Cookie", cookie); // 导出接口鉴权靠会话 cookie
                req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                String name = URLUtil.guessFileName(url, contentDisposition, mimetype);
                req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
                DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                dm.enqueue(req);
                Toast.makeText(this, "已开始下载：" + name, Toast.LENGTH_SHORT).show();
            } catch (Exception e) {
                Toast.makeText(this, "下载失败，请在浏览器中打开重试", Toast.LENGTH_SHORT).show();
            }
        });
    }

    /** 断网重试浮层：原生实现，避开 file:// 资产页跳 https 的兼容问题 */
    private View buildOfflineOverlay() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setBackgroundColor(Color.parseColor("#020617"));

        TextView emoji = new TextView(this);
        emoji.setText("📡");
        emoji.setTextSize(40);
        emoji.setGravity(Gravity.CENTER);
        TextView title = new TextView(this);
        title.setText("网络似乎断开了");
        title.setTextColor(Color.parseColor("#f1f5f9"));
        title.setTextSize(17);
        title.setGravity(Gravity.CENTER);
        title.setPadding(0, dp(20), 0, dp(6));
        TextView sub = new TextView(this);
        sub.setText("拾光复利需要联网使用，请检查网络后重试");
        sub.setTextColor(Color.parseColor("#94a3b8"));
        sub.setTextSize(14);
        sub.setGravity(Gravity.CENTER);

        Button retry = new Button(this);
        retry.setText("重新加载");
        retry.setTextColor(Color.parseColor("#020617"));
        retry.setBackgroundColor(Color.parseColor("#f1c66b"));
        LinearLayout.LayoutParams bp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        bp.topMargin = dp(28);
        retry.setLayoutParams(bp);
        retry.setOnClickListener(v -> {
            offlineOverlay.setVisibility(View.GONE);
            webView.loadUrl(BASE_URL);
        });

        box.addView(emoji);
        box.addView(title);
        box.addView(sub);
        box.addView(retry);
        return box;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_MIC && pendingMicRequest != null) {
            if (grantResults.length > 0 && grantResults[0] == android.content.pm.PackageManager.PERMISSION_GRANTED) {
                pendingMicRequest.grant(pendingMicRequest.getResources());
            } else {
                pendingMicRequest.deny();
                Toast.makeText(this, "未授予麦克风权限，语音记账不可用", Toast.LENGTH_LONG).show();
            }
            pendingMicRequest = null;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE_CHOOSER) {
            if (filePathCallback == null) return;
            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                results = new Uri[]{data.getData()}; // 账单导入为单文件选择
            }
            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        if (offlineOverlay.getVisibility() == View.VISIBLE) {
            offlineOverlay.setVisibility(View.GONE);
            webView.loadUrl(BASE_URL);
            return;
        }
        if (webView.canGoBack()) {
            webView.goBack();
            return;
        }
        long now = System.currentTimeMillis();
        if (now - lastBackAt < BACK_EXIT_INTERVAL) {
            finish();
        } else {
            lastBackAt = now;
            Toast.makeText(this, "再按一次退出", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        webView.onPause();
        CookieManager.getInstance().flush(); // 会话 cookie 立即落盘，避免进程被杀丢登录态
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
    }

    @Override
    protected void onDestroy() {
        unregisterDownloadCompleteReceiver();
        if (webView != null) {
            root.removeView(webView);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private BroadcastReceiver downloadReceiver;

    private void registerDownloadCompleteReceiver() {
        downloadReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                Toast.makeText(context, "下载完成，可在系统「下载」中查看", Toast.LENGTH_SHORT).show();
            }
        };
        IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        // Android 14+（targetSdk 34+）强制：动态注册必须声明导出标志，否则 SecurityException 闪退
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(downloadReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(downloadReceiver, filter);
        }
    }

    private void unregisterDownloadCompleteReceiver() {
        try {
            unregisterReceiver(downloadReceiver);
        } catch (IllegalArgumentException ignored) {
        }
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
