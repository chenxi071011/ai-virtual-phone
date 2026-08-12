"use client";

import { useEffect, useMemo, useState } from "react";
import { appNowISO } from "@/lib/app-clock";
import { useCheckPhoneRefresh } from "@/lib/checkphone-refresh-tracker";
import {
  BarChart3,
  Bell,
  CalendarDays,
  ChevronLeft,
  CircleDot,
  Heart,
  Home,
  Mail,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Repeat2,
  Search,
  Share,
  Trash2,
} from "lucide-react";
import { CheckPhoneBilingualText } from "@/components/checkphone/checkphone-bilingual-text";
import { CheckPhoneDebugErrorCard } from "@/components/checkphone/checkphone-debug-error-card";
import { ConfirmDialog } from "@/components/ui";
import type { Character } from "@/lib/character-types";
import type {
  CheckPhoneSnapshot,
  CheckPhoneXPayload,
} from "@/lib/checkphone-config";
import { generateCheckPhoneX } from "@/lib/checkphone-engine";
import { clearPhoneSnapshot, loadPhoneSnapshot, savePhoneSnapshot } from "@/lib/checkphone-storage";

type CheckPhoneXPageProps = {
  character: Character;
  onBack: () => void;
};

type XTabId = "posts" | "replies" | "likes";

type XEntry =
  | (CheckPhoneXPayload["posts"][number] & { section: "posts" })
  | (CheckPhoneXPayload["replies"][number] & { section: "replies" })
  | (CheckPhoneXPayload["likes"][number] & { section: "likes" });

const X_TABS: Array<{ id: XTabId; label: string }> = [
  { id: "posts", label: "Posts" },
  { id: "replies", label: "Replies" },
  { id: "likes", label: "Likes" },
];

const X_NAV_ITEMS = [
  { id: "home", label: "Home", icon: Home },
  { id: "search", label: "Search", icon: Search },
  { id: "grok", label: "Grok", icon: CircleDot },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "messages", label: "Messages", icon: Mail },
] as const;

const X_EXAMPLE_HANDLES = new Set([
  "@qiye_x",
  "@xxxxx",
  "@xxxx",
  "@x_user",
  "@user",
  "@profile",
  "@char_specific_handle",
  "@liked_author_handle",
]);

function isXExampleHandle(handle: string): boolean {
  return X_EXAMPLE_HANDLES.has(handle.toLowerCase()) || /根据角色|示例|专属账号/.test(handle);
}

function deriveXHandleFromName(name: string): string {
  const trimmed = name.trim();
  const latin = trimmed
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 20);
  if (latin) return `@${latin}`;

  const compact = Array.from(trimmed)
    .filter((char) => /[\p{L}\p{N}]/u.test(char))
    .join("")
    .slice(0, 12);
  return compact ? `@${compact}` : "@profile";
}

function getXDisplayHandle(rawHandle: string | undefined, profileName: string, characterName: string): string {
  const normalized = rawHandle?.trim() ? (rawHandle.trim().startsWith("@") ? rawHandle.trim() : `@${rawHandle.trim()}`) : "";
  if (normalized && !isXExampleHandle(normalized)) return normalized;
  return deriveXHandleFromName(profileName || characterName);
}

function formatXTime(iso: string): string {
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
  if (value >= todayStart) return `Today ${hhmm}`;
  if (value >= yesterdayStart) return `Yesterday ${hhmm}`;
  return value.toLocaleDateString("en-US", {
    month: "2-digit",
    day: "2-digit",
  }) + ` ${hhmm}`;
}

function formatCount(value: number): string {
  if (value >= 1000000) {
    const million = value / 1000000;
    return `${million >= 10 ? Math.round(million).toString() : million.toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (value >= 10000) {
    const thousand = value / 1000;
    return `${thousand >= 10 ? Math.round(thousand).toString() : thousand.toFixed(1).replace(/\.0$/, "")}K`;
  }
  return Math.max(0, Math.round(value)).toLocaleString("en-US");
}

function formatXMetric(value: number | undefined): string {
  if (!Number.isFinite(value)) return "0";
  const safeValue = Math.max(0, Math.round(value ?? 0));
  return formatCount(safeValue);
}

function getInitial(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.slice(0, 1).toUpperCase() : "X";
}

function getJoinLabel(joinedAt?: string): string {
  if (!joinedAt?.trim()) return "";
  const value = joinedAt.trim();
  if (/^joined\s/i.test(value)) return value;
  const compact = value.replace(/加入/g, "").trim();
  const cnMonth = compact.match(/^(\d{4})年\s*(\d{1,2})月/);
  if (cnMonth) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthIndex = Math.max(0, Math.min(11, Number(cnMonth[2]) - 1));
    return `Joined ${months[monthIndex]} ${cnMonth[1]}`;
  }
  return `Joined ${compact}`;
}

function getEntryNote(entry: XEntry): string {
  if (entry.section === "likes") return entry.likeReason;
  return entry.note;
}

function getEntryViewCount(entry: XEntry): number {
  if ("viewCount" in entry && Number.isFinite(entry.viewCount)) return entry.viewCount;
  const likeCount = getEntryLikeCount(entry);
  const repostCount = getEntryRepostCount(entry);
  const replyCount = getEntryReplyCount(entry);
  if (Number.isFinite(likeCount)) return likeCount * 34 + repostCount * 58 + replyCount * 22 + 260;
  return 0;
}

function getEntryReplyCount(entry: XEntry): number {
  return "replyCount" in entry && Number.isFinite(entry.replyCount) ? entry.replyCount : 0;
}

function getEntryRepostCount(entry: XEntry): number {
  return "repostCount" in entry && Number.isFinite(entry.repostCount) ? entry.repostCount : 0;
}

function getEntryLikeCount(entry: XEntry): number {
  return "likeCount" in entry && Number.isFinite(entry.likeCount) ? entry.likeCount : 0;
}

function getMediaDescription(entry: XEntry): string {
  if (entry.section === "likes") return entry.mediaDescription ?? "";
  if (entry.section === "posts") return entry.mediaDescription ?? "";
  return "";
}

function getEntrySubline(entry: XEntry, profileHandle: string): string {
  if (entry.section === "likes") return getXDisplayHandle(entry.authorHandle, entry.authorName, entry.authorName);
  return profileHandle;
}

function getEntries(payload: CheckPhoneXPayload | null, tab: XTabId): XEntry[] {
  if (!payload) return [];
  if (tab === "posts") return payload.posts.map((item) => ({ ...item, section: "posts" }));
  if (tab === "replies") return payload.replies.map((item) => ({ ...item, section: "replies" }));
  return payload.likes.map((item) => ({ ...item, section: "likes" }));
}

export function CheckPhoneXPage({ character, onBack }: CheckPhoneXPageProps) {
  const [snapshot, setSnapshot] = useState<CheckPhoneSnapshot<CheckPhoneXPayload> | null>(null);
  const [selectedTab, setSelectedTab] = useState<XTabId>("posts");
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useCheckPhoneRefresh(character.id, "x", setSnapshot);
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
    setSelectedTab("posts");
    setExpandedEntryId(null);
    setDebugRawOutput(null);
    setDebugSanitizedOutput(null);
    setDebugParseMode(null);
    setDebugParseError(null);
    setDebugNormalizeError(null);
    (async () => {
      const cached = await loadPhoneSnapshot<CheckPhoneXPayload>(character.id, "x");
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
    } = await generateCheckPhoneX(character.id, snapshot?.payload ?? null, snapshot?.updatedAt);
    if (payload) {
      const now = appNowISO();
      const nextSnapshot: CheckPhoneSnapshot<CheckPhoneXPayload> = {
        id: `${character.id}:x`,
        characterId: character.id,
        appId: "x",
        generatedAt: snapshot?.generatedAt ?? now,
        updatedAt: now,
        summary,
        payload,
      };
      await savePhoneSnapshot(nextSnapshot);
      setSnapshot(nextSnapshot);
      setExpandedEntryId(null);
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
    await clearPhoneSnapshot(character.id, "x");
    setSnapshot(null);
    setSelectedTab("posts");
    setExpandedEntryId(null);
    setError(null);
    setDebugRawOutput(null);
    setDebugSanitizedOutput(null);
    setDebugParseMode(null);
    setDebugParseError(null);
    setDebugNormalizeError(null);
    setLoaded(true);
    setConfirmClearOpen(false);
  }

  const payload = snapshot?.payload ?? null;
  const currentEntries = useMemo(() => getEntries(payload, selectedTab), [payload, selectedTab]);
  const profileInitial = payload ? getInitial(payload.profile.name) : "X";
  const joinedAtLabel = payload ? getJoinLabel(payload.profile.joinedAt) : "";
  const displayHandle = payload ? getXDisplayHandle(payload.profile.handle, payload.profile.name, character.name) : "";

  return (
    <div className="cp-x-module">
      {!payload && (
        <header className="cp-x-appbar cp-x-appbar--empty">
          <button type="button" className="cp-x-icon-button" onClick={onBack} aria-label="Back">
            <ChevronLeft size={23} strokeWidth={2.4} />
          </button>
          <div className="cp-x-header-stack">
            <div className="cp-x-header-title">X</div>
          </div>
          <div className="cp-x-action-cluster">
            <button type="button" className="cp-x-icon-button" onClick={handleRefresh} disabled={loading} aria-label="Refresh X snapshot">
              <RefreshCw size={18} strokeWidth={2.5} className={loading ? "cp-spin" : ""} />
            </button>
            <button type="button" className="cp-x-icon-button" onClick={() => setConfirmClearOpen(true)} disabled={loading || !snapshot} aria-label="Clear X snapshot">
              <Trash2 size={17} strokeWidth={2.25} />
            </button>
          </div>
        </header>
      )}

      {loading && (
        <div className="cp-refresh-indicator cp-refresh-indicator--floating" aria-live="polite">
          <span className="cp-refresh-indicator-text">Refreshing X</span>
          <span className="cp-refresh-indicator-dots" aria-hidden="true">
            <i></i><i></i><i></i>
          </span>
        </div>
      )}

      <div className="cp-x-body">
        {!loaded && <div className="cp-x-status">Syncing X activity...</div>}

        {loaded && !payload && !loading && (
          <div className="cp-x-status cp-empty-copy">
            <p>No X activity yet</p>
            <span className="cp-x-hint">Refresh to sync posts, replies, and likes.</span>
          </div>
        )}

        {error ? (
          <CheckPhoneDebugErrorCard
            title="Unable to parse X content."
            error={error}
            debugParseMode={debugParseMode}
            debugParseError={debugParseError}
            debugNormalizeError={debugNormalizeError}
            debugRawOutput={debugRawOutput}
            debugSanitizedOutput={debugSanitizedOutput}
          />
        ) : null}

        {payload && (
          <div className="cp-x-home-screen">
            <div className="cp-x-profile-nav">
              <button type="button" className="cp-x-glass-button" onClick={onBack} aria-label="Back">
                <ChevronLeft size={21} strokeWidth={2.4} />
                </button>
                <div className="cp-x-action-cluster">
                  <button type="button" className="cp-x-glass-button" onClick={handleRefresh} disabled={loading} aria-label="Refresh X snapshot">
                    <RefreshCw size={18} strokeWidth={2.35} className={loading ? "cp-spin" : ""} />
                  </button>
                  <button type="button" className="cp-x-glass-button" onClick={() => setConfirmClearOpen(true)} disabled={loading || !snapshot} aria-label="Clear X snapshot">
                    <Trash2 size={17} strokeWidth={2.35} />
                  </button>
                </div>
            </div>

            <section className="cp-x-profile-hero">
              <div className="cp-x-cover" aria-hidden="true">
                <div className="cp-x-cover-noise" />
              </div>

              <div className="cp-x-profile-panel">
                <div className="cp-x-avatar-row">
                  <div className="cp-x-profile-avatar">{profileInitial}</div>
                </div>
                <div className="cp-x-profile-main">
                  <h3>{payload.profile.name}</h3>
                  <span>{displayHandle}</span>
                </div>
                <CheckPhoneBilingualText text={payload.profile.bio} className="cp-x-profile-bio" tone="x" />
                <div className="cp-x-profile-meta-row">
                  {payload.profile.location ? (
                    <span>
                      <MapPin size={14} strokeWidth={2.2} />
                      {payload.profile.location}
                    </span>
                  ) : null}
                  {joinedAtLabel ? (
                    <span>
                      <CalendarDays size={14} strokeWidth={2.2} />
                      {joinedAtLabel}
                    </span>
                  ) : null}
                </div>
                <div className="cp-x-follow-row">
                  <span><strong>{formatCount(payload.profile.followingCount)}</strong> Following</span>
                  <span><strong>{formatCount(payload.profile.followerCount)}</strong> Followers</span>
                </div>
              </div>
            </section>

            <div className="cp-x-tabs" role="tablist" aria-label="X categories">
              {X_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`cp-x-tab${selectedTab === tab.id ? " is-active" : ""}`}
                  onClick={() => {
                    setSelectedTab(tab.id);
                    setExpandedEntryId(null);
                  }}
                  role="tab"
                  aria-selected={selectedTab === tab.id}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="cp-x-list">
              {currentEntries.length > 0 ? currentEntries.map((entry) => {
                const mediaDescription = getMediaDescription(entry);
                const isExpanded = expandedEntryId === entry.id;
                return (
                  <article
                    key={entry.id}
                    role="button"
                    tabIndex={0}
                    className={`cp-x-tweet${isExpanded ? " is-expanded" : ""}`}
                    onClick={() => setExpandedEntryId((current) => (current === entry.id ? null : entry.id))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setExpandedEntryId((current) => (current === entry.id ? null : entry.id));
                      }
                    }}
                    aria-expanded={isExpanded}
                  >
                    <div className="cp-x-tweet-avatar">{profileInitial}</div>
                    <div className="cp-x-tweet-main">
                      <div className="cp-x-tweet-head">
                        <strong>{entry.section === "likes" ? entry.authorName : payload.profile.name}</strong>
                        <span>{getEntrySubline(entry, displayHandle)}</span>
                        <span>·</span>
                        <time>{formatXTime(entry.createdAt)}</time>
                        <MoreHorizontal size={20} strokeWidth={2.4} />
                      </div>
                      {entry.section === "replies" ? (
                        <div className="cp-x-reply-context">
                          <span>Replying to {entry.targetName}:</span>
                          <CheckPhoneBilingualText text={entry.targetSnippet} className="cp-x-reply-snippet" tone="x" />
                        </div>
                      ) : null}
                      <CheckPhoneBilingualText text={entry.body} className="cp-x-tweet-body" tone="x" />
                      {isExpanded ? (
                        <div className="cp-x-note-panel">
                          <div className="cp-x-note-title">NOTE</div>
                          <CheckPhoneBilingualText text={getEntryNote(entry)} className="cp-x-note-body" tone="x" />
                        </div>
                      ) : null}
                      {mediaDescription ? (
                        <div className="cp-x-media-preview">
                          <div className="cp-x-media-sheen" aria-hidden="true" />
                          <CheckPhoneBilingualText text={mediaDescription} className="cp-x-media-caption" tone="light" />
                        </div>
                      ) : null}
                      <div className="cp-x-action-row" aria-hidden="true">
                        <span><MessageCircle size={16} strokeWidth={2.1} />{formatXMetric(getEntryReplyCount(entry))}</span>
                        <span><Repeat2 size={16} strokeWidth={2.1} />{formatXMetric(getEntryRepostCount(entry))}</span>
                        <span><Heart size={16} strokeWidth={2.1} />{formatXMetric(getEntryLikeCount(entry))}</span>
                        <span><BarChart3 size={16} strokeWidth={2.1} />{formatXMetric(getEntryViewCount(entry))}</span>
                        <span><Share size={16} strokeWidth={2.1} /></span>
                      </div>
                    </div>
                  </article>
                );
              }) : (
                <div className="cp-x-status cp-x-inline-empty">
                  <p>No content in this tab</p>
                  <span className="cp-x-hint">Refresh to add more profile activity.</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {payload && (
        <>
          <button type="button" className="cp-x-compose-fab" onClick={handleRefresh} disabled={loading} aria-label="Refresh X snapshot">
            <Plus size={25} strokeWidth={2.5} />
          </button>

          <nav className="cp-x-bottom-nav" aria-label="X bottom navigation">
            {X_NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <span key={item.id} className={item.id === "home" ? "is-active" : ""} aria-label={item.label}>
                  <Icon size={23} strokeWidth={2.25} />
                </span>
              );
            })}
          </nav>
        </>
      )}

      {confirmClearOpen && (
        <ConfirmDialog
          title="Clear X content?"
          message="This clears the current X cache. The next refresh will not reuse old X content."
          variant="danger"
          confirmLabel="Clear"
          cancelLabel="Cancel"
          onConfirm={handleClear}
          onCancel={() => setConfirmClearOpen(false)}
        />
      )}
    </div>
  );
}
