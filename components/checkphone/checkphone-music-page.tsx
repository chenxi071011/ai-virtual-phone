"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { appNowISO } from "@/lib/app-clock";
import { useCheckPhoneRefresh } from "@/lib/checkphone-refresh-tracker";
import { Bookmark, ChevronLeft, Clock3, Heart, House, Music2, RefreshCw, Trash2, UserRound, Disc3, Pause, Shuffle, SkipBack, SkipForward, ListMusic } from "lucide-react";
import { CheckPhoneBilingualText } from "@/components/checkphone/checkphone-bilingual-text";
import { CheckPhoneDebugErrorCard } from "@/components/checkphone/checkphone-debug-error-card";
import { ConfirmDialog } from "@/components/ui";
import type { Character } from "@/lib/character-types";
import type {
  CheckPhoneMusicPayload,
  CheckPhoneMusicPlaylist,
  CheckPhoneMusicTone,
  CheckPhoneMusicTrack,
  CheckPhoneSnapshot,
} from "@/lib/checkphone-config";
import { generateCheckPhoneMusic } from "@/lib/checkphone-engine";
import { clearPhoneSnapshot, loadPhoneSnapshot, savePhoneSnapshot } from "@/lib/checkphone-storage";

type CheckPhoneMusicPageProps = {
  character: Character;
  onBack: () => void;
};

type MusicTabId = "home" | "recent" | "playlists" | "profile";

type MusicInnerFloat = {
  id: string;
  text: string;
  tone: CheckPhoneMusicTone;
  left: number;
  top: number;
  width: number;
  fontSize: number;
  color: string;
  glow: string;
  delay: number;
  zIndex: number;
};

const MUSIC_TABS: Array<{ id: MusicTabId; label: string; icon: typeof House }> = [
  { id: "home", label: "首页", icon: House },
  { id: "recent", label: "最近播放", icon: Music2 },
  { id: "playlists", label: "歌单", icon: Disc3 },
  { id: "profile", label: "我的", icon: UserRound },
];

const MUSIC_HEADER_SUBTITLE = "播放记录、收藏歌曲与歌单概览";
const MUSIC_INNER_FLOAT_LAYOUTS = [
  { left: 44, top: 28 },
  { left: 55, top: 39 },
  { left: 43, top: 51 },
  { left: 58, top: 61 },
  { left: 47, top: 70 },
  { left: 52, top: 33 },
] as const;
const MUSIC_INNER_FLOAT_COLORS = [
  { color: "rgba(238, 238, 244, 0.94)", glow: "hsl(252 1% 78% / 0.72)" },
  { color: "rgba(235, 240, 241, 0.92)", glow: "hsl(194 1% 76% / 0.62)" },
  { color: "rgba(241, 238, 233, 0.92)", glow: "hsl(38 1% 76% / 0.55)" },
  { color: "rgba(239, 235, 242, 0.93)", glow: "hsl(285 1% 78% / 0.6)" },
  { color: "rgba(233, 237, 242, 0.92)", glow: "hsl(218 1% 78% / 0.58)" },
  { color: "rgba(242, 235, 238, 0.92)", glow: "hsl(334 1% 78% / 0.55)" },
] as const;
const MUSIC_INNER_FLOAT_MAX_STACK = 8;
const MUSIC_INNER_FLOAT_AVOID_LIMIT = 6;
const MUSIC_INNER_FLOAT_CANDIDATES = 18;

function estimateMusicInnerBox(item: Pick<MusicInnerFloat, "left" | "top" | "width" | "fontSize" | "text">) {
  const width = Math.min(item.width, 92);
  const charsPerLine = Math.max(8, Math.floor(width / Math.max(item.fontSize * 0.34, 1)));
  const lines = Math.min(5, Math.max(1, Math.ceil(item.text.length / charsPerLine)));
  const height = Math.min(28, 4 + lines * Math.max(3.4, item.fontSize * 0.24));
  return {
    left: item.left - width / 2,
    right: item.left + width / 2,
    top: item.top - 2,
    bottom: item.top + height,
  };
}

function getMusicInnerOverlapScore(candidate: MusicInnerFloat, existingItems: MusicInnerFloat[]) {
  const candidateBox = estimateMusicInnerBox(candidate);
  return existingItems.reduce((score, item) => {
    const itemBox = estimateMusicInnerBox(item);
    const overlapX = Math.max(0, Math.min(candidateBox.right, itemBox.right) - Math.max(candidateBox.left, itemBox.left));
    const overlapY = Math.max(0, Math.min(candidateBox.bottom, itemBox.bottom) - Math.max(candidateBox.top, itemBox.top));
    return score + overlapX * overlapY;
  }, 0);
}

function createMusicInnerFloat(
  sequence: number,
  text: string,
  tone: CheckPhoneMusicTone,
  existingItems: MusicInnerFloat[],
): MusicInnerFloat {
  let bestFloat: MusicInnerFloat | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  const attempts = existingItems.length >= MUSIC_INNER_FLOAT_AVOID_LIMIT ? 1 : MUSIC_INNER_FLOAT_CANDIDATES;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const layout = MUSIC_INNER_FLOAT_LAYOUTS[(sequence + attempt) % MUSIC_INNER_FLOAT_LAYOUTS.length];
    const colorSet = MUSIC_INNER_FLOAT_COLORS[Math.floor(Math.random() * MUSIC_INNER_FLOAT_COLORS.length)];
    const candidate: MusicInnerFloat = {
      id: `music-inner-${Date.now()}-${sequence}`,
      text,
      tone,
      left: layout.left + (Math.random() * 10 - 5),
      top: layout.top + (Math.random() * 7 - 3.5),
      width: 54 + Math.random() * 30,
      fontSize: 10 + Math.random() * 4,
      color: colorSet?.color ?? "rgba(236, 235, 255, 0.94)",
      glow: colorSet?.glow ?? "hsl(252 28% 78% / 0.72)",
      delay: -0.28 * (sequence % 5),
      zIndex: 10 + sequence,
    };
    const score = getMusicInnerOverlapScore(candidate, existingItems);
    if (score < bestScore) {
      bestFloat = candidate;
      bestScore = score;
      if (score === 0) break;
    }
  }

  return bestFloat ?? createMusicInnerFloat(sequence, text, tone, []);
}

function getMusicMonthlyMinutes(label: string): { value: string; suffix: string } {
  const normalized = label.trim();
  const match = normalized.match(/([\d,，.]+)/);
  if (!match) return { value: normalized, suffix: "" };
  const suffix = normalized.slice((match.index ?? 0) + match[0].length).replace(/^分钟?/, "分钟").trim();
  return { value: match[0].replace(/，/g, ","), suffix: suffix || "分钟" };
}

function getMusicTopArtistName(label: string): string {
  return label.replace(/^最近偏爱[:：]?\s*/, "").trim();
}

function getTrackProgress(track: CheckPhoneMusicTrack): number {
  const seed = track.title.length * 7 + track.artist.length * 5 + track.albumTitle.length * 3;
  return 26 + (seed % 48);
}

function MusicCover({
  icon,
  tone,
  large = false,
}: {
  icon: string;
  tone: CheckPhoneMusicTone;
  large?: boolean;
}) {
  return (
    <div className={`cp-music-cover cp-music-cover--${tone} ${large ? "cp-music-cover--large" : ""}`}>
      {large ? <span className="cp-music-cover-ring" aria-hidden="true" /> : null}
      <span className={`cp-music-cover-icon ${large ? "cp-music-cover-icon--large" : ""}`}>{icon}</span>
    </div>
  );
}

function MusicPlayerControls({ compact = false }: { compact?: boolean }) {
  const sideIconSize = compact ? 14 : 11;
  return (
    <div className={`cp-music-player-controls${compact ? " cp-music-player-controls--compact" : ""}`} aria-hidden="true">
      {!compact ? <span><Shuffle size={sideIconSize} strokeWidth={2.1} /></span> : null}
      <span><SkipBack size={sideIconSize} strokeWidth={2.2} /></span>
      <span className="cp-music-player-play"><Pause size={compact ? 15 : 12} strokeWidth={2.4} /></span>
      <span><SkipForward size={sideIconSize} strokeWidth={2.2} /></span>
      <span><ListMusic size={sideIconSize} strokeWidth={2.1} /></span>
    </div>
  );
}

function MusicProgress({ track, compact = false }: { track: CheckPhoneMusicTrack; compact?: boolean }) {
  return (
    <div
      className={`cp-music-player-progress${compact ? " cp-music-player-progress--compact" : ""}`}
      style={{ "--music-progress": `${getTrackProgress(track)}%` } as CSSProperties}
      aria-hidden="true"
    >
      <span />
    </div>
  );
}

function MusicTrackRow({
  track,
  active = false,
  onReveal,
}: {
  track: CheckPhoneMusicTrack;
  active?: boolean;
  onReveal: () => void;
}) {
  return (
    <button
      type="button"
      className={`cp-music-track-row ${active ? "is-active" : ""}`}
      onClick={onReveal}
      aria-label={`显示《${track.title}》的内心`}
    >
      <MusicCover icon={track.coverIcon} tone={track.tone} />
      <div className="cp-music-track-meta">
        <div className="cp-music-track-top">
          <strong><CheckPhoneBilingualText text={track.title} tone="music" /></strong>
        </div>
        <span>{track.artist} · {track.albumTitle}</span>
      </div>
      <div className="cp-music-track-side" aria-hidden="true">
        <Heart size={14} strokeWidth={2.2} className={`cp-music-liked ${track.liked ? "is-liked" : ""}`} />
        <time>
          <Clock3 size={10} strokeWidth={2.2} />
          {track.durationLabel}
        </time>
      </div>
    </button>
  );
}

function MusicPlaylistCard({
  playlist,
  trackCount,
  leadTrack,
  onOpen,
  onReveal,
}: {
  playlist: CheckPhoneMusicPlaylist;
  trackCount: number;
  leadTrack?: CheckPhoneMusicTrack;
  onOpen: () => void;
  onReveal: () => void;
}) {
  const leadTrackLabel = leadTrack ? `${leadTrack.title}-${leadTrack.artist}` : "";

  return (
    <button
      type="button"
      className="cp-music-playlist-card"
      onClick={() => {
        onReveal();
        onOpen();
      }}
    >
      <div className="cp-music-playlist-art-row">
        <MusicCover icon={playlist.coverIcon} tone={playlist.tone} />
        <div className="cp-music-playlist-badges">
          <span className={`cp-music-playlist-save${playlist.saved ? " is-saved" : ""}`} aria-hidden="true">
            <Bookmark size={13} strokeWidth={2.2} />
          </span>
          <b className="cp-music-playlist-count">{trackCount} 首</b>
        </div>
      </div>
      <div className="cp-music-playlist-body">
        <strong><CheckPhoneBilingualText text={playlist.title} tone="music" /></strong>
        {leadTrackLabel ? <span>{leadTrackLabel}</span> : null}
      </div>
    </button>
  );
}

export function CheckPhoneMusicPage({ character, onBack }: CheckPhoneMusicPageProps) {
  const [snapshot, setSnapshot] = useState<CheckPhoneSnapshot<CheckPhoneMusicPayload> | null>(null);
  const [selectedTab, setSelectedTab] = useState<MusicTabId>("home");
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [innerFloats, setInnerFloats] = useState<MusicInnerFloat[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useCheckPhoneRefresh(character.id, "music", setSnapshot);
  const [error, setError] = useState<string | null>(null);
  const [debugRawOutput, setDebugRawOutput] = useState<string | null>(null);
  const [debugParseError, setDebugParseError] = useState<string | null>(null);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const innerFloatSeq = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setError(null);
    setDebugRawOutput(null);
    setDebugParseError(null);
    setSnapshot(null);
    setSelectedTab("home");
    setSelectedPlaylistId(null);
    setInnerFloats([]);
    (async () => {
      const cached = await loadPhoneSnapshot<CheckPhoneMusicPayload>(character.id, "music");
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
    setDebugParseError(null);
    const {
      payload,
      summary,
      error: nextError,
      debugRawOutput: nextDebugRawOutput,
      debugParseError: nextDebugParseError,
    } = await generateCheckPhoneMusic(
      character.id,
      snapshot?.payload ?? null,
      snapshot?.updatedAt,
    );
    if (payload) {
      const now = appNowISO();
      const nextSnapshot: CheckPhoneSnapshot<CheckPhoneMusicPayload> = {
        id: `${character.id}:music`,
        characterId: character.id,
        appId: "music",
        generatedAt: snapshot?.generatedAt ?? now,
        updatedAt: now,
        summary,
        payload,
      };
      await savePhoneSnapshot(nextSnapshot);
      setSnapshot(nextSnapshot);
      setSelectedPlaylistId(null);
      setInnerFloats([]);
    }
    setError(nextError ?? null);
    setDebugRawOutput(nextDebugRawOutput ?? null);
    setDebugParseError(nextDebugParseError ?? null);
    setLoading(false);
    setLoaded(true);
  }

  async function handleClear() {
    if (loading) return;
    await clearPhoneSnapshot(character.id, "music");
    setSnapshot(null);
    setSelectedTab("home");
    setSelectedPlaylistId(null);
    setInnerFloats([]);
    setError(null);
    setDebugRawOutput(null);
    setDebugParseError(null);
    setLoaded(true);
    setConfirmClearOpen(false);
  }

  const payload = snapshot?.payload ?? null;
  const allTracks = useMemo(() => {
    const map = new Map<string, CheckPhoneMusicTrack>();
    for (const track of payload?.recentTracks ?? []) map.set(track.id, track);
    for (const track of payload?.likedTracks ?? []) if (!map.has(track.id)) map.set(track.id, track);
    return Array.from(map.values());
  }, [payload]);
  const trackById = useMemo(() => new Map(allTracks.map((track) => [track.id, track])), [allTracks]);
  const nowPlayingTrack = useMemo(
    () => allTracks.find((track) => track.id === payload?.nowPlayingTrackId) ?? allTracks[0] ?? null,
    [allTracks, payload?.nowPlayingTrackId],
  );
  const activePlaylist = useMemo(
    () => payload?.playlists.find((playlist) => playlist.id === selectedPlaylistId) ?? null,
    [payload, selectedPlaylistId],
  );
  const activePlaylistTracks = useMemo(
    () => activePlaylist ? activePlaylist.trackIds.map((id) => trackById.get(id)).filter(Boolean) as CheckPhoneMusicTrack[] : [],
    [activePlaylist, trackById],
  );

  const subtitle = MUSIC_HEADER_SUBTITLE;
  const activeTabIndex = Math.max(0, MUSIC_TABS.findIndex((tab) => tab.id === selectedTab));
  const backAction = activePlaylist ? () => setSelectedPlaylistId(null) : onBack;
  const profileMonthly = payload ? getMusicMonthlyMinutes(payload.profile.monthlyMinutesLabel) : { value: "", suffix: "" };
  const profileTopArtistName = payload ? getMusicTopArtistName(payload.profile.topArtistLabel) : "";

  function revealMusicInner(text: string, tone: CheckPhoneMusicTone) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const sequence = innerFloatSeq.current++;
    setInnerFloats((items) => {
      const floatItem = createMusicInnerFloat(sequence, trimmed, tone, items);
      return [...items, floatItem].slice(-MUSIC_INNER_FLOAT_MAX_STACK);
    });
  }

  function dismissMusicInner(id: string) {
    setInnerFloats((items) => items.filter((item) => item.id !== id));
  }

  return (
    <div className="cp-music-module">
      <header className="cp-music-appbar">
        <button type="button" className="cp-float-back" onClick={backAction} aria-label="Back">
          <ChevronLeft size={22} strokeWidth={2.5} />
        </button>
        <div className="cp-music-header-stack">
          <div className="cp-music-header-title">{payload?.headerTitle || "音乐"}</div>
          <div className="cp-music-header-subtitle">{subtitle}</div>
        </div>
        <div className="cp-appbar-actions">
          <button type="button" className="cp-float-refresh" onClick={handleRefresh} disabled={loading} aria-label="Refresh">
            <RefreshCw size={18} strokeWidth={2.5} className={loading ? "cp-spin" : ""} />
          </button>
          <button
            type="button"
            className="cp-float-clear"
            onClick={() => setConfirmClearOpen(true)}
            disabled={loading || !snapshot}
            aria-label="Clear music snapshot"
          >
            <Trash2 size={17} strokeWidth={2.25} />
          </button>
        </div>
      </header>

      {loading && (
        <div className="cp-refresh-indicator cp-refresh-indicator--floating" aria-live="polite">
          <span className="cp-refresh-indicator-text">正在刷新音乐</span>
          <span className="cp-refresh-indicator-dots" aria-hidden="true">
            <i></i><i></i><i></i>
          </span>
        </div>
      )}

      <div className="cp-music-body">
        {!loaded && <div className="cp-music-status">Syncing library...</div>}

        {loaded && !payload && !loading && (
          <div className="cp-music-status cp-empty-copy">
            <p>暂无音乐内容</p>
            <span className="cp-music-hint">点刷新同步最近播放歌单和个人听歌页</span>
          </div>
        )}

        {error ? (
          <CheckPhoneDebugErrorCard
            error={error}
            debugRawOutput={debugRawOutput}
            debugParseError={debugParseError}
          />
        ) : null}

        {payload && !activePlaylist && (
          <>
            <div className="cp-music-scroll">
              {selectedTab === "home" && (
                <section className="cp-music-home">
                  {nowPlayingTrack && (
                    <button
                      type="button"
                      className="cp-music-now-card"
                      onClick={() => revealMusicInner(nowPlayingTrack.note, nowPlayingTrack.tone)}
                      aria-label={`显示《${nowPlayingTrack.title}》的内心`}
                    >
                      <div className="cp-music-now-visual" aria-hidden="true">
                        <span className="cp-music-now-glow" />
                        <span className="cp-music-now-vinyl" />
                      </div>
                      <div className="cp-music-now-meta">
                        <div className="cp-music-now-title-row">
                          <h3><CheckPhoneBilingualText text={nowPlayingTrack.title} tone="music" /></h3>
                          <Heart
                            size={14}
                            strokeWidth={2.2}
                            className={`cp-music-now-heart cp-music-liked ${nowPlayingTrack.liked ? "is-liked" : ""}`}
                            aria-hidden="true"
                          />
                        </div>
                        <span>{nowPlayingTrack.artist} · {nowPlayingTrack.albumTitle}</span>
                        <MusicProgress track={nowPlayingTrack} />
                        <MusicPlayerControls />
                      </div>
                    </button>
                  )}
                  <section className="cp-music-section">
                    <div className="cp-music-section-head">
                      <h3>最近播放</h3>
                      <span>{payload.recentTracks.length}</span>
                    </div>
                    <div className="cp-music-track-list">
                      {payload.recentTracks.slice(0, 5).map((track) => (
                        <MusicTrackRow
                          key={track.id}
                          track={track}
                          active={track.id === payload.nowPlayingTrackId}
                          onReveal={() => revealMusicInner(track.note, track.tone)}
                        />
                      ))}
                    </div>
                  </section>
                  <section className="cp-music-section">
                    <div className="cp-music-section-head">
                      <h3>精选歌单</h3>
                      <span>{payload.playlists.length}</span>
                    </div>
                    <div className="cp-music-playlist-grid">
                      {payload.playlists.slice(0, 4).map((playlist) => (
                        <MusicPlaylistCard
                          key={playlist.id}
                          playlist={playlist}
                          trackCount={playlist.trackIds.length}
                          leadTrack={playlist.trackIds.map((id) => trackById.get(id)).find(Boolean)}
                          onReveal={() => revealMusicInner(playlist.curatorNote, playlist.tone)}
                          onOpen={() => setSelectedPlaylistId(playlist.id)}
                        />
                      ))}
                    </div>
                  </section>
                </section>
              )}

              {selectedTab === "recent" && (
                <section className="cp-music-section">
                  <div className="cp-music-section-head">
                    <h3>最近播放</h3>
                    <span>{payload.recentTracks.length}</span>
                  </div>
                  <div className="cp-music-track-list">
                    {payload.recentTracks.map((track) => (
                      <MusicTrackRow
                        key={track.id}
                        track={track}
                        active={track.id === payload.nowPlayingTrackId}
                        onReveal={() => revealMusicInner(track.note, track.tone)}
                      />
                    ))}
                  </div>
                </section>
              )}

              {selectedTab === "playlists" && (
                <section className="cp-music-section">
                  <div className="cp-music-section-head">
                    <h3>歌单</h3>
                    <span>{payload.playlists.length}</span>
                  </div>
                  <div className="cp-music-playlist-grid cp-music-playlist-grid--stacked">
                    {payload.playlists.map((playlist) => (
                      <MusicPlaylistCard
                        key={playlist.id}
                        playlist={playlist}
                        trackCount={playlist.trackIds.length}
                        leadTrack={playlist.trackIds.map((id) => trackById.get(id)).find(Boolean)}
                        onReveal={() => revealMusicInner(playlist.curatorNote, playlist.tone)}
                        onOpen={() => setSelectedPlaylistId(playlist.id)}
                      />
                    ))}
                  </div>
                </section>
              )}

              {selectedTab === "profile" && (
                <section className="cp-music-profile">
                  <div className="cp-music-profile-card">
                    <div className="cp-music-profile-avatar" aria-hidden="true">
                      {character.name.trim().slice(0, 1) || "M"}
                    </div>
                    {payload.profile.nickname ? <strong className="cp-music-profile-name">{payload.profile.nickname}</strong> : null}
                    <p><CheckPhoneBilingualText text={payload.profile.listeningMood} tone="music" /></p>
                    <div className="cp-music-profile-stats">
                      <span>
                        本月听了 <strong>{profileMonthly.value}</strong>{profileMonthly.suffix}
                        <i aria-hidden="true">·</i>
                        最近偏爱：<strong>{profileTopArtistName}</strong>
                      </span>
                    </div>
                  </div>
                  <section className="cp-music-section">
                    <div className="cp-music-section-head">
                      <h3>我喜欢的</h3>
                      <span>{payload.likedTracks.length}</span>
                    </div>
                    <div className="cp-music-track-list">
                      {payload.likedTracks.map((track) => (
                        <MusicTrackRow
                          key={track.id}
                          track={track}
                          onReveal={() => revealMusicInner(track.note, track.tone)}
                        />
                      ))}
                    </div>
                  </section>
                </section>
              )}
            </div>

            <nav className="cp-music-tabbar" aria-label="音乐导航">
              <span
                className="cp-music-tab-glow"
                style={{ transform: `translateX(calc(${activeTabIndex * 100}% + ${activeTabIndex * 4}px))` }}
                aria-hidden="true"
              />
              {MUSIC_TABS.map((tab) => {
                const Icon = tab.icon;
                const active = selectedTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    className={`cp-music-tab ${active ? "is-active" : ""}`}
                    onClick={() => setSelectedTab(tab.id)}
                  >
                    <Icon size={16} strokeWidth={2.1} />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </nav>
          </>
        )}

        {payload && activePlaylist && (
          <div className="cp-music-scroll cp-music-scroll--detail">
            <article className="cp-music-playlist-detail">
              <div className="cp-music-playlist-hero">
                <MusicCover icon={activePlaylist.coverIcon} tone={activePlaylist.tone} large />
                <div className="cp-music-playlist-hero-meta">
                  <div className="cp-music-detail-kicker"><CheckPhoneBilingualText text={activePlaylist.subtitle} tone="music" /></div>
                  <h3><CheckPhoneBilingualText text={activePlaylist.title} tone="music" /></h3>
                  <span>{activePlaylist.trackIds.length} 首 · {activePlaylist.saved ? "已收藏" : "精选歌单"}</span>
                </div>
              </div>
              <div className="cp-music-track-list">
                {activePlaylistTracks.map((track) => (
                  <MusicTrackRow
                    key={track.id}
                    track={track}
                    active={track.id === payload.nowPlayingTrackId}
                    onReveal={() => revealMusicInner(track.note, track.tone)}
                  />
                ))}
              </div>
            </article>
          </div>
        )}
      </div>

      {innerFloats.length > 0 ? (
        <div className="cp-music-inner-layer" aria-live="polite">
          {innerFloats.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`cp-music-inner-float cp-music-inner-float--${item.tone}`}
              style={{
                "--music-inner-left": `${item.left}%`,
                "--music-inner-top": `${item.top}%`,
                "--music-inner-width": `${item.width}%`,
                "--music-inner-size": `${item.fontSize}px`,
                "--music-inner-color": item.color,
                "--music-inner-glow": item.glow,
                "--music-inner-delay": `${item.delay}s`,
                zIndex: item.zIndex,
              } as CSSProperties}
              onClick={() => dismissMusicInner(item.id)}
              aria-label="关闭内心文字"
            >
              <CheckPhoneBilingualText text={item.text} tone="light" />
            </button>
          ))}
        </div>
      ) : null}

      {confirmClearOpen && (
        <ConfirmDialog
          title="清空音乐内容？"
          message="确认后会清空当前音乐缓存。之后重新刷新时，不会再带入旧音乐内容。"
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
