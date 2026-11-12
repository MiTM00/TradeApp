package com.trade.sourcing;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Trade as a normal Android app: the web app is built into the APK (assets/www) and shown full screen.
 * Data stays in the app's own database on the phone; sync, AI scanner and email use the Trade computer.
 */
public class MainActivity extends Activity {
    static final String HOST = "appassets.androidplatform.net";
    static final String HOME = "https://" + HOST + "/";
    static final int REQ_FILES = 1, REQ_CAMERA_PHOTO = 2, PERM_CAMERA_PHOTO = 10, PERM_CAMERA_LIVE = 11, PERM_LOCATION = 12, PERM_STORAGE = 13;

    WebView web;
    FrameLayout root;
    ValueCallback<Uri[]> fileCb;
    File photoFile;
    boolean photoMultiple;
    PermissionRequest liveRequest;
    String geoOrigin;
    GeolocationPermissions.Callback geoCb;
    Runnable afterStorage;

    @Override protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#0F766E"));
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#F5F7FA"));
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        fitSystemBars();

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setGeolocationEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW); // the Trade computer is http on the Wi-Fi
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setTextZoom(100);
        s.setSupportMultipleWindows(false);
        s.setUserAgentString(s.getUserAgentString() + " TradeApp/" + version());

        web.addJavascriptInterface(new Bridge(), "TradeAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) { return asset(r.getUrl()); }
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if (HOST.equals(u.getHost())) return false;
                openExternal(u.toString());
                return true;
            }
        });
        if (Build.VERSION.SDK_INT >= 24) {
            ServiceWorkerController.getInstance().setServiceWorkerClient(new ServiceWorkerClient() {
                @Override public WebResourceResponse shouldInterceptRequest(WebResourceRequest r) { return asset(r.getUrl()); }
            });
        }
        web.setWebChromeClient(new Chrome());

        if (saved != null) web.restoreState(saved);
        else web.loadUrl(HOME);
    }

    // Draw the app between the status bar and the navigation bar / keyboard
    void fitSystemBars() {
        // Always draw behind the bars and pad by their size, so every Android version looks the same
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        else root.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        root.setOnApplyWindowInsetsListener((v, in) -> {
            int l, t, r, b;
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = in.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                android.graphics.Insets ime = in.getInsets(WindowInsets.Type.ime());
                l = bars.left; t = bars.top; r = bars.right; b = Math.max(bars.bottom, ime.bottom);
            } else {
                l = in.getSystemWindowInsetLeft(); t = in.getSystemWindowInsetTop(); r = in.getSystemWindowInsetRight(); b = in.getSystemWindowInsetBottom();
            }
            v.setPadding(l, t, r, b);
            return in;
        });
    }

    @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }

    @Override public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override protected void onResume() { super.onResume(); web.onResume(); }
    @Override protected void onPause() { web.onPause(); super.onPause(); }

    String version() {
        try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception e) { return ""; }
    }

    // ---- the app files built into the APK ----
    static final Map<String, String> TYPES = new HashMap<>();
    static {
        TYPES.put("html", "text/html"); TYPES.put("js", "application/javascript"); TYPES.put("css", "text/css");
        TYPES.put("json", "application/json"); TYPES.put("webmanifest", "application/manifest+json");
        TYPES.put("png", "image/png"); TYPES.put("svg", "image/svg+xml"); TYPES.put("jpg", "image/jpeg");
    }

    WebResourceResponse asset(Uri u) {
        if (!HOST.equals(u.getHost()) || !"https".equals(u.getScheme())) return null;
        String p = u.getPath() == null ? "/" : u.getPath();
        if (p.equals("/") || p.isEmpty()) p = "/index.html";
        if (p.contains("..")) return notFound();
        String ext = p.substring(p.lastIndexOf('.') + 1).toLowerCase();
        String type = TYPES.containsKey(ext) ? TYPES.get(ext) : "application/octet-stream";
        try {
            InputStream in = getAssets().open("www" + p);
            WebResourceResponse r = new WebResourceResponse(type, type.startsWith("text/") || type.contains("javascript") || type.contains("json") ? "utf-8" : null, in);
            Map<String, String> h = new HashMap<>();
            h.put("Cache-Control", "no-cache");
            if (p.equals("/sw.js")) h.put("Service-Worker-Allowed", "/");
            r.setResponseHeaders(h);
            return r;
        } catch (IOException e) {
            return notFound();
        }
    }

    WebResourceResponse notFound() {
        WebResourceResponse r = new WebResourceResponse("text/plain", "utf-8", new java.io.ByteArrayInputStream(new byte[0]));
        r.setStatusCodeAndReasonPhrase(404, "Not found");
        return r;
    }

    // Links to other sites, Amap, email, phone numbers: open the right app
    void openExternal(String url) {
        try {
            Intent i;
            if (url.startsWith("intent:")) i = Intent.parseUri(url, Intent.URI_INTENT_SCHEME);
            else if (url.startsWith("mailto:")) i = new Intent(Intent.ACTION_SENDTO, Uri.parse(url));
            else i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addCategory(Intent.CATEGORY_BROWSABLE);
            startActivity(i);
        } catch (ActivityNotFoundException e) {
            toast("No app can open this link");
        } catch (Exception e) {
            toast(e.getMessage());
        }
    }

    void toast(String m) { runOnUiThread(() -> Toast.makeText(this, m, Toast.LENGTH_SHORT).show()); }

    boolean has(String perm) { return checkSelfPermission(perm) == PackageManager.PERMISSION_GRANTED; }

    // ---- photos, camera, location ----
    class Chrome extends WebChromeClient {
        @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
            if (fileCb != null) fileCb.onReceiveValue(null);
            fileCb = cb;
            photoMultiple = p.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE;
            boolean images = true;
            for (String t : p.getAcceptTypes()) if (!t.isEmpty() && !t.startsWith("image/")) images = false;
            if (p.isCaptureEnabled() && images) {
                if (has(Manifest.permission.CAMERA)) takePhoto();
                else requestPermissions(new String[]{Manifest.permission.CAMERA}, PERM_CAMERA_PHOTO);
            } else pickFiles(images);
            return true;
        }

        @Override public void onPermissionRequest(PermissionRequest r) {
            runOnUiThread(() -> {
                boolean video = false;
                for (String res : r.getResources()) if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res)) video = true;
                if (!video) { r.deny(); return; }
                if (has(Manifest.permission.CAMERA)) r.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
                else { liveRequest = r; requestPermissions(new String[]{Manifest.permission.CAMERA}, PERM_CAMERA_LIVE); }
            });
        }

        @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback cb) {
            if (has(Manifest.permission.ACCESS_FINE_LOCATION) || has(Manifest.permission.ACCESS_COARSE_LOCATION)) { cb.invoke(origin, true, false); return; }
            geoOrigin = origin; geoCb = cb;
            requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, PERM_LOCATION);
        }
    }

    void takePhoto() {
        try {
            photoFile = new File(Files.dir(this, "photos"), "photo-" + System.currentTimeMillis() + ".jpg");
            Uri out = Files.uri(photoFile);
            Intent i = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            i.putExtra(MediaStore.EXTRA_OUTPUT, out);
            i.setClipData(ClipData.newRawUri("photo", out));
            i.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivityForResult(i, REQ_CAMERA_PHOTO);
        } catch (Exception e) {
            toast("No camera app found");
            pickFiles(true);
        }
    }

    void pickFiles(boolean images) {
        Intent i = new Intent(Intent.ACTION_GET_CONTENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType(images ? "image/*" : "*/*");
        if (photoMultiple) i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        try { startActivityForResult(Intent.createChooser(i, null), REQ_FILES); }
        catch (Exception e) { finishFiles(null); }
    }

    void finishFiles(Uri[] r) {
        if (fileCb != null) fileCb.onReceiveValue(r);
        fileCb = null;
    }

    @Override protected void onActivityResult(int req, int code, Intent data) {
        if (req == REQ_CAMERA_PHOTO) {
            finishFiles(code == RESULT_OK && photoFile != null && photoFile.length() > 0 ? new Uri[]{Files.uri(photoFile)} : null);
        } else if (req == REQ_FILES) {
            List<Uri> out = new ArrayList<>();
            if (code == RESULT_OK && data != null) {
                if (data.getClipData() != null) for (int i = 0; i < data.getClipData().getItemCount(); i++) out.add(data.getClipData().getItemAt(i).getUri());
                else if (data.getData() != null) out.add(data.getData());
            }
            finishFiles(out.isEmpty() ? null : out.toArray(new Uri[0]));
        } else super.onActivityResult(req, code, data);
    }

    @Override public void onRequestPermissionsResult(int req, String[] perms, int[] res) {
        boolean ok = res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED;
        for (int r : res) if (r == PackageManager.PERMISSION_GRANTED) ok = true;
        if (req == PERM_CAMERA_PHOTO) {
            if (ok) takePhoto(); else { toast("Camera not allowed — choose a photo instead"); pickFiles(true); }
        } else if (req == PERM_CAMERA_LIVE && liveRequest != null) {
            if (ok) liveRequest.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE}); else liveRequest.deny();
            liveRequest = null;
        } else if (req == PERM_LOCATION && geoCb != null) {
            geoCb.invoke(geoOrigin, ok, false);
            geoCb = null;
        } else if (req == PERM_STORAGE && afterStorage != null) {
            Runnable r = afterStorage; afterStorage = null; r.run();
        }
    }

    // ---- files from the web app: save to Downloads, share, open ----
    static String safeName(String n) {
        n = n == null ? "" : n.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        return n.isEmpty() || n.startsWith(".") ? "file" + n : n;
    }

    File cacheFile(String name, byte[] bytes) throws IOException {
        File f = new File(Files.dir(this, "share"), safeName(name));
        try (OutputStream o = new FileOutputStream(f)) { o.write(bytes); }
        return f;
    }

    void saveToDownloads(String name, String mime, byte[] bytes) {
        name = safeName(name);
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.Downloads.DISPLAY_NAME, name);
                v.put(MediaStore.Downloads.MIME_TYPE, mime);
                v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Trade");
                Uri u = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (u == null) throw new IOException("Could not save");
                try (OutputStream o = getContentResolver().openOutputStream(u)) { o.write(bytes); }
                toast("Saved in Downloads/Trade: " + name);
            } else {
                File d = has(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                        ? new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "Trade")
                        : getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                d.mkdirs();
                File f = new File(d, name);
                try (OutputStream o = new FileOutputStream(f)) { o.write(bytes); }
                toast("Saved: " + f.getAbsolutePath());
            }
        } catch (Exception e) {
            toast("Could not save: " + e.getMessage());
        }
    }

    class Bridge {
        @JavascriptInterface public String version() { return MainActivity.this.version(); }

        // This phone's own Wi-Fi / hotspot addresses (IPv4), so the app can look for the Trade computer on the same network
        @JavascriptInterface public String localIps() {
            StringBuilder out = new StringBuilder();
            try {
                for (java.net.NetworkInterface n : java.util.Collections.list(java.net.NetworkInterface.getNetworkInterfaces())) {
                    if (!n.isUp() || n.isLoopback()) continue;
                    for (java.net.InetAddress a : java.util.Collections.list(n.getInetAddresses())) {
                        if (a instanceof java.net.Inet4Address && !a.isLoopbackAddress()) out.append(out.length() > 0 ? "," : "").append(a.getHostAddress());
                    }
                }
            } catch (Exception e) {}
            return out.toString();
        }

        @JavascriptInterface public String saveFile(String name, String mime, String b64, String extra) {
            try {
                byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
                if (Build.VERSION.SDK_INT < 29 && !has(Manifest.permission.WRITE_EXTERNAL_STORAGE)) {
                    runOnUiThread(() -> {
                        afterStorage = () -> saveToDownloads(name, mime, bytes);
                        requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, PERM_STORAGE);
                    });
                } else saveToDownloads(name, mime, bytes);
                return "";
            } catch (Exception e) { return e.getMessage(); }
        }

        @JavascriptInterface public String shareFile(String name, String mime, String b64, String text) {
            try {
                File f = cacheFile(name, Base64.decode(b64, Base64.DEFAULT));
                Uri u = Files.uri(f);
                Intent i = new Intent(Intent.ACTION_SEND);
                i.setType(mime);
                i.putExtra(Intent.EXTRA_STREAM, u);
                if (text != null && !text.isEmpty()) { i.putExtra(Intent.EXTRA_TEXT, text); i.putExtra(Intent.EXTRA_SUBJECT, text); }
                i.setClipData(ClipData.newRawUri(f.getName(), u));
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                runOnUiThread(() -> startActivity(Intent.createChooser(i, null)));
                return "";
            } catch (Exception e) { return e.getMessage(); }
        }

        @JavascriptInterface public String openFile(String name, String mime, String b64, String extra) {
            try {
                File f = cacheFile(name, Base64.decode(b64, Base64.DEFAULT));
                Intent i = new Intent(Intent.ACTION_VIEW);
                i.setDataAndType(Files.uri(f), mime);
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                runOnUiThread(() -> {
                    try { startActivity(i); } catch (ActivityNotFoundException e) { toast("No app on this phone can open " + f.getName()); }
                });
                return "";
            } catch (Exception e) { return e.getMessage(); }
        }

        @JavascriptInterface public void shareText(String text) {
            Intent i = new Intent(Intent.ACTION_SEND);
            i.setType("text/plain");
            i.putExtra(Intent.EXTRA_TEXT, text);
            runOnUiThread(() -> startActivity(Intent.createChooser(i, null)));
        }

        @JavascriptInterface public void openUrl(String url) { runOnUiThread(() -> openExternal(url)); }
    }
}
