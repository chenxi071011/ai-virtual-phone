import CryptoJS from "crypto-js";
import { buildSingleModulePayload, getBackupModules } from "../data-management/backup";
import { importSource } from "../data-management/idb";
import { createMediaCollector, type MediaResolver } from "../data-management/serializers";
import type { DataModuleId, ModulePayload } from "../data-management/types";
import { kvGet, kvSet, registerKvMigration } from "../kv-db";
import type { CloudBackupConfig } from "./config";
import { ensureBucket, getObject, listObjects, putObject, removeObject } from "./storage-client";

/**
 * Module-level incremental cloud backup.
 *
 * Layout in the ai-phone-backup bucket:
 *   modules/<moduleId>/<sha256>.json.gz   — one module's payload, keyed by content
 *                                            hash → unchanged modules are never re-uploaded
 *   media/<sha256>.bin or media/<sha256>.<part>.bin
 *                                          — extracted media blobs, chunked when large
 *   manifests/<ts>.json                    — points at the object for each module (commit point)
 *   manifests/quarantine-<ts>.json         — a backup flagged as a size/record anomaly
 *
 * Safety: if a new backup is much smaller / has far fewer records than the last
 * healthy one, it is written as a quarantine manifest and the healthy manifests
 * are NOT rotated out — the previous good backups are always preserved.
 */

const STATE_KEY = "ai_phone_cloud_backup_state_v1";
registerKvMigration(STATE_KEY);

// A backup is "anomalous" if it shrank past these vs the last healthy backup.
const ANOMALY_BYTES_RATIO = 0.5;
const ANOMALY_RECORDS_RATIO = 0.5;

// Stay under Supabase Storage's per-file upload limit (free tier ~50MB). A module
// whose gzipped payload exceeds this is split into several part objects.
const MAX_OBJECT_BYTES = 40 * 1024 * 1024;

function sliceBlob(blob: Blob, max: number): Blob[] {
  if (blob.size <= max) return [blob];
  const parts: Blob[] = [];
  for (let offset = 0; offset < blob.size; offset += max) {
    parts.push(blob.slice(offset, offset + max));
  }
  return parts;
}

export type CloudBackupManifestMedia = {
  ref: string;
  bytes: number;
  parts: string[]; // object path(s) inside the bucket (chunked if the media is large)
};

export type CloudBackupManifestModule = {
  id: DataModuleId;
  label: string;
  records: number;
  bytes: number;
  hash: string;
  parts: string[]; // object path(s) inside the bucket (chunked if the module is large)
  mediaRefs?: string[]; // content hashes of this module's media objects
};

export type CloudBackupManifest = {
  format: "ai-phone-cloud-backup";
  version: 1;
  createdAt: string;
  origin: string;
  totalBytes: number;
  totalRecords: number;
  combinedHash: string; // hash of all module hashes → cheap change detection
  anomaly?: boolean;
  modules: CloudBackupManifestModule[];
  media?: CloudBackupManifestMedia[];
};

export type CloudBackupState = {
  lastManifestName?: string;
  lastCreatedAt?: string;
  lastTotalBytes?: number;
  lastTotalRecords?: number;
  lastCombinedHash?: string;
  // baseline for anomaly detection: the most recent HEALTHY backup
  healthyBytes?: number;
  healthyRecords?: number;
  lastError?: string;
  lastResult?: "ok" | "skipped" | "anomaly" | "error";
};

export type CloudBackupRunResult = {
  status: "ok" | "skipped" | "anomaly";
  uploadedModules: number;
  totalBytes: number;
  totalRecords: number;
  manifestName: string;
};

export function loadCloudBackupState(): CloudBackupState {
  try {
    const raw = kvGet(STATE_KEY);
    return raw ? (JSON.parse(raw) as CloudBackupState) : {};
  } catch {
    return {};
  }
}

function saveCloudBackupState(state: CloudBackupState): void {
  kvSet(STATE_KEY, JSON.stringify(state));
}

// ── crypto / compression helpers (native, no deps) ──

async function sha256Hex(input: string): Promise<string> {
  // crypto.subtle 需要"安全上下文"（https:// / localhost），手机 App 走的
  // http://局域网IP:端口 不算，那儿 crypto.subtle 是 undefined。换纯 JS 实现。
  return CryptoJS.SHA256(input).toString(CryptoJS.enc.Hex);
}

async function gzipText(text: string): Promise<Blob> {
  if (typeof CompressionStream === "undefined") return new Blob([text]);
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return await new Response(stream).blob();
}

async function gunzipBlob(blob: Blob): Promise<string> {
  if (typeof DecompressionStream === "undefined") return await blob.text();
  try {
    const stream = blob.stream().pipeThrough(new DecompressionStream("gzip"));
    return await new Response(stream).text();
  } catch {
    // Stored uncompressed on a browser without CompressionStream.
    return await blob.text();
  }
}

function legacyMediaPath(ref: string): string {
  return `media/${ref}.bin`;
}

function mediaPartPath(ref: string, index: number): string {
  return `media/${ref}.${index}.bin`;
}

async function listExistingMedia(config: CloudBackupConfig, healthy?: CloudBackupManifest | null): Promise<Map<string, string[]>> {
  const existing = new Map<string, string[]>();
  const addParts = (ref: string, parts: string[]) => {
    if (!ref || parts.length === 0 || existing.has(ref)) return;
    existing.set(ref, parts);
  };

  for (const item of healthy?.media ?? []) {
    addParts(item.ref, item.parts ?? []);
  }
  for (const mod of healthy?.modules ?? []) {
    for (const ref of mod.mediaRefs ?? []) {
      if (!existing.has(ref)) addParts(ref, [legacyMediaPath(ref)]);
    }
  }

  const listed = await listObjects(config, "media/", 2000).catch(() => []);
  const chunked = new Map<string, Array<{ index: number; path: string }>>();
  for (const object of listed) {
    const name = object.name;
    const legacy = /^([a-f0-9]{64})\.bin$/i.exec(name);
    if (legacy) {
      addParts(legacy[1], [`media/${name}`]);
      continue;
    }
    const chunk = /^([a-f0-9]{64})\.(\d+)\.bin$/i.exec(name);
    if (chunk) {
      const ref = chunk[1];
      const index = Number(chunk[2]);
      const parts = chunked.get(ref) ?? [];
      parts.push({ index, path: `media/${name}` });
      chunked.set(ref, parts);
    }
  }
  for (const [ref, parts] of chunked) {
    if (!existing.has(ref)) {
      addParts(ref, parts.sort((a, b) => a.index - b.index).map((part) => part.path));
    }
  }
  return existing;
}

async function uploadMediaObject(
  config: CloudBackupConfig,
  ref: string,
  blob: Blob,
  onChunk?: (index: number, total: number) => void,
): Promise<string[]> {
  const slices = sliceBlob(blob, MAX_OBJECT_BYTES);
  const paths: string[] = [];
  for (let index = 0; index < slices.length; index += 1) {
    onChunk?.(index, slices.length);
    const path = slices.length === 1 ? legacyMediaPath(ref) : mediaPartPath(ref, index);
    await putObject(config, path, slices[index], "application/octet-stream");
    paths.push(path);
  }
  return paths;
}

// ── manifest listing ──

function manifestNameToCreatedAt(name: string): string {
  return name.replace(/^manifests\//, "").replace(/^quarantine-/, "").replace(/\.json$/, "");
}

export async function listCloudManifests(config: CloudBackupConfig): Promise<{ name: string; quarantine: boolean }[]> {
  const objects = await listObjects(config, "manifests/", 200);
  return objects
    .map((o) => ({ name: `manifests/${o.name}`, quarantine: o.name.startsWith("quarantine-") }))
    .filter((m) => m.name.endsWith(".json"))
    .sort((a, b) => manifestNameToCreatedAt(b.name).localeCompare(manifestNameToCreatedAt(a.name)));
}

export type CloudBackupListItem = {
  name: string;
  createdAt: string;
  totalBytes: number;
  totalRecords: number;
  quarantine: boolean;
};

/** List backups with metadata for the restore UI (newest first). */
export async function listCloudBackups(config: CloudBackupConfig): Promise<CloudBackupListItem[]> {
  const manifests = await listCloudManifests(config);
  const items: CloudBackupListItem[] = [];
  for (const m of manifests) {
    const manifest = await loadManifest(config, m.name).catch(() => null);
    if (!manifest) continue;
    items.push({
      name: m.name,
      createdAt: manifest.createdAt,
      totalBytes: manifest.totalBytes,
      totalRecords: manifest.totalRecords,
      quarantine: m.quarantine || Boolean(manifest.anomaly),
    });
  }
  return items;
}

async function loadManifest(config: CloudBackupConfig, name: string): Promise<CloudBackupManifest | null> {
  const blob = await getObject(config, name);
  if (!blob) return null;
  try {
    return JSON.parse(await blob.text()) as CloudBackupManifest;
  } catch {
    return null;
  }
}

async function latestHealthyManifest(config: CloudBackupConfig): Promise<CloudBackupManifest | null> {
  const list = await listCloudManifests(config);
  for (const item of list) {
    if (item.quarantine) continue;
    const manifest = await loadManifest(config, item.name);
    if (manifest && !manifest.anomaly) return manifest;
  }
  return null;
}

// ── the backup run ──

/** Progress callback payload for cloud backup/restore (percent is 0-100). */
export type CloudProgress = { percent: number; detail: string };

export async function runCloudBackup(
  config: CloudBackupConfig,
  options: { moduleIds?: DataModuleId[]; force?: boolean; excludeMedia?: boolean; onProgress?: (p: CloudProgress) => void } = {},
): Promise<CloudBackupRunResult> {
  const onProgress = options.onProgress ?? (() => {});
  await ensureBucket(config);

  // Streaming build: handle ONE module at a time (read → stringify → hash →
  // compress → upload → release). Holding every module's objects + JSON strings
  // at once (the old approach) doubled/tripled the library size in memory and
  // got the page killed/reloaded by mobile WebKit on large (200MB+) libraries.
  const modules = getBackupModules(options.moduleIds);
  const state = loadCloudBackupState();

  // Last HEALTHY backup (cloud truth first): reuse its module parts + anomaly baseline.
  const healthy = await latestHealthyManifest(config).catch(() => null);
  const existing = new Map((healthy?.modules ?? []).map((m) => [`${m.id}|${m.hash}`, m.parts] as const));

  let uploaded = 0;
  let totalBytes = 0;
  let totalRecords = 0;
  const moduleHashes: string[] = [];
  const manifestModules: CloudBackupManifestModule[] = [];
  const manifestMedia = new Map<string, CloudBackupManifestMedia>();

  // Media is content-addressed and shared across modules/backups.
  // List what's already uploaded once so unchanged media is never re-sent.
  const existingMedia = await listExistingMedia(config, healthy);

  for (let i = 0; i < modules.length; i += 1) {
    const dataModule = modules[i];
    const label = dataModule.label;
    // Per-module progress window inside [2, 92].
    const spanStart = 2 + (i / modules.length) * 90;
    const span = 90 / modules.length;
    onProgress({ percent: spanStart, detail: `读取 ${label}…` });

    const collector = createMediaCollector();
    const built = await buildSingleModulePayload(dataModule, { excludeMedia: options.excludeMedia }, collector);
    let json: string | null = JSON.stringify(built.payload);
    built.payload = null as unknown as typeof built.payload; // release object tree early
    const hash = await sha256Hex(json);
    // Media now lives outside the JSON — count it too, else totalBytes "shrinks"
    // vs old v1 backups and the anomaly check wrongly quarantines this backup.
    const mediaBytes = Array.from(collector.media.values()).reduce((sum, b) => sum + b.size, 0);
    const bytes = new Blob([json]).size + mediaBytes;
    totalBytes += bytes;
    totalRecords += built.records;
    moduleHashes.push(`${dataModule.id}:${hash}`);

    let parts = existing.get(`${dataModule.id}|${hash}`);
    if (!parts || parts.length === 0) {
      onProgress({ percent: spanStart + span * 0.3, detail: `压缩 ${label}…` });
      const gz = await gzipText(json);
      json = null; // release the JSON string before uploading
      const slices = sliceBlob(gz, MAX_OBJECT_BYTES);
      parts = [];
      for (let k = 0; k < slices.length; k += 1) {
        onProgress({ percent: spanStart + span * (0.4 + 0.6 * (k / slices.length)), detail: `上传 ${label} · 分片 ${k + 1}/${slices.length}` });
        const object = `modules/${dataModule.id}/${hash}.${k}.gz`;
        await putObject(config, object, slices[k], "application/gzip");
        parts.push(object);
      }
      uploaded += 1;
    } else {
      json = null;
    }

    // Upload this module's media (skip any already present — content-addressed dedupe).
    const mediaRefs = Array.from(collector.media.keys());
    for (let mediaIndex = 0; mediaIndex < mediaRefs.length; mediaIndex += 1) {
      const ref = mediaRefs[mediaIndex];
      const blob = collector.media.get(ref)!;
      let mediaParts = existingMedia.get(ref);
      if (!mediaParts || mediaParts.length === 0) {
        mediaParts = await uploadMediaObject(config, ref, blob, (chunkIndex, chunkTotal) => {
          onProgress({
            percent: spanStart + span * 0.9,
            detail: chunkTotal > 1
              ? `上传 ${label} 媒体 ${mediaIndex + 1}/${mediaRefs.length} · 分片 ${chunkIndex + 1}/${chunkTotal}`
              : `上传 ${label} 媒体 ${mediaIndex + 1}/${mediaRefs.length}`,
          });
        });
        existingMedia.set(ref, mediaParts);
      }
      manifestMedia.set(ref, { ref, bytes: blob.size, parts: mediaParts });
    }

    manifestModules.push({ id: dataModule.id, label, records: built.records, bytes, hash, parts, mediaRefs });
  }

  const combinedHash = await sha256Hex(moduleHashes.join("|"));

  // Change detection: nothing changed since last backup → skip (unless forced).
  // (With streaming, unchanged modules were already reused from the cloud — no
  // uploads happened — so skipping here leaves no orphan objects.)
  if (!options.force && state.lastCombinedHash && state.lastCombinedHash === combinedHash && uploaded === 0) {
    saveCloudBackupState({ ...state, lastResult: "skipped", lastError: undefined });
    return { status: "skipped", uploadedModules: 0, totalBytes, totalRecords, manifestName: state.lastManifestName ?? "" };
  }

  // Anomaly check vs the last HEALTHY backup (prefer cloud truth, fall back to local).
  const baseBytes = healthy?.totalBytes ?? state.healthyBytes ?? 0;
  const baseRecords = healthy?.totalRecords ?? state.healthyRecords ?? 0;
  const anomaly = (baseBytes > 0 && totalBytes < baseBytes * ANOMALY_BYTES_RATIO)
    || (baseRecords > 0 && totalRecords < baseRecords * ANOMALY_RECORDS_RATIO);

  // 5. Write the manifest (commit point). Anomalous backups go to quarantine and
  //    never rotate out the healthy ones.
  onProgress({ percent: 96, detail: "写入备份清单…" });
  const createdAt = new Date().toISOString();
  const stamp = createdAt.replace(/[:.]/g, "-");
  const manifest: CloudBackupManifest = {
    format: "ai-phone-cloud-backup",
    version: 1,
    createdAt,
    origin: typeof window !== "undefined" ? window.location.origin : "",
    totalBytes,
    totalRecords,
    combinedHash,
    anomaly: anomaly || undefined,
    modules: manifestModules,
    media: Array.from(manifestMedia.values()),
  };
  const manifestName = anomaly ? `manifests/quarantine-${stamp}.json` : `manifests/${stamp}.json`;
  await putObject(config, manifestName, JSON.stringify(manifest), "application/json");

  // 6. Rotation + GC only when this backup is healthy.
  if (!anomaly) {
    onProgress({ percent: 98, detail: "清理旧备份…" });
    await rotateAndGc(config, config.keepCount, manifestName);
  }
  onProgress({ percent: 100, detail: "完成" });

  saveCloudBackupState({
    lastManifestName: manifestName,
    lastCreatedAt: createdAt,
    lastTotalBytes: totalBytes,
    lastTotalRecords: totalRecords,
    lastCombinedHash: anomaly ? state.lastCombinedHash : combinedHash,
    healthyBytes: anomaly ? state.healthyBytes : totalBytes,
    healthyRecords: anomaly ? state.healthyRecords : totalRecords,
    lastResult: anomaly ? "anomaly" : "ok",
    lastError: undefined,
  });

  return {
    status: anomaly ? "anomaly" : "ok",
    uploadedModules: uploaded,
    totalBytes,
    totalRecords,
    manifestName,
  };
}

/** Keep the latest `keep` healthy manifests; delete older manifests + any module
 *  object no longer referenced by a retained manifest. */
async function rotateAndGc(config: CloudBackupConfig, keep: number, justWritten: string): Promise<void> {
  const all = await listCloudManifests(config);
  const healthy = all.filter((m) => !m.quarantine);
  const retained = healthy.slice(0, Math.max(2, keep));
  const retainedNames = new Set(retained.map((m) => m.name));
  retainedNames.add(justWritten);

  // Delete manifests we no longer keep (older healthy + every quarantine).
  for (const m of all) {
    if (!retainedNames.has(m.name)) {
      await removeObject(config, m.name).catch(() => undefined);
    }
  }

  // Collect object paths still referenced by retained manifests.
  const referenced = new Set<string>();
  const referencedMediaPaths = new Set<string>();
  let referencesComplete = true;
  for (const name of retainedNames) {
    const manifest = await loadManifest(config, name).catch(() => null);
    if (!manifest) { referencesComplete = false; continue; }
    const mediaByRef = new Map((manifest.media ?? []).map((item) => [item.ref, item.parts ?? []] as const));
    for (const media of manifest.media ?? []) {
      (media.parts ?? []).forEach((path) => referencedMediaPaths.add(path));
    }
    manifest.modules.forEach((mod) => {
      (mod.parts ?? []).forEach((path) => referenced.add(path));
      (mod.mediaRefs ?? []).forEach((ref) => {
        if (mediaByRef.has(ref)) return;
        referencedMediaPaths.add(legacyMediaPath(ref));
      });
    });
  }
  if (referenced.size === 0) return; // safety: never GC if we couldn't read references

  // Delete module objects nobody references anymore.
  const moduleObjects = await listObjectsRecursive(config, "modules/");
  for (const path of moduleObjects) {
    if (!referenced.has(path)) {
      await removeObject(config, path).catch(() => undefined);
    }
  }

  // Delete orphaned media — only when references were read in full and the listing
  // isn't truncated (deleting a user's image by mistake is unacceptable).
  if (!referencesComplete) return;
  const MEDIA_LIST_LIMIT = 2000;
  const mediaObjects = await listObjects(config, "media/", MEDIA_LIST_LIMIT).catch(() => []);
  if (mediaObjects.length >= MEDIA_LIST_LIMIT) return; // truncated → skip to stay safe
  for (const o of mediaObjects) {
    const path = `media/${o.name}`;
    if (!referencedMediaPaths.has(path)) {
      await removeObject(config, `media/${o.name}`).catch(() => undefined);
    }
  }
}

/** modules/ is nested (modules/<id>/<hash>.json.gz); list one level of folders then their files. */
async function listObjectsRecursive(config: CloudBackupConfig, prefix: string): Promise<string[]> {
  const top = await listObjects(config, prefix, 500);
  const out: string[] = [];
  for (const entry of top) {
    if (entry.name.endsWith("/") || entry.size === 0) {
      const inner = await listObjects(config, `${prefix}${entry.name.replace(/\/$/, "")}/`, 500);
      for (const f of inner) out.push(`${prefix}${entry.name.replace(/\/$/, "")}/${f.name}`);
    } else {
      out.push(`${prefix}${entry.name}`);
    }
  }
  return out;
}

/** Restore: download a manifest's module objects and import them back. */
export async function restoreFromCloudManifest(
  config: CloudBackupConfig,
  manifestName: string,
  options: { overwrite?: boolean; moduleIds?: DataModuleId[]; onProgress?: (p: CloudProgress) => void } = {},
): Promise<{ added: number; skipped: number; overwritten: number; errors: string[] }> {
  const onProgress = options.onProgress ?? (() => {});
  onProgress({ percent: 1, detail: "读取备份清单…" });
  const manifest = await loadManifest(config, manifestName);
  if (!manifest) throw new Error("找不到该备份清单。");
  const selected = options.moduleIds && options.moduleIds.length > 0 ? new Set(options.moduleIds) : null;
  const total = { added: 0, skipped: 0, overwritten: 0, errors: [] as string[] };

  const mediaByRef = new Map((manifest.media ?? []).map((item) => [item.ref, item] as const));

  // Pull each media binary on demand, one at a time (low peak memory). Old cloud
  // backups have no media map, so they fall back to media/<ref>.bin.
  const missingMedia = new Set<string>();
  const resolver: MediaResolver = async (ref) => {
    if (missingMedia.has(ref)) return null;
    const media = mediaByRef.get(ref);
    const paths = media?.parts && media.parts.length > 0 ? media.parts : [legacyMediaPath(ref)];
    const blobs: Blob[] = [];
    for (const path of paths) {
      const part = await getObject(config, path);
      if (!part) {
        missingMedia.add(ref);
        return null;
      }
      blobs.push(part);
    }
    return new Uint8Array(await new Blob(blobs).arrayBuffer());
  };

  // Progress is weighted by module bytes: downloading ≈70% of a module's share,
  // importing the records the remaining ≈30%.
  const selectedModules = manifest.modules.filter((m) => !selected || selected.has(m.id));
  const restoreTotalBytes = Math.max(1, selectedModules.reduce((s, m) => s + (m.bytes || 1), 0));
  let restoreDoneBytes = 0;
  const restorePercent = (fraction: number) => 2 + Math.min(97, 97 * (restoreDoneBytes + fraction) / restoreTotalBytes);

  for (const mod of manifest.modules) {
    if (selected && !selected.has(mod.id)) continue;
    const modBytes = mod.bytes || 1;
    const paths = mod.parts ?? [];
    if (paths.length === 0) { total.errors.push(`${mod.label}: 备份缺少对象`); restoreDoneBytes += modBytes; continue; }
    const blobs: Blob[] = [];
    let missing = false;
    for (let i = 0; i < paths.length; i += 1) {
      onProgress({ percent: restorePercent((i / paths.length) * modBytes * 0.7), detail: `下载 ${mod.label} · 分片 ${i + 1}/${paths.length}` });
      const b = await getObject(config, paths[i]);
      if (!b) { missing = true; break; }
      blobs.push(b);
    }
    if (missing) { total.errors.push(`${mod.label}: 云端对象缺失`); restoreDoneBytes += modBytes; continue; }
    let payload: ModulePayload;
    try {
      // Concatenate the gzipped parts back into one blob, then decompress.
      payload = JSON.parse(await gunzipBlob(new Blob(blobs))) as ModulePayload;
    } catch {
      total.errors.push(`${mod.label}: 解析失败`);
      restoreDoneBytes += modBytes;
      continue;
    }
    for (let s = 0; s < payload.sources.length; s += 1) {
      onProgress({ percent: restorePercent(modBytes * (0.7 + 0.3 * (s / payload.sources.length))), detail: `写入 ${mod.label}…` });
      const result = await importSource(payload.sources[s], Boolean(options.overwrite), resolver);
      total.added += result.added;
      total.skipped += result.skipped;
      total.overwritten += result.overwritten;
      total.errors.push(...result.errors);
    }
    restoreDoneBytes += modBytes;
  }
  if (missingMedia.size > 0) {
    total.errors.push(`缺少 ${missingMedia.size} 个媒体对象，部分图片/文件可能丢失`);
  }
  onProgress({ percent: 100, detail: "完成" });
  return total;
}
