"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type TouchEvent, type UIEvent, type WheelEvent } from "react";
import { appNowISO } from "@/lib/app-clock";
import { useCheckPhoneRefresh } from "@/lib/checkphone-refresh-tracker";
import { ChevronDown, ChevronLeft, CirclePlus, Eraser, Heart, House, MessageCircleMore, Mic, MoreHorizontal, RotateCcw, Settings, Smile, Plus, Search, Share } from "lucide-react";
import { CheckPhoneBilingualText } from "@/components/checkphone/checkphone-bilingual-text";
import { ConfirmDialog } from "@/components/ui";
import { CheckPhoneDebugErrorCard } from "@/components/checkphone/checkphone-debug-error-card";
import type { Character } from "@/lib/character-types";
import type {
  CheckPhoneSnapshot,
  CheckPhoneXiaohongshuNote,
  CheckPhoneXiaohongshuPayload,
  CheckPhoneXiaohongshuThread,
  CheckPhoneXiaohongshuTone,
} from "@/lib/checkphone-config";
import { generateCheckPhoneXiaohongshu } from "@/lib/checkphone-engine";
import { clearPhoneSnapshot, loadPhoneSnapshot, savePhoneSnapshot } from "@/lib/checkphone-storage";
import { normalizeBilingualTextInput, splitBilingualText } from "@/lib/bilingual-text";
import { kvGet, kvSet } from "@/lib/kv-db";

type CheckPhoneXiaohongshuPageProps = {
  character: Character;
  onBack: () => void;
};

type XiaohongshuTabId = "home" | "video" | "publish" | "messages" | "profile";

const XHS_TABS: Array<{ id: XiaohongshuTabId; label: string; icon?: typeof House }> = [
  { id: "home", label: "首页" },
  { id: "video", label: "视频" },
  { id: "publish", label: "发布" }, // 特殊处理
  { id: "messages", label: "消息" },
  { id: "profile", label: "我" },
];

const XHS_DECOR_CATEGORIES = ["推荐", "视频", "直播", "短剧", "穿搭", "彩妆"] as const;
const XHS_READ_THREADS_STORAGE_PREFIX = "checkphone:xiaohongshu:readThreads";

function getReadThreadsStorageKey(characterId: string, snapshotUpdatedAt: string): string {
  return `${XHS_READ_THREADS_STORAGE_PREFIX}:${characterId}:${snapshotUpdatedAt}`;
}

function loadReadThreadIds(characterId: string, snapshotUpdatedAt: string): Set<string> {
  if (typeof window === "undefined" || !snapshotUpdatedAt) return new Set();
  try {
    const parsed = JSON.parse(kvGet(getReadThreadsStorageKey(characterId, snapshotUpdatedAt)) || "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === "string") : []);
  } catch {
    return new Set();
  }
}

function saveReadThreadIds(characterId: string, snapshotUpdatedAt: string, ids: Set<string>): void {
  if (typeof window === "undefined" || !snapshotUpdatedAt) return;
  kvSet(getReadThreadsStorageKey(characterId, snapshotUpdatedAt), JSON.stringify([...ids]));
}

function formatCount(count: number): string {
  if (count >= 10000) return `${(count / 10000).toFixed(count >= 100000 ? 0 : 1).replace(/\.0$/, "")}万`;
  if (count >= 1000) return `${(count / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(count);
}

function formatBadgeCount(count: number): string {
  if (count > 99) return "99+";
  return String(Math.max(0, Math.round(count)));
}

function makeXiaohongshuHash(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function getVisibleEngagementCounts(note: CheckPhoneXiaohongshuNote): {
  likeCount: number;
  commentCount: number;
  saveCount: number;
} {
  const commentCount = Math.max(0, Math.round(note.commentCount));
  const likeCount = Math.max(0, Math.round(note.likeCount));
  const saveCount = Math.max(0, Math.round(note.saveCount));
  const hasLargeCommentGap =
    commentCount > 0 &&
    (
      likeCount * 3 < commentCount ||
      saveCount * 3 < commentCount
    );

  if (!hasLargeCommentGap) return { likeCount, commentCount, saveCount };
  const adjustedEngagementCount = commentCount * 5;
  return { likeCount: adjustedEngagementCount, commentCount, saveCount: adjustedEngagementCount };
}

function formatXiaohongshuRelativeTime(ageMinutes: number): string {
  if (ageMinutes < 60) return `${Math.max(1, ageMinutes)}分钟前`;
  if (ageMinutes < 1440) return `${Math.max(1, Math.round(ageMinutes / 60))}小时前`;
  if (ageMinutes < 43200) return `${Math.max(1, Math.round(ageMinutes / 1440))}天前`;
  return `${Math.max(1, Math.round(ageMinutes / 43200))}个月前`;
}

function makeXiaohongshuNoteTimeLabel(note: CheckPhoneXiaohongshuNote): string {
  const { likeCount, commentCount, saveCount } = getVisibleEngagementCounts(note);
  const engagementScore = likeCount + saveCount + commentCount * 2;
  const seed = makeXiaohongshuHash(`${note.id}:${note.authorName}:${note.title}`);
  const pickAge = (min: number, max: number) => min + (seed % Math.max(1, max - min + 1));

  const ageMinutes =
    engagementScore >= 50000 ? pickAge(43200, 259200) :
    engagementScore >= 10000 ? pickAge(20160, 86400) :
    engagementScore >= 3000 ? pickAge(7200, 30240) :
    engagementScore >= 1000 ? pickAge(2880, 11520) :
    engagementScore >= 300 ? pickAge(720, 4320) :
    engagementScore >= 80 ? pickAge(180, 1440) :
    pickAge(20, 480);

  return `发布于 ${formatXiaohongshuRelativeTime(ageMinutes)}`;
}

function makeXiaohongshuNumericId(seed: string): string {
  return String(1000000000 + makeXiaohongshuHash(seed) % 9000000000);
}

function getThreadPreview(thread: CheckPhoneXiaohongshuThread): string {
  const last = thread.messages[thread.messages.length - 1];
  return getXiaohongshuListPlainText(last?.text?.trim() || "");
}

function getXiaohongshuListPlainText(text: string): string {
  const normalized = normalizeBilingualTextInput(text);
  return splitBilingualText(normalized)?.original ?? normalized;
}

function getThreadTime(thread: CheckPhoneXiaohongshuThread): string {
  const last = thread.messages[thread.messages.length - 1];
  return last?.timeLabel || "";
}

function isThreadUnread(thread: CheckPhoneXiaohongshuThread): boolean {
  const last = thread.messages[thread.messages.length - 1];
  return last?.direction === "incoming";
}

function isThreadVisibleUnread(thread: CheckPhoneXiaohongshuThread, readThreadIds: Set<string>): boolean {
  return isThreadUnread(thread) && !readThreadIds.has(thread.id);
}

function XiaohongshuCover({ icon, tone, large = false }: { icon: string; tone: CheckPhoneXiaohongshuTone; large?: boolean }) {
  return (
    <div className={`cp-xhs-cover cp-xhs-cover--${tone} ${large ? "cp-xhs-cover--large" : ""}`}>
      <span className={`cp-xhs-cover-icon ${large ? "cp-xhs-cover-icon--large" : ""}`}>{icon}</span>
    </div>
  );
}

function XiaohongshuVideoCover({ note, large = false }: { note: CheckPhoneXiaohongshuNote; large?: boolean }) {
  const videoText = note.videoDescription?.trim() || "";
  return (
    <div className={`cp-xhs-cover cp-xhs-cover--video cp-xhs-cover--${note.tone} ${large ? "cp-xhs-cover--large" : ""}`}>
      {videoText ? <span><CheckPhoneBilingualText text={videoText} tone="light" /></span> : null}
    </div>
  );
}

function XiaohongshuOverviewGlyph({ type }: { type: "heart" | "user" | "chat" }) {
  if (type === "heart") {
    return (
      <svg className="cp-xhs-overview-glyph" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 21.2c-.35 0-.7-.13-.98-.39C4.88 15.28 2 12.67 2 8.72 2 5.58 4.47 3.1 7.58 3.1c1.75 0 3.43.82 4.42 2.11.99-1.29 2.67-2.11 4.42-2.11C19.53 3.1 22 5.58 22 8.72c0 3.95-2.88 6.56-9.02 12.09-.28.26-.63.39-.98.39Z" />
      </svg>
    );
  }
  if (type === "user") {
    return (
      <svg className="cp-xhs-overview-glyph" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 11.2a4.55 4.55 0 1 0 0-9.1 4.55 4.55 0 0 0 0 9.1ZM4.15 21.06c0-4.13 3.52-7.48 7.85-7.48s7.85 3.35 7.85 7.48c0 .54-.39.99-.92 1.07-2.12.31-4.43.47-6.93.47s-4.81-.16-6.93-.47a1.08 1.08 0 0 1-.92-1.07Z" />
      </svg>
    );
  }
  return (
    <svg className="cp-xhs-overview-glyph" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.15c5.54 0 10 3.82 10 8.55s-4.46 8.55-10 8.55c-1.11 0-2.18-.15-3.18-.44l-3.54 1.56a.75.75 0 0 1-1.02-.88l.9-3.3C3.22 15.69 2 13.56 2 11.7c0-4.73 4.46-8.55 10-8.55Z" />
      <circle cx="8.8" cy="11.45" r="1.18" fill="white" />
      <circle cx="15.2" cy="11.45" r="1.18" fill="white" />
    </svg>
  );
}

function getNoteCardVariant(note: CheckPhoneXiaohongshuNote): "compact" | "regular" | "tall" {
  const signal = note.title.length + note.body.length + note.tags.length * 4 + note.comments.length * 6;
  if (signal >= 68) return "tall";
  if (signal >= 44) return "regular";
  return "compact";
}

function splitNotesIntoColumns(notes: CheckPhoneXiaohongshuNote[]): [CheckPhoneXiaohongshuNote[], CheckPhoneXiaohongshuNote[]] {
  const left: CheckPhoneXiaohongshuNote[] = [];
  const right: CheckPhoneXiaohongshuNote[] = [];
  notes.forEach((note, index) => {
    if (index % 2 === 0) left.push(note);
    else right.push(note);
  });
  return [left, right];
}

function orderCommentsForDisplay(
  comments: CheckPhoneXiaohongshuNote["comments"],
): CheckPhoneXiaohongshuNote["comments"] {
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  const indexById = new Map(comments.map((comment, index) => [comment.id, index]));
  const childrenByParent = new Map<string, CheckPhoneXiaohongshuNote["comments"]>();
  const childIds = new Set<string>();

  function wouldCreateCycle(commentId: string, parentId: string) {
    const seen = new Set<string>([commentId]);
    let currentId = parentId;
    while (currentId) {
      if (seen.has(currentId)) return true;
      seen.add(currentId);
      currentId = byId.get(currentId)?.replyToCommentId || "";
    }
    return false;
  }

  comments.forEach((comment) => {
    const parentId = comment.replyToCommentId;
    if (!parentId || !byId.has(parentId) || wouldCreateCycle(comment.id, parentId)) return;
    childIds.add(comment.id);
    const children = childrenByParent.get(parentId) ?? [];
    children.push(comment);
    childrenByParent.set(parentId, children);
  });

  childrenByParent.forEach((children) => {
    children.sort((a, b) => (indexById.get(a.id) ?? 0) - (indexById.get(b.id) ?? 0));
  });

  const ordered: CheckPhoneXiaohongshuNote["comments"] = [];
  const visited = new Set<string>();
  function visit(comment: CheckPhoneXiaohongshuNote["comments"][number]) {
    if (visited.has(comment.id)) return;
    visited.add(comment.id);
    ordered.push(comment);
    (childrenByParent.get(comment.id) ?? []).forEach(visit);
  }

  comments.filter((comment) => !childIds.has(comment.id)).forEach(visit);
  comments.forEach(visit);
  return ordered;
}

function getCommentReplyDepth(
  comments: CheckPhoneXiaohongshuNote["comments"],
  comment: CheckPhoneXiaohongshuNote["comments"][number],
): 0 | 1 | 2 | 3 {
  const byId = new Map(comments.map((item) => [item.id, item]));
  const seen = new Set<string>([comment.id]);
  let depth = 0;
  let cursor = comment;
  while (cursor.replyToCommentId && depth < 3) {
    const parent = byId.get(cursor.replyToCommentId);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    depth += 1;
    cursor = parent;
  }
  return Math.min(depth, 3) as 0 | 1 | 2 | 3;
}

function getCommentReplyTargetName(
  comments: CheckPhoneXiaohongshuNote["comments"],
  comment: CheckPhoneXiaohongshuNote["comments"][number],
): string {
  if (comment.replyTo?.trim()) return comment.replyTo.trim();
  if (!comment.replyToCommentId) return "";
  return comments.find((item) => item.id === comment.replyToCommentId)?.authorName ?? "";
}

function XiaohongshuCommentList({ comments }: { comments: CheckPhoneXiaohongshuNote["comments"] }) {
  if (comments.length === 0) {
    return <div className="cp-xhs-mini-empty">还没有人评论，快来抢沙发~</div>;
  }

  const orderedComments = orderCommentsForDisplay(comments);

  return (
    <>
      {orderedComments.map((comment) => {
        const replyDepth = getCommentReplyDepth(comments, comment);
        const visualReplyDepth = replyDepth > 0 ? 1 : 0;
        const replyTargetName = replyDepth > 0 ? getCommentReplyTargetName(comments, comment) : "";
        return (
          <div key={comment.id} className={`cp-xhs-comment-card cp-xhs-comment-card--depth-${visualReplyDepth}`}>
            <div className="cp-xhs-comment-avatar">{comment.authorName.slice(0, 1)}</div>
            <div className="cp-xhs-comment-content">
              <strong>
                {comment.authorName}
                {replyTargetName ? (
                  <>
                    <span className="cp-xhs-comment-reply-label">回复</span>
                    {replyTargetName}
                  </>
                ) : null}
              </strong>
              <p><CheckPhoneBilingualText text={comment.text} tone="xiaohongshu" variant="inline" /></p>
            </div>
          </div>
        );
      })}
    </>
  );
}

function XiaohongshuNoteCard({
  note,
  onOpen,
  displayMode = "note",
}: {
  note: CheckPhoneXiaohongshuNote;
  onOpen: () => void;
  displayMode?: "note" | "video";
}) {
  const variant = getNoteCardVariant(note);
  const engagementCounts = getVisibleEngagementCounts(note);
  const isVideo = displayMode === "video";
  return (
    <button
      type="button"
      className={`cp-xhs-note-card cp-xhs-note-card--${variant} ${isVideo ? "cp-xhs-note-card--video" : ""}`}
      onClick={onOpen}
    >
      {isVideo ? (
        <XiaohongshuVideoCover note={note} />
      ) : (
        <XiaohongshuCover icon={note.coverIcon} tone={note.tone} />
      )}
      <div className="cp-xhs-note-body">
        <strong><CheckPhoneBilingualText text={note.title} tone="xiaohongshu" /></strong>
        <p><CheckPhoneBilingualText text={note.body} tone="xiaohongshu" /></p>
        <div className="cp-xhs-note-foot">
          <div className="cp-xhs-note-author">
            <div className="cp-xhs-note-author-avatar">{note.authorName.slice(0, 1)}</div>
            <span>{note.authorName}</span>
          </div>
          <em className={note.liked ? "is-liked" : ""}>
            <Heart size={12} strokeWidth={2.5} fill={note.liked ? "currentColor" : "none"} />
            {formatCount(engagementCounts.likeCount)}
          </em>
        </div>
      </div>
    </button>
  );
}

export function CheckPhoneXiaohongshuPage({ character, onBack }: CheckPhoneXiaohongshuPageProps) {
  const [snapshot, setSnapshot] = useState<CheckPhoneSnapshot<CheckPhoneXiaohongshuPayload> | null>(null);
  const [selectedTab, setSelectedTab] = useState<XiaohongshuTabId>("home");
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useCheckPhoneRefresh(character.id, "xiaohongshu", setSnapshot);
  const [error, setError] = useState<string | null>(null);
  const [debugRawOutput, setDebugRawOutput] = useState<string | null>(null);
  const [debugParseMode, setDebugParseMode] = useState<"sanitized" | "failed" | null>(null);
  const [debugParseError, setDebugParseError] = useState<string | null>(null);
  const [debugNormalizeError, setDebugNormalizeError] = useState<string | null>(null);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [readThreadIds, setReadThreadIds] = useState<Set<string>>(() => new Set());
  const [profileTopbarVisible, setProfileTopbarVisible] = useState(false);
  const [videoCommentsOpen, setVideoCommentsOpen] = useState(false);
  const videoSwipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const videoLastWheelAtRef = useRef(0);
  const videoSettleTimerRef = useRef<number | null>(null);
  const [videoDragOffset, setVideoDragOffset] = useState(0);
  const [videoDragSettling, setVideoDragSettling] = useState(false);
  const [videoDragDirection, setVideoDragDirection] = useState<"previous" | "next" | null>(null);
  const [videoCaptionExpanded, setVideoCaptionExpanded] = useState(false);
  const [videoCaptionCanExpand, setVideoCaptionCanExpand] = useState(false);
  const [collapsedVideoCaption, setCollapsedVideoCaption] = useState("");
  const videoCaptionMeasureRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setProfileTopbarVisible(false);
  }, [selectedTab]);

  useEffect(() => {
    setVideoCommentsOpen(false);
    setVideoDragOffset(0);
    setVideoDragSettling(false);
    setVideoDragDirection(null);
    setVideoCaptionExpanded(false);
    setVideoCaptionCanExpand(false);
    setCollapsedVideoCaption("");
  }, [selectedNoteId]);

  useEffect(() => {
    return () => {
      if (videoSettleTimerRef.current !== null) {
        window.clearTimeout(videoSettleTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setError(null);
    setSnapshot(null);
    setDebugRawOutput(null);
    setDebugParseMode(null);
    setDebugParseError(null);
    setDebugNormalizeError(null);
    setSelectedTab("home");
    setSelectedNoteId(null);
    setSelectedThreadId(null);
    setReadThreadIds(new Set());
    setProfileTopbarVisible(false);
    setVideoCommentsOpen(false);
    (async () => {
      const cached = await loadPhoneSnapshot<CheckPhoneXiaohongshuPayload>(character.id, "xiaohongshu");
      if (cancelled) return;
      setSnapshot(cached);
      setReadThreadIds(cached ? loadReadThreadIds(character.id, cached.updatedAt) : new Set());
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
    setDebugParseMode(null);
    setDebugParseError(null);
    setDebugNormalizeError(null);
    const {
      payload,
      summary,
      error: nextError,
      debugRawOutput: nextDebugRawOutput,
      debugParseMode: nextDebugParseMode,
      debugParseError: nextDebugParseError,
      debugNormalizeError: nextDebugNormalizeError,
    } = await generateCheckPhoneXiaohongshu(
      character.id,
      snapshot?.payload ?? null,
      snapshot?.updatedAt,
    );
    if (payload) {
      const now = appNowISO();
      const nextSnapshot: CheckPhoneSnapshot<CheckPhoneXiaohongshuPayload> = {
        id: `${character.id}:xiaohongshu`,
        characterId: character.id,
        appId: "xiaohongshu",
        generatedAt: snapshot?.generatedAt ?? now,
        updatedAt: now,
        summary,
        payload,
      };
      await savePhoneSnapshot(nextSnapshot);
      setSnapshot(nextSnapshot);
      setSelectedNoteId(null);
      setSelectedThreadId(null);
      setReadThreadIds(loadReadThreadIds(character.id, nextSnapshot.updatedAt));
      setProfileTopbarVisible(false);
      setVideoCommentsOpen(false);
    }
    setError(nextError ?? null);
    setDebugRawOutput(nextDebugRawOutput ?? null);
    setDebugParseMode(nextDebugParseMode ?? null);
    setDebugParseError(nextDebugParseError ?? null);
    setDebugNormalizeError(nextDebugNormalizeError ?? null);
    setLoading(false);
    setLoaded(true);
  }

  async function handleClear() {
    if (loading) return;
    await clearPhoneSnapshot(character.id, "xiaohongshu");
    setSnapshot(null);
    setSelectedTab("home");
    setSelectedNoteId(null);
    setSelectedThreadId(null);
    setReadThreadIds(new Set());
    setProfileTopbarVisible(false);
    setVideoCommentsOpen(false);
    setError(null);
    setDebugRawOutput(null);
    setDebugParseMode(null);
    setDebugParseError(null);
    setDebugNormalizeError(null);
    setLoaded(true);
    setConfirmClearOpen(false);
  }

  const payload = snapshot?.payload ?? null;
  const allNotes = useMemo(
    () => payload ? [...payload.homeNotes, ...(payload.videoNotes ?? []), ...payload.myNotes] : [],
    [payload],
  );
  const activeNote = useMemo(
    () => allNotes.find((note) => note.id === selectedNoteId) ?? null,
    [allNotes, selectedNoteId],
  );
  const activeNoteIsVideo = useMemo(
    () => Boolean(activeNote && payload?.videoNotes.some((note) => note.id === activeNote.id)),
    [activeNote, payload?.videoNotes],
  );
  const activeVideoNoteIndex = useMemo(
    () => payload?.videoNotes.findIndex((note) => note.id === selectedNoteId) ?? -1,
    [payload?.videoNotes, selectedNoteId],
  );
  const activeNoteEngagementCounts = useMemo(
    () => activeNote ? getVisibleEngagementCounts(activeNote) : null,
    [activeNote],
  );
  const activeNoteTimeLabel = useMemo(
    () => activeNote ? makeXiaohongshuNoteTimeLabel(activeNote) : "",
    [activeNote],
  );
  const activeVideoCaption = activeNoteIsVideo ? activeNote?.body ?? "" : "";
  const activeThread = useMemo(
    () => payload?.messageThreads.find((thread) => thread.id === selectedThreadId) ?? null,
    [payload, selectedThreadId],
  );
  const homeColumns = useMemo(
    () => splitNotesIntoColumns(payload?.homeNotes ?? []),
    [payload?.homeNotes],
  );
  const videoColumns = useMemo(
    () => splitNotesIntoColumns(payload?.videoNotes ?? []),
    [payload?.videoNotes],
  );
  const myColumns = useMemo(
    () => splitNotesIntoColumns(payload?.myNotes ?? []),
    [payload?.myNotes],
  );
  const messageBadgeCount = useMemo(() => {
    if (!payload) return 0;
    return payload.messageOverview.likesAndSavesCount
      + payload.messageOverview.newFollowersCount
      + payload.messageOverview.commentsAndMentionsCount
      + payload.messageThreads.filter((thread) => isThreadVisibleUnread(thread, readThreadIds)).length;
  }, [payload, readThreadIds]);
  const xiaohongshuNumericId = useMemo(
    () => makeXiaohongshuNumericId(`${character.id}:${character.name}`),
    [character.id, character.name],
  );
  const videoMovableStyle: CSSProperties = {
    transform: `translate3d(0, ${videoDragOffset}px, 0)`,
    transition: videoDragSettling ? "transform 190ms cubic-bezier(0.2, 0.82, 0.2, 1)" : "none",
    willChange: "transform",
  };
  const videoPreviewNote = videoDragDirection ? getSiblingVideo(videoDragDirection) : undefined;
  const videoPreviewStyle: CSSProperties | null = videoDragDirection
    ? {
        transform:
          videoDragDirection === "next"
            ? `translate3d(0, calc(${videoDragOffset}px + 100vh), 0)`
            : `translate3d(0, calc(${videoDragOffset}px - 100vh), 0)`,
        transition: videoDragSettling ? "transform 190ms cubic-bezier(0.2, 0.82, 0.2, 1)" : "none",
        willChange: "transform",
        pointerEvents: "none",
      }
    : null;

  useEffect(() => {
    if (!activeVideoCaption || videoCaptionExpanded) return;
    const frame = window.requestAnimationFrame(() => {
      const measureNode = videoCaptionMeasureRef.current;
      if (!measureNode) return;

      const computedStyle = window.getComputedStyle(measureNode);
      const lineHeight = Number.parseFloat(computedStyle.lineHeight) || 19.6;
      const maxHeight = lineHeight * 3 + 1;

      measureNode.textContent = activeVideoCaption;
      if (measureNode.scrollHeight <= maxHeight) {
        setVideoCaptionCanExpand(false);
        setCollapsedVideoCaption(activeVideoCaption);
        return;
      }

      let left = 0;
      let right = activeVideoCaption.length;
      let best = "";
      while (left <= right) {
        const middle = Math.floor((left + right) / 2);
        const candidate = activeVideoCaption.slice(0, middle).trimEnd();
        measureNode.textContent = `${candidate}...  展开`;
        if (measureNode.scrollHeight <= maxHeight) {
          best = candidate;
          left = middle + 1;
        } else {
          right = middle - 1;
        }
      }

      setVideoCaptionCanExpand(true);
      setCollapsedVideoCaption(best.slice(0, Math.max(0, best.length - 1)).trimEnd());
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeNote?.id, activeVideoCaption, videoCaptionExpanded]);

  const backAction = activeNote
    ? () => setSelectedNoteId(null)
    : activeThread
      ? () => setSelectedThreadId(null)
      : onBack;

  function handleThreadOpen(thread: CheckPhoneXiaohongshuThread) {
    if (isThreadUnread(thread)) {
      setReadThreadIds((current) => {
        if (current.has(thread.id)) return current;
        const next = new Set(current);
        next.add(thread.id);
        if (snapshot?.updatedAt) {
          saveReadThreadIds(character.id, snapshot.updatedAt, next);
        }
        return next;
      });
    }
    setSelectedThreadId(thread.id);
  }

  function handleMainScroll(event: UIEvent<HTMLDivElement>) {
    if (selectedTab !== "profile") {
      setProfileTopbarVisible(false);
      return;
    }
    const nextVisible = event.currentTarget.scrollTop >= 58;
    setProfileTopbarVisible((current) => current === nextVisible ? current : nextVisible);
  }

  function renderRootBackButton(color = "#333333") {
    return (
      <button
        type="button"
        className="cp-float-back"
        onClick={onBack}
        aria-label="Back"
        style={{ color, width: "26px", height: "26px" }}
      >
        <ChevronLeft size={26} strokeWidth={2} />
      </button>
    );
  }

  function renderRootActions(color = "#333333") {
    return (
      <div className="cp-appbar-actions" style={{ gap: "16px", color }}>
        <button
          type="button"
          className="cp-float-refresh"
          onClick={handleRefresh}
          disabled={loading}
          aria-label="Refresh"
          style={{ color, width: "20px", height: "20px" }}
        >
          <RotateCcw size={20} strokeWidth={2} className={loading ? "cp-spin" : ""} />
        </button>
        <button
          type="button"
          className="cp-float-clear"
          onClick={() => setConfirmClearOpen(true)}
          disabled={loading || !snapshot}
          aria-label="Clear Xiaohongshu snapshot"
          style={{ color, width: "20px", height: "20px", opacity: loading || !snapshot ? 0.45 : 1 }}
        >
          <Eraser size={20} strokeWidth={2} />
        </button>
      </div>
    );
  }

  function getSiblingVideo(direction: "previous" | "next") {
    if (!payload || activeVideoNoteIndex < 0) return undefined;
    const nextIndex = direction === "previous" ? activeVideoNoteIndex - 1 : activeVideoNoteIndex + 1;
    return payload.videoNotes[nextIndex];
  }

  function settleVideoDrag(nextNoteId?: string) {
    if (videoSettleTimerRef.current !== null) {
      window.clearTimeout(videoSettleTimerRef.current);
    }
    videoSettleTimerRef.current = window.setTimeout(() => {
      if (nextNoteId) setSelectedNoteId(nextNoteId);
      setVideoDragSettling(false);
      setVideoDragOffset(0);
      setVideoDragDirection(null);
      videoSettleTimerRef.current = null;
    }, 190);
  }

  function animateSiblingVideo(direction: "previous" | "next"): boolean {
    if (!activeNoteIsVideo || videoCommentsOpen) return false;
    const nextVideo = getSiblingVideo(direction);
    if (!nextVideo) return false;
    setVideoDragSettling(true);
    setVideoDragDirection(direction);
    setVideoDragOffset(direction === "next" ? -window.innerHeight : window.innerHeight);
    settleVideoDrag(nextVideo.id);
    return true;
  }

  function handleVideoWheel(event: WheelEvent<HTMLDivElement>) {
    if (videoCommentsOpen) return;
    const absY = Math.abs(event.deltaY);
    if (absY < 42 || absY < Math.abs(event.deltaX)) return;
    event.preventDefault();
    const now = Date.now();
    if (now - videoLastWheelAtRef.current < 520) return;
    videoLastWheelAtRef.current = now;
    animateSiblingVideo(event.deltaY > 0 ? "next" : "previous");
  }

  function handleVideoTouchStart(event: TouchEvent<HTMLDivElement>) {
    if (videoCommentsOpen) return;
    if (videoSettleTimerRef.current !== null) {
      window.clearTimeout(videoSettleTimerRef.current);
      videoSettleTimerRef.current = null;
    }
    setVideoDragSettling(false);
    setVideoDragOffset(0);
    setVideoDragDirection(null);
    const touch = event.touches[0];
    videoSwipeStartRef.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
  }

  function handleVideoTouchMove(event: TouchEvent<HTMLDivElement>) {
    if (videoCommentsOpen) return;
    const start = videoSwipeStartRef.current;
    const touch = event.touches[0];
    if (!start || !touch) return;
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    const absY = Math.abs(deltaY);
    if (absY < 2 || absY < Math.abs(deltaX) * 1.12) return;
    const direction = deltaY < 0 ? "next" : "previous";
    const nextVideo = getSiblingVideo(direction);
    if (!nextVideo) {
      setVideoDragOffset(0);
      setVideoDragDirection(null);
      return;
    }
    event.preventDefault();
    setVideoDragSettling(false);
    setVideoDragDirection(direction);
    setVideoDragOffset(deltaY);
  }

  function handleVideoTouchEnd(event: TouchEvent<HTMLDivElement>) {
    if (videoCommentsOpen) return;
    const start = videoSwipeStartRef.current;
    videoSwipeStartRef.current = null;
    const touch = event.changedTouches[0];
    if (!start || !touch) return;
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    const absY = Math.abs(deltaY);
    if (absY < 56 || absY < Math.abs(deltaX) * 1.15) {
      setVideoDragSettling(true);
      setVideoDragOffset(0);
      settleVideoDrag();
      return;
    }
    const direction = deltaY < 0 ? "next" : "previous";
    const nextVideo = getSiblingVideo(direction);
    if (!nextVideo) {
      setVideoDragSettling(true);
      setVideoDragOffset(0);
      settleVideoDrag();
      return;
    }
    setVideoDragSettling(true);
    setVideoDragDirection(direction);
    setVideoDragOffset(direction === "next" ? -window.innerHeight : window.innerHeight);
    settleVideoDrag(nextVideo.id);
  }

  function renderVideoMovingLayer(note: CheckPhoneXiaohongshuNote, style: CSSProperties, preview = false) {
    const showCaptionControls = !preview && note.id === activeNote?.id;
    return (
      <div className={`cp-xhs-video-moving-layer${preview ? " cp-xhs-video-moving-layer--preview" : ""}`} style={style}>
        <main className="cp-xhs-video-stage">
          <div className={`cp-xhs-video-frame cp-xhs-cover--${note.tone}`}>
            {note.videoDescription?.trim() ? (
              <div className="cp-xhs-video-frame-text"><CheckPhoneBilingualText text={note.videoDescription.trim()} tone="light" /></div>
            ) : null}
          </div>

          <section className="cp-xhs-video-meta">
            <div className="cp-xhs-video-author-row">
              <div className="cp-xhs-video-author-avatar">{note.authorName.slice(0, 1)}</div>
              <strong>{note.authorName}</strong>
              <button type="button">关注</button>
              <time>{makeXiaohongshuNoteTimeLabel(note).replace(/^发布于\s*/, "")}</time>
            </div>
            <h3><CheckPhoneBilingualText text={note.title} tone="light" /></h3>
            <div className="cp-xhs-video-caption-wrap">
              {showCaptionControls ? (
                <div
                  ref={videoCaptionMeasureRef}
                  aria-hidden="true"
                  className="cp-xhs-video-caption-measure"
                />
              ) : null}
              <p className={!videoCaptionExpanded || preview ? "is-collapsed" : ""}>
                <CheckPhoneBilingualText
                  text={showCaptionControls && videoCaptionCanExpand && !videoCaptionExpanded
                    ? `${collapsedVideoCaption}...`
                    : note.body}
                  tone="light"
                />
                {showCaptionControls && videoCaptionCanExpand ? (
                  <>
                    {"  "}
                    <button
                      type="button"
                      className="cp-xhs-video-caption-toggle"
                      onClick={(event) => {
                        event.stopPropagation();
                        setVideoCaptionExpanded((current) => !current);
                      }}
                      onTouchStart={(event) => event.stopPropagation()}
                      onTouchEnd={(event) => event.stopPropagation()}
                    >
                      {videoCaptionExpanded ? "收起" : "展开"}
                    </button>
                  </>
                ) : null}
              </p>
            </div>
            {note.tags.length > 0 ? (
              <div className="cp-xhs-video-tags">
                {note.tags.map((tag) => <em key={tag}>#{tag}</em>)}
              </div>
            ) : null}
            <div className="cp-xhs-video-progress" aria-hidden="true" />
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="cp-xhs-module">
      {/* 只有在非详情页时才显示全局的 Appbar */}
      {(!payload || (!activeNote && !activeThread && selectedTab !== "profile")) && (
        <header className={`cp-xhs-appbar ${selectedTab === "messages" && !activeThread ? "cp-xhs-appbar--messages" : ""}`}>
          {renderRootBackButton()}
          <div className="cp-xhs-header-stack">
            {!activeNote && !activeThread && selectedTab === "home" ? (
              <>
                <div className="cp-xhs-header-title">关注</div>
                <div className="cp-xhs-header-title is-active">发现</div>
                <div className="cp-xhs-header-title">附近</div>
              </>
            ) : !activeThread && selectedTab === "messages" ? (
              <div className="cp-xhs-header-title is-active">消息</div>
            ) : selectedTab === "video" ? (
              <div className="cp-xhs-header-title is-active">视频</div>
            ) : (
              <div className="cp-xhs-header-title is-active">{payload?.headerTitle || "小红书"}</div>
            )}
          </div>
          {renderRootActions()}
        </header>
      )}

      {loading && (
        <div className="cp-refresh-indicator cp-refresh-indicator--floating" aria-live="polite">
          <span className="cp-refresh-indicator-text">正在刷新小红书</span>
          <span className="cp-refresh-indicator-dots" aria-hidden="true">
            <i></i><i></i><i></i>
          </span>
        </div>
      )}

      <div className="cp-xhs-body">
        {!loaded && <div className="cp-xhs-status">Syncing feed...</div>}

        {loaded && !payload && !loading && (
          <div className="cp-xhs-status cp-empty-copy">
            <p>暂无小红书内容</p>
            <span className="cp-xhs-hint">点刷新同步推荐视频消息和个人主页</span>
          </div>
        )}

        {error ? (
          <CheckPhoneDebugErrorCard
            title="暂时无法解析小红书内容。"
            error={error}
            debugParseMode={debugParseMode}
            debugParseError={debugParseError}
            debugNormalizeError={debugNormalizeError}
            debugRawOutput={debugRawOutput}
          />
        ) : null}

        {payload && !activeNote && !activeThread && (
          <>
            <div className={`cp-xhs-scroll ${selectedTab === "profile" ? "cp-xhs-scroll--profile" : ""}`} onScroll={handleMainScroll}>
              {selectedTab === "home" && (
                <div className="cp-xhs-decor-bar" aria-hidden="true">
                  {XHS_DECOR_CATEGORIES.map((item, idx) => (
                    <span key={item} className={idx === 0 ? "is-active" : undefined}>{item}</span>
                  ))}
                  <ChevronDown className="cp-xhs-decor-arrow" size={20} strokeWidth={2.3} />
                </div>
              )}
              {selectedTab === "home" && (
                <section className="cp-xhs-home">
                  <div className="cp-xhs-waterfall-grid">
                    <div className="cp-xhs-waterfall-column">
                      {homeColumns[0].map((note) => (
                        <XiaohongshuNoteCard key={note.id} note={note} onOpen={() => setSelectedNoteId(note.id)} />
                      ))}
                    </div>
                    <div className="cp-xhs-waterfall-column">
                      {homeColumns[1].map((note) => (
                        <XiaohongshuNoteCard key={note.id} note={note} onOpen={() => setSelectedNoteId(note.id)} />
                      ))}
                    </div>
                  </div>
                </section>
              )}

              {selectedTab === "video" && (
                <section className="cp-xhs-home">
                  <div className="cp-xhs-waterfall-grid">
                    <div className="cp-xhs-waterfall-column">
                      {videoColumns[0].map((note) => (
                        <XiaohongshuNoteCard key={note.id} note={note} displayMode="video" onOpen={() => setSelectedNoteId(note.id)} />
                      ))}
                    </div>
                    <div className="cp-xhs-waterfall-column">
                      {videoColumns[1].map((note) => (
                        <XiaohongshuNoteCard key={note.id} note={note} displayMode="video" onOpen={() => setSelectedNoteId(note.id)} />
                      ))}
                    </div>
                  </div>
                </section>
              )}

              {selectedTab === "messages" && (
                <section className="cp-xhs-panel cp-xhs-message-page">
                  <div className="cp-xhs-message-overview">
                    <div className="cp-xhs-overview-card">
                      <div className="cp-xhs-overview-icon-wrapper">
                        <div className="cp-xhs-overview-icon cp-xhs-overview-icon--heart"><XiaohongshuOverviewGlyph type="heart" /></div>
                        {payload.messageOverview.likesAndSavesCount > 0 ? (
                          <span className="cp-xhs-overview-badge">{formatBadgeCount(payload.messageOverview.likesAndSavesCount)}</span>
                        ) : null}
                      </div>
                      <span>赞和收藏</span>
                    </div>
                    <div className="cp-xhs-overview-card">
                      <div className="cp-xhs-overview-icon-wrapper">
                        <div className="cp-xhs-overview-icon cp-xhs-overview-icon--user"><XiaohongshuOverviewGlyph type="user" /></div>
                        {payload.messageOverview.newFollowersCount > 0 ? (
                          <span className="cp-xhs-overview-badge">{formatBadgeCount(payload.messageOverview.newFollowersCount)}</span>
                        ) : null}
                      </div>
                      <span>新增关注</span>
                    </div>
                    <div className="cp-xhs-overview-card">
                      <div className="cp-xhs-overview-icon-wrapper">
                        <div className="cp-xhs-overview-icon cp-xhs-overview-icon--chat"><XiaohongshuOverviewGlyph type="chat" /></div>
                        {payload.messageOverview.commentsAndMentionsCount > 0 ? (
                          <span className="cp-xhs-overview-badge">{formatBadgeCount(payload.messageOverview.commentsAndMentionsCount)}</span>
                        ) : null}
                      </div>
                      <span>评论和@</span>
                    </div>
                  </div>
                  <div className="cp-xhs-thread-list">
                    {payload.messageThreads.map((thread, index) => {
                      const unread = isThreadVisibleUnread(thread, readThreadIds);
                      return (
                        <button
                          key={thread.id}
                          type="button"
                          className="cp-xhs-thread-card"
                          onClick={() => handleThreadOpen(thread)}
                        >
                          <div className={`cp-xhs-thread-avatar cp-xhs-thread-avatar--tone-${(index % 6) + 1}`}>
                            {thread.type === "group" ? "群" : thread.name.slice(0, 1)}
                          </div>
                          <div className="cp-xhs-thread-meta">
                            <div className="cp-xhs-thread-text">
                              <span className="cp-xhs-thread-name">{getXiaohongshuListPlainText(thread.name)}</span>
                              <span className="cp-xhs-thread-preview">{getThreadPreview(thread)}</span>
                            </div>
                            <div className="cp-xhs-thread-status">
                              <time className="cp-xhs-thread-time">{getThreadTime(thread)}</time>
                              {unread ? <span className="cp-xhs-thread-unread-badge">1</span> : <span className="cp-xhs-thread-spacer" />}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}

              {selectedTab === "profile" && (
                <section className="cp-xhs-profile">
                  <div className={`cp-xhs-profile-topbar ${profileTopbarVisible ? "is-visible" : ""}`}>
                    {renderRootBackButton("#ffffff")}
                    {renderRootActions("#ffffff")}
                  </div>
                  <div className="cp-xhs-profile-hero">
                    <div className="cp-xhs-profile-cover" aria-hidden="true" />
                    <div className="cp-xhs-profile-main">
                      <div className="cp-xhs-profile-avatar-wrap">
                        <div className="cp-xhs-profile-avatar">{payload.profile.name.slice(0, 1)}</div>
                        <span>+</span>
                      </div>
                      <div className="cp-xhs-profile-meta">
                        <h3>{payload.profile.name}<ChevronDown size={16} strokeWidth={2.3} /></h3>
                        <span>小红书号：{xiaohongshuNumericId}</span>
                        <span>IP 属地：未知</span>
                      </div>
                    </div>
                    <div className="cp-xhs-profile-bio">
                      <p><CheckPhoneBilingualText text={payload.profile.bio} tone="xiaohongshu" /></p>
                      <em>♂</em>
                    </div>
                    <div className="cp-xhs-profile-actions">
                      <div className="cp-xhs-profile-stats">
                        <div><strong>{formatCount(payload.profile.followingCount)}</strong><span>关注</span></div>
                        <div><strong>{formatCount(payload.profile.followerCount)}</strong><span>粉丝</span></div>
                        <div><strong>{formatCount(payload.profile.likedAndSavedCount)}</strong><span>获赞与收藏</span></div>
                      </div>
                      <button type="button" className="cp-xhs-profile-edit">编辑资料</button>
                      <button type="button" className="cp-xhs-profile-settings" aria-label="Profile settings"><Settings size={20} strokeWidth={2.2} /></button>
                    </div>
                    <div className="cp-xhs-profile-tools">
                      <div><strong>创作灵感</strong><span>学创作找灵感</span></div>
                      <div><strong>RED 创作大赛</strong><span>为新生代好作品助力</span></div>
                      <div><strong>浏览记录</strong><span>看过的笔记</span></div>
                    </div>
                  </div>
                  <div className="cp-xhs-profile-content">
                    <div className="cp-xhs-profile-tabs">
                      <span className="is-active">笔记</span>
                      <span>评论</span>
                      <span>收藏</span>
                      <span>赞过</span>
                      <Search size={20} strokeWidth={2.3} />
                    </div>
                    <div className="cp-xhs-profile-promo">
                      <div>RED</div>
                      <strong>欢迎热爱创作的你来投稿</strong>
                      <span>百亿流量助力，快来参与吧</span>
                      <button type="button">去投稿</button>
                    </div>
                    <div className="cp-xhs-waterfall-grid">
                      <div className="cp-xhs-waterfall-column">
                        {myColumns[0].map((note) => (
                          <XiaohongshuNoteCard key={note.id} note={note} onOpen={() => setSelectedNoteId(note.id)} />
                        ))}
                      </div>
                      <div className="cp-xhs-waterfall-column">
                        {myColumns[1].map((note) => (
                          <XiaohongshuNoteCard key={note.id} note={note} onOpen={() => setSelectedNoteId(note.id)} />
                        ))}
                      </div>
                    </div>
                  </div>
                </section>
              )}
            </div>

            <nav className="cp-xhs-tabbar" aria-label="小红书导航">
              {XHS_TABS.map((tab) => {
                const active = selectedTab === tab.id;
                if (tab.id === "publish") {
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      className="cp-xhs-tab-publish"
                      aria-label="发布"
                    >
                      <div className="cp-xhs-tab-publish-inner">
                        <Plus size={20} strokeWidth={3} />
                      </div>
                    </button>
                  );
                }
                return (
                  <button
                    key={tab.id}
                    type="button"
                    className={`cp-xhs-tab ${active ? "is-active" : ""}`}
                    onClick={() => setSelectedTab(tab.id as XiaohongshuTabId)}
                  >
                    <div className="cp-xhs-tab-inner">
                      <span>{tab.label}</span>
                      {tab.id === "messages" && messageBadgeCount > 0 ? (
                        <span className="cp-xhs-tab-badge">{formatBadgeCount(messageBadgeCount)}</span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </nav>
          </>
        )}

        {payload && activeNote && activeNoteIsVideo && (
          <div
            className={`cp-xhs-video-detail-screen${videoCommentsOpen ? " is-comments-open" : ""}`}
            onWheel={handleVideoWheel}
            onTouchStart={handleVideoTouchStart}
            onTouchMove={handleVideoTouchMove}
            onTouchEnd={handleVideoTouchEnd}
          >
            <header className="cp-xhs-video-detail-topbar">
              <button type="button" onClick={backAction} aria-label="Back">
                <ChevronLeft size={26} strokeWidth={2.4} />
              </button>
              <button type="button" aria-label="More videos">
                <span className="cp-xhs-video-stack-icon" aria-hidden="true" />
              </button>
              <div className="cp-xhs-video-topbar-spacer" />
              <button type="button" aria-label="Search">
                <Search size={22} strokeWidth={2.2} />
              </button>
              <button type="button" aria-label="Share">
                <Share size={22} strokeWidth={2.2} />
              </button>
            </header>

            {videoPreviewNote && videoPreviewStyle ? renderVideoMovingLayer(videoPreviewNote, videoPreviewStyle, true) : null}
            {renderVideoMovingLayer(activeNote, videoMovableStyle)}

            <footer className="cp-xhs-video-actions">
              <div className="cp-xhs-video-input">说点什么...</div>
              <button type="button" className={`cp-xhs-video-action ${activeNote.liked ? "is-active" : ""}`} aria-label="Like">
                <Heart size={24} strokeWidth={2.1} fill={activeNote.liked ? "currentColor" : "none"} />
                <span>{formatCount(activeNoteEngagementCounts?.likeCount ?? activeNote.likeCount)}</span>
              </button>
              <button type="button" className={`cp-xhs-video-action ${activeNote.saved ? "is-active" : ""}`} aria-label="Save">
                <svg width="24" height="24" viewBox="0 0 24 24" fill={activeNote.saved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
                <span>{formatCount(activeNoteEngagementCounts?.saveCount ?? activeNote.saveCount)}</span>
              </button>
              <button type="button" className="cp-xhs-video-action" onClick={() => setVideoCommentsOpen(true)} aria-label="Open comments">
                <MessageCircleMore size={24} strokeWidth={2.1} />
                <span>{formatCount(activeNoteEngagementCounts?.commentCount ?? activeNote.commentCount)}</span>
              </button>
            </footer>

            {videoCommentsOpen ? (
              <div className="cp-xhs-video-comments-backdrop" onClick={() => setVideoCommentsOpen(false)}>
                <section className="cp-xhs-video-comments-sheet" onClick={(event) => event.stopPropagation()}>
                  <div className="cp-xhs-video-comments-handle" aria-hidden="true" />
                  <header>
                    <strong>评论 {formatCount(activeNoteEngagementCounts?.commentCount ?? activeNote.commentCount)}</strong>
                    <button type="button" onClick={() => setVideoCommentsOpen(false)} aria-label="Close comments">×</button>
                  </header>
                  <div className="cp-xhs-comment-list">
                    <XiaohongshuCommentList comments={activeNote.comments} />
                  </div>
                </section>
              </div>
            ) : null}
          </div>
        )}

        {payload && activeNote && !activeNoteIsVideo && (
          <div className="cp-xhs-scroll cp-xhs-scroll--detail">
            <div className="cp-xhs-note-detail-header">
              <button type="button" className="cp-xhs-detail-back" onClick={backAction} aria-label="Back">
                <ChevronLeft size={24} strokeWidth={2.5} />
              </button>
              <div className="cp-xhs-detail-author-info">
                <div className="cp-xhs-detail-avatar">{activeNote.authorName.slice(0, 1)}</div>
                <span className="cp-xhs-detail-name">{activeNote.authorName}</span>
              </div>
              <button className="cp-xhs-detail-follow">关注</button>
              <button className="cp-xhs-detail-share">
                <Share size={20} strokeWidth={2} />
              </button>
            </div>
            <article className="cp-xhs-note-detail">
              <XiaohongshuCover icon={activeNote.coverIcon} tone={activeNote.tone} large />
              <div className="cp-xhs-note-detail-card">
                <h3><CheckPhoneBilingualText text={activeNote.title} tone="xiaohongshu" /></h3>
                <p className="cp-xhs-note-detail-body"><CheckPhoneBilingualText text={activeNote.body} tone="xiaohongshu" /></p>
                <div className="cp-xhs-note-detail-tags">
                  {activeNote.tags.map((tag) => <em key={tag}>#{tag}</em>)}
                </div>
                <div className="cp-xhs-note-detail-time">{activeNoteTimeLabel}</div>
              </div>

              <div className="cp-xhs-comment-section">
                <div className="cp-xhs-comment-count">共 {formatCount(activeNoteEngagementCounts?.commentCount ?? activeNote.commentCount)} 条评论</div>
                <div className="cp-xhs-comment-list">
                  <XiaohongshuCommentList comments={activeNote.comments} />
                </div>
              </div>
            </article>

            {/* 底部固定互动栏 */}
            <div className="cp-xhs-detail-bottom-bar">
              <div className="cp-xhs-input-box">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                说点什么...
              </div>
              <div className="cp-xhs-action-icons">
                <button className={`cp-xhs-action-btn ${activeNote.liked ? "is-liked" : ""}`}>
                  <Heart size={22} strokeWidth={2} fill={activeNote.liked ? "currentColor" : "none"} />
                  <span>{formatCount(activeNoteEngagementCounts?.likeCount ?? activeNote.likeCount)}</span>
                </button>
                <button className={`cp-xhs-action-btn ${activeNote.saved ? "is-saved" : ""}`}>
                  {/* 收藏图标 (Star) */}
                  <svg width="22" height="22" viewBox="0 0 24 24" fill={activeNote.saved ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                  <span>{formatCount(activeNoteEngagementCounts?.saveCount ?? activeNote.saveCount)}</span>
                </button>
                <button className="cp-xhs-action-btn">
                  <MessageCircleMore size={22} strokeWidth={2} />
                  <span>{formatCount(activeNoteEngagementCounts?.commentCount ?? activeNote.commentCount)}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {payload && activeThread && (
          <div className="cp-xhs-thread-screen">
            <header className="cp-xhs-thread-appbar">
              <button type="button" className="cp-xhs-thread-nav-button" onClick={backAction} aria-label="Back">
                <ChevronLeft size={28} strokeWidth={2.4} />
              </button>
              <div className="cp-xhs-thread-title-block">
                <div className="cp-xhs-thread-avatar cp-xhs-thread-avatar--header">{activeThread.type === "group" ? "群" : activeThread.name.slice(0, 1)}</div>
                <strong>{activeThread.name}</strong>
              </div>
              <button type="button" className="cp-xhs-thread-nav-button" aria-label="More">
                <MoreHorizontal size={27} strokeWidth={2.4} />
              </button>
            </header>

            <div className="cp-xhs-thread-messages">
              {activeThread.type === "direct" ? (
                <div className="cp-xhs-thread-follow-card">
                  <span>对方已关注你，回关方便联系</span>
                  <button type="button">回关</button>
                  <i aria-hidden="true">×</i>
                </div>
              ) : null}

              <div className="cp-xhs-chat-stack">
                {activeThread.messages.map((message, index) => {
                  const outgoing = message.direction === "outgoing";
                  const showTime = index === 0 || activeThread.messages[index - 1]?.timeLabel !== message.timeLabel;
                  return (
                    <div key={message.id} className="cp-xhs-chat-message-block">
                      {showTime ? <time className="cp-xhs-chat-time">{message.timeLabel}</time> : null}
                      <div className={`cp-xhs-chat-row ${outgoing ? "is-outgoing" : "is-incoming"}`}>
                        {!outgoing ? (
                          <div className="cp-xhs-chat-avatar">{activeThread.type === "group" ? message.authorName.slice(0, 1) : activeThread.name.slice(0, 1)}</div>
                        ) : null}
                        <div className="cp-xhs-chat-content">
                          {activeThread.type === "group" && !outgoing ? <span className="cp-xhs-chat-author">{message.authorName}</span> : null}
                          <p><CheckPhoneBilingualText text={message.text} tone="xiaohongshu" variant="inline" /></p>
                        </div>
                        {outgoing ? <div className="cp-xhs-chat-avatar cp-xhs-chat-avatar--me">{payload.profile.name.slice(0, 1)}</div> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="cp-xhs-thread-composer">
              <div className="cp-xhs-thread-quick-replies" aria-hidden="true">
                {["hello", "谢谢宝", "嗯", "在干嘛", "喜欢"].map((item) => <span key={item}>{item}</span>)}
              </div>
              <div className="cp-xhs-thread-inputbar">
                <button type="button" aria-label="Voice"><Mic size={24} strokeWidth={2.4} /></button>
                <div className="cp-xhs-thread-input-placeholder">发消息...</div>
                <button type="button" aria-label="Emoji"><Smile size={24} strokeWidth={2.4} /></button>
                <button type="button" aria-label="More"><CirclePlus size={25} strokeWidth={2.4} /></button>
              </div>
            </div>
          </div>
        )}
      </div>

      {confirmClearOpen && (
        <ConfirmDialog
          title="清空小红书内容？"
          message="确认后会清空当前小红书缓存。之后重新刷新时，不会再带入旧小红书内容。"
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
