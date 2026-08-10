"use client";

import { useEffect } from "react";

// 像素沙漏：复古 Windows 风的"正在忙"指示，用在资源集市那类联网按钮里。
// 四帧 16×16 网格（上室沙子减少 → 颈部落沙 → 下室堆积），纯 CSS 轮播，
// 不用 JS 定时器，所以不会引起重渲染。

const PALETTE: Record<string, string> = {
    k: "#1a1a1a", // 外框
    w: "#ffffff", // 空腔
    y: "#f8d838", // 沙子
};

const FRAMES: string[][] = [
    [
        "..kkkkkkkkkkkk..",
        "..kyyyyyyyyyyk..",
        "..kyyyyyyyyyyk..",
        "...kyyyyyyyyk...",
        "....kyyyyyyk....",
        ".....kyyyyk.....",
        "......kyyk......",
        "......kwwk......",
        "......kwwk......",
        ".....kwwwwk.....",
        "....kwwwwwwk....",
        "...kwwwwwwwwk...",
        "..kwwwwwwwwwwk..",
        "..kwwwwwwwwwwk..",
        "..kkkkkkkkkkkk..",
        "................",
    ],
    [
        "..kkkkkkkkkkkk..",
        "..kwwwwwwwwwwk..",
        "..kyyyyyyyyyyk..",
        "...kyyyyyyyyk...",
        "....kyyyyyyk....",
        ".....kyyyyk.....",
        "......kyyk......",
        "......kywk......",
        "......kywk......",
        ".....kwwwwk.....",
        "....kwwwwwwk....",
        "...kwwwwwwwwk...",
        "..kwwwwwwwwwwk..",
        "..kyyyyyyyyyyk..",
        "..kkkkkkkkkkkk..",
        "................",
    ],
    [
        "..kkkkkkkkkkkk..",
        "..kwwwwwwwwwwk..",
        "..kwwwwwwwwwwk..",
        "...kyyyyyyyyk...",
        "....kyyyyyyk....",
        ".....kyyyyk.....",
        "......kyyk......",
        "......kywk......",
        "......kywk......",
        ".....kwwwwk.....",
        "....kwwwwwwk....",
        "...kwwwwwwwwk...",
        "..kyyyyyyyyyyk..",
        "..kyyyyyyyyyyk..",
        "..kkkkkkkkkkkk..",
        "................",
    ],
    [
        "..kkkkkkkkkkkk..",
        "..kwwwwwwwwwwk..",
        "..kwwwwwwwwwwk..",
        "...kwwwwwwwwk...",
        "....kyyyyyyk....",
        ".....kyyyyk.....",
        "......kyyk......",
        "......kwwk......",
        "......kwwk......",
        ".....kwwwwk.....",
        "....kwwwwwwk....",
        "...kyyyyyyyyk...",
        "..kyyyyyyyyyyk..",
        "..kyyyyyyyyyyk..",
        "..kkkkkkkkkkkk..",
        "................",
    ],
];

function frameRects(grid: string[]) {
    const rects: React.ReactNode[] = [];
    grid.forEach((row, y) => {
        let x = 0;
        while (x < row.length) {
            const ch = row[x];
            if (!PALETTE[ch]) { x++; continue; }
            let end = x + 1;
            while (end < row.length && row[end] === ch) end++;
            rects.push(<rect key={`${x},${y}`} x={x} y={y} width={end - x} height={1} fill={PALETTE[ch]} />);
            x = end;
        }
    });
    return rects;
}

// 关键帧只往文档里注入一次：写在 SVG 里的话每个实例都带一份，
// 还会混进元素的 textContent。
const STYLE_ID = "aivp-hourglass-style";

function ensureKeyframes(): void {
    if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
        @keyframes aivp-hourglass { 0%, 24.99% { opacity: 1 } 25%, 100% { opacity: 0 } }
        .aivp-hg-frame { animation: aivp-hourglass 1s linear infinite; }
        @media (prefers-reduced-motion: reduce) { .aivp-hg-frame { animation: none } }
    `;
    document.head.appendChild(style);
}

/** 正在忙的像素沙漏（size 为像素边长） */
export function PixelHourglass({ size = 14 }: { size?: number }) {
    useEffect(ensureKeyframes, []);
    return (
        <svg
            viewBox="0 0 16 16"
            width={size}
            height={size}
            shapeRendering="crispEdges"
            role="img"
            aria-label="处理中"
            style={{ display: "inline-block", verticalAlign: "-0.15em", flexShrink: 0 }}
        >
            {/* 四帧各显示 1/4 周期，靠 animation-delay 错开——同一时刻只有一帧可见。
                行内 opacity 是关键帧就位前（以及降低动效偏好下）的兜底：只显示第一帧。 */}
            {FRAMES.map((grid, index) => (
                <g
                    key={index}
                    className="aivp-hg-frame"
                    style={{ opacity: index === 0 ? 1 : 0, animationDelay: `${index * 0.25}s` }}
                >
                    {frameRects(grid)}
                </g>
            ))}
        </svg>
    );
}
