package top.v2api.v2chat;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Base64;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import net.i2p.crypto.eddsa.EdDSAEngine;
import net.i2p.crypto.eddsa.EdDSAPublicKey;
import net.i2p.crypto.eddsa.spec.EdDSANamedCurveTable;
import net.i2p.crypto.eddsa.spec.EdDSAParameterSpec;
import net.i2p.crypto.eddsa.spec.EdDSAPublicKeySpec;

@CapacitorPlugin(name = "V2ChatUpdater")
public class V2ChatUpdaterPlugin extends Plugin {
    private static final String RELEASE_PUBLIC_KEY_BASE64 = "1u9kRXBxH671CuU8w5T5MkwSjkU0VM8XyehHD7XgY6A=";
    private static final String PREFERENCES = "v2chat_updater";
    private static final String DOWNLOADED_APK = "downloaded_apk";
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void getVersionInfo(PluginCall call) {
        try {
            PackageInfo info = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            JSObject result = new JSObject();
            result.put("versionCode", Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode);
            result.put("versionName", info.versionName == null ? "" : info.versionName);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Unable to read app version", "UPDATE_VERSION_FAILED", error);
        }
    }

    @PluginMethod
    public void verifyManifest(PluginCall call) {
        String payload = call.getString("payload");
        String signature = call.getString("signature");
        if (payload == null || signature == null) {
            call.reject("payload and signature are required", "UPDATE_INVALID_MANIFEST");
            return;
        }
        if (RELEASE_PUBLIC_KEY_BASE64.isEmpty()) {
            call.reject("Release public key is not configured", "UPDATE_PUBLIC_KEY_MISSING");
            return;
        }

        try {
            byte[] publicKey = Base64.decode(RELEASE_PUBLIC_KEY_BASE64, Base64.DEFAULT);
            byte[] signatureBytes = Base64.decode(signature, Base64.DEFAULT);
            if (publicKey.length != 32 || signatureBytes.length != 64) {
                call.reject("Release manifest has an invalid key or signature", "UPDATE_INVALID_SIGNATURE");
                return;
            }
            EdDSAParameterSpec params = EdDSANamedCurveTable.getByName("Ed25519");
            EdDSAEngine verifier = new EdDSAEngine(MessageDigest.getInstance(params.getHashAlgorithm()));
            verifier.initVerify(new EdDSAPublicKey(new EdDSAPublicKeySpec(publicKey, params)));
            verifier.update(payload.getBytes(StandardCharsets.UTF_8));
            JSObject result = new JSObject();
            result.put("valid", verifier.verify(signatureBytes));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Unable to verify release manifest", "UPDATE_SIGNATURE_CHECK_FAILED", error);
        }
    }

    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url");
        String expectedSHA256 = call.getString("sha256");
        Long expectedSize = call.getLong("sizeBytes");
        if (url == null || expectedSHA256 == null || expectedSize == null || expectedSize < 1 || !expectedSHA256.matches("(?i)[0-9a-f]{64}")) {
            call.reject("url, sha256 and sizeBytes are required", "UPDATE_INVALID_DOWNLOAD");
            return;
        }

        executor.execute(() -> downloadInBackground(call, url, expectedSHA256.toLowerCase(Locale.ROOT), expectedSize));
    }

    @PluginMethod
    public void install(PluginCall call) {
        File apk = downloadedAPK();
        if (apk == null || !apk.isFile()) {
            call.reject("Downloaded APK is unavailable", "UPDATE_APK_MISSING");
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getContext().getPackageManager().canRequestPackageInstalls()) {
            JSObject result = new JSObject();
            result.put("launched", false);
            result.put("permissionRequired", true);
            call.resolve(result);
            return;
        }

        try {
            Uri apkURI = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                apk
            );
            Intent intent = new Intent(Intent.ACTION_VIEW)
                .setDataAndType(apkURI, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            JSObject result = new JSObject();
            result.put("launched", true);
            result.put("permissionRequired", false);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Unable to open Android package installer", "UPDATE_INSTALL_FAILED", error);
        }
    }

    @PluginMethod
    public void openInstallPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.resolve();
            return;
        }
        try {
            Intent intent = new Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + getContext().getPackageName())
            ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception error) {
            call.reject("Unable to open install permission settings", "UPDATE_PERMISSION_FAILED", error);
        }
    }

    private void downloadInBackground(PluginCall call, String source, String expectedSHA256, long expectedSize) {
        File directory = new File(getContext().getCacheDir(), "updates");
        File partial = new File(directory, "v2chat-update.apk.part");
        File complete = new File(directory, "v2chat-update.apk");
        HttpURLConnection connection = null;
        try {
            URL url = new URL(source);
            validateDownloadURL(url);
            if (!directory.exists() && !directory.mkdirs()) throw new IllegalStateException("Unable to create update directory");
            if (partial.exists() && !partial.delete()) throw new IllegalStateException("Unable to reset partial update");

            connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(20_000);
            connection.setReadTimeout(30_000);
            connection.setInstanceFollowRedirects(true);
            connection.setRequestProperty("Accept", "application/vnd.android.package-archive,application/octet-stream");
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) throw new IllegalStateException("Update server returned HTTP " + status);
            long contentLength = connection.getContentLengthLong();
            if (contentLength > 0 && contentLength != expectedSize) throw new IllegalStateException("APK size does not match release manifest");

            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            long transferred = 0;
            long lastProgressAt = 0;
            try (
                BufferedInputStream input = new BufferedInputStream(connection.getInputStream());
                FileOutputStream output = new FileOutputStream(partial)
            ) {
                byte[] buffer = new byte[64 * 1024];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    transferred += count;
                    if (transferred > expectedSize) throw new IllegalStateException("APK exceeds release manifest size");
                    output.write(buffer, 0, count);
                    digest.update(buffer, 0, count);
                    long now = System.currentTimeMillis();
                    if (now - lastProgressAt >= 200) {
                        emitProgress(transferred, expectedSize);
                        lastProgressAt = now;
                    }
                }
                output.getFD().sync();
            }

            if (transferred != expectedSize) throw new IllegalStateException("APK download is incomplete");
            String actualSHA256 = hex(digest.digest());
            if (!MessageDigest.isEqual(actualSHA256.getBytes(StandardCharsets.US_ASCII), expectedSHA256.getBytes(StandardCharsets.US_ASCII))) {
                throw new IllegalStateException("APK SHA-256 does not match release manifest");
            }
            if (complete.exists() && !complete.delete()) throw new IllegalStateException("Unable to replace previous update");
            if (!partial.renameTo(complete)) throw new IllegalStateException("Unable to finalize downloaded update");

            preferences().edit().putString(DOWNLOADED_APK, complete.getAbsolutePath()).apply();
            emitProgress(expectedSize, expectedSize);
            JSObject result = new JSObject();
            result.put("path", complete.getAbsolutePath());
            result.put("sha256", actualSHA256);
            result.put("sizeBytes", expectedSize);
            call.resolve(result);
        } catch (Exception error) {
            partial.delete();
            call.reject(error.getMessage(), "UPDATE_DOWNLOAD_FAILED", error);
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void validateDownloadURL(URL url) throws Exception {
        if ("https".equalsIgnoreCase(url.getProtocol())) return;
        boolean debuggable = (getContext().getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        boolean localDebug = debuggable && "http".equalsIgnoreCase(url.getProtocol()) && InetAddress.getByName(url.getHost()).isLoopbackAddress();
        if (!localDebug) throw new SecurityException("Release APK must use HTTPS");
    }

    private void emitProgress(long transferred, long total) {
        JSObject data = new JSObject();
        data.put("percent", total <= 0 ? 0 : Math.min(100, Math.round((transferred * 100f) / total)));
        data.put("transferred", transferred);
        data.put("total", total);
        notifyListeners("downloadProgress", data);
    }

    private File downloadedAPK() {
        String path = preferences().getString(DOWNLOADED_APK, null);
        return path == null ? null : new File(path);
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }

    private static String hex(byte[] bytes) {
        StringBuilder value = new StringBuilder(bytes.length * 2);
        for (byte current : bytes) value.append(String.format(Locale.ROOT, "%02x", current));
        return value.toString();
    }
}
