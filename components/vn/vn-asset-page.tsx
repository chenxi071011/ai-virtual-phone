"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Eraser, ImagePlus, Loader2, Trash2, User, Mountain, AlertCircle } from "lucide-react";
import { loadCharacters } from "@/lib/character-storage";
import {
  loadVnScenes,
  addVnScene,
  deleteVnScene,
  loadVnSprites,
  addVnSprite,
  deleteVnSprite,
  updateVnSceneLayout,
  updateVnSpriteLayout,
  type VnSceneAsset,
  type VnSpriteAsset,
  type VnAssetLayout,
} from "@/lib/vn-asset-storage";
import { getThemeAssetDataUrl, saveThemeAssetFromBlob } from "@/lib/theme-storage";
import { removeConnectedEdgeBackgroundFromDataUrl } from "@/lib/image-background-removal";
import { ConfirmDialog } from "@/components/ui/modal";

type Tab = "scenes" | "sprites";

interface VnAssetPageProps {
  onNotice?: (msg: string) => void;
}

export function VnAssetPage({ onNotice }: VnAssetPageProps) {
  const [tab, setTab] = useState<Tab>("scenes");
  const [scenes, setScenes] = useState<VnSceneAsset[]>([]);
  const [sprites, setSprites] = useState<VnSpriteAsset[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [selectedCharId, setSelectedCharId] = useState<string>("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingName, setPendingName] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editingLayoutAsset, setEditingLayoutAsset] = useState<{ id: string; type: "scene" | "sprite"; name: string; layout: VnAssetLayout } | null>(null);
  const [removingBackgroundAssetId, setRemovingBackgroundAssetId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const characters = loadCharacters();

  // Load data
  const reload = useCallback(() => {
    setScenes(loadVnScenes());
    setSprites(loadVnSprites());
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // Load thumbnails for visible assets
  useEffect(() => {
    const items = tab === "scenes" ? scenes : sprites;
    const missing = items.filter((i) => !thumbs[i.assetId]).map((i) => i.assetId);
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const newThumbs: Record<string, string> = {};
      for (const id of missing) {
        if (cancelled) break;
        const url = await getThemeAssetDataUrl(id);
        if (url) newThumbs[id] = url;
      }
      if (!cancelled) setThumbs((prev) => ({ ...prev, ...newThumbs }));
    })();
    return () => { cancelled = true; };
  }, [tab, scenes, sprites, thumbs]);

  // Step 1: file selected → show naming dialog
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (tab === "sprites" && !selectedCharId) {
      onNotice?.("请先选择角色");
      e.target.value = "";
      return;
    }
    const defaultName = file.name.replace(/\.[^.]+$/, "").slice(0, 30);
    setPendingFile(file);
    setPendingName(defaultName);
    e.target.value = "";
    setTimeout(() => nameInputRef.current?.focus(), 100);
  }, [tab, selectedCharId, onNotice]);

  // Step 2: confirm name → save
  const handleConfirmAdd = useCallback(async () => {
    if (!pendingFile || !pendingName.trim()) return;
    const name = pendingName.trim();
    const charId = selectedCharId;
    if (tab === "scenes") {
      await addVnScene(charId, name, pendingFile);
      onNotice?.(`已添加场景「${name}」${charId ? "" : "（所有角色）"}`);
    } else {
      if (!charId) return; // sprites require a character
      await addVnSprite(charId, name, pendingFile);
      onNotice?.(`已添加立绘「${name}」`);
    }
    setPendingFile(null);
    setPendingName("");
    reload();
  }, [pendingFile, pendingName, selectedCharId, tab, reload, onNotice]);

  const handleCancelAdd = useCallback(() => {
    setPendingFile(null);
    setPendingName("");
  }, []);

  // Delete
  const handleDeleteScene = useCallback(async (id: string) => {
    await deleteVnScene(id);
    reload();
  }, [reload]);

  const handleDeleteSprite = useCallback(async (id: string) => {
    await deleteVnSprite(id);
    reload();
  }, [reload]);

  const handleRemoveSpriteBackground = useCallback(async (assetId: string, imageDataUrl: string) => {
    if (!assetId || !imageDataUrl || removingBackgroundAssetId) return;
    setRemovingBackgroundAssetId(assetId);
    try {
      const result = await removeConnectedEdgeBackgroundFromDataUrl(imageDataUrl, { tolerance: 42, feather: 2 });
      await saveThemeAssetFromBlob(result.blob, "vn_sprite", assetId);
      const refreshed = await getThemeAssetDataUrl(assetId);
      if (refreshed) {
        setThumbs((prev) => ({ ...prev, [assetId]: refreshed }));
      }
      onNotice?.(result.removedPixels > 0 ? "已去除立绘边缘底色" : "没有检测到可去除的边缘底色");
    } catch (error) {
      console.error("[VN] remove sprite background failed", error);
      onNotice?.("去底失败，请换一张图片或稍后重试");
    } finally {
      setRemovingBackgroundAssetId(null);
    }
  }, [onNotice, removingBackgroundAssetId]);

  const filteredScenes = selectedCharId
    ? scenes.filter((s) => s.characterId === selectedCharId)
    : scenes;

  const filteredSprites = selectedCharId
    ? sprites.filter((s) => s.characterId === selectedCharId)
    : sprites;
  const visibleCount = tab === "scenes" ? filteredScenes.length : filteredSprites.length;
  const phoneScreen = typeof document !== "undefined"
    ? document.querySelector("[data-ui='phone-screen']") as HTMLElement | null
    : null;
  const phoneScreenRect = phoneScreen?.getBoundingClientRect();
  const vnViewportWidth = phoneScreenRect?.width || (typeof window !== "undefined" ? window.innerWidth : 390);
  const vnViewportHeight = phoneScreenRect?.height || (typeof window !== "undefined" ? window.innerHeight : 844);
  const vnViewportAspectRatio = `${vnViewportWidth} / ${vnViewportHeight}`;
  const vnViewportRatio = vnViewportWidth / Math.max(vnViewportHeight, 1);
  const layoutPreviewWidth = Math.max(160, Math.min(270, vnViewportWidth - 64, (vnViewportHeight - 240) * vnViewportRatio));
  const layoutPreviewStyle = {
    "--vna-layout-preview-width": `${layoutPreviewWidth}px`,
    "--vna-viewport-aspect-ratio": vnViewportAspectRatio,
  } as CSSProperties;
  const portalTarget = typeof document !== "undefined" ? phoneScreen ?? document.body : null;

  return (
    <div className="vna-page">
      <style>{`
        .vna-page {
          padding: 16px 20px 32px;
          display: flex;
          flex-direction: column;
          gap: 18px;
          overflow-y: auto;
          scrollbar-width: none;
        }
        .vna-page::-webkit-scrollbar {
          display: none;
        }
        .vna-studio {
          display: flex;
          flex-direction: column;
          overflow: hidden;
          border-radius: 32px;
          border: 1px solid rgba(255,255,255,0.6);
          background: rgba(255,255,255,0.4);
          backdrop-filter: blur(28px);
          -webkit-backdrop-filter: blur(28px);
          box-shadow: 0 30px 60px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.5);
        }
        .vna-studio-header {
          display: flex;
          flex-direction: column;
          gap: 14px;
          padding: 18px;
          background: rgba(255,255,255,0.5);
          border-bottom: 1px solid rgba(0,0,0,0.05);
        }

        /* ── Tabs ── */
        .vna-tabs {
          display: inline-flex;
          align-self: center;
          gap: 0;
          padding: 4px;
          border-radius: 999px;
          background: rgba(0,0,0,0.05);
          box-shadow: inset 0 1px 3px rgba(0,0,0,0.04);
        }
        .vna-tab {
          width: 96px;
          padding: 7px 0;
          border-radius: 999px;
          border: none;
          background: transparent;
          color: #6b7280;
          font-size: calc(11.7px*var(--app-text-scale,1));
          font-weight: 700;
          font-family: inherit;
          cursor: pointer;
          position: relative;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
        }
        .vna-tab[data-active="true"] {
          color: #111827;
          background: rgba(255,255,255,0.92);
          box-shadow: 0 4px 12px rgba(0,0,0,0.08);
        }

        /* ── Add bar ── */
        .vna-add-bar {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          gap: 10px;
          align-items: center;
          padding: 10px;
          border-radius: 18px;
          background: rgba(255,255,255,0.6);
          box-shadow: inset 0 1px 3px rgba(0,0,0,0.03);
        }
        .vna-add-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          min-height: 40px;
          padding: 0 14px;
          border-radius: 14px;
          border: none;
          background: #111;
          color: #fff;
          font-size: calc(10.8px*var(--app-text-scale,1));
          font-weight: 700;
          font-family: inherit;
          cursor: pointer;
          box-shadow: 0 8px 18px rgba(0,0,0,0.14);
          transition: all 0.2s;
        }
        .vna-add-btn:active {
          transform: scale(0.96);
          opacity: 0.9;
        }

        /* ── Character filter (for sprites tab) ── */
        .vna-select-shell {
          position: relative;
          min-width: 0;
        }
        .vna-select-shell::after {
          content: "";
          position: absolute;
          right: 14px;
          top: 50%;
          width: 7px;
          height: 7px;
          border-right: 1.5px solid #6b7280;
          border-bottom: 1.5px solid #6b7280;
          transform: translateY(-65%) rotate(45deg);
          pointer-events: none;
        }
        .vna-char-select {
          width: 100%;
          min-height: 40px;
          padding: 0 32px 0 12px;
          border-radius: 14px;
          border: 1px solid transparent;
          background: rgba(0,0,0,0.05);
          color: #374151;
          font-size: calc(10.8px*var(--app-text-scale,1));
          font-weight: 700;
          font-family: inherit;
          outline: none;
          appearance: none;
          -webkit-appearance: none;
          box-shadow: inset 0 1px 3px rgba(0,0,0,0.04);
        }
        .vna-assets-body {
          display: flex;
          flex-direction: column;
          gap: 14px;
          padding: 18px 18px 22px;
        }
        .vna-assets-heading {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .vna-assets-title {
          margin: 0;
          color: #111827;
          font-size: calc(12.6px*var(--app-text-scale,1));
          font-weight: 800;
          line-height: 1.2;
        }
        .vna-assets-subtitle {
          display: block;
          margin-top: 4px;
          color: #6b7280;
          font-size: calc(9.9px*var(--app-text-scale,1));
          font-weight: 600;
          line-height: 1.35;
        }
        .vna-count {
          flex-shrink: 0;
          padding: 5px 10px;
          border-radius: 999px;
          background: rgba(255,255,255,0.68);
          color: #6b7280;
          font-size: calc(9.9px*var(--app-text-scale,1));
          font-weight: 800;
        }

        /* ── Asset grid ── */
        .vna-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 14px;
        }
        .vna-card {
          position: relative;
          border-radius: 22px;
          overflow: hidden;
          border: 1px solid rgba(255,255,255,0.76);
          background: rgba(255,255,255,0.56);
          aspect-ratio: 3 / 4;
          box-shadow: 0 14px 30px rgba(0,0,0,0.08);
          cursor: pointer;
          transition: transform 0.18s ease, box-shadow 0.18s ease;
        }
        .vna-card:active {
          transform: scale(0.98);
          box-shadow: 0 10px 22px rgba(0,0,0,0.08);
        }
        .vna-card-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .vna-card[data-kind="sprite"] .vna-card-img {
          object-fit: contain;
          object-position: center bottom;
          background: #0a0a14;
        }
        .vna-card-sprite-preview {
          position: relative;
          width: 100%;
          height: 100%;
          overflow: hidden;
          background: #0a0a14;
        }
        .vna-card-sprite-img {
          position: absolute;
          inset: 0;
          background-size: contain;
          background-repeat: no-repeat;
          background-position: center bottom;
          transform-origin: center bottom;
        }
        .vna-card-placeholder {
          width: 100%;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #9ca3af;
          background:
            linear-gradient(rgba(0,0,0,0.045) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,0,0,0.045) 1px, transparent 1px),
            #f4f5f7;
          background-size: 18px 18px;
        }
        .vna-card-info {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          padding: 30px 12px 10px;
          background: linear-gradient(0deg, rgba(0,0,0,0.68) 0%, rgba(0,0,0,0.24) 54%, transparent 100%);
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          gap: 8px;
        }
        .vna-card-name {
          font-size: calc(9.9px*var(--app-text-scale,1));
          color: rgba(255,255,255,0.92);
          font-weight: 800;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          min-width: 0;
        }
        .vna-card-del {
          width: 26px;
          height: 26px;
          border-radius: 50%;
          border: none;
          background: rgba(255,255,255,0.22);
          color: rgba(255,255,255,0.9);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          transition: all 0.2s;
        }
        .vna-card-del:active {
          background: rgba(239,68,68,0.72);
          transform: scale(0.94);
        }

        /* ── Naming dialog ── */
        .vna-naming-overlay {
          position: fixed;
          inset: 0;
          z-index: 100000;
          background: rgba(0,0,0,0.36);
          backdrop-filter: blur(6px);
          -webkit-backdrop-filter: blur(6px);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .vna-naming-dialog {
          width: min(320px, 85vw);
          background: rgba(255,255,255,0.92);
          border: 1px solid rgba(255,255,255,0.76);
          border-radius: 28px;
          padding: 24px 22px 22px;
          display: flex;
          flex-direction: column;
          gap: 16px;
          box-shadow: 0 30px 70px rgba(0,0,0,0.18);
        }
        .vna-naming-title {
          font-size: calc(15.3px*var(--app-text-scale,1));
          font-weight: 800;
          color: #111827;
          text-align: center;
        }
        .vna-naming-hint {
          font-size: calc(10.8px*var(--app-text-scale,1));
          color: #6b7280;
          font-weight: 600;
          text-align: center;
          line-height: 1.45;
        }
        .vna-naming-input {
          padding: 12px 14px;
          border-radius: 16px;
          border: 1px solid transparent;
          background: rgba(0,0,0,0.05);
          color: #111827;
          font-size: calc(12.6px*var(--app-text-scale,1));
          font-weight: 700;
          font-family: inherit;
          outline: none;
          box-shadow: inset 0 1px 3px rgba(0,0,0,0.04);
        }
        .vna-naming-input:focus {
          border-color: rgba(59,130,246,0.45);
          background: rgba(255,255,255,0.86);
        }
        .vna-naming-btns {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }
        .vna-naming-btn {
          min-height: 44px;
          border-radius: 16px;
          border: none;
          background: rgba(0,0,0,0.05);
          color: #374151;
          font-size: calc(12.6px*var(--app-text-scale,1));
          font-weight: 800;
          font-family: inherit;
          cursor: pointer;
          transition: all 0.2s;
        }
        .vna-naming-btn:active {
          transform: scale(0.96);
          opacity: 0.9;
        }
        .vna-naming-btn[data-primary="true"] {
          background: #111;
          color: #fff;
          box-shadow: 0 10px 24px rgba(0,0,0,0.14);
        }
        .vna-naming-btn:disabled {
          opacity: 0.42;
          cursor: not-allowed;
          transform: none;
        }

        /* ── Empty state ── */
        .vna-empty {
          padding: 38px 18px;
          border-radius: 24px;
          border: 2px dashed rgba(156,163,175,0.35);
          background: rgba(255,255,255,0.3);
          text-align: center;
          color: #6b7280;
          font-size: calc(11.7px*var(--app-text-scale,1));
          font-weight: 800;
        }
        .vna-empty-hint {
          font-size: calc(9.9px*var(--app-text-scale,1));
          color: #9ca3af;
          margin-top: 8px;
          font-weight: 600;
          line-height: 1.45;
        }
        .vna-layout-overlay {
          position: fixed;
          inset: 0;
          z-index: 100000;
        }
        .vna-layout-dialog {
          width: min(calc(var(--vna-layout-preview-width, 260px) + 24px), calc(100vw - 48px));
          max-width: calc(100vw - 48px);
          max-height: calc(var(--vh-dyn) - 72px);
          padding: 12px;
          gap: 10px;
        }
        .vna-layout-dialog .modal-body {
          flex: 0 0 auto;
          overflow: visible;
        }
        .vna-layout-preview {
          position: relative;
          width: var(--vna-layout-preview-width, 260px);
          aspect-ratio: var(--vna-viewport-aspect-ratio, 390 / 844);
          max-width: 100%;
          margin: 0 auto 10px;
          border-radius: 8px;
          overflow: hidden;
          background: #0a0a14;
          border: 1px solid var(--c-card-border);
        }
        .vna-remove-bg-btn {
          position: absolute;
          top: 8px;
          right: 8px;
          z-index: 5;
          width: 38px;
          height: 38px;
          border: 1px solid rgba(255,255,255,0.72);
          border-radius: 999px;
          background: rgba(20,20,28,0.58);
          color: rgba(255,255,255,0.94);
          box-shadow: 0 10px 24px rgba(0,0,0,0.22);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: transform 0.16s ease, opacity 0.16s ease, background 0.16s ease;
        }
        .vna-remove-bg-btn:active {
          transform: scale(0.94);
          background: rgba(20,20,28,0.72);
        }
        .vna-remove-bg-btn:disabled {
          cursor: default;
          opacity: 0.68;
          transform: none;
        }
        .vna-remove-bg-spinner {
          animation: vnaSpin 0.85s linear infinite;
        }
        .vna-layout-controls {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-top: 8px;
        }
        .vna-layout-dialog .modal-footer {
          gap: 8px;
        }
        @keyframes vnaSpin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>

      <div className="vna-studio">
        <div className="vna-studio-header">
          {/* ── Tabs ── */}
          <div className="vna-tabs">
            <button type="button" className="vna-tab" data-active={tab === "scenes" ? "true" : undefined} onClick={() => setTab("scenes")}>
              <Mountain size={14} strokeWidth={1.75} /> 场景
            </button>
            <button type="button" className="vna-tab" data-active={tab === "sprites" ? "true" : undefined} onClick={() => setTab("sprites")}>
              <User size={14} strokeWidth={1.75} /> 立绘
            </button>
          </div>

          {/* ── Add bar ── */}
          <div className="vna-add-bar">
            <button
              type="button"
              className="vna-add-btn"
              onClick={() => {
                if (tab === "sprites" && !selectedCharId) {
                  onNotice?.("请先选择角色");
                  return;
                }
                fileRef.current?.click();
              }}
            >
              <ImagePlus size={15} strokeWidth={1.85} />
              {tab === "scenes" ? "添加场景" : "添加立绘"}
            </button>
            <span className="vna-select-shell">
              <select
                className="vna-char-select"
                value={selectedCharId}
                onChange={(e) => setSelectedCharId(e.target.value)}
              >
                {tab === "scenes" && <option value="">所有角色</option>}
                {tab === "sprites" && <option value="">选择角色</option>}
                {characters.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </span>
          </div>
        </div>

        <div className="vna-assets-body">
          <div className="vna-assets-heading">
            <div>
              <h3 className="vna-assets-title">{tab === "scenes" ? "场景资源" : "立绘资源"}</h3>
              <span className="vna-assets-subtitle">
                {tab === "scenes" ? "Visual novel backgrounds" : "Character sprite library"}
              </span>
            </div>
            <span className="vna-count">{visibleCount}</span>
          </div>

          {/* ── Content ── */}
          {tab === "scenes" && (
            filteredScenes.length === 0 ? (
              <div className="vna-empty">
                暂无场景
                <div className="vna-empty-hint">上传背景图片，AI 会在创作中使用场景名称引用</div>
              </div>
            ) : (
              <div className="vna-grid">
                {filteredScenes.map((s) => (
                  <div
                    key={s.id}
                    className="vna-card"
                    data-kind="scene"
                    style={{ aspectRatio: vnViewportAspectRatio }}
                    onClick={() => setEditingLayoutAsset({ id: s.id, type: "scene", name: s.name, layout: s.layout ?? {} })}
                  >
                    {thumbs[s.assetId] ? (
                      <img className="vna-card-img" src={thumbs[s.assetId]} alt={s.name} />
                    ) : (
                      <div className="vna-card-placeholder"><Mountain size={24} /></div>
                    )}
                    <div className="vna-card-info">
                      <span className="vna-card-name">{s.name}</span>
                      <button type="button" className="vna-card-del" onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(s.id); }} aria-label="删除场景">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {tab === "sprites" && (
            filteredSprites.length === 0 ? (
              <div className="vna-empty">
                暂无立绘
                <div className="vna-empty-hint">上传立绘图片，AI 会在创作中使用名称引用</div>
              </div>
            ) : (
              <div className="vna-grid">
                {filteredSprites.map((s) => (
                  <div
                    key={s.id}
                    className="vna-card"
                    data-kind="sprite"
                    style={{ aspectRatio: vnViewportAspectRatio }}
                    onClick={() => setEditingLayoutAsset({ id: s.id, type: "sprite", name: s.key, layout: s.layout ?? {} })}
                  >
                    {thumbs[s.assetId] ? (
                      <div className="vna-card-sprite-preview" role="img" aria-label={s.key}>
                        <div
                          className="vna-card-sprite-img"
                          style={{
                            backgroundImage: `url(${thumbs[s.assetId]})`,
                            transform: `translate(${(s.layout?.x ?? 50) - 50}%, ${(s.layout?.y ?? 100) - 100}%) scale(${(s.layout?.scale ?? 100) / 100})`,
                          }}
                        />
                      </div>
                    ) : (
                      <div className="vna-card-placeholder"><User size={24} /></div>
                    )}
                    <div className="vna-card-info">
                      <span className="vna-card-name">{s.key}</span>
                      <button type="button" className="vna-card-del" onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(s.id); }} aria-label="删除立绘">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={handleFileChange}
      />

      {/* ── Delete Confirm ── */}
      {confirmDeleteId && (
        <ConfirmDialog
          title="确认删除？"
          message="删除后无法恢复。是否继续？"
          icon={AlertCircle}
          variant="danger"
          confirmLabel="确认删除"
          cancelLabel="取消"
          onConfirm={() => {
            if (tab === "scenes") handleDeleteScene(confirmDeleteId);
            else handleDeleteSprite(confirmDeleteId);
            setConfirmDeleteId(null);
          }}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}

      {/* ── Naming Dialog ── */}
      {pendingFile && portalTarget && createPortal(
        <div className="vna-naming-overlay" onClick={handleCancelAdd}>
          <div className="vna-naming-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="vna-naming-title">
              {tab === "scenes" ? "命名场景" : "命名立绘"}
            </div>
            <div className="vna-naming-hint">
              {tab === "scenes"
                ? "AI 会通过这个名称在创作中引用该场景"
                : "AI 会通过这个名称在创作中引用该立绘"}
            </div>
            <input
              ref={nameInputRef}
              className="vna-naming-input"
              value={pendingName}
              onChange={(e) => setPendingName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleConfirmAdd(); }}
              placeholder={tab === "scenes" ? "如：雨夜街道、教室走廊" : "如：微笑、生气、害羞"}
            />
            <div className="vna-naming-btns">
              <button type="button" className="vna-naming-btn" onClick={handleCancelAdd}>取消</button>
              <button
                type="button"
                className="vna-naming-btn"
                data-primary="true"
                onClick={handleConfirmAdd}
                disabled={!pendingName.trim()}
              >
                确认
              </button>
            </div>
          </div>
        </div>,
        portalTarget,
      )}

      {/* ── Asset Layout Editor with Preview ── */}
      {editingLayoutAsset && portalTarget && (() => {
        const la = editingLayoutAsset;
        const items = la.type === "scene" ? scenes : sprites;
        const assetId = items.find((i) => i.id === la.id)?.assetId ?? "";
        const imgUrl = assetId ? thumbs[assetId] : undefined;
        const scale = la.layout.scale ?? 100;
        const x = la.layout.x ?? 50;
        const y = la.layout.y ?? (la.type === "sprite" ? 100 : 50);
        const isSprite = la.type === "sprite";
        const isRemovingBackground = Boolean(assetId && removingBackgroundAssetId === assetId);

        const updateLayout = (patch: Partial<typeof la.layout>) => {
          const next = { ...la.layout, ...patch };
          setEditingLayoutAsset((prev) => prev ? { ...prev, layout: next } : null);
          const fn = la.type === "scene" ? updateVnSceneLayout : updateVnSpriteLayout;
          fn(la.id, next);
        };

        return createPortal(
          <div className="modal-overlay vna-layout-overlay" onClick={() => { setEditingLayoutAsset(null); reload(); }}>
            <div className="modal-dialog vna-layout-dialog" style={layoutPreviewStyle} onClick={(e) => e.stopPropagation()}>
              <div className="modal-body" style={{ padding: 0 }}>
                {/* Preview */}
                <div className="vna-layout-preview">
                  {imgUrl && isSprite && (
                    <button
                      type="button"
                      className="vna-remove-bg-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleRemoveSpriteBackground(assetId, imgUrl);
                      }}
                      disabled={isRemovingBackground}
                      aria-label="自动去底"
                      title="自动去底"
                    >
                      {isRemovingBackground ? <Loader2 className="vna-remove-bg-spinner" size={17} /> : <Eraser size={17} />}
                    </button>
                  )}
                  {imgUrl && isSprite && (
                    <div style={{
                      position: "absolute",
                      inset: 0,
                      backgroundImage: `url(${imgUrl})`,
                      backgroundSize: "contain",
                      backgroundRepeat: "no-repeat",
                      backgroundPosition: "center bottom",
                      transform: `translate(${x - 50}%, ${y - 100}%) scale(${scale / 100})`,
                      transformOrigin: "center bottom",
                    }} />
                  )}
                  {imgUrl && !isSprite && (
                    <div style={{
                      position: "absolute",
                      inset: 0,
                      backgroundImage: `url(${imgUrl})`,
                      backgroundSize: "cover",
                      backgroundPosition: "center center",
                      transform: `translate(${x - 50}%, ${y - 50}%) scale(${scale / 100})`,
                    }} />
                  )}
                  {!imgUrl && (
                    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--c-icon)" }}>
                      加载中...
                    </div>
                  )}
                </div>

                {/* Sliders */}
                <div className="vna-layout-controls">
                  <div className="ui-slider-row">
                    <span className="ui-slider-label">比例</span>
                    <input type="range" className="ui-slider" min={isSprite ? 30 : 100} max={200} step="any" value={scale}
                      onChange={(e) => updateLayout({ scale: Number(e.target.value) })} />
                    <span className="ui-slider-value">{Math.round(scale)}%</span>
                  </div>
                  <div className="ui-slider-row">
                    <span className="ui-slider-label">水平</span>
                    <input type="range" className="ui-slider" min={0} max={100} step="any" value={x}
                      onChange={(e) => updateLayout({ x: Number(e.target.value) })} />
                    <span className="ui-slider-value">{Math.round(x)}%</span>
                  </div>
                  <div className="ui-slider-row">
                    <span className="ui-slider-label">垂直</span>
                    <input type="range" className="ui-slider" min={isSprite ? 50 : 0} max={100} step="any" value={y}
                      onChange={(e) => updateLayout({ y: Number(e.target.value) })} />
                    <span className="ui-slider-value">{Math.round(y)}%</span>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="ui-btn ui-btn-ghost" onClick={() => {
                  const fn = la.type === "scene" ? updateVnSceneLayout : updateVnSpriteLayout;
                  fn(la.id, {});
                  setEditingLayoutAsset((prev) => prev ? { ...prev, layout: {} } : null);
                }}>重置</button>
                <button className="ui-btn ui-btn-primary" onClick={() => { setEditingLayoutAsset(null); reload(); }}>完成</button>
              </div>
            </div>
          </div>,
          portalTarget,
        );
      })()}
    </div>
  );
}
