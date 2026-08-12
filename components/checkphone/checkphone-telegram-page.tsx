"use client";

import { useEffect, useMemo, useState } from "react";
import { appNowISO } from "@/lib/app-clock";
import { useCheckPhoneRefresh } from "@/lib/checkphone-refresh-tracker";
import {
  Bookmark,
  Check,
  CheckCheck,
  ChevronLeft,
  Mic,
  Paperclip,
  Pin,
  RefreshCw,
  Search,
  Smile,
  Star,
  Trash2,
  VolumeX,
} from "lucide-react";
import {
  ChatCircle,
  GearSix,
  Phone as PhosphorPhone,
  UserCircle as PhosphorUserCircle,
} from "@phosphor-icons/react";
import { CheckPhoneBilingualText } from "@/components/checkphone/checkphone-bilingual-text";
import { CheckPhoneDebugErrorCard } from "@/components/checkphone/checkphone-debug-error-card";
import { ConfirmDialog } from "@/components/ui";
import type { Character } from "@/lib/character-types";
import type {
  CheckPhoneSnapshot,
  CheckPhoneTelegramMessage,
  CheckPhoneTelegramPayload,
  CheckPhoneTelegramThread,
} from "@/lib/checkphone-config";
import { generateCheckPhoneTelegram } from "@/lib/checkphone-engine";
import { clearPhoneSnapshot, loadPhoneSnapshot, savePhoneSnapshot } from "@/lib/checkphone-storage";
import { normalizeBilingualTextInput, splitBilingualText } from "@/lib/bilingual-text";

type CheckPhoneTelegramPageProps = {
  character: Character;
  onBack: () => void;
};

type TelegramFilter = "all" | "group" | "channel";

const TELEGRAM_FILTERS: Array<{ id: TelegramFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "group", label: "Groups" },
  { id: "channel", label: "Channels" },
];

const TELEGRAM_BUBBLE_TAIL_PATH = "M2.3 25.1L23.1 0l0.5 17.1c0 0-0.3 0.3 0.1 2.5s0.5 4 2.1 6.6 1.5 3.1 4 5.9 3.6 4.1 5.3 5.6 1.6 1.5 1.6 1.5-4.5 0.8-9.6 0.5-8.6-0.8-12.5-2.1-6-2.3-9-4.5S0 28 0 28";

function formatTelegramTime(iso: string): string {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return iso;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const hhmm = value.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  if (value >= todayStart) return hhmm;
  if (value >= yesterdayStart) return "Yesterday";
  return value.toLocaleDateString("en-US", { weekday: "short" });
}

function formatTelegramClockTime(iso: string): string {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return iso;
  return value.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function getLastMessage(thread: CheckPhoneTelegramThread): CheckPhoneTelegramMessage | null {
  if (!thread.messages.length) return null;
  return [...thread.messages].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] ?? null;
}

function buildThreadPreview(thread: CheckPhoneTelegramThread): string {
  const last = getLastMessage(thread);
  if (!last) return "";
  const prefix = thread.kind === "group" && last.authorName ? `${last.authorName}: ` : "";
  const body = getTelegramListPlainText(getTelegramMessageText(last));
  const compact = `${prefix}${body}`.replace(/\s+/g, " ").trim();
  return compact.length > 70 ? `${compact.slice(0, 67).trimEnd()}...` : compact;
}

function getTelegramListPlainText(text: string): string {
  const normalized = normalizeBilingualTextInput(text);
  return splitBilingualText(normalized)?.original ?? normalized;
}

function getTelegramMessageText(message: CheckPhoneTelegramMessage): string {
  return message.text || message.voiceTranscript || "";
}

function sortThreadMessages(messages: CheckPhoneTelegramMessage[]): CheckPhoneTelegramMessage[] {
  return [...messages].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

function sortThreads(threads: CheckPhoneTelegramThread[]): CheckPhoneTelegramThread[] {
  return [...threads].sort((a, b) => {
    if ((a.pinned ?? false) !== (b.pinned ?? false)) return a.pinned ? -1 : 1;
    const aLast = getLastMessage(a);
    const bLast = getLastMessage(b);
    const aTime = aLast ? Date.parse(aLast.createdAt) : Number.NEGATIVE_INFINITY;
    const bTime = bLast ? Date.parse(bLast.createdAt) : Number.NEGATIVE_INFINITY;
    return bTime - aTime;
  });
}

function getInitial(value: string): string {
  const trimmed = value.trim();
  return trimmed ? Array.from(trimmed)[0].toUpperCase() : "T";
}

function getThreadKindLabel(thread: CheckPhoneTelegramThread): string {
  switch (thread.kind) {
    case "saved":
      return "Saved Messages";
    case "group":
      return "group";
    case "channel":
      return "channel";
    default:
      return thread.online ? "online" : thread.handle || "last seen recently";
  }
}

function getThreadAvatarLabel(thread: CheckPhoneTelegramThread): string {
  if (thread.avatarLabel?.trim()) return thread.avatarLabel.trim().slice(0, 2);
  if (thread.kind === "saved") return "";
  return getInitial(thread.title);
}

function isThreadInFilter(thread: CheckPhoneTelegramThread, filter: TelegramFilter): boolean {
  if (filter === "all") return true;
  if (filter === "group") return thread.kind === "group";
  return thread.kind === "channel";
}

function getFilterCount(threads: CheckPhoneTelegramThread[], filter: TelegramFilter): number {
  return threads.filter((thread) => isThreadInFilter(thread, filter)).length;
}

function ReadStatus({ status }: { status?: CheckPhoneTelegramThread["lastStatus"] }) {
  if (status === "read") return <CheckCheck size={17} strokeWidth={2.5} className="cp-telegram-read-status" />;
  if (status === "sent") return <Check size={17} strokeWidth={2.5} className="cp-telegram-read-status" />;
  return null;
}

export function CheckPhoneTelegramPage({ character, onBack }: CheckPhoneTelegramPageProps) {
  const [snapshot, setSnapshot] = useState<CheckPhoneSnapshot<CheckPhoneTelegramPayload> | null>(null);
  const [selectedFilter, setSelectedFilter] = useState<TelegramFilter>("all");
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useCheckPhoneRefresh(character.id, "telegram", setSnapshot);
  const [error, setError] = useState<string | null>(null);
  const [debugRawOutput, setDebugRawOutput] = useState<string | null>(null);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setError(null);
    setDebugRawOutput(null);
    setSnapshot(null);
    setSelectedFilter("all");
    setSelectedThreadId(null);
    (async () => {
      const cached = await loadPhoneSnapshot<CheckPhoneTelegramPayload>(character.id, "telegram");
      if (cancelled) return;
      setSnapshot(cached);
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
    const {
      payload,
      summary,
      error: nextError,
      debugRawOutput: nextDebugRawOutput,
    } = await generateCheckPhoneTelegram(
      character.id,
      snapshot?.payload ?? null,
      snapshot?.updatedAt,
    );
    if (payload) {
      const now = appNowISO();
      const nextSnapshot: CheckPhoneSnapshot<CheckPhoneTelegramPayload> = {
        id: `${character.id}:telegram`,
        characterId: character.id,
        appId: "telegram",
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
    setLoading(false);
    setLoaded(true);
  }

  async function handleClear() {
    if (loading) return;
    await clearPhoneSnapshot(character.id, "telegram");
    setSnapshot(null);
    setSelectedFilter("all");
    setSelectedThreadId(null);
    setError(null);
    setDebugRawOutput(null);
    setLoaded(true);
    setConfirmClearOpen(false);
  }

  const payload = snapshot?.payload ?? null;
  const sortedThreads = useMemo(() => sortThreads(payload?.threads ?? []), [payload?.threads]);
  const filteredThreads = useMemo(() => {
    return sortedThreads.filter((thread) => isThreadInFilter(thread, selectedFilter));
  }, [selectedFilter, sortedThreads]);
  const activeThread = useMemo(
    () => sortedThreads.find((thread) => thread.id === selectedThreadId) ?? null,
    [selectedThreadId, sortedThreads],
  );
  const activeMessages = useMemo(
    () => (activeThread ? sortThreadMessages(activeThread.messages) : []),
    [activeThread],
  );
  return (
    <div className={`cp-telegram-module${activeThread ? " is-detail" : ""}`}>
      {!activeThread ? (
        <header className="cp-telegram-list-appbar">
          <button type="button" className="cp-telegram-edit-button" onClick={onBack} aria-label="Back">
            <ChevronLeft size={21} strokeWidth={2.7} />
          </button>
          <div className="cp-telegram-list-title">
            <span>Chats</span>
            <Star size={19} strokeWidth={3} fill="currentColor" />
          </div>
          <div className="cp-telegram-list-actions">
            <button type="button" onClick={handleRefresh} disabled={loading} aria-label="Refresh Telegram">
              <RefreshCw size={20} strokeWidth={2.4} className={loading ? "cp-spin" : ""} />
            </button>
            <button type="button" onClick={() => setConfirmClearOpen(true)} disabled={loading || !snapshot} aria-label="Clear Telegram snapshot">
              <Trash2 size={19} strokeWidth={2.3} />
            </button>
          </div>
        </header>
      ) : (
        <header className="cp-telegram-chat-appbar">
          <button type="button" className="cp-telegram-chat-back" onClick={() => setSelectedThreadId(null)} aria-label="Back to chats">
            <ChevronLeft size={28} strokeWidth={2.6} />
          </button>
          <div className="cp-telegram-chat-title-pill">
            <strong>{activeThread.title}</strong>
            <span>{getThreadKindLabel(activeThread)}</span>
          </div>
          <div className={`cp-telegram-chat-avatar cp-telegram-avatar--${activeThread.kind}`}>
            {activeThread.kind === "saved" ? <Bookmark size={24} fill="currentColor" /> : getThreadAvatarLabel(activeThread)}
          </div>
        </header>
      )}

      {loading && (
        <div className="cp-refresh-indicator cp-refresh-indicator--floating" aria-live="polite">
          <span className="cp-refresh-indicator-text">Refreshing Telegram</span>
          <span className="cp-refresh-indicator-dots" aria-hidden="true">
            <i></i><i></i><i></i>
          </span>
        </div>
      )}

      <div className="cp-telegram-body">
        {!loaded && <div className="cp-telegram-status">Syncing chats...</div>}

        {loaded && !payload && !loading && (
          <div className="cp-telegram-status cp-empty-copy">
            <p>No Telegram content yet</p>
            <span className="cp-telegram-hint">Refresh to sync channels, groups, and chats.</span>
          </div>
        )}

        {error ? <CheckPhoneDebugErrorCard error={error} debugRawOutput={debugRawOutput} /> : null}

        {!activeThread && payload && (
          <>
            <div className="cp-telegram-filters">
              {TELEGRAM_FILTERS.map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  className={`cp-telegram-filter ${selectedFilter === filter.id ? "is-active" : ""}`}
                  onClick={() => setSelectedFilter(filter.id)}
                >
                  <span>{filter.label}</span>
                  {filter.id === "all" ? null : <em>{getFilterCount(sortedThreads, filter.id)}</em>}
                </button>
              ))}
            </div>

            <div className="cp-telegram-thread-list">
              {filteredThreads.map((thread) => {
                const last = getLastMessage(thread);
                return (
                  <button
                    key={thread.id}
                    type="button"
                    className="cp-telegram-thread-card"
                    onClick={() => setSelectedThreadId(thread.id)}
                  >
                    <div className={`cp-telegram-thread-avatar cp-telegram-thread-avatar--${thread.kind}`}>
                      {thread.kind === "saved" ? <Bookmark size={25} fill="currentColor" /> : getThreadAvatarLabel(thread)}
                      {thread.online ? <i /> : null}
                    </div>
                    <div className="cp-telegram-thread-main">
                      <div className="cp-telegram-thread-head">
                        <strong>
                          {getTelegramListPlainText(thread.title)}
                          {thread.verified ? <Star size={14} strokeWidth={3} fill="currentColor" /> : null}
                          {thread.muted ? <VolumeX size={14} strokeWidth={2.4} /> : null}
                        </strong>
                        <time>
                          {last && last.direction === "outgoing" ? <ReadStatus status={thread.lastStatus} /> : null}
                          {last ? formatTelegramTime(last.createdAt) : ""}
                        </time>
                      </div>
                      <div className="cp-telegram-thread-preview">
                        <p>{buildThreadPreview(thread)}</p>
                        {thread.pinned ? (
                          <div className="cp-telegram-thread-badges">
                            <span className="cp-telegram-pin"><Pin size={14} strokeWidth={2.6} /></span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {activeThread && (
          <div className="cp-telegram-detail">
            <div className="cp-telegram-message-list">
              {activeMessages.map((message, index) => {
                const isOutgoing = message.direction === "outgoing";
                const messageText = getTelegramMessageText(message);
                const nextMessage = activeMessages[index + 1];
                const showTail = !nextMessage
                  || nextMessage.direction !== message.direction
                  || nextMessage.authorName !== message.authorName;

                return (
                  <div
                    key={message.id}
                    className={`cp-telegram-message-row ${isOutgoing ? "is-outgoing" : "is-incoming"}`}
                  >
                    <div className={`cp-telegram-message-bubble ${isOutgoing ? "is-outgoing" : "is-incoming"} is-text`}>
                      {showTail ? (
                        <svg
                          className={`cp-telegram-bubble-tail ${isOutgoing ? "is-outgoing" : "is-incoming"}`}
                          viewBox="0 0 36.8 39.8"
                          preserveAspectRatio="none"
                          aria-hidden="true"
                          focusable="false"
                        >
                          <path d={TELEGRAM_BUBBLE_TAIL_PATH} />
                        </svg>
                      ) : null}
                      {activeThread.kind !== "direct" && !isOutgoing ? (
                        <strong>{message.authorName}</strong>
                      ) : null}
                      {messageText ? (
                        <p className="cp-telegram-message-text">
                          <CheckPhoneBilingualText text={messageText} tone="light" variant="inline" />
                          <time className="cp-telegram-message-time">
                            {formatTelegramClockTime(message.createdAt)}
                            {isOutgoing ? <CheckCheck size={16} strokeWidth={2.4} /> : null}
                          </time>
                        </p>
                      ) : null}
                      {!messageText ? (
                        <time className="cp-telegram-message-time cp-telegram-message-time--block">
                          {formatTelegramClockTime(message.createdAt)}
                          {isOutgoing ? <CheckCheck size={16} strokeWidth={2.4} /> : null}
                        </time>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="cp-telegram-composer" aria-label="Message composer">
              <button type="button" aria-label="Attach">
                <Paperclip size={28} strokeWidth={1.45} />
              </button>
              <div className="cp-telegram-message-input">
                <span>Message</span>
                <Smile size={25} strokeWidth={2.2} />
              </div>
              <button type="button" aria-label="Voice message">
                <Mic size={31} strokeWidth={1.45} />
              </button>
            </div>
          </div>
        )}
      </div>

      {!activeThread && payload ? (
        <div className="cp-telegram-bottom-shell">
          <nav className="cp-telegram-bottom-nav" aria-label="Telegram sections">
            <span><PhosphorUserCircle size={29} weight="fill" />Contacts</span>
            <span><PhosphorPhone size={28} weight="fill" />Calls</span>
            <span className="is-active">
              <ChatCircle size={30} weight="fill" />Chats
            </span>
            <span><GearSix size={29} weight="fill" />Settings</span>
          </nav>
          <button type="button" className="cp-telegram-search-float" aria-label="Search Telegram">
            <Search size={29} strokeWidth={2.6} />
          </button>
        </div>
      ) : null}

      {confirmClearOpen && (
        <ConfirmDialog
          title="清空 Telegram 内容？"
          message="确认后会清空当前 Telegram 缓存。之后重新刷新时，不会再带入旧 Telegram 内容。"
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
