"use client";

// 自定义状态栏渲染画布：用户在聊天信息页写的「输出渲染」HTML 在沙盒 iframe 里执行，
// AI 的 [状态栏] 壳内原文通过 window.STATUS_RAW（JS 取用）与 {{RAW}}（模板直插，已转义）注入。
// 高度自适应桥与剧场画布同款；allow-scripts 无 same-origin，碰不到宿主页面与数据。

import { useEffect, useMemo, useRef, useState } from "react";

const FRAME_MIN_HEIGHT = 36;

function escapeHtmlText(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildSrcDoc(html: string, raw: string, frameId: string): string {
    const withRaw = html.split("{{RAW}}").join(escapeHtmlText(raw));
    const base = /<html[\s>]/i.test(withRaw)
        ? withRaw
        : `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body>${withRaw}</body></html>`;
    const inject = `<script>window.STATUS_RAW=${JSON.stringify(raw)};</` + `script>`;
    return /<head[\s>]/i.test(base)
        ? base.replace(/<head([^>]*)>/i, `<head$1>${inject}`)
        : inject + base;
}

export function CustomStatusFrame({ html, raw }: { html: string; raw: string }) {
    const iframeRef = useRef<HTMLIFrameElement | null>(null);
    const [frameId] = useState(() => `csf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    const [height, setHeight] = useState(FRAME_MIN_HEIGHT);

    const srcDoc = useMemo(() => {
        const doc = buildSrcDoc(html, raw, frameId);
        const bridge = `<script>(function(){
  var frameId=${JSON.stringify(frameId)};
  function measure(){var b=document.body;if(!b)return ${FRAME_MIN_HEIGHT};var r=b.getBoundingClientRect();var h=r.height;
    for(var i=0;i<b.children.length;i++){var c=b.children[i].getBoundingClientRect();if(c.width||c.height)h=Math.max(h,c.bottom-r.top);}
    return Math.max(Math.ceil(h),${FRAME_MIN_HEIGHT});}
  function send(){parent.postMessage({source:'chat-status-frame',type:'resize',id:frameId,height:measure()},'*');}
  function sched(){requestAnimationFrame(function(){send();requestAnimationFrame(send);});}
  window.addEventListener('load',sched);window.addEventListener('resize',sched);
  if(window.MutationObserver)new MutationObserver(sched).observe(document.documentElement,{attributes:true,childList:true,subtree:true,characterData:true});
  setTimeout(send,60);setTimeout(send,400);
})();</` + `script>`;
        return /<\/body>/i.test(doc) ? doc.replace(/<\/body>/i, `${bridge}</body>`) : doc + bridge;
    }, [html, raw, frameId]);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            if (iframeRef.current && event.source !== iframeRef.current.contentWindow) return;
            const data = event.data as Record<string, unknown> | null;
            if (!data || data.source !== "chat-status-frame" || data.type !== "resize" || data.id !== frameId) return;
            const next = Number(data.height);
            if (Number.isFinite(next)) setHeight(Math.min(Math.max(next, FRAME_MIN_HEIGHT), 1200));
        };
        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, [frameId]);

    return (
        <iframe
            ref={iframeRef}
            title="自定义状态栏"
            sandbox="allow-scripts"
            scrolling="no"
            srcDoc={srcDoc}
            style={{ width: "100%", height, border: 0, display: "block", background: "transparent" }}
        />
    );
}
