/**
 * Shared chain-of-thought extraction.
 *
 * One rule, used by every mode that surfaces model reasoning: take everything
 * between the FIRST <thinking> and the LAST </thinking>. Additional tag pairs in
 * between are swallowed into the same block rather than leaking their text back
 * into the reply — models routinely emit several sibling blocks for one turn.
 *
 * An unclosed opening tag means the response was truncated mid-thought; the
 * remainder is treated as thinking so it never renders as visible content.
 */

const THINK_OPEN_RX = /<\s*(?:think|thinking)\b[^>]*>/i;
const THINK_CLOSE_RX = /<\s*\/\s*(?:think|thinking)\s*>/gi;
const THINK_ANY_RX = /<\s*\/?\s*(?:think|thinking)\b[^>]*>/gi;

export type ExtractedThinking = {
    /** Text with the chain-of-thought span removed. */
    cleaned: string;
    /** The chain-of-thought itself, inner tags scrubbed. Empty when absent. */
    content: string;
};

export function extractThinkingBlock(text: string): ExtractedThinking {
    const open = THINK_OPEN_RX.exec(text);
    if (!open) return { cleaned: text, content: "" };

    const innerStart = open.index + open[0].length;
    let lastClose: RegExpExecArray | null = null;
    THINK_CLOSE_RX.lastIndex = 0;
    let match;
    while ((match = THINK_CLOSE_RX.exec(text)) !== null) {
        if (match.index >= innerStart) lastClose = match;
    }

    const innerEnd = lastClose ? lastClose.index : text.length;
    const resumeAt = lastClose ? lastClose.index + lastClose[0].length : text.length;

    return {
        content: text.slice(innerStart, innerEnd).replace(THINK_ANY_RX, "").trim(),
        cleaned: (text.slice(0, open.index) + text.slice(resumeAt)).trim(),
    };
}
