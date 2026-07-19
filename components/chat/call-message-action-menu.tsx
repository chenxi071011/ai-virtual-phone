"use client";

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";

export type ActionMenuAnchor = { x: number; y: number };

// 通话模式（语音/视频）里 AI 消息的长按手势，复用主聊天页 500ms 长按阈值的约定。
export function useCallLongPress(onLongPress: (id: string, anchor: ActionMenuAnchor) => void) {
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const onPointerDown = useCallback((e: ReactPointerEvent, id: string) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        const anchor = { x: e.clientX, y: e.clientY };
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
            onLongPress(id, anchor);
            timerRef.current = null;
        }, 500);
    }, [onLongPress]);

    const clearTimer = useCallback(() => {
        if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    }, []);

    return { onPointerDown, onPointerUp: clearTimer, onPointerCancel: clearTimer, onPointerLeave: clearTimer };
}

export function CallMessageActionMenu({
    anchor, onRetry, onEdit, onClose,
}: {
    anchor: ActionMenuAnchor;
    onRetry: () => void;
    onEdit: () => void;
    onClose: () => void;
}) {
    const width = typeof window !== "undefined" ? window.innerWidth : 375;
    const left = Math.min(Math.max(anchor.x - 60, 8), width - 128);
    const top = Math.max(anchor.y - 90, 8);

    return (
        <>
            <div className="call-ctx-menu-overlay" onClick={onClose} />
            <div
                className="ctx-menu chat-floating-ctx-menu flex"
                style={{ position: "fixed", left, top, zIndex: 20000 }}
                onPointerDown={(e) => e.stopPropagation()}
            >
                <button className="ctx-menu-btn" onClick={() => { onEdit(); onClose(); }}>编辑</button>
                <button className="ctx-menu-btn ctx-menu-btn-danger" onClick={() => { onRetry(); onClose(); }}>重说</button>
            </div>
        </>
    );
}
