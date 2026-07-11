package top.v2api.v2chat;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "V2ChatSecureStorage")
public class V2ChatSecureStoragePlugin extends Plugin {
    private static final String KEY_ALIAS = "v2chat.credentials.v1";
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String PREFERENCES = "v2chat_secure_credentials";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int TAG_LENGTH_BITS = 128;

    @PluginMethod
    public void get(PluginCall call) {
        String key = required(call, "key");
        if (key == null) return;

        String encrypted = preferences().getString(key, null);
        JSObject result = new JSObject();
        if (encrypted == null) {
            result.put("value", JSObject.NULL);
            call.resolve(result);
            return;
        }

        try {
            result.put("value", decrypt(encrypted));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Unable to decrypt secure credential", "SECURE_STORAGE_DECRYPT_FAILED", error);
        }
    }

    @PluginMethod
    public void set(PluginCall call) {
        String key = required(call, "key");
        String value = required(call, "value");
        if (key == null || value == null) return;

        try {
            preferences().edit().putString(key, encrypt(value)).apply();
            call.resolve();
        } catch (Exception error) {
            call.reject("Unable to encrypt secure credential", "SECURE_STORAGE_ENCRYPT_FAILED", error);
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String key = required(call, "key");
        if (key == null) return;
        preferences().edit().remove(key).apply();
        call.resolve();
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }

    private String required(PluginCall call, String field) {
        String value = call.getString(field);
        if (value == null || value.isEmpty()) {
            call.reject(field + " is required", "SECURE_STORAGE_INVALID_ARGUMENT");
            return null;
        }
        return value;
    }

    private String encrypt(String plaintext) throws Exception {
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
        byte[] ciphertext = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
        byte[] iv = cipher.getIV();
        ByteBuffer payload = ByteBuffer.allocate(Integer.BYTES + iv.length + ciphertext.length);
        payload.putInt(iv.length);
        payload.put(iv);
        payload.put(ciphertext);
        return Base64.encodeToString(payload.array(), Base64.NO_WRAP);
    }

    private String decrypt(String encoded) throws Exception {
        ByteBuffer payload = ByteBuffer.wrap(Base64.decode(encoded, Base64.NO_WRAP));
        int ivLength = payload.getInt();
        if (ivLength < 12 || ivLength > 16 || payload.remaining() <= ivLength) {
            throw new IllegalArgumentException("Invalid encrypted credential");
        }
        byte[] iv = new byte[ivLength];
        payload.get(iv);
        byte[] ciphertext = new byte[payload.remaining()];
        payload.get(ciphertext);

        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(TAG_LENGTH_BITS, iv));
        return new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8);
    }

    private SecretKey getOrCreateKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(KEYSTORE);
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) {
            return ((KeyStore.SecretKeyEntry) keyStore.getEntry(KEY_ALIAS, null)).getSecretKey();
        }

        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(
            new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build()
        );
        return generator.generateKey();
    }
}
