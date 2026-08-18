type ChatInputKeyboardEvent = {
    key: string;
    shiftKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    nativeEvent?: {
        isComposing?: boolean;
    };
};

export function shouldSendChatInputOnEnter(event: ChatInputKeyboardEvent, enterToSendEnabled: boolean): boolean {
    if (event.key !== "Enter") return false;
    // Android keyboards may report keyCode 229 for ordinary Latin/numeric Enter,
    // so keyCode alone cannot be used as an IME-composition signal.
    if (event.nativeEvent?.isComposing) return false;
    if (event.ctrlKey || event.metaKey) return true;
    return enterToSendEnabled && !event.shiftKey && !event.altKey;
}
