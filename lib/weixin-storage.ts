import { kvGet, kvSet, registerKvMigration } from "./kv-db";
import { appNowISO } from "./app-clock";
// lib/weixin-storage.ts
// WeChat iLink Bot 配置持久化（localStorage）

const STORAGE_KEY = "weixin_bots_v1";

export type WeixinBotConfig = {
    id: string;           // 唯一ID
    characterId: string;  // 绑定的角色ID
    botToken: string;     // iLink bot_token（格式：wc_live_xxx）
    enabled: boolean;     // 是否启用
    nickname?: string;    // 显示名（默认用角色名）
    addedAt: string;      // ISO 日期
};

export function loadWeixinBots(): WeixinBotConfig[] {
    try {
        const raw = typeof window !== "undefined" ? kvGet(STORAGE_KEY) : null;
        return raw ? (JSON.parse(raw) as WeixinBotConfig[]) : [];
    } catch {
        return [];
    }
}

function saveWeixinBots(bots: WeixinBotConfig[]): void {
    try {
        kvSet(STORAGE_KEY, JSON.stringify(bots));
    } catch { /* quota exceeded — ignore */ }
}

export function addWeixinBot(bot: Omit<WeixinBotConfig, "id" | "addedAt">): WeixinBotConfig {
    const newBot: WeixinBotConfig = {
        ...bot,
        id: `wxbot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        addedAt: appNowISO(),
    };
    const bots = loadWeixinBots();
    saveWeixinBots([...bots, newBot]);
    return newBot;
}

export function addExclusiveWeixinBot(bot: Omit<WeixinBotConfig, "id" | "addedAt">): WeixinBotConfig {
    const newBot: WeixinBotConfig = {
        ...bot,
        id: `wxbot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        addedAt: appNowISO(),
        enabled: true,
    };
    const disabledBots = loadWeixinBots().map(item => ({ ...item, enabled: false }));
    saveWeixinBots([...disabledBots, newBot]);
    return newBot;
}

export function updateWeixinBot(id: string, updates: Partial<Omit<WeixinBotConfig, "id" | "addedAt">>): void {
    const bots = loadWeixinBots();
    const idx = bots.findIndex(b => b.id === id);
    if (idx === -1) return;
    bots[idx] = { ...bots[idx], ...updates };
    saveWeixinBots(bots);
}

export function removeWeixinBot(id: string): void {
    saveWeixinBots(loadWeixinBots().filter(b => b.id !== id));
}

// ── 保活设置 ──────────────────────────────────────────────────
const KEEPALIVE_KEY = "weixin_keepalive_v1";
registerKvMigration(STORAGE_KEY);
registerKvMigration(KEEPALIVE_KEY);

export function loadKeepAlive(): boolean {
    try { return kvGet(KEEPALIVE_KEY) === "1"; } catch { return false; }
}

export function saveKeepAlive(on: boolean): void {
    try { kvSet(KEEPALIVE_KEY, on ? "1" : "0"); } catch {}
}
