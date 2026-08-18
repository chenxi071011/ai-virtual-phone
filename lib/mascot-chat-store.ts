import { getMascotContext, type MascotPageContext } from "./mascot-context";
import { appNowISO } from "./app-clock";
import { mascotFillField } from "./mascot-events";
import {
    mascotChatWithTools,
    type MascotMsg,
} from "./mascot-engine";
import { PAGE_GREETINGS } from "./mascot-prompts";
import {
    buildMascotPackageSchemaPrompt,
    clearExpandedPackages,
    executeMascotToolCall,
    findPackageByLabel,
    getMascotNativeLoaderName,
    loadExpandedPackages,
    saveExpandedPackages,
    touchExpandedPackage,
    type MascotToolContext,
} from "./mascot-tools";
import { isMascotPanelOpen } from "./mascot-state";

const MASCOT_DB_NAME = "AiPhoneMascotDB";
const MASCOT_DB_VERSION = 2;
const MASCOT_CHAT_STORE = "chat";
const MASCOT_MESSAGES_KEY = "messages"; // 旧版单会话键，仅用于迁移
const MASCOT_STATE_KEY = "state";
const MAX_STORED_MASCOT_MESSAGES = 50;
const MAX_MASCOT_SESSIONS = 30;

export type MascotSession = {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    messages: MascotMsg[];
};

type PersistedMascotState = {
    sessions: MascotSession[];
    activeSessionId: string | null;
};

export type MascotChatSnapshot = {
    messages: MascotMsg[];
    sessions: MascotSession[];
    activeSessionId: string | null;
    hydrated: boolean;
    isThinking: boolean;
};

const listeners = new Set<() => void>();
let messages: MascotMsg[] = [];
let sessions: MascotSession[] = [];
let activeSessionId: string | null = null;
let hydrated = false;
let hydratePromise: Promise<void> | null = null;
let isThinking = false;
let abortRequested = false;
let abortController: AbortController | null = null;
let snapshot: MascotChatSnapshot = { messages, sessions, activeSessionId, hydrated, isThinking };

function openMascotDb(): IDBOpenDBRequest {
    const request = indexedDB.open(MASCOT_DB_NAME, MASCOT_DB_VERSION);
    request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(MASCOT_CHAT_STORE)) {
            request.result.createObjectStore(MASCOT_CHAT_STORE);
        }
    };
    return request;
}

function emit() {
    snapshot = { messages, sessions, activeSessionId, hydrated, isThinking };
    for (const listener of listeners) listener();
    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("mascot-chat-updated", { detail: snapshot }));
    }
}

function persistState() {
    if (typeof indexedDB === "undefined") return;
    try {
        const req = openMascotDb();
        req.onsuccess = () => {
            try {
                if (!req.result.objectStoreNames.contains(MASCOT_CHAT_STORE)) return;
                const tx = req.result.transaction(MASCOT_CHAT_STORE, "readwrite");
                const state: PersistedMascotState = { sessions, activeSessionId };
                tx.objectStore(MASCOT_CHAT_STORE).put(state, MASCOT_STATE_KEY);
                tx.oncomplete = () => req.result.close();
                tx.onerror = () => req.result.close();
            } catch {
                // Keep in-memory chat usable even if persistence fails.
            }
        };
    } catch {
        // Ignore IndexedDB availability issues.
    }
}

function withTimestamp(msg: MascotMsg): MascotMsg {
    return msg.createdAt ? msg : { ...msg, createdAt: appNowISO() };
}

function normalizeMessages(nextMessages: MascotMsg[]): MascotMsg[] {
    return nextMessages.map(withTimestamp).slice(-MAX_STORED_MASCOT_MESSAGES);
}

export type ClearMascotToolHistoryResult = {
    messages: MascotMsg[];
    deletedMessages: number;
    cleanedMessages: number;
};

export type DeleteMascotMessageWithLinkedToolsResult = {
    messages: MascotMsg[];
    deletedMessages: number;
    cleanedMessages: number;
};

export function isMascotToolHistoryMessage(msg: MascotMsg): boolean {
    return msg.role === "tool";
}

export function hasMascotNativeToolReplayMetadata(msg: MascotMsg): boolean {
    return msg.toolCalls !== undefined
        || msg.reasoning !== undefined
        || msg.openRouterReasoningDetails !== undefined;
}

function hasVisibleMascotPayload(msg: MascotMsg): boolean {
    const display = (msg.displayText || "").trim();
    return !!msg.text.trim()
        || (!!display && display !== "（调用工具中...）" && display !== "（无内容）")
        || !!msg.images?.length;
}

export function hasMascotToolHistoryMessages(nextMessages: MascotMsg[]): boolean {
    return nextMessages.some((msg) => (
        isMascotToolHistoryMessage(msg) || hasMascotNativeToolReplayMetadata(msg)
    ));
}

export function clearMascotToolHistoryMessages(nextMessages: MascotMsg[]): ClearMascotToolHistoryResult {
    let deletedMessages = 0;
    let cleanedMessages = 0;
    const cleanedMessagesList: MascotMsg[] = [];

    for (const msg of nextMessages) {
        if (isMascotToolHistoryMessage(msg)) {
            deletedMessages += 1;
            continue;
        }

        if (!hasMascotNativeToolReplayMetadata(msg)) {
            cleanedMessagesList.push(msg);
            continue;
        }

        const cleaned: MascotMsg = { ...msg };
        delete cleaned.toolCalls;
        delete cleaned.reasoning;
        delete cleaned.openRouterReasoningDetails;

        if (msg.role === "mascot" && !hasVisibleMascotPayload(cleaned)) {
            deletedMessages += 1;
            continue;
        }

        cleanedMessages += 1;
        cleanedMessagesList.push(cleaned);
    }

    return { messages: cleanedMessagesList, deletedMessages, cleanedMessages };
}

function collectMascotToolCallIds(msg: MascotMsg): Set<string> {
    const ids = new Set<string>();
    if (msg.toolCallId) ids.add(msg.toolCallId);
    for (const call of msg.toolCalls || []) {
        if (call.id) ids.add(call.id);
    }
    return ids;
}

function removeToolCallsFromMascotMessage(msg: MascotMsg, idsToRemove: Set<string>): {
    message: MascotMsg | null;
    cleaned: boolean;
} {
    if (!msg.toolCalls?.length) return { message: msg, cleaned: false };

    const keptToolCalls = msg.toolCalls.filter((call) => !idsToRemove.has(call.id));
    if (keptToolCalls.length === msg.toolCalls.length) return { message: msg, cleaned: false };

    const cleaned: MascotMsg = { ...msg };
    if (keptToolCalls.length > 0) {
        cleaned.toolCalls = keptToolCalls;
    } else {
        delete cleaned.toolCalls;
    }

    if (!hasVisibleMascotPayload(cleaned) && !cleaned.toolCalls?.length) {
        return { message: null, cleaned: true };
    }

    return { message: cleaned, cleaned: true };
}

export function deleteMascotMessageWithLinkedTools(
    nextMessages: MascotMsg[],
    rawIndex: number,
): DeleteMascotMessageWithLinkedToolsResult {
    const target = nextMessages[rawIndex];
    if (!target) return { messages: nextMessages, deletedMessages: 0, cleanedMessages: 0 };

    const idsToRemove = collectMascotToolCallIds(target);
    const indexesToDelete = new Set<number>([rawIndex]);
    const replacements = new Map<number, MascotMsg>();
    let cleanedMessages = 0;

    if (idsToRemove.size > 0) {
        nextMessages.forEach((msg, index) => {
            if (index !== rawIndex && msg.role === "tool" && msg.toolCallId && idsToRemove.has(msg.toolCallId)) {
                indexesToDelete.add(index);
                return;
            }

            if (index !== rawIndex && msg.role === "mascot" && msg.toolCalls?.length) {
                const result = removeToolCallsFromMascotMessage(msg, idsToRemove);
                if (!result.cleaned) return;
                cleanedMessages += 1;
                if (result.message) {
                    replacements.set(index, result.message);
                } else {
                    indexesToDelete.add(index);
                }
            }
        });
    } else if (target.role === "mascot") {
        for (let i = rawIndex + 1; i < nextMessages.length; i += 1) {
            const msg = nextMessages[i];
            if (msg.role !== "tool") break;
            if (msg.toolCallId) break;
            indexesToDelete.add(i);
        }
    } else if (target.role === "tool") {
        for (let i = rawIndex - 1; i >= 0; i -= 1) {
            const msg = nextMessages[i];
            if (msg.role === "tool") continue;
            if (msg.role === "mascot" && !hasVisibleMascotPayload(msg)) indexesToDelete.add(i);
            break;
        }
    }

    let deletedMessages = 0;
    const messagesAfterDelete: MascotMsg[] = [];
    nextMessages.forEach((msg, index) => {
        if (indexesToDelete.has(index)) {
            deletedMessages += 1;
            return;
        }
        messagesAfterDelete.push(replacements.get(index) || msg);
    });

    return { messages: messagesAfterDelete, deletedMessages, cleanedMessages };
}

function makeMascotSessionId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function autoMascotSessionTitle(text: string): string {
    const compact = text.replace(/\s+/g, " ").trim();
    return compact.length > 18 ? `${compact.slice(0, 18)}…` : compact || "新对话";
}

function getActiveMascotSession(): MascotSession | null {
    return sessions.find((session) => session.id === activeSessionId) ?? null;
}

function publishMessages(nextMessages: MascotMsg[], options: { persist?: boolean } = {}) {
    messages = normalizeMessages(nextMessages);
    const active = getActiveMascotSession();
    if (active) {
        const now = Date.now();
        sessions = sessions
            .map((session) => session.id === active.id
                ? { ...session, messages, updatedAt: now }
                : session)
            .sort((a, b) => b.updatedAt - a.updatedAt);
    }
    if (options.persist !== false) persistState();
    emit();
}

function setThinking(next: boolean) {
    isThinking = next;
    emit();
}

export function subscribeMascotChat(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function getMascotChatSnapshot(): MascotChatSnapshot {
    return snapshot;
}

export function setMascotMessages(updater: MascotMsg[] | ((prev: MascotMsg[]) => MascotMsg[])) {
    const next = typeof updater === "function" ? updater(messages) : updater;
    publishMessages(next);
}

export function createMascotSession(): string | null {
    if (!hydrated || isThinking) return null;
    clearExpandedPackages();
    const now = Date.now();
    const greeting = defaultGreetingMessage();
    const session: MascotSession = {
        id: makeMascotSessionId(),
        title: "新对话",
        createdAt: now,
        updatedAt: now,
        messages: greeting ? [greeting] : [],
    };
    sessions = [session, ...sessions].slice(0, MAX_MASCOT_SESSIONS);
    activeSessionId = session.id;
    messages = session.messages;
    persistState();
    emit();
    return session.id;
}

export function switchMascotSession(sessionId: string): boolean {
    if (!hydrated || isThinking) return false;
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) return false;
    activeSessionId = session.id;
    messages = normalizeMessages(session.messages);
    persistState();
    emit();
    return true;
}

export function renameMascotSession(sessionId: string, title: string): boolean {
    const nextTitle = title.replace(/\s+/g, " ").trim();
    if (!nextTitle || !hydrated || isThinking || !sessions.some((session) => session.id === sessionId)) return false;
    sessions = sessions.map((session) => session.id === sessionId ? { ...session, title: nextTitle } : session);
    persistState();
    emit();
    return true;
}

export function deleteMascotSession(sessionId: string): boolean {
    if (!hydrated || isThinking || !sessions.some((session) => session.id === sessionId)) return false;
    sessions = sessions.filter((session) => session.id !== sessionId);
    if (activeSessionId === sessionId) {
        activeSessionId = sessions[0]?.id ?? null;
        messages = sessions[0]?.messages ?? [];
    }
    if (sessions.length === 0) {
        const now = Date.now();
        const greeting = defaultGreetingMessage();
        const replacement: MascotSession = {
            id: makeMascotSessionId(),
            title: "新对话",
            createdAt: now,
            updatedAt: now,
            messages: greeting ? [greeting] : [],
        };
        sessions = [replacement];
        activeSessionId = replacement.id;
        messages = replacement.messages;
    }
    persistState();
    emit();
    return true;
}

function defaultGreetingMessage(): MascotMsg | null {
    const greeting = PAGE_GREETINGS["desktop"];
    return greeting ? { role: "mascot", text: greeting, createdAt: appNowISO() } : null;
}

export function resetMascotConversation(options: { withGreeting?: boolean } = {}) {
    const withGreeting = options.withGreeting !== false;
    clearExpandedPackages();
    const greeting = withGreeting ? defaultGreetingMessage() : null;
    publishMessages(greeting ? [greeting] : []);
}

export async function hydrateMascotChat(): Promise<void> {
    if (hydrated) return;
    if (hydratePromise) return hydratePromise;
    hydratePromise = new Promise<void>((resolve) => {
        const finishWithMessages = (loaded: MascotMsg[], migrated: boolean) => {
            const greeting = loaded.length > 0 ? null : defaultGreetingMessage();
            messages = greeting ? [greeting] : loaded;
            const now = Date.now();
            const session: MascotSession = {
                id: makeMascotSessionId(),
                title: migrated && loaded.length > 0 ? "之前的对话" : "新对话",
                createdAt: now,
                updatedAt: now,
                messages,
            };
            sessions = [session];
            activeSessionId = session.id;
            hydrated = true;
            persistState();
            emit();
            resolve();
        };

        if (typeof indexedDB === "undefined") {
            finishWithMessages([], false);
            return;
        }
        const req = openMascotDb();
        req.onsuccess = () => {
            try {
                if (!req.result.objectStoreNames.contains(MASCOT_CHAT_STORE)) {
                    req.result.close();
                    finishWithMessages([], false);
                    return;
                }
                const tx = req.result.transaction(MASCOT_CHAT_STORE, "readonly");
                const store = tx.objectStore(MASCOT_CHAT_STORE);
                const stateGet = store.get(MASCOT_STATE_KEY);
                stateGet.onsuccess = () => {
                    const state = stateGet.result as PersistedMascotState | undefined;
                    if (state && Array.isArray(state.sessions) && state.sessions.length > 0) {
                        sessions = state.sessions
                            .filter((session) => session && typeof session.id === "string" && Array.isArray(session.messages))
                            .map((session) => ({ ...session, messages: normalizeMessages(session.messages) }))
                            .sort((a, b) => b.updatedAt - a.updatedAt)
                            .slice(0, MAX_MASCOT_SESSIONS);
                        activeSessionId = state.activeSessionId && sessions.some((session) => session.id === state.activeSessionId)
                            ? state.activeSessionId
                            : sessions[0]?.id ?? null;
                        messages = sessions.find((session) => session.id === activeSessionId)?.messages ?? [];
                        hydrated = true;
                        emit();
                        req.result.close();
                        resolve();
                        return;
                    }

                    // 首次升级：保留旧键，并将旧版单会话记录复制进多会话 state。
                    const legacyGet = store.get(MASCOT_MESSAGES_KEY);
                    legacyGet.onsuccess = () => {
                        const loaded = Array.isArray(legacyGet.result) ? normalizeMessages(legacyGet.result) : [];
                        req.result.close();
                        finishWithMessages(loaded, loaded.length > 0);
                    };
                    legacyGet.onerror = () => {
                        req.result.close();
                        finishWithMessages([], false);
                    };
                };
                stateGet.onerror = () => {
                    req.result.close();
                    finishWithMessages([], false);
                };
            } catch {
                try { req.result.close(); } catch {}
                finishWithMessages([], false);
            }
        };
        req.onerror = () => finishWithMessages([], false);
    });
    return hydratePromise;
}

export function stopMascotGeneration() {
    abortRequested = true;
    abortController?.abort();
}

export async function appendMascotMessage({
    text,
    images = [],
}: {
    text: string;
    images?: string[];
}): Promise<boolean> {
    await hydrateMascotChat();
    const trimmed = text.trim();
    if ((!trimmed && images.length === 0) || isThinking) return false;

    const userMsg: MascotMsg = images.length > 0
        ? { role: "user", text: trimmed, images, createdAt: appNowISO() }
        : { role: "user", text: trimmed, createdAt: appNowISO() };
    const shouldAutoTitle = !messages.some((msg) => msg.role === "user");
    const workingMessages = normalizeMessages([...messages, userMsg]);
    if (shouldAutoTitle && activeSessionId) {
        sessions = sessions.map((session) => session.id === activeSessionId
            ? { ...session, title: autoMascotSessionTitle(trimmed || "（图片）") }
            : session);
    }
    publishMessages(workingMessages);
    return true;
}

export async function generateMascotReply({
    context = getMascotContext(),
}: {
    context?: MascotPageContext;
} = {}): Promise<void> {
    await hydrateMascotChat();
    if (isThinking) return;
    const latestVisibleMessage = [...messages].reverse().find((msg) => !msg.hidden && msg.role !== "tool");
    if (latestVisibleMessage?.role !== "user") return;

    let workingMessages = normalizeMessages(messages);
    setThinking(true);

    const MAX_ROUNDS = 8;
    abortRequested = false;
    const controller = new AbortController();
    abortController = controller;
    let expandedPackageIds = loadExpandedPackages();
    // 每次用户发送消息就是一次独立任务；最多 8 轮工具调用共享同一备份集合。
    const toolCtx: MascotToolContext = {
        pageContext: context,
        history: workingMessages,
        characterBackupIds: new Set<string>(),
    };

    try {
        for (let round = 0; round < MAX_ROUNDS; round += 1) {
            if (abortRequested) break;

            let streamedDisplay = "";
            let lastStreamPaintAt = 0;
            let lastStreamPaintLength = 0;
            const streamToolIds = new Set<string>();
            const streamToolMessages: MascotMsg[] = [];
            const paintStream = async (force = false) => {
                const now = Date.now();
                if (!force && streamedDisplay.length - lastStreamPaintLength < 12 && now - lastStreamPaintAt < 50) return;
                lastStreamPaintAt = now;
                lastStreamPaintLength = streamedDisplay.length;
                const liveItems: MascotMsg[] = [];
                if (streamedDisplay.trim()) {
                    liveItems.push({
                        role: "mascot",
                        text: streamedDisplay,
                        displayText: streamedDisplay,
                        createdAt: appNowISO(),
                    });
                }
                liveItems.push(...streamToolMessages.map(withTimestamp));
                publishMessages([...workingMessages, ...liveItems], { persist: false });
                await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            };

            const response = await mascotChatWithTools(
                context,
                workingMessages,
                expandedPackageIds,
                {
                    signal: controller.signal,
                    callbacks: {
                        async onAssistantDelta(delta) {
                            if (!delta) return;
                            streamedDisplay += delta;
                            await paintStream(false);
                        },
                        async onToolCallStart(info) {
                            if (streamToolIds.has(info.id)) return;
                            streamToolIds.add(info.id);
                            streamToolMessages.push({
                                role: "tool",
                                text: "",
                                hidden: false,
                                displayText: `正在调用 ${info.name}…`,
                                toolName: info.name,
                                toolDisplayName: info.name,
                                createdAt: appNowISO(),
                            });
                            await paintStream(true);
                        },
                        async onStreamFallback(reason) {
                            console.warn("[Mascot] 流式输出不可用，已切换普通生成:", reason);
                        },
                    },
                },
            );
            if (streamedDisplay) await paintStream(true);

            const displayReply = response.reply.join("\n");
            const assistantMsg: MascotMsg = {
                role: "mascot",
                text: response.rawAssistant,
                displayText: displayReply || (response.toolCalls.length > 0 || response.toolFetches.length > 0 ? "（调用工具中...）" : "（无内容）"),
                createdAt: appNowISO(),
            };
            if (response.protocol === "native" && response.nativeToolCalls && response.nativeToolCalls.length > 0) {
                assistantMsg.toolCalls = response.nativeToolCalls;
            }
            if (response.protocol === "native" && response.reasoning) {
                assistantMsg.reasoning = response.reasoning;
            }
            if (response.protocol === "native" && response.openRouterReasoningDetails?.length) {
                assistantMsg.openRouterReasoningDetails = response.openRouterReasoningDetails;
            }
            workingMessages = normalizeMessages([...workingMessages, assistantMsg]);
            publishMessages(workingMessages);

            if (response.toolFetches.length > 0) {
                for (const fetch of response.toolFetches) {
                    const pkg = findPackageByLabel(fetch.name);
                    if (!pkg) continue;
                    expandedPackageIds = touchExpandedPackage(expandedPackageIds, pkg.id);
                    saveExpandedPackages(expandedPackageIds);

                    const guideContent = `「${pkg.label}」已展开，详细动作如下：\n${buildMascotPackageSchemaPrompt(pkg.label, response.protocol)}`;

                    if (response.protocol === "native") {
                        const loaderName = getMascotNativeLoaderName(pkg.id);
                        const loaderCall = response.nativeToolCalls?.find((call) => call.name === loaderName);
                        workingMessages = normalizeMessages([...workingMessages, {
                            role: "tool",
                            text: guideContent,
                            hidden: false,
                            displayText: `展开「${pkg.label}」工具集`,
                            toolCallId: loaderCall?.id || "",
                            toolName: loaderCall?.name || loaderName,
                            toolDisplayName: `展开${pkg.label}`,
                            toolSuccess: true,
                            createdAt: appNowISO(),
                        }]);
                    } else {
                        workingMessages = normalizeMessages([...workingMessages, {
                            role: "tool",
                            text: guideContent,
                            hidden: false,
                            displayText: `展开「${pkg.label}」工具集`,
                            toolName: `展开${pkg.label}`,
                            toolDisplayName: `展开${pkg.label}`,
                            toolSuccess: true,
                            createdAt: appNowISO(),
                        }]);
                    }
                    publishMessages(workingMessages);
                }
                continue;
            }

            if (response.toolCalls.length > 0) {
                for (let i = 0; i < response.toolCalls.length; i += 1) {
                    const call = response.toolCalls[i];
                    const nativeCall = response.protocol === "native"
                        ? response.nativeToolCalls?.[i]
                        : undefined;
                    const displayName = call.name;
                    const protocolName = nativeCall?.name || call.name;

                    const runningMessage: MascotMsg = {
                        role: "tool",
                        text: "",
                        hidden: false,
                        displayText: `正在调用 ${displayName}…`,
                        toolName: protocolName,
                        toolDisplayName: displayName,
                        createdAt: appNowISO(),
                    };
                    workingMessages = normalizeMessages([...workingMessages, runningMessage]);
                    const runningIdx = workingMessages.length - 1;
                    publishMessages(workingMessages);
                    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

                    // 复用同一上下文，确保多轮工具调用共享角色备份状态。
                    toolCtx.history = workingMessages;
                    const result = await executeMascotToolCall(call, toolCtx);
                    if (result.success) mascotFillField({ field: call.name, value: result.data || "" });

                    const resultText = result.success ? (result.data || "完成") : (result.error || "未知错误");
                    const updated = [...workingMessages];
                    updated[runningIdx] = {
                        role: "tool",
                        text: resultText,
                        hidden: false,
                        displayText: resultText,
                        images: result.mediaAttachments?.filter((attachment) => attachment.type === "image").map((attachment) => attachment.url),
                        toolCallId: nativeCall?.id || "",
                        toolName: protocolName,
                        toolDisplayName: displayName,
                        toolSuccess: result.success,
                        createdAt: updated[runningIdx]?.createdAt || appNowISO(),
                    };
                    workingMessages = normalizeMessages(updated);
                    publishMessages(workingMessages);
                }
                continue;
            }

            break;
        }

        if (abortRequested) {
            publishMessages([...workingMessages, { role: "user", text: "[用户中止了操作]", hidden: false, createdAt: appNowISO() }]);
        }
        if (!isMascotPanelOpen() && typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("global-notice", { detail: abortRequested ? "操作已中止" : "AI助手已完成操作 ✓" }));
        }
    } catch (err) {
        if ((err as Error).name !== "AbortError" && !abortRequested) {
            publishMessages([...workingMessages, { role: "mascot", text: `出错了...${(err as Error).message}`, createdAt: appNowISO() }]);
            if (!isMascotPanelOpen() && typeof window !== "undefined") {
                window.dispatchEvent(new CustomEvent("global-notice", { detail: "AI助手生成失败了..." }));
            }
        }
    } finally {
        setThinking(false);
        abortController = null;
    }
}

export async function sendMascotMessage({
    text,
    images = [],
    context = getMascotContext(),
}: {
    text: string;
    images?: string[];
    context?: MascotPageContext;
}): Promise<void> {
    const accepted = await appendMascotMessage({ text, images });
    if (accepted) await generateMascotReply({ context });
}

export function getMascotLastPreview(): string {
    const latest = [...messages].reverse().find((msg) => {
        if (msg.hidden || msg.role === "tool") return false;
        const text = (msg.displayText || msg.text || "").trim();
        return !!text && text !== "（调用工具中...）" && text !== "（无内容）";
    });
    if (!latest) return "可以帮你创建角色、预设、正则和 CSS";
    if (latest.role === "user") return latest.images?.length ? "[图片] " + latest.text : latest.text;
    return latest.displayText || latest.text;
}
