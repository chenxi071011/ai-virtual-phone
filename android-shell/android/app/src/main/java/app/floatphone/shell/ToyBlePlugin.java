package app.floatphone.shell;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.nio.charset.StandardCharsets;
import java.util.HashSet;

// 原生蓝牙直连玩具（先支持 Lovense 系）：扫描 → 连接 GATT → 写 "Vibrate:0~20;" 指令。
// 无需 Intiface / 无需填地址。JS 通过 Capacitor.nativePromise('ToyBle', ...) 调用。
@CapacitorPlugin(
    name = "ToyBle",
    permissions = {
        @Permission(alias = "bluetooth", strings = { Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT }),
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION })
    }
)
public class ToyBlePlugin extends Plugin {

    private BluetoothAdapter adapter;
    private BluetoothLeScanner scanner;
    private ScanCallback scanCallback;
    private BluetoothGatt gatt;
    private BluetoothGattCharacteristic txChar;
    private String protocol = "generic";   // lovense / svakom / ToyProtocols.TABLE 里的任意 id / generic
    private int maxVibe = 20;              // 当前协议的震动强度上限，见 ToyProtocols.Spec.maxVibe
    private final java.util.ArrayList<BluetoothGattCharacteristic> writables = new java.util.ArrayList<>();
    private static final java.util.UUID CCCD = java.util.UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");
    private final HashSet<String> seen = new HashSet<>();
    private final Handler main = new Handler(Looper.getMainLooper());
    private byte[] lastVibe = null, lastSuck = null;   // 保活重发的最后一包（震动/吮吸各一路）
    private BluetoothGattCharacteristic lastVibeChar = null, lastSuckChar = null;
    private final Runnable keepalive = new Runnable() {
        @Override public void run() {
            if (gatt != null && lastVibe != null) writeBytesTo(lastVibeChar != null ? lastVibeChar : txChar, lastVibe);
            if (gatt != null && lastSuck != null) writeBytesTo(lastSuckChar != null ? lastSuckChar : txChar, lastSuck);
            main.postDelayed(this, 1000);
        }
    };

    private BluetoothAdapter getAdapter() {
        if (adapter == null) {
            BluetoothManager bm = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
            if (bm != null) adapter = bm.getAdapter();
        }
        return adapter;
    }

    private boolean hasPerms() {
        if (Build.VERSION.SDK_INT >= 31) {
            return getPermissionState("bluetooth") == PermissionState.GRANTED;
        }
        return getPermissionState("location") == PermissionState.GRANTED;
    }

    @PluginMethod
    public void checkPerms(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", hasPerms());
        call.resolve(r);
    }

    @PluginMethod
    public void requestPerms(PluginCall call) {
        if (hasPerms()) { JSObject r = new JSObject(); r.put("granted", true); call.resolve(r); return; }
        String alias = (Build.VERSION.SDK_INT >= 31) ? "bluetooth" : "location";
        requestPermissionForAlias(alias, call, "permCb");
    }

    @PermissionCallback
    private void permCb(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", hasPerms());
        call.resolve(r);
    }

    private void emit(String type, JSObject extra) {
        JSObject ev = (extra != null) ? extra : new JSObject();
        ev.put("type", type);
        notifyListeners("bleEvent", ev, true);
    }

    @PluginMethod
    public void startScan(final PluginCall call) {
        if (!hasPerms()) { call.reject("no-permission"); return; }
        final BluetoothAdapter a = getAdapter();
        if (a == null || !a.isEnabled()) { call.reject("bluetooth-off"); return; }
        seen.clear();
        main.post(() -> {
            try {
                scanner = a.getBluetoothLeScanner();
                if (scanner == null) { call.reject("no-scanner"); return; }
                stopScanInternal();
                scanCallback = new ScanCallback() {
                    @Override public void onScanResult(int type, ScanResult result) {
                        BluetoothDevice d = result.getDevice();
                        String name = null;
                        try { name = d.getName(); } catch (SecurityException e) { return; }
                        if (name == null || name.trim().isEmpty()) return; // 只报有名字的设备
                        String addr = d.getAddress();
                        if (seen.contains(addr)) return;
                        seen.add(addr);
                        JSObject o = new JSObject();
                        o.put("name", name);
                        o.put("address", addr);
                        emit("device", o);
                    }
                };
                ScanSettings settings = new ScanSettings.Builder()
                    .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build();
                scanner.startScan(null, settings, scanCallback);
                call.resolve();
            } catch (SecurityException e) { call.reject("no-permission"); }
            catch (Exception e) { call.reject(e.getMessage()); }
        });
    }

    private void stopScanInternal() {
        try { if (scanner != null && scanCallback != null) scanner.stopScan(scanCallback); } catch (Exception ignored) {}
        scanCallback = null;
    }

    @PluginMethod
    public void stopScan(PluginCall call) {
        main.post(this::stopScanInternal);
        call.resolve();
    }

    @PluginMethod
    public void connect(final PluginCall call) {
        final String address = call.getString("address");
        if (address == null) { call.reject("no-address"); return; }
        if (!hasPerms()) { call.reject("no-permission"); return; }
        final BluetoothAdapter a = getAdapter();
        if (a == null) { call.reject("no-adapter"); return; }
        main.post(() -> {
            try {
                stopScanInternal();
                closeGatt();
                BluetoothDevice dev = a.getRemoteDevice(address);
                gatt = dev.connectGatt(getContext(), false, gattCallback, BluetoothDevice.TRANSPORT_LE);
                call.resolve();
            } catch (SecurityException e) { call.reject("no-permission"); }
            catch (Exception e) { call.reject(e.getMessage()); }
        });
    }

    private final BluetoothGattCallback gattCallback = new BluetoothGattCallback() {
        @Override public void onConnectionStateChange(BluetoothGatt g, int status, int newState) {
            if (newState == BluetoothGatt.STATE_CONNECTED) {
                try { g.discoverServices(); } catch (SecurityException ignored) {}
            } else if (newState == BluetoothGatt.STATE_DISCONNECTED) {
                txChar = null;
                emit("disconnected", null);
            }
        }
        @Override public void onCharacteristicWrite(BluetoothGatt g, BluetoothGattCharacteristic c, int status) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                JSObject o = new JSObject(); o.put("msg", "写入失败 status=" + status + " (" + c.getUuid() + ")"); emit("log", o);
            }
        }
        @Override public void onServicesDiscovered(BluetoothGatt g, int status) {
            dumpGatt(g);
            detectDevice(g);
            enableNotifications(g);
            JSObject o = new JSObject();
            o.put("protocol", protocol);
            if (txChar != null) o.put("tx", txChar.getUuid().toString());
            if (txChar != null) {
                try { o.put("name", g.getDevice().getName()); } catch (Exception ignored) {}
                lastVibe = null;
                main.removeCallbacks(keepalive);
                main.postDelayed(keepalive, 1000);   // 启动保活
                emit("connected", o);
            } else {
                o.put("reason", "未找到可写特征值（可能不是支持的设备）");
                emit("error", o);
                closeGatt();
            }
        }
    };

    // 把发现的服务/特征打到日志，便于给未知设备（如司沃康）对协议
    private void dumpGatt(BluetoothGatt g) {
        if (g == null) return;
        writables.clear();
        StringBuilder sb = new StringBuilder("GATT:\n");
        for (BluetoothGattService s : g.getServices()) {
            sb.append("SVC ").append(s.getUuid().toString()).append("\n");
            for (BluetoothGattCharacteristic c : s.getCharacteristics()) {
                int p = c.getProperties();
                StringBuilder f = new StringBuilder();
                if ((p & BluetoothGattCharacteristic.PROPERTY_WRITE) != 0) f.append("W");
                if ((p & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0) f.append("w");
                if ((p & BluetoothGattCharacteristic.PROPERTY_NOTIFY) != 0) f.append("N");
                if ((p & BluetoothGattCharacteristic.PROPERTY_READ) != 0) f.append("R");
                String idx = "";
                if (isWritable(c)) { idx = "idx=" + writables.size() + " "; writables.add(c); }
                sb.append("  chr ").append(idx).append(c.getUuid().toString()).append(" [").append(f).append("]\n");
            }
        }
        JSObject o = new JSObject();
        o.put("msg", sb.toString());
        emit("log", o);
    }

    // 订阅所有通知特征（不少玩具需要先订阅才肯接受指令）
    private void enableNotifications(BluetoothGatt g) {
        if (g == null) return;
        for (BluetoothGattService s : g.getServices()) {
            for (BluetoothGattCharacteristic c : s.getCharacteristics()) {
                if ((c.getProperties() & BluetoothGattCharacteristic.PROPERTY_NOTIFY) == 0) continue;
                try {
                    g.setCharacteristicNotification(c, true);
                    android.bluetooth.BluetoothGattDescriptor d = c.getDescriptor(CCCD);
                    if (d != null) {
                        if (Build.VERSION.SDK_INT >= 33) {
                            g.writeDescriptor(d, android.bluetooth.BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
                        } else {
                            d.setValue(android.bluetooth.BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
                            g.writeDescriptor(d);
                        }
                    }
                } catch (Exception ignored) {}
            }
        }
    }

    private static boolean isWritable(BluetoothGattCharacteristic c) {
        int props = c.getProperties();
        return (props & BluetoothGattCharacteristic.PROPERTY_WRITE) != 0
                || (props & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0;
    }

    private BluetoothGattCharacteristic findWritable(BluetoothGatt g, String uuidPrefix) {
        for (BluetoothGattService s : g.getServices()) {
            for (BluetoothGattCharacteristic c : s.getCharacteristics()) {
                if (isWritable(c) && c.getUuid().toString().toLowerCase().startsWith(uuidPrefix)) return c;
            }
        }
        return null;
    }

    // 按服务 UUID / 广播名识别品牌协议，并选出可写特征值
    private void detectDevice(BluetoothGatt g) {
        protocol = "generic"; txChar = null; maxVibe = 20;
        if (g == null) return;
        String name = "";
        try { name = g.getDevice().getName(); if (name == null) name = ""; } catch (Exception e) {}
        String nl = name.toLowerCase();

        // 1) 司沃康（SX589A 等）：走 ffe0/ffe1，但指令格式与 ToyProtocols 里的 svakom-v2 不同，
        //    这条是实测跑通的路径，必须排在协议表前面，别被表里的通用规则截胡。
        boolean svakomName = nl.matches("^(sx|bx|hx|vx|va|vv|dg|dj|dt|qh|swk|s63e).*")
                || nl.contains("svakom") || nl.contains("pulse") || nl.contains("neo") || nl.contains("aogu");
        if (svakomName) {
            BluetoothGattCharacteristic t = findWritable(g, "0000ffe1");
            if (t == null) t = findWritable(g, "0000ae01");
            if (t != null) { protocol = "svakom"; txChar = t; return; }
        }

        // 2) Lovense：几十个服务 UUID 变体都以这段厂商后缀结尾，一条判据全覆盖。
        //    注意不能把 0000fff0 也算成 Lovense——那是 ZALO/Leten/Picobong/LELO 共用的短 UUID。
        for (BluetoothGattService s : g.getServices()) {
            if (!s.getUuid().toString().toLowerCase().contains("4bd4-bbd5-a6920e4c5653")) continue;
            for (BluetoothGattCharacteristic c : s.getCharacteristics()) {
                if (isWritable(c)) { protocol = "lovense"; txChar = c; maxVibe = 20; return; }
            }
        }

        // 3) 协议表：以「服务 UUID + 写特征 UUID」为主键，UUID 撞车的再用广播名消歧
        ToyProtocols.Match m = ToyProtocols.match(g, name);
        if (m != null) {
            protocol = m.spec.id; txChar = m.tx; maxVibe = m.spec.maxVibe;
            return;
        }

        // 4) 都不认识：挑一个可写特征试试 Lovense 的 ASCII 指令（encodeVibrate 的 default 分支）。
        //    多数设备不吃这一套，但比什么都不做强，日志里也已经 dump 了完整 GATT 便于补协议。
        //    协议名特意报成 unknown 而不是 lovense——否则用户分不清是真识别出来了还是在猜。
        for (BluetoothGattService s : g.getServices()) {
            for (BluetoothGattCharacteristic c : s.getCharacteristics()) {
                if (isWritable(c)) { txChar = c; protocol = "unknown"; maxVibe = 20; return; }
            }
        }
    }

    @PluginMethod
    public void vibrate(PluginCall call) {
        Double level = call.getDouble("level");
        if (level == null) level = 0.0;
        double lv = Math.max(0, Math.min(1, level));
        byte[] pkt;
        if ("svakom".equals(protocol)) {
            int v = (int) Math.round(lv * 255);         // Svakom SX589A 震动=平滑强度 0-255（手动操控通道）
            pkt = new byte[]{ 0x55, 0x04, 0x00, 0x00, 0x00, (byte) v, (byte) 0xaa };
        } else {
            pkt = ToyProtocols.encodeVibrate(protocol, lv, maxVibe);
        }
        lastVibe = pkt; lastVibeChar = txChar;          // 供保活重发
        writeBytes(pkt);
        call.resolve();
    }

    // 全部停止（清空保活 + 发关闭指令）
    @PluginMethod
    public void stopAll(PluginCall call) {
        lastVibe = null; lastVibeChar = null; lastSuck = null; lastSuckChar = null;
        if ("svakom".equals(protocol)) {
            writeBytesTo(txChar, new byte[]{ 0x55, 0x04, 0x00, 0x00, 0x00, 0x00, (byte) 0xaa }); // 震动强度0
            writeBytesTo(txChar, new byte[]{ 0x55, 0x09, 0x00, 0x00, 0x00, 0x00, 0x00 });        // 吮吸关
            writeBytesTo(txChar, new byte[]{ 0x55, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00 });        // 总关
        } else {
            // 各协议"停"的格式不同，交给 encodeVibrate(level=0) 统一处理
            writeBytesTo(txChar, ToyProtocols.encodeVibrate(protocol, 0, maxVibe));
        }
        call.resolve();
    }

    // 吮吸控制（目前 Svakom：55 09 00 00 [on][lvl] 00）
    @PluginMethod
    public void suck(PluginCall call) {
        Double level = call.getDouble("level");
        if (level == null) level = 0.0;
        double lv = Math.max(0, Math.min(1, level));
        int v = (int) Math.round(lv * 8);               // 吮吸档位 0-8
        byte[] pkt;
        if ("svakom".equals(protocol)) {
            pkt = new byte[]{ 0x55, 0x09, 0x00, 0x00, (byte) (v == 0 ? 0 : 1), (byte) v, 0x00 };
        } else {
            call.resolve(); return;   // 其它协议暂不支持吮吸
        }
        lastSuck = pkt; lastSuckChar = txChar;
        writeBytesTo(txChar, pkt);
        call.resolve();
    }

    // 灯光控制（目前 Lovense：Light:1/0;）
    @PluginMethod
    public void light(PluginCall call) {
        Boolean on = call.getBoolean("on");
        if (on == null) on = true;
        if ("lovense".equals(protocol)) {
            writeBytes(("Light:" + (on ? 1 : 0) + ";").getBytes(StandardCharsets.UTF_8));
        }
        call.resolve();
    }

    private void writeCmd(String cmd) {
        writeBytes(cmd.getBytes(StandardCharsets.UTF_8));
    }

    // 调试：直接写入任意十六进制指令到写特征值（用于对未知设备的协议）
    @PluginMethod
    public void writeRaw(PluginCall call) {
        String hex = call.getString("hex");
        if (hex == null) { call.reject("no-hex"); return; }
        hex = hex.replaceAll("[^0-9a-fA-F]", "");
        if (hex.length() == 0 || hex.length() % 2 != 0) { call.reject("bad-hex"); return; }
        byte[] bytes = new byte[hex.length() / 2];
        for (int i = 0; i < bytes.length; i++) {
            bytes[i] = (byte) Integer.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
        }
        Integer idx = call.getInt("index");
        BluetoothGattCharacteristic c = (idx != null && idx >= 0 && idx < writables.size()) ? writables.get(idx) : txChar;
        lastVibe = bytes; lastVibeChar = c;        // 让保活持续重发这条（司沃康等需要重发才生效）
        writeBytesTo(c, bytes);
        JSObject o = new JSObject(); o.put("msg", "已发送 " + hex + " → 特征" + (idx != null ? ("#" + idx) : "(默认)")); emit("log", o);
        call.resolve();
    }

    private void writeBytes(final byte[] bytes) {
        writeBytesTo(txChar, bytes);
    }

    private void writeBytesTo(final BluetoothGattCharacteristic c, final byte[] bytes) {
        final BluetoothGatt g = gatt;
        if (g == null || c == null) return;
        main.post(() -> {
            try {
                int writeType = ((c.getProperties() & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0)
                        ? BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
                        : BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT;
                if (Build.VERSION.SDK_INT >= 33) {
                    g.writeCharacteristic(c, bytes, writeType);
                } else {
                    c.setWriteType(writeType);
                    c.setValue(bytes);
                    g.writeCharacteristic(c);
                }
            } catch (SecurityException ignored) {}
            catch (Exception ignored) {}
        });
    }

    private void closeGatt() {
        main.removeCallbacks(keepalive);
        lastVibe = null; lastVibeChar = null; lastSuck = null; lastSuckChar = null;
        try { if (gatt != null) { gatt.disconnect(); gatt.close(); } } catch (Exception ignored) {}
        gatt = null; txChar = null;
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        main.post(this::closeGatt);
        call.resolve();
    }

    @PluginMethod
    public void isConnected(PluginCall call) {
        JSObject r = new JSObject();
        r.put("connected", gatt != null && txChar != null);
        call.resolve(r);
    }
}
