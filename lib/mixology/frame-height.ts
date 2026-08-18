// 独家特调 · 沙盒画布的自适应高度：识别「越量越高」的回路。
//
// 画布（开场画布 / 小票 / 尾调）都跑在 scrolling="no" 的沙盒 iframe 里，高度由画布自己
// 量好上报、宿主照着撑。作者一旦在画布里用了视口单位（100vh、100dvh、min-height:100vh
// 这类），内容高度就反过来依赖 iframe 的高度：宿主撑高一点，画布就跟着高一点，每量一次
// 涨同样的一截，一路顶到上限。顶到上限之后高度不再变化，用户看到的就是「滚到某一处再也
// 滚不动了」（上限比内容矮时）或者尾巴上挂着一大片空白（上限比内容高时）。
//
// 回路的识别特征：上报的高度总是「当前 iframe 高度 + 同一个常数」。真实的内容变高——图片
// 加载完、字体回填、点开折叠块——不会连着好几轮都恰好等于这个式子。

/** 连着这么多轮「比当前高度高出同一个常数」就判定为回路 */
const LOOP_HITS = 4;
/** 两轮增量差在这个像素内算「同一个常数」（亚像素布局会有零点几的抖动） */
const DELTA_EPS = 1;

export type MixFrameHeightTracker = {
    /** 当前已经撑给 iframe 的高度 */
    applied: number;
    /** 上一轮的增量 */
    delta: number;
    /** 已经连着几轮是同一个增量 */
    hits: number;
};

export function createMixFrameHeightTracker(initial: number): MixFrameHeightTracker {
    return { applied: initial, delta: 0, hits: 0 };
}

/**
 * 收到画布上报的高度，算出这次该撑成多高。
 * 返回 null = 这一轮判定为回路，维持原高度不动。
 *
 * 冻结是安全的：判定成立时，当前高度是回路涨上来的，只会比第一次量到的真实内容高度更高，
 * 不会把内容裁掉。而且只冻这一轮——下一次上报只要不再符合「高度 + 同一个常数」，
 * 立刻恢复正常跟随，所以图片加载完之类的真实变高不会被卡住。
 */
export function nextMixFrameHeight(
    tracker: MixFrameHeightTracker,
    reported: number,
    range: { min: number; max: number },
): number | null {
    if (!Number.isFinite(reported)) return null;

    const delta = reported - tracker.applied;
    if (delta > 0 && tracker.hits > 0 && Math.abs(delta - tracker.delta) <= DELTA_EPS) {
        tracker.hits += 1;
    } else {
        tracker.delta = delta;
        tracker.hits = delta > 0 ? 1 : 0;
    }
    if (tracker.hits >= LOOP_HITS) return null;

    const applied = Math.min(Math.max(reported, range.min), range.max);
    tracker.applied = applied;
    return applied;
}
