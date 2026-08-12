// lib/resource-hub-review.ts
// 资源集市审核（管理中心用）：把 share 仓库的待审投稿（open PR）拉下来，
// 在应用内预览与通过/拒绝。前端直连 GitHub API，权限由 GitHub 服务端裁决——
// token 没有仓库写权限时合并/关闭会被 403，界面伪造无意义。

import { loadResourceHubSource, purgeShareIndexCache } from "./resource-hub-client";
import { loadUploadConfig } from "./resource-hub-upload";

const GH_API = "https://api.github.com";
const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif)$/i;
const TEXT_PREVIEW_MAX = 1500;

export type ShareSubmission = {
    number: number;
    title: string;
    body: string;
    author: string;
    createdAt: string;
};

export type ShareSubmissionFile = {
    path: string;
    size: number;
    /** 图片：data URL 直接预览 */
    imageDataUrl?: string;
    /** 文本：截断预览 */
    textPreview?: string;
    /** 太大或无法解码时的占位说明 */
    note?: string;
};

function getReviewAuth(): { token: string; owner: string; repo: string } {
    const token = loadUploadConfig().githubToken.trim();
    if (!token) throw new Error("请先在资源集市设置（标题栏 ⚙）里填入你的 GitHub Token");
    const source = loadResourceHubSource();
    return { token, owner: source.owner, repo: source.repo };
}

async function gh<T>(token: string, method: string, url: string, body?: unknown): Promise<T> {
    const res = await fetch(url.startsWith("http") ? url : `${GH_API}${url}`, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const message = (data as { message?: string })?.message || `GitHub API ${res.status}`;
        throw new Error(res.status === 403 || res.status === 404 ? `没有权限或投稿不存在（${message}）` : message);
    }
    return data as T;
}

function decodeBase64Utf8(b64: string): string {
    const clean = b64.replace(/\s/g, "");
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
}

export async function listShareSubmissions(): Promise<ShareSubmission[]> {
    const { token, owner, repo } = getReviewAuth();
    const pulls = await gh<Array<{
        number: number; title: string; body?: string | null;
        user?: { login?: string } | null; created_at: string;
    }>>(token, "GET", `/repos/${owner}/${repo}/pulls?state=open&per_page=50`);
    return pulls.map(pr => ({
        number: pr.number,
        title: (pr.title || "").replace(/^投稿[:：]\s*/, ""),
        body: pr.body || "",
        author: pr.user?.login || "unknown",
        createdAt: pr.created_at,
    }));
}

export async function fetchShareSubmissionFiles(prNumber: number): Promise<ShareSubmissionFile[]> {
    const { token, owner, repo } = getReviewAuth();
    const files = await gh<Array<{ filename: string; contents_url: string; status: string }>>(
        token, "GET", `/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100`);

    const result: ShareSubmissionFile[] = [];
    for (const file of files.filter(f => f.status !== "removed")) {
        const entry: ShareSubmissionFile = { path: file.filename, size: 0 };
        try {
            const blob = await gh<{ content?: string; encoding?: string; size?: number }>(token, "GET", file.contents_url);
            entry.size = blob.size ?? 0;
            if (blob.encoding === "base64" && blob.content) {
                if (IMAGE_EXT_RE.test(file.filename)) {
                    const ext = file.filename.split(".").pop()!.toLowerCase().replace("jpg", "jpeg");
                    entry.imageDataUrl = `data:image/${ext};base64,${blob.content.replace(/\s/g, "")}`;
                } else {
                    const text = decodeBase64Utf8(blob.content);
                    entry.textPreview = text.slice(0, TEXT_PREVIEW_MAX) + (text.length > TEXT_PREVIEW_MAX ? "\n…（已截断）" : "");
                }
            } else {
                entry.note = `文件较大（${Math.round(entry.size / 1024)}KB），请到 GitHub 查看`;
            }
        } catch {
            entry.note = "内容预览失败";
        }
        result.push(entry);
    }
    return result;
}

// ── 自动审核开关 ──
// 开关存在资源仓库的 _config.json 里：写它需要仓库写权限，所以"只有仓库
// 所有者能开"是 GitHub 服务端在裁决，前端伪造管理员身份没有任何用。

const CONFIG_FILE = "_config.json";

/** 当前 token 对资源仓库有没有写权限（决定要不要显示自动审核开关） */
export async function canManageShareRepo(): Promise<boolean> {
    try {
        const { token, owner, repo } = getReviewAuth();
        const info = await gh<{ permissions?: { push?: boolean } }>(token, "GET", `/repos/${owner}/${repo}`);
        return info.permissions?.push === true;
    } catch {
        return false;
    }
}

export async function fetchAutoApprove(): Promise<boolean> {
    const { token, owner, repo } = getReviewAuth();
    try {
        const file = await gh<{ content?: string }>(token, "GET", `/repos/${owner}/${repo}/contents/${CONFIG_FILE}`);
        const cfg = JSON.parse(decodeBase64Utf8(file.content || "")) as { autoApprove?: boolean };
        return cfg?.autoApprove === true;
    } catch {
        // 没配置过/读不到，一律按关闭处理
        return false;
    }
}

/** 写开关。没有仓库写权限的人会被 GitHub 挡在 403。 */
export async function setAutoApprove(enabled: boolean): Promise<void> {
    const { token, owner, repo } = getReviewAuth();
    let sha: string | undefined;
    let current: Record<string, unknown> = {};
    try {
        const file = await gh<{ sha?: string; content?: string }>(token, "GET", `/repos/${owner}/${repo}/contents/${CONFIG_FILE}`);
        sha = file.sha;
        current = JSON.parse(decodeBase64Utf8(file.content || "")) as Record<string, unknown>;
    } catch { /* 首次写入 */ }
    const body = JSON.stringify({ ...current, autoApprove: enabled }, null, 2);
    const content = btoa(unescape(encodeURIComponent(body)));
    await gh(token, "PUT", `/repos/${owner}/${repo}/contents/${CONFIG_FILE}`, {
        // 带 [skip-index] 免得为一个开关白跑一次索引重建
        message: `${enabled ? "开启" : "关闭"}自动审核 [skip-index]`,
        content,
        ...(sha ? { sha } : {}),
    });
}

/** 通过并上架（合并 PR），并强刷索引的 CDN 缓存让新资源尽快可见。 */
export async function approveShareSubmission(prNumber: number): Promise<void> {
    const { token, owner, repo } = getReviewAuth();
    await gh(token, "PUT", `/repos/${owner}/${repo}/pulls/${prNumber}/merge`, { merge_method: "merge" });
    // 索引由资源仓库的 Actions 在合并后重建（约 1 分钟），这里先把 CDN 缓存清掉
    setTimeout(() => purgeShareIndexCache(loadResourceHubSource()), 90_000);
    purgeShareIndexCache(loadResourceHubSource());
}

/**
 * 管理员删除已上架资源（下架）：递归删除该路径下的所有文件并直接提交默认分支。
 * 需要有仓库写权限的 token；普通用户 token 会被 GitHub 403。
 */
export async function deleteShareEntry(entryPath: string): Promise<void> {
    const { token, owner, repo } = getReviewAuth();
    const encode = (p: string) => p.split("/").map(encodeURIComponent).join("/");

    const removeFile = async (path: string, sha: string) => {
        await gh(token, "DELETE", `/repos/${owner}/${repo}/contents/${encode(path)}`, {
            message: `下架：${path}`,
            sha,
        });
    };

    const removePath = async (path: string): Promise<void> => {
        const info = await gh<Array<{ path: string; sha: string; type: string }> | { path: string; sha: string; type: string }>(
            token, "GET", `/repos/${owner}/${repo}/contents/${encode(path)}`);
        if (Array.isArray(info)) {
            for (const item of info) {
                if (item.type === "dir") await removePath(item.path);
                else await removeFile(item.path, item.sha);
            }
        } else {
            await removeFile(info.path, info.sha);
        }
    };

    await removePath(entryPath);
}

/** 拒绝（关闭 PR，可选留言让投稿人看到理由）。 */
export async function rejectShareSubmission(prNumber: number, reason?: string): Promise<void> {
    const { token, owner, repo } = getReviewAuth();
    const trimmed = reason?.trim();
    if (trimmed) {
        await gh(token, "POST", `/repos/${owner}/${repo}/issues/${prNumber}/comments`, { body: `审核未通过：${trimmed}` });
    }
    await gh(token, "PATCH", `/repos/${owner}/${repo}/pulls/${prNumber}`, { state: "closed" });
}
