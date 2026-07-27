package app.floatphone.shell;

import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ToyBlePlugin.class);
        super.onCreate(savedInstanceState);
        applyImmersiveFullscreen();

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

    // 之前全屏靠网页里的 JS Fullscreen API（用户点一下屏幕才触发，还得先靠
    // matchMedia 猜"这是不是手机小屏"），在不少机型/WebView 版本上要么猜错、
    // 要么 WebView 根本不响应 requestFullscreen，表现为"能看到模拟的手机边框，
    // 但怎么点都进不了全屏"。这个 App 只会装在手机上跑，不存在"要不要模拟边框"
    // 的问题，直接在 Activity 层面把系统状态栏/导航栏隐藏掉、内容延伸到全屏，
    // 不依赖网页那边的检测或用户手势。
    private void applyImmersiveFullscreen() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (controller != null) {
            controller.hide(WindowInsetsCompat.Type.systemBars());
            controller.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            );
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // 系统栏可能因为下拉通知栏、切后台再回来等操作被系统重新弹出，
        // Activity 重新获得焦点时补一次，保持常驻全屏。
        if (hasFocus) {
            applyImmersiveFullscreen();
        }
    }
}
