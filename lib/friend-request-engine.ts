// lib/friend-request-engine.ts
// Handles AI reaction when a user deletes a friend.
// The AI can choose to send a friend request (up to 3 rounds) or give up.

import { loadCharacters } from "./character-storage";
import { appNowISO } from "./app-clock";
import {
    ChatSession,
    loadChatSessions,
    loadChatMessages,
    pushChatMessage,
    addChatContact,
    createOrGetSession,
    saveChatSessions,
} from "./chat-storage";
import { generateChatCompletion, flattenCompletionResult } from "./chat-engine";
import { resolveUserIdentity } from "./settings-storage";

export const PENDING_REPLY_PREFIX = "pending_friend_reply_";
registerDynamicPrefix(PENDING_REPLY_PREFIX);
import {
    addFriendRequest,
    getLatestRequestForCharacter,
    clearRequestsForCharacter,
    dispatchFriendRequestUpdated,
} from "./friend-request-storage";
import type { ContentAppId } from "./settings-types";
import { kvSet, registerDynamicPrefix } from "./kv-db";

const MAX_ROUNDS = 3;

/**
 * Trigger AI reaction after user deletes a friend.
 * Fire-and-forget — call from settings panel, results appear in "新的朋友" UI.
 */
export async function triggerDeleteFriendReaction(characterId: string): Promise<void> {
    const chars = loadCharacters();
    const char = chars.find(c => c.id === characterId);
    if (!char) return;

    const userName = resolveUserIdentity(characterId, "chat")?.name ?? "用户";

    // Find the session (still exists after contact removal)
    const sessions = loadChatSessions();
    const session = sessions.find(s => !s.isGroup && s.contactId === characterId);
    if (!session) return;

    // Push system message recording the deletion
    pushChatMessage({
        sessionId: session.id,
        role: "system",
        content: `${char.name}已被${userName}删除好友`,
    });

    // Call LLM for AI reaction
    await generateAndStoreFriendRequest(session, characterId, 1);
}

/**
 * Trigger AI reaction after user rejects a friend request.
 * If round < MAX_ROUNDS, the AI gets another chance.
 */
export async function triggerRejectReaction(characterId: string): Promise<void> {
    const chars = loadCharacters();
    const char = chars.find(c => c.id === characterId);
    if (!char) return;

    const userName = resolveUserIdentity(characterId, "chat")?.name ?? "用户";
    const latest = getLatestRequestForCharacter(characterId);
    const currentRound = latest?.round ?? 1;

    if (currentRound >= MAX_ROUNDS) return; // No more attempts

    const sessions = loadChatSessions();
    const session = sessions.find(s => !s.isGroup && s.contactId === characterId);
    if (!session) return;

    // Push system message recording the rejection
    pushChatMessage({
        sessionId: session.id,
        role: "system",
        content: `${userName}拒绝了${char.name}的好友申请`,
    });

    // Call LLM for next round
    await generateAndStoreFriendRequest(session, characterId, currentRound + 1);
}

/**
 * Handle user accepting a friend request.
 * Re-adds contact, records system messages, triggers AI chat reply.
 */
export async function handleAcceptFriendRequest(
    characterId: string,
    requestMessage: string,
): Promise<ChatSession> {
    const chars = loadCharacters();
    const char = chars.find(c => c.id === characterId);
    const userName = resolveUserIdentity(characterId, "chat")?.name ?? "用户";

    // Re-add to contacts
    addChatContact(characterId);

    // Get or create session
    const session = createOrGetSession(characterId);

    // Record acceptance
    pushChatMessage({
        sessionId: session.id,
        role: "system",
        content: `${userName}通过了${char?.name ?? "角色"}的好友申请`,
    });

    // Clean up friend requests for this character
    clearRequestsForCharacter(characterId);
    dispatchFriendRequestUpdated();

    // Reset autoReplied so the greeting flow doesn't interfere
    const sessions = loadChatSessions();
    const sessIdx = sessions.findIndex(s => s.id === session.id);
    if (sessIdx !== -1) {
        sessions[sessIdx].autoReplied = true; // Mark as handled
        saveChatSessions(sessions);
    }

    // Set flag for ChatRoom to trigger AI reply on mount
    if (typeof window !== "undefined") {
        kvSet(PENDING_REPLY_PREFIX + session.id, "1");
    }

    return session;
}

// ── Internal ──

async function generateAndStoreFriendRequest(
    session: ChatSession,
    characterId: string,
    round: number,
): Promise<void> {
    try {
        const messages = loadChatMessages(session.id);

        // Inject virtual round-info message (not saved to storage)
        const augmented = [...messages, {
            id: "virtual_round_hint",
            sessionId: session.id,
            role: "system" as const,
            content: `这是你第${round}次做出反应，你最多有${MAX_ROUNDS}次机会。`,
            status: "sent" as const,
            createdAt: appNowISO(),
        }];

        const aiResponse = flattenCompletionResult(await generateChatCompletion(
            session,
            augmented,
            { appId: "add_friend" as ContentAppId },
        ));

        // Parse AI response: look for [添加好友]message or 放弃
        const parsed = parseAddFriendResponse(aiResponse);

        if (parsed.action === "abandon") {
            // AI chose to give up — no friend request created
            console.log(`[FriendRequest] AI chose to abandon for ${characterId} at round ${round}`);
            return;
        }

        if (parsed.action === "add" && parsed.message) {
            const chars = loadCharacters();
            const char = chars.find(c => c.id === characterId);
            const userName = resolveUserIdentity(characterId, "chat")?.name ?? "用户";

            // Record the friend request in chat history (enters short-term memory)
            pushChatMessage({
                sessionId: session.id,
                role: "system",
                content: `${char?.name ?? "角色"}向${userName}发起了好友申请，备注：${parsed.message}`,
            });

            // Store the friend request
            addFriendRequest(characterId, parsed.message, round);
            dispatchFriendRequestUpdated();
            console.log(`[FriendRequest] AI sent friend request for ${characterId}, round ${round}: "${parsed.message.slice(0, 50)}..."`);
        }
    } catch (err) {
        console.warn(`[FriendRequest] Failed to generate reaction for ${characterId}:`, err);
    }
}

function parseAddFriendResponse(text: string): { action: "add" | "abandon"; message?: string } {
    // Match [添加好友]message content
    const addMatch = text.match(/\[添加好友\]([\s\S]*?)(?:\[\/添加好友\]|$)/);
    if (addMatch) {
        return { action: "add", message: addMatch[1].trim() };
    }

    // Check for 放弃 keyword
    if (text.includes("放弃")) {
        return { action: "abandon" };
    }

    // Fallback: if the response doesn't match either format, treat entire response as friend request
    // (AI didn't follow format strictly)
    const cleaned = text
        .replace(/\[内心\][\s\S]*?\[\/内心\]/g, "")
        .replace(/\[好感度[^\]]*\]/g, "")
        .replace(/\[[^\]]*值[^\]]*\]/g, "")
        .trim();

    if (cleaned.length >= 5 && cleaned.length < 200) {
        return { action: "add", message: cleaned };
    }

    // Give up if we can't parse
    return { action: "abandon" };
}
