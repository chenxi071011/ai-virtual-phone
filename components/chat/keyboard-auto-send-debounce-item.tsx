"use client";

// 聊天设置面板里的「收起键盘后自动回复」设置项，自包含：
// 自己读写 keyboard-auto-send-config，不向面板要任何 props（sessionId 除外）。
// 挂载方式：在 chat-settings-panel.tsx 的任意 menu-group 里插一行
//   <KeyboardAutoSendDebounceItem sessionId={session.id} />
//
// 视觉与面板其他行保持一致：左侧彩色图标 + 标题/说明 + 右侧 Toggle；
// 开启后下面多一行等待秒数的输入框。开关关掉后行为与原版完全一致。

import { useState, type CSSProperties } from "react";
import { KeyboardOff } from "lucide-react";
import { Toggle } from "@/components/ui/form";
import {
    getKeyboardAutoSendDebounceMs,
    isKeyboardAutoSendEnabled,
    setSessionKeyboardAutoSendEnabled,
    setSessionKeyboardAutoSendDebounce,
    MAX_AUTO_SEND_DEBOUNCE_MS,
} from "@/lib/keyboard-auto-send-config";

export function KeyboardAutoSendDebounceItem({ sessionId }: { sessionId: string }) {
    const [enabled, setEnabled] = useState(() => isKeyboardAutoSendEnabled(sessionId));
    const [seconds, setSeconds] = useState(() => getKeyboardAutoSendDebounceMs(sessionId) / 1000);

    const commit = (value: number) => {
        const clamped = Math.max(0, Math.min(MAX_AUTO_SEND_DEBOUNCE_MS / 1000, value));
        if (!Number.isFinite(clamped)) return;
        setSeconds(clamped);
        setSessionKeyboardAutoSendDebounce(sessionId, Math.round(clamped * 1000));
    };

    return (
        <>
            <div className="menu-item">
                {/* 与面板其他行同款图标壳（chat-info-icon 吃 --icon-color 变量） */}
                <span className="chat-info-icon" style={{ "--icon-color": "var(--c-icon-teal, #2a9d8f)" } as CSSProperties}>
                    <KeyboardOff size={22} strokeWidth={1.75} />
                </span>
                <div className="menu-label-group">
                    <span className="menu-label">收起键盘后自动回复</span>
                    <span className="menu-desc">打完字收起键盘，TA 就会开始回；不用再点「触发回复」（只对本聊天生效）</span>
                </div>
                <div className="menu-right">
                    <Toggle
                        checked={enabled}
                        onChange={next => {
                            setEnabled(next);
                            setSessionKeyboardAutoSendEnabled(sessionId, next);
                        }}
                    />
                </div>
            </div>
            {/* 常驻 DOM、只用 display 收起：聊天信息页还有脚本在这组里动态插行
                （隐藏思维链），条件挂载会让 React 以「自定义 CSS」为锚重新插入，
                这行就会落到外来行的下面去 */}
            <label className="menu-item" style={enabled ? undefined : { display: "none" }}>
                <div className="menu-label-group" style={{ paddingLeft: 48 }}>
                    <span className="menu-label">收起后等几秒再回</span>
                    <span className="menu-desc">这几秒内又点回输入框，就当你还没说完，先不回</span>
                </div>
                <div className="menu-right">
                    <input
                        type="number"
                        inputMode="decimal"
                        autoComplete="off"
                        min={0}
                        max={MAX_AUTO_SEND_DEBOUNCE_MS / 1000}
                        step={0.5}
                        value={seconds}
                        onChange={e => commit(Number(e.target.value))}
                        className="ui-input h-8 w-16 text-center"
                    />
                </div>
            </label>
        </>
    );
}
