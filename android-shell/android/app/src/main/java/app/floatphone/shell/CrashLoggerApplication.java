package app.floatphone.shell;

import android.app.Application;
import android.os.Environment;
import android.util.Log;

import java.io.File;
import java.io.FileWriter;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * 上次内嵌 Node 运行时那次尝试，因为拿不到崩溃现场（小米国行 USB 调试被锁）排查不下去。
 * 这里加一个全局未捕获异常兜底：崩溃时把堆栈写进手机存储里一个文本文件，用文件管理器
 * 就能翻出来发出去，不用每次都现搭 adb。写完之后仍然交给系统默认处理器，行为不变
 * （该弹的"应用已停止"还是照常弹，不吞异常）。
 */
public class CrashLoggerApplication extends Application {
    private static final String TAG = "CrashLogger";

    @Override
    public void onCreate() {
        super.onCreate();
        final Thread.UncaughtExceptionHandler previousHandler = Thread.getDefaultUncaughtExceptionHandler();
        final File logDir = new File(getExternalFilesDir(null), "crash-logs");

        Thread.setDefaultUncaughtExceptionHandler((thread, throwable) -> {
            try {
                writeCrashLog(logDir, thread, throwable);
            } catch (Throwable loggingFailure) {
                Log.e(TAG, "写崩溃日志失败", loggingFailure);
            }
            if (previousHandler != null) {
                previousHandler.uncaughtException(thread, throwable);
            }
        });
    }

    private void writeCrashLog(File logDir, Thread thread, Throwable throwable) throws Exception {
        if (!logDir.exists() && !logDir.mkdirs()) {
            Log.e(TAG, "无法创建崩溃日志目录: " + logDir);
            return;
        }
        String timestamp = new SimpleDateFormat("yyyy-MM-dd_HH-mm-ss", Locale.US).format(new Date());
        File logFile = new File(logDir, "crash-" + timestamp + ".txt");

        StringWriter stackTrace = new StringWriter();
        throwable.printStackTrace(new PrintWriter(stackTrace));

        try (FileWriter writer = new FileWriter(logFile)) {
            writer.write("时间: " + timestamp + "\n");
            writer.write("线程: " + thread.getName() + "\n");
            writer.write("系统: Android " + android.os.Build.VERSION.RELEASE
                    + " (API " + android.os.Build.VERSION.SDK_INT + "), "
                    + android.os.Build.MANUFACTURER + " " + android.os.Build.MODEL + "\n");
            writer.write("外部存储状态: " + Environment.getExternalStorageState() + "\n\n");
            writer.write(stackTrace.toString());
        }
        Log.e(TAG, "崩溃日志已写入: " + logFile.getAbsolutePath());
    }
}
