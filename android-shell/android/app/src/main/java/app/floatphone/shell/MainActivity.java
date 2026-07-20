package app.floatphone.shell;

import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ToyBlePlugin.class);
        super.onCreate(savedInstanceState);

        // 筑境(World Builder)里的 Three.js/WebGL 场景比较重，部分机型上会把 WebView 的
        // 渲染进程压垮。系统对 onRenderProcessGone 默认不处理的话，行为就是整个 App 进程
        // 被杀掉重启——这正是"打开筑境直接闪退回到开屏动画"的根因。这里接管这个回调，
        // 只销毁重建 WebView 本身，不让整个 Activity/进程被杀。
        WebView webView = getBridge().getWebView();
        webView.setWebViewClient(new BridgeWebViewClient(getBridge()) {
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                if (view.getParent() instanceof ViewGroup) {
                    ((ViewGroup) view.getParent()).removeView(view);
                }
                view.destroy();
                recreate();
                return true;
            }
        });
    }
}
