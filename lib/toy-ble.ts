import { Capacitor, registerPlugin } from "@capacitor/core";

// 原生蓝牙直连情趣玩具（Lovense / We-Vibe / Svakom / 通用），移植自旧项目的 ToyBle 原生插件。
// Web 端（非 App 内）没有这个原生插件，所有方法在那种环境下会静默失败/返回未连接。

export type ToyDevice = { name: string; address: string };
export type ToyPattern = "constant" | "wave" | "pulse" | "ramp" | "stop";

export const TOY_PATTERN_LABELS: Record<string, string> = {
    constant: "恒定", wave: "波浪", pulse: "脉冲", ramp: "渐强", stop: "停止",
};

// 统一的展示文案：聊天气泡、会话预览、语音/视频通话字幕等所有渲染路径共用同一份措辞。
export function formatToyControlNotice(pattern: string, intensity: number, charName: string): string {
    if (pattern === "stop" || intensity <= 0) return `${charName} 停下了玩具`;
    const label = TOY_PATTERN_LABELS[pattern] || pattern;
    return `${charName} 正在控制玩具（${label} · ${intensity}%）`;
}

export function formatToyGrantNotice(granted: boolean, charName: string): string {
    return granted ? `你把玩具控制权交给了${charName}` : "你收回了玩具的控制权";
}

type BleEvent =
    | { type: "device"; name: string; address: string }
    | { type: "log"; msg: string }
    | { type: "connected"; protocol: string; tx?: string; name?: string }
    | { type: "disconnected" }
    | { type: "error"; reason?: string };

interface ToyBlePluginIface {
    checkPerms(): Promise<{ granted: boolean }>;
    requestPerms(): Promise<{ granted: boolean }>;
    startScan(): Promise<void>;
    stopScan(): Promise<void>;
    connect(opts: { address: string }): Promise<void>;
    disconnect(): Promise<void>;
    isConnected(): Promise<{ connected: boolean }>;
    vibrate(opts: { level: number }): Promise<void>;
    suck(opts: { level: number }): Promise<void>;
    light(opts: { on: boolean }): Promise<void>;
    stopAll(): Promise<void>;
    writeRaw(opts: { hex: string; index?: number }): Promise<void>;
    addListener(eventName: "bleEvent", listenerFunc: (ev: BleEvent) => void): Promise<{ remove: () => void }>;
}

const ToyBle = registerPlugin<ToyBlePluginIface>("ToyBle");

export function isToySupported(): boolean {
    return Capacitor.isNativePlatform();
}

const MAX_DURATION_S = 30;       // 单条指令最大持续秒数（安全上限）
const MIN_SEND_INTERVAL_MS = 100; // 两条指令最小间隔（蓝牙友好限流）

type Listener = () => void;

class ToyController {
    devices: ToyDevice[] = [];
    connected = false;
    protocol = "generic";
    deviceName = "";
    currentIntensity = 0;
    maxIntensity = 80;
    jitterEnabled = true;
    jitterScale = 1;

    private patternTimer: ReturnType<typeof setInterval> | null = null;
    private lastSentLevel = -1;
    private lastSendTime = 0;
    private trailingTimer: ReturnType<typeof setTimeout> | null = null;
    private baseFn: ((t: number) => number) | null = null;
    private baseStart = 0;
    private jitterState = 0;
    private listeners = new Set<Listener>();
    private bleListenerAttached = false;

    subscribe(fn: Listener): () => void {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }
    private emit() {
        for (const fn of this.listeners) fn();
    }

    private ensureListener() {
        if (this.bleListenerAttached || !isToySupported()) return;
        this.bleListenerAttached = true;
        ToyBle.addListener("bleEvent", (ev) => {
            if (ev.type === "device") {
                if (!this.devices.find((d) => d.address === ev.address)) {
                    this.devices.push({ name: ev.name, address: ev.address });
                    this.emit();
                }
            } else if (ev.type === "connected") {
                this.connected = true;
                this.protocol = ev.protocol || "generic";
                this.deviceName = ev.name || "玩具";
                this.emit();
            } else if (ev.type === "disconnected") {
                this.connected = false;
                this.stopPattern();
                this.emit();
            } else if (ev.type === "error") {
                this.emit();
            }
        }).catch(() => {});
    }

    async scan(): Promise<{ ok: boolean; reason?: string }> {
        if (!isToySupported()) return { ok: false, reason: "unsupported" };
        this.ensureListener();
        try {
            const p = await ToyBle.requestPerms();
            if (!p?.granted) return { ok: false, reason: "no-permission" };
        } catch {
            return { ok: false, reason: "no-permission" };
        }
        this.devices = [];
        this.emit();
        try {
            await ToyBle.startScan();
        } catch (e) {
            return { ok: false, reason: (e as { message?: string })?.message || "scan-failed" };
        }
        setTimeout(() => { ToyBle.stopScan().catch(() => {}); }, 8000);
        return { ok: true };
    }

    async connectTo(address: string): Promise<{ ok: boolean; reason?: string }> {
        if (!isToySupported()) return { ok: false, reason: "unsupported" };
        this.ensureListener();
        try { await ToyBle.stopScan(); } catch { /* ignore */ }
        try {
            await ToyBle.connect({ address });
            return { ok: true };
        } catch (e) {
            return { ok: false, reason: (e as { message?: string })?.message || "connect-failed" };
        }
    }

    async disconnect(): Promise<void> {
        try { await ToyBle.disconnect(); } catch { /* ignore */ }
        this.connected = false;
        this.stopPattern();
        this.emit();
    }

    async light(on: boolean): Promise<void> {
        if (!this.connected) return;
        try { await ToyBle.light({ on }); } catch { /* ignore */ }
    }

    async suck(level01: number): Promise<void> {
        if (!this.connected) return;
        try { await ToyBle.suck({ level: Math.max(0, Math.min(1, level01)) }); } catch { /* ignore */ }
    }

    isConnected(): boolean {
        return this.connected;
    }

    // JS 端的 connected 只在"本次会话里亲眼看到 connected 事件"时才会置 true。
    // 但原生 GATT 连接在 WebView 整页重载（导航、崩溃重启、重新打开 App）后依然存活，
    // JS 单例却会被重新构造成 connected=false，导致明明物理上还连着，AI 提示词却拿不到授权。
    // 用原生的 isConnected() 主动对一次账，把 JS 状态掰回真实值。
    async syncConnectionState(): Promise<void> {
        if (!isToySupported()) return;
        this.ensureListener();
        try {
            const r = await ToyBle.isConnected();
            if (r?.connected && !this.connected) {
                this.connected = true;
                if (!this.deviceName) this.deviceName = "玩具";
                this.emit();
            } else if (!r?.connected && this.connected) {
                this.connected = false;
                this.stopPattern();
                this.emit();
            }
        } catch { /* 插件不可用时静默忽略 */ }
    }

    private clamp100(n: number): number {
        return Math.max(0, Math.min(this.maxIntensity, Math.round(n || 0)));
    }

    private pushLevel(level: number) {
        level = Math.max(0, Math.min(100, Math.round(level)));
        this.currentIntensity = level;
        this.emit();
        if (level === this.lastSentLevel) return; // 去重
        const now = Date.now();
        const wait = MIN_SEND_INTERVAL_MS - (now - this.lastSendTime);
        if (wait <= 0) {
            this.lastSentLevel = level;
            this.lastSendTime = now;
            if (this.trailingTimer) { clearTimeout(this.trailingTimer); this.trailingTimer = null; }
            if (this.connected) ToyBle.vibrate({ level: level / 100 }).catch(() => {});
        } else {
            if (this.trailingTimer) clearTimeout(this.trailingTimer);
            this.trailingTimer = setTimeout(() => { this.trailingTimer = null; this.pushLevel(level); }, wait);
        }
    }

    private clearTimers() {
        if (this.patternTimer) { clearInterval(this.patternTimer); this.patternTimer = null; }
        if (this.trailingTimer) { clearTimeout(this.trailingTimer); this.trailingTimer = null; }
    }

    stopPattern(): void {
        this.clearTimers();
        this.baseFn = null;
        this.jitterState = 0;
        this.currentIntensity = 0;
        this.lastSentLevel = 0;
        this.lastSendTime = Date.now();
        if (this.connected) ToyBle.vibrate({ level: 0 }).catch(() => {});
        this.emit();
    }

    // 拟真手抖：均值回归随机游走 + 高频微抖，幅度随强度增大
    private applyJitter(base: number): number {
        const maxDev = Math.max(2, base * 0.144);
        this.jitterState += (Math.random() - 0.5) * maxDev * 1.1;
        if (Math.random() < 0.08) this.jitterState += (Math.random() - 0.5) * maxDev * 1.6;
        this.jitterState *= 0.82;
        this.jitterState = Math.max(-maxDev, Math.min(maxDev, this.jitterState));
        const micro = (Math.random() - 0.5) * (base * 0.03);
        return Math.max(0, Math.min(100, base + (this.jitterState + micro) * this.jitterScale));
    }

    private engineTick() {
        if (!this.baseFn) return;
        const t = (Date.now() - this.baseStart) / 1000;
        const base = Math.max(0, Math.min(100, this.baseFn(t)));
        const out = (this.jitterEnabled && base > 0.5) ? this.applyJitter(base) : base;
        this.pushLevel(out);
    }

    private startEngine(fn: (t: number) => number) {
        this.baseStart = Date.now();
        this.jitterState = 0;
        this.baseFn = fn;
        this.engineTick();
        if (!this.patternTimer) this.patternTimer = setInterval(() => this.engineTick(), 150);
    }

    manualVibe(percent: number): void {
        const target = Math.max(0, Math.min(100, percent));
        if (target <= 0) { this.stopPattern(); return; }
        this.startEngine(() => target);
    }

    // 恒定保持 / 渐强到顶后保持 / 波浪与脉冲持续循环 —— 直到下一条指令或急停
    play(pattern: ToyPattern, intensity: number, durationSeconds: number): void {
        this.stopPattern();
        const target = this.clamp100(intensity);
        const dur = Math.max(0.2, Math.min(MAX_DURATION_S, durationSeconds || 3));
        if (pattern === "stop" || target <= 0) { this.stopPattern(); return; }
        let fn: (t: number) => number;
        if (pattern === "wave") fn = (t) => target * (0.5 - 0.5 * Math.cos(t * Math.PI));
        else if (pattern === "pulse") fn = (t) => (Math.floor(t * 2) % 2 === 0 ? target : 0);
        else if (pattern === "ramp") fn = (t) => target * Math.min(1, t / dur);
        else fn = () => target;
        this.startEngine(fn);
    }

    async emergencyStop(): Promise<void> {
        this.stopPattern();
        if (this.connected) { try { await ToyBle.stopAll(); } catch { /* ignore */ } }
    }
}

export const toyController = new ToyController();

// 共享的"检测并实施"入口：任何解析出 mediaType==="toy_control" 的消息 part，
// 不管来自哪种聊天模式（普通聊天/语音通话/视频通话/群聊等），都应该走这里统一判定授权后驱动设备。
export function maybeExecuteToyControlPart(
    part: { mediaType?: string; mediaData?: { toyPattern?: ToyPattern; toyIntensity?: number; toyDuration?: number } },
    authorized: boolean,
): void {
    if (part.mediaType !== "toy_control" || !part.mediaData?.toyPattern) return;
    if (!authorized) return;
    toyController.play(part.mediaData.toyPattern, part.mediaData.toyIntensity ?? 0, part.mediaData.toyDuration ?? 3);
}
