"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { HeartPulse, OctagonX, Unplug, X } from "lucide-react";
import { toyController } from "@/lib/toy-ble";

const DRAG_THRESHOLD = 4;
const DEFAULT_POS = { left: 322, top: 540 };

type Pos = { left: number; top: number };

/**
 * 全局悬浮球：玩具一旦连接就自动出现，断开就自动消失。
 * 不依赖当前打开的是哪个 App/页面，挂载在 desktop-shell 里和其他悬浮控件同级。
 */
export default function ToyFloat() {
    const [, forceTick] = useState(0);
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState<Pos | null>(null);
    const [manualLevel, setManualLevel] = useState(0);
    const floatRef = useRef<HTMLButtonElement>(null);
    const layerRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<{ startX: number; startY: number; origLeft: number; origTop: number; moved: boolean } | null>(null);

    useEffect(() => toyController.subscribe(() => forceTick(t => t + 1)), []);

    // 每次这个全局悬浮球挂载（=整个 App 壳刚加载/重载）时，都和原生蓝牙状态对一次账，
    // 否则 WebView 整页重载后 JS 会误以为设备断开，AI 提示词里就拿不到控制授权。
    useEffect(() => { void toyController.syncConnectionState(); }, []);

    useEffect(() => {
        setManualLevel(toyController.currentIntensity);
    }, [toyController.connected]);

    useEffect(() => {
        if (!toyController.connected) setOpen(false);
    }, [toyController.connected]);

    useEffect(() => {
        if (!open) return;
        const handlePointerDown = (event: PointerEvent) => {
            if (!layerRef.current?.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener("pointerdown", handlePointerDown);
        return () => document.removeEventListener("pointerdown", handlePointerDown);
    }, [open]);

    const clamp = useCallback((left: number, top: number): Pos => {
        const el = floatRef.current;
        const shell = el?.closest("[data-ui='phone-screen']") as HTMLElement | null;
        const w = shell?.clientWidth ?? 390;
        const h = shell?.clientHeight ?? 844;
        const ew = el?.offsetWidth ?? 56;
        const eh = el?.offsetHeight ?? 56;
        return {
            left: Math.max(0, Math.min(left, w - ew)),
            top: Math.max(0, Math.min(top, h - eh)),
        };
    }, []);

    const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
        const current = pos ?? DEFAULT_POS;
        dragRef.current = { startX: event.clientX, startY: event.clientY, origLeft: current.left, origTop: current.top, moved: false };
        floatRef.current?.setPointerCapture(event.pointerId);
    }, [pos]);

    const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
        const drag = dragRef.current;
        if (!drag) return;
        const dx = event.clientX - drag.startX;
        const dy = event.clientY - drag.startY;
        if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) drag.moved = true;
        if (drag.moved) setPos(clamp(drag.origLeft + dx, drag.origTop + dy));
    }, [clamp]);

    const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
        const drag = dragRef.current;
        dragRef.current = null;
        if (floatRef.current?.hasPointerCapture(event.pointerId)) {
            floatRef.current.releasePointerCapture(event.pointerId);
        }
        if (!drag?.moved) setOpen(prev => !prev);
    }, []);

    const handleManualChange = useCallback((v: number) => {
        setManualLevel(v);
        toyController.manualVibe(v);
    }, []);

    const handleEmergencyStop = useCallback(() => {
        toyController.emergencyStop();
        setManualLevel(0);
    }, []);

    const handleDisconnect = useCallback(() => {
        toyController.disconnect();
    }, []);

    if (!toyController.connected) return null;

    const buttonPos = pos ?? DEFAULT_POS;

    return (
        <div className="toy-float-layer" ref={layerRef}>
            <button
                ref={floatRef}
                type="button"
                className="prompt-viewer-float-button toy-float-button"
                aria-label="玩具控制"
                data-positioned=""
                style={{ left: buttonPos.left, top: buttonPos.top }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
            >
                <HeartPulse size={22} />
            </button>

            {open ? (
                <div
                    className="toy-float-panel"
                    style={{ left: buttonPos.left + 26, top: buttonPos.top }}
                    role="dialog"
                    aria-label="玩具控制面板"
                    onClick={(event) => event.stopPropagation()}
                >
                    <div className="toy-float-panel-head">
                        <span className="toy-float-panel-title">{toyController.deviceName || "玩具"}</span>
                        <button type="button" className="toy-float-close" onClick={() => setOpen(false)} aria-label="关闭">
                            <X size={16} />
                        </button>
                    </div>

                    <div className="toy-float-slider-row">
                        <label>强度：{manualLevel}%</label>
                        <input
                            type="range" min={0} max={100} value={manualLevel}
                            onChange={(e) => handleManualChange(Number(e.target.value))}
                        />
                    </div>

                    <div className="toy-float-row-buttons">
                        <button type="button" className="toy-float-btn stop" onClick={handleEmergencyStop}>
                            <OctagonX size={15} /> 急停
                        </button>
                        <button type="button" className="toy-float-btn ghost" onClick={handleDisconnect}>
                            <Unplug size={15} /> 断开
                        </button>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
