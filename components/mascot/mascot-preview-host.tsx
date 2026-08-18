"use client";

// 小卷工具的预览弹窗宿主。
//
// 为什么独立成一个组件而不是放在 MascotFloat 里：MascotFloat 在桌宠收成小球时
// 会 `if (state === "widget") return null`，而事件监听写在 useEffect 里、组件
// 渲染 null 也照样运行——于是 handled 被置为 true、工具报告"已弹出"，但弹窗
// 所在的 JSX 在那个提前返回之后，根本没机会渲染。用户从全屏「AI助手」聊天页
// 调用工具时桌宠正是收起状态，必然踩中。
// 这个宿主挂在桌宠旁边、不带任何条件，两个入口都能弹出来。

import { useEffect, useState } from "react";
import { CustomStatusFrame } from "@/components/chat/custom-status-frame";
import {
  STATUS_BAR_PREVIEW_EVENT,
  type StatusBarPreviewEventDetail,
  type StatusBarPreviewRequest,
} from "@/lib/mascot-events";

/** 线上聊天状态栏预览：用 CustomStatusFrame 跑，和聊天里真实渲染走的是同一个组件
 *  与同一套高度桥，所见即所得。示例数据经 window.STATUS_RAW / {{RAW}} 注入。 */
function StatusBarPreviewDialog({ request, onClose }: { request: StatusBarPreviewRequest; onClose: () => void }) {
  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 4000, background: "rgba(10,10,14,0.55)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        style={{ background: "#1c1d24", borderRadius: 18, padding: "14px 16px 16px", width: "min(88vw, 380px)", maxHeight: "80vh", overflowY: "auto", boxShadow: "0 18px 48px rgba(0,0,0,0.45)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, gap: 12 }}>
          <span style={{ color: "#f2f2f5", fontSize: "calc(13px*var(--app-text-scale,1))", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            状态栏预览 · {request.displayName}
          </span>
          <button
            type="button"
            onClick={onClose}
            style={{ border: 0, background: "rgba(255,255,255,0.12)", color: "#fff", borderRadius: 10, padding: "4px 12px", fontSize: "calc(12px*var(--app-text-scale,1))", cursor: "pointer", flex: "0 0 auto" }}
          >
            关闭
          </button>
        </div>
        <div style={{ borderRadius: 12, overflow: "hidden", background: "rgba(255,255,255,0.06)", padding: 8 }}>
          <CustomStatusFrame html={request.renderHtml} raw={request.previewRaw} />
        </div>
        <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "calc(10.5px*var(--app-text-scale,1))", textAlign: "center", marginTop: 8 }}>
          用示例数据沙箱渲染，不影响已保存的配置
        </div>
      </div>
    </div>
  );
}

export function MascotPreviewHost() {
  const [statusBarPreview, setStatusBarPreview] = useState<StatusBarPreviewRequest | null>(null);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<StatusBarPreviewEventDetail>).detail;
      if (!detail?.request) return;
      detail.handled = true;
      setStatusBarPreview(detail.request);
    };
    window.addEventListener(STATUS_BAR_PREVIEW_EVENT, handler);
    return () => window.removeEventListener(STATUS_BAR_PREVIEW_EVENT, handler);
  }, []);

  if (!statusBarPreview) return null;
  return <StatusBarPreviewDialog request={statusBarPreview} onClose={() => setStatusBarPreview(null)} />;
}
