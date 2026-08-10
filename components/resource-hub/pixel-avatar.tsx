"use client";

// 资源集市默认头像：16×16 像素风女孩，矩形构图（和复古窗口一个调性）。
// 用户没设头像时到处都用它——我的货摊资料卡、详情页作者行。

const PALETTE: Record<string, string> = {
    h: "#5a3a2a", // 头发
    H: "#43291d", // 双马尾（暗一档）
    s: "#f2d0b3", // 皮肤
    k: "#1a1a1a", // 眼睛
    p: "#e0708a", // 腮红/嘴
    c: "#4868d8", // 衣服
};

const GRID: string[] = [
    "................",
    ".....hhhhhh.....",
    "....hhhhhhhh....",
    "...hhhhhhhhhh...",
    "..HhhhhhhhhhhH..",
    "..HhsssssssshH..",
    "..HhsssssssshH..",
    "..HhsskssksshH..",
    "..HhsskssksshH..",
    "..HhpssssssphH..",
    "..HhsssppssshH..",
    "..HhsssssssshH..",
    "...hhsssssshh...",
    "....cccccccc....",
    "..cccccccccccc..",
    "..cccccccccccc..",
];

/** 默认头像（size 为像素边长；矩形，不裁圆） */
export function DefaultPixelAvatar({ size = 48 }: { size?: number }) {
    const rects: React.ReactNode[] = [];
    GRID.forEach((row, y) => {
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
    return (
        <svg viewBox="0 0 16 16" width={size} height={size} shapeRendering="crispEdges" aria-hidden
            style={{ display: "block", background: "#dcd8d0" }}>
            {rects}
        </svg>
    );
}
