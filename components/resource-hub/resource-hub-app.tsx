"use client";

// 资源集市：社区资源市场（GitHub 仓库当后端，浏览走 CDN）。
// 首页自动显示仓库根目录的文件夹（仿文件管理器），文件夹页为古早论坛式列表，
// 资源可下载或导入（导入时选择目的地）。整体为复古 Windows 风格。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadCharacters } from "@/lib/character-storage";
import { loadChatContacts } from "@/lib/chat-storage";
import {
    checkImportFileForDestination,
    downloadResourceHubFile,
    fetchShareIndex,
    importResourceHubFile,
    loadResourceHubSource,
    purgeShareIndexCache,
    resolveResourceHubAssetUrl,
    saveResourceHubSource,
} from "@/lib/resource-hub-client";
import {
    IMPORT_DESTINATIONS,
    type ImportDestination,
    type ResourceHubSource,
    type ShareIndex,
    type ShareIndexEntry,
} from "@/lib/resource-hub-types";
import {
    fileToUploadEntry,
    loadMyUploads,
    loadUploadConfig,
    ownerDeleteViaService,
    saveUploadConfig,
    uploadResource,
    type ResourceHubUploadConfig,
} from "@/lib/resource-hub-upload";
import { DestPixelIcon, FileTypePixelIcon, fileExtension } from "@/components/resource-hub/pixel-icons";
import { deleteShareEntry } from "@/lib/resource-hub-review";
import { MediaPreviewOverlay } from "@/components/chat/media-preview-overlay";
import { fetchFlowerCounts, hasSentFlowerToday, sendFlower, type FlowerCounts } from "@/lib/resource-hub-flowers";
import { STICKER_NAMES, StickerPixelIcon } from "@/components/resource-hub/pixel-stickers";
import { RICH_COLORS, RichText } from "@/components/resource-hub/rich-text";
import { RichEditor, type RichEditorHandle } from "@/components/resource-hub/rich-editor";
import { PixelHourglass } from "@/components/pixel-hourglass";

type LoadState = "loading" | "ready" | "error";

function formatEntryDate(iso: string | null): string {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function ResourceHubApp({ onClose, onNotice }: { onClose: () => void; onNotice?: (msg: string) => void }) {
    const [source, setSource] = useState<ResourceHubSource>(() => loadResourceHubSource());
    const [index, setIndex] = useState<ShareIndex | null>(null);
    const [loadState, setLoadState] = useState<LoadState>("loading");
    const [loadError, setLoadError] = useState("");
    const [activeFolder, setActiveFolder] = useState<string | null>(null);
    const [activeEntry, setActiveEntry] = useState<ShareIndexEntry | null>(null);
    const [selectedFile, setSelectedFile] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [confirmDeleteEntry, setConfirmDeleteEntry] = useState<ShareIndexEntry | null>(null);
    const [deleting, setDeleting] = useState(false);
    // 浏览集市 / 我的货摊
    const [viewMode, setViewMode] = useState<"market" | "mine">("market");
    // 图片全屏预览（点开可保存）
    const [previewImage, setPreviewImage] = useState<string | null>(null);
    // 送花：各资源花数（我的货摊展示用）+ 非阻塞小提示
    const [flowerCounts, setFlowerCounts] = useState<FlowerCounts | null>(null);
    const [toast, setToast] = useState<string | null>(null);
    // 联网中的按钮（各自显示像素沙漏）
    const [sendingFlower, setSendingFlower] = useState(false);
    const [importingTo, setImportingTo] = useState<string | null>(null);
    const [busyFile, setBusyFile] = useState<string | null>(null);
    // 导入流程：选文件 → 选目的地 →（聊天室CSS再选角色）
    const [importFile, setImportFile] = useState<string | null>(null);
    const [pickCharacterFor, setPickCharacterFor] = useState<string | null>(null);
    const [showConstructionNotice, setShowConstructionNotice] = useState(true);
    const [showSourceEditor, setShowSourceEditor] = useState(false);
    const [sourceDraft, setSourceDraft] = useState<ResourceHubSource>(source);
    // 上传（分类下拉：CUSTOM_FOLDER 表示自定义新分类，配合手动输入框）
    const CUSTOM_FOLDER = "__custom__";
    const [showUpload, setShowUpload] = useState(false);
    const [uploadFolder, setUploadFolder] = useState("");
    const [uploadFolderCustom, setUploadFolderCustom] = useState("");
    const [uploadName, setUploadName] = useState("");
    const [uploadAuthor, setUploadAuthor] = useState("");
    const [uploadDesc, setUploadDesc] = useState("");
    const [uploadFiles, setUploadFiles] = useState<File[]>([]);
    const [uploadImages, setUploadImages] = useState<File[]>([]);
    const [uploading, setUploading] = useState(false);
    const [uploadCfg, setUploadCfg] = useState<ResourceHubUploadConfig>(() => loadUploadConfig());
    // 所见即所得编辑器：贴纸选择器（标题/正文两处）、颜色面板
    const [stickerPickerFor, setStickerPickerFor] = useState<"title" | "desc" | null>(null);
    const [showColorPicker, setShowColorPicker] = useState(false);
    const uploadNameRef = useRef<RichEditorHandle | null>(null);
    const uploadDescRef = useRef<RichEditorHandle | null>(null);

    const showToast = useCallback((msg: string) => {
        setToast(msg);
        window.setTimeout(() => setToast(current => (current === msg ? null : current)), 2600);
    }, []);

    // 颜色/字号/加粗都是"选中文字再操作"：没选中就提示
    const wrapDescTag = useCallback((tag: string) => {
        if (!uploadDescRef.current?.applyTag(tag)) showToast("先选中要排版的文字，再点按钮");
    }, [showToast]);

    // 工具栏按钮按下时不抢走编辑器焦点，选区才能保住（iOS 上尤其关键）
    const keepSelection = useCallback((e: React.PointerEvent) => e.preventDefault(), []);

    const reload = useCallback((activeSource: ResourceHubSource, options?: { purge?: boolean }) => {
        setLoadState("loading");
        setLoadError("");
        const run = () => fetchShareIndex(activeSource)
            .then(data => { setIndex(data); setLoadState("ready"); })
            .catch(err => {
                setLoadError(err instanceof Error ? err.message : String(err));
                setLoadState("error");
            });
        if (options?.purge) {
            // 手动刷新时先强刷 CDN，让新上架的资源尽快可见
            purgeShareIndexCache(activeSource);
            setTimeout(run, 1500);
        } else {
            void run();
        }
    }, []);

    useEffect(() => { reload(source); }, [reload, source]);

    // 切到我的货摊时拉取花数（仅作者本人可见的统计）
    useEffect(() => {
        if (viewMode !== "mine") return;
        let cancelled = false;
        void fetchFlowerCounts(source).then(counts => { if (!cancelled) setFlowerCounts(counts); });
        return () => { cancelled = true; };
    }, [viewMode, source, index]);

    const folderEntries = useMemo(() => {
        if (!index || !activeFolder) return [];
        return index.entries
            .filter(e => e.folder === activeFolder)
            .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "") || a.name.localeCompare(b.name, "zh"));
    }, [index, activeFolder]);

    // 关键词搜索：跨全部分类，匹配名称/说明/分类/文件名
    const searchResults = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q || !index) return null;
        return index.entries
            .filter(e => [e.name, e.description, e.folder, ...e.files, ...e.images]
                .join(" ").toLowerCase().includes(q))
            .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "") || a.name.localeCompare(b.name, "zh"));
    }, [index, searchQuery]);

    // 我的货摊：本机上传记录与目录比对——在目录里的可点进详情，不在的显示待审/未上架
    const myStall = useMemo(() => {
        const records = loadMyUploads();
        const published: ShareIndexEntry[] = [];
        const pending: { name: string; uploadedAt: string }[] = [];
        for (const record of records) {
            const entry = index?.entries.find(e => e.path === record.path);
            if (entry) published.push(entry);
            else pending.push({ name: record.name, uploadedAt: record.uploadedAt });
        }
        return { published, pending };
        // index 变化或切到货摊时重算
    }, [index, viewMode]); // eslint-disable-line react-hooks/exhaustive-deps

    const chatContacts = useMemo(() => {
        if (pickCharacterFor === null) return [];
        const characters = loadCharacters();
        return loadChatContacts().map(contact => ({
            contactId: contact.id,
            name: contact.nickname || characters.find(c => c.id === contact.characterId)?.name || "未知角色",
        }));
    }, [pickCharacterFor]);

    // 手动送花（详情页按钮）。自动送花复用同一函数。
    const handleSendFlower = useCallback(async (entryPath: string, silent = false) => {
        if (!silent) setSendingFlower(true);
        try {
            const sent = await sendFlower(loadUploadConfig().endpoint, entryPath);
            if (sent) showToast("已送出一朵花 🌸");
            else if (!silent) showToast("今天已经给它送过花啦");
        } finally {
            if (!silent) setSendingFlower(false);
        }
    }, [showToast]);

    const handleDownload = useCallback(async (path: string) => {
        setBusyFile(path);
        try {
            await downloadResourceHubFile(source, path);
            // 下载成功默认送出一朵花（今天送过则静默跳过，失败不影响下载）
            if (activeEntry) void handleSendFlower(activeEntry.path, true);
        } catch (err) {
            onNotice?.(`下载失败：${err instanceof Error ? err.message : String(err)}`);
        } finally {
            setBusyFile(null);
        }
    }, [activeEntry, handleSendFlower, onNotice, source]);

    // 导入时弹窗不立刻关闭：在刚点的那个图标上转沙漏，做完再关，
    // 免得反馈跑到别的位置去（用户看不到自己点的东西有反应）
    const runImport = useCallback(async (path: string, destination: ImportDestination, contactId?: string) => {
        setBusyFile(path);
        setImportingTo(contactId ?? destination);
        try {
            const message = await importResourceHubFile(source, path, destination, { contactId });
            onNotice?.(message);
        } catch (err) {
            onNotice?.(`导入失败：${err instanceof Error ? err.message : String(err)}`);
        } finally {
            setBusyFile(null);
            setImportingTo(null);
            setImportFile(null);
            setPickCharacterFor(null);
        }
    }, [onNotice, source]);

    const handlePickDestination = useCallback((destination: ImportDestination) => {
        if (!importFile) return;
        const typeError = checkImportFileForDestination(destination, importFile);
        if (typeError) {
            onNotice?.(typeError);
            return;
        }
        if (destination === "chat_session_css") {
            setPickCharacterFor(importFile);
            setImportFile(null);
            return;
        }
        void runImport(importFile, destination);
    }, [importFile, onNotice, runImport]);

    const handleDeleteEntry = useCallback(async (entry: ShareIndexEntry) => {
        setDeleting(true);
        try {
            // 本人上传的用删除凭证走上传服务；否则按管理员 Token 直删
            const myRecord = loadMyUploads().find(r => r.path === entry.path);
            if (myRecord) {
                await ownerDeleteViaService(loadUploadConfig().endpoint, myRecord);
            } else {
                await deleteShareEntry(entry.path);
            }
            setConfirmDeleteEntry(null);
            setActiveEntry(null);
            // 乐观更新本地目录，CDN 缓存刷新前列表就正确
            setIndex(current => current ? {
                ...current,
                entries: current.entries.filter(e => e.path !== entry.path),
                folders: current.folders.map(f => f.name === entry.folder ? { ...f, count: Math.max(0, f.count - 1) } : f),
            } : current);
            onNotice?.(`「${entry.name}」已下架`);
        } catch (err) {
            onNotice?.(`删除失败：${err instanceof Error ? err.message : String(err)}`);
        } finally {
            setDeleting(false);
        }
    }, [onNotice]);

    const handleUploadSubmit = useCallback(async () => {
        const folder = (uploadFolder === CUSTOM_FOLDER ? uploadFolderCustom : uploadFolder).trim();
        const name = uploadName.trim();
        if (!folder || !name) { onNotice?.("请填写分类和资源名称"); return; }
        if (uploadFiles.length === 0) { onNotice?.("请选择至少一个资源文件"); return; }
        setUploading(true);
        try {
            const files = await Promise.all([...uploadFiles, ...uploadImages].map(fileToUploadEntry));
            const result = await uploadResource(source, {
                folder, name,
                author: uploadAuthor.trim(),
                description: uploadDesc.trim(),
                files,
            });
            setShowUpload(false);
            uploadNameRef.current?.setMarkup(""); uploadDescRef.current?.setMarkup("");
            setUploadFiles([]); setUploadImages([]); setUploadFolderCustom("");
            onNotice?.(result.merged
                ? `「${name}」已上架（CDN 缓存刷新后可见）`
                : `「${name}」已提交，等待管理员审核上架`);
        } catch (err) {
            onNotice?.(`上传失败：${err instanceof Error ? err.message : String(err)}`);
        } finally {
            setUploading(false);
        }
    }, [onNotice, source, uploadAuthor, uploadDesc, uploadFiles, uploadFolder, uploadFolderCustom, uploadImages, uploadName]);

    // 贴纸/颜色选择面板（上传弹窗的排版工具栏用）
    const stickerPanel = (
        <div className="rh-sticker-panel">
            {STICKER_NAMES.map(name => (
                <button key={name} type="button" className="rh-sticker-btn" title={name} onPointerDown={keepSelection} onClick={() => {
                    (stickerPickerFor === "title" ? uploadNameRef : uploadDescRef).current?.insertSticker(name);
                    setStickerPickerFor(null);
                }}>
                    <StickerPixelIcon name={name} size={24} />
                </button>
            ))}
        </div>
    );
    const colorPanel = (
        <div className="rh-color-panel">
            {Object.entries(RICH_COLORS).map(([name, hex]) => (
                <button key={name} type="button" className="rh-color-chip" style={{ background: hex }} title={name} onPointerDown={keepSelection}
                    onClick={() => { wrapDescTag(name); setShowColorPicker(false); }} />
            ))}
        </div>
    );

    // 详情页署名行：投稿人（填了才有）+ 更新日期
    const detailByline = activeEntry
        ? [activeEntry.author?.trim() ? `投稿人：${activeEntry.author.trim()}` : "", formatEntryDate(activeEntry.updatedAt)]
            .filter(Boolean).join("　·　")
        : "";

    const title = activeEntry ? activeEntry.name : activeFolder ? activeFolder : "资源集市";
    const handleBack = activeEntry
        ? () => setActiveEntry(null)
        : activeFolder
            ? () => setActiveFolder(null)
            : onClose;

    const renderEntryRow = (entry: ShareIndexEntry, showFolder = false, flowers?: number | "loading") => (
        <button key={entry.path} className="rh-entry" onClick={() => { setActiveEntry(entry); setSelectedFile(entry.files[0] ?? null); }}>
            {entry.images.length > 0 ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="rh-entry-thumb" src={resolveResourceHubAssetUrl(source, entry.images[0])} alt="" loading="lazy" />
            ) : (
                <span className="rh-entry-thumb rh-entry-thumb-blank">📄</span>
            )}
            <span className="rh-entry-main">
                <span className="rh-entry-title"><RichText text={entry.name} mode="sticker" /></span>
                {entry.description && <span className="rh-entry-desc"><RichText text={entry.description} mode="inline" /></span>}
                <span className="rh-entry-meta">
                    {[showFolder ? entry.folder : "", formatEntryDate(entry.updatedAt), `${entry.files.length} 个文件`,
                        flowers === undefined ? "" : `🌸 ${flowers === "loading" ? "…" : flowers}`].filter(Boolean).join(" · ")}
                </span>
            </span>
        </button>
    );

    return (
        <div className="rh-root page-shell">
            {/* 窗口标题栏 */}
            <div className="rh-window">
                <div className="rh-titlebar">
                    <span className="rh-titlebar-icon">🗂️</span>
                    <span className="rh-titlebar-text"><RichText text={title} mode="sticker" /> - 资源集市</span>
                    <span className="rh-titlebar-controls">
                        <button className="rh-tb-btn" aria-label="资源仓库设置" onClick={() => { setSourceDraft(source); setShowSourceEditor(true); }}>⚙</button>
                        <button className="rh-tb-btn" aria-label="刷新" disabled={loadState === "loading"} onClick={() => reload(source, { purge: true })}>
                            {loadState === "loading" ? <PixelHourglass size={13} /> : "⟳"}
                        </button>
                        <button className="rh-tb-btn" aria-label="关闭" onClick={onClose}>✕</button>
                    </span>
                </div>

                {/* 工具条（返回/地址） */}
                <div className="rh-toolbar">
                    <button className="rh-btn" onClick={handleBack}>← 返回</button>
                    <span className="rh-address">
                        地址：C:\资源集市{viewMode === "mine" ? "\\我的货摊" : ""}{activeFolder ? `\\${activeFolder}` : ""}{activeEntry ? `\\${activeEntry.name}` : ""}
                    </span>
                    <button className="rh-btn" onClick={() => { setUploadFolder(activeFolder || ""); setShowUpload(true); }}>上传</button>
                </div>

                {/* 浏览集市 / 我的货摊 切换 */}
                {!activeEntry && (
                    <div className="rh-tabs">
                        <button className="rh-tab" data-active={viewMode === "market" ? "1" : undefined}
                            onClick={() => setViewMode("market")}>浏览集市</button>
                        <button className="rh-tab" data-active={viewMode === "mine" ? "1" : undefined}
                            onClick={() => { setViewMode("mine"); setActiveFolder(null); setSearchQuery(""); }}>我的货摊</button>
                    </div>
                )}

                {/* 内容区 */}
                <div className={`rh-body${activeEntry ? " rh-body-detail" : ""}`}>
                    {loadState === "loading" && <div className="rh-center-hint">正在读取目录，请稍候...</div>}

                    {loadState === "error" && (
                        <div className="rh-center-hint">
                            <div className="ts-24 mb-2">🚧</div>
                            资源仓库暂时无法访问（{loadError}）。
                            <br />可能是网络问题或仓库尚未就绪，可点右上角 ⟳ 重试。
                        </div>
                    )}

                    {/* 我的货摊 */}
                    {loadState === "ready" && viewMode === "mine" && !activeEntry && (
                        (myStall.published.length > 0 || myStall.pending.length > 0) ? (
                            <div className="rh-entry-list">
                                {myStall.published.length > 0 && (
                                    <div className="rh-stall-flowers">
                                        {flowerCounts
                                            ? `🌸 共收到 ${myStall.published.reduce((sum, e) => sum + (flowerCounts[e.path] ?? 0), 0)} 朵花`
                                            : <><PixelHourglass size={13} /> 正在统计收到的花…</>}
                                    </div>
                                )}
                                {myStall.published.map(entry => renderEntryRow(entry, true, flowerCounts ? (flowerCounts[entry.path] ?? 0) : "loading"))}
                                {myStall.pending.map(item => (
                                    <div key={item.name + item.uploadedAt} className="rh-entry rh-entry-pending">
                                        <span className="rh-entry-thumb rh-entry-thumb-blank">⏳</span>
                                        <span className="rh-entry-main">
                                            <span className="rh-entry-title"><RichText text={item.name} mode="sticker" /></span>
                                            <span className="rh-entry-meta">待管理员审核，或索引尚未更新</span>
                                        </span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="rh-center-hint">你还没有上传过资源，点右上角「上传」摆个摊吧</div>
                        )
                    )}

                    {/* 搜索框（首页与文件夹页显示） */}
                    {loadState === "ready" && viewMode === "market" && !activeEntry && (
                        <div className="rh-search-row">
                            <input
                                className="rh-input rh-search-input"
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                placeholder="搜索资源名称、说明、文件名..."
                            />
                            {searchQuery.trim() && (
                                <button className="rh-btn" onClick={() => setSearchQuery("")}>清除</button>
                            )}
                        </div>
                    )}

                    {/* 搜索结果（有关键词时替代当前列表） */}
                    {loadState === "ready" && viewMode === "market" && !activeEntry && searchResults && (
                        searchResults.length > 0 ? (
                            <div className="rh-entry-list">
                                {searchResults.map(entry => renderEntryRow(entry, true))}
                            </div>
                        ) : (
                            <div className="rh-center-hint">没有匹配「{searchQuery.trim()}」的资源</div>
                        )
                    )}

                    {/* 首页：文件夹（一行两个） */}
                    {loadState === "ready" && viewMode === "market" && !activeFolder && !searchResults && (
                        index && index.folders.length > 0 ? (
                            <div className="rh-folder-grid">
                                {index.folders.map(folder => (
                                    <button key={folder.name} className="rh-folder" onDoubleClick={() => setActiveFolder(folder.name)} onClick={() => setActiveFolder(folder.name)}>
                                        <span className="rh-folder-icon">📁</span>
                                        <span className="rh-folder-name">{folder.name}</span>
                                        <span className="rh-folder-count">{folder.count} 个对象</span>
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div className="rh-center-hint">仓库里还没有资源文件夹</div>
                        )
                    )}

                    {/* 文件夹页：论坛式列表 */}
                    {loadState === "ready" && viewMode === "market" && activeFolder && !activeEntry && !searchResults && (
                        folderEntries.length > 0 ? (
                            <div className="rh-entry-list">
                                {folderEntries.map(entry => renderEntryRow(entry))}
                            </div>
                        ) : (
                            <div className="rh-center-hint">这个文件夹还是空的</div>
                        )
                    )}

                    {/* 资源详情页：上=图文内容区，下=横滑文件条 + 操作按钮 */}
                    {loadState === "ready" && activeEntry && (
                        <div className="rh-detail2">
                            <div className="rh-detail2-main">
                                {/* 发帖式排版：标题 → 正文 → 图片（标记语法经 RichText 安全渲染） */}
                                <div className="rh-detail2-title" data-solo={detailByline ? undefined : "1"}>
                                    <RichText text={activeEntry.name} mode="sticker" />
                                </div>
                                {/* 投稿人（上传时填了才显示）+ 更新日期 */}
                                {detailByline && <div className="rh-detail2-byline">{detailByline}</div>}
                                {activeEntry.description
                                    ? <div className="rh-detail2-desc"><RichText text={activeEntry.description} mode="full" /></div>
                                    : <div className="rh-detail2-desc rh-detail2-desc-empty">（该资源没有说明文字）</div>}
                                {activeEntry.images.map(img => {
                                    const url = resolveResourceHubAssetUrl(source, img);
                                    return (
                                        // 点击层放在外层 div 而非 img 本身：iOS WebKit 对非交互元素
                                        // 的点击合成不可靠，聊天页同款结构在 iOS 上验证可用
                                        <div
                                            key={img}
                                            className="rh-detail2-imgwrap"
                                            role="button"
                                            style={{ cursor: "pointer" }}
                                            onClick={e => { e.stopPropagation(); setPreviewImage(url); }}
                                        >
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img src={url} alt="" loading="lazy" />
                                        </div>
                                    );
                                })}
                            </div>

                            {activeEntry.files.length > 0 ? (
                                <>
                                    <div className="rh-file-strip">
                                        {activeEntry.files.map(file => {
                                            const base = file.split("/").pop() || file;
                                            const ext = fileExtension(base);
                                            return (
                                                <button
                                                    key={file}
                                                    className="rh-file-tile"
                                                    data-selected={selectedFile === file ? "1" : undefined}
                                                    onClick={() => setSelectedFile(file)}
                                                >
                                                    <FileTypePixelIcon filename={base} size={36} />
                                                    <span className="rh-file-tile-ext">{ext ? `.${ext.toUpperCase()}` : "FILE"}</span>
                                                    <span className="rh-file-tile-name">{base}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <div className="rh-detail2-actions">
                                        <button
                                            className="rh-btn rh-flower-btn"
                                            disabled={sendingFlower || hasSentFlowerToday(activeEntry.path)}
                                            title="给作者送一朵花"
                                            onClick={() => void handleSendFlower(activeEntry.path)}
                                        >
                                            {sendingFlower
                                                ? <><PixelHourglass size={13} /> 送出中</>
                                                : hasSentFlowerToday(activeEntry.path) ? "已送🌸" : "送花🌸"}
                                        </button>
                                        <button className="rh-btn rh-action-half" disabled={!selectedFile || busyFile === selectedFile} onClick={() => selectedFile && handleDownload(selectedFile)}>
                                            {busyFile === selectedFile && !importingTo
                                                ? <><PixelHourglass size={13} /> 下载中</>
                                                : "下载"}
                                        </button>
                                        <button className="rh-btn rh-btn-primary rh-action-half" disabled={!selectedFile || busyFile === selectedFile} onClick={() => selectedFile && setImportFile(selectedFile)}>
                                            {busyFile === selectedFile && importingTo
                                                ? <><PixelHourglass size={13} /> 导入中</>
                                                : "导入"}
                                        </button>
                                        {(uploadCfg.githubToken.trim() || loadMyUploads().some(r => r.path === activeEntry.path)) && (
                                            <button className="rh-btn rh-action-del" onClick={() => setConfirmDeleteEntry(activeEntry)}>删除</button>
                                        )}
                                    </div>
                                </>
                            ) : (
                                <div className="rh-center-hint">该资源没有可下载的文件</div>
                            )}
                        </div>
                    )}
                </div>

                {/* 状态栏 */}
                <div className="rh-statusbar">
                    <span>
                        {loadState === "ready"
                            ? activeFolder
                                ? `${folderEntries.length} 个对象`
                                : `${index?.folders.length ?? 0} 个文件夹`
                            : "..."}
                    </span>
                    <span>资源仓库：{source.owner}/{source.repo}</span>
                </div>
            </div>

            {/* 施工提示（正式开张后移除） */}
            {showConstructionNotice && (
                <div className="rh-dialog-overlay">
                    <div className="rh-dialog">
                        <div className="rh-titlebar"><span className="rh-titlebar-text">系统提示</span></div>
                        <div className="rh-dialog-body">
                            <span className="rh-dialog-icon">🚧</span>
                            此app正在施工，请先去别的地方逛逛吧～
                        </div>
                        <div className="rh-dialog-footer">
                            <button className="rh-btn" onClick={() => setShowConstructionNotice(false)}>仍要看看</button>
                            <button className="rh-btn rh-btn-primary" onClick={onClose}>返回桌面</button>
                        </div>
                    </div>
                </div>
            )}

            {/* 导入目的地选择 */}
            {importFile && (
                <div className="rh-dialog-overlay" onClick={importingTo ? undefined : () => setImportFile(null)}>
                    <div className="rh-dialog" onClick={e => e.stopPropagation()}>
                        <div className="rh-titlebar">
                            <span className="rh-titlebar-text">导入到...</span>
                            <span className="rh-titlebar-controls">
                                <button className="rh-tb-btn" disabled={!!importingTo} onClick={() => setImportFile(null)}>✕</button>
                            </span>
                        </div>
                        {/* 文件全名（文件条里显示不全，这里完整展示） */}
                        <div className="rh-import-filename">{importFile.split("/").pop() || importFile}</div>
                        <div className="rh-dialog-body rh-dest-grid">
                            {IMPORT_DESTINATIONS.map(dest => (
                                <button key={dest.key} className="rh-dest-tile" title={dest.hint}
                                    disabled={!!importingTo} onClick={() => handlePickDestination(dest.key)}>
                                    {/* 正在导入的那一格换成沙漏，反馈就在刚点的位置上 */}
                                    {importingTo === dest.key ? <PixelHourglass size={34} /> : <DestPixelIcon dest={dest.key} />}
                                    <span className="rh-dest-tile-label">{importingTo === dest.key ? "导入中…" : dest.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* 聊天室 CSS：选择角色 */}
            {pickCharacterFor && (
                <div className="rh-dialog-overlay" onClick={importingTo ? undefined : () => setPickCharacterFor(null)}>
                    <div className="rh-dialog" onClick={e => e.stopPropagation()}>
                        <div className="rh-titlebar">
                            <span className="rh-titlebar-text">应用到哪个角色的聊天室？</span>
                            <span className="rh-titlebar-controls">
                                <button className="rh-tb-btn" disabled={!!importingTo} onClick={() => setPickCharacterFor(null)}>✕</button>
                            </span>
                        </div>
                        <div className="rh-dialog-body rh-dest-list">
                            {chatContacts.length > 0 ? chatContacts.map(contact => (
                                <button key={contact.contactId} className="rh-dest" disabled={!!importingTo}
                                    onClick={() => void runImport(pickCharacterFor, "chat_session_css", contact.contactId)}>
                                    <span className="rh-dest-label">
                                        {importingTo === contact.contactId && <><PixelHourglass size={13} /> </>}
                                        {contact.name}
                                    </span>
                                </button>
                            )) : (
                                <div className="rh-center-hint">还没有聊天联系人，先去聊天里添加角色吧</div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* 删除确认（管理员） */}
            {confirmDeleteEntry && (
                <div className="rh-dialog-overlay" onClick={deleting ? undefined : () => setConfirmDeleteEntry(null)}>
                    <div className="rh-dialog" onClick={e => e.stopPropagation()}>
                        <div className="rh-titlebar"><span className="rh-titlebar-text">下架资源</span></div>
                        <div className="rh-dialog-body">
                            <span className="rh-dialog-icon">🗑️</span>
                            确认删除「{confirmDeleteEntry.name}」？将从资源仓库移除其全部文件，此操作对所有用户生效。
                        </div>
                        <div className="rh-dialog-footer">
                            <button className="rh-btn" disabled={deleting} onClick={() => setConfirmDeleteEntry(null)}>取消</button>
                            <button className="rh-btn rh-action-del" disabled={deleting} onClick={() => void handleDeleteEntry(confirmDeleteEntry)}>
                                {deleting ? <><PixelHourglass size={13} /> 删除中…</> : "确认删除"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 上传对话框 */}
            {showUpload && (
                <div className="rh-dialog-overlay" onClick={uploading ? undefined : () => setShowUpload(false)}>
                    <div className="rh-dialog" onClick={e => e.stopPropagation()}>
                        <div className="rh-titlebar">
                            <span className="rh-titlebar-text">上传资源</span>
                            <span className="rh-titlebar-controls">
                                <button className="rh-tb-btn" disabled={uploading} onClick={() => setShowUpload(false)}>✕</button>
                            </span>
                        </div>
                        <div className="rh-dialog-body rh-form">
                            <label>分类
                                <select className="rh-input" value={uploadFolder} onChange={e => setUploadFolder(e.target.value)}>
                                    <option value="">请选择分类...</option>
                                    {(index?.folders ?? []).map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
                                    <option value={CUSTOM_FOLDER}>＋ 自定义新分类</option>
                                </select>
                            </label>
                            {uploadFolder === CUSTOM_FOLDER && (
                                <label>新分类名
                                    <input className="rh-input" value={uploadFolderCustom} placeholder="例如：表情包" onChange={e => setUploadFolderCustom(e.target.value)} />
                                </label>
                            )}
                            <div className="rh-form-field">
                                <span>资源名称（可加像素贴纸）</span>
                                <div className="rh-input-row">
                                    <RichEditor
                                        ref={uploadNameRef}
                                        className="rh-input rh-editor rh-editor-line"
                                        placeholder="例如：唐簪雪"
                                        ariaLabel="资源名称"
                                        singleLine
                                        onChange={setUploadName}
                                    />
                                    <button type="button" className="rh-fmt-btn" data-active={stickerPickerFor === "title" ? "1" : undefined} onPointerDown={keepSelection}
                                        onClick={() => { setStickerPickerFor(current => current === "title" ? null : "title"); setShowColorPicker(false); }}>贴纸</button>
                                </div>
                                {stickerPickerFor === "title" && stickerPanel}
                            </div>
                            <label>投稿人（可选）
                                <input className="rh-input" value={uploadAuthor} onChange={e => setUploadAuthor(e.target.value)} />
                            </label>
                            <div className="rh-form-field">
                                <span>说明文字（可选，会显示在列表里。选中文字后点按钮排版）</span>
                                <div className="rh-fmt-bar">
                                    <button type="button" className="rh-fmt-btn" data-active={stickerPickerFor === "desc" ? "1" : undefined} onPointerDown={keepSelection}
                                        onClick={() => { setStickerPickerFor(current => current === "desc" ? null : "desc"); setShowColorPicker(false); }}>贴纸</button>
                                    <button type="button" className="rh-fmt-btn" data-active={showColorPicker ? "1" : undefined} onPointerDown={keepSelection}
                                        onClick={() => { setShowColorPicker(v => !v); setStickerPickerFor(null); }}>颜色</button>
                                    <button type="button" className="rh-fmt-btn" onPointerDown={keepSelection} onClick={() => wrapDescTag("大")}>大</button>
                                    <button type="button" className="rh-fmt-btn" onPointerDown={keepSelection} onClick={() => wrapDescTag("小")}>小</button>
                                    <button type="button" className="rh-fmt-btn rh-fmt-bold" onPointerDown={keepSelection} onClick={() => wrapDescTag("粗")}>粗</button>
                                </div>
                                {stickerPickerFor === "desc" && stickerPanel}
                                {showColorPicker && colorPanel}
                                <RichEditor
                                    ref={uploadDescRef}
                                    className="rh-input rh-editor rh-editor-area"
                                    placeholder="写点介绍吧～选中文字可以改颜色、字号、加粗"
                                    ariaLabel="说明文字"
                                    onChange={setUploadDesc}
                                />
                            </div>
                            <label className="rh-file-picker">
                                <span className="rh-btn">选择资源文件{uploadFiles.length > 0 ? `（已选 ${uploadFiles.length} 个）` : ""}</span>
                                <input type="file" multiple hidden onChange={e => { setUploadFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
                            </label>
                            <label className="rh-file-picker">
                                <span className="rh-btn">选择配图（可选）{uploadImages.length > 0 ? `（已选 ${uploadImages.length} 张）` : ""}</span>
                                <input type="file" accept="image/*" multiple hidden onChange={e => { setUploadImages(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
                            </label>
                            <div className="rh-form-hint">
                                {uploadCfg.githubToken
                                    ? "将使用你的 GitHub Token 提交（有仓库权限则直接上架，否则生成待审核投稿）。"
                                    : "将匿名提交到审核队列，管理员通过后上架。单次总量 ≤5MB。"}
                            </div>
                        </div>
                        <div className="rh-dialog-footer">
                            <button className="rh-btn" disabled={uploading} onClick={() => setShowUpload(false)}>取消</button>
                            <button className="rh-btn rh-btn-primary" disabled={uploading} onClick={() => void handleUploadSubmit()}>
                                {uploading ? <><PixelHourglass size={13} /> 提交中…</> : "提交"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 资源仓库设置 */}
            {showSourceEditor && (
                <div className="rh-dialog-overlay" onClick={() => setShowSourceEditor(false)}>
                    <div className="rh-dialog" onClick={e => e.stopPropagation()}>
                        <div className="rh-titlebar"><span className="rh-titlebar-text">资源仓库</span></div>
                        <div className="rh-dialog-body rh-form">
                            <label>GitHub 用户/组织
                                <input className="rh-input" value={sourceDraft.owner} onChange={e => setSourceDraft(prev => ({ ...prev, owner: e.target.value }))} />
                            </label>
                            <label>仓库名
                                <input className="rh-input" value={sourceDraft.repo} onChange={e => setSourceDraft(prev => ({ ...prev, repo: e.target.value }))} />
                            </label>
                            <label>分支
                                <input className="rh-input" value={sourceDraft.branch} placeholder="main" onChange={e => setSourceDraft(prev => ({ ...prev, branch: e.target.value }))} />
                            </label>
                            <div className="rh-form-hint">资源经 jsDelivr CDN 读取，公开仓库无需登录。除非换资源源，一般不用改。</div>
                            <label>GitHub Token（可选，上传直传用）
                                <input className="rh-input" type="password" value={uploadCfg.githubToken} placeholder="不填则上传走匿名审核队列" onChange={e => setUploadCfg(prev => ({ ...prev, githubToken: e.target.value }))} />
                            </label>
                            <label>上传服务地址
                                <input className="rh-input" value={uploadCfg.endpoint} onChange={e => setUploadCfg(prev => ({ ...prev, endpoint: e.target.value }))} />
                            </label>
                        </div>
                        <div className="rh-dialog-footer">
                            <button className="rh-btn" onClick={() => setShowSourceEditor(false)}>取消</button>
                            <button className="rh-btn rh-btn-primary" onClick={() => {
                                const next: ResourceHubSource = {
                                    owner: sourceDraft.owner.trim(),
                                    repo: sourceDraft.repo.trim(),
                                    branch: sourceDraft.branch.trim() || "main",
                                };
                                if (!next.owner || !next.repo) { onNotice?.("仓库 owner 和名称不能为空"); return; }
                                saveResourceHubSource(next);
                                saveUploadConfig(uploadCfg);
                                setUploadCfg(loadUploadConfig());
                                setSource(next);
                                setActiveFolder(null);
                                setActiveEntry(null);
                                setShowSourceEditor(false);
                            }}>保存</button>
                        </div>
                    </div>
                </div>
            )}

            {/* 非阻塞小提示（送花等轻量反馈） */}
            {toast && <div className="rh-toast">{toast}</div>}

            {/* 图片全屏预览（与聊天/动态页一致，含保存按钮） */}
            {previewImage && (
                <MediaPreviewOverlay
                    imageUrl={previewImage}
                    saveFilename={(previewImage.split("/").pop() || "图片").split("?")[0]}
                    onClose={() => setPreviewImage(null)}
                />
            )}

            <style>{`
                .rh-root {
                    position: absolute;
                    inset: 0;
                    background: #008080;
                    padding: calc(var(--status-bar-top, 12px) + 48px) 10px 16px;
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                }
                .rh-root, .rh-root button, .rh-root input {
                    font-family: "Microsoft YaHei", "PingFang SC", Tahoma, "MS Sans Serif", sans-serif;
                }
                .rh-window {
                    flex: 1;
                    min-height: 0;
                    display: flex;
                    flex-direction: column;
                    background: #c0c0c0;
                    border: 2px solid;
                    border-color: #ffffff #404040 #404040 #ffffff;
                    box-shadow: 1px 1px 0 #000;
                }
                .rh-titlebar {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    padding: 3px 4px 3px 6px;
                    background: linear-gradient(90deg, #000080, #1084d0);
                    color: #fff;
                    font-size: calc(13px * var(--app-text-scale, 1));
                    font-weight: 700;
                    user-select: none;
                    flex-shrink: 0;
                }
                .rh-titlebar-text {
                    flex: 1;
                    min-width: 0;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .rh-titlebar-controls { display: flex; gap: 3px; }
                .rh-tb-btn {
                    width: 28px;
                    height: 24px;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    background: #c0c0c0;
                    color: #000;
                    font-size: 15px;
                    border: 2px solid;
                    border-color: #ffffff #404040 #404040 #ffffff;
                    cursor: pointer;
                    padding: 0;
                }
                .rh-tb-btn:active { border-color: #404040 #ffffff #ffffff #404040; }
                .rh-toolbar {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 5px 6px;
                    border-bottom: 1px solid #808080;
                    box-shadow: 0 1px 0 #fff;
                    flex-shrink: 0;
                }
                .rh-address {
                    flex: 1;
                    min-width: 0;
                    background: #fff;
                    border: 2px solid;
                    border-color: #404040 #ffffff #ffffff #404040;
                    padding: 3px 6px;
                    font-size: calc(11px * var(--app-text-scale, 1));
                    color: #000;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .rh-btn {
                    background: #c0c0c0;
                    color: #000;
                    font-size: calc(12px * var(--app-text-scale, 1));
                    padding: 4px 12px;
                    border: 2px solid;
                    border-color: #ffffff #404040 #404040 #ffffff;
                    cursor: pointer;
                    white-space: nowrap;
                }
                .rh-btn:active { border-color: #404040 #ffffff #ffffff #404040; }
                /* 忙碌态：按钮里的沙漏与文字并排居中 */
                .rh-btn { display: inline-flex; align-items: center; justify-content: center; gap: 4px; }
                .rh-btn:disabled { color: #808080; text-shadow: 1px 1px 0 #fff; cursor: default; }
                .rh-btn-primary { font-weight: 700; outline: 1px solid #000; }
                /* 浏览集市 / 我的货摊 切换（仿 Win98 标签页按钮） */
                .rh-tabs {
                    display: flex;
                    gap: 4px;
                    padding: 5px 6px 0;
                    flex-shrink: 0;
                }
                .rh-tab {
                    flex: 1;
                    padding: 5px 0;
                    background: #b0b0b0;
                    color: #404040;
                    font-size: calc(12px * var(--app-text-scale, 1));
                    border: 2px solid;
                    border-color: #ffffff #404040 #404040 #ffffff;
                    cursor: pointer;
                }
                .rh-tab[data-active] {
                    background: #fff;
                    color: #000080;
                    font-weight: 700;
                    border-color: #404040 #ffffff #ffffff #404040;
                }
                .rh-body {
                    flex: 1;
                    min-height: 0;
                    overflow-y: auto;
                    background: #fff;
                    border: 2px solid;
                    border-color: #404040 #ffffff #ffffff #404040;
                    margin: 6px;
                    color: #000;
                }
                .rh-center-hint {
                    padding: 42px 20px;
                    text-align: center;
                    color: #404040;
                    font-size: calc(12px * var(--app-text-scale, 1));
                    line-height: 1.8;
                }
                /* 首页文件夹网格：一行两个 */
                .rh-folder-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 4px;
                    padding: 10px;
                }
                .rh-folder {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 2px;
                    padding: 14px 6px 10px;
                    background: none;
                    border: 1px dotted transparent;
                    cursor: pointer;
                }
                .rh-folder:active { border-color: #000080; background: #e4ecf7; }
                .rh-folder-icon { font-size: 40px; line-height: 1; }
                .rh-folder-name {
                    font-size: calc(13px * var(--app-text-scale, 1));
                    color: #000;
                    word-break: break-all;
                }
                .rh-folder-count { font-size: calc(10px * var(--app-text-scale, 1)); color: #808080; }
                /* 论坛式条目列表 */
                .rh-entry-list { display: flex; flex-direction: column; }
                .rh-entry {
                    display: flex;
                    align-items: flex-start;
                    gap: 10px;
                    padding: 10px;
                    background: none;
                    border: none;
                    border-bottom: 1px solid #d4d0c8;
                    cursor: pointer;
                    text-align: left;
                }
                .rh-entry:active { background: #e4ecf7; }
                .rh-entry-pending { cursor: default; opacity: 0.72; }
                .rh-entry-pending:active { background: none; }
                .rh-entry-pending .rh-entry-title { color: #404040; text-decoration: none; }
                .rh-entry-thumb {
                    width: 52px;
                    height: 52px;
                    flex-shrink: 0;
                    object-fit: cover;
                    border: 1px solid #808080;
                    background: #f4f4f4;
                }
                .rh-entry-thumb-blank {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 24px;
                }
                .rh-entry-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
                .rh-entry-title {
                    font-size: calc(13px * var(--app-text-scale, 1));
                    color: #000080;
                    font-weight: 700;
                    text-decoration: underline;
                    word-break: break-all;
                }
                .rh-entry-desc {
                    font-size: calc(11px * var(--app-text-scale, 1));
                    color: #404040;
                    line-height: 1.5;
                    display: -webkit-box;
                    -webkit-line-clamp: 2;
                    -webkit-box-orient: vertical;
                    overflow: hidden;
                    white-space: pre-line;
                }
                .rh-entry-meta { font-size: calc(10px * var(--app-text-scale, 1)); color: #808080; }
                /* 详情：上=图文内容区（内部滚动），下=横滑文件条 + 操作按钮（钉底） */
                .rh-body-detail { overflow: hidden; display: flex; }
                .rh-detail2 {
                    flex: 1;
                    min-height: 0;
                    display: flex;
                    flex-direction: column;
                }
                .rh-detail2-main {
                    flex: 1;
                    min-height: 0;
                    overflow-y: auto;
                    padding: 10px;
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                }
                .rh-detail2-imgwrap {
                    display: flex;
                    justify-content: center;
                    -webkit-tap-highlight-color: rgba(0, 0, 128, 0.15);
                }
                .rh-detail2-main img {
                    max-width: min(220px, 62%);
                    max-height: 240px;
                    width: auto;
                    height: auto;
                    align-self: center;
                    border: 1px solid #808080;
                    pointer-events: none;
                }
                /* 发帖式排版：标题字号更大更粗，下带分隔线 */
                .rh-detail2-title {
                    font-size: calc(16px * var(--app-text-scale, 1));
                    font-weight: 700;
                    color: #000;
                    line-height: 1.4;
                    word-break: break-all;
                }
                /* 标题下的署名行（投稿人 · 日期），兼当标题与正文的分隔 */
                .rh-detail2-byline {
                    margin-top: -6px;
                    padding-bottom: 8px;
                    border-bottom: 1px solid #d4d0c8;
                    font-size: calc(11px * var(--app-text-scale, 1));
                    color: #606060;
                }
                /* 没有署名行时，分隔线回到标题下面 */
                .rh-detail2-title[data-solo] {
                    padding-bottom: 8px;
                    border-bottom: 1px solid #d4d0c8;
                }
                .rh-detail2-desc {
                    font-size: calc(12px * var(--app-text-scale, 1));
                    line-height: 1.8;
                    white-space: pre-wrap;
                    color: #000;
                }
                .rh-detail2-desc-empty { color: #808080; }
                .rh-file-strip {
                    flex-shrink: 0;
                    display: flex;
                    gap: 6px;
                    overflow-x: auto;
                    padding: 8px;
                    background: #c0c0c0;
                    border-top: 2px solid;
                    border-color: #808080 transparent transparent transparent;
                    box-shadow: inset 0 1px 0 #404040;
                }
                .rh-file-tile {
                    flex-shrink: 0;
                    width: 84px;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 2px;
                    padding: 7px 4px 5px;
                    background: #fff;
                    border: 2px solid;
                    border-color: #ffffff #404040 #404040 #ffffff;
                    cursor: pointer;
                }
                .rh-file-tile[data-selected] {
                    border-color: #000080;
                    background: #e4ecf7;
                    outline: 1px solid #000080;
                }
                .rh-file-tile-ext {
                    font-size: calc(9px * var(--app-text-scale, 1));
                    font-weight: 700;
                    color: #000080;
                    letter-spacing: 0.04em;
                }
                .rh-file-tile-name {
                    max-width: 100%;
                    font-size: calc(10px * var(--app-text-scale, 1));
                    color: #000;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .rh-detail2-actions {
                    flex-shrink: 0;
                    display: flex;
                    gap: 8px;
                    padding: 8px;
                    background: #c0c0c0;
                    border-top: 1px solid #fff;
                }
                .rh-action-half { flex: 1; padding: 8px 0; }
                .rh-action-del { color: #a01818; font-weight: 700; padding: 8px 10px; }
                .rh-flower-btn { padding: 8px 8px; }
                /* 我的货摊：花数汇总行 */
                .rh-stall-flowers {
                    padding: 8px 10px;
                    font-size: calc(12px * var(--app-text-scale, 1));
                    font-weight: 700;
                    color: #a04060;
                    background: #fff0f4;
                    border-bottom: 1px solid #d4d0c8;
                }
                /* 非阻塞小提示 */
                .rh-toast {
                    position: absolute;
                    left: 50%;
                    bottom: 60px;
                    transform: translateX(-50%);
                    z-index: 70;
                    background: #ffffe1;
                    color: #000;
                    font-size: calc(12px * var(--app-text-scale, 1));
                    padding: 6px 16px;
                    border: 1px solid #000;
                    box-shadow: 2px 2px 0 #000;
                    white-space: nowrap;
                    pointer-events: none;
                }
                .rh-search-row {
                    display: flex;
                    gap: 6px;
                    padding: 8px 10px 4px;
                }
                /* 搜索框在白底上：右/下边也要有可见描边，不然和背景融为一体 */
                .rh-input.rh-search-input {
                    flex: 1;
                    min-width: 0;
                    border-color: #404040 #808080 #808080 #404040;
                    background: #fffff4;
                }
                .rh-statusbar {
                    display: flex;
                    justify-content: space-between;
                    gap: 8px;
                    padding: 3px 8px;
                    font-size: calc(10px * var(--app-text-scale, 1));
                    color: #000;
                    border-top: 1px solid #fff;
                    box-shadow: 0 -1px 0 #808080;
                    flex-shrink: 0;
                }
                .rh-statusbar span {
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                /* 对话框 */
                .rh-dialog-overlay {
                    position: absolute;
                    inset: 0;
                    background: rgba(0, 0, 0, 0.3);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 60;
                    padding: 20px;
                }
                .rh-dialog {
                    width: min(340px, 92%);
                    max-height: 76vh;
                    display: flex;
                    flex-direction: column;
                    background: #c0c0c0;
                    border: 2px solid;
                    border-color: #ffffff #404040 #404040 #ffffff;
                    box-shadow: 2px 2px 0 #000;
                }
                .rh-dialog-body {
                    padding: 14px 12px;
                    font-size: calc(13px * var(--app-text-scale, 1));
                    color: #000;
                    overflow-y: auto;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }
                .rh-dialog-icon { font-size: 30px; }
                .rh-dialog-footer {
                    display: flex;
                    justify-content: center;
                    gap: 10px;
                    padding: 0 12px 12px;
                }
                /* 导入弹窗：文件全名（不截断，允许换行） */
                .rh-import-filename {
                    padding: 8px 12px 0;
                    font-size: calc(12px * var(--app-text-scale, 1));
                    font-weight: 700;
                    color: #000;
                    word-break: break-all;
                    line-height: 1.5;
                }
                .rh-dest-list { flex-direction: column; align-items: stretch; gap: 3px; }
                /* 目的地图标网格（仿桌面图标：图标 + 名字，一行三个） */
                .rh-dest-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr 1fr;
                    gap: 6px;
                    align-items: stretch;
                }
                .rh-dest-tile {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 5px;
                    padding: 12px 4px 9px;
                    background: none;
                    border: 1px dotted transparent;
                    cursor: pointer;
                }
                .rh-dest-tile:active { border-color: #000080; background: #e4ecf7; }
                .rh-dest-tile-label {
                    font-size: calc(11px * var(--app-text-scale, 1));
                    color: #000;
                    text-align: center;
                    line-height: 1.3;
                    word-break: break-all;
                }
                .rh-dest {
                    display: flex;
                    flex-direction: column;
                    align-items: flex-start;
                    gap: 1px;
                    padding: 7px 10px;
                    background: #fff;
                    border: 1px solid #808080;
                    cursor: pointer;
                    text-align: left;
                }
                .rh-dest:active { background: #000080; }
                .rh-dest:active .rh-dest-label, .rh-dest:active .rh-dest-hint { color: #fff; }
                .rh-dest-label { font-size: calc(13px * var(--app-text-scale, 1)); color: #000; font-weight: 700; }
                .rh-dest-hint { font-size: calc(10px * var(--app-text-scale, 1)); color: #808080; }
                .rh-form { flex-direction: column; align-items: stretch; gap: 8px; }
                .rh-form label, .rh-form-field {
                    display: flex;
                    flex-direction: column;
                    gap: 3px;
                    font-size: calc(11px * var(--app-text-scale, 1));
                    color: #000;
                }
                /* 排版工具栏（上传弹窗：贴纸/颜色/字号/加粗/预览） */
                .rh-input-row { display: flex; gap: 4px; }
                .rh-input-row .rh-input { flex: 1; min-width: 0; }
                .rh-fmt-bar { display: flex; gap: 4px; flex-wrap: wrap; }
                .rh-fmt-btn {
                    background: #c0c0c0;
                    color: #000;
                    font-size: calc(11px * var(--app-text-scale, 1));
                    padding: 2px 8px;
                    border: 2px solid;
                    border-color: #ffffff #404040 #404040 #ffffff;
                    cursor: pointer;
                }
                .rh-fmt-btn:active, .rh-fmt-btn[data-active] { border-color: #404040 #ffffff #ffffff #404040; background: #d8d8d8; }
                .rh-fmt-bold { font-weight: 700; }
                .rh-sticker-panel {
                    display: grid;
                    grid-template-columns: repeat(8, 1fr);
                    gap: 2px;
                    padding: 4px;
                    background: #fff;
                    border: 1px solid #808080;
                }
                .rh-sticker-btn {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 3px;
                    background: none;
                    border: 1px dotted transparent;
                    cursor: pointer;
                }
                .rh-sticker-btn:active { border-color: #000080; background: #e4ecf7; }
                .rh-color-panel { display: flex; gap: 4px; padding: 4px; background: #fff; border: 1px solid #808080; }
                .rh-color-chip { width: 20px; height: 20px; border: 1px solid #404040; cursor: pointer; padding: 0; }
                .rh-desc-preview {
                    background: #fff;
                    border: 1px solid #808080;
                    padding: 8px;
                    font-size: calc(12px * var(--app-text-scale, 1));
                    line-height: 1.7;
                    white-space: pre-wrap;
                    color: #000;
                }
                /* 所见即所得编辑器：外观与 rh-input 一致，内容直接显示排版效果 */
                .rh-editor {
                    line-height: 1.7;
                    word-break: break-word;
                    white-space: pre-wrap;
                    -webkit-user-select: text;
                    user-select: text;
                    cursor: text;
                }
                .rh-editor-line { min-height: calc(20px * var(--app-text-scale, 1)); overflow-x: auto; white-space: nowrap; }
                .rh-editor-area { min-height: calc(66px * var(--app-text-scale, 1)); max-height: 40vh; overflow-y: auto; }
                .rh-editor[data-empty]::before {
                    content: attr(data-placeholder);
                    color: #a0a0a0;
                    pointer-events: none;
                }
                .rh-editor img { display: inline; vertical-align: -0.22em; }
                .rh-preview-label {
                    font-size: calc(10px * var(--app-text-scale, 1));
                    color: #808080;
                    margin-bottom: 5px;
                }
                .rh-preview-title {
                    font-weight: 700;
                    font-size: calc(14px * var(--app-text-scale, 1));
                    border-bottom: 1px solid #d4d0c8;
                    padding-bottom: 4px;
                    margin-bottom: 6px;
                }
                .rh-input {
                    background: #fff;
                    border: 2px solid;
                    border-color: #404040 #ffffff #ffffff #404040;
                    padding: 4px 6px;
                    font-size: calc(13px * var(--app-text-scale, 1));
                    color: #000;
                    outline: none;
                }
                /* 分类下拉：Win98 风格，去掉系统原生外观 */
                select.rh-input {
                    appearance: none;
                    -webkit-appearance: none;
                    background-color: #fff;
                    background-image: linear-gradient(45deg, transparent 50%, #000 50%), linear-gradient(135deg, #000 50%, transparent 50%);
                    background-position: calc(100% - 13px) center, calc(100% - 8px) center;
                    background-size: 5px 5px, 5px 5px;
                    background-repeat: no-repeat;
                    padding-right: 26px;
                    border-radius: 0;
                }
                .rh-form-hint { font-size: calc(10px * var(--app-text-scale, 1)); color: #606060; line-height: 1.6; }
                .rh-file-picker { cursor: pointer; }
                .rh-file-picker .rh-btn { display: block; text-align: center; }
                textarea.rh-input { resize: vertical; font-family: inherit; }
            `}</style>
        </div>
    );
}
