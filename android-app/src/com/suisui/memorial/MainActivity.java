package com.suisui.memorial;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Base64;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 岁岁纪念馆离线壳。页面与静态资源来自 APK assets/web，
 * 用户导入或在线拉取的备份落在 files/archive，经 https://suisui.local/archive/ 提供，并支持音频 Range。
 * 在线 API 请求（/api/...）通过原生 HttpURLConnection 代理转发至线上服务器。
 */
public class MainActivity extends Activity {
    static final String ORIGIN = "https://suisui.local/";
    static final String REMOTE_API_BASE = "https://suisui.457workshop.space";
    private static final int REQ_PICK_ZIP = 0x5301;
    private static final int REQ_SAVE_ZIP = 0x5302;
    private static final String BACK_JS =
            "(function(){try{if(window.suisuiHandleBack)return !!window.suisuiHandleBack();"
                    + "var m=document.querySelector('.lightbox')||document.querySelector('.modal-mask');"
                    + "if(m){m.remove();return true;}return false;}catch(e){return false;}})()";

    private WebView webView;
    private static final AtomicBoolean IMPORTING = new AtomicBoolean(false);

    private File pendingSaveZipFile;
    private String pendingSaveFilename;
    private FileOutputStream saveZipOutputStream;
    private final Object saveZipLock = new Object();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        applyStatusBar();

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#DBEBEE"));
        applyWebSettings(webView.getSettings());
        webView.setWebViewClient(new LocalClient());
        webView.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
                v.setPadding(0, insets.getSystemWindowInsetTop(), 0, insets.getSystemWindowInsetBottom());
                return insets;
            }
        });
        webView.addJavascriptInterface(new SuisuiNative(), "SuisuiNative");
        setContentView(webView);
        applyStatusBar();
        ArchiveImporter.recoverInterruptedSwap(getFilesDir());
        webView.loadUrl(ORIGIN + "index.html");
    }

    private void applyStatusBar() {
        Window window = getWindow();
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
        int mist = Color.parseColor("#DBEBEE");
        window.setStatusBarColor(mist);
        window.setNavigationBarColor(mist);
        View decor = window.getDecorView();
        int vis = View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        if (Build.VERSION.SDK_INT >= 26) {
            vis |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        }
        decor.setSystemUiVisibility(vis);
    }

    private static void applyWebSettings(WebSettings settings) {
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setGeolocationEnabled(false);
        settings.setBlockNetworkLoads(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    }

    @Override
    public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        webView.evaluateJavascript(BACK_JS, new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String value) {
                if ("true".equals(value)) return;
                if (webView != null && webView.canGoBack()) webView.goBack();
                else finish();
            }
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_SAVE_ZIP) {
            handleSaveZipResult(resultCode, data);
            return;
        }
        if (requestCode != REQ_PICK_ZIP || resultCode != RESULT_OK || data == null) return;
        final Uri uri = data.getData();
        if (uri == null) return;
        if (!IMPORTING.compareAndSet(false, true)) {
            notifyProgress(0, 0);
            return;
        }
        notifyProgress(0, 0);
        final ArchiveImporter.ZipSource source = new ArchiveImporter.ZipSource() {
            @Override
            public InputStream open() throws IOException {
                InputStream in = getContentResolver().openInputStream(uri);
                if (in == null) throw new IOException("empty");
                return in;
            }
        };
        new Thread(new Runnable() {
            @Override
            public void run() {
                ArchiveImporter.Result result;
                try {
                    result = ArchiveImporter.importZip(source, getFilesDir(), new ArchiveImporter.Progress() {
                        @Override
                        public void onProgress(int percent, int count) {
                            notifyProgress(percent, count);
                        }
                    });
                } finally {
                    IMPORTING.set(false);
                }
                notifyDone(result.ok, result.error);
            }
        }, "suisui-import").start();
    }

    private void handleSaveZipResult(int resultCode, Intent data) {
        if (resultCode != RESULT_OK || data == null || data.getData() == null) {
            return;
        }
        final Uri destUri = data.getData();
        final File srcFile = pendingSaveZipFile;
        if (srcFile == null || !srcFile.isFile()) {
            Toast.makeText(this, "未找到待保存的备份文件", Toast.LENGTH_SHORT).show();
            return;
        }
        new Thread(new Runnable() {
            @Override
            public void run() {
                boolean ok = false;
                try {
                    InputStream in = new FileInputStream(srcFile);
                    try {
                        OutputStream out = getContentResolver().openOutputStream(destUri);
                        if (out != null) {
                            try {
                                byte[] buf = new byte[65536];
                                int n;
                                while ((n = in.read(buf)) > 0) {
                                    out.write(buf, 0, n);
                                }
                                out.flush();
                                ok = true;
                            } finally {
                                out.close();
                            }
                        }
                    } finally {
                        in.close();
                    }
                } catch (Exception e) {
                    ok = false;
                }
                final boolean success = ok;
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        if (success) {
                            Toast.makeText(MainActivity.this, "备份包已成功保存到手机！", Toast.LENGTH_LONG).show();
                            if (webView != null) {
                                webView.evaluateJavascript("window.onNativeSaveDone && window.onNativeSaveDone(true, '已保存到手机');", null);
                            }
                        } else {
                            Toast.makeText(MainActivity.this, "保存文件到手机失败，请重试", Toast.LENGTH_LONG).show();
                            if (webView != null) {
                                webView.evaluateJavascript("window.onNativeSaveDone && window.onNativeSaveDone(false, '写入失败');", null);
                            }
                        }
                    }
                });
            }
        }, "suisui-save-zip").start();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private void notifyProgress(final int percent, final int count) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (webView == null) return;
                webView.evaluateJavascript(
                        "window.onNativeImportProgress && window.onNativeImportProgress("
                                + percent + ", '正在导入岁岁回忆 (" + count + ")…')",
                        null);
            }
        });
    }

    private void notifyDone(final boolean ok, final String error) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (webView == null) return;
                webView.evaluateJavascript(
                        "window.onNativeImportDone && window.onNativeImportDone("
                                + (ok ? "true" : "false") + ", " + jsString(error) + ")",
                        null);
            }
        });
    }

    private void launchPicker() {
        if (IMPORTING.get()) {
            notifyProgress(0, 0);
            return;
        }
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[] {
                "application/zip",
                "application/octet-stream",
                "application/x-zip-compressed"
        });
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
            startActivityForResult(intent, REQ_PICK_ZIP);
        } catch (Exception e) {
            notifyDone(false, "无法打开文件选择器");
        }
    }

    private final class LocalClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return !isLocal(request == null ? null : request.getUrl());
        }

        @Override
        @SuppressWarnings("deprecation")
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return !isLocal(url == null ? null : Uri.parse(url));
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            if (request == null || request.getUrl() == null) return null;
            Uri uri = request.getUrl();
            if (!isLocal(uri)) return null;
            String path = uri.getPath();
            if (path == null) path = "/";
            if (path.startsWith("/archive/") || "/archive".equals(path)) {
                return serveArchive(path, header(request, "Range"));
            }
            if (path.startsWith("/api/")) {
                return proxyApi(request, path);
            }
            return serveAsset(path);
        }

        @Override
        @SuppressWarnings("deprecation")
        public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
            if (url == null) return null;
            Uri uri = Uri.parse(url);
            if (!isLocal(uri)) return null;
            String path = uri.getPath() == null ? "/" : uri.getPath();
            if (path.startsWith("/archive/") || "/archive".equals(path)) return serveArchive(path, null);
            if (path.startsWith("/api/")) return proxyApiCompat(uri, path);
            return serveAsset(path);
        }
    }

    private WebResourceResponse proxyApi(WebResourceRequest request, String path) {
        Uri uri = request.getUrl();
        String query = uri.getQuery();
        String targetUrl = REMOTE_API_BASE + path + (query != null && query.length() > 0 ? "?" + query : "");
        String method = request.getMethod();
        if (method == null || method.length() == 0) method = "GET";
        method = method.toUpperCase(Locale.US);

        try {
            URL url = new URL(targetUrl);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod(method);
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(30000);
            conn.setInstanceFollowRedirects(true);

            // 透传请求头
            Map<String, String> inHeaders = request.getRequestHeaders();
            if (inHeaders != null) {
                for (Map.Entry<String, String> entry : inHeaders.entrySet()) {
                    String k = entry.getKey();
                    String v = entry.getValue();
                    if (k == null || v == null) continue;
                    String lk = k.toLowerCase(Locale.US);
                    if ("host".equals(lk) || "x-body-base64".equals(lk)) continue;
                    conn.setRequestProperty(k, v);
                }
            }

            // 透传请求体（POST / PUT 等）
            boolean hasOutput = "POST".equals(method) || "PUT".equals(method) || "PATCH".equals(method);
            byte[] body = null;
            String b64 = header(request, "X-Body-Base64");
            if (b64 != null && b64.length() > 0) {
                try {
                    body = Base64.decode(b64, Base64.DEFAULT);
                } catch (Exception ignored) {}
            }
            if (hasOutput) {
                conn.setDoOutput(true);
                if (body != null && body.length > 0) {
                    conn.setFixedLengthStreamingMode(body.length);
                    OutputStream os = conn.getOutputStream();
                    os.write(body);
                    os.flush();
                    os.close();
                } else {
                    conn.setFixedLengthStreamingMode(0);
                }
            }

            int code = conn.getResponseCode();
            String reason = conn.getResponseMessage();
            if (reason == null || reason.length() == 0) {
                reason = code >= 200 && code < 300 ? "OK" : "Error";
            }

            InputStream in = (code >= 200 && code < 400) ? conn.getInputStream() : conn.getErrorStream();
            if (in == null) in = new ByteArrayInputStream(new byte[0]);

            Map<String, String> outHeaders = new HashMap<String, String>();
            outHeaders.put("Access-Control-Allow-Origin", "*");

            String contentType = conn.getContentType();
            String mime = "application/json";
            String encoding = "utf-8";
            if (contentType != null) {
                String[] parts = contentType.split(";");
                if (parts.length > 0) mime = parts[0].trim();
                for (int i = 1; i < parts.length; i++) {
                    String p = parts[i].trim();
                    if (p.toLowerCase(Locale.US).startsWith("charset=")) {
                        encoding = p.substring(8).trim();
                    }
                }
            }
            for (Map.Entry<String, List<String>> e : conn.getHeaderFields().entrySet()) {
                String k = e.getKey();
                if (k != null && e.getValue() != null && !e.getValue().isEmpty()) {
                    outHeaders.put(k, e.getValue().get(0));
                }
            }
            return new WebResourceResponse(mime, encoding, code, reason, outHeaders, in);
        } catch (IOException e) {
            Map<String, String> errHeaders = new HashMap<String, String>();
            errHeaders.put("Access-Control-Allow-Origin", "*");
            errHeaders.put("Content-Type", "application/json; charset=utf-8");
            String errJson = "{\"ok\":false,\"msg\":\"网络连接失败，请检查网络后重试\"}";
            byte[] errBytes = errJson.getBytes(StandardCharsets.UTF_8);
            return new WebResourceResponse("application/json", "utf-8", 502, "Bad Gateway", errHeaders,
                    new ByteArrayInputStream(errBytes));
        }
    }

    private WebResourceResponse proxyApiCompat(Uri uri, String path) {
        String query = uri.getQuery();
        String targetUrl = REMOTE_API_BASE + path + (query != null && query.length() > 0 ? "?" + query : "");
        try {
            URL url = new URL(targetUrl);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(30000);
            int code = conn.getResponseCode();
            String reason = conn.getResponseMessage();
            InputStream in = (code >= 200 && code < 400) ? conn.getInputStream() : conn.getErrorStream();
            if (in == null) in = new ByteArrayInputStream(new byte[0]);
            Map<String, String> outHeaders = new HashMap<String, String>();
            outHeaders.put("Access-Control-Allow-Origin", "*");
            String contentType = conn.getContentType();
            String mime = "application/json";
            String encoding = "utf-8";
            if (contentType != null) {
                String[] parts = contentType.split(";");
                if (parts.length > 0) mime = parts[0].trim();
            }
            return new WebResourceResponse(mime, encoding, code, reason != null ? reason : "OK", outHeaders, in);
        } catch (IOException e) {
            return notFound();
        }
    }

    private WebResourceResponse serveArchive(String path, String rangeHeader) {
        String sub = path.startsWith("/archive/") ? path.substring("/archive/".length()) : "";
        File file;
        try {
            File archiveRoot = new File(getFilesDir(), "archive");
            file = new File(archiveRoot, sub);
            String rootCanon = archiveRoot.getCanonicalPath();
            String canon = file.getCanonicalPath();
            if (!canon.startsWith(rootCanon)) return notFound();
            if (!canon.equals(rootCanon) && !canon.startsWith(rootCanon + File.separator)) return notFound();
            file = ArchiveImporter.resolveArchiveFile(getFilesDir(), sub);
        } catch (IOException e) {
            return notFound();
        }
        if (file == null) return notFound();
        try {
            ByteRange.Response rr = ByteRange.open(file, rangeHeader, mimeFor(file.getName()));
            return new WebResourceResponse(rr.mime, rr.encoding, rr.status, rr.reason, rr.headers, rr.body);
        } catch (IOException e) {
            return notFound();
        }
    }

    private WebResourceResponse serveAsset(String path) {
        String rel = assetRel(path);
        if (rel == null) return notFound();
        try {
            InputStream in = getAssets().open("web/" + rel);
            Map<String, String> headers = new HashMap<String, String>();
            headers.put("Access-Control-Allow-Origin", "*");
            headers.put("Cache-Control", "no-cache");
            String mime = mimeFor(rel);
            String encoding = isText(rel) ? "utf-8" : null;
            return new WebResourceResponse(mime, encoding, 200, "OK", headers, in);
        } catch (IOException e) {
            return notFound();
        }
    }

    static String assetRel(String path) {
        if (path == null) return null;
        String rel = path;
        if (rel.startsWith("/")) rel = rel.substring(1);
        if (rel.length() == 0 || rel.endsWith("/")) rel = rel + "index.html";
        if (rel.indexOf('\0') >= 0 || rel.indexOf('\\') >= 0) return null;
        String[] parts = rel.split("/");
        for (int i = 0; i < parts.length; i++) {
            if ("..".equals(parts[i]) || parts[i].indexOf(':') >= 0) return null;
        }
        return rel;
    }

    private static boolean isLocal(Uri uri) {
        return uri != null && "https".equalsIgnoreCase(uri.getScheme())
                && "suisui.local".equalsIgnoreCase(uri.getHost());
    }

    private static String header(WebResourceRequest request, String name) {
        Map<String, String> headers = request.getRequestHeaders();
        if (headers == null) return null;
        String direct = headers.get(name);
        if (direct != null) return direct;
        for (Map.Entry<String, String> entry : headers.entrySet()) {
            if (entry.getKey() != null && entry.getKey().equalsIgnoreCase(name)) return entry.getValue();
        }
        return null;
    }

    private static WebResourceResponse notFound() {
        Map<String, String> headers = new HashMap<String, String>();
        headers.put("Cache-Control", "no-store");
        headers.put("Access-Control-Allow-Origin", "*");
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", headers,
                new ByteArrayInputStream(new byte[0]));
    }

    static String mimeFor(String path) {
        String lower = path == null ? "" : path.toLowerCase(Locale.US);
        int q = lower.indexOf('?');
        if (q >= 0) lower = lower.substring(0, q);
        if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "application/javascript";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".webmanifest")) return "application/manifest+json";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".gif")) return "image/gif";
        if (lower.endsWith(".wav")) return "audio/wav";
        if (lower.endsWith(".mp3")) return "audio/mpeg";
        if (lower.endsWith(".txt") || lower.endsWith(".md")) return "text/plain";
        return "application/octet-stream";
    }

    private static boolean isText(String path) {
        String mime = mimeFor(path);
        return mime.startsWith("text/") || mime.indexOf("javascript") >= 0 || mime.indexOf("json") >= 0
                || mime.indexOf("svg") >= 0 || mime.indexOf("manifest") >= 0;
    }

    static String jsString(String value) {
        if (value == null) return "''";
        StringBuilder out = new StringBuilder(value.length() + 2);
        out.append('\'');
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c == '\\' || c == '\'') {
                out.append('\\').append(c);
            } else if (c == '\n') {
                out.append("\\n");
            } else if (c == '\r') {
                out.append("\\r");
            } else if (c == '<') {
                out.append("\\u003c");
            } else {
                out.append(c);
            }
        }
        out.append('\'');
        return out.toString();
    }

    private void clearArchiveDir() {
        ArchiveImporter.deleteTree(new File(getFilesDir(), "archive"));
        ArchiveImporter.deleteTree(new File(getFilesDir(), "archive.tmp"));
        ArchiveImporter.deleteTree(new File(getFilesDir(), "archive.bak"));
    }

    private void onZipReadyToSave(final File zipFile, final String filename) {
        if (zipFile == null || !zipFile.isFile() || zipFile.length() == 0) return;

        // 若 archive/ 尚为空，顺手解压持久化进 App 的 getFilesDir()/archive/
        final File archiveJson = new File(getFilesDir(), "archive/data/archive.json");
        if (!archiveJson.isFile()) {
            new Thread(new Runnable() {
                @Override
                public void run() {
                    ArchiveImporter.importZip(new ArchiveImporter.ZipSource() {
                        @Override
                        public InputStream open() throws IOException {
                            return new FileInputStream(zipFile);
                        }
                    }, getFilesDir(), null);
                }
            }, "suisui-persist").start();
        }

        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("application/zip");
                intent.putExtra(Intent.EXTRA_TITLE, filename != null && filename.length() > 0 ? filename : "岁岁回忆备份.zip");
                try {
                    startActivityForResult(intent, REQ_SAVE_ZIP);
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "无法打开系统保存文件器", Toast.LENGTH_SHORT).show();
                }
            }
        });
    }

    public final class SuisuiNative {
        @JavascriptInterface
        public boolean hasArchive() {
            return new File(getFilesDir(), "archive/data/archive.json").isFile();
        }

        @JavascriptInterface
        public void pickZip() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    launchPicker();
                }
            });
        }

        @JavascriptInterface
        public void clearArchive() {
            if (IMPORTING.get()) return;
            clearArchiveDir();
        }

        @JavascriptInterface
        public void saveBase64Zip(final String base64Data, final String filename) {
            if (base64Data == null || base64Data.length() == 0) return;
            final String safeName = (filename == null || filename.length() == 0) ? "岁岁回忆备份.zip" : filename;
            pendingSaveFilename = safeName;
            final File file = new File(getCacheDir(), "pending_export_" + System.currentTimeMillis() + ".zip");
            pendingSaveZipFile = file;
            new Thread(new Runnable() {
                @Override
                public void run() {
                    try {
                        byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
                        FileOutputStream fos = new FileOutputStream(file);
                        try {
                            fos.write(bytes);
                            fos.flush();
                        } finally {
                            fos.close();
                        }
                        onZipReadyToSave(file, safeName);
                    } catch (Exception e) {
                        runOnUiThread(new Runnable() {
                            @Override
                            public void run() {
                                Toast.makeText(MainActivity.this, "保存备份包失败，请重试", Toast.LENGTH_SHORT).show();
                            }
                        });
                    }
                }
            }, "suisui-write-zip").start();
        }

        @JavascriptInterface
        public void beginSaveZip(final String filename, final long totalBytes) {
            synchronized (saveZipLock) {
                if (saveZipOutputStream != null) {
                    try { saveZipOutputStream.close(); } catch (Exception ignored) {}
                    saveZipOutputStream = null;
                }
                pendingSaveFilename = (filename == null || filename.length() == 0) ? "岁岁回忆备份.zip" : filename;
                pendingSaveZipFile = new File(getCacheDir(), "pending_export_" + System.currentTimeMillis() + ".zip");
                try {
                    saveZipOutputStream = new FileOutputStream(pendingSaveZipFile);
                } catch (IOException e) {
                    pendingSaveZipFile = null;
                }
            }
        }

        @JavascriptInterface
        public void appendSaveZipChunk(final String base64Chunk) {
            if (base64Chunk == null || base64Chunk.length() == 0) return;
            synchronized (saveZipLock) {
                if (saveZipOutputStream != null) {
                    try {
                        byte[] bytes = Base64.decode(base64Chunk, Base64.DEFAULT);
                        saveZipOutputStream.write(bytes);
                    } catch (Exception ignored) {}
                }
            }
        }

        @JavascriptInterface
        public void finishSaveZip() {
            synchronized (saveZipLock) {
                if (saveZipOutputStream != null) {
                    try {
                        saveZipOutputStream.flush();
                        saveZipOutputStream.close();
                    } catch (Exception ignored) {}
                    saveZipOutputStream = null;
                }
            }
            if (pendingSaveZipFile != null) {
                onZipReadyToSave(pendingSaveZipFile, pendingSaveFilename);
            }
        }
    }
}
