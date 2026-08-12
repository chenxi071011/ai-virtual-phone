"use client";

import { useEffect, useMemo, useState } from "react";
import { appNowISO } from "@/lib/app-clock";
import { useCheckPhoneRefresh } from "@/lib/checkphone-refresh-tracker";
import {
  Bookmark,
  ChevronLeft,
  Clapperboard,
  Grid3X3,
  Heart,
  MessageCircle,
  MoreHorizontal,
  RefreshCw,
  Send,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { CheckPhoneBilingualText } from "@/components/checkphone/checkphone-bilingual-text";
import { CheckPhoneDebugErrorCard } from "@/components/checkphone/checkphone-debug-error-card";
import { ConfirmDialog } from "@/components/ui";
import type { Character } from "@/lib/character-types";
import type {
  CheckPhoneInstagramPayload,
  CheckPhoneSnapshot,
} from "@/lib/checkphone-config";
import { generateCheckPhoneInstagram } from "@/lib/checkphone-engine";
import { clearPhoneSnapshot, loadPhoneSnapshot, savePhoneSnapshot } from "@/lib/checkphone-storage";

type CheckPhoneInstagramPageProps = {
  character: Character;
  onBack: () => void;
};

function formatInstagramRelativeTime(iso: string): string {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return iso;
  const now = new Date();
  const diffMs = Math.max(0, now.getTime() - value.getTime());
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 8) return `${weeks}w`;
  return value.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatCount(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(value >= 10000000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1).replace(/\.0$/, "")}K`;
  return String(Math.max(0, Math.round(value)));
}

function normalizeInstagramHandle(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "@instagram";
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

function getInstagramInitial(name: string): string {
  const cleaned = name.trim().replace(/^@+/, "");
  return cleaned.slice(0, 1).toUpperCase() || "I";
}

export function CheckPhoneInstagramPage({ character, onBack }: CheckPhoneInstagramPageProps) {
  const [snapshot, setSnapshot] = useState<CheckPhoneSnapshot<CheckPhoneInstagramPayload> | null>(null);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [commentSheetPostId, setCommentSheetPostId] = useState<string | null>(null);
  const [selectedHighlightId, setSelectedHighlightId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useCheckPhoneRefresh(character.id, "instagram", setSnapshot);
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
    setSelectedPostId(null);
    setCommentSheetPostId(null);
    setSelectedHighlightId(null);
    setDebugRawOutput(null);
    setDebugSanitizedOutput(null);
    setDebugParseMode(null);
    setDebugParseError(null);
    setDebugNormalizeError(null);
    (async () => {
      const cached = await loadPhoneSnapshot<CheckPhoneInstagramPayload>(character.id, "instagram");
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
    } = await generateCheckPhoneInstagram(character.id, snapshot?.payload ?? null, snapshot?.updatedAt);
    if (payload) {
      const now = appNowISO();
      const nextSnapshot: CheckPhoneSnapshot<CheckPhoneInstagramPayload> = {
        id: `${character.id}:instagram`,
        characterId: character.id,
        appId: "instagram",
        generatedAt: snapshot?.generatedAt ?? now,
        updatedAt: now,
        summary,
        payload,
      };
      await savePhoneSnapshot(nextSnapshot);
      setSnapshot(nextSnapshot);
      setSelectedPostId(null);
      setCommentSheetPostId(null);
      setSelectedHighlightId(null);
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
    await clearPhoneSnapshot(character.id, "instagram");
    setSnapshot(null);
    setSelectedPostId(null);
    setCommentSheetPostId(null);
    setSelectedHighlightId(null);
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
  const posts = payload?.posts ?? [];
  const highlights = payload?.highlights?.length
    ? payload.highlights
    : posts.slice(0, 5).map((post, index) => ({
      id: `ig_highlight_fallback_${index + 1}`,
      title: post.imageDescription?.split(/\s+/)[0] || post.location || "post",
      coverIcon: post.coverIcon,
      description: post.imageDescription || post.caption,
    }));
  const activePost = useMemo(
    () => posts.find((post) => post.id === selectedPostId) ?? null,
    [posts, selectedPostId],
  );
  const commentSheetPost = useMemo(
    () => posts.find((post) => post.id === commentSheetPostId) ?? null,
    [posts, commentSheetPostId],
  );
  const selectedHighlight = useMemo(
    () => highlights.find((highlight) => highlight.id === selectedHighlightId) ?? null,
    [highlights, selectedHighlightId],
  );
  const feedPosts = useMemo(() => {
    if (!activePost) return [];
    return [activePost, ...posts.filter((post) => post.id !== activePost.id)];
  }, [activePost, posts]);
  const profileHandle = payload ? normalizeInstagramHandle(payload.profile.username) : "";

  return (
    <div className="cp-instagram-module">
      <header className="cp-instagram-appbar">
        <button type="button" className="cp-instagram-nav-btn" onClick={activePost ? () => setSelectedPostId(null) : onBack} aria-label="Back">
          <ChevronLeft size={23} strokeWidth={2.4} />
        </button>
        <div className="cp-instagram-header-stack">
          <div className="cp-instagram-header-title">{activePost ? "Posts" : payload?.headerTitle || "Instagram"}</div>
          <div className="cp-instagram-header-subtitle">{activePost ? profileHandle.replace(/^@/, "") : payload ? profileHandle : "profile"}</div>
        </div>
        <div className="cp-appbar-actions">
          {!activePost && (
            <>
              <button type="button" className="cp-instagram-nav-btn" onClick={handleRefresh} disabled={loading} aria-label="Refresh">
                <RefreshCw size={16} strokeWidth={2.25} className={loading ? "cp-spin" : ""} />
              </button>
              <button type="button" className="cp-instagram-nav-btn" onClick={() => setConfirmClearOpen(true)} disabled={loading || !snapshot} aria-label="Clear Instagram snapshot">
                <Trash2 size={16} strokeWidth={2.15} />
              </button>
            </>
          )}
        </div>
      </header>

      {loading && (
        <div className="cp-refresh-indicator cp-refresh-indicator--floating" aria-live="polite">
          <span className="cp-refresh-indicator-text">正在刷新 Instagram</span>
          <span className="cp-refresh-indicator-dots" aria-hidden="true">
            <i></i><i></i><i></i>
          </span>
        </div>
      )}

      <div className={`cp-instagram-body ${activePost ? "cp-instagram-body--feed" : ""}`}>
        {!loaded && <div className="cp-instagram-status">正在同步主页...</div>}

        {loaded && !payload && !loading && (
          <div className="cp-instagram-status cp-empty-copy">
            <p>暂无Instagram内容</p>
            <span className="cp-instagram-hint">点刷新同步主页和帖子</span>
          </div>
        )}

        {error ? (
          <CheckPhoneDebugErrorCard
            title="暂时无法解析 Instagram 内容。"
            error={error}
            debugParseMode={debugParseMode}
            debugParseError={debugParseError}
            debugNormalizeError={debugNormalizeError}
            debugRawOutput={debugRawOutput}
            debugSanitizedOutput={debugSanitizedOutput}
          />
        ) : null}

        {payload && !activePost && (
          <>
            <section className="cp-instagram-profile-card">
              <div className="cp-instagram-profile-top">
                <div className="cp-instagram-profile-avatar">{getInstagramInitial(payload.profile.name)}</div>
                <div className="cp-instagram-profile-stats">
                  <div><strong>{posts.length}</strong><span>posts</span></div>
                  <div><strong>{formatCount(payload.profile.followerCount)}</strong><span>followers</span></div>
                  <div><strong>{formatCount(payload.profile.followingCount)}</strong><span>following</span></div>
                </div>
              </div>
              <div className="cp-instagram-profile-main">
                <h3>{payload.profile.name}</h3>
                <span>{profileHandle}</span>
                <p><CheckPhoneBilingualText text={payload.profile.bio} tone="instagram" /></p>
              </div>
              <div className="cp-instagram-profile-actions">
                <button type="button">Edit profile</button>
                <button type="button">Share profile</button>
              </div>
              <div className="cp-instagram-highlight-strip" aria-label="Story highlights">
                {highlights.slice(0, 5).map((highlight) => (
                  <button key={highlight.id} type="button" className="cp-instagram-highlight-item" onClick={() => setSelectedHighlightId(highlight.id)}>
                    <span>{highlight.coverIcon}</span>
                    <small>{highlight.title}</small>
                  </button>
                ))}
              </div>
              <div className="cp-instagram-profile-tabs">
                <span className="is-active"><Grid3X3 size={17} strokeWidth={2.15} /></span>
                <span><Clapperboard size={17} strokeWidth={2.15} /></span>
                <span><UserRound size={17} strokeWidth={2.15} /></span>
              </div>
            </section>

            <div className="cp-instagram-grid">
              {posts.map((post) => (
                <button key={post.id} type="button" className="cp-instagram-tile" onClick={() => setSelectedPostId(post.id)}>
                  <div className="cp-instagram-tile-cover">{post.coverIcon}</div>
                  <span className="cp-instagram-tile-caption">{post.imageDescription || post.location || ""}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {payload && activePost && (
          <section className="cp-instagram-feed" aria-label="Instagram posts">
            {feedPosts.map((post) => (
              <article key={post.id} className="cp-instagram-feed-post">
                <div className="cp-instagram-post-head">
                  <div className="cp-instagram-post-avatar">{getInstagramInitial(payload.profile.name)}</div>
                  <div className="cp-instagram-post-author">
                    <strong>
                      {payload.profile.name}
                      <span>{post.location || profileHandle}</span>
                    </strong>
                  </div>
                  <MoreHorizontal size={19} strokeWidth={2.2} />
                </div>
                <div className="cp-instagram-post-visual">
                  <span className="cp-instagram-post-icon">{post.coverIcon}</span>
                  {post.imageDescription ? <span className="cp-instagram-post-description">{post.imageDescription}</span> : null}
                </div>
                <div className="cp-instagram-post-actions">
                  <button type="button" aria-label="Like"><Heart size={23} strokeWidth={2.25} /><span>{formatCount(post.likeCount)}</span></button>
                  <button type="button" onClick={() => setCommentSheetPostId(post.id)} aria-label="Comments"><MessageCircle size={23} strokeWidth={2.25} /><span>{formatCount(post.commentCount)}</span></button>
                  <button type="button" aria-label="Share"><Send size={22} strokeWidth={2.2} /><span>{formatCount(post.shareCount)}</span></button>
                  <button type="button" aria-label="Save"><Bookmark size={23} strokeWidth={2.25} /></button>
                </div>
                <div className="cp-instagram-post-copy">
                  <strong>{formatCount(post.likeCount)} likes</strong>
                  <p>
                    <b>{payload.profile.name}</b>{" "}
                    <CheckPhoneBilingualText text={post.caption} tone="instagram" variant="inline" />
                  </p>
                  <button type="button" onClick={() => setCommentSheetPostId(post.id)}>
                    View all {post.comments.length} comments
                  </button>
                  <time>{formatInstagramRelativeTime(post.createdAt)}</time>
                </div>
              </article>
            ))}
          </section>
        )}
      </div>

      {commentSheetPost && (
        <div className="cp-instagram-sheet-backdrop" onClick={() => setCommentSheetPostId(null)}>
          <section className="cp-instagram-comments-sheet" onClick={(event) => event.stopPropagation()} aria-label="Comments">
            <div className="cp-instagram-sheet-handle" />
            <div className="cp-instagram-sheet-head">
              <span />
              <strong>Comments</strong>
              <Send size={19} strokeWidth={2.2} />
            </div>
            <div className="cp-instagram-comment-search">Search · {commentSheetPost.imageDescription || commentSheetPost.location || "comments"}</div>
            <div className="cp-instagram-comment-list">
              {commentSheetPost.comments.map((comment) => (
                <div key={comment.id} className="cp-instagram-comment">
                  <div className="cp-instagram-comment-avatar">{getInstagramInitial(comment.authorName)}</div>
                  <div className="cp-instagram-comment-main">
                    <div className="cp-instagram-comment-heading">
                      <strong>{comment.authorName}</strong>
                      <span className="cp-instagram-comment-time">{formatInstagramRelativeTime(comment.createdAt)}</span>
                    </div>
                    <p>
                      <CheckPhoneBilingualText text={comment.text} tone="instagram" variant="inline" />
                    </p>
                    <div className="cp-instagram-comment-meta">
                      <span>Reply</span>
                      <span>Share</span>
                    </div>
                  </div>
                  <Heart size={17} strokeWidth={2.1} />
                </div>
              ))}
            </div>
            <div className="cp-instagram-reaction-row" aria-hidden="true">
              <span>❤️</span><span>🙌</span><span>🔥</span><span>👏</span><span>🥹</span><span>😍</span><span>😂</span>
            </div>
            <div className="cp-instagram-comment-input">
              <div className="cp-instagram-comment-input-avatar">{getInstagramInitial(payload?.profile.name || "")}</div>
              <span>Add a comment for {commentSheetPost ? payload?.profile.name : "Instagram"}</span>
              <b>GIF</b>
            </div>
          </section>
        </div>
      )}

      {selectedHighlight && (
        <div className="cp-instagram-story-backdrop" onClick={() => setSelectedHighlightId(null)}>
          <section className="cp-instagram-story-viewer" onClick={(event) => event.stopPropagation()} aria-label="Story highlight">
            <div className="cp-instagram-story-progress" aria-hidden="true"><span /></div>
            <div className="cp-instagram-story-head">
              <div className="cp-instagram-story-avatar">{selectedHighlight.coverIcon}</div>
              <div>
                <strong>{selectedHighlight.title}</strong>
                <span>{profileHandle}</span>
              </div>
              <button type="button" onClick={() => setSelectedHighlightId(null)} aria-label="Close story highlight">
                <X size={18} strokeWidth={2.2} />
              </button>
            </div>
            <div className="cp-instagram-story-content">
              <span className="cp-instagram-story-icon">{selectedHighlight.coverIcon}</span>
              <h3>{selectedHighlight.title}</h3>
              <p><CheckPhoneBilingualText text={selectedHighlight.description} tone="instagram" /></p>
            </div>
          </section>
        </div>
      )}

      {confirmClearOpen && (
        <ConfirmDialog
          title="清空 Instagram 内容？"
          message="确认后会清空当前 Instagram 缓存。之后重新刷新时，不会再带入旧 Instagram 内容。"
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
