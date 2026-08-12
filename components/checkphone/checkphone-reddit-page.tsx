"use client";

import { useEffect, useMemo, useState, type UIEvent } from "react";
import { appNowISO } from "@/lib/app-clock";
import { useCheckPhoneRefresh } from "@/lib/checkphone-refresh-tracker";
import {
  ArrowBigDown,
  ArrowBigUp,
  Bell,
  Cake,
  ChevronLeft,
  Eye,
  Home,
  MessageCircle,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
  UserRound,
} from "lucide-react";
import { CheckPhoneBilingualText } from "@/components/checkphone/checkphone-bilingual-text";
import { CheckPhoneDebugErrorCard } from "@/components/checkphone/checkphone-debug-error-card";
import { ConfirmDialog } from "@/components/ui";
import type { Character } from "@/lib/character-types";
import type {
  CheckPhoneRedditComment,
  CheckPhoneRedditPayload,
  CheckPhoneRedditPost,
  CheckPhoneSnapshot,
} from "@/lib/checkphone-config";
import { generateCheckPhoneReddit } from "@/lib/checkphone-engine";
import { clearPhoneSnapshot, loadPhoneSnapshot, savePhoneSnapshot } from "@/lib/checkphone-storage";

type CheckPhoneRedditPageProps = {
  character: Character;
  onBack: () => void;
};

type RedditTabId = "posts" | "comments" | "about";

const REDDIT_TABS: Array<{ id: RedditTabId; label: string }> = [
  { id: "posts", label: "Posts" },
  { id: "comments", label: "Comments" },
  { id: "about", label: "About" },
];

function formatCompactCount(value: number): string {
  const safeValue = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  if (safeValue >= 1000000) return `${(safeValue / 1000000).toFixed(1).replace(/\.0$/, "")}M`;
  if (safeValue >= 1000) return `${(safeValue / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(safeValue);
}

function formatRedditTime(iso: string): string {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return iso;
  const diffMs = Math.max(0, Date.now() - value.getTime());
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < minute) return "now";
  if (diffMs < hour) return `${Math.max(1, Math.floor(diffMs / minute))}m`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)}h`;
  if (diffMs < day * 7) return `${Math.floor(diffMs / day)}d`;
  return value.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatCakeDay(iso: string): string {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return iso;
  return value.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function getAccountAgeLabel(iso: string): string {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return "-";
  const diffDays = Math.max(1, Math.floor((Date.now() - value.getTime()) / (24 * 60 * 60 * 1000)));
  if (diffDays < 60) return `${diffDays}d`;
  const months = Math.max(1, Math.floor(diffDays / 30));
  if (months < 24) return `${months}mo`;
  return `${Math.max(1, Math.floor(months / 12))}y`;
}

function normalizeRedditHandle(handle: string, fallbackName: string): string {
  const fallback = fallbackName.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "profile";
  const value = handle.trim() || `u/${fallback}`;
  if (value.startsWith("u/")) return value;
  if (value.startsWith("@")) return `u/${value.slice(1)}`;
  return `u/${value}`;
}

function getProfileInitial(name: string, handle: string): string {
  const source = name.trim() || handle.replace(/^u\//, "").trim();
  return (source.slice(0, 1) || "R").toUpperCase();
}

function getActiveCommunityCount(payload: CheckPhoneRedditPayload): number {
  return new Set([...payload.posts.map((item) => item.communityName), ...payload.comments.map((item) => item.communityName)].filter(Boolean)).size;
}

function isRedditPayload(value: unknown): value is CheckPhoneRedditPayload {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const profile = record.profile && typeof record.profile === "object" ? (record.profile as Record<string, unknown>) : null;
  return Boolean(
    profile &&
      typeof profile.name === "string" &&
      typeof profile.handle === "string" &&
      typeof profile.postKarma === "number" &&
      typeof profile.commentKarma === "number" &&
      Array.isArray(record.posts) &&
      Array.isArray(record.comments),
  );
}

function RedditMetric({ value, label }: { value: string; label: string }) {
  return (
    <div className="cp-reddit-metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function RedditPostCard({ post }: { post: CheckPhoneRedditPost }) {
  return (
    <article className="cp-reddit-feed-card">
      <div className="cp-reddit-card-source">
        <span className="cp-reddit-source-icon">r/</span>
        <div>
          <strong>{post.communityName}</strong>
          <time>{formatRedditTime(post.createdAt)}</time>
        </div>
        <MoreHorizontal size={18} strokeWidth={2.2} aria-hidden="true" />
      </div>

      <CheckPhoneBilingualText text={post.title} className="cp-reddit-feed-title" tone="reddit" />
      <CheckPhoneBilingualText text={post.body} className="cp-reddit-feed-body" tone="reddit" />

      <div className="cp-reddit-action-row">
        <span className="cp-reddit-action-pill">
          <ArrowBigUp size={17} strokeWidth={1.9} />
          {formatCompactCount(post.upvoteCount)}
          <ArrowBigDown size={17} strokeWidth={1.9} />
        </span>
        <span className="cp-reddit-action-pill">
          <MessageCircle size={15} strokeWidth={2} />
          {formatCompactCount(post.commentCount)}
        </span>
        <span className="cp-reddit-action-pill cp-reddit-action-icon cp-reddit-action-shield">
          <Shield size={15} strokeWidth={2} />
        </span>
      </div>

      <div className="cp-reddit-insight-line">
        <Eye size={14} strokeWidth={2} />
        <span>{formatCompactCount(post.viewCount)} views</span>
        <strong>See More Insights</strong>
      </div>

      <div className="cp-reddit-thought-card">
        <span>Innerthought</span>
        <CheckPhoneBilingualText text={post.innerThought} className="cp-reddit-thought-text" tone="reddit" />
      </div>
    </article>
  );
}

function RedditCommentCard({ comment }: { comment: CheckPhoneRedditComment }) {
  return (
    <article className="cp-reddit-feed-card cp-reddit-comment-card">
      <div className="cp-reddit-card-source">
        <span className="cp-reddit-source-icon cp-reddit-source-icon--comment">u/</span>
        <div>
          <strong>{comment.communityName}</strong>
          <time>{formatRedditTime(comment.createdAt)}</time>
        </div>
        <MoreHorizontal size={18} strokeWidth={2.2} aria-hidden="true" />
      </div>

      <div className="cp-reddit-reply-context">
        <span>Commented on:</span>
        <CheckPhoneBilingualText text={comment.postTitle} className="cp-reddit-reply-title" tone="reddit" />
      </div>
      <CheckPhoneBilingualText text={comment.body} className="cp-reddit-feed-body" tone="reddit" />

      <div className="cp-reddit-action-row">
        <span className="cp-reddit-action-pill">
          <ArrowBigUp size={17} strokeWidth={1.9} />
          {formatCompactCount(comment.upvoteCount)}
          <ArrowBigDown size={17} strokeWidth={1.9} />
        </span>
        <span className="cp-reddit-action-pill cp-reddit-action-icon">
          <MessageCircle size={15} strokeWidth={2} />
        </span>
      </div>

      <div className="cp-reddit-insight-line">
        <Eye size={14} strokeWidth={2} />
        <span>{formatCompactCount(comment.viewCount)} views</span>
        <strong>See More Insights</strong>
      </div>

      <div className="cp-reddit-thought-card">
        <span>Innerthought</span>
        <CheckPhoneBilingualText text={comment.innerThought} className="cp-reddit-thought-text" tone="reddit" />
      </div>
    </article>
  );
}

function handleRedditBodyScroll(event: UIEvent<HTMLElement>) {
  const opacity = Math.min(1, Math.max(0, event.currentTarget.scrollTop / 86));
  event.currentTarget.style.setProperty("--cp-reddit-nav-opacity", opacity.toFixed(3));
}

export function CheckPhoneRedditPage({ character, onBack }: CheckPhoneRedditPageProps) {
  const [snapshot, setSnapshot] = useState<CheckPhoneSnapshot<CheckPhoneRedditPayload> | null>(null);
  const [selectedTab, setSelectedTab] = useState<RedditTabId>("posts");
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useCheckPhoneRefresh(character.id, "reddit", setSnapshot);
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
    setDebugRawOutput(null);
    setDebugSanitizedOutput(null);
    setDebugParseMode(null);
    setDebugParseError(null);
    setDebugNormalizeError(null);
    (async () => {
      const cached = await loadPhoneSnapshot<CheckPhoneRedditPayload>(character.id, "reddit");
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
    const previousPayload = isRedditPayload(snapshot?.payload ?? null) ? snapshot?.payload ?? null : null;
    const {
      payload,
      summary,
      error: nextError,
      debugRawOutput: nextDebugRawOutput,
      debugSanitizedOutput: nextDebugSanitizedOutput,
      debugParseMode: nextDebugParseMode,
      debugParseError: nextDebugParseError,
      debugNormalizeError: nextDebugNormalizeError,
    } = await generateCheckPhoneReddit(character.id, previousPayload, snapshot?.updatedAt);
    if (payload) {
      const now = appNowISO();
      const nextSnapshot: CheckPhoneSnapshot<CheckPhoneRedditPayload> = {
        id: `${character.id}:reddit`,
        characterId: character.id,
        appId: "reddit",
        generatedAt: snapshot?.generatedAt ?? now,
        updatedAt: now,
        summary,
        payload,
      };
      await savePhoneSnapshot(nextSnapshot);
      setSnapshot(nextSnapshot);
      setSelectedTab("posts");
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
    await clearPhoneSnapshot(character.id, "reddit");
    setSnapshot(null);
    setSelectedTab("posts");
    setError(null);
    setDebugRawOutput(null);
    setDebugSanitizedOutput(null);
    setDebugParseMode(null);
    setDebugParseError(null);
    setDebugNormalizeError(null);
    setLoaded(true);
    setConfirmClearOpen(false);
  }

  const payload = isRedditPayload(snapshot?.payload ?? null) ? snapshot?.payload ?? null : null;
  const displayName = payload?.profile.name || character.name || "Redditor";
  const displayHandle = normalizeRedditHandle(payload?.profile.handle ?? "", displayName);
  const avatarInitial = getProfileInitial(displayName, displayHandle);
  const totalKarma = payload ? payload.profile.postKarma + payload.profile.commentKarma : 0;
  const activeCommunityCount = useMemo(() => (payload ? getActiveCommunityCount(payload) : 0), [payload]);

  return (
    <div className={`cp-reddit-module${payload ? "" : " cp-reddit-module--empty"}`}>
      {!payload && (
        <header className="cp-reddit-empty-appbar">
          <button type="button" className="cp-reddit-empty-icon" onClick={onBack} aria-label="Back">
            <ChevronLeft size={23} strokeWidth={2.4} />
          </button>
          <div className="cp-reddit-empty-title">Reddit</div>
          <div className="cp-reddit-empty-actions">
            <button type="button" className="cp-reddit-empty-icon" onClick={handleRefresh} disabled={loading} aria-label="Refresh Reddit">
              <RefreshCw size={18} strokeWidth={2.5} className={loading ? "cp-spin" : ""} />
            </button>
            <button type="button" className="cp-reddit-empty-icon" onClick={() => setConfirmClearOpen(true)} disabled={loading || !snapshot} aria-label="Clear Reddit snapshot">
              <Trash2 size={17} strokeWidth={2.25} />
            </button>
          </div>
        </header>
      )}

      {loading && (
        <div className="cp-refresh-indicator cp-refresh-indicator--floating" aria-live="polite">
          <span className="cp-refresh-indicator-text">Refreshing Reddit</span>
          <span className="cp-refresh-indicator-dots" aria-hidden="true">
            <i></i><i></i><i></i>
          </span>
        </div>
      )}

      <main className={`cp-reddit-body${payload ? "" : " cp-reddit-body--empty"}`} onScroll={payload ? handleRedditBodyScroll : undefined}>
        {!loaded && <div className="cp-reddit-status">Syncing Reddit...</div>}

        {loaded && !payload && !loading && (
          <div className="cp-reddit-status cp-empty-copy">
            <p>Reddit</p>
            <span className="cp-reddit-hint">Tap refresh to load Posts, Comments, and About.</span>
          </div>
        )}

        {error ? (
          <CheckPhoneDebugErrorCard
            title="暂时无法解析 Reddit 内容。"
            error={error}
            debugParseMode={debugParseMode}
            debugParseError={debugParseError}
            debugNormalizeError={debugNormalizeError}
            debugRawOutput={debugRawOutput}
            debugSanitizedOutput={debugSanitizedOutput}
          />
        ) : null}

        {payload && (
          <div className="cp-reddit-home-screen">
            <div className="cp-reddit-profile-nav">
              <button type="button" className="cp-reddit-back-button" onClick={onBack} aria-label="Back">
                <ChevronLeft size={18} strokeWidth={2.4} />
              </button>

              <div className="cp-reddit-top-actions">
                <button type="button" onClick={handleRefresh} disabled={loading} aria-label="Refresh Reddit">
                  <RefreshCw size={17} strokeWidth={2.35} className={loading ? "cp-spin" : ""} />
                </button>
                <button type="button" onClick={() => setConfirmClearOpen(true)} disabled={loading || !snapshot} aria-label="Clear Reddit snapshot">
                  <Trash2 size={17} strokeWidth={2.25} />
                </button>
              </div>
            </div>

            <header className="cp-reddit-hero">
              <section className="cp-reddit-profile">
                <div className="cp-reddit-avatar">{avatarInitial}</div>
                <div className="cp-reddit-name-row">
                  <h2>{displayName}</h2>
                  <button type="button" className="cp-reddit-edit-button">Edit</button>
                </div>
                <div className="cp-reddit-profile-meta">
                  <span>{displayHandle}</span>
                  <span>{formatCompactCount(payload.profile.followers)} followers</span>
                </div>
                <CheckPhoneBilingualText text={payload.profile.bio} className="cp-reddit-profile-bio" tone="light" />

                <div className="cp-reddit-link-row">
                  <span><Plus size={12} strokeWidth={2.4} /> Add Social Link</span>
                  <span><Shield size={12} strokeWidth={2.4} /> 0 achievements</span>
                </div>

                <div className="cp-reddit-metrics">
                  <RedditMetric value={formatCompactCount(totalKarma)} label="Karma" />
                  <RedditMetric value={formatCompactCount(payload.posts.length)} label="Contributions" />
                  <RedditMetric value={getAccountAgeLabel(payload.profile.cakeDay)} label="Account Age" />
                  <RedditMetric value={formatCompactCount(activeCommunityCount)} label="Active In" />
                </div>
              </section>
            </header>

            <div className="cp-reddit-tabs" role="tablist" aria-label="Reddit sections">
              {REDDIT_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`cp-reddit-tab${selectedTab === tab.id ? " is-active" : ""}`}
                  onClick={() => setSelectedTab(tab.id)}
                  role="tab"
                  aria-selected={selectedTab === tab.id}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {selectedTab === "posts" && (
              <section className="cp-reddit-feed">
                {payload.posts.map((post) => (
                  <RedditPostCard key={post.id} post={post} />
                ))}
              </section>
            )}

            {selectedTab === "comments" && (
              <section className="cp-reddit-feed">
                {payload.comments.map((comment) => (
                  <RedditCommentCard key={comment.id} comment={comment} />
                ))}
              </section>
            )}

            {selectedTab === "about" && (
              <section className="cp-reddit-about">
                <article className="cp-reddit-about-card">
                  <h3>Profile Stats</h3>
                  <div className="cp-reddit-about-grid">
                    <div>
                      <strong>{formatCompactCount(payload.profile.postKarma)}</strong>
                      <span>Post Karma</span>
                    </div>
                    <div>
                      <strong>{formatCompactCount(payload.profile.commentKarma)}</strong>
                      <span>Comment Karma</span>
                    </div>
                    <div>
                      <strong>{formatCompactCount(payload.posts.length + payload.comments.length)}</strong>
                      <span>Contributions</span>
                    </div>
                    <div>
                      <strong>{formatCompactCount(activeCommunityCount)}</strong>
                      <span>Active In</span>
                    </div>
                  </div>
                </article>

                <article className="cp-reddit-about-card cp-reddit-cake-card">
                  <Cake size={19} strokeWidth={2.2} />
                  <div>
                    <strong>Cake Day</strong>
                    <span>{formatCakeDay(payload.profile.cakeDay)}</span>
                  </div>
                </article>
              </section>
            )}
          </div>
        )}
      </main>

      {payload && (
        <nav className="cp-reddit-bottom-nav" aria-label="Reddit navigation">
          <span className="is-active"><Home size={20} strokeWidth={2.35} />Home</span>
          <span><Bell size={20} strokeWidth={2.35} />Inbox</span>
          <span><UserRound size={20} strokeWidth={2.35} />You</span>
        </nav>
      )}

      {confirmClearOpen && (
        <ConfirmDialog
          title="清空 Reddit 内容？"
          message="确认后会清空当前 Reddit 缓存。之后重新刷新时，不会再带入旧 Reddit 内容。"
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
