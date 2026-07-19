// components/music/music-app.tsx — Music App main page (immersive, no PageShell)
"use client";

import { useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import {
    loadAllTracks, saveTrack, deleteTrack, updateTrackMeta,
    generateTrackId, parseFilename, getAudioDuration,
    type MusicTrack,
} from "@/lib/music-storage";
import { getPlayHistory, type PlayHistoryEntry } from "@/lib/music-history";
import { useMusicControls, type MusicControlsValue } from "@/lib/music-context";
import { scopeSessionCSS } from "@/lib/css-scoper";
import {
    isNeteaseConfigured, loadMusicApiConfig, saveMusicApiConfig,
    searchNetease, getNeteasePlayUrl, getNeteaseLyrics, getNeteaseSongDetail,
    testNeteaseConnection, getQrKey, getQrImage, checkQrStatus, checkLoginStatus,
    getUserPlaylists, getPlaylistTracks, saveNeteaseCookie, clearNeteaseCookie,
    getDailyRecommendSongs, getHotSearchDetail, getPersonalizedPlaylists,
    getRecommendResource, getToplists, getUserRecord,
    type NeteaseHotSearch, type NeteaseSearchResult,
    type NeteasePlaylist, type NeteaseToplist, type MusicApiConfig,
} from "@/lib/music-service";
import { clearMusicCloudSyncData } from "@/lib/chat-engine";

type Props = { onClose: () => void };
type TabId = "recommend" | "mine" | "search" | "local";

export default function MusicApp({ onClose }: Props) {
    const [tracks, setTracks] = useState<MusicTrack[]>([]);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState<TabId>("local");
    const [hasNetease, setHasNetease] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [showCssEditor, setShowCssEditor] = useState(false);
    const [customCss, setCustomCss] = useState("");
    const [activePlaylist, setActivePlaylist] = useState<NeteasePlaylist | null>(null);
    const [playlists, setPlaylists] = useState<NeteasePlaylist[]>([]);
    const [playlistsLoading, setPlaylistsLoading] = useState(true);
    const [musicToast, setMusicToast] = useState<string | null>(null);
    const [pendingPlayTrackId, setPendingPlayTrackId] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const musicToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const musicLoadingFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const player = useMusicControls();

    useEffect(() => {
        loadAllTracks().then(t => { setTracks(t); setLoading(false); });
        const neteaseOk = isNeteaseConfigured();
        setHasNetease(neteaseOk);
        if (neteaseOk) setTab("recommend");
        setCustomCss(kvGet("music-custom-css") || "");
        // Load cached playlists immediately, then refresh from API
        if (neteaseOk) {
            try {
                const cached = kvGet("music-playlists-cache");
                if (cached) { setPlaylists(JSON.parse(cached)); setPlaylistsLoading(false); }
            } catch { /* ignore */ }
            getUserPlaylists().then(p => {
                setPlaylists(p);
                setPlaylistsLoading(false);
                if (p.length > 0) kvSet("music-playlists-cache", JSON.stringify(p));
            });
        } else {
            setPlaylistsLoading(false);
        }
    }, []);

    useEffect(() => {
        const handleLibraryUpdated = () => {
            void loadAllTracks().then(setTracks);
        };
        window.addEventListener("music-library-updated", handleLibraryUpdated);
        return () => window.removeEventListener("music-library-updated", handleLibraryUpdated);
    }, []);

    const clearMusicToast = useCallback(() => {
        if (musicToastTimerRef.current) clearTimeout(musicToastTimerRef.current);
        if (musicLoadingFallbackRef.current) clearTimeout(musicLoadingFallbackRef.current);
        musicToastTimerRef.current = null;
        musicLoadingFallbackRef.current = null;
        setMusicToast(null);
        setPendingPlayTrackId(null);
    }, []);

    const showMusicToast = useCallback((text: string, duration = 2000) => {
        if (musicToastTimerRef.current) clearTimeout(musicToastTimerRef.current);
        if (musicLoadingFallbackRef.current) clearTimeout(musicLoadingFallbackRef.current);
        musicToastTimerRef.current = null;
        musicLoadingFallbackRef.current = null;
        setPendingPlayTrackId(null);
        setMusicToast(text);
        if (duration > 0) {
            musicToastTimerRef.current = setTimeout(() => {
                setMusicToast(null);
                musicToastTimerRef.current = null;
            }, duration);
        }
    }, []);

    const beginMusicLoadingToast = useCallback((trackId: string) => {
        if (musicToastTimerRef.current) clearTimeout(musicToastTimerRef.current);
        if (musicLoadingFallbackRef.current) clearTimeout(musicLoadingFallbackRef.current);
        musicToastTimerRef.current = null;
        setPendingPlayTrackId(trackId);
        setMusicToast("加载音乐中...");
        musicLoadingFallbackRef.current = setTimeout(() => {
            setMusicToast(null);
            setPendingPlayTrackId(null);
            musicLoadingFallbackRef.current = null;
        }, 8000);
    }, []);

    useEffect(() => {
        if (!pendingPlayTrackId || player.currentTrack?.id !== pendingPlayTrackId) return;
        clearMusicToast();
    }, [clearMusicToast, pendingPlayTrackId, player.currentTrack?.id]);

    useEffect(() => () => {
        if (musicToastTimerRef.current) clearTimeout(musicToastTimerRef.current);
        if (musicLoadingFallbackRef.current) clearTimeout(musicLoadingFallbackRef.current);
    }, []);

    // ── Upload handler ──
    const handleUpload = async (files: FileList | null) => {
        if (!files || files.length === 0) return;
        const newTracks: MusicTrack[] = [];
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
            const audioExts = ["mp3", "m4a", "aac", "ogg", "wav", "flac", "wma", "opus", "webm"];
            if (!file.type.startsWith("audio/") && !audioExts.includes(ext)) continue;
            const { title, artist } = parseFilename(file.name);
            const duration = await getAudioDuration(file);
            const track: MusicTrack = { id: generateTrackId(), title, artist, duration, liked: false, addedAt: new Date().toISOString() };
            await saveTrack(track, file);
            newTracks.push(track);
        }
        if (newTracks.length > 0) setTracks(prev => [...newTracks, ...prev]);
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    const handlePlay = (track: MusicTrack) => {
        // Add this single track to front of queue (if not already in it)
        if (!player.queue.some(t => t.id === track.id)) {
            player.setQueue([track, ...player.queue]);
        }
        player.playTrack(track);
    };

    const handleDelete = async (trackId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        await deleteTrack(trackId);
        setTracks(prev => prev.filter(t => t.id !== trackId));
        if (player.currentTrack?.id === trackId) player.stop();
    };

    const handleEditSave = async (trackId: string, updates: Partial<MusicTrack>) => {
        await updateTrackMeta(trackId, updates);
        setTracks(prev => prev.map(t => (t.id === trackId ? { ...t, ...updates } : t)));
        player.updateTrackMetadata(trackId, updates);
    };

    /** Convert NeteaseSearchResult → MusicTrack */
    const toMusicTrack = useCallback((r: NeteaseSearchResult, extra?: { lyrics?: string; coverUrl?: string; name?: string; artists?: string }): MusicTrack => ({
        id: `netease_${r.id}`,
        title: extra?.name || r.name,
        artist: extra?.artists || r.artists,
        duration: r.duration / 1000,
        coverUrl: extra?.coverUrl || r.coverUrl,
        lyrics: extra?.lyrics,
        liked: false,
        addedAt: new Date().toISOString(),
    }), []);

    /** Play a single Netease song — append to queue */
    const handlePlayNetease = useCallback(async (result: NeteaseSearchResult) => {
        const trackId = `netease_${result.id}`;
        beginMusicLoadingToast(trackId);
        const url = await getNeteasePlayUrl(result.id);
        if (!url) {
            showMusicToast("加载失败，请稍后重试");
            return;
        }
        const detail = await getNeteaseSongDetail(result.id);
        const lyrics = await getNeteaseLyrics(result.id);
        const track = toMusicTrack(result, { lyrics, coverUrl: detail?.coverUrl, name: detail?.name, artists: detail?.artists });
        // Prepend to existing queue
        if (!player.queue.some(t => t.id === track.id)) {
            player.setQueue([track, ...player.queue]);
        }
        player.playUrl(url, track);
    }, [beginMusicLoadingToast, player, showMusicToast, toMusicTrack]);

    /** Play all tracks from a playlist — replace queue */
    const handlePlayAllNetease = useCallback(async (results: NeteaseSearchResult[]) => {
        if (results.length === 0) return;
        const queue = results.map(r => toMusicTrack(r));
        player.setQueue(queue);

        beginMusicLoadingToast(`netease_${results[0].id}`);
        let playable: { song: NeteaseSearchResult; url: string; index: number } | null = null;
        for (let i = 0; i < results.length; i++) {
            const song = results[i];
            const url = await getNeteasePlayUrl(song.id);
            if (url) {
                playable = { song, url, index: i };
                break;
            }
        }

        if (!playable) {
            showMusicToast("歌单内暂无可播放歌曲");
            return;
        }

        beginMusicLoadingToast(`netease_${playable.song.id}`);
        const detail = await getNeteaseSongDetail(playable.song.id);
        const lyrics = await getNeteaseLyrics(playable.song.id);
        const track = toMusicTrack(playable.song, { lyrics, coverUrl: detail?.coverUrl, name: detail?.name, artists: detail?.artists });
        player.playUrl(playable.url, track);
        if (playable.index > 0) showMusicToast(`已跳过 ${playable.index} 首不可播放歌曲`);
    }, [beginMusicLoadingToast, player, showMusicToast, toMusicTrack]);

    const formatTime = (s: number) => {
        if (!s || !isFinite(s)) return "--:--";
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return `${m}:${sec.toString().padStart(2, "0")}`;
    };

    const onSettingsSaved = () => {
        const neteaseOk = isNeteaseConfigured();
        setHasNetease(neteaseOk);
        if (neteaseOk) {
            setTab("recommend");
            // API address may have changed — clear old cache and reload playlists
            kvRemove("music-playlists-cache");
            setPlaylistsLoading(true);
            setPlaylists([]);
            setActivePlaylist(null);
            getUserPlaylists().then(p => {
                setPlaylists(p);
                setPlaylistsLoading(false);
                if (p.length > 0) kvSet("music-playlists-cache", JSON.stringify(p));
            }).catch(() => setPlaylistsLoading(false));
        } else {
            setTab("local");
            kvRemove("music-playlists-cache");
            setPlaylists([]);
            setPlaylistsLoading(false);
        }
    };

    return (
        <div className="music-app">
            {customCss && <style dangerouslySetInnerHTML={{ __html: scopeSessionCSS(customCss, ".music-app") }} />}
            {musicToast && (
                <div className="music-toast-overlay">
                    <div className="music-toast-chip">
                        {musicToast === "加载音乐中..." ? (
                            <span className="ui-loading-toast-content">
                                <span className="ui-loading-spinner" />
                                <span>{musicToast}</span>
                            </span>
                        ) : musicToast}
                    </div>
                </div>
            )}

            {/* Header & Tabs */}
            <div className="music-header">
                <div className="music-header-left">
                    <button className="music-header-action" onClick={() => {
                        if (activePlaylist) { setActivePlaylist(null); }
                        else { onClose(); }
                    }} title="返回">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="15 18 9 12 15 6" />
                        </svg>
                    </button>
                </div>
                <div className="music-tabs">
                    {hasNetease && <button className="music-tab" {...(tab === "recommend" ? { "data-active": "" } : {})} onClick={() => { setTab("recommend"); setActivePlaylist(null); }}>推荐</button>}
                    <button className="music-tab" {...(tab === "mine" ? { "data-active": "" } : {})} onClick={() => { setTab("mine"); setActivePlaylist(null); }}>我的</button>
                    {hasNetease && <button className="music-tab" {...(tab === "search" ? { "data-active": "" } : {})} onClick={() => setTab("search")}>搜索</button>}
                    <button className="music-tab" {...(tab === "local" ? { "data-active": "" } : {})} onClick={() => { setTab("local"); setActivePlaylist(null); }}>本地</button>
                </div>
                <div className="music-header-right">
                    <button className="music-header-action" onClick={() => setShowSettings(true)} title="设置">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                        </svg>
                    </button>
                </div>
            </div>

            {/* Tab content */}
            {tab === "recommend" && hasNetease && (
                <RecommendTab
                    formatTime={formatTime}
                    onPlayNetease={handlePlayNetease}
                    onOpenPlaylist={(playlist) => {
                        setActivePlaylist(playlist);
                        setTab("mine");
                    }}
                />
            )}

            {tab === "mine" && (
                <MineTab
                    player={player}
                    formatTime={formatTime}
                    onPlayNetease={handlePlayNetease}
                    onPlayAll={handlePlayAllNetease}
                    activePlaylist={activePlaylist}
                    setActivePlaylist={setActivePlaylist}
                    playlists={playlists}
                    loading={playlistsLoading}
                    hasNetease={hasNetease}
                    localTracks={tracks}
                    onPlayLocal={handlePlay}
                />
            )}

            {tab === "local" && (
                <>
                    {/* Header Action: Upload Area inside the tab - Removed inline version */}
                    <input ref={fileInputRef} type="file" accept="audio/*,.mp3,.m4a,.aac,.ogg,.wav,.flac" multiple hidden onChange={(e) => handleUpload(e.target.files)} />

                    {/* Song list */}
                    {loading ? (
                        <div className="music-empty"><div className="music-empty-text">加载中...</div></div>
                    ) : tracks.length === 0 ? (
                        <div className="music-empty"><div className="music-empty-icon">♪</div><div className="music-empty-text">还没有音乐</div></div>
                    ) : (
                        <SongList tracks={tracks} player={player} formatTime={formatTime} onDelete={handleDelete} onPlay={handlePlay} onEdit={handleEditSave} />
                    )}
                </>
            )}

            {tab === "search" && hasNetease && (
                <OnlineSearchTab player={player} formatTime={formatTime} onPlayNetease={handlePlayNetease} />
            )}

            {/* Floating buttons */}
            {tab === "local" && (
                <>
                    <button
                        className="music-fab-add"
                        onClick={() => setShowCssEditor(true)}
                        title="自定义样式"
                        style={{ bottom: player.currentTrack ? "168px" : "88px" }}
                    >
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z" />
                            <path d="M19 15l.75 2.25L22 18l-2.25.75L19 21l-.75-2.25L16 18l2.25-.75z" />
                        </svg>
                    </button>
                    <button
                        className="music-fab-add"
                        onClick={() => fileInputRef.current?.click()}
                        title="添加本地音乐"
                        style={{ bottom: player.currentTrack ? "112px" : "32px" }}
                    >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="12" y1="5" x2="12" y2="19" />
                            <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                    </button>
                </>
            )}

            {/* Now playing bar */}
            {player.currentTrack && (
                <div className="music-now-bar" onClick={player.openFullPlayer}>
                    <div className="music-birds">
                        <img src="/birds/小鸟1.png" className="music-bird bird-1" alt="bird" />
                        <img src="/birds/小鸟2.png" className="music-bird bird-2" alt="bird" />
                        <img src="/birds/小鸟3.png" className="music-bird bird-3" alt="bird" />
                        <img src="/birds/小鸟4.png" className="music-bird bird-4" alt="bird" />
                    </div>
                    <div className="music-now-bar-cover" {...(player.isPlaying ? { "data-playing": "" } : {})}>
                        {player.currentTrack.coverUrl ? (
                            <img src={player.currentTrack.coverUrl} alt="" />
                        ) : (
                            <div className="music-now-bar-cover-placeholder">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--c-music-accent)" strokeWidth="1.2">
                                    <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                                </svg>
                            </div>
                        )}
                    </div>
                    <div className="music-now-bar-info">
                        <div className="music-now-bar-title">{player.currentTrack.title}</div>
                        <div className="music-now-bar-artist">{player.currentTrack.artist}</div>
                    </div>
                    <div className="music-now-bar-controls">
                        <button className="music-now-bar-btn" onClick={(e) => { e.stopPropagation(); player.prev(); }}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" /></svg>
                        </button>
                        <button className="music-now-bar-btn" onClick={(e) => { e.stopPropagation(); player.togglePlay(); }}>
                            {player.isPlaying ? (
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zm8 0h4v16h-4z" /></svg>
                            ) : (
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                            )}
                        </button>
                        <button className="music-now-bar-btn" onClick={(e) => { e.stopPropagation(); player.next(); }}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zm8.5 0h2V6h-2v12z" /></svg>
                        </button>
                    </div>
                </div>
            )}

            {/* Settings Modal */}
            {showSettings && (
                <div className="music-settings-modal-overlay" onClick={() => setShowSettings(false)}>
                    <div className="music-settings-modal-dialog" onClick={(e) => e.stopPropagation()}>
                        <MusicSettingsTab onBack={() => setShowSettings(false)} onSaved={onSettingsSaved} />
                    </div>
                </div>
            )}

            {/* CSS Editor Modal */}
            {showCssEditor && (
                <div className="music-settings-modal-overlay" onClick={() => setShowCssEditor(false)}>
                    <div className="music-settings-modal-dialog" onClick={(e) => e.stopPropagation()}>
                        <MusicCssEditor onClose={() => setShowCssEditor(false)} onSave={setCustomCss} />
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Recommend Tab ──
function RecommendTab({ formatTime, onPlayNetease, onOpenPlaylist }: {
    formatTime: (s: number) => string;
    onPlayNetease: (r: NeteaseSearchResult) => void;
    onOpenPlaylist: (playlist: NeteasePlaylist) => void;
}) {
    const [dailySongs, setDailySongs] = useState<NeteaseSearchResult[]>(() => readMusicCache("music-recommend-daily", []));
    const [playlists, setPlaylists] = useState<NeteasePlaylist[]>(() => readMusicCache("music-recommend-playlists", []));
    const [hotSearches, setHotSearches] = useState<NeteaseHotSearch[]>(() => readMusicCache("music-recommend-hot-search", []));
    const [toplists, setToplists] = useState<NeteaseToplist[]>(() => readMusicCache("music-recommend-toplists", []));
    const [loading, setLoading] = useState(dailySongs.length + playlists.length + hotSearches.length === 0);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        Promise.all([
            getDailyRecommendSongs(),
            getRecommendResource().then(items => items.length > 0 ? items : getPersonalizedPlaylists(12)),
            getHotSearchDetail(),
            getToplists(),
        ]).then(([daily, recPlaylists, hot, charts]) => {
            if (cancelled) return;
            setDailySongs(daily);
            setPlaylists(recPlaylists);
            setHotSearches(hot);
            setToplists(charts);
            writeMusicCache("music-recommend-daily", daily);
            writeMusicCache("music-recommend-playlists", recPlaylists);
            writeMusicCache("music-recommend-hot-search", hot);
            writeMusicCache("music-recommend-toplists", charts);
        }).finally(() => {
            if (!cancelled) setLoading(false);
        });
        return () => { cancelled = true; };
    }, []);

    const hasRecommendContent = dailySongs.length + playlists.length + hotSearches.length + toplists.length > 0;

    return (
        <div className="music-discovery">
            {loading && !hasRecommendContent ? (
                <div className="music-empty"><div className="music-empty-text">加载推荐中...</div></div>
            ) : (
                <>
                    {dailySongs.length > 0 && (
                        <MusicSection title="每日推荐" action={`${dailySongs.length} 首`}>
                            <div className="music-list music-list-compact">
                                {dailySongs.slice(0, 8).map((song, idx) => (
                                    <NeteaseSongRow key={song.id} song={song} index={idx} formatTime={formatTime} onPlay={onPlayNetease} />
                                ))}
                            </div>
                        </MusicSection>
                    )}

                    {playlists.length > 0 && (
                        <MusicSection title="推荐歌单" action="更多灵感">
                            <PlaylistGrid playlists={playlists.slice(0, 9)} onOpen={onOpenPlaylist} />
                        </MusicSection>
                    )}

                    {hotSearches.length > 0 && (
                        <MusicSection title="热搜榜" action="实时">
                            <div className="music-hot-list">
                                {hotSearches.slice(0, 10).map((item, idx) => (
                                    <button key={`${item.keyword}-${idx}`} className="music-hot-item" onClick={() => searchNetease(item.keyword, 1).then(result => result[0] && onPlayNetease(result[0]))}>
                                        <span className="music-hot-rank">{idx + 1}</span>
                                        <span className="music-hot-word">{item.keyword}</span>
                                        {item.content && <span className="music-hot-desc">{item.content}</span>}
                                    </button>
                                ))}
                            </div>
                        </MusicSection>
                    )}

                    {toplists.length > 0 && (
                        <MusicSection title="排行榜" action="Toplist">
                            <div className="music-chart-grid">
                                {toplists.slice(0, 6).map(chart => (
                                    <button key={chart.id} className="music-chart-card" onClick={() => onOpenPlaylist(chart)}>
                                        <img src={chart.coverUrl} alt="" className="music-chart-cover" />
                                        <div className="music-chart-info">
                                            <div className="music-chart-name">{chart.name}</div>
                                            {chart.updateFrequency && <div className="music-chart-sub">{chart.updateFrequency}</div>}
                                            {chart.tracks?.slice(0, 2).map((track, idx) => (
                                                <div key={idx} className="music-chart-track">{track.first}{track.second ? ` - ${track.second}` : ""}</div>
                                            ))}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </MusicSection>
                    )}
                </>
            )}
        </div>
    );
}

// ── Mine Tab ──
function MineTab({
    player, formatTime, onPlayNetease, onPlayAll, activePlaylist, setActivePlaylist, playlists, loading,
    hasNetease, localTracks, onPlayLocal,
}: {
    player: MusicControlsValue;
    formatTime: (s: number) => string;
    onPlayNetease: (r: NeteaseSearchResult) => void;
    onPlayAll: (results: NeteaseSearchResult[]) => void;
    activePlaylist: NeteasePlaylist | null;
    setActivePlaylist: (pl: NeteasePlaylist | null) => void;
    playlists: NeteasePlaylist[];
    loading: boolean;
    hasNetease: boolean;
    localTracks: MusicTrack[];
    onPlayLocal: (t: MusicTrack) => void;
}) {
    const [recentTracks, setRecentTracks] = useState<NeteaseSearchResult[]>(() => readMusicCache("music-user-recent", []));
    const [history, setHistory] = useState<PlayHistoryEntry[]>(() => getPlayHistory());

    useEffect(() => {
        let cancelled = false;
        const cfg = loadMusicApiConfig();
        if (cfg.baseUrl.trim()) {
            getUserRecord(1).then(records => {
                if (cancelled) return;
                setRecentTracks(records);
                writeMusicCache("music-user-recent", records);
            });
        }
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        const onUpdate = () => setHistory(getPlayHistory());
        window.addEventListener("music-history-updated", onUpdate);
        return () => window.removeEventListener("music-history-updated", onUpdate);
    }, []);

    if (activePlaylist) {
        return (
            <PlaylistsTab
                player={player}
                formatTime={formatTime}
                onPlayNetease={onPlayNetease}
                onPlayAll={onPlayAll}
                activePlaylist={activePlaylist}
                setActivePlaylist={setActivePlaylist}
                playlists={playlists}
                loading={loading}
            />
        );
    }

    const handleResume = (entry: PlayHistoryEntry) => {
        if (entry.source === "local") {
            const live = localTracks.find(t => t.id === entry.id);
            if (live) onPlayLocal(live);
            return;
        }
        onPlayNetease({
            id: Number(entry.id.replace("netease_", "")),
            name: entry.title,
            artists: entry.artist,
            album: "",
            duration: entry.duration * 1000,
            coverUrl: entry.coverUrl,
        });
    };

    return (
        <div className="music-discovery">
            {/* 本地播放记录——不需要登录/配置网易云 API，本地文件和网易云在线播放都会记一笔。 */}
            <MusicSection title="本地歌单" action={`${history.length} 首`}>
                {history.length > 0 ? (
                    <div className="music-list music-list-compact">
                        {history.map((entry, idx) => (
                            <PlayHistoryRow key={entry.id} entry={entry} index={idx} formatTime={formatTime} onPlay={handleResume} />
                        ))}
                    </div>
                ) : (
                    <div className="music-empty"><div className="music-empty-text">还没有播放记录</div></div>
                )}
            </MusicSection>

            {hasNetease && recentTracks.length > 0 && (
                <MusicSection title="网易云最近播放" action={`${recentTracks.length} 首`}>
                    <div className="music-list music-list-compact">
                        {recentTracks.slice(0, 8).map((song, idx) => (
                            <NeteaseSongRow key={song.id} song={song} index={idx} formatTime={formatTime} onPlay={onPlayNetease} />
                        ))}
                    </div>
                </MusicSection>
            )}

            {hasNetease && (
                playlists.length > 0 ? (
                    <MusicSection title="网易云歌单" action={`${playlists.length} 个`}>
                        <PlaylistGrid playlists={playlists} onOpen={setActivePlaylist} />
                    </MusicSection>
                ) : loading ? (
                    <div className="music-empty"><div className="music-empty-text">加载歌单...</div></div>
                ) : (
                    <div className="music-empty"><div className="music-empty-text">没有云端歌单</div></div>
                )
            )}

        </div>
    );
}

function MusicSection({ title, action, children }: { title: string; action?: string; children: ReactNode }) {
    return (
        <section className="music-section">
            <div className="music-section-head">
                <h3>{title}</h3>
                {action && <span>{action}</span>}
            </div>
            {children}
        </section>
    );
}

function PlaylistGrid({ playlists, onOpen }: { playlists: NeteasePlaylist[]; onOpen: (playlist: NeteasePlaylist) => void }) {
    return (
        <div className="music-playlist-grid">
            {playlists.map(pl => (
                <div key={pl.id} className="music-playlist-card" onClick={() => onOpen(pl)}>
                    <div className="music-playlist-cover">
                        <img src={pl.coverUrl} alt="" />
                        <span className="music-playlist-count">{formatMusicCount(pl.trackCount)}</span>
                    </div>
                    <div className="music-playlist-name">{pl.name}</div>
                </div>
            ))}
        </div>
    );
}

function NeteaseSongRow({ song, index, formatTime, onPlay }: {
    song: NeteaseSearchResult;
    index: number;
    formatTime: (s: number) => string;
    onPlay: (song: NeteaseSearchResult) => void;
}) {
    return (
        <div className="music-song" style={{ animationDelay: `${Math.min(index * 0.04, 0.5)}s` }} onClick={() => onPlay(song)}>
            <div className="music-song-cover">
                {song.coverUrl ? <img src={song.coverUrl} alt="" /> : (
                    <div className="music-song-cover-placeholder">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
                    </div>
                )}
            </div>
            <div className="music-song-info">
                <div className="music-song-title">{song.name}</div>
                <div className="music-song-artist">{song.artists}{song.album ? ` · ${song.album}` : ""}</div>
            </div>
            <div className="music-song-duration">{formatTime(song.duration / 1000)}</div>
        </div>
    );
}

function PlayHistoryRow({ entry, index, formatTime, onPlay }: {
    entry: PlayHistoryEntry;
    index: number;
    formatTime: (s: number) => string;
    onPlay: (entry: PlayHistoryEntry) => void;
}) {
    return (
        <div className="music-song" style={{ animationDelay: `${Math.min(index * 0.04, 0.5)}s` }} onClick={() => onPlay(entry)}>
            <div className="music-song-cover">
                {entry.coverUrl ? <img src={entry.coverUrl} alt="" /> : (
                    <div className="music-song-cover-placeholder">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
                    </div>
                )}
            </div>
            <div className="music-song-info">
                <div className="music-song-title">{entry.title}</div>
                <div className="music-song-artist">{entry.artist}</div>
            </div>
            <div className="music-song-duration">{formatTime(entry.duration)}</div>
        </div>
    );
}

/** Downscale a picked image file to a reasonably sized cover-art data URL. */
function readImageAsCoverDataUrl(file: File, maxSize = 480): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error);
        reader.onload = () => {
            const img = new Image();
            img.onload = () => {
                const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
                const w = Math.max(1, Math.round(img.width * scale));
                const h = Math.max(1, Math.round(img.height * scale));
                const canvas = document.createElement("canvas");
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext("2d");
                if (!ctx) { reject(new Error("no canvas context")); return; }
                ctx.drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL("image/jpeg", 0.85));
            };
            img.onerror = () => reject(new Error("image decode failed"));
            img.src = String(reader.result ?? "");
        };
        reader.readAsDataURL(file);
    });
}

// ── Song List (local) ──
function SongList({ tracks, player, formatTime, onDelete, onPlay, onEdit }: {
    tracks: MusicTrack[];
    player: MusicControlsValue;
    formatTime: (s: number) => string;
    onDelete: (id: string, e: React.MouseEvent) => void;
    onPlay: (t: MusicTrack) => void;
    onEdit: (id: string, updates: Partial<MusicTrack>) => void;
}) {
    const [deleteTarget, setDeleteTarget] = useState<MusicTrack | null>(null);
    const [editTarget, setEditTarget] = useState<MusicTrack | null>(null);
    const [editTitle, setEditTitle] = useState("");
    const [editArtist, setEditArtist] = useState("");
    const [editCover, setEditCover] = useState<string | undefined>(undefined);
    const [editLyrics, setEditLyrics] = useState<string | undefined>(undefined);
    const [editLyricsFileName, setEditLyricsFileName] = useState<string | null>(null);
    const editCoverInputRef = useRef<HTMLInputElement>(null);
    const editLyricsInputRef = useRef<HTMLInputElement>(null);

    const openEdit = (track: MusicTrack, e: React.MouseEvent) => {
        e.stopPropagation();
        setEditTarget(track);
        setEditTitle(track.title);
        setEditArtist(track.artist);
        setEditCover(track.coverUrl);
        setEditLyrics(track.lyrics);
        setEditLyricsFileName(track.lyrics ? "已导入歌词" : null);
    };

    const handleCoverPick = async (files: FileList | null) => {
        const file = files?.[0];
        if (!file) return;
        const dataUrl = await readImageAsCoverDataUrl(file).catch(() => undefined);
        if (dataUrl) setEditCover(dataUrl);
    };

    const handleLyricsPick = async (files: FileList | null) => {
        const file = files?.[0];
        if (!file) return;
        const text = await file.text().catch(() => "");
        if (!text.trim()) return;
        setEditLyrics(text);
        setEditLyricsFileName(file.name);
    };

    const saveEdit = () => {
        if (!editTarget) return;
        const title = editTitle.trim() || editTarget.title;
        const artist = editArtist.trim();
        onEdit(editTarget.id, { title, artist, coverUrl: editCover, lyrics: editLyrics });
        setEditTarget(null);
    };

    return (
        <div className="music-list">
            {tracks.map((track, idx) => {
                const isCurrent = player.currentTrack?.id === track.id;
                return (
                    <div key={track.id} className="music-song" {...(isCurrent ? { "data-playing": "" } : {})} style={{ animationDelay: `${Math.min(idx * 0.04, 0.5)}s` }} onClick={() => onPlay(track)}>
                        <div className="music-song-cover">
                            {track.coverUrl ? <img src={track.coverUrl} alt="" /> : (
                                <div className="music-song-cover-placeholder">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
                                </div>
                            )}
                            {isCurrent && player.isPlaying && (
                                <div className="music-song-playing-overlay">
                                    <div className="music-wave">{[0, 1, 2, 3].map(i => <span key={i} className="music-wave-bar" style={{ animationDelay: `${i * 0.15}s` }} />)}</div>
                                </div>
                            )}
                        </div>
                        <div className="music-song-info">
                            <div className="music-song-title">{track.title}</div>
                            <div className="music-song-artist">{track.artist}</div>
                        </div>
                        <div className="music-song-duration">{formatTime(track.duration)}</div>
                        <div className="music-song-actions">
                            <button className="music-song-action-btn" onClick={(e) => openEdit(track, e)} aria-label="编辑">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
                                </svg>
                            </button>
                            <button className="music-song-action-btn" data-danger="" onClick={(e) => { e.stopPropagation(); setDeleteTarget(track); }} aria-label="删除">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                </svg>
                            </button>
                        </div>
                    </div>
                );
            })}

            {/* Delete confirm modal */}
            {deleteTarget && (
                <div className="music-settings-modal-overlay" onClick={() => setDeleteTarget(null)}>
                    <div className="music-settings-modal-dialog music-confirm-dialog" onClick={e => e.stopPropagation()}>
                        <div className="music-settings-header"><h2>删除确认</h2></div>
                        <div className="music-settings-body">
                            <div className="music-confirm-text">确定删除「{deleteTarget.title}」吗？</div>
                            <div className="music-settings-actions">
                                <button className="music-settings-btn" onClick={() => setDeleteTarget(null)}>取消</button>
                                <button className="music-settings-btn music-settings-btn-danger" onClick={(e) => { onDelete(deleteTarget.id, e); setDeleteTarget(null); }}>删除</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Edit metadata modal */}
            {editTarget && (
                <div className="music-settings-modal-overlay" onClick={() => setEditTarget(null)}>
                    <div className="music-settings-modal-dialog music-edit-dialog" onClick={e => e.stopPropagation()}>
                        <div className="music-settings-header"><h2>编辑歌曲信息</h2></div>
                        <div className="music-settings-body">
                            <button
                                type="button"
                                className="music-edit-cover-picker"
                                onClick={() => editCoverInputRef.current?.click()}
                                aria-label="更换封面"
                            >
                                {editCover ? <img src={editCover} alt="" /> : (
                                    <div className="music-song-cover-placeholder">
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
                                    </div>
                                )}
                                <span className="music-edit-cover-hint">更换封面</span>
                            </button>
                            <input
                                ref={editCoverInputRef}
                                type="file"
                                accept="image/*"
                                style={{ display: "none" }}
                                onChange={(e) => { void handleCoverPick(e.target.files); e.target.value = ""; }}
                            />
                            <label className="music-edit-field">
                                <span>名字</span>
                                <input type="text" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="歌曲名" />
                            </label>
                            <label className="music-edit-field">
                                <span>歌手</span>
                                <input type="text" value={editArtist} onChange={(e) => setEditArtist(e.target.value)} placeholder="歌手名" />
                            </label>
                            <label className="music-edit-field">
                                <span>歌词</span>
                                <button
                                    type="button"
                                    className="music-edit-lyrics-picker"
                                    onClick={() => editLyricsInputRef.current?.click()}
                                >
                                    {editLyricsFileName ?? "导入 .lrc / .txt 歌词文件"}
                                </button>
                                {editLyrics && (
                                    <button
                                        type="button"
                                        className="music-edit-lyrics-clear"
                                        aria-label="移除歌词"
                                        onClick={() => { setEditLyrics(undefined); setEditLyricsFileName(null); }}
                                    >
                                        移除
                                    </button>
                                )}
                            </label>
                            <input
                                ref={editLyricsInputRef}
                                type="file"
                                accept=".lrc,.txt,text/plain"
                                style={{ display: "none" }}
                                onChange={(e) => { void handleLyricsPick(e.target.files); e.target.value = ""; }}
                            />
                            <div className="music-settings-actions">
                                <button className="music-settings-btn" onClick={() => setEditTarget(null)}>取消</button>
                                <button className="music-settings-btn music-settings-btn-primary" onClick={saveEdit}>保存</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}

// ── Online Search Tab ──
function OnlineSearchTab({ player, formatTime, onPlayNetease }: {
    player: MusicControlsValue;
    formatTime: (s: number) => string;
    onPlayNetease: (r: NeteaseSearchResult) => void;
}) {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<NeteaseSearchResult[]>([]);
    const [searching, setSearching] = useState(false);

    const doSearch = async () => {
        if (!query.trim()) return;
        setSearching(true);
        try {
            const r = await searchNetease(query.trim());
            setResults(r);
        } catch { /* ignore */ }
        setSearching(false);
    };

    return (
        <div className="music-search-tab">
            <div className="music-search-bar">
                <input
                    className="music-search-input"
                    placeholder="搜索歌曲、歌手..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && doSearch()}
                />
                <button className="music-search-btn" onClick={doSearch} disabled={searching} title="搜索">
                    {searching ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="music-spin">
                            <line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
                        </svg>
                    ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                        </svg>
                    )}
                </button>
            </div>

            {results.length > 0 ? (
                <div className="music-list">
                    {results.map((r, idx) => (
                        <div key={r.id} className="music-song" style={{ animationDelay: `${Math.min(idx * 0.04, 0.5)}s` }} onClick={() => onPlayNetease(r)}>
                            <div className="music-song-cover">
                                {r.coverUrl ? <img src={r.coverUrl} alt="" /> : (
                                    <div className="music-song-cover-placeholder">
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
                                    </div>
                                )}
                            </div>
                            <div className="music-song-info">
                                <div className="music-song-title">{r.name}</div>
                                <div className="music-song-artist">{r.artists}{r.album ? ` · ${r.album}` : ""}</div>
                            </div>
                            <div className="music-song-duration">{formatTime(r.duration / 1000)}</div>
                        </div>
                    ))}
                </div>
            ) : searching ? (
                <div className="music-empty"><div className="music-empty-text">搜索中...</div></div>
            ) : (
                <div className="music-empty">
                    <div className="music-empty-icon">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                    </div>
                    <div className="music-empty-text">搜索网易云音乐</div>
                </div>
            )}
        </div>
    );
}

// ── Playlists Tab ──
function PlaylistsTab({ player, formatTime, onPlayNetease, onPlayAll, activePlaylist, setActivePlaylist, playlists, loading }: {
    player: MusicControlsValue;
    formatTime: (s: number) => string;
    onPlayNetease: (r: NeteaseSearchResult) => void;
    onPlayAll: (results: NeteaseSearchResult[]) => void;
    activePlaylist: NeteasePlaylist | null;
    setActivePlaylist: (pl: NeteasePlaylist | null) => void;
    playlists: NeteasePlaylist[];
    loading: boolean;
}) {
    const [tracks, setTracks] = useState<NeteaseSearchResult[]>([]);
    const [loadingTracks, setLoadingTracks] = useState(false);

    // Clear tracks when navigating back to playlist list
    useEffect(() => {
        if (!activePlaylist) {
            setTracks([]);
            return;
        }

        let cancelled = false;
        const cacheKey = `music-playlist-tracks-${activePlaylist.id}`;
        try {
            const cached = kvGet(cacheKey);
            if (cached) { setTracks(JSON.parse(cached)); setLoadingTracks(false); }
            else { setLoadingTracks(true); }
        } catch { setLoadingTracks(true); }

        getPlaylistTracks(activePlaylist.id).then((nextTracks) => {
            if (cancelled) return;
            setTracks(nextTracks);
            setLoadingTracks(false);
            if (nextTracks.length > 0) kvSet(cacheKey, JSON.stringify(nextTracks));
        }).catch(() => {
            if (!cancelled) setLoadingTracks(false);
        });

        return () => { cancelled = true; };
    }, [activePlaylist]);

    const openPlaylist = async (pl: NeteasePlaylist) => {
        setActivePlaylist(pl);
    };

    // Showing tracks inside a playlist
    if (activePlaylist) {
        return (
            <div className="music-playlist-detail">
                <div className="music-playlist-detail-header">
                    <div className="music-playlist-detail-name">{activePlaylist.name}<span className="music-playlist-detail-count">{activePlaylist.trackCount}首</span></div>
                    {tracks.length > 0 && (
                        <button className="music-playlist-play-all" onClick={() => onPlayAll(tracks)}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                            <span>播放全部</span>
                        </button>
                    )}
                </div>
                {loadingTracks ? (
                    <div className="music-empty"><div className="music-empty-text">加载中...</div></div>
                ) : (
                    <div className="music-list">
                        {tracks.map((r, idx) => (
                            <div key={r.id} className="music-song" style={{ animationDelay: `${Math.min(idx * 0.03, 0.4)}s` }} onClick={() => onPlayNetease(r)}>
                                <div className="music-song-cover">
                                    {r.coverUrl ? <img src={r.coverUrl} alt="" /> : (
                                        <div className="music-song-cover-placeholder">
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
                                        </div>
                                    )}
                                </div>
                                <div className="music-song-info">
                                    <div className="music-song-title">{r.name}</div>
                                    <div className="music-song-artist">{r.artists}{r.album ? ` · ${r.album}` : ""}</div>
                                </div>
                                <div className="music-song-duration">{formatTime(r.duration / 1000)}</div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    // Playlist grid
    return (
        <div className="music-playlists">
            {loading ? (
                <div className="music-empty"><div className="music-empty-text">加载歌单...</div></div>
            ) : playlists.length === 0 ? (
                <div className="music-empty">
                    <div className="music-empty-icon">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round"><rect x="2" y="3" width="20" height="18" rx="2" /><path d="M8 12h8M8 16h5" /></svg>
                    </div>
                    <div className="music-empty-text">没有歌单</div>
                    <div className="music-empty-text" style={{ fontSize: "calc(11px*var(--app-text-scale,1))", opacity: 0.5 }}>请先在设置中登录网易云账号</div>
                </div>
            ) : (
                <div className="music-playlist-grid">
                    {playlists.map(pl => (
                        <div key={pl.id} className="music-playlist-card" onClick={() => openPlaylist(pl)}>
                            <div className="music-playlist-cover">
                                <img src={pl.coverUrl} alt="" />
                                <span className="music-playlist-count">{pl.trackCount}</span>
                            </div>
                            <div className="music-playlist-name">{pl.name}</div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ── Settings Tab ──
function MusicSettingsTab({ onBack, onSaved }: { onBack: () => void; onSaved: () => void }) {
    const [config, setConfig] = useState<MusicApiConfig>(() => loadMusicApiConfig());
    const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
    const [testing, setTesting] = useState(false);

    // QR login state
    const [qrImg, setQrImg] = useState<string | null>(null);
    const [qrKey, setQrKey] = useState<string | null>(null);
    const [qrStatus, setQrStatus] = useState<string>("");
    const [qrPolling, setQrPolling] = useState(false);
    const [loginNickname, setLoginNickname] = useState<string | null>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Check login status on mount when API is configured
    useEffect(() => {
        const base = config.baseUrl.trim();
        if (!base) return;
        checkLoginStatus(base).then(s => {
            if (s.loggedIn && s.nickname) {
                setLoginNickname(s.nickname);
            }
        });
    }, [config.baseUrl]);

    // Cleanup polling on unmount
    useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

    const handleSave = () => {
        const nextConfig = { ...config, baseUrl: config.baseUrl.trim(), enabled: true };
        saveMusicApiConfig(nextConfig);
        setConfig(nextConfig);
        onSaved();
        onBack();
    };

    const handleTest = async () => {
        if (!config.baseUrl.trim()) return;
        setTesting(true);
        setTestResult(null);
        const result = await testNeteaseConnection(config.baseUrl.trim());
        setTestResult(result);
        setTesting(false);
    };

    const startQrLogin = async () => {
        const base = config.baseUrl.trim();
        if (!base) return;
        setQrStatus("获取二维码...");
        setQrImg(null);
        if (pollRef.current) clearInterval(pollRef.current);

        const key = await getQrKey(base);
        if (!key) { setQrStatus("获取二维码失败"); return; }
        setQrKey(key);

        const img = await getQrImage(base, key);
        if (!img) { setQrStatus("生成二维码失败"); return; }
        setQrImg(img);
        setQrStatus("请用网易云音乐 App 扫码");
        setQrPolling(true);

        pollRef.current = setInterval(async () => {
            const res = await checkQrStatus(base, key);
            if (res.code === 803) {
                // Authorized — save auth cookie for subsequent API calls
                if (res.cookie) saveNeteaseCookie(res.cookie);
                const nextConfig = { ...config, baseUrl: base, enabled: true };
                saveMusicApiConfig(nextConfig);
                setConfig(nextConfig);
                if (pollRef.current) clearInterval(pollRef.current);
                setQrPolling(false);
                setQrImg(null);
                setQrStatus("");
                setLoginNickname(res.nickname || "已登录");
                onSaved();
            } else if (res.code === 802) {
                setQrStatus("已扫码，请在手机上确认");
            } else if (res.code === 800) {
                if (pollRef.current) clearInterval(pollRef.current);
                setQrPolling(false);
                setQrImg(null);
                setQrStatus("二维码已过期，请重新获取");
            }
            // 801 = waiting, do nothing
        }, 2000);
    };

    const handleLogout = () => {
        if (pollRef.current) clearInterval(pollRef.current);
        setQrPolling(false);
        setQrImg(null);
        setQrKey(null);
        setQrStatus("");
        setLoginNickname(null);
        clearNeteaseCookie();
        clearMusicCloudSyncData();
        onSaved();
    };

    return (
        <div className="music-settings">
            <div className="music-settings-header">
                <h2>设置</h2>
                <button className="music-settings-close" onClick={onBack}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
            </div>

            <div className="music-settings-body">
                <div className="music-settings-section">
                    <div className="music-settings-label">网易云 API 地址</div>
                    <div className="music-settings-hint">默认使用公共服务，也可以改成自己的 NeteaseCloudMusicApi 地址</div>
                    <input
                        className="music-settings-input"
                        placeholder="https://your-api.vercel.app"
                        value={config.baseUrl}
                        onChange={(e) => setConfig(prev => ({ ...prev, baseUrl: e.target.value }))}
                    />
                </div>

                <div className="music-settings-actions">
                    <button className="music-settings-btn" onClick={handleTest} disabled={testing || !config.baseUrl.trim()}>
                        {testing ? "测试中..." : "测试连接"}
                    </button>
                    <button className="music-settings-btn music-settings-btn-primary" onClick={handleSave}>
                        保存
                    </button>
                </div>

                {testResult && (
                    <div className={`music-settings-result ${testResult.ok ? "music-settings-result-ok" : "music-settings-result-err"}`}>
                        {testResult.ok ? "✓ " : "✗ "}{testResult.message}
                    </div>
                )}

                {/* QR Login Section */}
                {config.baseUrl.trim() && (
                    <div className="music-settings-section music-qr-section">
                        <div className="music-settings-label">网易云账号登录</div>
                        <div className="music-settings-hint">登录后可播放 VIP 歌曲（需扫码）</div>

                        {loginNickname ? (
                            <div className="music-qr-logged">
                                <span className="music-qr-nickname">{loginNickname}</span>
                                <span className="music-qr-badge">已登录</span>
                            </div>
                        ) : (
                            <>
                                <div className="music-settings-actions" style={{ marginTop: '8px' }}>
                                    <button
                                        className="music-settings-btn"
                                        onClick={startQrLogin}
                                        disabled={qrPolling}
                                    >
                                        {qrPolling ? "等待扫码中..." : "扫码登录"}
                                    </button>
                                </div>

                                {qrImg && (
                                    <div className="music-qr-wrap">
                                        <img src={qrImg} alt="QR Code" className="music-qr-img" />
                                    </div>
                                )}
                            </>
                        )}

                        {qrStatus && <div className="music-qr-status">{qrStatus}</div>}
                    </div>
                )}

                {loginNickname && (
                    <div className="music-settings-actions" style={{ marginTop: 20 }}>
                        <button
                            className="music-settings-btn"
                            onClick={handleLogout}
                        >
                            退出登录
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

function readMusicCache<T>(key: string, fallback: T): T {
    try {
        const raw = kvGet(key);
        if (!raw) return fallback;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && "data" in parsed) return parsed.data as T;
        return parsed as T;
    } catch {
        return fallback;
    }
}

function writeMusicCache<T>(key: string, data: T): void {
    try {
        kvSet(key, JSON.stringify({ data, updatedAt: Date.now() }));
    } catch { /* ignore */ }
}

function formatMusicCount(value: number): string {
    if (!Number.isFinite(value)) return "0";
    if (value >= 10000) return `${Math.round(value / 1000) / 10}万`;
    return String(value);
}

// ── CSS Editor ──
import { MUSIC_CSS_EXAMPLE } from "@/lib/css-examples";
import CSSSchemeBar from "@/components/ui/css-scheme-picker";
import { kvGet, kvSet, kvRemove } from "@/lib/kv-db";

function MusicCssEditor({ onClose, onSave }: { onClose: () => void; onSave: (css: string) => void }) {
    const [css, setCss] = useState(() => kvGet("music-custom-css") || "");

    const handleSave = () => {
        const trimmed = css.trim();
        if (trimmed) kvSet("music-custom-css", trimmed);
        else kvRemove("music-custom-css");
        onSave(trimmed);
        window.dispatchEvent(new CustomEvent("music-css-change", { detail: trimmed }));
        onClose();
    };

    return (
        <div className="music-settings">
            <div className="music-settings-header">
                <h2>自定义样式</h2>
                <button className="music-settings-close" onClick={onClose}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
            </div>
            <div className="music-settings-body">
                <div className="music-settings-hint">输入 CSS 代码，覆盖音乐页面任意样式</div>
                <textarea
                    className="music-settings-input"
                    style={{ height: 280, resize: "none", fontFamily: "'SF Mono', 'Menlo', 'Monaco', monospace", fontSize: "calc(13px*var(--app-text-scale,1))", lineHeight: 1.6, padding: "12px 14px", whiteSpace: "pre-wrap", wordBreak: "break-all" }}
                    value={css}
                    onChange={e => setCss(e.target.value)}
                    placeholder="/* 在此输入自定义 CSS... */"
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                />
                <div className="music-settings-actions">
                    <CSSSchemeBar target="music" currentCSS={css} onLoad={setCss} btnStyle={{
                      border: "1px solid var(--c-music-surface-solid, rgba(255,255,255,0.12))",
                      background: "var(--c-music-surface, rgba(255,255,255,0.06))",
                      color: "var(--c-music-text, #e0d8f0)",
                    }} modalVars={{
                      panel: "var(--c-music-bg, #0c0a1a)",
                      border: "var(--c-music-surface-solid, rgba(255,255,255,0.12))",
                      text: "var(--c-music-text, #e0d8f0)",
                      textDim: "var(--c-music-accent, #b49de8)",
                      input: "var(--c-music-surface, rgba(255,255,255,0.06))",
                      inputBorder: "var(--c-music-surface-solid, rgba(255,255,255,0.12))",
                      accent: "var(--c-music-accent, #b49de8)",
                    }} />
                    <button className="music-settings-btn" onClick={() => setCss(MUSIC_CSS_EXAMPLE)}>示例</button>
                    <button className="music-settings-btn" onClick={() => setCss("")}>清空</button>
                    <button className="music-settings-btn music-settings-btn-primary" onClick={handleSave}>保存</button>
                </div>
            </div>
        </div>
    );
}
