"use client";

import { useEffect, useMemo, useState } from "react";
import { appNowISO } from "@/lib/app-clock";
import { useCheckPhoneRefresh } from "@/lib/checkphone-refresh-tracker";
import { ChevronLeft, ChevronRight, RefreshCw, Search, Trash2 } from "lucide-react";
import { CheckPhoneBilingualText } from "@/components/checkphone/checkphone-bilingual-text";
import { ConfirmDialog } from "@/components/ui";
import type { Character } from "@/lib/character-types";
import type {
  CheckPhoneMessagesPayload,
  CheckPhoneMessageThread,
  CheckPhoneSnapshot,
} from "@/lib/checkphone-config";
import { generateCheckPhoneMessages } from "@/lib/checkphone-engine";
import { clearPhoneSnapshot, loadPhoneSnapshot, savePhoneSnapshot } from "@/lib/checkphone-storage";
import { formatChatUiTime } from "@/lib/chat-time";
import { CheckPhoneDebugErrorCard } from "./checkphone-debug-error-card";
import { normalizeBilingualTextInput, splitBilingualText } from "@/lib/bilingual-text";

type CheckPhoneMessagesPageProps = {
  character: Character;
  onBack: () => void;
};

function getThreadKindLabel(kind: CheckPhoneMessageThread["kind"]): string {
  switch (kind) {
    case "verification":
      return "验证码";
    case "transaction":
      return "支付提醒";
    case "logistics":
      return "物流通知";
    case "personal":
      return "联系人";
    default:
      return "服务消息";
  }
}

function getMessagesListPlainText(text: string): string {
  const normalized = normalizeBilingualTextInput(text);
  return splitBilingualText(normalized)?.original ?? normalized;
}

export function CheckPhoneMessagesPage({ character, onBack }: CheckPhoneMessagesPageProps) {
  const [snapshot, setSnapshot] = useState<CheckPhoneSnapshot<CheckPhoneMessagesPayload> | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useCheckPhoneRefresh(character.id, "messages", setSnapshot);
  const [error, setError] = useState<string | null>(null);
  const [debugRawOutput, setDebugRawOutput] = useState<string | null>(null);
  const [debugSanitizedOutput, setDebugSanitizedOutput] = useState<string | null>(null);
  const [debugParseMode, setDebugParseMode] = useState<"raw" | "sanitized" | "failed" | null>(null);
  const [debugParseError, setDebugParseError] = useState<string | null>(null);
  const [debugNormalizeError, setDebugNormalizeError] = useState<string | null>(null);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setError(null);
    setSnapshot(null);
    setSelectedThreadId(null);
    (async () => {
      const cached = await loadPhoneSnapshot<CheckPhoneMessagesPayload>(character.id, "messages");
      if (cancelled) return;
      setSnapshot(cached);
      setSelectedThreadId(null);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [character.id]);

  async function handleRefresh() {
    if (loading) return;
    setLoading(true);
    setError(null);
    setDebugRawOutput(null);
    setDebugSanitizedOutput(null);
    setDebugParseMode(null);
    setDebugParseError(null);
    setDebugNormalizeError(null);
    const {
      payload,
      summary,
      error: nextError,
      debugRawOutput: nextDebugRawOutput,
      debugSanitizedOutput: nextDebugSanitizedOutput,
      debugParseMode: nextDebugParseMode,
      debugParseError: nextDebugParseError,
      debugNormalizeError: nextDebugNormalizeError,
    } = await generateCheckPhoneMessages(
      character.id,
      snapshot?.payload ?? null,
      snapshot?.updatedAt,
    );
    if (payload) {
      const now = appNowISO();
      const nextSnapshot: CheckPhoneSnapshot<CheckPhoneMessagesPayload> = {
        id: `${character.id}:messages`,
        characterId: character.id,
        appId: "messages",
        generatedAt: snapshot?.generatedAt ?? now,
        updatedAt: now,
        summary,
        payload,
      };
      await savePhoneSnapshot(nextSnapshot);
      setSnapshot(nextSnapshot);
      setSelectedThreadId(null);
    }
    setError(nextError ?? null);
    setDebugRawOutput(nextDebugRawOutput ?? null);
    setDebugSanitizedOutput(nextDebugSanitizedOutput ?? null);
    setDebugParseMode(nextDebugParseMode ?? null);
    setDebugParseError(nextDebugParseError ?? null);
    setDebugNormalizeError(nextDebugNormalizeError ?? null);
    setLoading(false);
    setLoaded(true);
  }

  async function handleClear() {
    if (loading) return;
    await clearPhoneSnapshot(character.id, "messages");
    setSnapshot(null);
    setSelectedThreadId(null);
    setError(null);
    setDebugRawOutput(null);
    setDebugSanitizedOutput(null);
    setDebugParseMode(null);
    setDebugParseError(null);
    setDebugNormalizeError(null);
    setLoaded(true);
    setConfirmClearOpen(false);
  }

  const [searchQuery, setSearchQuery] = useState("");

  const payload = snapshot?.payload ?? null;
  const allThreads = payload?.threads ?? [];
  const threads = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return allThreads;
    return allThreads.filter(
      (t) =>
        t.sender.toLowerCase().includes(q) ||
        t.preview.toLowerCase().includes(q) ||
        t.messages.some((m) => m.text.toLowerCase().includes(q)),
    );
  }, [allThreads, searchQuery]);
  const selectedThread = useMemo(
    () => threads.find((thread) => thread.id === selectedThreadId) ?? null,
    [threads, selectedThreadId],
  );

  return (
    <div className="cp-messages-module">
      <header className="cp-phone-cyber-header">
        <div className="cp-phone-cyber-header--compact">
          <div className="cp-cyber-header-left">
            <button
              type="button"
              className="cp-cyber-btn"
              onClick={selectedThread ? () => setSelectedThreadId(null) : onBack}
              aria-label={selectedThread ? "Back to Messages" : "Back"}
            >
              <ChevronLeft size={20} strokeWidth={2.5} />
            </button>
          </div>

          <div className="cp-cyber-title-stack">
            <div className="cp-cyber-title-row">
              <i className="cp-cyber-blink"></i>
              <span className="cp-cyber-title">{payload?.headerTitle || "MSG_LINK"}</span>
            </div>
            <div className="cp-cyber-subtitle">
              {selectedThread ? selectedThread.sender : payload?.headerSubtitle || "通知与短信"}
            </div>
          </div>

          <div className="cp-cyber-header-right">
            <div className="cp-cyber-actions">
              <button
                type="button"
                className="cp-cyber-btn"
                onClick={handleRefresh}
                disabled={loading}
                aria-label="Refresh"
              >
                <RefreshCw size={16} strokeWidth={2.5} className={loading ? "cp-spin" : ""} />
              </button>
              <button
                type="button"
                className="cp-cyber-btn cp-cyber-btn--danger"
                onClick={() => setConfirmClearOpen(true)}
                disabled={loading || !snapshot}
                aria-label="Clear messages snapshot"
              >
                <Trash2 size={16} strokeWidth={2.5} />
              </button>
            </div>
          </div>
        </div>
        
        <div className="cp-cyber-status-bar">
          <span className="cp-cyber-mini-text">[ SYS.OP : 0xMSG ]</span>
          <span className="cp-cyber-mini-text">LAT 35.41°N // LON 139.46°E</span>
        </div>
      </header>

      {loading && (
        <div className="cp-refresh-indicator cp-refresh-indicator--floating" aria-live="polite">
          <span className="cp-refresh-indicator-text">正在刷新信息</span>
          <span className="cp-refresh-indicator-dots" aria-hidden="true">
            <i></i><i></i><i></i>
          </span>
        </div>
      )}

      <div className="cp-messages-body">
        {!selectedThread && (
          <div className="cp-app-searchbar">
            <Search size={14} strokeWidth={2.2} />
            <input
              className="cp-app-searchbar-input"
              type="text"
              placeholder="搜索短信与通知"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        )}
        {!loaded && <div className="cp-messages-status">Reading inbox...</div>}

        {loaded && !payload && !loading && (
          <div className="cp-messages-status cp-empty-copy">
            <p>暂无信息内容</p>
            <span className="cp-messages-hint">点刷新同步短信与通知</span>
          </div>
        )}

        {error ? (
          <CheckPhoneDebugErrorCard
            title="暂时无法解析信息内容。"
            error={error}
            debugParseMode={debugParseMode}
            debugParseError={debugParseError}
            debugNormalizeError={debugNormalizeError}
            debugRawOutput={debugRawOutput}
            debugSanitizedOutput={debugSanitizedOutput}
          />
        ) : null}

        {payload && !selectedThread && (
          <div className="cp-messages-thread-list">
            {threads.map((thread) => (
              <button
                key={thread.id}
                type="button"
                className="cp-message-thread-card"
                onClick={() => setSelectedThreadId(thread.id)}
              >
                <div className={`cp-message-thread-dot cp-message-thread-dot--${thread.kind}`} />
                <div className="cp-message-thread-main">
                  <div className="cp-message-thread-topline">
                    <span className="cp-message-thread-sender">{getMessagesListPlainText(thread.sender)}</span>
                    <span className="cp-message-thread-time">{formatChatUiTime(thread.timeLabel) || thread.timeLabel}</span>
                  </div>
                  <div className="cp-message-thread-meta">
                    <span className="cp-message-thread-kind">{getThreadKindLabel(thread.kind)}</span>
                    {thread.unread && <span className="cp-message-thread-unread">未读</span>}
                    {thread.muted && <span className="cp-message-thread-muted">静音</span>}
                  </div>
                  <p className="cp-message-thread-preview">
                    {getMessagesListPlainText(thread.preview)}
                  </p>
                </div>
                <ChevronRight size={16} strokeWidth={2.2} className="cp-message-thread-arrow" />
              </button>
            ))}
          </div>
        )}

        {payload && selectedThread && (
          <div className="cp-message-detail-view">
            <div className="cp-message-detail-threadhead">
              <div className={`cp-message-detail-pill cp-message-detail-pill--${selectedThread.kind}`}>
                {getThreadKindLabel(selectedThread.kind)}
              </div>
              <div className="cp-message-detail-stamp">{formatChatUiTime(selectedThread.timeLabel) || selectedThread.timeLabel}</div>
            </div>

            <div className="cp-message-bubbles">
              {selectedThread.messages.map((message) => (
                <div
                  key={message.id}
                  className={`cp-message-bubble-row cp-message-bubble-row--${message.direction}`}
                >
                  <div className={`cp-message-bubble cp-message-bubble--${message.direction}`}>
                    <div className="cp-message-snowflake">❄</div>
                    <p><CheckPhoneBilingualText text={message.text} tone="messages" variant="inline" /></p>
                  </div>
                  <span className={`cp-message-time cp-message-time--${message.direction}`}>
                    {formatChatUiTime(message.timeLabel) || message.timeLabel}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {confirmClearOpen && (
        <ConfirmDialog
          title="清空信息内容？"
          message="确认后会清空当前信息缓存。之后重新刷新时，不会再带入旧信息内容。"
          variant="danger"
          confirmLabel="确认清空"
          cancelLabel="取消"
          onConfirm={handleClear}
          onCancel={() => setConfirmClearOpen(false)}
        />
      )}
    </div>
  );
}
