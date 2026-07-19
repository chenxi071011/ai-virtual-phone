import JSZip from "jszip";
import { downloadFile, type DownloadFileOptions } from "../download-utils";
import { DATA_MODULES } from "./modules";
import { clearSource, exportSource, importSource, inspectSource } from "./idb";
import { createMediaCollector, type MediaCollector, type MediaResolver } from "./serializers";
import type {
  BackupEnvelope,
  BackupManifest,
  ClearResult,
  DataModuleId,
  DataSnapshot,
  ImportOptions,
  ImportResult,
  ModulePayload,
  ModuleStats,
  SourceBackup,
} from "./types";

const BACKUP_FILE_VERSION = 2;                       // new backups: media stored as binary entries
const SUPPORTED_BACKUP_VERSIONS = new Set<number>([1, 2]); // still restore old base64 (v1) backups

function getSelectedModules(moduleIds?: DataModuleId[]) {
  if (!moduleIds || moduleIds.length === 0) return DATA_MODULES;
  const selected = new Set(moduleIds);
  return DATA_MODULES.filter((module) => selected.has(module.id));
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

export async function inspectData(): Promise<DataSnapshot> {
  const moduleStats: ModuleStats[] = [];
  let totalBytes = 0;
  let totalRecords = 0;

  for (const dataModule of DATA_MODULES) {
    let records = 0;
    let bytes = 0;
    const details: ModuleStats["details"] = [];
    for (const source of dataModule.sources) {
      const stats = await inspectSource(source);
      records += stats.records;
      bytes += stats.bytes;
      details.push(...(stats.details ?? []));
    }
    totalBytes += bytes;
    totalRecords += records;
    moduleStats.push({
      moduleId: dataModule.id,
      label: dataModule.label,
      description: dataModule.description,
      variant: dataModule.variant,
      records,
      bytes,
      percent: 0,
      critical: Boolean(dataModule.critical),
      large: Boolean(dataModule.large),
      details: details.sort((a, b) => b.bytes - a.bytes),
    });
  }

  for (const stats of moduleStats) {
    stats.percent = totalBytes > 0 ? Math.round((stats.bytes / totalBytes) * 100) : 0;
  }

  const storage = typeof navigator !== "undefined" && navigator.storage
    ? {
        ...(await navigator.storage.estimate().catch(() => ({}))),
        persisted: await navigator.storage.persisted().catch(() => undefined),
      }
    : undefined;

  return {
    totalBytes,
    totalRecords,
    modules: moduleStats,
    storage,
    createdAt: new Date().toISOString(),
  };
}

export type BackupOptions = {
  /** Strip embedded images/audio/video (keeps text/config/structure + avatars). */
  excludeMedia?: boolean;
};

// Modules whose media is kept even in "exclude media" mode (avatars are identity).
const MEDIA_KEEP_MODULE_IDS = new Set<DataModuleId>(["characters"]);

const MEDIA_DATAURL_RE = /^data:(?:image|audio|video|application\/octet-stream)/i;
const MEDIA_MIN_BYTES = 2048;

function stripMediaDeep(value: unknown): unknown {
  if (typeof value === "string") {
    return value.length > MEDIA_MIN_BYTES && MEDIA_DATAURL_RE.test(value) ? "" : value;
  }
  if (Array.isArray(value)) return value.map(stripMediaDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = stripMediaDeep(v);
    return out;
  }
  return value;
}

// KV / localStorage values are JSON strings; parse, strip nested data-URLs, re-stringify.
function stripMediaInString(value: string): string {
  if (typeof value !== "string" || value.length <= MEDIA_MIN_BYTES) return value;
  if (MEDIA_DATAURL_RE.test(value)) return "";
  if (/"data:(?:image|audio|video)/i.test(value)) {
    try { return JSON.stringify(stripMediaDeep(JSON.parse(value))); } catch { return value; }
  }
  return value;
}

function stripMediaFromSource(payload: SourceBackup): SourceBackup {
  if (payload.type === "indexeddb") {
    return {
      ...payload,
      stores: payload.stores.map((store) => ({
        ...store,
        records: store.records.map((record) => ({ ...record, value: stripMediaDeep(record.value) })),
      })),
    };
  }
  return {
    ...payload,
    records: payload.records.map((record) => ({ ...record, value: stripMediaInString(record.value) })),
  };
}

export async function buildBackupEnvelope(moduleIds?: DataModuleId[], options: BackupOptions = {}): Promise<BackupEnvelope> {
  return buildEnvelope(moduleIds, options);
}

/** Module list for streaming (one-at-a-time) backup builds — see buildSingleModulePayload. */
export function getBackupModules(moduleIds?: DataModuleId[]) {
  return getSelectedModules(moduleIds);
}

/**
 * Build ONE module's payload. Lets callers stream "read → compress → upload →
 * release" per module instead of holding every module's data (objects + JSON
 * strings) in memory at once — the all-at-once peak is what crashes mobile
 * WebKit (page reload) on large libraries. Counts records from the payload
 * itself so callers don't need the double full read of inspectData().
 */
export async function buildSingleModulePayload(
  dataModule: ReturnType<typeof getSelectedModules>[number],
  options: BackupOptions = {},
  collector?: MediaCollector,
): Promise<{ payload: ModulePayload; records: number }> {
  const stripping = Boolean(options.excludeMedia) && !MEDIA_KEEP_MODULE_IDS.has(dataModule.id);
  // Stripped modules export media as dataURL strings so stripMediaFromSource can
  // remove it; extracting to media-refs first would make "exclude media" a no-op.
  const moduleCollector = stripping ? undefined : collector;
  let sources: SourceBackup[] = [];
  for (const source of dataModule.sources) {
    sources.push(await exportSource(source, moduleCollector));
  }
  if (stripping) {
    sources = sources.map(stripMediaFromSource);
  }
  let records = 0;
  for (const sourcePayload of sources) {
    if (sourcePayload.type === "indexeddb") {
      for (const store of sourcePayload.stores) records += store.records.length;
    } else {
      records += sourcePayload.records.length;
    }
  }
  return { payload: { moduleId: dataModule.id, sources }, records };
}

async function buildEnvelope(moduleIds?: DataModuleId[], options: BackupOptions = {}, collector?: MediaCollector): Promise<BackupEnvelope> {
  const snapshot = await inspectData();
  const selectedModules = getSelectedModules(moduleIds);
  const modulePayloads: ModulePayload[] = [];

  for (const dataModule of selectedModules) {
    const stripping = Boolean(options.excludeMedia) && !MEDIA_KEEP_MODULE_IDS.has(dataModule.id);
    // Don't extract media for stripped modules — keep it as dataURL strings so
    // stripMediaFromSource can actually remove it (it only recognises strings,
    // not media-ref objects). Otherwise "exclude media" silently keeps everything.
    const moduleCollector = stripping ? undefined : collector;
    let sources = [];
    for (const source of dataModule.sources) {
      sources.push(await exportSource(source, moduleCollector));
    }
    if (stripping) {
      sources = sources.map(stripMediaFromSource);
    }
    modulePayloads.push({ moduleId: dataModule.id, sources });
  }

  const manifestModules = modulePayloads.map((payload) => {
    const stats = snapshot.modules.find((item) => item.moduleId === payload.moduleId);
    const definition = DATA_MODULES.find((item) => item.id === payload.moduleId);
    // When media is stripped, recompute bytes from the actual (smaller) payload.
    const bytes = options.excludeMedia
      ? new Blob([JSON.stringify(payload)]).size
      : stats?.bytes ?? 0;
    return {
      id: payload.moduleId,
      label: definition?.label ?? payload.moduleId,
      records: stats?.records ?? 0,
      bytes,
    };
  });

  const manifest: BackupManifest = {
    format: "ai-phone-backup",
    // v2 only when media was actually extracted to binary entries (collector present).
    version: collector ? 2 : 1,
    createdAt: new Date().toISOString(),
    origin: typeof window !== "undefined" ? window.location.origin : "",
    modules: manifestModules,
    totalBytes: manifestModules.reduce((sum, item) => sum + item.bytes, 0),
    totalRecords: manifestModules.reduce((sum, item) => sum + item.records, 0),
    ...(options.excludeMedia ? { mediaExcluded: true } : {}),
  };

  return { manifest, modules: modulePayloads };
}

export async function createBackupBlob(moduleIds?: DataModuleId[], options: BackupOptions = {}): Promise<{ blob: Blob; manifest: BackupManifest }> {
  const collector = createMediaCollector();
  const envelope = await buildEnvelope(moduleIds, options, collector);
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify(envelope.manifest, null, 2));
  for (const modulePayload of envelope.modules) {
    zip.file(`modules/${modulePayload.moduleId}.json`, JSON.stringify(modulePayload));
  }
  // Media lives out of the JSON as one binary entry per content hash (deduped). STORE:
  // images/audio are already compressed, re-deflating wastes CPU for ~no gain.
  for (const [ref, mediaBlob] of collector.media) {
    zip.file(`media/${ref}.bin`, mediaBlob, { compression: "STORE" });
  }
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", mimeType: "application/zip" });
  return { blob, manifest: envelope.manifest };
}

export async function readBackupBlob(blob: Blob): Promise<BackupEnvelope> {
  const zip = await JSZip.loadAsync(blob);
  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) throw new Error("备份文件缺少 manifest.json");
  const manifest = JSON.parse(await manifestFile.async("string")) as BackupManifest;
  if (manifest.format !== "ai-phone-backup" || !SUPPORTED_BACKUP_VERSIONS.has(manifest.version)) {
    throw new Error("备份文件格式不受支持");
  }

  const modules: ModulePayload[] = [];
  const moduleFolder = zip.folder("modules");
  if (!moduleFolder) return { manifest, modules };

  const fileNames = Object.keys(zip.files).filter((name) => name.startsWith("modules/") && name.endsWith(".json"));
  for (const fileName of fileNames) {
    const file = zip.file(fileName);
    if (!file) continue;
    modules.push(JSON.parse(await file.async("string")) as ModulePayload);
  }

  return { manifest, modules };
}

export async function downloadBackupBlob(blob: Blob, manifest: BackupManifest, options: DownloadFileOptions = {}): Promise<string | void> {
  const date = manifest.createdAt.replace(/[:.]/g, "-").slice(0, 19);
  const zipBlob = blob.type === "application/zip" ? blob : blob.slice(0, blob.size, "application/zip");
  // Plain .zip extension so iOS Safari's file picker recognizes the type and
  // lets the user select it for import (a custom .aiphone extension is greyed
  // out on iOS, which has no UTI for it). The backup is validated by the
  // manifest's format/version on import, not by the file extension.
  return await downloadFile(zipBlob, `ai-phone-backup-${date}.zip`, options);
}

export async function importBackupBlob(blob: Blob, moduleIds?: DataModuleId[], options: ImportOptions = {}): Promise<ImportResult> {
  const zip = await JSZip.loadAsync(blob);
  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) throw new Error("备份文件缺少 manifest.json");
  const manifest = JSON.parse(await manifestFile.async("string")) as BackupManifest;
  if (manifest.format !== "ai-phone-backup" || !SUPPORTED_BACKUP_VERSIONS.has(manifest.version)) {
    throw new Error("备份文件格式不受支持");
  }

  const selected = moduleIds && moduleIds.length > 0 ? new Set(moduleIds) : null;
  const total: ImportResult = { added: 0, skipped: 0, overwritten: 0, errors: [] };

  // Pull each media binary straight from the zip, one at a time (low peak memory).
  // v1 backups have no media/ entries — markers there are inline base64, resolver is never hit.
  const missingMedia = new Set<string>();
  const resolver: MediaResolver = async (ref) => {
    const file = zip.file(`media/${ref}.bin`);
    if (!file) { missingMedia.add(ref); return null; }
    return await file.async("uint8array");
  };

  // Process modules one at a time — never hold every module's parsed JSON at once
  // (the all-at-once parse of base64-laden modules is what OOM-crashed mobile WebKit).
  const fileNames = Object.keys(zip.files).filter((name) => name.startsWith("modules/") && name.endsWith(".json"));
  for (const fileName of fileNames) {
    const file = zip.file(fileName);
    if (!file) continue;
    let modulePayload: ModulePayload;
    try {
      modulePayload = JSON.parse(await file.async("string")) as ModulePayload;
    } catch {
      total.errors.push(`${fileName}: 解析失败`);
      continue;
    }
    if (selected && !selected.has(modulePayload.moduleId)) continue;
    for (const sourcePayload of modulePayload.sources) {
      const result = await importSource(sourcePayload, Boolean(options.overwrite), resolver);
      total.added += result.added;
      total.skipped += result.skipped;
      total.overwritten += result.overwritten;
      total.errors.push(...result.errors);
    }
  }

  if (missingMedia.size > 0) {
    total.errors.push(`缺少 ${missingMedia.size} 个媒体对象，部分图片/文件可能丢失`);
  }

  return total;
}

export async function clearModules(moduleIds: DataModuleId[]): Promise<ClearResult> {
  const selected = getSelectedModules(moduleIds);
  const total: ClearResult = { removed: 0, errors: [] };

  for (const dataModule of selected) {
    for (const source of dataModule.sources) {
      const result = await clearSource(source);
      total.removed += result.removed;
      total.errors.push(...result.errors);
    }
  }

  return total;
}
