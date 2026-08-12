// lib/music-storage.ts — IndexedDB local music storage (audio blobs + metadata)

import { openIndexedDbAtLeast } from "./idb-open";
import { appNowISO } from "./app-clock";

export type MusicTrack = {
    id: string;
    title: string;
    artist: string;
    album?: string;
    duration: number;        // seconds
    coverUrl?: string;       // data URL or blob URL
    lyrics?: string;         // LRC format or plain text
    liked: boolean;
    addedAt: string;         // ISO timestamp
    lastPlayedAt?: string;   // ISO timestamp
};

// ── IndexedDB Setup ──

const DB_NAME = "ai_phone_music_db_v1";
const DB_VERSION = 2;
const META_STORE = "tracks";
const AUDIO_STORE = "audio_blobs";

function openDb(): Promise<IDBDatabase | null> {
    if (typeof window === "undefined") return Promise.resolve(null);
    // Open at >= DB_VERSION: a backup restore may have bumped the stored version
    // higher, and opening at a fixed lower version would throw a VersionError.
    return openIndexedDbAtLeast(DB_NAME, DB_VERSION, (db) => {
        if (!db.objectStoreNames.contains(META_STORE)) {
            db.createObjectStore(META_STORE, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(AUDIO_STORE)) {
            db.createObjectStore(AUDIO_STORE);
        }
    }).catch((err) => { console.warn("[Music] DB open error:", err); return null; });
}

function runRequest<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

// ── CRUD ──

export async function loadAllTracks(): Promise<MusicTrack[]> {
    const db = await openDb();
    if (!db) return [];
    const tx = db.transaction(META_STORE, "readonly");
    const tracks: MusicTrack[] = await runRequest(tx.objectStore(META_STORE).getAll());
    tracks.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
    return tracks;
}

export async function saveTrack(track: MusicTrack, audioBlob: Blob): Promise<void> {
    const db = await openDb();
    if (!db) return;
    const tx = db.transaction([META_STORE, AUDIO_STORE], "readwrite");
    tx.objectStore(META_STORE).put(track);
    tx.objectStore(AUDIO_STORE).put(audioBlob, track.id);
    await new Promise<void>((res, rej) => {
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
    });
}

export async function deleteTrack(trackId: string): Promise<void> {
    const db = await openDb();
    if (!db) return;
    const tx = db.transaction([META_STORE, AUDIO_STORE], "readwrite");
    tx.objectStore(META_STORE).delete(trackId);
    tx.objectStore(AUDIO_STORE).delete(trackId);
    await new Promise<void>((res, rej) => {
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
    });
}

export async function getAudioBlob(trackId: string): Promise<Blob | null> {
    const db = await openDb();
    if (!db) return null;
    const tx = db.transaction(AUDIO_STORE, "readonly");
    const blob = await runRequest(tx.objectStore(AUDIO_STORE).get(trackId));
    return blob instanceof Blob ? blob : null;
}

export async function updateTrackMeta(trackId: string, updates: Partial<MusicTrack>): Promise<void> {
    const db = await openDb();
    if (!db) return;
    const tx = db.transaction(META_STORE, "readwrite");
    const store = tx.objectStore(META_STORE);
    const existing: MusicTrack | undefined = await runRequest(store.get(trackId));
    if (!existing) return;
    store.put({ ...existing, ...updates, id: trackId });
    await new Promise<void>((res, rej) => {
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
    });
}

export async function markTrackPlayed(trackId: string, playedAt = appNowISO()): Promise<void> {
    await updateTrackMeta(trackId, { lastPlayedAt: playedAt });
}

export async function toggleLike(trackId: string): Promise<boolean> {
    const db = await openDb();
    if (!db) return false;
    const tx = db.transaction(META_STORE, "readwrite");
    const store = tx.objectStore(META_STORE);
    const track: MusicTrack | undefined = await runRequest(store.get(trackId));
    if (!track) return false;
    track.liked = !track.liked;
    store.put(track);
    await new Promise<void>((res, rej) => {
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
    });
    return track.liked;
}

// ── Helpers ──

export function generateTrackId(): string {
    return `trk_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Parse filename into title and artist: "Artist - Title.mp3" */
export function parseFilename(filename: string): { title: string; artist: string } {
    const name = filename.replace(/\.[^.]+$/, "").trim();
    const sep = name.indexOf(" - ");
    if (sep > 0) {
        return { artist: name.slice(0, sep).trim(), title: name.slice(sep + 3).trim() };
    }
    return { title: name, artist: "未知歌手" };
}

/** Get audio duration from a blob */
export function getAudioDuration(blob: Blob): Promise<number> {
    return new Promise((resolve) => {
        const audio = new Audio();
        audio.addEventListener("loadedmetadata", () => {
            resolve(audio.duration || 0);
            URL.revokeObjectURL(audio.src);
        });
        audio.addEventListener("error", () => {
            resolve(0);
            URL.revokeObjectURL(audio.src);
        });
        audio.src = URL.createObjectURL(blob);
    });
}
