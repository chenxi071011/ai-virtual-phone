import { loadChatMessages, loadChatSessions } from "./chat-storage";
import { loadCharacters } from "./character-storage";
import {
    loadBindingConfig,
    loadPresets,
    loadRegexes,
    loadWorldBooks,
    resolveBinding,
    resolveUserIdentity,
} from "./settings-storage";
import { assemblePromptPayload, type LLMMessage } from "./llm-prompt-assembler";

/**
 * 给「用户语音改写」用的上下文。
 *
 * 走的是聊天本身那套 assemblePromptPayload——世界书、预设、角色卡、用户身份、
 * 最近的聊天记录都在里面，改写时才知道这句话是在什么语境下说的、该用什么语言。
 *
 * 只在历史长度上收了口：改写一句话不需要翻完整本聊天记录，取最近若干条足够，
 * 而且这一步很可能跑在便宜的小模型上，上下文越短越省。
 */

const REWRITE_HISTORY_LIMIT = 30;

export async function buildChatContextForVoiceRewrite(
    sessionId: string,
    characterId: string,
): Promise<LLMMessage[]> {
    const session = loadChatSessions().find(item => item.id === sessionId);
    const character = loadCharacters().find(item => item.id === characterId);
    if (!character) return [];

    const bindings = loadBindingConfig();
    const slot = resolveBinding(bindings, characterId, "chat");
    const preset = loadPresets().find(item => item.id === slot.presetId) || null;
    const worldBooks = loadWorldBooks().filter(book => (slot.worldBookIds || []).includes(book.id));
    const regexes = loadRegexes().filter(group => (slot.regexIds || []).includes(group.id));
    const userIdentity = resolveUserIdentity(characterId, "chat");

    const allMessages = loadChatMessages(sessionId);
    const history = allMessages.length > REWRITE_HISTORY_LIMIT
        ? allMessages.slice(-REWRITE_HISTORY_LIMIT)
        : allMessages;

    return assemblePromptPayload({
        character,
        history,
        preset,
        worldBooks,
        regexes,
        userIdentity,
        appId: "chat",
        appTags: session?.isGroup ? ["group_chat"] : ["chat", "text"],
        enableVision: false,
    });
}
