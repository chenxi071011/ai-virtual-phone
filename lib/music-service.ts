// lib/music-service.ts — Unified music search service (local + Netease Cloud Music API)

import { Capacitor } from "@capacitor/core";
import { loadAllTracks, type MusicTrack } from "./music-storage";
import { kvGet, kvSet, registerKvMigration } from "./kv-db";
import {
    DEFAULT_NETEASE_API_BASE,
    isDefaultNeteaseApiBase,
    normalizeMusicApiBaseUrl,
} from "./music-api-defaults";
import * as neteaseNative from "./netease/endpoints";
import { ensureNeteaseAnonymousToken } from "./netease/anon-token";
export { saveNeteaseCookie, loadNeteaseCookie, clearNeteaseCookie } from "./netease/cookie-store";
import { loadNeteaseCookie } from "./netease/cookie-store";

function isNativeApp(): boolean {
    return Capacitor.isNativePlatform();
}

// ── Netease API Config ──

export type MusicApiConfig = {
    baseUrl: string; // e.g. "https://your-api.vercel.app"
    enabled: boolean;
    version?: number;
};

const MUSIC_API_KEY = "ai_phone_music_api_v1";
const MUSIC_API_CONFIG_VERSION = 2;
const NETEASE_REAL_IP = process.env.NEXT_PUBLIC_NETEASE_REAL_IP || "116.25.146.177";

function normalizeStoredMusicApiBaseUrl(baseUrl: string | undefined): string {
    const normalized = normalizeMusicApiBaseUrl(baseUrl || DEFAULT_NETEASE_API_BASE);
    return isDefaultNeteaseApiBase(normalized) ? DEFAULT_NETEASE_API_BASE : normalized;
}

export function loadMusicApiConfig(): MusicApiConfig {
    if (typeof window === "undefined") return { baseUrl: DEFAULT_NETEASE_API_BASE, enabled: true, version: MUSIC_API_CONFIG_VERSION };
    try {
        const raw = kvGet(MUSIC_API_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as Partial<MusicApiConfig>;
            return {
                baseUrl: normalizeStoredMusicApiBaseUrl(parsed.baseUrl),
                enabled: true,
                version: MUSIC_API_CONFIG_VERSION,
            };
        }
    } catch { /* ignore */ }
    return { baseUrl: DEFAULT_NETEASE_API_BASE, enabled: true, version: MUSIC_API_CONFIG_VERSION };
}

export function saveMusicApiConfig(config: MusicApiConfig): void {
    try {
        kvSet(MUSIC_API_KEY, JSON.stringify({
            baseUrl: normalizeStoredMusicApiBaseUrl(config.baseUrl),
            enabled: true,
            version: MUSIC_API_CONFIG_VERSION,
        }));
    } catch { /* ignore */ }
}

export function isNeteaseConfigured(): boolean {
    const cfg = loadMusicApiConfig();
    return !!cfg.baseUrl.trim();
}

/** Append saved cookie and mainland realIP to a Netease API URL as query parameters. */
function withNeteaseParams(url: string): string {
    const cookie = loadNeteaseCookie();
    try {
        const parsed = new URL(url);
        if (!parsed.searchParams.has("realIP")) parsed.searchParams.set("realIP", NETEASE_REAL_IP);
        if (cookie && !parsed.searchParams.has("cookie")) parsed.searchParams.set("cookie", cookie);
        return parsed.toString();
    } catch {
        const params: string[] = [];
        if (!/[?&]realIP=/.test(url)) params.push(`realIP=${encodeURIComponent(NETEASE_REAL_IP)}`);
        if (cookie && !/[?&]cookie=/.test(url)) params.push(`cookie=${encodeURIComponent(cookie)}`);
        if (params.length === 0) return url;
        return `${url}${url.includes("?") ? "&" : "?"}${params.join("&")}`;
    }
}

// ── Netease API Types ──

export type NeteaseSearchResult = {
    id: number;
    name: string;
    artists: string;
    album: string;
    duration: number; // ms
    coverUrl?: string;
};

export type NeteasePlaylistDetail = NeteasePlaylist & {
    description?: string;
    tags?: string[];
    playCount?: number;
    subscribedCount?: number;
    commentCount?: number;
    shareCount?: number;
};

export type NeteaseHotSearch = {
    keyword: string;
    score?: number;
    content?: string;
    iconType?: number;
};

export type NeteaseComment = {
    id: number;
    userName: string;
    avatarUrl?: string;
    content: string;
    likedCount: number;
    time: number;
};

export type NeteaseToplist = NeteasePlaylist & {
    updateFrequency?: string;
    tracks?: Array<{ first: string; second: string }>;
};

function mapSongToSearchResult(s: any): NeteaseSearchResult {
    return {
        id: s.id,
        name: s.name || "",
        artists: (s.ar || s.artists || []).map((a: any) => a.name).filter(Boolean).join("/"),
        album: s.al?.name || s.album?.name || "",
        duration: s.dt || s.duration || 0,
        coverUrl: secureHttpUrl(s.al?.picUrl || s.album?.picUrl),
    };
}

// Netease returns http:// asset links (covers, audio); on the HTTPS site those
// trigger mixed-content warnings/blocks. Their CDN serves https fine.
function secureHttpUrl(url: string): string;
function secureHttpUrl(url: string | undefined): string | undefined;
function secureHttpUrl(url: string | undefined): string | undefined {
    return typeof url === "string" ? url.replace(/^http:\/\//, "https://") : url;
}

// ── API Calls ──

function neteaseBase(): string {
    const cfg = loadMusicApiConfig();
    const base = normalizeMusicApiBaseUrl(cfg.baseUrl);
    if (!base) return "";
    return base;
}

function resolveNeteaseRequestBase(baseUrl: string): string {
    const base = normalizeMusicApiBaseUrl(baseUrl || DEFAULT_NETEASE_API_BASE);
    return base;
}

/** Search songs via Netease API */
export async function searchNetease(query: string, limit = 20): Promise<NeteaseSearchResult[]> {
    if (isNativeApp()) {
        try {
            await ensureNeteaseAnonymousToken();
            const data = await neteaseNative.cloudSearch(query, limit);
            const songs = data?.result?.songs;
            return Array.isArray(songs) ? songs.map(mapSongToSearchResult) : [];
        } catch (e) {
            console.warn("[MusicService] Native Netease search failed:", e);
            return [];
        }
    }
    const base = neteaseBase();
    if (!base) return [];
    try {
        const resp = await fetch(withNeteaseParams(`${base}/cloudsearch?keywords=${encodeURIComponent(query)}&limit=${limit}`));
        const data = await resp.json();
        const songs = data?.result?.songs;
        if (!Array.isArray(songs)) return [];
        return songs.map(mapSongToSearchResult);
    } catch (e) {
        console.warn("[MusicService] Netease search failed:", e);
        return [];
    }
}

/** Get playable URL for a Netease song */
export async function getNeteasePlayUrl(songId: number): Promise<string | null> {
    if (isNativeApp()) {
        try {
            await ensureNeteaseAnonymousToken();
            const data = await neteaseNative.songUrl(songId);
            const url = data?.data?.[0]?.url;
            return typeof url === "string" ? url.replace(/^http:\/\//, "https://") : null;
        } catch (e) {
            console.warn("[MusicService] Native get play URL failed:", e);
            return null;
        }
    }
    const base = neteaseBase();
    if (!base) return null;
    try {
        const resp = await fetch(withNeteaseParams(`${base}/song/url?id=${songId}`));
        const data = await resp.json();
        const url = data?.data?.[0]?.url;
        if (!url || typeof url !== "string") return null;
        // Netease returns http:// CDN links; on an HTTPS page the browser blocks
        // them as mixed content, so the audio never loads. The CDN serves https.
        return url.replace(/^http:\/\//, "https://");
    } catch (e) {
        console.warn("[MusicService] Get play URL failed:", e);
        return null;
    }
}

/** Get lyrics for a Netease song */
export async function getNeteaseLyrics(songId: number): Promise<string> {
    if (isNativeApp()) {
        try {
            await ensureNeteaseAnonymousToken();
            const data = await neteaseNative.lyric(songId);
            return data?.lrc?.lyric || "";
        } catch {
            return "";
        }
    }
    const base = neteaseBase();
    if (!base) return "";
    try {
        const resp = await fetch(withNeteaseParams(`${base}/lyric?id=${songId}`));
        const data = await resp.json();
        return data?.lrc?.lyric || "";
    } catch {
        return "";
    }
}

/** Get song detail (cover, etc.) */
export async function getNeteaseSongDetail(songId: number): Promise<{ coverUrl?: string; name?: string; artists?: string } | null> {
    if (isNativeApp()) {
        try {
            await ensureNeteaseAnonymousToken();
            const data = await neteaseNative.songDetail([songId]);
            const song = data?.songs?.[0];
            if (!song) return null;
            return {
                coverUrl: secureHttpUrl(song.al?.picUrl),
                name: song.name,
                artists: (song.ar || []).map((a: any) => a.name).join("/"),
            };
        } catch {
            return null;
        }
    }
    const base = neteaseBase();
    if (!base) return null;
    try {
        const resp = await fetch(withNeteaseParams(`${base}/song/detail?ids=${songId}`));
        const data = await resp.json();
        const song = data?.songs?.[0];
        if (!song) return null;
        return {
            coverUrl: secureHttpUrl(song.al?.picUrl),
            name: song.name,
            artists: (song.ar || []).map((a: any) => a.name).join("/"),
        };
    } catch {
        return null;
    }
}

// ── QR Login ──

export async function getQrKey(baseUrl: string): Promise<string | null> {
    if (isNativeApp()) {
        try {
            await ensureNeteaseAnonymousToken();
            return await neteaseNative.qrKey();
        } catch { return null; }
    }
    try {
        const url = resolveNeteaseRequestBase(baseUrl);
        const resp = await fetch(withNeteaseParams(`${url}/login/qr/key?timestamp=${Date.now()}`));
        const data = await resp.json();
        return data?.data?.unikey || null;
    } catch { return null; }
}

export async function getQrImage(baseUrl: string, key: string): Promise<string | null> {
    if (isNativeApp()) {
        try { return await neteaseNative.qrImage(key); } catch { return null; }
    }
    try {
        const url = resolveNeteaseRequestBase(baseUrl);
        const resp = await fetch(withNeteaseParams(`${url}/login/qr/create?key=${key}&qrimg=true&timestamp=${Date.now()}`));
        const data = await resp.json();
        return data?.data?.qrimg || null;
    } catch { return null; }
}

/** Check QR scan status: 800=expired, 801=waiting, 802=scanned, 803=authorized */
export async function checkQrStatus(baseUrl: string, key: string): Promise<{ code: number; message: string; nickname?: string; cookie?: string }> {
    if (isNativeApp()) {
        try {
            const res = await neteaseNative.qrCheck(key);
            return { code: res.code, message: res.message || "", nickname: res.nickname, cookie: res.cookie };
        } catch (e) {
            return { code: 0, message: e instanceof Error ? e.message : "检查失败" };
        }
    }
    try {
        const url = resolveNeteaseRequestBase(baseUrl);
        const resp = await fetch(withNeteaseParams(`${url}/login/qr/check?key=${key}&timestamp=${Date.now()}`));
        const data = await resp.json();
        return { code: data?.code || 0, message: data?.message || "", nickname: data?.profile?.nickname, cookie: data?.cookie };
    } catch (e) {
        return { code: 0, message: e instanceof Error ? e.message : "检查失败" };
    }
}

/** Check current login status */
export async function checkLoginStatus(baseUrl: string): Promise<{ loggedIn: boolean; nickname?: string }> {
    if (isNativeApp()) {
        try {
            const data = await neteaseNative.loginStatus();
            const profile = data?.data?.profile;
            if (profile?.nickname) return { loggedIn: true, nickname: profile.nickname };
            return { loggedIn: false };
        } catch { return { loggedIn: false }; }
    }
    try {
        const url = resolveNeteaseRequestBase(baseUrl);
        const resp = await fetch(withNeteaseParams(`${url}/login/status?timestamp=${Date.now()}`));
        const data = await resp.json();
        const profile = data?.data?.profile;
        if (profile?.nickname) return { loggedIn: true, nickname: profile.nickname };
        return { loggedIn: false };
    } catch { return { loggedIn: false }; }
}

// ── User Playlists ──

export type NeteasePlaylist = {
    id: number;
    name: string;
    coverUrl: string;
    trackCount: number;
    creator: string;
};

/** Get current logged-in user's uid */
async function getLoginUid(): Promise<number | null> {
    if (isNativeApp()) {
        try {
            const data = await neteaseNative.loginStatus();
            return data?.data?.profile?.userId || null;
        } catch { return null; }
    }
    const base = neteaseBase();
    if (!base) return null;
    try {
        const resp = await fetch(withNeteaseParams(`${base}/login/status?timestamp=${Date.now()}`));
        const data = await resp.json();
        return data?.data?.profile?.userId || null;
    } catch { return null; }
}

/** Fetch user's playlists */
export async function getUserPlaylists(): Promise<NeteasePlaylist[]> {
    if (isNativeApp()) {
        const uid = await getLoginUid();
        if (!uid) return [];
        try {
            const data = await neteaseNative.userPlaylist(uid);
            return (data?.playlist || []).map((p: any) => ({
                id: p.id,
                name: p.name,
                coverUrl: secureHttpUrl(p.coverImgUrl),
                trackCount: p.trackCount,
                creator: p.creator?.nickname || "",
            }));
        } catch { return []; }
    }
    const base = neteaseBase();
    if (!base) return [];
    const uid = await getLoginUid();
    if (!uid) return [];
    try {
        const resp = await fetch(withNeteaseParams(`${base}/user/playlist?uid=${uid}&timestamp=${Date.now()}`));
        const data = await resp.json();
        return (data?.playlist || []).map((p: any) => ({
            id: p.id,
            name: p.name,
            coverUrl: secureHttpUrl(p.coverImgUrl),
            trackCount: p.trackCount,
            creator: p.creator?.nickname || "",
        }));
    } catch { return []; }
}

/** Fetch tracks in a playlist */
export async function getPlaylistTracks(playlistId: number): Promise<NeteaseSearchResult[]> {
    if (isNativeApp()) {
        try {
            const data = await neteaseNative.playlistTrackAll(playlistId);
            return (data?.songs || []).map(mapSongToSearchResult);
        } catch { return []; }
    }
    const base = neteaseBase();
    if (!base) return [];
    try {
        const resp = await fetch(withNeteaseParams(`${base}/playlist/track/all?id=${playlistId}&timestamp=${Date.now()}`));
        const data = await resp.json();
        return (data?.songs || []).map(mapSongToSearchResult);
    } catch { return []; }
}

export async function getDailyRecommendSongs(): Promise<NeteaseSearchResult[]> {
    if (isNativeApp()) {
        try {
            const data = await neteaseNative.recommendSongs();
            const songs = data?.data?.dailySongs || data?.recommend || [];
            return Array.isArray(songs) ? songs.map(mapSongToSearchResult) : [];
        } catch { return []; }
    }
    const base = neteaseBase();
    if (!base) return [];
    try {
        const resp = await fetch(withNeteaseParams(`${base}/recommend/songs?timestamp=${Date.now()}`));
        const data = await resp.json();
        const songs = data?.data?.dailySongs || data?.recommend || [];
        return Array.isArray(songs) ? songs.map(mapSongToSearchResult) : [];
    } catch { return []; }
}

export async function getPersonalFm(): Promise<NeteaseSearchResult[]> {
    if (isNativeApp()) {
        try {
            const data = await neteaseNative.personalFm();
            const songs = data?.data || [];
            return Array.isArray(songs) ? songs.map(mapSongToSearchResult) : [];
        } catch { return []; }
    }
    const base = neteaseBase();
    if (!base) return [];
    try {
        const resp = await fetch(withNeteaseParams(`${base}/personal_fm?timestamp=${Date.now()}`));
        const data = await resp.json();
        const songs = data?.data || [];
        return Array.isArray(songs) ? songs.map(mapSongToSearchResult) : [];
    } catch { return []; }
}

export async function getPersonalizedPlaylists(limit = 12): Promise<NeteasePlaylist[]> {
    if (isNativeApp()) {
        try {
            const data = await neteaseNative.personalized(limit);
            return (data?.result || []).map((p: any) => ({
                id: p.id,
                name: p.name,
                coverUrl: secureHttpUrl(p.picUrl || p.coverImgUrl),
                trackCount: p.trackCount || 0,
                creator: p.creator?.nickname || "",
            }));
        } catch { return []; }
    }
    const base = neteaseBase();
    if (!base) return [];
    try {
        const resp = await fetch(withNeteaseParams(`${base}/personalized?limit=${limit}&timestamp=${Date.now()}`));
        const data = await resp.json();
        return (data?.result || []).map((p: any) => ({
            id: p.id,
            name: p.name,
            coverUrl: secureHttpUrl(p.picUrl || p.coverImgUrl),
            trackCount: p.trackCount || 0,
            creator: p.creator?.nickname || "",
        }));
    } catch { return []; }
}

export async function getRecommendResource(): Promise<NeteasePlaylist[]> {
    if (isNativeApp()) {
        try {
            const data = await neteaseNative.recommendResource();
            return (data?.recommend || []).map((p: any) => ({
                id: p.id,
                name: p.name,
                coverUrl: secureHttpUrl(p.picUrl || p.coverImgUrl),
                trackCount: p.trackCount || 0,
                creator: p.creator?.nickname || "",
            }));
        } catch { return []; }
    }
    const base = neteaseBase();
    if (!base) return [];
    try {
        const resp = await fetch(withNeteaseParams(`${base}/recommend/resource?timestamp=${Date.now()}`));
        const data = await resp.json();
        return (data?.recommend || []).map((p: any) => ({
            id: p.id,
            name: p.name,
            coverUrl: secureHttpUrl(p.picUrl || p.coverImgUrl),
            trackCount: p.trackCount || 0,
            creator: p.creator?.nickname || "",
        }));
    } catch { return []; }
}

export async function getHotSearchDetail(): Promise<NeteaseHotSearch[]> {
    if (isNativeApp()) {
        try {
            const data = await neteaseNative.hotSearchDetail();
            return (data?.data || []).map((item: any) => ({
                keyword: item.searchWord || item.keyword || "",
                score: item.score,
                content: item.content,
                iconType: item.iconType,
            })).filter((item: NeteaseHotSearch) => item.keyword);
        } catch { return []; }
    }
    const base = neteaseBase();
    if (!base) return [];
    try {
        const resp = await fetch(withNeteaseParams(`${base}/search/hot/detail?timestamp=${Date.now()}`));
        const data = await resp.json();
        return (data?.data || []).map((item: any) => ({
            keyword: item.searchWord || item.keyword || "",
            score: item.score,
            content: item.content,
            iconType: item.iconType,
        })).filter((item: NeteaseHotSearch) => item.keyword);
    } catch { return []; }
}

export async function getToplists(): Promise<NeteaseToplist[]> {
    if (isNativeApp()) {
        try {
            const data = await neteaseNative.toplistDetail();
            return (data?.list || []).map((p: any) => ({
                id: p.id,
                name: p.name,
                coverUrl: secureHttpUrl(p.coverImgUrl),
                trackCount: p.trackCount || p.tracks?.length || 0,
                creator: "",
                updateFrequency: p.updateFrequency,
                tracks: Array.isArray(p.tracks) ? p.tracks.slice(0, 3).map((t: any) => ({
                    first: t.first || "",
                    second: t.second || "",
                })) : [],
            }));
        } catch { return []; }
    }
    const base = neteaseBase();
    if (!base) return [];
    try {
        const resp = await fetch(withNeteaseParams(`${base}/toplist/detail?timestamp=${Date.now()}`));
        const data = await resp.json();
        return (data?.list || []).map((p: any) => ({
            id: p.id,
            name: p.name,
            coverUrl: secureHttpUrl(p.coverImgUrl),
            trackCount: p.trackCount || p.tracks?.length || 0,
            creator: "",
            updateFrequency: p.updateFrequency,
            tracks: Array.isArray(p.tracks) ? p.tracks.slice(0, 3).map((t: any) => ({
                first: t.first || "",
                second: t.second || "",
            })) : [],
        }));
    } catch { return []; }
}

export async function getPlaylistDetail(playlistId: number): Promise<NeteasePlaylistDetail | null> {
    if (isNativeApp()) {
        try {
            const data = await neteaseNative.playlistDetail(playlistId);
            const p = data?.playlist;
            if (!p) return null;
            return {
                id: p.id,
                name: p.name,
                coverUrl: secureHttpUrl(p.coverImgUrl),
                trackCount: p.trackCount || 0,
                creator: p.creator?.nickname || "",
                description: p.description || "",
                tags: Array.isArray(p.tags) ? p.tags : [],
                playCount: p.playCount,
                subscribedCount: p.subscribedCount,
                commentCount: p.commentCount,
                shareCount: p.shareCount,
            };
        } catch { return null; }
    }
    const base = neteaseBase();
    if (!base) return null;
    try {
        const resp = await fetch(withNeteaseParams(`${base}/playlist/detail?id=${playlistId}&timestamp=${Date.now()}`));
        const data = await resp.json();
        const p = data?.playlist;
        if (!p) return null;
        return {
            id: p.id,
            name: p.name,
            coverUrl: secureHttpUrl(p.coverImgUrl),
            trackCount: p.trackCount || 0,
            creator: p.creator?.nickname || "",
            description: p.description || "",
            tags: Array.isArray(p.tags) ? p.tags : [],
            playCount: p.playCount,
            subscribedCount: p.subscribedCount,
            commentCount: p.commentCount,
            shareCount: p.shareCount,
        };
    } catch { return null; }
}

export async function getSongComments(songId: number, limit = 20): Promise<NeteaseComment[]> {
    if (isNativeApp()) {
        try {
            const data = await neteaseNative.commentMusic(songId, limit);
            const comments = data?.hotComments?.length ? data.hotComments : data?.comments || [];
            return comments.map((c: any) => ({
                id: c.commentId,
                userName: c.user?.nickname || "网易云用户",
                avatarUrl: c.user?.avatarUrl,
                content: c.content || "",
                likedCount: c.likedCount || 0,
                time: c.time || 0,
            })).filter((c: NeteaseComment) => c.content);
        } catch { return []; }
    }
    const base = neteaseBase();
    if (!base) return [];
    try {
        const resp = await fetch(withNeteaseParams(`${base}/comment/music?id=${songId}&limit=${limit}&timestamp=${Date.now()}`));
        const data = await resp.json();
        const comments = data?.hotComments?.length ? data.hotComments : data?.comments || [];
        return comments.map((c: any) => ({
            id: c.commentId,
            userName: c.user?.nickname || "网易云用户",
            avatarUrl: c.user?.avatarUrl,
            content: c.content || "",
            likedCount: c.likedCount || 0,
            time: c.time || 0,
        })).filter((c: NeteaseComment) => c.content);
    } catch { return []; }
}

export async function getUserRecord(type: 0 | 1 = 1): Promise<NeteaseSearchResult[]> {
    if (isNativeApp()) {
        const uid = await getLoginUid();
        if (!uid) return [];
        try {
            const data = await neteaseNative.userRecord(uid, type);
            const records = data?.weekData || data?.allData || [];
            return Array.isArray(records) ? records.map((r: any) => mapSongToSearchResult(r.song)).filter((s: NeteaseSearchResult) => s.id) : [];
        } catch { return []; }
    }
    const base = neteaseBase();
    if (!base) return [];
    const uid = await getLoginUid();
    if (!uid) return [];
    try {
        const resp = await fetch(withNeteaseParams(`${base}/user/record?uid=${uid}&type=${type}&timestamp=${Date.now()}`));
        const data = await resp.json();
        const records = data?.weekData || data?.allData || [];
        return Array.isArray(records) ? records.map((r: any) => mapSongToSearchResult(r.song)).filter((s: NeteaseSearchResult) => s.id) : [];
    } catch { return []; }
}

// ── Track-to-Playlist mapping (localStorage) ──

const TRACK_PLAYLIST_MAP_KEY = "ai_phone_track_playlist_map_v1";
registerKvMigration(MUSIC_API_KEY);
registerKvMigration(TRACK_PLAYLIST_MAP_KEY);

/** Load {neteaseTrackId → playlistId} mapping */
export function loadTrackPlaylistMap(): Record<string, number> {
    try {
        const raw = kvGet(TRACK_PLAYLIST_MAP_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
}

function saveTrackPlaylistMap(map: Record<string, number>): void {
    try { kvSet(TRACK_PLAYLIST_MAP_KEY, JSON.stringify(map)); } catch { /* ignore */ }
}

export function recordTrackPlaylist(trackId: number, playlistId: number): void {
    const map = loadTrackPlaylistMap();
    map[String(trackId)] = playlistId;
    saveTrackPlaylistMap(map);
}

export function removeTrackPlaylistRecord(trackId: number): void {
    const map = loadTrackPlaylistMap();
    delete map[String(trackId)];
    saveTrackPlaylistMap(map);
}

export function getTrackPlaylistId(trackId: number): number | null {
    const map = loadTrackPlaylistMap();
    return map[String(trackId)] ?? null;
}

/** Add tracks to a Netease playlist */
export async function addTracksToPlaylist(playlistId: number, trackIds: number[]): Promise<{ ok: boolean; message: string }> {
    const base = neteaseBase();
    if (!base) return { ok: false, message: "API 未配置" };
    try {
        const resp = await fetch(withNeteaseParams(`${base}/playlist/tracks?op=add&pid=${playlistId}&tracks=${trackIds.join(",")}&timestamp=${Date.now()}`));
        const data = await resp.json();
        if (data?.body?.code === 200 || data?.status === 200 || data?.code === 200) {
            return { ok: true, message: "已添加到歌单" };
        }
        if (data?.body?.code === 502) {
            return { ok: false, message: "歌曲已在歌单中" };
        }
        return { ok: false, message: data?.body?.message || data?.message || "添加失败" };
    } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : "添加失败" };
    }
}

/** Remove tracks from a Netease playlist */
export async function removeTracksFromPlaylist(playlistId: number, trackIds: number[]): Promise<{ ok: boolean; message: string }> {
    const base = neteaseBase();
    if (!base) return { ok: false, message: "API 未配置" };
    try {
        const resp = await fetch(withNeteaseParams(`${base}/playlist/tracks?op=del&pid=${playlistId}&tracks=${trackIds.join(",")}&timestamp=${Date.now()}`));
        const data = await resp.json();
        if (data?.body?.code === 200 || data?.status === 200 || data?.code === 200) {
            return { ok: true, message: "已从歌单移除" };
        }
        return { ok: false, message: data?.body?.message || data?.message || "移除失败" };
    } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : "移除失败" };
    }
}

/** Test Netease API connection */
export async function testNeteaseConnection(baseUrl: string): Promise<{ ok: boolean; message: string }> {
    try {
        const url = resolveNeteaseRequestBase(baseUrl);
        const resp = await fetch(withNeteaseParams(`${url}/search?keywords=test&limit=1`), { signal: AbortSignal.timeout(20000) });
        if (!resp.ok) return { ok: false, message: `HTTP ${resp.status}` };
        const data = await resp.json();
        if (data?.result?.songs) return { ok: true, message: "连接成功" };
        return { ok: false, message: "返回格式异常" };
    } catch (e) {
        if (e instanceof DOMException && (e.name === "AbortError" || e.name === "TimeoutError")) {
            return { ok: false, message: "连接超时，可能是服务冷启动或网络较慢" };
        }
        return { ok: false, message: e instanceof Error ? e.message : "连接失败" };
    }
}

// ── Unified Search ──

export type UnifiedSearchResult = {
    source: "local" | "netease";
    localTrack?: MusicTrack;
    neteaseResult?: NeteaseSearchResult;
    title: string;
    artist: string;
};

/** Search local library first, then Netease */
export async function unifiedSearch(query: string): Promise<UnifiedSearchResult[]> {
    const results: UnifiedSearchResult[] = [];
    const q = query.toLowerCase();

    // 1. Local search
    try {
        const tracks = await loadAllTracks();
        for (const t of tracks) {
            if (t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q)) {
                results.push({ source: "local", localTrack: t, title: t.title, artist: t.artist });
            }
        }
    } catch { /* ignore */ }

    // 2. Netease search (if configured)
    if (isNeteaseConfigured()) {
        try {
            const online = await searchNetease(query, 15);
            for (const s of online) {
                results.push({ source: "netease", neteaseResult: s, title: s.name, artist: s.artists });
            }
        } catch { /* ignore */ }
    }

    return results;
}

/** Search for a specific song (by title-artist) and return the best match */
export async function findBestMatch(title: string, artist?: string): Promise<UnifiedSearchResult | null> {
    const query = artist ? `${title} ${artist}` : title;
    const results = await unifiedSearch(query);
    if (results.length === 0) return null;

    // Prefer local exact match
    const titleLower = title.toLowerCase();
    const localExact = results.find(r => r.source === "local" && r.title.toLowerCase() === titleLower);
    if (localExact) return localExact;

    // Return first result (local results come first)
    return results[0];
}

/**
 * Find best PLAYABLE match — tries each result until one has a valid play URL.
 * Falls back to findBestMatch if all fail.
 */
export async function findPlayableMatch(title: string, _artist?: string): Promise<{ result: UnifiedSearchResult; playUrl?: string } | null> {
    const results = await unifiedSearch(title);
    if (results.length === 0) return null;

    // Local tracks are always playable
    const titleLower = title.toLowerCase();
    const localExact = results.find(r => r.source === "local" && r.title.toLowerCase() === titleLower);
    if (localExact) return { result: localExact };
    const localAny = results.find(r => r.source === "local");
    if (localAny) return { result: localAny };

    // Try netease results one by one until we find a playable URL
    const neteaseResults = results.filter(r => r.source === "netease" && r.neteaseResult);
    for (const r of neteaseResults.slice(0, 5)) {
        const url = await getNeteasePlayUrl(r.neteaseResult!.id);
        if (url) return { result: r, playUrl: url };
    }

    return null;
}
