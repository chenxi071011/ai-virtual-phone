"use client";

import { useState } from "react";
import { BookOpenText, LocateFixed, Minus, Plus, Repeat2, Rocket, RotateCcw, Settings } from "lucide-react";
import { ContentDialog } from "@/components/ui/modal";
import { Toggle } from "@/components/ui/form";
import {
    loadReadingInteractionConfig,
    saveReadingInteractionConfig,
    type ReadingInteractionConfig,
    type ReadingParagraphMode,
    type ReadingViewMode,
} from "@/lib/reading-storage";

const PARAGRAPH_MODE_OPTIONS: { value: ReadingParagraphMode; label: string; desc: string }[] = [
    { value: "auto", label: "自动", desc: "自动识别书的段落格式（推荐）" },
    { value: "blank", label: "空行", desc: "段落之间有空行（标准导出格式）" },
    { value: "indent", label: "段首缩进", desc: "每段以全角空格缩进、无空行" },
    { value: "line", label: "每行一段", desc: "纯回车换行分段落（无空行无缩进）" },
];

const VIEW_MODE_OPTIONS: { value: ReadingViewMode; label: string; desc: string }[] = [
    { value: "page", label: "翻页", desc: "一屏一页，左右点击/滑动翻页" },
    { value: "scroll", label: "滚动", desc: "连续滚动阅读，上下滑动翻读" },
];

const RETRY_MIN = 0;
const RETRY_MAX = 5;

/** 批注预生成触发时机：读到上一批批注的比例 */
const PREFETCH_THRESHOLD_OPTIONS: { value: number; label: string; desc: string }[] = [
    { value: 1 / 2, label: "读到一半", desc: "预留生成时间更充足" },
    { value: 2 / 3, label: "读到 2/3", desc: "默认推荐" },
    { value: 3 / 4, label: "读到 3/4", desc: "接近读完才生成" },
];

/** 浮点档位比较容差 */
function prefetchThresholdMatches(a: number, b: number): boolean {
    return Math.abs(a - b) < 0.01;
}

type Props = {
    onClose: () => void;
};

/** 阅读交互设置：导入段落划分 / 阅读模式 / 自动批注失败静默重试次数 */
export function ReadingInteractionDialog({ onClose }: Props) {
    const [config, setConfig] = useState<ReadingInteractionConfig>(() => loadReadingInteractionConfig());
    const [saving, setSaving] = useState(false);

    const handleSave = () => {
        setSaving(true);
        saveReadingInteractionConfig(config);
        setSaving(false);
        // 阅读器保持挂载，通过事件让它在下次显示时同步新配置
        if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("reading-interaction-config-changed"));
        }
        onClose();
    };

    const setRetry = (delta: number) => {
        setConfig((prev) => ({
            ...prev,
            annotationRetryCount: Math.max(RETRY_MIN, Math.min(RETRY_MAX, prev.annotationRetryCount + delta)),
        }));
    };

    return (
        <ContentDialog
            title="阅读设置"
            confirmLabel={saving ? "保存中..." : "保存"}
            cancelLabel="取消"
            onConfirm={handleSave}
            onCancel={onClose}
        >
            <div className="reading-settings-grid">
                <section className="reading-settings-group">
                    <div className="reading-settings-heading">
                        <Settings size={15} />
                        <span>导入段落划分</span>
                    </div>
                    <p className="reading-settings-inline-note">
                        <span>导入 TXT 小说时如何划分段落。选错可在导入后重新导入生效。</span>
                    </p>
                    <div className="reading-option-grid">
                        {PARAGRAPH_MODE_OPTIONS.map((opt) => (
                            <button
                                key={opt.value}
                                type="button"
                                className={`reading-option-card ${config.paragraphMode === opt.value ? "is-active" : ""}`}
                                onClick={() => setConfig((prev) => ({ ...prev, paragraphMode: opt.value }))}
                            >
                                <span className="reading-option-card-label">{opt.label}</span>
                                <span className="reading-option-card-desc">{opt.desc}</span>
                            </button>
                        ))}
                    </div>
                </section>

                <section className="reading-settings-group">
                    <div className="reading-settings-heading">
                        <BookOpenText size={15} />
                        <span>阅读模式</span>
                    </div>
                    <p className="reading-settings-inline-note">
                        <span>切换后重新打开书籍生效。</span>
                    </p>
                    <div className="reading-option-grid reading-option-grid--two">
                        {VIEW_MODE_OPTIONS.map((opt) => (
                            <button
                                key={opt.value}
                                type="button"
                                className={`reading-option-card ${config.readingMode === opt.value ? "is-active" : ""}`}
                                onClick={() => setConfig((prev) => ({ ...prev, readingMode: opt.value }))}
                            >
                                <span className="reading-option-card-label">{opt.label}</span>
                                <span className="reading-option-card-desc">{opt.desc}</span>
                            </button>
                        ))}
                    </div>
                </section>

                <section className="reading-settings-group">
                    <div className="reading-settings-heading">
                        <Repeat2 size={15} />
                        <span>自动批注失败重试</span>
                    </div>
                    <p className="reading-settings-inline-note">
                        <span>生成失败时静默重试的次数，全部失败后才提示错误。</span>
                    </p>
                    <div className="reading-retry-row">
                        <button
                            type="button"
                            className="reading-retry-btn"
                            onClick={() => setRetry(-1)}
                            disabled={config.annotationRetryCount <= RETRY_MIN}
                            aria-label="减少重试次数"
                        >
                            <Minus size={15} strokeWidth={2} />
                        </button>
                        <span className="reading-retry-value">
                            {config.annotationRetryCount}
                            <em>次</em>
                        </span>
                        <button
                            type="button"
                            className="reading-retry-btn"
                            onClick={() => setRetry(1)}
                            disabled={config.annotationRetryCount >= RETRY_MAX}
                            aria-label="增加重试次数"
                        >
                            <Plus size={15} strokeWidth={2} />
                        </button>
                    </div>
                </section>

                <section className="reading-settings-group">
                    <div className="reading-settings-heading">
                        <Rocket size={15} />
                        <span>批注预生成</span>
                    </div>
                    <div className="reading-settings-toggle-row">
                        <span className="reading-settings-toggle-label">
                            提前生成下一批批注
                        </span>
                        <Toggle
                            checked={config.autoAnnotatePrefetch === true}
                            onChange={(next) => setConfig((prev) => ({ ...prev, autoAnnotatePrefetch: next }))}
                        />
                    </div>
                    {config.autoAnnotatePrefetch && (
                        <>
                            <p className="reading-settings-inline-note">
                                <span>读到上一批批注的多少时开始生成下一批：</span>
                            </p>
                            <div className="reading-option-grid reading-option-grid--three">
                                {PREFETCH_THRESHOLD_OPTIONS.map((opt) => (
                                    <button
                                        key={opt.value}
                                        type="button"
                                        className={`reading-option-card ${prefetchThresholdMatches(config.annotationPrefetchThreshold ?? 2 / 3, opt.value) ? "is-active" : ""}`}
                                        onClick={() => setConfig((prev) => ({ ...prev, annotationPrefetchThreshold: opt.value }))}
                                    >
                                        <span className="reading-option-card-label">{opt.label}</span>
                                        <span className="reading-option-card-desc">{opt.desc}</span>
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                    <p className="reading-settings-inline-note">
                        <span>利用读上一批批注的时间生成下一批，避免你读到时批注还没生成完。不会重复批注。</span>
                    </p>
                </section>

                <section className="reading-settings-group">
                    <div className="reading-settings-heading">
                        <LocateFixed size={15} />
                        <span>悬浮聊天窗</span>
                    </div>
                    <div className="reading-settings-toggle-row">
                        <span className="reading-settings-toggle-label">
                            展开时自动滚动到最新消息
                        </span>
                        <Toggle
                            checked={config.chatAutoScrollOnOpen !== false}
                            onChange={(next) => setConfig((prev) => ({ ...prev, chatAutoScrollOnOpen: next }))}
                        />
                    </div>
                    <p className="reading-settings-inline-note">
                        <span>打开讨论窗口时自动滚到最新消息；打开后你可自由上下滑动打断，不会被拉回。</span>
                    </p>
                    <p className="reading-settings-inline-note">
                        <span>悬浮球/悬浮条被拖到屏幕外、无法交互时，点此恢复到默认位置。</span>
                    </p>
                    <button
                        type="button"
                        className="reading-reset-float-btn"
                        onClick={() => {
                            if (typeof window !== "undefined") {
                                window.dispatchEvent(new CustomEvent("reading-chat-float-reset"));
                            }
                        }}
                    >
                        <RotateCcw size={15} strokeWidth={2} />
                        重置悬浮球位置
                    </button>
                </section>
            </div>
        </ContentDialog>
    );
}
