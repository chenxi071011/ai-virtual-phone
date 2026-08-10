"use client";

// 资源集市像素贴纸：16×16 手绘网格 → 锐边 SVG，标题/正文里用 [花] 这类标记引用。
// 与 pixel-icons 同一渲染思路，但配色更丰富（贴纸要可爱）。
// 注意：贴纸经常出现在白底上，不要画纯白的主体。

const PALETTE: Record<string, string> = {
    k: "#1a1a1a", // 黑
    w: "#ffffff", // 白（只做高光）
    l: "#c6c6c6", // 浅灰
    d: "#7a7a7a", // 深灰
    r: "#d84848", // 红
    p: "#f088b0", // 粉
    P: "#d84890", // 深粉
    y: "#f8d838", // 黄
    o: "#e89028", // 橙
    g: "#48a838", // 绿
    b: "#4868d8", // 蓝
    s: "#78b8e8", // 天蓝
    t: "#e8c890", // 米
    n: "#8a5828", // 棕
};

type PixelGrid = string[];

export const STICKERS: Record<string, PixelGrid> = {
    花: [
        "................",
        "................",
        "......pppp......",
        "......pppp......",
        "..pp..yyyy..pp..",
        "..ppppyyyypppp..",
        "..ppppyyyypppp..",
        "..pp..yyyy..pp..",
        "......pppp......",
        "......pppp......",
        ".......gg.......",
        ".......gg.g.....",
        ".......gggg.....",
        ".......gg.......",
        "................",
        "................",
    ],
    爱心: [
        "................",
        "................",
        "................",
        "..rrrr..rrrr....",
        ".rrrrrrrrrrrr...",
        ".rwwrrrrrrrrr...",
        ".rwrrrrrrrrrr...",
        "..rrrrrrrrrr....",
        "...rrrrrrrr.....",
        "....rrrrrr......",
        ".....rrrr.......",
        "......rr........",
        "................",
        "................",
        "................",
        "................",
    ],
    星星: [
        "................",
        "................",
        ".......yy.......",
        ".......yy.......",
        "......yyyy......",
        "......yyyy......",
        ".yyyyyyyyyyyyyy.",
        "..yyyyyyyyyyyy..",
        "....yyyyyyyy....",
        ".....yyyyyy.....",
        "....yyy..yyy....",
        "...yyy....yyy...",
        "...yy......yy...",
        "................",
        "................",
        "................",
    ],
    笑脸: [
        "................",
        "................",
        ".....yyyyyy.....",
        "....yyyyyyyy....",
        "...yyyyyyyyyy...",
        "..yyyyyyyyyyyy..",
        "..yykkyyyykkyy..",
        "..yykkyyyykkyy..",
        "..yyyyyyyyyyyy..",
        "..yykyyyyyykyy..",
        "...yykkkkkkyy...",
        "...yyyyyyyyyy...",
        "....yyyyyyyy....",
        ".....yyyyyy.....",
        "................",
        "................",
    ],
    小猫: [
        "................",
        "................",
        "..oo........oo..",
        "..ooo......ooo..",
        "..oooooooooooo..",
        "..oooooooooooo..",
        "..ookkoooookkoo.",
        "..oooooooooooo..",
        "..oooooppooooo..",
        "..oooooooooooo..",
        "...oooooooooo...",
        "................",
        "................",
        "................",
        "................",
        "................",
    ],
    音符: [
        "................",
        "................",
        "....bbbbbbbb....",
        "....bbbbbbbb....",
        "....bb....bb....",
        "....bb....bb....",
        "....bb....bb....",
        "....bb....bb....",
        "..bbbb..bbbb....",
        ".bbbbbb.bbbbbb..",
        "..bbbb..bbbb....",
        "................",
        "................",
        "................",
        "................",
        "................",
    ],
    闪光: [
        "................",
        "................",
        ".......yy.......",
        ".......yy.......",
        "......yyyy......",
        "..y..yyyyyy..y..",
        ".yyyyyywwyyyyyy.",
        "..y..yyyyyy..y..",
        "......yyyy......",
        ".......yy.......",
        ".......yy.......",
        "................",
        "................",
        "................",
        "................",
        "................",
    ],
    彩虹: [
        "................",
        "................",
        "................",
        "................",
        "....rrrrrrrr....",
        "..rrrrrrrrrrrr..",
        "..rryyyyyyyyrr..",
        ".rryyyyyyyyyyrr.",
        ".ryyggggggggyyr.",
        ".ryyggbbbbggyyr.",
        ".ryggbb..bbggyr.",
        ".ryggbb..bbggyr.",
        "................",
        "................",
        "................",
        "................",
    ],
    蝴蝶结: [
        "................",
        "................",
        "................",
        "................",
        "..pp........pp..",
        ".pppp......pppp.",
        ".pppppp..pppppp.",
        ".pppppppppppppp.",
        ".ppppppPPpppppp.",
        ".pppppppppppppp.",
        ".pppppp..pppppp.",
        ".pppp......pppp.",
        "..pp........pp..",
        "................",
        "................",
        "................",
    ],
    樱桃: [
        "................",
        "................",
        ".......gg.......",
        "......ggg.......",
        ".....gg.gg......",
        "....gg...gg.....",
        "..rrrr...rrrr...",
        ".rrrrrr.rrrrrr..",
        ".rwrrrr.rwrrrr..",
        ".rrrrrr.rrrrrr..",
        "..rrrr...rrrr...",
        "................",
        "................",
        "................",
        "................",
        "................",
    ],
    月亮: [
        "................",
        "................",
        ".....yyyy.......",
        "....yyyyyy......",
        "...yyyy.....y...",
        "..yyyy..........",
        "..yyy...........",
        "..yyy...........",
        "..yyy...........",
        "..yyyy..........",
        "...yyyy.........",
        "....yyyyyy......",
        ".....yyyy.......",
        "................",
        "................",
        "................",
    ],
    太阳: [
        "................",
        ".......yy.......",
        "..y....yy....y..",
        "...y..yyyy..y...",
        "....yyyyyyyy....",
        "....yyyyyyyy....",
        ".yy.yyyyyyyy.yy.",
        "....yyyyyyyy....",
        "....yyyyyyyy....",
        "...y..yyyy..y...",
        "..y....yy....y..",
        ".......yy.......",
        "................",
        "................",
        "................",
        "................",
    ],
    雪花: [
        "................",
        "................",
        ".......ss.......",
        "...s...ss...s...",
        "....s..ss..s....",
        ".....s.ss.s.....",
        ".......ss.......",
        ".ssssssssssssss.",
        ".....s.ss.s.....",
        "....s..ss..s....",
        "...s...ss...s...",
        ".......ss.......",
        "................",
        "................",
        "................",
        "................",
    ],
    蘑菇: [
        "................",
        "................",
        "................",
        ".....rrrrrr.....",
        "...rrrrrrrrrr...",
        "..rrwwrrrrwwrr..",
        "..rrwwrrrrwwrr..",
        ".rrrrrrrrrrrrrr.",
        ".rrrrrwwrrrrrrr.",
        "....tttttttt....",
        "....tttttttt....",
        "....tttttttt....",
        "...tttttttttt...",
        "................",
        "................",
        "................",
    ],
    幽灵: [
        "................",
        "................",
        "................",
        ".....ssssss.....",
        "....ssssssss....",
        "...ssssssssss...",
        "...skkssssskks..",  // 眼睛
        "...skkssssskks..",
        "...ssssssssss...",
        "...ssssssssss...",
        "...ssssssssss...",
        "...ssssssssss...",
        "...ss.ss.ss.s...",
        "................",
        "................",
        "................",
    ],
    皇冠: [
        "................",
        "................",
        "................",
        "................",
        "..yy...yy...yy..",
        "..yy...yy...yy..",
        "..yyy.yyyy.yyy..",
        "..yyyyyyyyyyyy..",
        "..yyyyyyyyyyyy..",
        "..yyrryyyyrryy..",
        "..yyyyyyyyyyyy..",
        "..oooooooooooo..",
        "................",
        "................",
        "................",
        "................",
    ],
};

export const STICKER_NAMES = Object.keys(STICKERS);

export function isStickerName(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(STICKERS, name);
}

/** 同色连续像素合并成 rect 列表（SVG 元素与字符串两种输出共用） */
function gridRuns(grid: PixelGrid): Array<{ x: number; y: number; w: number; fill: string }> {
    const runs: Array<{ x: number; y: number; w: number; fill: string }> = [];
    grid.forEach((row, y) => {
        let x = 0;
        while (x < row.length) {
            const ch = row[x];
            if (ch === "." || !PALETTE[ch]) { x++; continue; }
            let end = x + 1;
            while (end < row.length && row[end] === ch) end++;
            runs.push({ x, y, w: end - x, fill: PALETTE[ch] });
            x = end;
        }
    });
    return runs;
}

/** 贴纸的 data URL（富文本编辑器里当作一个整体字符插入 <img>） */
export function stickerDataUrl(name: string): string {
    const grid = STICKERS[name];
    if (!grid) return "";
    const rects = gridRuns(grid)
        .map(r => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="1" fill="${r.fill}"/>`)
        .join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">${rects}</svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function renderGrid(grid: PixelGrid, size: number | string) {
    const rects: React.ReactNode[] = [];
    grid.forEach((row, y) => {
        let x = 0;
        while (x < row.length) {
            const ch = row[x];
            if (ch === "." || !PALETTE[ch]) { x++; continue; }
            let end = x + 1;
            while (end < row.length && row[end] === ch) end++;
            rects.push(<rect key={`${x},${y}`} x={x} y={y} width={end - x} height={1} fill={PALETTE[ch]} />);
            x = end;
        }
    });
    return (
        <svg viewBox="0 0 16 16" width={size} height={size} shapeRendering="crispEdges" aria-hidden
            style={{ display: "inline-block", verticalAlign: "-0.22em" }}>
            {rects}
        </svg>
    );
}

/** 独立贴纸（选择器等处用，size 为像素数） */
export function StickerPixelIcon({ name, size = 24 }: { name: string; size?: number }) {
    const grid = STICKERS[name];
    return grid ? renderGrid(grid, size) : null;
}

/** 行内贴纸（跟随文字大小） */
export function StickerInline({ name, scale = 1.25 }: { name: string; scale?: number }) {
    const grid = STICKERS[name];
    return grid ? renderGrid(grid, `${scale}em`) : null;
}
