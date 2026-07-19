import { parseStateValues } from "./state-value-parser";

export function stripStateAndInnerForPrompt(text: string): string {
    if (!text) return "";
    const withoutState = parseStateValues(text).cleanText;
    return withoutState
        .replace(/\[状态栏\][\s\S]*?\[\/状态栏\]/g, "")
        .replace(/\[内心\][\s\S]*?\[\/内心\]/g, "")
        // Chain-of-thought never goes back to the model. parseAIResponse already
        // strips it before storage, but history can also come from raw/imported
        // content (cloud sync, edited messages, story mode) that never passed
        // through it — so drop it here too, spanning first open → last close.
        // (greedy, so it spans first open → LAST close; second pass mops up an
        // unclosed opener left by a truncated response)
        .replace(/<\s*(?:think|thinking)\b[^>]*>[\s\S]*<\s*\/\s*(?:think|thinking)\s*>/gi, "")
        .replace(/<\s*(?:think|thinking)\b[^>]*>[\s\S]*$/gi, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}
