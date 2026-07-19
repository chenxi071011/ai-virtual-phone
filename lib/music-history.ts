// lib/music-history.ts — device-local "recently played" log.
// Records every track actually played on this device, regardless of source
// (local upload or NetEase stream) and regardless of login — this is what
// backs the "我的 → 本地歌单" section, as opposed to NetEase's own cloud-side
// play history which needs an account.

import { kvGet, kvSet } from "./kv-db";

const KEY = "music_play_history_v1";
const MAX_ENTRIES = 100;

export type PlayHistoryEntry = {
    id: string;
    title: string;
    artist: string;
    coverUrl?: string;
    duration: number; // seconds
    source: "local" | "netease";
    playedAt: string; // ISO timestamp
};

export function getPlayHistory(): PlayHistoryEntry[] {
    try {
        const raw = kvGet(KEY);
        if (!raw) return [];
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
    } catch {
        return [];
    }
}

export function recordPlayHistory(entry: Omit<PlayHistoryEntry, "playedAt">): void {
    try {
        const list = getPlayHistory().filter((e) => e.id !== entry.id);
        list.unshift({ ...entry, playedAt: new Date().toISOString() });
        kvSet(KEY, JSON.stringify(list.slice(0, MAX_ENTRIES)));
        if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("music-history-updated"));
        }
    } catch {
        /* ignore */
    }
}
