"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, Bluetooth, BluetoothConnected, OctagonX, HeartPulse, Lightbulb } from "lucide-react";
import { loadCharacters, saveCharacters } from "@/lib/character-storage";
import type { Character } from "@/lib/character-types";
import { toyController, isToySupported, formatToyGrantNotice, type ToyDevice } from "@/lib/toy-ble";
import { createOrGetSession, pushChatMessage } from "@/lib/chat-storage";

type Props = { onClose: () => void };

export default function ToyDeviceApp({ onClose }: Props) {
    const [, forceTick] = useState(0);
    const [scanning, setScanning] = useState(false);
    const [statusText, setStatusText] = useState("未连接");
    const [manualLevel, setManualLevel] = useState(0);
    const [suckLevel, setSuckLevel] = useState(0);
    const [lightOn, setLightOn] = useState(false);
    const [characters, setCharacters] = useState<Character[]>([]);

    useEffect(() => {
        setCharacters(loadCharacters());
        const unsub = toyController.subscribe(() => forceTick(t => t + 1));
        return unsub;
    }, []);

    useEffect(() => {
        if (toyController.connected) setStatusText(`已连接：${toyController.deviceName || "玩具"}`);
        else setStatusText("未连接");
    }, [toyController.connected, toyController.deviceName]);

    // 没匹配上协议时是拿 Lovense 的指令格式在猜，多半不会有反应——说清楚，
    // 免得用户以为是设备坏了或者应用有 bug。
    const protocolText = toyController.protocol === "unknown"
        ? "未能识别型号，正在按通用指令尝试"
        : `协议：${toyController.protocol}`;

    const handleScan = useCallback(async () => {
        setScanning(true);
        setStatusText("扫描中…");
        const res = await toyController.scan();
        if (!res.ok) {
            setStatusText(res.reason === "no-permission" ? "需要蓝牙权限" : res.reason === "unsupported" ? "该功能仅在 App 内可用" : "扫描失败");
        } else {
            setStatusText("扫描中…（8 秒）");
        }
        setTimeout(() => setScanning(false), 8000);
    }, []);

    const handleConnect = useCallback(async (device: ToyDevice) => {
        setStatusText(`连接中… ${device.name}`);
        const res = await toyController.connectTo(device.address);
        if (!res.ok) setStatusText("连接失败");
    }, []);

    const handleDisconnect = useCallback(async () => {
        await toyController.disconnect();
        setStatusText("未连接");
    }, []);

    const handleManualChange = useCallback((v: number) => {
        setManualLevel(v);
        if (toyController.connected) toyController.manualVibe(v);
    }, []);

    const handleSuckChange = useCallback((v: number) => {
        setSuckLevel(v);
        toyController.suck(v / 100);
    }, []);

    const handleLightToggle = useCallback(() => {
        const next = !lightOn;
        setLightOn(next);
        toyController.light(next);
    }, [lightOn]);

    const toggleGrant = useCallback((characterId: string, enabled: boolean) => {
        const all = loadCharacters();
        const target = all.find(c => c.id === characterId);
        if (!target) return;
        target.toyControlEnabled = enabled;
        saveCharacters(all);
        setCharacters([...all]);
        if (!enabled) toyController.emergencyStop();
        // 授予/收回时发一张卡片到该角色的聊天记录里，让 AI 也能感知到这件事（同 jrsy 的悬浮球面板行为）
        const session = createOrGetSession(characterId);
        pushChatMessage({
            sessionId: session.id,
            role: "user",
            content: formatToyGrantNotice(enabled, target.name),
            mediaType: "toy_grant",
            mediaData: { toyGranted: enabled },
        });
    }, []);

    const grantedIds = new Set(characters.filter(c => c.toyControlEnabled).map(c => c.id));

    return (
        <div className="toy-device-app">
            <header className="toy-dev-header">
                <button className="toy-dev-back" onClick={onClose} aria-label="返回">
                    <ChevronLeft size={22} />
                </button>
                <h1 className="toy-dev-title">互动设备</h1>
                <span className="toy-dev-header-spacer" />
            </header>

            <div className="toy-dev-body">
                {!isToySupported() && (
                    <div className="toy-dev-notice">该功能仅在打包后的 App 内可用，网页端无法直连蓝牙设备。</div>
                )}

                <section className="toy-dev-section">
                    <div className="toy-dev-hero">
                        <div className={`toy-dev-orb${toyController.connected ? " on" : ""}`}>
                            <HeartPulse size={30} />
                        </div>
                        <div className="toy-dev-hero-text">
                            <div className="toy-dev-hero-title">{statusText}</div>
                            <div className="toy-dev-hero-sub">{toyController.connected ? protocolText : "扫描并连接你的设备"}</div>
                        </div>
                    </div>

                    <div className="toy-dev-row-buttons">
                        <button className="toy-dev-btn ghost" onClick={handleScan} disabled={scanning}>
                            <Bluetooth size={16} /> {scanning ? "扫描中…" : "扫描玩具"}
                        </button>
                        {toyController.connected ? (
                            <button className="toy-dev-btn ghost" onClick={handleDisconnect}>断开连接</button>
                        ) : null}
                    </div>

                    {toyController.devices.length > 0 && (
                        <div className="toy-dev-device-list">
                            {toyController.devices.map(d => (
                                <button key={d.address} className="toy-dev-device-row" onClick={() => handleConnect(d)}>
                                    <BluetoothConnected size={16} />
                                    <span>{d.name}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </section>

                <section className="toy-dev-section">
                    <div className="toy-dev-sec-title">手动控制</div>
                    <div className="toy-dev-slider-row">
                        <label>强度：{manualLevel}%</label>
                        <input
                            type="range" min={0} max={100} value={manualLevel}
                            onChange={(e) => handleManualChange(Number(e.target.value))}
                        />
                    </div>
                    <div className="toy-dev-slider-row">
                        <label>最大强度上限：{toyController.maxIntensity}%</label>
                        <input
                            type="range" min={10} max={100} step={5} defaultValue={toyController.maxIntensity}
                            onChange={(e) => { toyController.maxIntensity = Number(e.target.value); forceTick(t => t + 1); }}
                        />
                    </div>
                    <div className="toy-dev-slider-row">
                        <label>吮吸强度（仅支持的设备，如司沃康）：{suckLevel}%</label>
                        <input
                            type="range" min={0} max={100} value={suckLevel}
                            onChange={(e) => handleSuckChange(Number(e.target.value))}
                        />
                    </div>
                    <div className="toy-dev-toggle-row">
                        <span>拟真抖动</span>
                        <input
                            type="checkbox" checked={toyController.jitterEnabled}
                            onChange={(e) => { toyController.jitterEnabled = e.target.checked; forceTick(t => t + 1); }}
                        />
                    </div>
                    <div className="toy-dev-slider-row">
                        <label>手抖强度：{Math.round(toyController.jitterScale * 100)}%</label>
                        <input
                            type="range" min={20} max={200} step={5} defaultValue={Math.round(toyController.jitterScale * 100)}
                            onChange={(e) => { toyController.jitterScale = Number(e.target.value) / 100; forceTick(t => t + 1); }}
                        />
                    </div>
                    <div className="toy-dev-row-buttons">
                        <button className="toy-dev-btn ghost" onClick={handleLightToggle} disabled={!toyController.connected}>
                            <Lightbulb size={16} /> {lightOn ? "关闭灯光" : "开启灯光"}
                        </button>
                    </div>
                    <button className="toy-dev-btn stop" onClick={() => toyController.emergencyStop()}>
                        <OctagonX size={16} /> 紧急停止
                    </button>
                </section>

                <section className="toy-dev-section">
                    <div className="toy-dev-sec-title">把控制权交给角色</div>
                    {characters.length === 0 ? (
                        <div className="toy-dev-empty">暂无角色</div>
                    ) : (
                        <div className="toy-dev-char-list">
                            {characters.map(c => (
                                <div key={c.id} className="toy-dev-char-row">
                                    <div className="toy-dev-char-info">
                                        <div className="toy-dev-char-avatar" style={c.avatar ? { backgroundImage: `url(${c.avatar})` } : undefined}>
                                            {!c.avatar && (c.name?.charAt(0) || "?")}
                                        </div>
                                        <span className="toy-dev-char-name">{c.name}</span>
                                    </div>
                                    <label className="toy-dev-switch">
                                        <input
                                            type="checkbox"
                                            checked={grantedIds.has(c.id)}
                                            onChange={(e) => toggleGrant(c.id, e.target.checked)}
                                        />
                                        <span className="toy-dev-switch-track" />
                                    </label>
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
}
