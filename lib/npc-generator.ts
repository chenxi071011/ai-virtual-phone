// lib/npc-generator.ts
// 「生成配角」：为指定角色 AI 生成一批同世界观的配角（数量用户可选），
// 每个产出完整角色卡（与主角同规格）+ 简量人设 + 双向关系标签。
//
// 刻意不走预设系统组装（simpleLLMCall + 代码手动组提示词）：这是结构化的
// 工具任务，用户聊天预设里的角色扮演指令、文风要求、正则后处理都会污染
// 标签格式输出。API 配置仍沿用角色的聊天绑定（只取 config，不取预设/正则）。

import { simpleLLMCall } from "./api-helpers";
import { appNowISO } from "./app-clock";
import { loadApiConfigs, loadBindingConfig, resolveBinding } from "./settings-storage";
import { createCharacter, loadCharacters, saveCharacters } from "./character-storage";
import {
    addCharacterWorldRelation,
    getCharacterWorldGroupId,
    loadCharacterWorldGroups,
    moveCharacterToWorld,
} from "./character-world-storage";
import { loadMomentsConfig, saveMomentsConfig, loadMomentPosts, loadMomentComments } from "./moments-storage";
import { loadMemoryConfig } from "./memory-storage";
import { retrieveCoreMemoriesForPrompt, retrieveMemoriesForPrompt } from "./memory-service";
import { formatCoreMemories, formatLongTermMemories } from "./memory-injector";
import type { Character } from "./character-types";

export type GeneratedSupportingCharacter = {
    name: string;
    persona: string;
    personality: string;
    briefPersona: string;
    /** 新配角是目标角色的什么人（如：同事） */
    relationLabel: string;
    /** 目标角色是新配角的什么人（如：上司） */
    reverseRelationLabel: string;
};

export const NPC_GENERATE_MAX_COUNT = 5;

function extractTag(text: string, tag: string): string {
    const match = text.match(new RegExp(`\\[${tag}\\]\\s*([\\s\\S]*?)\\s*\\[\\/${tag}\\]`));
    return match?.[1]?.trim() ?? "";
}

function parseOneBlock(block: string): GeneratedSupportingCharacter | null {
    const name = extractTag(block, "名字");
    const persona = extractTag(block, "人设");
    if (!name || !persona) return null;
    return {
        name,
        persona,
        personality: extractTag(block, "性格"),
        briefPersona: extractTag(block, "简介"),
        relationLabel: extractTag(block, "关系"),
        reverseRelationLabel: extractTag(block, "反向关系"),
    };
}

/** 世界上下文：世界观描述 + 同世界全部角色名（不受「未配置世界观则为空」的门槛影响，
 *  保证 LLM 永远知道已有哪些角色，防重名/定位撞车）+ 关系图 + 一跳角色简介。 */
function buildWorldContext(character: Character): string {
    const characters = loadCharacters();
    const nameById = new Map(characters.map(c => [c.id, c.name || "未命名"]));
    const briefById = new Map(characters.map(c => [c.id, c.briefPersona?.trim() || ""]));
    const group = loadCharacterWorldGroups().find(g => g.memberIds.includes(character.id));

    const lines: string[] = [];
    if (group) {
        lines.push(`世界观：${group.name}`);
        if (group.description.trim()) lines.push(`世界观描述：${group.description.trim()}`);
        const memberNames = group.memberIds
            .map(id => nameById.get(id))
            .filter((name): name is string => Boolean(name));
        if (memberNames.length > 0) lines.push(`同世界已有角色（新配角不得与他们重名或定位重复）：${memberNames.join("、")}`);
        for (const relation of group.relations) {
            const fromName = nameById.get(relation.fromCharacterId);
            const toName = nameById.get(relation.toCharacterId);
            if (fromName && toName) lines.push(`${fromName}是${toName}的${relation.label}。`);
        }
        // 与目标角色拉过线的角色附上简量人设，便于新配角与他们呼应
        const counterpartIds = new Set<string>();
        for (const relation of group.relations) {
            if (relation.fromCharacterId === character.id) counterpartIds.add(relation.toCharacterId);
            else if (relation.toCharacterId === character.id) counterpartIds.add(relation.fromCharacterId);
        }
        for (const id of counterpartIds) {
            const brief = briefById.get(id);
            if (brief) lines.push(`${nameById.get(id)}的简介：${brief}`);
        }
    }
    return lines.join("\n");
}

type GenerationOptions = {
    count: number;
    hint: string;
    /** 锁定名字：为聊天名片里 AI 提到的特定人物建档时使用 */
    fixedName?: string;
    /** 推荐语境：名片消息前后的对话摘录，生成的人设必须与其自洽 */
    chatContext?: string;
};

/** 目标角色最近的朋友圈动态 + 评论区：出现过的路人名字（一次性 NPC）是最好的建档素材 */
function buildMomentsContext(character: Character, maxPosts = 6, maxChars = 1600): string {
    try {
        const characters = loadCharacters();
        const nameById = new Map(characters.map(c => [c.id, c.name || "未命名"]));
        const posts = loadMomentPosts()
            .filter(post => post.authorType === "character" && post.authorId === character.id)
            .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
            .slice(0, maxPosts);
        if (posts.length === 0) return "";

        const lines: string[] = [];
        for (const post of posts) {
            const content = (post.content || "").trim().slice(0, 120);
            if (content) lines.push(`动态：${content}`);
            const likeNames = post.likes
                .map(like => like.authorType === "user" ? "用户" : like.authorType === "npc" ? like.authorName : nameById.get(like.authorId))
                .filter((name): name is string => Boolean(name));
            if (likeNames.length > 0) lines.push(`  点赞：${likeNames.join("、")}`);
            for (const comment of loadMomentComments(post.id).slice(0, 6)) {
                const author = comment.authorType === "user"
                    ? "用户"
                    : comment.authorType === "npc"
                        ? (comment.authorName || "路人")
                        : (nameById.get(comment.authorId) || "路人");
                const text = (comment.content || "").trim().slice(0, 60);
                if (text) lines.push(`  ${author} 评论：${text}`);
            }
        }
        let context = lines.join("\n");
        if (context.length > maxChars) context = context.slice(0, maxChars);
        return context;
    } catch {
        return "";
    }
}

function buildSystemPrompt(character: Character, worldContext: string, coreMemories: string, longTermMemories: string, options: GenerationOptions): string {
    const sections: string[] = [];
    sections.push(`你是角色档案助手。以下是角色「${character.name}」的资料，请为TA生成配角（同一世界观中的次要人物），用于丰富TA的人际圈。`);
    sections.push(`【角色设定】\n${character.persona || "（暂无）"}`);
    if (character.personality?.trim()) sections.push(`【性格】\n${character.personality.trim()}`);
    if (coreMemories) sections.push(`【核心记忆】\n${coreMemories}`);
    if (longTermMemories) sections.push(`【相关长期记忆】\n${longTermMemories}`);
    if (worldContext) sections.push(`【世界观与人际】\n${worldContext}`);
    const momentsContext = buildMomentsContext(character);
    if (momentsContext) sections.push(`【「${character.name}」最近的朋友圈（含评论区出现过的人）】\n${momentsContext}`);
    if (options.chatContext?.trim()) {
        sections.push(`【推荐语境（「${character.name}」与用户的最近对话摘录）】\n${options.chatContext.trim()}`);
    }
    const rules = [
        "生成要求：",
        `- 配角要与「${character.name}」的世界观、生活圈自然契合；不得与已有角色重名或定位重复`,
        "- 优先呼应角色的记忆与经历：记忆或朋友圈里出现过、但「同世界已有角色」名单里没有的人（某位同事、旧友、家人、常来评论的路人）是最好的配角素材——直接沿用其名字与已透露的信息建档",
        "- 人设完整但克制：TA 是配角，不是另一位主角，不要写成天命之子",
    ];
    if (options.fixedName) {
        rules.push(`- 本次只生成一位配角，名字必须是「${options.fixedName}」，不得更改`);
        rules.push(`- 人设必须与上方对话摘录中透露的关于「${options.fixedName}」的信息完全自洽（身份、关系、提到过的事实都要吻合）`);
    } else {
        rules.push("- 一次生成多位时，彼此的身份定位、性格类型要错开，不要同质化");
    }
    rules.push("- 若用户消息中有补充要求，优先满足");
    sections.push(rules.join("\n"));
    sections.push([
        "每位配角用 [配角]…[/配角] 包裹，内部严格按以下标签输出，每个标签都必填，标签外不要输出任何其他内容：",
        "[配角]",
        "[名字]配角姓名[/名字]",
        "[人设]完整角色卡：身份背景、外貌、性格、说话风格、习惯癖好，300~600字[/人设]",
        "[性格]一句话性格概括[/性格]",
        "[简介]100~200字第三人称简量人设，供其他角色了解TA时注入使用，只写别人可感知的信息[/简介]",
        `[关系]TA是${character.name}的什么人，2~6字，如：同事、损友、亲妹妹[/关系]`,
        `[反向关系]${character.name}是TA的什么人，2~6字[/反向关系]`,
        "[/配角]",
    ].join("\n"));
    return sections.join("\n\n");
}

async function runGeneration(
    targetCharacterId: string,
    options: GenerationOptions,
): Promise<GeneratedSupportingCharacter[]> {
    const character = loadCharacters().find(c => c.id === targetCharacterId);
    if (!character) throw new Error("目标角色不存在。");
    const { hint } = options;
    const safeCount = Math.min(Math.max(1, Math.round(options.count) || 1), NPC_GENERATE_MAX_COUNT);

    // API 配置沿用角色的聊天绑定（只取 config；预设/正则一概不用）
    const bindings = loadBindingConfig();
    const slot = resolveBinding(bindings, targetCharacterId, "chat");
    if (!slot.apiConfigId) throw new Error("尚未绑定 API 配置，请先在绑定设置中配置。");
    const apiConfig = loadApiConfigs().find(c => c.id === slot.apiConfigId);
    if (!apiConfig) throw new Error("绑定的 API 配置不存在。");

    // 记忆：核心记忆全量；长期记忆按「人际关系/生活圈 + 用户要求」检索。
    // 检索失败降级为不注入，不阻断生成。
    let coreMemories = "";
    let longTermMemories = "";
    try {
        const memConfig = loadMemoryConfig();
        const retrievalContext = `${character.name}的人际关系、家人、朋友、同事与生活圈。${hint.trim()}`;
        const [coreResults, longTermResults] = await Promise.all([
            retrieveCoreMemoriesForPrompt(targetCharacterId, memConfig),
            retrieveMemoriesForPrompt(targetCharacterId, retrievalContext, memConfig),
        ]);
        coreMemories = formatCoreMemories(coreResults);
        longTermMemories = formatLongTermMemories(longTermResults);
    } catch (err) {
        console.warn("[NpcGenerator] memory retrieval failed:", err);
    }

    const systemPrompt = buildSystemPrompt(character, buildWorldContext(character), coreMemories, longTermMemories, options);
    const trimmedHint = hint.trim();
    const userPrompt = options.fixedName
        ? `请为对话中提到的「${options.fixedName}」生成完整档案。${trimmedHint}`
        : `本次请生成 ${safeCount} 位配角。${trimmedHint}`;

    const result = await simpleLLMCall(
        apiConfig,
        [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
        ],
        // 每位配角约 600~900 token；思考模型还会先烧隐藏思考 token，
        // 上限不足会 finishReason=length 且正文为空——按数量给足余量
        { temperature: 0.85, max_tokens: Math.max(8192, safeCount * 2000) },
    );

    if (result.error || !result.content) {
        throw new Error(result.error || "模型返回了空内容，请重试。");
    }
    const text = result.content.trim();

    // 多块解析：[配角]…[/配角] 重复出现；兼容无外层包裹的单个配角输出
    const blocks = [...text.matchAll(/\[配角\]([\s\S]*?)\[\/配角\]/g)].map(m => m[1]);
    const parsed = (blocks.length > 0 ? blocks : [text])
        .map(parseOneBlock)
        .filter((item): item is GeneratedSupportingCharacter => item !== null);

    if (parsed.length === 0) {
        if (result.wasTruncated) throw new Error("模型输出被截断（max_tokens 不足），请减少生成数量后重试。");
        throw new Error("模型输出缺少必要字段（名字/人设），请重试。");
    }
    // 锁名模式：无论模型怎么写，名字以指定值为准
    if (options.fixedName) {
        return [{ ...parsed[0], name: options.fixedName }];
    }
    return parsed.slice(0, safeCount);
}

/** 为目标角色生成 count 位配角；hint 为用户的补充要求（可空）。失败抛错（含用户可读信息）。 */
export async function generateSupportingCharacters(
    targetCharacterId: string,
    hint: string,
    count: number,
): Promise<GeneratedSupportingCharacter[]> {
    return runGeneration(targetCharacterId, { count, hint });
}

/** 为聊天名片里提到的特定人物生成档案：名字锁定，人设须与推荐语境自洽。 */
export async function generateNamedSupportingCharacter(
    recommenderCharacterId: string,
    fixedName: string,
    chatContext: string,
): Promise<GeneratedSupportingCharacter> {
    const [first] = await runGeneration(recommenderCharacterId, {
        count: 1,
        hint: "",
        fixedName,
        chatContext,
    });
    return first;
}

/** 落库：建角色卡 → 贴目标角色旁放置 → 入同世界 → 建双向关系 → 预置发帖开关。
 *  角色 app「生成配角」与聊天名片「现场建档」共用这一份逻辑。
 *  直接写存储；调用方若持有 React 态需自行重新加载。 */
export function materializeSupportingCharacter(
    result: GeneratedSupportingCharacter,
    targetCharacterId: string,
    options: { allowAutoPost?: boolean; placementIndex?: number } = {},
): Character {
    const characters = loadCharacters();
    const target = characters.find(c => c.id === targetCharacterId);
    const now = appNowISO();
    const index = options.placementIndex ?? 0;

    const newChar = createCharacter({
        name: result.name,
        persona: result.persona,
        personality: result.personality || undefined,
        briefPersona: result.briefPersona || undefined,
        briefPersonaUpdatedAt: result.briefPersona ? now : undefined,
        avatar: null,
        tags: ["配角"],
    });
    const baseX = target?.canvasX ?? 120;
    const baseY = target?.canvasY ?? 120;
    // 围绕目标角色扇形展开，批量生成时按序号错开不重叠
    newChar.canvasX = baseX + 150 + (index % 2) * 130 + Math.round(Math.random() * 40);
    newChar.canvasY = baseY + Math.floor(index / 2) * 150 - 50 + Math.round(Math.random() * 40);
    newChar.canvasRot = Math.round((Math.random() * 8 - 4) * 10) / 10;
    newChar.canvasZIndex = Math.max(0, ...characters.map(c => c.canvasZIndex ?? 0)) + 1 + index;
    newChar.polaroidStyle = target?.polaroidStyle ?? 0;
    saveCharacters([...characters, newChar]);

    const groupId = getCharacterWorldGroupId(targetCharacterId);
    if (groupId) {
        moveCharacterToWorld(newChar.id, groupId);
        if (result.relationLabel) addCharacterWorldRelation(groupId, newChar.id, targetCharacterId, result.relationLabel);
        if (result.reverseRelationLabel) addCharacterWorldRelation(groupId, targetCharacterId, newChar.id, result.reverseRelationLabel);
    }

    // 自动发朋友圈默认关闭：预置进禁用名单（加好友后才会真的进入发帖调度）
    if (!options.allowAutoPost) {
        const cfg = loadMomentsConfig();
        if (!cfg.autoPostDisabledCharacterIds.includes(newChar.id)) {
            saveMomentsConfig({ ...cfg, autoPostDisabledCharacterIds: [...cfg.autoPostDisabledCharacterIds, newChar.id] });
        }
    }
    return newChar;
}
