import { DEFAULT_THEME_PROFILE, normalizeThemeProfile, type ThemeAssetType, type ThemeProfile } from "@/lib/theme-types";
import { kvGet, kvSet, kvRemove, registerKvMigration } from "./kv-db";
import { openIndexedDbAtLeast } from "./idb-open";

export const THEME_PROFILE_STORAGE_KEY = "ai_phone_theme_profile_v1";
registerKvMigration(THEME_PROFILE_STORAGE_KEY);

const THEME_DB_NAME = "ai_phone_theme_db_v1";
const THEME_DB_VERSION = 2;
const THEME_ASSET_STORE = "assets";
const IMAGE_MAX_DIMENSION = 2200;
const IMAGE_TARGET_SIZE_BYTES = 2 * 1024 * 1024;
/**
 * 动图（GIF）不经 canvas 重编码，会原样落库，因此单独限制体积。
 * dataUrl 存储比原文件再大约 1/3，超过这个阈值应让用户换图而不是静默拍平成静帧。
 */
export const ANIMATED_ASSET_MAX_BYTES = 3 * 1024 * 1024;

/** 动图体积超限：调用方应提示用户换一张更小的图。 */
export class AnimatedAssetTooLargeError extends Error {
  constructor() {
    super("动图体积超出限制");
    this.name = "AnimatedAssetTooLargeError";
  }
}

/** 该 blob 是否是必须保留原始编码的动图格式。 */
export function isAnimatedImageBlob(blob: Blob): boolean {
  return (blob.type || "").toLowerCase() === "image/gif";
}

/** 上传前预检：返回给用户看的错误文案，通过则返回 null。 */
export function checkAnimatedAssetSize(blob: Blob): string | null {
  if (!isAnimatedImageBlob(blob)) return null;
  if (blob.size <= ANIMATED_ASSET_MAX_BYTES) return null;
  const limitMb = Math.round(ANIMATED_ASSET_MAX_BYTES / (1024 * 1024));
  return `GIF 需小于 ${limitMb}MB（当前 ${(blob.size / (1024 * 1024)).toFixed(1)}MB），请换一张`;
}

/** 把上传异常翻译成给用户看的文案。 */
export function describeAssetSaveError(error: unknown, fallback = "上传失败，请重试"): string {
  if (error instanceof AnimatedAssetTooLargeError) {
    const limitMb = Math.round(ANIMATED_ASSET_MAX_BYTES / (1024 * 1024));
    return `GIF 需小于 ${limitMb}MB，请换一张`;
  }
  return fallback;
}

export type ThemeAssetRecord = {
  id: string;
  type: ThemeAssetType;
  mimeType: string;
  dataUrl: string;
  updatedAt: string;
};

function hasBrowserApi(): boolean {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

function hasLocalStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function runRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function runTransactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function openThemeDb(): Promise<IDBDatabase | null> {
  if (!hasBrowserApi()) {
    return null;
  }

  // Open at >= THEME_DB_VERSION: a backup restore may have bumped the stored
  // version higher, and opening at a fixed lower version would throw a VersionError.
  return openIndexedDbAtLeast(THEME_DB_NAME, THEME_DB_VERSION, (database) => {
    if (!database.objectStoreNames.contains(THEME_ASSET_STORE)) {
      database.createObjectStore(THEME_ASSET_STORE, { keyPath: "id" });
    }
  }).then((database) => {
    database.onversionchange = () => database.close();
    return database;
  }).catch(() => null);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(blob);
  });
}

function dataUrlToMimeType(dataUrl: string): string {
  const match = /^data:([^;]+);base64,/.exec(dataUrl);
  return match ? match[1] : "application/octet-stream";
}

function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to decode image"));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Failed to encode image"));
          return;
        }
        resolve(blob);
      },
      mimeType,
      quality
    );
  });
}

async function normalizeRasterBlob(blob: Blob): Promise<Blob> {
  const image = await loadImageFromBlob(blob);
  const largestSide = Math.max(image.naturalWidth, image.naturalHeight);
  const scale = largestSide > IMAGE_MAX_DIMENSION ? IMAGE_MAX_DIMENSION / largestSide : 1;
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");

  if (!context) {
    return blob;
  }

  context.drawImage(image, 0, 0, width, height);

  const sourceMime = blob.type.toLowerCase();
  if (sourceMime === "image/jpeg" || sourceMime === "image/jpg") {
    let quality = 0.9;
    let encoded = await canvasToBlob(canvas, "image/jpeg", quality);
    while (encoded.size > IMAGE_TARGET_SIZE_BYTES && quality > 0.5) {
      quality = Number((quality - 0.1).toFixed(2));
      encoded = await canvasToBlob(canvas, "image/jpeg", quality);
    }
    return encoded;
  }

  if (sourceMime === "image/webp") {
    let quality = 0.9;
    let encoded = await canvasToBlob(canvas, "image/webp", quality);
    while (encoded.size > IMAGE_TARGET_SIZE_BYTES && quality > 0.5) {
      quality = Number((quality - 0.1).toFixed(2));
      encoded = await canvasToBlob(canvas, "image/webp", quality);
    }
    return encoded;
  }

  return canvasToBlob(canvas, "image/png");
}

async function normalizeIncomingBlob(blob: Blob): Promise<Blob> {
  const mime = blob.type.toLowerCase();
  if (mime === "image/svg+xml") {
    return blob;
  }
  if (mime === "image/gif") {
    // GIF 必须原样保留：canvas 只能取到第一帧，重编码等于把动图拍平成静态图。
    // 代价是无法压缩，所以改为体积超限时报错，交给调用方提示用户。
    if (blob.size > ANIMATED_ASSET_MAX_BYTES) {
      throw new AnimatedAssetTooLargeError();
    }
    return blob;
  }
  if (!mime.startsWith("image/")) {
    return blob;
  }
  return normalizeRasterBlob(blob);
}

function createThemeAssetId(type: ThemeAssetType): string {
  const uuid = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}_${Math.random()}`;
  return `${type}_${uuid}`;
}

async function saveAssetRecord(record: ThemeAssetRecord): Promise<void> {
  const database = await openThemeDb();
  if (!database) {
    return;
  }

  try {
    const transaction = database.transaction(THEME_ASSET_STORE, "readwrite");
    const store = transaction.objectStore(THEME_ASSET_STORE);
    store.put(record);
    await runTransactionDone(transaction);
  } finally {
    database.close();
  }
}

async function readAssetRecord(id: string): Promise<ThemeAssetRecord | null> {
  const database = await openThemeDb();
  if (!database) {
    return null;
  }

  try {
    const transaction = database.transaction(THEME_ASSET_STORE, "readonly");
    const store = transaction.objectStore(THEME_ASSET_STORE);
    const result = await runRequest(store.get(id));
    await runTransactionDone(transaction);
    return (result as ThemeAssetRecord | undefined) ?? null;
  } finally {
    database.close();
  }
}

export async function getThemeAssetDataUrl(id: string): Promise<string | null> {
  const record = await readAssetRecord(id);
  return record?.dataUrl ?? null;
}

export async function getThemeAssetMap(ids: string[]): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  const rows = await Promise.all(uniqueIds.map((id) => readAssetRecord(id)));
  rows.forEach((row) => {
    if (!row) {
      return;
    }
    map[row.id] = row.dataUrl;
  });
  return map;
}

export async function readThemeAssetRecords(ids: string[]): Promise<ThemeAssetRecord[]> {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  const rows = await Promise.all(uniqueIds.map((id) => readAssetRecord(id)));
  return rows.filter((row): row is ThemeAssetRecord => Boolean(row));
}

export async function writeThemeAssetRecords(records: ThemeAssetRecord[]): Promise<void> {
  const uniqueRecords = new Map<string, ThemeAssetRecord>();
  records.forEach((record) => {
    if (!record.id || !record.dataUrl) {
      return;
    }
    uniqueRecords.set(record.id, {
      ...record,
      updatedAt: record.updatedAt || new Date().toISOString()
    });
  });

  await Promise.all(Array.from(uniqueRecords.values()).map((record) => saveAssetRecord(record)));
}

export async function deleteThemeAsset(id: string): Promise<void> {
  const database = await openThemeDb();
  if (!database) {
    return;
  }
  try {
    const transaction = database.transaction(THEME_ASSET_STORE, "readwrite");
    transaction.objectStore(THEME_ASSET_STORE).delete(id);
    await runTransactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function saveThemeAssetFromBlob(
  blob: Blob,
  type: ThemeAssetType,
  providedId?: string
): Promise<string> {
  const normalized = await normalizeIncomingBlob(blob);
  const dataUrl = await blobToDataUrl(normalized);
  const mimeType = normalized.type || dataUrlToMimeType(dataUrl);
  const id = providedId ?? createThemeAssetId(type);
  const record: ThemeAssetRecord = {
    id,
    type,
    mimeType,
    dataUrl,
    updatedAt: new Date().toISOString()
  };
  await saveAssetRecord(record);
  return id;
}

export function readThemeProfile(): ThemeProfile {
  if (!hasLocalStorage()) {
    return { ...DEFAULT_THEME_PROFILE };
  }

  const raw = kvGet(THEME_PROFILE_STORAGE_KEY);
  if (!raw) {
    return { ...DEFAULT_THEME_PROFILE };
  }

  try {
    return normalizeThemeProfile(JSON.parse(raw) as unknown);
  } catch {
    kvRemove(THEME_PROFILE_STORAGE_KEY);
    return { ...DEFAULT_THEME_PROFILE };
  }
}

export function writeThemeProfile(profile: ThemeProfile): ThemeProfile {
  const normalized = normalizeThemeProfile({
    ...profile,
    updatedAt: new Date().toISOString()
  });

  if (hasLocalStorage()) {
    kvSet(THEME_PROFILE_STORAGE_KEY, JSON.stringify(normalized));
  }

  return normalized;
}

export function collectThemeAssetIds(profile: ThemeProfile): string[] {
  const iconIds = Object.values(profile.iconSkins).filter((value): value is string => Boolean(value));
  const iconSchemeIds = profile.iconSchemes.flatMap((scheme) =>
    Object.values(scheme.iconSkins).filter((value): value is string => Boolean(value))
  );
  return [
    profile.wallpaperAssetId ?? "",
    profile.fontAssetId ?? "",
    profile.dockSkinAssetId ?? "",
    ...profile.wallpaperLibrary,
    ...iconIds,
    ...iconSchemeIds,
  ].filter(Boolean);
}
