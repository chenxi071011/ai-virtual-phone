"use client";

import { useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

const ACTION_BUTTON_STYLE: CSSProperties = {
    color: "#fff",
    fontSize: "calc(14px*var(--app-text-scale,1))",
    opacity: 0.85,
    border: "none",
    cursor: "pointer",
    padding: "8px 20px",
    borderRadius: 20,
    background: "rgba(255,255,255,0.15)",
    backdropFilter: "blur(8px)",
};

/**
 * 全屏媒体预览层：图片（或未生成时的文字描述）+ 下方操作按钮排。
 * 聊天、朋友圈、小卷共用——聊天流里不放常驻小按钮，保存/重新生成都收在这里。
 */
export function MediaPreviewOverlay({
    imageUrl,
    description,
    saveFilename,
    onRegenerate,
    regenerating,
    onClose,
}: {
    imageUrl?: string | null;
    description?: string;
    saveFilename?: string;
    onRegenerate?: () => void;
    regenerating?: boolean;
    onClose: () => void;
}) {
    // 保存要重新拉一次图片，慢网络下会卡一下——按钮上给个状态
    const [saving, setSaving] = useState(false);
    if (typeof document === "undefined") return null;
    return createPortal(
        <div
            style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,0.85)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 24 }}
            onClick={onClose}
        >
            {imageUrl ? (
                <img src={imageUrl} alt="" style={{ maxWidth: "90vw", maxHeight: "75vh", objectFit: "contain" }} />
            ) : description ? (
                <div
                    style={{ color: "#fff", opacity: 0.9, maxWidth: "min(85vw, 420px)", maxHeight: "60vh", overflowY: "auto", fontSize: "calc(14px*var(--app-text-scale,1))", lineHeight: 1.8, fontStyle: "italic", whiteSpace: "pre-wrap" }}
                    onClick={e => e.stopPropagation()}
                >
                    {description}
                </div>
            ) : null}
            <div style={{ display: "flex", gap: 12 }} onClick={e => e.stopPropagation()}>
                {imageUrl && saveFilename && (
                    <button
                        onPointerDown={e => e.stopPropagation()}
                        disabled={saving}
                        onClick={async e => {
                            e.stopPropagation();
                            e.preventDefault();
                            setSaving(true);
                            try {
                                const { downloadUrl } = await import("@/lib/download-utils");
                                await downloadUrl(imageUrl, saveFilename);
                            } finally {
                                setSaving(false);
                            }
                        }}
                        style={ACTION_BUTTON_STYLE}
                    >
                        {saving ? "保存中…" : "保存图片"}
                    </button>
                )}
                {onRegenerate && (
                    <button
                        onPointerDown={e => e.stopPropagation()}
                        disabled={regenerating}
                        onClick={e => {
                            e.stopPropagation();
                            onRegenerate();
                        }}
                        style={ACTION_BUTTON_STYLE}
                    >
                        {regenerating ? "生成中..." : "重新生成"}
                    </button>
                )}
            </div>
        </div>,
        document.body,
    );
}
