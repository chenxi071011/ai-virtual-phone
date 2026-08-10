"use client";

// 资源集市富文本：安全的轻量标记 → React 元素（绝无 HTML 注入面）。
// 语法（方括号标记，未注册的原样显示，老资源纯文本完全不受影响）：
//   贴纸        [花] [爱心] ...（见 pixel-stickers，标题和正文都能用）
//   颜色（正文）[红]文字[/红]，共 红橙黄绿蓝紫粉灰 八色
//   字号（正文）[大]文字[/大]、[小]文字[/小]
//   加粗（正文）[粗]文字[/粗]
// 三种渲染模式：
//   full    详情正文：全部生效
//   inline  列表摘要：贴纸/颜色/加粗生效，字号忽略（保持行高整齐）
//   sticker 标题：只认贴纸，其它标记原样显示

import type { CSSProperties, ReactNode } from "react";
import { StickerInline, isStickerName } from "./pixel-stickers";

// 颜色都取偏深的档位，保证白底可读
export const RICH_COLORS: Record<string, string> = {
    红: "#c02020",
    橙: "#c05e10",
    黄: "#9a7d00",
    绿: "#0f7020",
    蓝: "#1040b0",
    紫: "#7020a0",
    粉: "#c8407e",
    灰: "#707070",
};

const RICH_SIZES: Record<string, string> = { 大: "1.3em", 小: "0.85em" };

export type RichTextMode = "full" | "inline" | "sticker";

function styleForTag(tag: string, mode: RichTextMode): CSSProperties | null {
    if (mode === "sticker") return null;
    if (RICH_COLORS[tag]) return { color: RICH_COLORS[tag] };
    if (tag === "粗") return { fontWeight: 700 };
    if (RICH_SIZES[tag]) {
        // inline 模式认识字号标记（不至于原样显示出来），但不改变字号
        return mode === "full" ? { fontSize: RICH_SIZES[tag] } : {};
    }
    return null;
}

const TOKEN_RE = /\[(\/?)([^\[\]/\s]{1,6})\]/g;

export function renderRichText(text: string, mode: RichTextMode): ReactNode[] {
    type Frame = { tag: string; style: CSSProperties; nodes: ReactNode[] };
    const root: Frame = { tag: "", style: {}, nodes: [] };
    const stack: Frame[] = [root];
    let key = 0;
    const top = () => stack[stack.length - 1];
    const pushText = (s: string) => { if (s) top().nodes.push(s); };
    const closeFrame = () => {
        const frame = stack.pop()!;
        top().nodes.push(<span key={key++} style={frame.style}>{frame.nodes}</span>);
    };

    TOKEN_RE.lastIndex = 0;
    let cursor = 0;
    let match: RegExpExecArray | null;
    while ((match = TOKEN_RE.exec(text)) !== null) {
        const [raw, slash, tag] = match;
        pushText(text.slice(cursor, match.index));
        cursor = match.index + raw.length;
        if (!slash && isStickerName(tag)) {
            top().nodes.push(<StickerInline key={key++} name={tag} />);
            continue;
        }
        const style = styleForTag(tag, mode);
        if (style === null) { pushText(raw); continue; } // 未注册标记原样显示
        if (!slash) {
            stack.push({ tag, style, nodes: [] });
        } else if (top().tag === tag) {
            closeFrame();
        } else {
            pushText(raw); // 闭合标记对不上，原样显示
        }
    }
    pushText(text.slice(cursor));
    while (stack.length > 1) closeFrame(); // 忘写闭合标记：样式作用到结尾（截断摘要也能优雅降级）
    return root.nodes;
}

export function RichText({ text, mode = "full" }: { text: string; mode?: RichTextMode }) {
    return <>{renderRichText(text, mode)}</>;
}
