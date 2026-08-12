// lib/resource-hub-identity.ts
// 「摊主钥匙」：一台设备一把（可导出到别的设备），所有发布共用。
//
// 为什么这么设计：集市不要求注册登录，服务端没有可认的身份，所以用
// "谁拿得出钥匙谁就是作者"。仓库里只存钥匙的 SHA-256 指纹（.owner），
// 钥匙本体永远不离开用户设备——服务端每次现算现比，比完就扔。
//
// 换设备时把钥匙带过去即可：索引里带着每条资源的指纹，新设备拿钥匙
// 一算就知道哪些是自己的，「我的货摊」自动认领回来。

import { hydrateKvDb, kvGet, kvSet, registerKvMigration } from "./kv-db";
import { loadMyUploads, type MyUploadRecord } from "./resource-hub-upload";

const IDENTITY_KEY = "ai_phone_resource_hub_identity_v1";
registerKvMigration(IDENTITY_KEY);

const KEY_RE = /^[a-f0-9]{48}$/i;

/**
 * 取本机钥匙，没有就生成一把（48 位十六进制 = 192 bit 随机）。
 *
 * 必须先等存储层加载完再判断"有没有"：kv 是 IndexedDB 撑的，冷启动那一小会儿
 * 读出来是空的，若此时就生成新钥匙，会把用户原来的钥匙覆盖掉——等于把他
 * 已发布资源的所有权凭空丢掉。所以这个函数是异步的，且只有它能创建钥匙。
 */
export async function ensureIdentityKey(): Promise<string> {
    await hydrateKvDb();
    const existing = peekIdentityKey();
    if (existing) return existing;
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const key = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
    kvSet(IDENTITY_KEY, key);
    return key;
}

/** 只读取，不生成（判断有没有设置过） */
export function peekIdentityKey(): string {
    const existing = (kvGet(IDENTITY_KEY) || "").trim().toLowerCase();
    return KEY_RE.test(existing) ? existing : "";
}

export function setIdentityKey(key: string): void {
    const clean = key.trim().toLowerCase();
    if (!KEY_RE.test(clean)) throw new Error("钥匙格式不对（应为 48 位字母数字）");
    kvSet(IDENTITY_KEY, clean);
}

export async function sha256Hex(text: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

// ── 导出 / 导入 ──

const EXPORT_PREFIX = "FLOATKEY1:";

type KeyBundle = {
    v: 1;
    /** 摊主钥匙 */
    id: string;
    /** 早期发布用的一资源一钥匙，一并带走免得旧资源失联 */
    legacy: Array<{ path: string; key: string }>;
};

/** 导出成一行短码：钥匙 + 早期的单资源凭证 */
export function exportKeyBundle(identityKey: string): string {
    const bundle: KeyBundle = {
        v: 1,
        id: identityKey,
        legacy: loadMyUploads()
            .filter(r => r.ownerKey && r.ownerKey.toLowerCase() !== identityKey)
            .map(r => ({ path: r.path, key: r.ownerKey })),
    };
    const json = JSON.stringify(bundle);
    // 用 base64 包一层，避免用户复制时被换行/空格弄坏
    const base64 = btoa(unescape(encodeURIComponent(json)));
    return EXPORT_PREFIX + base64;
}

export type ImportResult = { identity: string; legacy: MyUploadRecord[] };

/** 解析导出码；也接受直接粘贴 48 位钥匙本体 */
export function parseKeyBundle(text: string): ImportResult {
    const clean = text.trim();
    if (KEY_RE.test(clean)) return { identity: clean.toLowerCase(), legacy: [] };
    if (!clean.startsWith(EXPORT_PREFIX)) throw new Error("这不是一串有效的摊主钥匙");
    let bundle: KeyBundle;
    try {
        bundle = JSON.parse(decodeURIComponent(escape(atob(clean.slice(EXPORT_PREFIX.length))))) as KeyBundle;
    } catch {
        throw new Error("钥匙内容已损坏，请重新复制");
    }
    if (!bundle || !KEY_RE.test(bundle.id || "")) throw new Error("钥匙内容不完整");
    const legacy = Array.isArray(bundle.legacy) ? bundle.legacy : [];
    return {
        identity: bundle.id.toLowerCase(),
        legacy: legacy
            .filter(item => item && typeof item.path === "string" && typeof item.key === "string")
            .map(item => ({
                path: item.path,
                name: item.path.split("/").pop() || item.path,
                ownerKey: item.key,
                uploadedAt: new Date(0).toISOString(),
            })),
    };
}
