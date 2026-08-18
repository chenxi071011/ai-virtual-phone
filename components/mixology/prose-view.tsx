"use client";

// 独家特调 · 正文渲染：按正文语义协议把 AI 原文渲染成带官方语义类的段落。
// 装饰材料的 CSS 只需要认这些类名就能上色：
//   .mix-prose 正文容器 / .mix-para 普通段 / .mix-scene 场景过场行
//   .mix-dialogue 对白 / .mix-thought 心声 / .mix-accent 强调 / .mix-narration 叙述

import { useMemo } from "react";
import { parseMixProse, type MixProseParagraph } from "@/lib/mixology/prose";

function renderParagraph(paragraph: MixProseParagraph, key: number) {
    if (paragraph.type === "scene") {
        return (
            <p className="mix-scene" key={key}>
                <span aria-hidden="true">— </span>
                {paragraph.text}
                <span aria-hidden="true"> —</span>
            </p>
        );
    }
    return (
        <p className="mix-para" key={key}>
            {paragraph.segments.map((segment, i) => (
                <span className={`mix-${segment.type}`} key={i}>{segment.text}</span>
            ))}
        </p>
    );
}

export function MixProseView({ text }: { text: string }) {
    const paragraphs = useMemo(() => parseMixProse(text), [text]);
    return (
        <div className="mix-prose">
            {paragraphs.map((paragraph, i) => renderParagraph(paragraph, i))}
        </div>
    );
}
