// lib/resource-hub-client.ts
// 资源集市客户端：CDN 多镜像拉取 + 目录索引 + 各目的地的导入落库。
// 浏览走 jsDelivr（国内可达、免限流），失败逐级回退，全程不经过自家服务端。

import { kvGet, kvSet, registerKvMigration } from "./kv-db";
import {
    RESOURCE_HUB_DEFAULT_SOURCE,
    type ImportDestination,
    type ResourceHubSource,
    type ShareIndex,
    type ShareIndexEntry,
    type ShareIndexFolder,
} from "./resource-hub-types";
import { createCharacter, loadCharacters, parseCharacterFromJson, parseCharacterFromPng, saveCharacters } from "./character-storage";
import {
    loadPresets, savePresets, parsePresetFromJson,
    loadWorldBooks, saveWorldBooks, parseWorldBookFromJson,
    loadRegexes, saveRegexes, parseRegexFromJson,
} from "./settings-storage";
import { saveScheme } from "./css-scheme-storage";
import { createOrGetSession, loadChatSessions, saveChatSessions } from "./chat-storage";
import { readThemeProfile, writeThemeProfile } from "./theme-storage";
import { loadGameDrafts, saveGameDrafts } from "./game-storage";
import type { GameTemplateDraft } from "./game-types";

const SOURCE_KEY = "ai_phone_resource_hub_source_v1";
registerKvMigration(SOURCE_KEY);

const FETCH_TIMEOUT_MS = 15000;

// ── 源配置 ──

export function loadResourceHubSource(): ResourceHubSource {
    try {
        const raw = kvGet(SOURCE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as Partial<ResourceHubSource>;
            if (parsed.owner && parsed.repo) {
                return { owner: parsed.owner, repo: parsed.repo, branch: parsed.branch || "main" };
            }
        }
    } catch { /* fall through */ }
    return { ...RESOURCE_HUB_DEFAULT_SOURCE };
}

export function saveResourceHubSource(source: ResourceHubSource): void {
    kvSet(SOURCE_KEY, JSON.stringify(source));
}

// ── CDN 拉取（多镜像回退）──

function encodePath(path: string): string {
    return path.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
}

// 已解析的最新 commit：@main 的 CDN 缓存可能滞后数小时，@commit 则永远精确。
// 每次拉目录时先问 GitHub 拿 main 的最新 commit 号，之后所有文件都按 commit 定位。
let _resolvedRef: { key: string; sha: string } | null = null;

function sourceKey(source: ResourceHubSource): string {
    return `${source.owner}/${source.repo}@${source.branch}`;
}

function effectiveRef(source: ResourceHubSource): string {
    return _resolvedRef?.key === sourceKey(source) ? _resolvedRef.sha : source.branch;
}

async function resolveLatestSha(source: ResourceHubSource): Promise<string | null> {
    try {
        const res = await fetchWithTimeout(
            `https://api.github.com/repos/${source.owner}/${source.repo}/commits/${encodeURIComponent(source.branch)}`,
            { headers: { Accept: "application/vnd.github.sha" } },
        );
        if (res.ok) {
            const sha = (await res.text()).trim();
            if (/^[0-9a-f]{40}$/i.test(sha)) return sha;
        }
    } catch { /* 拿不到就退回分支名 */ }
    return null;
}

function buildMirrorUrls(source: ResourceHubSource, path: string): string[] {
    const { owner, repo } = source;
    const ref = effectiveRef(source);
    const clean = encodePath(path);
    return [
        `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${ref}/${clean}`,
        `https://fastly.jsdelivr.net/gh/${owner}/${repo}@${ref}/${clean}`,
        `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${clean}`,
    ];
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        return await fetch(url, { ...init, signal: controller.signal, cache: "no-cache" });
    } finally {
        clearTimeout(timer);
    }
}

async function fetchMirrored(source: ResourceHubSource, path: string): Promise<Response> {
    let lastError: Error = new Error("无可用镜像");
    for (const url of buildMirrorUrls(source, path)) {
        try {
            const res = await fetchWithTimeout(url);
            if (res.ok) return res;
            lastError = new Error(`HTTP ${res.status}`);
        } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
        }
    }
    throw lastError;
}

/** 逐镜像尝试拉取文本；全部失败抛最后一个错误。 */
export async function fetchResourceHubText(source: ResourceHubSource, path: string): Promise<string> {
    return (await fetchMirrored(source, path)).text();
}

/** 二进制拉取（角色卡 PNG、应用 zip）。 */
export async function fetchResourceHubBinary(source: ResourceHubSource, path: string): Promise<ArrayBuffer> {
    return (await fetchMirrored(source, path)).arrayBuffer();
}

/** 图片等资源的展示 URL（仓库相对路径转 CDN 主镜像）。 */
export function resolveResourceHubAssetUrl(source: ResourceHubSource, pathOrUrl: string): string {
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
    return buildMirrorUrls(source, pathOrUrl)[0];
}

// ── 目录索引 ──

function normalizeIndex(raw: unknown): ShareIndex {
    const record = (raw ?? {}) as Record<string, unknown>;
    if (record.schema !== "ai_phone_share_index" || !Array.isArray(record.entries) || !Array.isArray(record.folders)) {
        throw new Error("索引格式不正确");
    }
    const folders: ShareIndexFolder[] = [];
    for (const f of record.folders) {
        const item = (f ?? {}) as Record<string, unknown>;
        if (typeof item.name !== "string") continue;
        folders.push({ name: item.name, count: typeof item.count === "number" ? item.count : 0 });
    }
    const entries: ShareIndexEntry[] = [];
    for (const e of record.entries) {
        const item = (e ?? {}) as Record<string, unknown>;
        if (typeof item.folder !== "string" || typeof item.name !== "string" || typeof item.path !== "string") continue;
        entries.push({
            folder: item.folder,
            name: item.name,
            type: item.type === "dir" ? "dir" : "file",
            path: item.path,
            files: Array.isArray(item.files) ? item.files.filter((v): v is string => typeof v === "string") : [],
            images: Array.isArray(item.images) ? item.images.filter((v): v is string => typeof v === "string") : [],
            description: typeof item.description === "string" ? item.description : "",
            author: typeof item.author === "string" ? item.author : "",
            updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : null,
        });
    }
    return {
        schema: "ai_phone_share_index",
        schemaVersion: typeof record.schemaVersion === "number" ? record.schemaVersion : 1,
        generatedAt: typeof record.generatedAt === "string" ? record.generatedAt : undefined,
        folders,
        entries,
    };
}

const IMAGE_RE = /\.(jpe?g|png|webp|gif)$/i;
const DESC_NAME_RE = /^(说明\.txt|readme\.(md|txt))$/i;
// 基建目录（上传服务/索引脚本等），不是资源，不进市场。
// 索引脚本同样会跳过它们；这里再过滤一层，防御旧索引缓存。
const HIDDEN_FOLDERS = new Set(["netlify", "scripts", "node_modules", ".github", ".git"]);

function stripHiddenFolders(index: ShareIndex): ShareIndex {
    return {
        ...index,
        folders: index.folders.filter(f => !HIDDEN_FOLDERS.has(f.name)),
        entries: index.entries.filter(e => !HIDDEN_FOLDERS.has(e.folder)),
    };
}

/** 资源统一存放的仓库根目录 */
export const RESOURCE_ROOT = "资源";

/** 兜底：_index.json 不可用时，用 jsDelivr data API 的文件树现场构建索引（无时间与说明）。 */
async function buildIndexFromTree(source: ResourceHubSource): Promise<ShareIndex> {
    const { owner, repo, branch } = source;
    const res = await fetchWithTimeout(`https://data.jsdelivr.com/v1/packages/gh/${owner}/${repo}@${branch}?structure=flat`);
    if (!res.ok) throw new Error(`文件树获取失败（HTTP ${res.status}）`);
    const data = await res.json() as { files?: Array<{ name?: string }> };
    // 只认 资源/ 下的内容：资源/<分类>/<资源子文件夹或孤立文件>
    const paths = (data.files ?? [])
        .map(f => (f.name || "").replace(/^\/+/, ""))
        .filter(p => p.startsWith(`${RESOURCE_ROOT}/`));

    const folderMap = new Map<string, Map<string, ShareIndexEntry>>();
    for (const p of paths) {
        const segments = p.split("/");
        if (segments.length < 3) continue; // 资源/ 下的孤立文件不算资源
        const folder = segments[1];
        if (!folder || folder.startsWith(".") || HIDDEN_FOLDERS.has(folder)) continue;
        const base = segments[segments.length - 1];
        if (base.startsWith(".")) continue; // .owner 等隐藏文件
        if (!folderMap.has(folder)) folderMap.set(folder, new Map());
        const entryMap = folderMap.get(folder)!;
        if (segments.length === 3) {
            // 孤立文件式资源
            const key = `file:${p}`;
            entryMap.set(key, {
                folder,
                name: segments[2].replace(/\.[^.]+$/, ""),
                type: "file",
                path: p,
                files: [p],
                images: [],
                description: "",
                updatedAt: null,
            });
        } else {
            // 子文件夹式资源（取第三层为资源名，深层文件归并进来）
            const entryPath = `${segments[0]}/${segments[1]}/${segments[2]}`;
            const key = `dir:${entryPath}`;
            if (!entryMap.has(key)) {
                entryMap.set(key, {
                    folder,
                    name: segments[2],
                    type: "dir",
                    path: entryPath,
                    files: [],
                    images: [],
                    description: "",
                    updatedAt: null,
                });
            }
            const entry = entryMap.get(key)!;
            if (IMAGE_RE.test(base)) entry.images.push(p);
            else if (!DESC_NAME_RE.test(base)) entry.files.push(p);
        }
    }

    const folders: ShareIndexFolder[] = [];
    const entries: ShareIndexEntry[] = [];
    for (const [name, entryMap] of folderMap) {
        folders.push({ name, count: entryMap.size });
        entries.push(...entryMap.values());
    }
    return { schema: "ai_phone_share_index", schemaVersion: 0, folders, entries };
}

/** 强刷 CDN 缓存（fire-and-forget；no-cors 下拿不到响应但清缓存已生效）。 */
export function purgeShareIndexCache(source: ResourceHubSource): void {
    if (typeof fetch === "undefined") return;
    const url = `https://purge.jsdelivr.net/gh/${source.owner}/${source.repo}@${source.branch}/_index.json`;
    fetch(url, { mode: "no-cors" }).catch(() => { /* 尽力而为 */ });
}

export async function fetchShareIndex(source: ResourceHubSource): Promise<ShareIndex> {
    // 先解析最新 commit，命中后本次会话的所有文件都按 commit 定位（免疫 CDN 缓存滞后）
    const sha = await resolveLatestSha(source);
    _resolvedRef = sha ? { key: sourceKey(source), sha } : null;
    try {
        const text = await fetchResourceHubText(source, "_index.json");
        return stripHiddenFolders(normalizeIndex(JSON.parse(text)));
    } catch {
        // 索引缺失/坏掉时退化为现场扫树（无时间排序与说明摘要）
        return stripHiddenFolders(await buildIndexFromTree(source));
    }
}

// ── 下载 ──

export async function downloadResourceHubFile(source: ResourceHubSource, path: string): Promise<void> {
    const buffer = await fetchResourceHubBinary(source, path);
    const filename = path.split("/").pop() || "resource";
    const { downloadFile } = await import("./download-utils");
    await downloadFile(new Blob([buffer]), filename);
}

// ── 导入 ──

const CHAT_APP_CSS_KEY = "chat-app-custom-css";

function fileBaseName(path: string): string {
    return (path.split("/").pop() || path).replace(/\.[^.]+$/, "");
}

/** 目的地对文件类型的基本校验；返回错误文案或 null。 */
export function checkImportFileForDestination(destination: ImportDestination, path: string): string | null {
    const lower = path.toLowerCase();
    const isJson = lower.endsWith(".json");
    switch (destination) {
        case "preset":
        case "regex":
        case "worldbook":
        case "game":
        case "theater":
            return isJson ? null : "该目的地需要 JSON 文件";
        case "character":
            return isJson || lower.endsWith(".png") ? null : "角色卡需要 JSON 或 PNG 文件";
        case "chat_session_css":
        case "chat_app_css":
        case "global_css":
            return lower.endsWith(".css") || lower.endsWith(".txt") ? null : "CSS 目的地需要 .css 或 .txt 文件";
        case "custom_app":
            return lower.endsWith(".zip") || lower.endsWith(".html") || lower.endsWith(".htm") ? null : "应用需要 zip 安装包或单 HTML 文件";
        case "plugin":
            return lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".txt") ? null : "插件需要 JS 源码文件";
    }
}

/**
 * 把资源文件导入到指定目的地。chat_session_css 必须传 contactId（选中的角色会话）。
 * 返回给用户看的结果说明。
 */
export async function importResourceHubFile(
    source: ResourceHubSource,
    path: string,
    destination: ImportDestination,
    options?: { contactId?: string },
): Promise<string> {
    const lower = path.toLowerCase();
    const displayName = fileBaseName(path);
    switch (destination) {
        case "preset": {
            const preset = parsePresetFromJson(await fetchResourceHubText(source, path), displayName);
            if (!preset) throw new Error("预设解析失败，请确认文件是预设管理页导出的 JSON");
            savePresets([...loadPresets(), preset]);
            return `预设「${preset.name}」已导入`;
        }
        case "regex": {
            const regex = parseRegexFromJson(await fetchResourceHubText(source, path), displayName);
            if (!regex) throw new Error("正则解析失败，请确认文件是正则管理页导出的 JSON");
            saveRegexes([...loadRegexes(), regex]);
            return `正则组「${regex.name}」已导入`;
        }
        case "worldbook": {
            const book = parseWorldBookFromJson(await fetchResourceHubText(source, path));
            if (!book) throw new Error("世界书解析失败，请确认文件是世界书管理页导出的 JSON");
            saveWorldBooks([...loadWorldBooks(), book]);
            return `世界书「${book.name}」已导入`;
        }
        case "character": {
            const data = lower.endsWith(".png")
                ? parseCharacterFromPng(await fetchResourceHubBinary(source, path))
                : parseCharacterFromJson(await fetchResourceHubText(source, path));
            if (!data) throw new Error("角色卡解析失败");
            const character = createCharacter(data);
            saveCharacters([...loadCharacters(), character]);
            return `角色「${character.name}」已加入角色库`;
        }
        case "chat_session_css": {
            const contactId = options?.contactId;
            if (!contactId) throw new Error("请选择要应用的角色");
            const css = await fetchResourceHubText(source, path);
            const session = createOrGetSession(contactId);
            const sessions = loadChatSessions().map(s => s.id === session.id ? { ...s, customCSS: css } : s);
            saveChatSessions(sessions);
            window.dispatchEvent(new CustomEvent("chat-session-css-updated", { detail: { sessionId: session.id, css } }));
            saveScheme("chat_session", displayName, css);
            return `聊天室 CSS 已应用，并存入方案库「${displayName}」`;
        }
        case "chat_app_css": {
            const css = await fetchResourceHubText(source, path);
            kvSet(CHAT_APP_CSS_KEY, css);
            window.dispatchEvent(new CustomEvent("chat-app-css-updated"));
            saveScheme("chat_app", displayName, css);
            return `聊天主页 CSS 已应用，并存入方案库「${displayName}」`;
        }
        case "global_css": {
            const css = await fetchResourceHubText(source, path);
            writeThemeProfile({ ...readThemeProfile(), globalCustomCSS: css });
            window.dispatchEvent(new CustomEvent("theme-css-updated"));
            saveScheme("global", displayName, css);
            return `全局 CSS 已应用（外观页可调整），并存入方案库「${displayName}」`;
        }
        case "custom_app": {
            const buffer = await fetchResourceHubBinary(source, path);
            const filename = path.split("/").pop() || "app.zip";
            const file = new File([buffer], filename);
            const { loadCustomAppPackage, loadSingleHtmlCustomApp, installCustomAppAsync } = await import("./custom-app-storage");
            const { applyCustomAppRegistrationsAsync } = await import("./custom-app-registration");
            const app = lower.endsWith(".zip") ? await loadCustomAppPackage(file) : await loadSingleHtmlCustomApp(file);
            const installed = await installCustomAppAsync(app);
            await applyCustomAppRegistrationsAsync(installed);
            return `应用「${installed.name}」已安装，桌面可找到图标`;
        }
        case "game": {
            const payload = JSON.parse(await fetchResourceHubText(source, path)) as { type?: string; title?: string; draft?: unknown };
            if (payload?.type !== "ai-phone-game-draft" || !payload.draft || typeof payload.draft !== "object") {
                throw new Error("不是有效的游戏草稿文件（需要游戏草稿箱「导出文件」生成）");
            }
            const now = new Date().toISOString();
            const title = (typeof payload.title === "string" && payload.title.trim()) || displayName;
            saveGameDrafts([
                {
                    id: `draft_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                    title,
                    draft: payload.draft as GameTemplateDraft,
                    createdAt: now,
                    updatedAt: now,
                },
                ...loadGameDrafts(),
            ]);
            return `游戏草稿「${title}」已导入草稿箱，可在游戏工作室查看发布`;
        }
        case "theater": {
            const payload = JSON.parse(await fetchResourceHubText(source, path)) as { type?: string; title?: string; draft?: unknown };
            if (payload?.type !== "ai-phone-theater-draft" || !payload.draft || typeof payload.draft !== "object") {
                throw new Error("不是有效的剧场草稿文件（需要剧场草稿箱「导出文件」生成）");
            }
            const now = new Date().toISOString();
            const title = (typeof payload.title === "string" && payload.title.trim()) || displayName;
            // 与黑市工作室共用同一 kv 键与记录形状（black-market-app / qa-content-tools 同款）
            const key = "ai_phone_black_market_studio_drafts_v1";
            let drafts: unknown[] = [];
            try { drafts = JSON.parse(kvGet(key) || "[]") as unknown[]; } catch { drafts = []; }
            if (!Array.isArray(drafts)) drafts = [];
            drafts.unshift({
                id: `bmdraft_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                title,
                draft: payload.draft,
                createdAt: now,
                updatedAt: now,
            });
            kvSet(key, JSON.stringify(drafts.slice(0, 80)));
            return `剧场草稿「${title}」已导入草稿箱，可在黑市工作室查看上架`;
        }
        case "plugin": {
            const code = await fetchResourceHubText(source, path);
            const { installChatPluginFromCode } = await import("./chat-plugin-loader");
            const result = await installChatPluginFromCode(code);
            if (!result.ok) throw new Error(result.error || "插件安装失败");
            return result.upgraded
                ? `插件「${result.name}」已升级（${result.fromVersion} → ${result.toVersion}）`
                : `插件「${result.name}」已安装，可在聊天设置的插件管理里启用`;
        }
    }
}
