"use client";

import { useEffect, useMemo, useState } from "react";
import { appNowISO } from "@/lib/app-clock";
import { useCheckPhoneRefresh } from "@/lib/checkphone-refresh-tracker";
import { pinyin } from "pinyin-pro";
import {
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  CirclePlus,
  Clock3,
  Eraser,
  House,
  MoreVertical,
  Play,
  PlaySquare,
  RotateCcw,
  ThumbsUp,
  User,
} from "lucide-react";
import { CheckPhoneBilingualText } from "@/components/checkphone/checkphone-bilingual-text";
import { CheckPhoneDebugErrorCard } from "@/components/checkphone/checkphone-debug-error-card";
import { ConfirmDialog } from "@/components/ui";
import type { Character } from "@/lib/character-types";
import type {
  CheckPhoneSnapshot,
  CheckPhoneYoutubeHistoryVideo,
  CheckPhoneYoutubeLikedVideo,
  CheckPhoneYoutubePayload,
  CheckPhoneYoutubeWatchLaterVideo,
} from "@/lib/checkphone-config";
import { generateCheckPhoneYoutube } from "@/lib/checkphone-engine";
import { clearPhoneSnapshot, loadPhoneSnapshot, savePhoneSnapshot } from "@/lib/checkphone-storage";

type CheckPhoneYoutubePageProps = {
  character: Character;
  onBack: () => void;
};

type YoutubeView = "home" | "history" | "playlists" | "watchLater" | "likedVideos";
type YoutubeVideo =
  | (CheckPhoneYoutubeHistoryVideo & { section: "history" })
  | (CheckPhoneYoutubeWatchLaterVideo & { section: "watchLater" })
  | (CheckPhoneYoutubeLikedVideo & { section: "likedVideos" });

function formatYoutubeTime(iso: string): string {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return iso;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const hhmm = value.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  });
  if (value >= todayStart) return `Today ${hhmm}`;
  if (value >= yesterdayStart) return `Yesterday ${hhmm}`;
  return value.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatYoutubeDateHeading(iso: string): string {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return "";
  return value.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function formatYoutubePlayCount(value: number): string {
  if (value >= 1_000_000) {
    const text = (value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1).replace(/\.0$/, "");
    return `${text}M views`;
  }
  if (value >= 1000) {
    const text = (value / 1000).toFixed(value >= 100_000 ? 0 : 1).replace(/\.0$/, "");
    return `${text}K views`;
  }
  return `${Math.max(0, Math.round(value))} views`;
}

function clampYoutubeProgress(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function parseYoutubeTimeSeconds(label: string): number | null {
  const time = label.match(/\d{1,3}(?::\d{2}){1,2}/)?.[0];
  if (time) {
    const parts = time.split(":").map((part) => Number(part));
    if (parts.length === 2 && parts.every(Number.isFinite)) return parts[0] * 60 + parts[1];
    if (parts.length === 3 && parts.every(Number.isFinite)) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  let seconds = 0;
  let matched = false;
  const addUnit = (pattern: RegExp, unitSeconds: number) => {
    const match = label.match(pattern);
    if (!match) return;
    const value = Number(match[1]);
    if (!Number.isFinite(value)) return;
    matched = true;
    seconds += value * unitSeconds;
  };

  addUnit(/(\d+(?:\.\d+)?)\s*(?:小时|hour|hours|hr|hrs|h)/i, 3600);
  addUnit(/(\d+(?:\.\d+)?)\s*(?:分钟|分|min|mins|minute|minutes|m)/i, 60);
  addUnit(/(\d+(?:\.\d+)?)\s*(?:秒|sec|secs|second|seconds|s)/i, 1);
  return matched ? seconds : null;
}

function getYoutubeProgressPercent(video: CheckPhoneYoutubeHistoryVideo): number {
  const progressLabel = video.progressLabel.trim();
  const percent = progressLabel.match(/(\d+(?:\.\d+)?)\s*%/);
  if (percent) return clampYoutubeProgress(Number(percent[1]));
  if (/看完|已看完|finished|complete|completed/i.test(progressLabel)) return 100;

  const progressTimes = progressLabel.match(/\d{1,3}(?::\d{2}){1,2}/g) ?? [];
  const watchedSeconds = progressTimes[0] ? parseYoutubeTimeSeconds(progressTimes[0]) : parseYoutubeTimeSeconds(progressLabel);
  const totalSeconds = progressTimes[1] ? parseYoutubeTimeSeconds(progressTimes[1]) : parseYoutubeTimeSeconds(video.durationLabel);
  if (!watchedSeconds || !totalSeconds || totalSeconds <= 0) return 0;
  return clampYoutubeProgress((watchedSeconds / totalSeconds) * 100);
}

function getVideoKey(video: YoutubeVideo): string {
  return `${video.section}:${video.id}`;
}

function getThumbnailLabel(video: YoutubeVideo): string {
  if (video.icon?.trim()) return video.icon.trim().slice(0, 2);
  const compact = video.title.replace(/[^\p{L}\p{N}]/gu, "").trim();
  return Array.from(compact || video.channelName || "YT").slice(0, 2).join("").toUpperCase();
}

function getYoutubeVideos(payload: CheckPhoneYoutubePayload | null) {
  const watchHistory = (payload?.watchHistory ?? []).map((item) => ({ ...item, section: "history" as const }));
  const watchLater = (payload?.watchLater ?? []).map((item) => ({ ...item, section: "watchLater" as const }));
  const likedVideos = (payload?.likedVideos ?? []).map((item) => ({ ...item, section: "likedVideos" as const }));
  return { watchHistory, watchLater, likedVideos };
}

function groupVideosByDate(videos: YoutubeVideo[]) {
  const groups: Array<{ label: string; videos: YoutubeVideo[] }> = [];
  for (const video of videos) {
    const label = formatYoutubeDateHeading(video.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.videos.push(video);
    } else {
      groups.push({ label, videos: [video] });
    }
  }
  return groups;
}

function getViewTitle(view: YoutubeView): string {
  switch (view) {
    case "history":
      return "History";
    case "playlists":
      return "Playlists";
    case "watchLater":
      return "Watch later";
    case "likedVideos":
      return "Liked videos";
    default:
      return "YouTube";
  }
}

function getYoutubeAvatarInitial(name: string): string {
  const first = name.trim().charAt(0);
  if (!first) return "Y";
  if (/[a-zA-Z]/.test(first)) return first.toUpperCase();
  const py = pinyin(first, { toneType: "none", type: "array" });
  const initial = py[0]?.charAt(0);
  return initial && /[a-zA-Z]/.test(initial) ? initial.toUpperCase() : "Y";
}

function PlaylistTabShape() {
  return (
    <svg className="cp-youtube-playlist-tab" viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path d="M0 12 L6.5 3.8 C7.8 1.4 10.3 0 13.5 0 H86.5 C89.7 0 92.2 1.4 93.5 3.8 L100 12 Z" fill="currentColor" />
    </svg>
  );
}

function VideoCard({
  video,
  expanded,
  onToggle,
}: {
  video: YoutubeVideo;
  expanded: boolean;
  onToggle: () => void;
}) {
  const progressPercent = "progressLabel" in video ? getYoutubeProgressPercent(video) : null;

  return (
    <article className="cp-youtube-video-wrap">
      <button type="button" className="cp-youtube-video-card" onClick={onToggle}>
        <div className="cp-youtube-thumb" aria-hidden="true">
          <span>{getThumbnailLabel(video)}</span>
          <b>{video.durationLabel}</b>
          {progressPercent !== null ? <i style={{ width: `${progressPercent}%` }} /> : null}
        </div>
        <div className="cp-youtube-video-main">
          <div className="cp-youtube-video-title-row">
            <h3><CheckPhoneBilingualText text={video.title} tone="youtube" variant="inline" /></h3>
            <MoreVertical size={17} strokeWidth={2.3} />
          </div>
          <p>{video.channelName} · {formatYoutubePlayCount(video.playCount)}</p>
          <time>{formatYoutubeTime(video.createdAt)}</time>
          {"progressLabel" in video ? <span>{video.progressLabel}</span> : null}
        </div>
      </button>
      {expanded ? (
        <div className="cp-youtube-note-card">
          <div className="cp-youtube-note-title">State & Feeling</div>
          <p><strong>State</strong><CheckPhoneBilingualText text={video.stateNote} tone="youtube" /></p>
          <p><strong>Feeling</strong><CheckPhoneBilingualText text={video.feeling} tone="youtube" /></p>
        </div>
      ) : null}
    </article>
  );
}

export function CheckPhoneYoutubePage({ character, onBack }: CheckPhoneYoutubePageProps) {
  const [snapshot, setSnapshot] = useState<CheckPhoneSnapshot<CheckPhoneYoutubePayload> | null>(null);
  const [view, setView] = useState<YoutubeView>("home");
  const [expandedEntryKeys, setExpandedEntryKeys] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useCheckPhoneRefresh(character.id, "youtube", setSnapshot);
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
    setView("home");
    setExpandedEntryKeys([]);
    setDebugRawOutput(null);
    setDebugSanitizedOutput(null);
    setDebugParseMode(null);
    setDebugParseError(null);
    setDebugNormalizeError(null);
    (async () => {
      const cached = await loadPhoneSnapshot<CheckPhoneYoutubePayload>(character.id, "youtube");
      if (cancelled) return;
      setSnapshot(cached);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [character.id]);

  function navigate(nextView: YoutubeView) {
    setView(nextView);
    setExpandedEntryKeys([]);
  }

  function toggleExpandedEntry(key: string) {
    setExpandedEntryKeys((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
  }

  function handleBack() {
    if (view === "watchLater" || view === "likedVideos") {
      navigate("playlists");
      return;
    }
    if (view === "history" || view === "playlists") {
      navigate("home");
      return;
    }
    onBack();
  }

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
    } = await generateCheckPhoneYoutube(character.id, snapshot?.payload ?? null, snapshot?.updatedAt);
    if (payload) {
      const now = appNowISO();
      const nextSnapshot: CheckPhoneSnapshot<CheckPhoneYoutubePayload> = {
        id: `${character.id}:youtube`,
        characterId: character.id,
        appId: "youtube",
        generatedAt: snapshot?.generatedAt ?? now,
        updatedAt: now,
        summary,
        payload,
      };
      await savePhoneSnapshot(nextSnapshot);
      setSnapshot(nextSnapshot);
      setExpandedEntryKeys([]);
      setView("home");
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
    await clearPhoneSnapshot(character.id, "youtube");
    setSnapshot(null);
    setView("home");
    setExpandedEntryKeys([]);
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
  const { watchHistory, watchLater, likedVideos } = useMemo(() => getYoutubeVideos(payload), [payload]);
  const listVideos = view === "history" ? watchHistory : view === "watchLater" ? watchLater : view === "likedVideos" ? likedVideos : [];
  const groupedHistory = useMemo(() => groupVideosByDate(watchHistory), [watchHistory]);
  const avatarInitial = useMemo(() => getYoutubeAvatarInitial(payload?.profile?.name ?? character.name), [character.name, payload?.profile?.name]);

  return (
    <div className="cp-youtube-module">
      <header className={`cp-youtube-appbar${view === "home" ? " is-home" : ""}`}>
        <button type="button" className="cp-youtube-icon-button" onClick={handleBack} aria-label="Back">
          <ChevronLeft size={22} strokeWidth={2.2} />
        </button>
        {view === "home" ? (
          <div className="cp-youtube-brand" aria-label="YouTube">
            <span><Play size={14} fill="currentColor" /></span>
            <strong>YouTube</strong>
          </div>
        ) : (
          <h2 className="cp-youtube-view-title">{getViewTitle(view)}</h2>
        )}
        <div className="cp-youtube-actions">
          <button type="button" className="cp-youtube-icon-button cp-youtube-action-icon cp-youtube-refresh-action" onClick={handleRefresh} disabled={loading} aria-label="Refresh">
            <RotateCcw size={20} strokeWidth={2} className={loading ? "cp-spin" : ""} />
          </button>
          <button type="button" className="cp-youtube-icon-button cp-youtube-action-icon cp-youtube-clear-action" onClick={() => setConfirmClearOpen(true)} disabled={loading || !snapshot} aria-label="Clear YouTube snapshot">
            <Eraser size={20} strokeWidth={2} />
          </button>
          <span className="cp-youtube-avatar-button" aria-label="YouTube profile avatar">
            {avatarInitial}
          </span>
        </div>
      </header>

      {loading && (
        <div className="cp-refresh-indicator cp-refresh-indicator--floating" aria-live="polite">
          <span className="cp-refresh-indicator-text">Refreshing YouTube</span>
          <span className="cp-refresh-indicator-dots" aria-hidden="true">
            <i></i><i></i><i></i>
          </span>
        </div>
      )}

      <div className="cp-youtube-body">
        {!loaded && <div className="cp-youtube-status">Syncing YouTube...</div>}

        {loaded && !payload && !loading && (
          <div className="cp-youtube-status cp-empty-copy">
            <p>No YouTube content yet</p>
            <span className="cp-youtube-hint">Refresh to sync History, Watch later, and Liked videos.</span>
          </div>
        )}

        {error ? (
          <CheckPhoneDebugErrorCard
            title="暂时无法解析 YouTube 内容。"
            error={error}
            debugParseMode={debugParseMode}
            debugParseError={debugParseError}
            debugNormalizeError={debugNormalizeError}
            debugRawOutput={debugRawOutput}
            debugSanitizedOutput={debugSanitizedOutput}
          />
        ) : null}

        {payload && view === "home" ? (
          <>
            <section className="cp-youtube-home-section">
              <button type="button" className="cp-youtube-section-heading" onClick={() => navigate("history")}>
                <Clock3 size={21} strokeWidth={2.1} />
                <span>History</span>
                <ChevronRight size={19} strokeWidth={2.5} />
              </button>
              <div className="cp-youtube-history-strip">
                {watchHistory.slice(0, 4).map((video) => (
                  <button key={video.id} type="button" className="cp-youtube-strip-card" onClick={() => navigate("history")}>
                    <div className="cp-youtube-strip-thumb">
                      <span>{getThumbnailLabel(video)}</span>
                      <b>{video.durationLabel}</b>
                      <i style={{ width: `${getYoutubeProgressPercent(video)}%` }} />
                    </div>
                    <strong><CheckPhoneBilingualText text={video.title} tone="youtube" variant="inline" /></strong>
                    <small>{video.channelName}</small>
                  </button>
                ))}
              </div>
            </section>

            <section className="cp-youtube-home-section cp-youtube-playlists-home">
              <button type="button" className="cp-youtube-section-heading" onClick={() => navigate("playlists")}>
                <PlaySquare size={21} strokeWidth={2.1} />
                <span>Playlists</span>
                <ChevronRight size={19} strokeWidth={2.5} />
              </button>
              <div className="cp-youtube-playlist-grid">
                <button type="button" className="cp-youtube-playlist-card" onClick={() => navigate("watchLater")}>
                  <div className="cp-youtube-playlist-cover">
                    <PlaylistTabShape />
                    <Clock3 size={22} strokeWidth={1.8} />
                    <b>{watchLater.length}</b>
                  </div>
                  <strong>Watch later</strong>
                  <small>Private</small>
                </button>
                <button type="button" className="cp-youtube-playlist-card" onClick={() => navigate("likedVideos")}>
                  <div className="cp-youtube-playlist-cover is-liked">
                    <PlaylistTabShape />
                    <ThumbsUp size={22} strokeWidth={1.8} />
                    <b>{likedVideos.length}</b>
                  </div>
                  <strong>Liked videos</strong>
                  <small>Private</small>
                </button>
              </div>
            </section>

            <section className="cp-youtube-decor-list" aria-label="YouTube library shortcuts">
              <div className="cp-youtube-decor-row">
                <PlaySquare size={23} strokeWidth={1.9} />
                <strong>Your videos</strong>
              </div>
              <div className="cp-youtube-decor-row">
                <Clapperboard size={24} strokeWidth={1.9} />
                <strong>Movies & TV</strong>
              </div>
            </section>
          </>
        ) : null}

        {payload && view === "playlists" ? (
          <section className="cp-youtube-playlists-page">
            <div className="cp-youtube-chip-row">
              <span>Recently added</span>
              <span>Playlists</span>
              <span>Owned</span>
            </div>
            <button type="button" className="cp-youtube-playlist-row" onClick={() => navigate("watchLater")}>
              <div className="cp-youtube-playlist-row-cover">
                <PlaylistTabShape />
                <Clock3 size={22} strokeWidth={1.8} />
                <b>{watchLater.length}</b>
              </div>
              <div>
                <strong>Watch later</strong>
                <small>Private</small>
              </div>
            </button>
            <button type="button" className="cp-youtube-playlist-row" onClick={() => navigate("likedVideos")}>
              <div className="cp-youtube-playlist-row-cover is-liked">
                <PlaylistTabShape />
                <ThumbsUp size={22} strokeWidth={1.8} />
                <b>{likedVideos.length}</b>
              </div>
              <div>
                <strong>Liked videos</strong>
                <small>Private</small>
              </div>
            </button>
            <button type="button" className="cp-youtube-create-playlist">Create new playlist</button>
          </section>
        ) : null}

        {payload && (view === "history" || view === "watchLater" || view === "likedVideos") ? (
          <section className="cp-youtube-video-list">
            {view === "history"
              ? groupedHistory.map((group) => (
                  <div key={group.label || "unknown"} className="cp-youtube-date-group">
                    {group.label ? <h1>{group.label}</h1> : null}
                    {group.videos.map((video) => {
                      const videoKey = getVideoKey(video);
                      return (
                        <VideoCard
                          key={videoKey}
                          video={video}
                          expanded={expandedEntryKeys.includes(videoKey)}
                          onToggle={() => toggleExpandedEntry(videoKey)}
                        />
                      );
                    })}
                  </div>
                ))
              : listVideos.map((video) => {
                  const videoKey = getVideoKey(video);
                  return (
                    <VideoCard
                      key={videoKey}
                      video={video}
                      expanded={expandedEntryKeys.includes(videoKey)}
                      onToggle={() => toggleExpandedEntry(videoKey)}
                    />
                  );
                })}
          </section>
        ) : null}
      </div>

      {payload ? (
        <nav className="cp-youtube-bottom-nav" aria-label="YouTube sections">
          <span><House size={21} strokeWidth={1.9} />Home</span>
          <span><PlaySquare size={21} strokeWidth={1.9} />Shorts</span>
          <span className="is-create"><CirclePlus size={31} strokeWidth={1.55} /></span>
          <span><User size={21} strokeWidth={1.9} />Subscriptions</span>
          <span className="is-active"><PlaySquare size={22} strokeWidth={1.95} />Library</span>
        </nav>
      ) : null}

      {confirmClearOpen && (
        <ConfirmDialog
          title="清空 YouTube 内容？"
          message="确认后会清空当前 YouTube 缓存。之后重新刷新时，不会再带入旧 YouTube 内容。"
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
