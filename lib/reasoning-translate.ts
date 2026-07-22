/**
 * 思维链翻译：调用绑定的「思维链翻译 API」（未设置时回退全局默认 API）
 * 把思考过程文本翻译成简体中文。带内存级缓存，避免重复请求计费。
 */
import { resolveAuxiliaryApiConfig } from "./settings-storage";
import { simpleLLMCall } from "./api-helpers";

const TRANSLATE_SYSTEM_PROMPT = [
    "你是资深中文译者。把用户提供的内容翻译成地道、自然的简体中文。",
    "",
    "要求：",
    "- 摆脱原文句式的束缚，按中文的表达习惯重新组织句子，坚决避免翻译腔（如「这正是为什么」「如此地」「被…所…」「进行了…」等欧化句式）",
    "- 待译内容多为角色的内心独白或思考过程：译文要像这个人在心里自言自语，口语化、有情绪、有节奏，不要译成书面报告体",
    "- 人名、称呼、专有名词沿用原文或上下文中已有的译法，不要另起译名",
    "- 保留原有段落结构与 Markdown 格式（加粗、列表等）",
    "- 完整翻译，不删减、不解释、不评论，只输出译文",
].join("\n");

const cache = new Map<string, string>();
const CACHE_MAX = 50;

export async function translateReasoningText(
    text: string,
    options?: { signal?: AbortSignal },
): Promise<{ content?: string; error?: string }> {
    const trimmed = (text || "").trim();
    if (!trimmed) return { error: "没有可翻译的内容" };

    const cached = cache.get(trimmed);
    if (cached) return { content: cached };

    const apiConfig = resolveAuxiliaryApiConfig("reasoningTranslateApiConfigId");
    if (!apiConfig) {
        return { error: "请先在设置 → 绑定配置 → 辅助 API 中设置思维链翻译 API（或设置全局默认 API）" };
    }

    // 默认 90 秒超时，避免请求挂死导致调用方一直处于「翻译中」状态
    const controller = options?.signal ? null : new AbortController();
    const timer = controller ? setTimeout(() => controller.abort(), 90_000) : null;
    try {
        const result = await simpleLLMCall(apiConfig, [
            { role: "system", content: TRANSLATE_SYSTEM_PROMPT },
            { role: "user", content: trimmed },
        ], { temperature: 0.6, signal: options?.signal ?? controller?.signal });

        if (!result.content?.trim()) {
            return { error: result.error || "翻译失败，请重试" };
        }

        if (cache.size >= CACHE_MAX) {
            const oldest = cache.keys().next().value;
            if (oldest !== undefined) cache.delete(oldest);
        }
        cache.set(trimmed, result.content.trim());
        return { content: result.content.trim() };
    } catch (e) {
        if (controller?.signal.aborted) return { error: "翻译超时，请重试" };
        return { error: e instanceof Error ? e.message : "翻译失败，请重试" };
    } finally {
        if (timer) clearTimeout(timer);
    }
}
