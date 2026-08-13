import type { ChatMessage } from "./chat-storage";
import type { UserIdentity } from "@/components/settings/user-identity";
import { loadApiConfigs, loadVoiceConfigs } from "./settings-storage";
import type { ApiConfig } from "./settings-types";
import type { LLMMessage } from "./llm-prompt-assembler";
import { getVoiceStyleCapability, synthesizeSpeech, MINIMAX_SOUND_TAGS } from "./tts-service";

/**
 * 用户自己的语音条：点播放时才现做。
 *
 * 两步，第二步可关：
 *   1.（可选）让模型按用户身份把台词改写一遍——身份是日本人就转成日文，
 *      并按支持情况配上情绪和声音标签。关掉这一步就把原文直接送去合成。
 *   2. 合成。
 *
 * 为什么懒执行：用户发语音条时未必想听，先合成就是白花钱。生成结果写回
 * mediaData 缓存，重播不再重复调用。
 */

export type UserVoiceResult = {
    /** 实际送去合成的文本（可能是改写后的） */
    spokenText: string;
    /** 合成出来的音频 */
    blob: Blob;
    /** 整句情绪，改写步骤给出 */
    emotion?: string;
};

/** 改写产物：模型只需吐这一行，别的都不要。 */
type RewriteOutput = { text: string; emotion?: string };

function buildRewriteInstruction(
    identity: UserIdentity,
    capability: ReturnType<typeof getVoiceStyleCapability>,
): string {
    const lines: string[] = [
        "<voice_rewrite_task>",
        "以上是当前对话的全部上下文。现在**停止扮演角色**，改为执行一个纯技术任务。",
        "",
        `任务：把「${identity.name}」（也就是用户本人）刚发出的这条语音条，改写成实际说出口时的样子，供语音合成使用。`,
        "",
        "改写要求：",
        `- 语言：按 ${identity.name} 的身份设定决定。如果这个身份的母语/惯用语不是中文，就把台词转成那种语言（例如身份是日本人则输出日文），即使原文是中文。身份就是中文母语则保持中文。`,
        "- 口吻：贴合这个身份的说话习惯、性别、年龄和当下语境，可以调整语气词和句式，但**不许改变原意，不许增删信息**。",
        "- 只处理这一句，不要接话、不要回应、不要续写剧情。",
    ];

    if (capability.emotion) {
        lines.push(`- 情绪：从这些里挑一个最贴合的：${capability.emotions.join(" / ")}。拿不准就用 calm。`);
    }
    if (capability.soundTags) {
        lines.push(
            `- 声音标签：可在台词中插入 ${MINIMAX_SOUND_TAGS.slice(0, 8).map(t => `(${t})`).join(" ")} 等标签模拟真实发声，最多一两处，不要滥用。`,
        );
    }
    if (capability.pause) {
        lines.push("- 停顿：需要明显停顿时可写 <#0.5#>，数字是秒。");
    }

    lines.push(
        "",
        "输出格式：**只输出一行 JSON，不要解释，不要代码块围栏**。",
        capability.emotion
            ? '{"text":"改写后的台词","emotion":"情绪"}'
            : '{"text":"改写后的台词"}',
        "</voice_rewrite_task>",
    );
    return lines.join("\n");
}

function parseRewriteOutput(raw: string): RewriteOutput | null {
    const text = raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
    // 模型爱在 JSON 前后带点客套话，抓第一个花括号块
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
        const parsed = JSON.parse(match[0]);
        const out = typeof parsed?.text === "string" ? parsed.text.trim() : "";
        if (!out) return null;
        return {
            text: out,
            emotion: typeof parsed?.emotion === "string" ? parsed.emotion.trim().toLowerCase() : undefined,
        };
    } catch {
        return null;
    }
}

/** 身份有没有配语音；没配就完全不碰用户的语音条（与改造前行为一致）。 */
export function resolveIdentityVoiceConfig(identity: UserIdentity | null | undefined) {
    if (!identity?.voiceConfigId) return null;
    return loadVoiceConfigs().find(config => config.id === identity.voiceConfigId) || null;
}

/** 真录的音原样保留，只有"没录音、只打了字"的语音条才现做。 */
export function shouldSynthesizeUserVoice(msg: ChatMessage, identity: UserIdentity | null | undefined): boolean {
    if (msg.role !== "user" || msg.mediaType !== "audio") return false;
    if (msg.mediaUrl) return false;
    return Boolean(resolveIdentityVoiceConfig(identity));
}

export async function generateUserVoice(params: {
    text: string;
    identity: UserIdentity;
    /** 改写时要看的完整对话上下文（世界书/预设/角色卡/聊天记录都在里面） */
    buildContextMessages?: () => Promise<LLMMessage[]>;
    /** 没单独指定小模型时用哪个（一般传该会话正在用的配置） */
    fallbackApiConfig?: ApiConfig | null;
}): Promise<UserVoiceResult> {
    const voiceConfig = resolveIdentityVoiceConfig(params.identity);
    if (!voiceConfig) throw new Error("这个身份没有绑定语音配置");

    const capability = getVoiceStyleCapability(voiceConfig);
    let spokenText = params.text;
    let emotion: string | undefined;

    if (params.identity.voiceRewriteEnabled && params.buildContextMessages) {
        const rewrite = await rewriteForSpeech(params, capability);
        if (rewrite) {
            spokenText = rewrite.text;
            emotion = rewrite.emotion;
        }
        // 改写失败就用原文继续合成——宁可念中文，也别让用户点了没反应
    }

    const blob = await synthesizeSpeech(spokenText, voiceConfig, { emotion });
    if (!blob) throw new Error("语音合成没有返回音频");
    return { spokenText, blob, emotion };
}

async function rewriteForSpeech(
    params: Parameters<typeof generateUserVoice>[0],
    capability: ReturnType<typeof getVoiceStyleCapability>,
): Promise<RewriteOutput | null> {
    const { sendLLMRequest } = await import("./chat-engine");
    const apiConfig = params.identity.voiceRewriteApiConfigId
        ? loadApiConfigs().find(config => config.id === params.identity.voiceRewriteApiConfigId) || null
        : params.fallbackApiConfig || null;
    // 指定了小模型却找不到（被删了）就别偷偷用贵的那个，直接放弃改写
    if (params.identity.voiceRewriteApiConfigId && !apiConfig) return null;
    if (!apiConfig) return null;

    const context = await params.buildContextMessages!();
    const messages: LLMMessage[] = [
        ...context,
        {
            role: "user",
            content: `${buildRewriteInstruction(params.identity, capability)}\n\n待改写的台词：${params.text}`,
        },
    ];

    try {
        // preset 传 null、regexes 传空：这一步要的是干净的技术输出，
        // 不能让输出正则把 JSON 改花，也不需要再叠一层预设。
        const raw = await sendLLMRequest(apiConfig, null, messages, [], undefined, {
            skipOutputRegex: true,
            appId: "chat",
            appTags: ["chat", "voice_rewrite"],
        });
        return parseRewriteOutput(typeof raw === "string" ? raw : String(raw ?? ""));
    } catch (error) {
        console.warn("[UserVoice] 改写失败，改用原文合成:", error);
        return null;
    }
}
