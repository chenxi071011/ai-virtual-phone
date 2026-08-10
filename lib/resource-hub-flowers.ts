// lib/resource-hub-flowers.ts
// 资源集市送花：下载成功自动送一朵，详情页也可手动送。
// 计数存在资源仓库根目录 _flowers.json（由上传服务的机器人维护），
// 数量只在「我的货摊」里展示给作者本人。
// 去重双保险：服务端按 IP+资源+天限 1 朵；本机也记录当天已送过的资源。

import { kvGet, kvSet, registerKvMigration } from "./kv-db";
import { fetchResourceHubText } from "./resource-hub-client";
import type { ResourceHubSource } from "./resource-hub-types";

const FLOWERS_SENT_KEY = "ai_phone_resource_hub_flowers_sent_v1";
registerKvMigration(FLOWERS_SENT_KEY);

const FLOWERS_FILE = "_flowers.json";

export type FlowerCounts = Record<string, number>;

function today(): string {
    return new Date().toISOString().slice(0, 10);
}

function loadSentMap(): Record<string, string> {
    try {
        const parsed = JSON.parse(kvGet(FLOWERS_SENT_KEY) || "{}") as Record<string, string>;
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch { return {}; }
}

/** 今天是否已给该资源送过花（本机记录） */
export function hasSentFlowerToday(path: string): boolean {
    return loadSentMap()[path] === today();
}

function recordFlowerSent(path: string): void {
    const map = loadSentMap();
    const day = today();
    // 只保留今天的记录，表不会无限膨胀
    const next: Record<string, string> = {};
    for (const [key, value] of Object.entries(map)) {
        if (value === day) next[key] = value;
    }
    next[path] = day;
    kvSet(FLOWERS_SENT_KEY, JSON.stringify(next));
}

/**
 * 送一朵花。返回 true 表示这朵真的送出去了（今天第一次）。
 * 网络失败静默返回 false —— 送花永远不该打断下载主流程。
 */
export async function sendFlower(endpoint: string, path: string): Promise<boolean> {
    if (hasSentFlowerToday(path)) return false;
    try {
        const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "flower", path }),
        });
        const data = await res.json().catch(() => ({})) as { ok?: boolean; already?: boolean };
        if (!res.ok || data.ok === false) return false;
        recordFlowerSent(path);
        return !data.already;
    } catch {
        return false;
    }
}

/** 读取全部资源的花数（走 CDN，SHA 定位保证新鲜）。文件不存在时返回空表。 */
export async function fetchFlowerCounts(source: ResourceHubSource): Promise<FlowerCounts> {
    try {
        const text = await fetchResourceHubText(source, FLOWERS_FILE);
        const parsed = JSON.parse(text) as FlowerCounts;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch { /* 没有人送过花或网络失败，一律按空表 */ }
    return {};
}
