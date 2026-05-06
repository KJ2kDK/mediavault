package cloud.baseinthe.mediavault;

import android.content.Intent;
import android.net.Uri;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Hands a stream URL off to a native Android video player (MX Player / VLC /
 * system default) via ACTION_VIEW. The native player handles MKV/DTS/etc.
 * directly — no server-side transcode, instant seek.
 */
@CapacitorPlugin(name = "NativePlayer")
public class NativePlayerPlugin extends Plugin {

    @PluginMethod
    public void play(PluginCall call) {
        String url = call.getString("url");
        String title = call.getString("title", "MediaVault");

        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }

        Log.i("NativePlayer", "Launching external player for: " + url);

        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(Uri.parse(url), "video/*");
        intent.putExtra("title", title);
        intent.putExtra(Intent.EXTRA_TITLE, title);
        // MX Player specific: show title in player UI
        intent.putExtra("secure_uri", true);
        intent.putExtra("return_result", true);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

        try {
            // Prefer MX Player Pro if installed, otherwise let user pick.
            Intent explicit = new Intent(intent);
            explicit.setPackage("com.mxtech.videoplayer.pro");
            if (getContext().getPackageManager().resolveActivity(explicit, 0) != null) {
                getContext().startActivity(explicit);
            } else {
                Intent chooser = Intent.createChooser(intent, "Play with");
                chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(chooser);
            }
            JSObject ret = new JSObject();
            ret.put("launched", true);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e("NativePlayer", "Failed to launch player", e);
            call.reject("Failed to launch player: " + e.getMessage());
        }
    }
}
