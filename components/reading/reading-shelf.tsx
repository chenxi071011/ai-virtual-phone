"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronLeft, Palette } from "lucide-react";
import { loadBooks, addBook, updateBook, deleteBook, saveChapters, loadProgress, saveRawFile } from "@/lib/reading-storage";
import { decodeTxtArrayBuffer, parseTxtContent, parseEpubFile, PDF_PAGES_PER_CHAPTER } from "@/lib/reading-parser";
import type { Book, BookChapter } from "@/lib/reading-types";
import type { ReadingAppearance } from "@/lib/reading-appearance";
import { ReadingAppearanceDialog } from "./reading-appearance-dialog";
import { kvGet, kvSet, kvRemove } from "@/lib/kv-db";

type Props = {
    onOpenBook: (book: Book) => void;
    onClose: () => void;
    appearance: ReadingAppearance;
    backgroundUrl: string | null;
    onSaveAppearance: (
        appearance: ReadingAppearance,
        options: { backgroundFile: File | null; clearBackground: boolean; customFontFile: File | null; clearCustomFont: boolean }
    ) => Promise<void>;
};

const IMPORT_DIAG_KEY = "reading-import-diagnostic-v1";

type ImportDiagnostic = {
    status: "running" | "failed";
    stage: string;
    fileName: string;
    fileSize: number;
    format?: Book["format"];
    detail?: string;
    updatedAt: string;
};

function buildImportError(stage: string, err: unknown, format?: Book["format"]): { summary: string; detail?: string } {
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    const lower = detail.toLowerCase();

    if (lower.includes("notfounderror") || lower.includes("object store")) {
        return {
            summary: `导入失败，阶段：${stage}。本地阅读数据库结构异常，刷新页面后重试即可自动修复。`,
            detail,
        };
    }

    if (lower.includes("quotaexceeded")) {
        return {
            summary: `导入失败，阶段：${stage}。当前浏览器可用存储空间不足，原始文件没能保存成功。`,
            detail,
        };
    }

    if (lower.includes("database") || lower.includes("indexeddb") || lower.includes("idbdatabase")) {
        return {
            summary: `导入失败，阶段：${stage}。浏览器本地数据库写入失败。`,
            detail,
        };
    }

    if (lower.includes("out of memory") || lower.includes("memory") || lower.includes("allocation") || lower.includes("unable to allocate")) {
        return {
            summary: `导入失败，阶段：${stage}。当前手机内存不足，这份${format === "pdf" ? " PDF " : ""}文件对浏览器来说太大了。`,
            detail,
        };
    }

    if (lower.includes("abort") || lower.includes("interrupted")) {
        return {
            summary: `导入失败，阶段：${stage}。浏览器中断了这次文件处理，手机上常见于切后台、内存紧张或系统回收。`,
            detail,
        };
    }

    if (lower.includes("failed to load pdf.js") || lower.includes("pdf")) {
        return {
            summary: `导入失败，阶段：${stage}。PDF 引擎没能完成这份文件的读取。`,
            detail,
        };
    }

    return {
        summary: `导入失败，阶段：${stage}。`,
        detail,
    };
}

export function ReadingShelf({ onOpenBook, onClose, appearance, backgroundUrl, onSaveAppearance }: Props) {
    const [books, setBooks] = useState<Book[]>([]);
    const [progressMap, setProgressMap] = useState<Record<string, {
        chapterIndex: number;
        total: number;
        hasProgress: boolean;
        fraction?: number;
        current?: number;
        pageTotal?: number;
        scope?: "book" | "chapter";
    }>>({});
    const [importing, setImporting] = useState(false);
    const [importStatus, setImportStatus] = useState<string | null>(null);
    const [importError, setImportError] = useState<{ summary: string; detail?: string } | null>(null);
    const [search, setSearch] = useState("");
    const [showAppearanceDialog, setShowAppearanceDialog] = useState(false);
    const [editingBook, setEditingBook] = useState<Book | null>(null);
    const [editTitle, setEditTitle] = useState("");
    const [editAuthor, setEditAuthor] = useState("");
    const [editCover, setEditCover] = useState<string | undefined>(undefined);
    const coverInputRef = useRef<HTMLInputElement>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    const persistImportDiagnostic = (payload: ImportDiagnostic | null) => {
        if (typeof window === "undefined") return;
        if (!payload) {
            kvRemove(IMPORT_DIAG_KEY);
            return;
        }
        kvSet(IMPORT_DIAG_KEY, JSON.stringify(payload));
    };

    useEffect(() => {
        const allBooks = loadBooks();
        setBooks(allBooks);
        (async () => {
            const map: typeof progressMap = {};
            for (const b of allBooks) {
                const p = await loadProgress(b.id);
                map[b.id] = {
                    chapterIndex: p?.chapterIndex ?? 0,
                    total: b.totalChapters,
                    hasProgress: !!p,
                    fraction: p?.progressFraction,
                    current: p?.progressCurrent,
                    pageTotal: p?.progressTotal,
                    scope: p?.progressScope,
                };
            }
            setProgressMap(map);
        })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (typeof window === "undefined") return;
        try {
            const raw = kvGet(IMPORT_DIAG_KEY);
            if (!raw) return;
            const saved = JSON.parse(raw) as ImportDiagnostic;
            if (!saved?.stage || !saved?.updatedAt) return;

            const timeLabel = new Date(saved.updatedAt).toLocaleString();
            const sizeLabel = saved.fileSize > 0 ? `，文件大小约 ${(saved.fileSize / 1024 / 1024).toFixed(1)} MB` : "";
            const summary = saved.status === "running"
                ? `上次导入在「${saved.stage}」阶段中断了。文件：${saved.fileName}${sizeLabel}。时间：${timeLabel}。`
                : `上次导入在「${saved.stage}」阶段失败。文件：${saved.fileName}${sizeLabel}。时间：${timeLabel}。`;
            setImportError({ summary, detail: saved.detail });
        } catch {
            // Ignore broken diagnostics.
        }
    }, []);

    // Dismiss must also clear the persisted diagnostic — it's reloaded on every
    // mount, which is what made the old inline banner impossible to get rid of.
    const dismissImportError = () => {
        setImportError(null);
        persistImportDiagnostic(null);
    };

    const filteredBooks = search.trim()
        ? books.filter(b => b.title.toLowerCase().includes(search.toLowerCase()) || b.author?.toLowerCase().includes(search.toLowerCase()))
        : books;

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        e.target.value = "";
        setImporting(true);
        setImportError(null);
        setImportStatus("正在准备导入…");
        let importStage = "准备导入";
        const ext = file.name.split(".").pop()?.toLowerCase();
        const detectedFormat = ext === "pdf" ? "pdf" : ext === "epub" ? "epub" : "txt";
        persistImportDiagnostic({
            status: "running",
            stage: importStage,
            fileName: file.name,
            fileSize: file.size,
            format: detectedFormat,
            updatedAt: new Date().toISOString(),
        });

        try {
            let parsed;
            let format: Book["format"];
            let rawFile: Blob | null = null;

            if (ext === "txt") {
                importStage = "读取 TXT 文件";
                setImportStatus("正在读取 TXT 文件…");
                persistImportDiagnostic({
                    status: "running",
                    stage: importStage,
                    fileName: file.name,
                    fileSize: file.size,
                    format: "txt",
                    updatedAt: new Date().toISOString(),
                });
                const { text } = decodeTxtArrayBuffer(await file.arrayBuffer());
                parsed = parseTxtContent(text, file.name);
                format = "txt";
            } else if (ext === "epub") {
                importStage = "读取 EPUB 文件";
                setImportStatus("正在读取 EPUB 文件…");
                persistImportDiagnostic({
                    status: "running",
                    stage: importStage,
                    fileName: file.name,
                    fileSize: file.size,
                    format: "epub",
                    updatedAt: new Date().toISOString(),
                });
                const buffer = await file.arrayBuffer();
                importStage = "解析 EPUB 内容";
                setImportStatus("正在解析 EPUB 内容…");
                persistImportDiagnostic({
                    status: "running",
                    stage: importStage,
                    fileName: file.name,
                    fileSize: file.size,
                    format: "epub",
                    updatedAt: new Date().toISOString(),
                });
                parsed = await parseEpubFile(buffer, file.name);
                format = "epub";
            } else if (ext === "pdf") {
                rawFile = file;
                importStage = "创建 PDF 导入记录";
                setImportStatus("正在创建 PDF 导入记录…");
                persistImportDiagnostic({
                    status: "running",
                    stage: importStage,
                    fileName: file.name,
                    fileSize: file.size,
                    format: "pdf",
                    updatedAt: new Date().toISOString(),
                });
                parsed = {
                    title: file.name.replace(/\.[^.]+$/, "") || "未命名",
                    chapters: [{ title: `第1-${PDF_PAGES_PER_CHAPTER}页`, paragraphs: [] }],
                    totalPages: 0,
                };
                format = "pdf";
            } else {
                alert("不支持的格式，请上传 TXT、EPUB 或 PDF 文件");
                persistImportDiagnostic(null);
                return;
            }

            const bookId = `book_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            const book: Book = {
                id: bookId,
                title: parsed.title,
                author: parsed.author,
                format,
                totalChapters: parsed.chapters.length,
                createdAt: new Date().toISOString(),
            };

            const chapters: BookChapter[] = parsed.chapters.map((ch, i) => {
                if (format === "pdf") {
                    const pageStart = i * PDF_PAGES_PER_CHAPTER + 1;
                    const totalPages = "totalPages" in parsed ? (parsed as { totalPages: number }).totalPages : pageStart + PDF_PAGES_PER_CHAPTER - 1;
                    const pageEnd = Math.min(pageStart + PDF_PAGES_PER_CHAPTER - 1, totalPages);
                    return {
                        id: `${bookId}_ch${i}`,
                        bookId,
                        index: i,
                        title: ch.title,
                        paragraphs: [],
                        pageStart,
                        pageEnd,
                    };
                }
                return { id: `${bookId}_ch${i}`, bookId, index: i, title: ch.title, paragraphs: ch.paragraphs };
            });

            importStage = "写入书架数据";
            setImportStatus("正在写入书架数据…");
            persistImportDiagnostic({
                status: "running",
                stage: importStage,
                fileName: file.name,
                fileSize: file.size,
                format,
                updatedAt: new Date().toISOString(),
            });
            await addBook(book);
            await saveChapters(bookId, chapters);
            if (rawFile) {
                try {
                    importStage = format === "pdf" ? "保存原始 PDF 文件" : "保存原始文件";
                    setImportStatus(format === "pdf" ? "正在保存原始 PDF 文件…" : "正在保存原始文件…");
                    persistImportDiagnostic({
                        status: "running",
                        stage: importStage,
                        fileName: file.name,
                        fileSize: file.size,
                        format,
                        updatedAt: new Date().toISOString(),
                    });
                    await saveRawFile(bookId, rawFile);
                } catch (saveErr) {
                    await deleteBook(bookId).catch(() => {});
                    const built = buildImportError(importStage, saveErr, format);
                    setImportError(built);
                    persistImportDiagnostic({
                        status: "failed",
                        stage: importStage,
                        fileName: file.name,
                        fileSize: file.size,
                        format,
                        detail: built.detail || built.summary,
                        updatedAt: new Date().toISOString(),
                    });
                    return;
                }
            }
            setBooks(loadBooks());
            setProgressMap(prev => ({ ...prev, [bookId]: { chapterIndex: 0, total: chapters.length, hasProgress: false } }));
            setImportStatus(null);
            persistImportDiagnostic(null);
        } catch (err) {
            console.error("[Reading] Import failed:", err);
            const format = detectedFormat;
            const built = buildImportError(importStage, err, format);
            setImportError(built);
            persistImportDiagnostic({
                status: "failed",
                stage: importStage,
                fileName: file.name,
                fileSize: file.size,
                format,
                detail: built.detail || built.summary,
                updatedAt: new Date().toISOString(),
            });
        } finally {
            setImporting(false);
            setImportStatus(null);
        }
    };

    const handleDelete = async (bookId: string) => {
        if (!confirm("确定删除这本书吗？")) return;
        await deleteBook(bookId);
        setBooks(loadBooks());
    };

    const openEditor = (book: Book) => {
        setEditingBook(book);
        setEditTitle(book.title);
        setEditAuthor(book.author || "");
        setEditCover(book.coverUrl);
    };

    const closeEditor = () => {
        setEditingBook(null);
        if (coverInputRef.current) coverInputRef.current.value = "";
    };

    /**
     * 封面存进 kv 里，原图直接转 dataURL 会把几 MB 的照片塞进存储，
     * 所以先按书架封面的实际显示尺寸压到 480px 宽再编码。
     */
    const readCoverFile = (file: File) => new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("读取图片失败"));
        reader.onload = () => {
            const img = new Image();
            img.onerror = () => reject(new Error("图片解析失败"));
            img.onload = () => {
                const MAX_W = 480;
                const scale = Math.min(1, MAX_W / img.width);
                const w = Math.max(1, Math.round(img.width * scale));
                const h = Math.max(1, Math.round(img.height * scale));
                const canvas = document.createElement("canvas");
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext("2d");
                if (!ctx) { reject(new Error("画布不可用")); return; }
                ctx.drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL("image/jpeg", 0.82));
            };
            img.src = String(reader.result);
        };
        reader.readAsDataURL(file);
    });

    const handleCoverPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            setEditCover(await readCoverFile(file));
        } catch (err) {
            alert(err instanceof Error ? err.message : "封面设置失败");
        }
    };

    const handleSaveEdit = async () => {
        if (!editingBook) return;
        const title = editTitle.trim();
        if (!title) { alert("书名不能为空"); return; }
        const author = editAuthor.trim();
        await updateBook({
            ...editingBook,
            title,
            author: author || undefined,
            coverUrl: editCover,
        });
        setBooks(loadBooks());
        closeEditor();
    };

    const formatBadge = (f: string) => f.toUpperCase();

    const coverGradients = ["linen", "mist", "graphite", "sage", "cream", "parchment"] as const;
    const coverLayouts = ["layout-1", "layout-2", "layout-3", "layout-4"] as const;

    return (
        <div className="reading-app-surface absolute inset-0 z-[100] flex flex-col">
            <header className="reading-shelf-header">
                <div className="reading-shelf-appbar">
                    <button className="reading-shelf-back" type="button" onClick={onClose} aria-label="返回">
                        <ChevronLeft size={22} strokeWidth={2.5} />
                    </button>
                    <div className="reading-shelf-actions">
                        <button className="reading-shelf-action-btn" type="button" onClick={() => setShowAppearanceDialog(true)} aria-label="阅读外观">
                            <Palette size={16} strokeWidth={1.7} />
                        </button>
                        <label className="reading-shelf-action-btn reading-shelf-action-primary" style={{ cursor: "pointer" }}>
                            <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 5v14M5 12h14" />
                            </svg>
                            <input ref={fileRef} type="file" accept=".txt,.epub,.pdf" onChange={handleFileUpload} className="hidden" disabled={importing} />
                        </label>
                    </div>
                </div>
                <div className="reading-shelf-title-stack">
                    <h1 className="reading-shelf-title">书架</h1>
                    <span className="reading-shelf-subtitle">{books.length} BOOKS IN YOUR LIBRARY</span>
                </div>
            </header>

            <div className="reading-shelf-body">
                <div className="px-4 pb-3">
                    <div className="reading-search-bar">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                        <input
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder={`搜索 ${books.length} 本书`}
                            className="reading-search-input"
                        />
                    </div>
                </div>

                {importing && (
                    <div className="text-center ts-13 py-2" style={{ color: "var(--reading-warm-brown, #8a5a2b)" }}>
                        {importStatus ? `导入中：${importStatus}` : "导入中..."}
                    </div>
                )}
                {importError && (
                    <div className="modal-overlay" data-ui="modal" onClick={dismissImportError}>
                        <div className="reading-import-error-card reading-import-error-dialog" onClick={(e) => e.stopPropagation()}>
                            <button type="button" className="reading-import-error-close" onClick={dismissImportError} aria-label="关闭">✕</button>
                            <div className="reading-import-error-kicker">IMPORT ERROR</div>
                            <div className="ts-13 font-medium" style={{ color: "#2f261f" }}>导入失败</div>
                            <div className="ts-12 mt-1" style={{ color: "#7f7266" }}>{importError.summary}</div>
                            {importError.detail && (
                                <div className="ts-11 mt-2 break-all reading-import-error-detail" style={{ color: "#a39487" }}>{importError.detail}</div>
                            )}
                            <button type="button" className="reading-import-error-ok" onClick={dismissImportError}>知道了</button>
                        </div>
                    </div>
                )}

                {filteredBooks.length === 0 ? (
                    <div className="py-10 text-center ts-14" style={{ color: "var(--reading-warm-ink-tertiary, #999)" }}>
                        {books.length === 0 ? "还没有书籍，点右上角 + 导入" : "没有匹配的书籍"}
                    </div>
                ) : (
                    <div className="reading-book-list">
                        {filteredBooks.map(book => {
                            const prog = progressMap[book.id];
                            const fallbackFraction = prog?.hasProgress && prog.total > 0
                                ? Math.min(1, Math.max(0, (prog.chapterIndex + 1) / prog.total))
                                : 0;
                            const progressFraction = prog?.hasProgress
                                ? Math.min(1, Math.max(0, prog.fraction ?? fallbackFraction))
                                : 0;
                            const progressPct = Math.round(progressFraction * 100);
                            const progressMeta = !prog?.hasProgress
                                ? null
                                : prog.scope === "book" && prog.current && prog.pageTotal
                                    ? `${prog.current}/${prog.pageTotal}`
                                    : prog.current && prog.pageTotal
                                        ? `第${Math.max(1, prog.chapterIndex + 1)}章 · ${prog.current}/${prog.pageTotal}`
                                        : `第${Math.max(1, prog.chapterIndex + 1)}/${Math.max(1, prog.total)}章`;
                            const gradient = coverGradients[book.title.length % coverGradients.length];
                            const layout = coverLayouts[(book.title.length + (book.author?.length || 0)) % coverLayouts.length];
                            return (
                                <div key={book.id} className="reading-list-item" onClick={() => onOpenBook(book)}>
                                    {book.coverUrl ? (
                                        <div className="reading-list-cover reading-list-cover--image">
                                            <img src={book.coverUrl} alt="" />
                                        </div>
                                    ) : (
                                        <div className={`reading-list-cover reading-list-cover--${gradient} reading-list-cover--${layout}`}>
                                            <span className="reading-list-cover-author">{book.author || ""}</span>
                                            <span className="reading-list-cover-title">{book.title}</span>
                                        </div>
                                    )}
                                    <div className="reading-list-info">
                                        <span className="reading-list-title">{book.title}</span>
                                        {book.author && <span className="reading-list-author">{book.author}</span>}
                                        <div className="reading-list-meta">
                                            <span className="reading-list-badge">{formatBadge(book.format)}</span>
                                            <span>{book.totalChapters}章</span>
                                        </div>
                                        <div className="reading-list-progress-row">
                                            <span className="reading-list-progress-label">
                                                {prog?.hasProgress ? `阅读进度 ${progressPct}%` : "未开始阅读"}
                                            </span>
                                            {progressMeta && (
                                                <span className="reading-list-progress-meta">
                                                    {progressMeta}
                                                </span>
                                            )}
                                        </div>
                                        <div className="reading-list-progress-track" aria-hidden="true">
                                            <div className="reading-list-progress-fill" style={{ width: `${prog?.hasProgress ? progressPct : 0}%` }} />
                                        </div>
                                    </div>
                                    <button
                                        className="reading-list-delete"
                                        onClick={(e) => { e.stopPropagation(); openEditor(book); }}
                                        aria-label="编辑书籍信息"
                                    >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                        </svg>
                                    </button>
                                    <button
                                        className="reading-list-delete"
                                        onClick={(e) => { e.stopPropagation(); handleDelete(book.id); }}
                                        aria-label="删除书籍"
                                    >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                            <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                        </svg>
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}

                <div className="reading-shelf-footer">
                    共 {books.length} 本书籍
                </div>
            </div>

            {showAppearanceDialog && (
                <ReadingAppearanceDialog
                    appearance={appearance}
                    backgroundUrl={backgroundUrl}
                    onClose={() => setShowAppearanceDialog(false)}
                    onSave={onSaveAppearance}
                />
            )}

            {editingBook && (
                <div className="modal-overlay" data-ui="modal" onClick={closeEditor}>
                    <div className="reading-edit-dialog" onClick={(e) => e.stopPropagation()}>
                        <div className="reading-edit-kicker">编辑书籍</div>

                        <label className="reading-edit-label" htmlFor="reading-edit-title">书名</label>
                        <input
                            id="reading-edit-title"
                            className="reading-edit-input"
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            placeholder="书名"
                        />

                        <label className="reading-edit-label" htmlFor="reading-edit-author">作者</label>
                        <input
                            id="reading-edit-author"
                            className="reading-edit-input"
                            value={editAuthor}
                            onChange={(e) => setEditAuthor(e.target.value)}
                            placeholder="留空则不显示"
                        />

                        <div className="reading-edit-label">封面</div>
                        <div className="reading-edit-cover-row">
                            <div className="reading-edit-cover-preview">
                                {editCover
                                    ? <img src={editCover} alt="" />
                                    : <span className="reading-edit-cover-empty">默认封面</span>}
                            </div>
                            <div className="reading-edit-cover-actions">
                                <button type="button" className="reading-edit-btn" onClick={() => coverInputRef.current?.click()}>
                                    选择图片
                                </button>
                                {editCover && (
                                    <button type="button" className="reading-edit-btn" onClick={() => setEditCover(undefined)}>
                                        恢复默认
                                    </button>
                                )}
                                <input
                                    ref={coverInputRef}
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    onChange={handleCoverPick}
                                />
                            </div>
                        </div>

                        <div className="reading-edit-footer">
                            <button type="button" className="reading-edit-btn" onClick={closeEditor}>取消</button>
                            <button type="button" className="reading-edit-btn reading-edit-btn--primary" onClick={handleSaveEdit}>保存</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
