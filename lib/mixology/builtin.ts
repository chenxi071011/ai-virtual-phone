// lib/mixology/builtin.ts
// 独家特调 · 官方出厂材料：基底/杯型的默认文案。
// 这两件是"素杯也好喝"的底线——玩家一件配料不装、只拿一张角色卡也能开局。
// 文案升级时 bump MIX_BUILTIN_VERSION，storage 会用出厂内容刷新官方件。

import type { MixTextMaterial } from "./types";

export const MIX_BUILTIN_VERSION = 2;

export const MIX_BUILTIN_BASE_ID = "mix_builtin_base";
export const MIX_BUILTIN_GLASS_ID = "mix_builtin_glass";

const now = () => Date.now();

/** 官方基底：扮演总纲 */
export function createBuiltinBase(): MixTextMaterial {
    return {
        id: MIX_BUILTIN_BASE_ID,
        kind: "base",
        name: "官方 · 标准扮演",
        hook: "出厂自带的扮演总纲，稳定不出戏",
        author: "独家特调",
        content: [
            "你将完全成为「{{char}}」，以第一视角活在故事里，与「{{user}}」进行沉浸式角色扮演。",
            "- 始终以{{char}}的身份、性格、说话方式行动，绝不跳出角色、绝不以 AI 或助手自称。",
            "- 只扮演{{char}}与故事中的旁白/配角，绝不代替{{user}}说话、行动或下决定。",
            "- 依据角色资料与已发生的剧情推进故事，主动推动情节，不原地打转，不重复已说过的内容。",
            "- 角色资料没写的细节可以合理补全，但不得与已有设定矛盾。",
            "- 允许剧情出现冲突、拒绝与负面情绪，角色不是讨好机器；贴合人设比讨好{{user}}更重要。",
        ].join("\n"),
        tags: ["官方"],
        createdAt: now(),
        updatedAt: now(),
    };
}

/** 官方杯型：输出格式（含正文语义协议的书写引导） */
export function createBuiltinGlass(): MixTextMaterial {
    return {
        id: MIX_BUILTIN_GLASS_ID,
        kind: "glass",
        name: "官方 · 正文与对白",
        hook: "出厂自带的输出格式，正文流畅、对白分明",
        author: "独家特调",
        content: [
            "以小说正文的形式输出，第三人称叙述，每轮 2~4 个自然段，段落之间空一行。",
            "- 叙述里穿插动作、神态与环境细节，让画面能被看见；不要写成流水账。",
            "- 每轮在留有余韵处收笔，给{{user}}接话的空间；不要替{{user}}总结感受。",
        ].join("\n"),
        tags: ["官方"],
        createdAt: now(),
        updatedAt: now(),
    };
}
