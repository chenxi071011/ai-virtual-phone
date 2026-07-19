"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  AlertTriangle,
  Archive,
  Brain,
  Database,
  Download,
  Loader2,
  MessageCircle,
  Palette,
  Share2,
  ShieldCheck,
  Settings2,
  Smartphone,
  Sparkles,
  Trash2,
  Upload,
  UserRound,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { DATA_MODULES, getLightModuleIds } from "@/lib/data-management/modules";
import { BINDING_ACCENTS, CONTENT_APP_ACCENTS } from "@/lib/ui-accent-colors";
import { Input, Select, Toggle } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/modal";
import { CloudUpload } from "lucide-react";
import {
  DEFAULT_CLOUD_BACKUP_CONFIG,
  isCloudBackupConfigured,
  loadCloudBackupConfig,
  saveCloudBackupConfig,
  type CloudBackupConfig,
} from "@/lib/cloud-backup/config";
import { testCloudBackupConnection } from "@/lib/cloud-backup/storage-client";
import { listCloudBackups, loadCloudBackupState, restoreFromCloudManifest, runCloudBackup, type CloudBackupListItem, type CloudBackupState } from "@/lib/cloud-backup/engine";
import { CloudDownload } from "lucide-react";
import {
  clearModules,
  createBackupBlob,
  downloadBackupBlob,
  formatBytes,
  importBackupBlob,
  inspectData,
  readBackupBlob,
} from "@/lib/data-management/backup";
import {
  cleanupOrphanThemeAssets,
  DEFAULT_MEDIA_MAINTENANCE_CONFIG,
  formatMediaMaintenanceResult,
  loadMediaMaintenanceConfig,
  loadMediaMaintenanceState,
  runMediaMaintenance,
  saveMediaMaintenanceConfig,
  type MediaMaintenanceConfig,
  type MediaMaintenanceState,
} from "@/lib/media-maintenance";
import { Capacitor } from "@capacitor/core";
import { isAndroidBrowser, isIOSBrowser, usesNativeShareSheet } from "@/lib/download-utils";
import type { BackupEnvelope, BackupManifest, DataModuleId, DataSnapshot, ImportResult, ModuleStats } from "@/lib/data-management/types";

type PendingImport = {
  file: File;
  envelope: BackupEnvelope;
};

type PendingExport = {
  blob: Blob;
  manifest: BackupManifest;
};

type PendingCloudRestore = {
  item: CloudBackupListItem;
  overwrite: boolean;
};

type ConfirmRequest =
  | { type: "export"; moduleIds: DataModuleId[]; labels: string }
  | { type: "import"; moduleIds: DataModuleId[]; labels: string; overwrite: boolean }
  | { type: "clear"; moduleIds: DataModuleId[]; labels: string }
  | { type: "media-maintenance" }
  | { type: "orphan-theme" };

type DataManagementProps = {
  onNotice?: (message: string) => void;
};

const ALL_MODULE_IDS = DATA_MODULES.map((module) => module.id);

const MODULE_ICONS: Record<DataModuleId, LucideIcon> = {
  chat: MessageCircle,
  settings: Settings2,
  characters: UserRound,
  desktop: Palette,
  memory: Brain,
  social: UsersRound,
  apps: Smartphone,
  creative: Sparkles,
  cache: Archive,
};

const MODULE_ACCENTS: Record<DataModuleId, string> = {
  chat: CONTENT_APP_ACCENTS.chat,
  settings: BINDING_ACCENTS.api,
  characters: BINDING_ACCENTS.preset,
  desktop: BINDING_ACCENTS.voice,
  memory: BINDING_ACCENTS.memory,
  social: CONTENT_APP_ACCENTS.moments,
  apps: CONTENT_APP_ACCENTS.calendar,
  creative: CONTENT_APP_ACCENTS.story,
  cache: BINDING_ACCENTS.regex,
};

const iconStyle = (color: string): CSSProperties => ({
  "--icon-color": color,
} as CSSProperties);

function DataSettingsIcon({ icon: Icon, color }: { icon: LucideIcon; color: string }) {
  return (
    <span className="card-icon" style={iconStyle(color)}>
      <Icon size={22} strokeWidth={1.75} />
    </span>
  );
}

function DataSectionTitle({ children }: { children: string }) {
  return (
    <div className="flex justify-between items-center gap-3">
      <p className="settings-menu-section-title">{children}</p>
    </div>
  );
}

type ModuleChipItem = {
  id: DataModuleId;
  label: string;
  meta?: string;
};

function ModuleChipSelector({
  items,
  selectedIds,
  onChange,
  ariaLabel,
}: {
  items: ModuleChipItem[];
  selectedIds: DataModuleId[];
  onChange: (ids: DataModuleId[]) => void;
  ariaLabel: string;
}) {
  return (
    <div className="data-module-chip-grid" role="group" aria-label={ariaLabel}>
      {items.map((item) => {
        const selected = selectedIds.includes(item.id);
        const Icon = MODULE_ICONS[item.id];
        return (
          <button
            key={item.id}
            type="button"
            className="data-module-chip"
            aria-pressed={selected}
            style={iconStyle(MODULE_ACCENTS[item.id])}
            {...(selected ? { "data-selected": "" } : {})}
            onClick={() => {
              if (selected) onChange(selectedIds.filter((id) => id !== item.id));
              else onChange([...selectedIds, item.id]);
            }}
          >
            <span className="data-chip-mark" aria-hidden="true">
              <Icon size={13} strokeWidth={2} />
            </span>
            <span className="data-chip-main">
              <span className="data-chip-label">{item.label}</span>
              {item.meta && <span className="data-chip-meta">{item.meta}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ModulePieChart({ modules, totalBytes }: { modules: ModuleStats[]; totalBytes: number }) {
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const visibleModules = modules.filter((module) => module.bytes > 0);
  let offset = 0;

  return (
    <div className="data-pie-panel" aria-label="模块数据占比">
      <div className="data-pie-chart">
        <svg viewBox="0 0 120 120" role="img" aria-label="模块占比饼图">
          <circle className="data-pie-track" cx="60" cy="60" r={radius} />
          {visibleModules.length > 0 ? visibleModules.map((module) => {
            const length = totalBytes > 0 ? (module.bytes / totalBytes) * circumference : 0;
            const gap = visibleModules.length > 1 ? Math.min(1.2, length * 0.2) : 0;
            const dash = Math.max(0, length - gap);
            const segment = (
              <circle
                key={module.moduleId}
                className="data-pie-segment"
                cx="60"
                cy="60"
                r={radius}
                stroke={MODULE_ACCENTS[module.moduleId]}
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
              />
            );
            offset += length;
            return segment;
          }) : null}
        </svg>
        <div className="data-pie-center">
          <span>{formatBytes(totalBytes)}</span>
          <small>总量</small>
        </div>
      </div>
      <div className="data-pie-legend">
        {modules.map((module) => (
          <div key={module.moduleId} className="data-pie-legend-item">
            <span className="data-pie-dot" style={{ background: MODULE_ACCENTS[module.moduleId] }} />
            <span className="data-pie-name">{module.label}</span>
            <span className="data-pie-value">{module.percent}% · {formatBytes(module.bytes)}</span>
            {module.details && module.details.length > 0 && (
              <span className="data-pie-detail">
                {module.details.slice(0, 3).map((detail) => `${detail.label}: ${formatBytes(detail.bytes)}`).join(" / ")}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function moduleLabel(id: DataModuleId): string {
  return DATA_MODULES.find((module) => module.id === id)?.label ?? id;
}

function formatTime(value?: string): string {
  if (!value) return "无记录";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export function DataManagement({ onNotice }: DataManagementProps) {
  const [snapshot, setSnapshot] = useState<DataSnapshot | null>(null);
  const [selectedExportModules, setSelectedExportModules] = useState<DataModuleId[]>(ALL_MODULE_IDS);
  const [selectedImportModules, setSelectedImportModules] = useState<DataModuleId[]>([]);
  const [selectedClearModules, setSelectedClearModules] = useState<DataModuleId[]>([]);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [pendingExport, setPendingExport] = useState<PendingExport | null>(null);
  const [exportSaving, setExportSaving] = useState(false);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [persistSupported, setPersistSupported] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [cloudConfig, setCloudConfig] = useState<CloudBackupConfig>(DEFAULT_CLOUD_BACKUP_CONFIG);
  const [cloudTesting, setCloudTesting] = useState(false);
  const [cloudTestMsg, setCloudTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [cloudBackingUp, setCloudBackingUp] = useState(false);
  const [cloudProgress, setCloudProgress] = useState<{ percent: number; detail: string } | null>(null);
  const [cloudState, setCloudState] = useState<CloudBackupState>({});
  const [showRestore, setShowRestore] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [restoreList, setRestoreList] = useState<CloudBackupListItem[]>([]);
  const [restoreOverwrite, setRestoreOverwrite] = useState(false);
  const [restorePending, setRestorePending] = useState<PendingCloudRestore | null>(null);
  const [mediaConfig, setMediaConfig] = useState<MediaMaintenanceConfig>(DEFAULT_MEDIA_MAINTENANCE_CONFIG);
  const [mediaState, setMediaState] = useState<MediaMaintenanceState>({});

  useEffect(() => {
    setCloudConfig(loadCloudBackupConfig());
    setCloudState(loadCloudBackupState());
  }, []);

  useEffect(() => {
    setMediaConfig(loadMediaMaintenanceConfig());
    setMediaState(loadMediaMaintenanceState());
    const handleUpdate = () => setMediaState(loadMediaMaintenanceState());
    window.addEventListener("media-maintenance-updated", handleUpdate);
    return () => window.removeEventListener("media-maintenance-updated", handleUpdate);
  }, []);

  const runBackupNow = async () => {
    if (cloudBackingUp) return;
    setCloudBackingUp(true);
    setCloudTestMsg(null);
    try {
      saveCloudBackupConfig(cloudConfig);
      // Cloud uploads are chunked → large media is fine; always back up in full (incl. images).
      const result = await runCloudBackup(cloudConfig, { force: true, excludeMedia: false, onProgress: setCloudProgress });
      setCloudState(loadCloudBackupState());
      if (result.status === "anomaly") {
        onNotice?.("数据明显变小，已存为待复核备份并保留之前的备份。");
      } else if (result.status === "skipped") {
        onNotice?.("数据没有变化，已跳过本次备份。");
      } else {
        onNotice?.(`已备份：上传 ${result.uploadedModules} 个模块，${formatBytes(result.totalBytes)}。`);
      }
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : "备份失败。");
      setCloudState(loadCloudBackupState());
    } finally {
      setCloudBackingUp(false);
      setCloudProgress(null);
    }
  };

  const openRestore = async () => {
    const next = !showRestore;
    setShowRestore(next);
    if (!next) return;
    setRestoreLoading(true);
    try {
      saveCloudBackupConfig(cloudConfig);
      setRestoreList(await listCloudBackups(cloudConfig));
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : "读取云端备份列表失败。");
      setRestoreList([]);
    } finally {
      setRestoreLoading(false);
    }
  };

  const confirmRestore = (pending: PendingCloudRestore) => runAction("恢复中", async () => {
    try {
      // Cloud restore is a recovery path: "merge" keeps extra local records, but
      // same-ID conflicts should still prefer the backup so partial/empty local
      // shells cannot block a complete cloud backup from coming back.
      const result = await restoreFromCloudManifest(cloudConfig, pending.item.name, { overwrite: true, onProgress: setCloudProgress });
      setRestorePending(null);
      setShowRestore(false);
      if (result.errors.length > 0) {
        console.warn("[DataManagement] cloud restore errors:", result.errors);
      }
      const errorNote = result.errors.length > 0 ? `，${result.errors.length} 项出错` : "";
      const firstError = result.errors[0] ? `首个错误：${result.errors[0]}。` : "";
      return `已从云端恢复：新增 ${result.added}，覆盖 ${result.overwritten}，跳过 ${result.skipped}${errorNote}。${firstError}请刷新应用让缓存重新载入。`;
    } finally {
      setCloudProgress(null);
    }
  });

  const updateCloud = (patch: Partial<CloudBackupConfig>) => {
    setCloudConfig((prev) => {
      const next = { ...prev, ...patch };
      saveCloudBackupConfig(next);
      return next;
    });
    setCloudTestMsg(null);
  };

  const updateMediaMaintenance = (enabled: boolean) => {
    const next = saveMediaMaintenanceConfig({ enabled });
    setMediaConfig(next);
  };

  const testCloud = async () => {
    if (cloudTesting) return;
    setCloudTesting(true);
    setCloudTestMsg(null);
    try {
      saveCloudBackupConfig(cloudConfig);
      const result = await testCloudBackupConnection(cloudConfig);
      setCloudTestMsg(result.ok
        ? { ok: true, text: "连接成功，备份桶已就绪。" }
        : { ok: false, text: result.error });
    } catch (error) {
      setCloudTestMsg({ ok: false, text: error instanceof Error ? error.message : "测试失败。" });
    } finally {
      setCloudTesting(false);
    }
  };

  const moduleChipItems = useMemo<ModuleChipItem[]>(
    () => DATA_MODULES.map((module) => ({ id: module.id, label: module.label })),
    [],
  );
  const pendingImportItems = useMemo<ModuleChipItem[]>(
    () => pendingImport?.envelope.manifest.modules.map((module) => ({
      id: module.id,
      label: module.label,
      meta: `${module.records} 项 · ${formatBytes(module.bytes)}`,
    })) ?? [],
    [pendingImport],
  );
  const reloadStats = async () => {
    const nextSnapshot = await inspectData();
    setSnapshot(nextSnapshot);
    setPersisted(nextSnapshot.storage?.persisted ?? null);
  };

  useEffect(() => {
    setPersistSupported(typeof navigator !== "undefined" && Boolean(navigator.storage?.persist));
    void reloadStats().catch((error) => {
      onNotice?.("读取数据统计失败。");
      console.warn("[DataManagement] inspect failed:", error);
    });
  }, [onNotice]);

  const runAction = async (label: string, action: () => Promise<string | void>) => {
    setBusy(label);
    try {
      const message = await action();
      if (message) onNotice?.(message);
      await reloadStats();
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : "操作失败，请稍后再试。");
      console.warn("[DataManagement] action failed:", error);
    } finally {
      setBusy(null);
    }
  };

  const handleExport = (moduleIds: DataModuleId[]) => {
    if (moduleIds.length === 0) {
      onNotice?.("请选择要导出的模块。");
      return;
    }
    const labels = moduleIds.map(moduleLabel).join("、");
    setConfirmRequest({ type: "export", moduleIds, labels });
  };

  const executeExport = (moduleIds: DataModuleId[]) => runAction("导出中", async () => {
    const { blob, manifest } = await createBackupBlob(moduleIds, { excludeMedia: cloudConfig.excludeMedia });
    const note = manifest.mediaExcluded ? "（不含图片/多媒体）" : "";
    if (isIOSBrowser() || isAndroidBrowser()) {
      setPendingExport({ blob, manifest });
      return `备份文件已生成：${manifest.modules.length} 个模块，${formatBytes(manifest.totalBytes)}${note}。请点“保存备份文件”。`;
    }
    await downloadBackupBlob(blob, manifest, { disableNativeShare: true });
    return `已导出 ${manifest.modules.length} 个模块，${formatBytes(manifest.totalBytes)}${note}。`;
  });

  const savePendingExport = async () => {
    if (!pendingExport || exportSaving) return;
    setExportSaving(true);
    try {
      const useNativeShare = usesNativeShareSheet();
      const savedPath = await downloadBackupBlob(pendingExport.blob, pendingExport.manifest, useNativeShare ? { nativeShareOnly: true } : { disableNativeShare: true });
      setPendingExport(null);
      onNotice?.(
        savedPath ? `已保存到手机存储：${savedPath}`
          : useNativeShare ? "已打开系统分享，请选择“存储到文件”。"
            : "已开始下载备份文件。"
      );
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : "保存失败，请稍后再试。");
    } finally {
      setExportSaving(false);
    }
  };

  const handleFileSelected = async (file: File | undefined) => {
    if (!file) return;
    await runAction("读取备份", async () => {
      const envelope = await readBackupBlob(file);
      setPendingImport({ file, envelope });
      setSelectedImportModules(envelope.manifest.modules.map((module) => module.id));
      return `已读取备份：${envelope.manifest.modules.map((module) => module.label).join("、")}`;
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleImport = (overwrite = false) => {
    if (!pendingImport) {
      onNotice?.("请先选择备份文件。");
      return;
    }
    if (selectedImportModules.length === 0) {
      onNotice?.("请选择要导入的模块。");
      return;
    }
    const labels = selectedImportModules.map(moduleLabel).join("、");
    setConfirmRequest({ type: "import", moduleIds: selectedImportModules, labels, overwrite });
  };

  const executeImport = (moduleIds: DataModuleId[], overwrite = false) => runAction("导入中", async () => {
    if (!pendingImport) return "请先选择备份文件。";
    const result: ImportResult = await importBackupBlob(pendingImport.file, moduleIds, { overwrite });
    setPendingImport(null);
    const summary = `导入完成：新增 ${result.added}，跳过 ${result.skipped}，覆盖 ${result.overwritten}`;
    if (result.errors.length > 0) {
      const firstError = result.errors[0] ? `首个错误：${result.errors[0]}。` : "";
      return `${summary}。错误 ${result.errors.length} 个，${firstError}建议刷新后检查。`;
    }
    return `${summary}。请刷新应用让缓存重新载入。`;
  });

  const handlePersist = () => runAction("申请保护", async () => {
    if (!navigator.storage?.persist) return "当前浏览器不支持持久化存储申请。";
    const ok = await navigator.storage.persist();
    setPersisted(ok);
    return ok ? "已开启浏览器持久化保护。" : "浏览器未授予持久化保护，可继续使用文件备份。";
  });

  const handlePersistToggle = (next: boolean) => {
    if (next) {
      void handlePersist();
      return;
    }
    void runAction("更新保护", async () => "浏览器不允许网页主动关闭持久化保护，请在浏览器的网站设置中撤销或清除站点数据。");
  };

  const handleClearSelected = () => {
    if (selectedClearModules.length === 0) {
      onNotice?.("请选择要清理的模块。");
      return;
    }
    const labels = selectedClearModules.map(moduleLabel).join("、");
    setConfirmRequest({ type: "clear", moduleIds: selectedClearModules, labels });
  };

  const executeClearSelected = (moduleIds: DataModuleId[]) => runAction("清理中", async () => {
    const result = await clearModules(moduleIds);
    setSelectedClearModules([]);
    if (result.errors.length > 0) return `已清理 ${result.removed} 项，另有 ${result.errors.length} 个错误。`;
    return `已清理 ${result.removed} 项。请刷新应用让缓存重新载入。`;
  });

  const executeMediaMaintenance = () => runAction("媒体清理中", async () => {
    const result = await runMediaMaintenance({ force: true });
    setMediaState(loadMediaMaintenanceState());
    return formatMediaMaintenanceResult(result);
  });

  const executeOrphanThemeCleanup = () => runAction("孤儿素材清理中", async () => {
    const result = await cleanupOrphanThemeAssets();
    setMediaState(loadMediaMaintenanceState());
    if (result.deletedAssets === 0) return "没有发现确定无引用的主题素材。";
    return `已删除 ${result.deletedAssets} 个未引用主题素材，预计释放 ${formatBytes(result.freedBytes)}。`;
  });

  const handleConfirmRequest = () => {
    if (!confirmRequest) return;
    const request = confirmRequest;
    setConfirmRequest(null);
    if (request.type === "export") {
      void executeExport(request.moduleIds);
      return;
    }
    if (request.type === "import") {
      void executeImport(request.moduleIds, request.overwrite);
      return;
    }
    if (request.type === "media-maintenance") {
      void executeMediaMaintenance();
      return;
    }
    if (request.type === "orphan-theme") {
      void executeOrphanThemeCleanup();
      return;
    }
    void executeClearSelected(request.moduleIds);
  };

  return (
    <div className="page-menu data-management-menu" style={{ padding: 0 }}>
      <div className="data-section">
        <DataSectionTitle>Module Breakdown</DataSectionTitle>
        <div className="menu-group">
          {snapshot?.modules.length ? (
            <div className="menu-item data-readonly-item data-pie-item">
              <ModulePieChart modules={snapshot.modules} totalBytes={snapshot.totalBytes} />
            </div>
          ) : (
            <div className="menu-item data-readonly-item">
              <DataSettingsIcon icon={Database} color={BINDING_ACCENTS.api} />
              <div className="menu-label-group">
                <span className="menu-label">正在统计</span>
                <span className="menu-desc">读取本地存储中</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="data-section">
        <DataSectionTitle>Local Protection</DataSectionTitle>
        <div className="menu-group">
          <div className="menu-item data-readonly-item">
            <DataSettingsIcon icon={ShieldCheck} color={persisted ? BINDING_ACCENTS.embedding : BINDING_ACCENTS.regex} />
            <div className="menu-label-group">
              <span className="menu-label">浏览器持久化保护</span>
              <span className="menu-desc">{persistSupported ? persisted ? "已开启；关闭需到浏览器网站设置中撤销" : "降低被自动清理的概率，但不能替代备份" : "当前浏览器不支持持久化申请，请依赖文件备份"}</span>
            </div>
            <span className="menu-right">
              <Toggle checked={Boolean(persisted)} onChange={handlePersistToggle} disabled={!persistSupported || Boolean(busy && !persisted)} />
            </span>
          </div>
        </div>
      </div>

      <div className="data-section">
        <DataSectionTitle>Media Cleanup</DataSectionTitle>
        <div className="menu-group">
          <div className="menu-item data-readonly-item">
            <DataSettingsIcon icon={Archive} color={CONTENT_APP_ACCENTS.moments} />
            <div className="menu-label-group">
              <span className="menu-label">图片/多媒体文件自动压缩及清理</span>
              <span className="menu-desc">开启后每天最多执行一次：4 天以上压缩聊天、朋友圈、小红书动态图片；7 天以上清理聊天图片、朋友圈/小红书真实图和本地音乐。壁纸、图标、dock、字体等常驻资源不纳入自动清理。</span>
            </div>
            <span className="menu-right">
              <Toggle checked={mediaConfig.enabled} onChange={updateMediaMaintenance} disabled={Boolean(busy)} />
            </span>
          </div>
          <div className="menu-item data-readonly-item">
            <div className="menu-label-group">
              <span className="menu-label">清理状态</span>
              <span className="menu-desc">
                {mediaState.lastRunAt ? `上次执行：${formatTime(mediaState.lastRunAt)}。` : "尚未执行。"}
                {mediaState.lastResult ? formatMediaMaintenanceResult(mediaState.lastResult) : ""}
                {mediaState.lastError ? ` 最近错误：${mediaState.lastError}` : ""}
              </span>
            </div>
          </div>
          <div className="data-menu-actions">
            <button
              type="button"
              className={`ui-btn ui-btn-primary ${busy === "媒体清理中" ? "is-busy" : ""}`}
              onClick={() => setConfirmRequest({ type: "media-maintenance" })}
              disabled={Boolean(busy)}
            >
              {busy === "媒体清理中" ? <><Loader2 size={16} className="animate-spin" /> 执行中…</> : <><Archive size={16} /> 立即执行</>}
            </button>
            <button
              type="button"
              className={`ui-btn ui-btn-outline ${busy === "孤儿素材清理中" ? "is-busy" : ""}`}
              onClick={() => setConfirmRequest({ type: "orphan-theme" })}
              disabled={Boolean(busy)}
            >
              {busy === "孤儿素材清理中" ? <><Loader2 size={16} className="animate-spin" /> 清理中…</> : <><Trash2 size={16} /> 清理未引用主题素材</>}
            </button>
          </div>
        </div>
      </div>

      <div className="data-section">
        <DataSectionTitle>Export & Import</DataSectionTitle>
        <div className="menu-group">
          <div className="menu-item data-readonly-item">
            <div className="menu-label-group">
              <span className="menu-label">本地导出·不含图片/多媒体</span>
              <span className="menu-desc">仅【本地导出备份文件】生效：去掉壁纸、聊天图、朋友圈图等大文件（保留角色头像），文件更小、导出不卡。云端备份已支持分片上传，会完整备份图片，不受此开关影响。</span>
            </div>
            <span className="menu-right">
              <Toggle checked={cloudConfig.excludeMedia} onChange={(checked) => updateCloud({ excludeMedia: checked })} />
            </span>
          </div>
          <div className="menu-item data-readonly-item">
            <div className="menu-label-group">
              <span className="menu-label">导出模块</span>
              <span className="menu-desc">已选择 {selectedExportModules.length} / {DATA_MODULES.length} 个模块</span>
            </div>
            <div className="menu-right data-inline-actions">
              <button type="button" className="ui-btn ui-btn-outline py-1 px-3 ts-12" onClick={() => setSelectedExportModules(ALL_MODULE_IDS)}>
                全选
              </button>
              <button type="button" className="ui-btn ui-btn-outline py-1 px-3 ts-12" onClick={() => setSelectedExportModules(getLightModuleIds())}>
                轻量
              </button>
            </div>
          </div>
          <div className="data-chip-panel">
            <ModuleChipSelector
              items={moduleChipItems}
              selectedIds={selectedExportModules}
              onChange={setSelectedExportModules}
              ariaLabel="选择导出模块"
            />
          </div>
          <div className="data-menu-actions">
            <button type="button" className={`ui-btn ui-btn-primary ${busy === "导出中" ? "is-busy" : ""}`} onClick={() => handleExport(selectedExportModules)} disabled={Boolean(busy)}>
              {busy === "导出中" ? <><Loader2 size={16} className="animate-spin" /> 导出中…</> : <><Download size={16} /> 导出备份</>}
            </button>
            <button type="button" className={`ui-btn ui-btn-outline ${busy === "读取备份" ? "is-busy" : ""}`} onClick={() => fileInputRef.current?.click()} disabled={Boolean(busy)}>
              {busy === "读取备份" ? <><Loader2 size={16} className="animate-spin" /> 读取中…</> : <><Upload size={16} /> 导入备份</>}
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".aiphone,.zip,application/zip"
            className="hidden"
            onChange={(event) => void handleFileSelected(event.target.files?.[0])}
          />
        </div>
      </div>

      <div className="data-section">
        <DataSectionTitle>Cloud Backup</DataSectionTitle>
        <div className="menu-group">
          <div className="menu-item data-readonly-item">
            <DataSettingsIcon icon={CloudUpload} color={BINDING_ACCENTS.api} />
            <div className="menu-label-group">
              <span className="menu-label">备份到你的 Supabase</span>
              <span className="menu-desc">填入你自己的 Supabase 地址与 service_role key，点测试连接会自动建好备份桶（无需手动设置）。</span>
            </div>
          </div>

          <div className="data-cloud-form">
            <label className="data-cloud-field">
              <span className="menu-desc ml-1">Supabase 地址 (URL)</span>
              <Input
                value={cloudConfig.url}
                onChange={(e) => updateCloud({ url: e.target.value })}
                placeholder="https://xxxx.supabase.co"
                spellCheck={false}
              />
            </label>
            <label className="data-cloud-field">
              <span className="menu-desc ml-1">service_role key</span>
              <Input
                type="password"
                value={cloudConfig.key}
                onChange={(e) => updateCloud({ key: e.target.value })}
                placeholder="eyJhbGci..."
                spellCheck={false}
              />
            </label>

            <div className="data-cloud-actions">
              <button
                type="button"
                className={`ui-btn ui-btn-outline ${cloudTesting ? "is-busy" : ""}`}
                onClick={() => void testCloud()}
                disabled={cloudTesting || cloudBackingUp || !isCloudBackupConfigured(cloudConfig)}
              >
                {cloudTesting ? <><Loader2 size={16} className="animate-spin" /> 测试中…</> : "测试连接"}
              </button>
              <button
                type="button"
                className={`ui-btn ui-btn-primary ${cloudBackingUp ? "is-busy" : ""}`}
                onClick={() => void runBackupNow()}
                disabled={cloudTesting || cloudBackingUp || !isCloudBackupConfigured(cloudConfig)}
              >
                {cloudBackingUp ? <><Loader2 size={16} className="animate-spin" /> 备份中…</> : <><CloudUpload size={16} /> 立即备份</>}
              </button>
              <button
                type="button"
                className="ui-btn ui-btn-ghost"
                onClick={() => void openRestore()}
                disabled={cloudBackingUp || !isCloudBackupConfigured(cloudConfig)}
              >
                <CloudDownload size={16} /> {showRestore ? "收起" : "云端恢复"}
              </button>
            </div>

            {cloudBackingUp && cloudProgress && (
              <div className="data-cloud-progress" role="status">
                <div className="data-cloud-progress-track">
                  <div className="data-cloud-progress-fill" style={{ width: `${Math.min(100, Math.round(cloudProgress.percent))}%` }} />
                </div>
                <span className="data-cloud-progress-text">{cloudProgress.detail} · {Math.round(cloudProgress.percent)}%</span>
              </div>
            )}

            {cloudTestMsg && (
              <div className={`data-cloud-result ${cloudTestMsg.ok ? "is-ok" : "is-err"}`} role="status">
                {cloudTestMsg.text}
              </div>
            )}

            {cloudState.lastCreatedAt && (
              <div className="data-cloud-status">
                上次备份：{formatTime(cloudState.lastCreatedAt)}
                {typeof cloudState.lastTotalBytes === "number" ? ` · ${formatBytes(cloudState.lastTotalBytes)}` : ""}
                {cloudState.lastResult === "anomaly" ? " · ⚠️ 待复核（数据异常变小）" : ""}
                {cloudState.lastResult === "skipped" ? " · 无变化已跳过" : ""}
              </div>
            )}

            {showRestore && (
              <div className="data-cloud-restore">
                <label className="data-cloud-restore-overwrite">
                  <input type="checkbox" checked={restoreOverwrite} onChange={(e) => setRestoreOverwrite(e.target.checked)} />
                  <span>覆盖恢复提醒（不勾选则合并；同 ID 仍以云端为准）</span>
                </label>
                {busy === "恢复中" ? (
                  <div className="data-cloud-progress" role="status">
                    <div className="data-cloud-progress-track">
                      <div className="data-cloud-progress-fill" style={{ width: `${Math.min(100, Math.round(cloudProgress?.percent ?? 0))}%` }} />
                    </div>
                    <span className="data-cloud-progress-text">
                      {cloudProgress ? `${cloudProgress.detail} · ${Math.round(cloudProgress.percent)}%` : "正在从云端恢复，请稍候…"}
                    </span>
                  </div>
                ) : restoreLoading ? (
                  <div className="data-cloud-status"><Loader2 size={14} className="animate-spin" /> 读取云端备份…</div>
                ) : restoreList.length === 0 ? (
                  <div className="data-cloud-status">云端还没有备份。</div>
                ) : (
                  <ul className="data-cloud-restore-list">
                    {restoreList.map((item) => (
                      <li key={item.name} className="data-cloud-restore-item">
                        <div className="menu-label-group">
                          <span className="menu-label">{formatTime(item.createdAt)}{item.quarantine ? " · 待复核" : ""}</span>
                          <span className="menu-desc">{formatBytes(item.totalBytes)} · {item.totalRecords} 项</span>
                        </div>
                        <button
                          type="button"
                          className="ui-btn ui-btn-outline py-1 px-3 ts-12"
                          onClick={() => setRestorePending({ item, overwrite: restoreOverwrite })}
                          disabled={Boolean(busy)}
                        >
                          恢复
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <div className="menu-item data-readonly-item">
            <div className="menu-label-group">
              <span className="menu-label">自动备份</span>
              <span className="menu-desc">开启后按间隔在后台静默备份。</span>
            </div>
            <span className="menu-right">
              <Toggle
                checked={cloudConfig.enabled}
                onChange={(checked) => updateCloud({ enabled: checked })}
                disabled={!isCloudBackupConfigured(cloudConfig)}
              />
            </span>
          </div>

          <div className="data-cloud-options">
            <label className="data-cloud-field">
              <span className="menu-desc ml-1">备份间隔</span>
              <Select
                value={String(cloudConfig.intervalHours)}
                onChange={(e) => updateCloud({ intervalHours: Number(e.target.value) })}
                disabled={!cloudConfig.enabled}
              >
                <option value="0.5">每 30 分钟</option>
                <option value="1">每小时</option>
                <option value="6">每 6 小时</option>
                <option value="12">每 12 小时</option>
                <option value="24">每天</option>
              </Select>
            </label>
            <label className="data-cloud-field">
              <span className="menu-desc ml-1">保留份数</span>
              <Select
                value={String(cloudConfig.keepCount)}
                onChange={(e) => updateCloud({ keepCount: Number(e.target.value) })}
                disabled={!cloudConfig.enabled}
              >
                <option value="2">2 份</option>
                <option value="3">3 份</option>
              </Select>
            </label>
          </div>
        </div>
      </div>

      {pendingExport && (
        <div className="modal-overlay" data-ui="modal" onClick={() => { if (!exportSaving) setPendingExport(null); }}>
          <div className="modal-dialog data-import-modal" data-ui="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header" data-ui="modal-header">
              <h3 className="modal-title">保存备份文件</h3>
            </div>
            <div className="modal-body" data-ui="modal-body" style={{ textAlign: "left", width: "100%" }}>
              <p className="menu-desc" style={{ marginBottom: 12 }}>
                {pendingExport.manifest.modules.length} 个模块 · {formatBytes(pendingExport.manifest.totalBytes)}
                {pendingExport.manifest.mediaExcluded ? " · 不含图片/多媒体" : ""}
              </p>
              <p className="menu-desc">
                {Capacitor.isNativePlatform()
                  ? "点击下方按钮，会直接保存到手机存储的 Documents 目录。"
                  : isIOSBrowser()
                    ? "需要从系统分享面板保存备份文件。请点击下方按钮，然后选择“存储到文件”。"
                    : "备份文件已准备好。请点击下方按钮下载文件。"}
              </p>
            </div>
            <div className="modal-footer" data-ui="modal-footer" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button type="button" className="ui-btn ui-btn-primary" style={{ width: "100%", whiteSpace: "nowrap" }} onClick={() => void savePendingExport()} disabled={exportSaving}>
                {exportSaving
                  ? <><Loader2 size={16} className="animate-spin" /> {usesNativeShareSheet() ? "打开中…" : "下载中…"}</>
                  : usesNativeShareSheet()
                    ? <><Share2 size={16} /> 分享/保存文件</>
                    : <><Download size={16} /> 下载备份文件</>}
              </button>
              <button type="button" className="ui-btn ui-btn-outline" style={{ width: "100%", whiteSpace: "nowrap" }} onClick={() => setPendingExport(null)} disabled={exportSaving}>取消</button>
            </div>
          </div>
        </div>
      )}

      {pendingImport && (
        <div className="modal-overlay" data-ui="modal" onClick={() => { if (!busy) setPendingImport(null); }}>
          <div className="modal-dialog data-import-modal" data-ui="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header" data-ui="modal-header">
              <h3 className="modal-title">导入备份</h3>
            </div>
            <div className="modal-body" data-ui="modal-body" style={{ textAlign: "left", width: "100%" }}>
              <p className="menu-desc" style={{ marginBottom: 12 }}>
                {formatTime(pendingImport.envelope.manifest.createdAt)} · {formatBytes(pendingImport.envelope.manifest.totalBytes)}
                {pendingImport.envelope.manifest.mediaExcluded ? " · 不含图片" : ""}
              </p>
              <div className="data-inline-actions" style={{ marginBottom: 10 }}>
                <span className="menu-desc" style={{ marginRight: "auto" }}>选择要导入的模块（{selectedImportModules.length} / {pendingImportItems.length}）</span>
                <button type="button" className="ui-btn ui-btn-outline py-1 px-3 ts-12" onClick={() => setSelectedImportModules(pendingImportItems.map((item) => item.id))}>全选</button>
                <button type="button" className="ui-btn ui-btn-outline py-1 px-3 ts-12" onClick={() => setSelectedImportModules([])}>清空</button>
              </div>
              <div className="data-chip-panel">
                <ModuleChipSelector
                  items={pendingImportItems}
                  selectedIds={selectedImportModules}
                  onChange={setSelectedImportModules}
                  ariaLabel="选择导入模块"
                />
              </div>
            </div>
            <div className="modal-footer" data-ui="modal-footer" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button type="button" className="ui-btn ui-btn-primary" style={{ width: "100%", whiteSpace: "nowrap" }} onClick={() => handleImport(false)} disabled={Boolean(busy)}>
                {busy === "导入中" ? <Loader2 size={16} className="animate-spin" /> : null} 合并导入
              </button>
              <button type="button" className="ui-btn ui-btn-outline" style={{ width: "100%", whiteSpace: "nowrap" }} onClick={() => handleImport(true)} disabled={Boolean(busy)}>
                {busy === "导入中" ? <Loader2 size={16} className="animate-spin" /> : null} 覆盖导入
              </button>
              <button type="button" className="ui-btn ui-btn-outline" style={{ width: "100%", whiteSpace: "nowrap" }} onClick={() => setPendingImport(null)} disabled={Boolean(busy)}>取消</button>
            </div>
          </div>
        </div>
      )}

      <div className="data-section data-cleanup-section">
        <DataSectionTitle>Module Cleanup</DataSectionTitle>
        <div className="data-danger-alert" role="note" aria-label="危险操作提示">
          <span className="data-danger-icon" aria-hidden="true">
            <AlertTriangle size={17} strokeWidth={2.1} />
          </span>
          <div className="data-danger-copy">
            <span>危险操作</span>
            <p>清理会删除所选模块的本地数据。执行前请先导出备份，误删后只能通过备份文件恢复。</p>
          </div>
        </div>
        <div className="menu-group">
          <div className="menu-item data-readonly-item">
            <DataSettingsIcon icon={Trash2} color="#E5484D" />
            <div className="menu-label-group">
              <span className="menu-label">清理模块</span>
              <span className="menu-desc">已选择 {selectedClearModules.length} / {DATA_MODULES.length} 个模块，清理前会先尝试备份</span>
            </div>
            <div className="menu-right data-inline-actions">
              <button type="button" className="ui-btn ui-btn-outline py-1 px-3 ts-12" onClick={() => setSelectedClearModules([])}>
                清空
              </button>
            </div>
          </div>
          <div className="data-chip-panel">
            <ModuleChipSelector
              items={moduleChipItems}
              selectedIds={selectedClearModules}
              onChange={setSelectedClearModules}
              ariaLabel="选择清理模块"
            />
          </div>
          <div className="data-menu-actions data-menu-actions-single">
            <button type="button" className="ui-btn ui-btn-danger" onClick={handleClearSelected} disabled={Boolean(busy)}>
              <Trash2 size={16} /> 清理选中模块
            </button>
          </div>
        </div>
      </div>

      {confirmRequest && (
        <ConfirmDialog
          title={
            confirmRequest.type === "export"
              ? "确认导出备份？"
              : confirmRequest.type === "import"
                ? confirmRequest.overwrite ? "确认覆盖导入？" : "确认合并导入？"
                : confirmRequest.type === "media-maintenance"
                  ? "确认立即清理媒体？"
                  : confirmRequest.type === "orphan-theme"
                    ? "确认清理未引用主题素材？"
                    : "确认清理模块？"
          }
          message={
            confirmRequest.type === "export"
              ? `将导出以下模块：${confirmRequest.labels}。是否继续？`
              : confirmRequest.type === "import"
                ? confirmRequest.overwrite
                  ? `覆盖导入会用备份中的数据覆盖已选模块：${confirmRequest.labels}。建议先导出当前数据。是否继续？`
                  : `将合并导入以下模块：${confirmRequest.labels}。列表型数据会按 ID 去重合并，同 ID 项以备份为准。是否继续？`
                : confirmRequest.type === "media-maintenance"
                  ? "将按规则压缩/清理过期动态媒体：4 天以上压缩图片，7 天以上清理聊天图片、朋友圈/小红书真实图和本地音乐，并清理确定无引用的旧主题素材。壁纸、图标、dock、字体等仍在引用的常驻资源不会删除。是否继续？"
                  : confirmRequest.type === "orphan-theme"
                    ? "将扫描当前仍被引用的主题素材，只删除确定无引用的旧图片、旧字体、旧 dock、旧图标皮肤等素材。是否继续？"
                    : `清理 ${confirmRequest.labels} 会删除对应数据。建议先备份。是否继续？`
          }
          icon={confirmRequest.type === "export" ? Download : confirmRequest.type === "import" ? Upload : confirmRequest.type === "media-maintenance" ? Archive : AlertTriangle}
          variant={confirmRequest.type === "clear" || confirmRequest.type === "media-maintenance" || confirmRequest.type === "orphan-theme" || (confirmRequest.type === "import" && confirmRequest.overwrite) ? "danger" : "action"}
          confirmLabel={
            confirmRequest.type === "export"
              ? "确认导出"
              : confirmRequest.type === "import"
                ? confirmRequest.overwrite ? "确认覆盖" : "确认导入"
                : confirmRequest.type === "media-maintenance"
                  ? "立即执行"
                  : "确认清理"
          }
          onConfirm={handleConfirmRequest}
          onCancel={() => setConfirmRequest(null)}
        />
      )}

      {restorePending && (
        <ConfirmDialog
          title={restorePending.overwrite ? "确认覆盖恢复？" : "确认合并恢复？"}
          message={
            restorePending.overwrite
              ? `将用 ${formatTime(restorePending.item.createdAt)} 这份云端备份覆盖本机同 ID 数据。建议先「立即备份」当前数据。是否继续？`
              : `将把 ${formatTime(restorePending.item.createdAt)} 这份云端备份合并到本机数据；本机没有的数据会新增，同 ID 数据以备份为准。是否继续？`
          }
          icon={CloudDownload}
          variant={restorePending.overwrite ? "danger" : "action"}
          confirmLabel={restorePending.overwrite ? "确认覆盖" : "确认合并"}
          onConfirm={() => { const pending = restorePending; setRestorePending(null); if (pending) void confirmRestore(pending); }}
          onCancel={() => setRestorePending(null)}
        />
      )}
    </div>
  );
}
