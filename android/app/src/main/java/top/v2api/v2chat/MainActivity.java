package top.v2api.v2chat;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(V2ChatSecureStoragePlugin.class);
        registerPlugin(V2ChatUpdaterPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
