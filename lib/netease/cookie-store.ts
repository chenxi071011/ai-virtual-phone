// lib/netease/cookie-store.ts — 登录会话 cookie + 设备指纹字段的本地持久化。
// 原版 NeteaseCloudMusicApi 是服务端在每次请求时用调用方传入的 cookie 字符串
// 现算一遍设备字段（processCookieObject），这里搬到客户端，逻辑一致，只是存取方式
// 换成本项目统一用的 kv-db（IndexedDB），设备字段生成一次后固定下来，不用每次重算。

import CryptoJS from "crypto-js";
import { kvGet, kvSet, kvRemove, registerKvMigration } from "@/lib/kv-db";

// 与 music-service.ts 里原来的登录态 cookie key 保持一致：那边负责保存 QR 登录
// 成功后拿到的 cookie 字符串（给"走远程 netease-api"的 fetch 路径用），这里搬过来
// 做唯一权威存放点，music-service.ts 改为从这里 re-export，避免两份存储互相打架。
const NETEASE_COOKIE_KEY = "ai_phone_netease_cookie_v1";
// 设备指纹字段只需要生成一次，长期复用（换了就等于"看起来像新设备"，没有好处）。
const NETEASE_DEVICE_KEY = "ai_phone_netease_device_v1";
const NETEASE_DEVICE_ID_KEY = "ai_phone_netease_device_id_v1";

registerKvMigration(NETEASE_COOKIE_KEY);
registerKvMigration(NETEASE_DEVICE_KEY);
registerKvMigration(NETEASE_DEVICE_ID_KEY);

/**
 * 和原版 util/index.js 的 generateDeviceId() 保持一致（52 位十六进制字符），
 * 匿名注册（register_anonimous）用它拼 username，cookie 的 deviceId 字段也用同一个值——
 * 原版里两处共用一个 global.deviceId，这里持久化下来达到同样效果。
 */
export function getOrCreateDeviceId(): string {
    const existing = kvGet(NETEASE_DEVICE_ID_KEY);
    if (existing) return existing;
    const hexChars = "0123456789ABCDEF";
    let id = "";
    for (let i = 0; i < 52; i++) id += hexChars.charAt(Math.floor(Math.random() * hexChars.length));
    try { kvSet(NETEASE_DEVICE_ID_KEY, id); } catch { /* ignore */ }
    return id;
}

export function saveNeteaseCookie(cookie: string): void {
    try { kvSet(NETEASE_COOKIE_KEY, cookie); } catch { /* ignore */ }
}

export function loadNeteaseCookie(): string {
    if (typeof window === "undefined") return "";
    try { return kvGet(NETEASE_COOKIE_KEY) || ""; } catch { return ""; }
}

export function clearNeteaseCookie(): void {
    try { kvRemove(NETEASE_COOKIE_KEY); } catch { /* ignore */ }
}

export function cookieToJson(cookie: string): Record<string, string> {
    if (!cookie) return {};
    const obj: Record<string, string> = {};
    for (const item of cookie.split(";")) {
        const idx = item.indexOf("=");
        if (idx > 0) obj[item.slice(0, idx).trim()] = item.slice(idx + 1).trim();
    }
    return obj;
}

export function cookieObjToString(obj: Record<string, string | undefined>): string {
    return Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(obj[k] as string)}`)
        .join("; ");
}

type DeviceFields = {
    deviceId: string;
    _ntes_nuid: string;
    _ntes_nnid: string;
    WNMCID: string;
    WEVNSM: string;
    osver: string;
    os: string;
    channel: string;
    appver: string;
};

function randomHex(bytes: number): string {
    return CryptoJS.lib.WordArray.random(bytes).toString();
}

function generateDeviceFields(): DeviceFields {
    const nuid = randomHex(32);
    const wnmChars = "abcdefghijklmnopqrstuvwxyz";
    let wnmRandom = "";
    for (let i = 0; i < 6; i++) wnmRandom += wnmChars.charAt(Math.floor(Math.random() * wnmChars.length));
    return {
        deviceId: getOrCreateDeviceId(),
        _ntes_nuid: nuid,
        _ntes_nnid: `${nuid},${Date.now()}`,
        WNMCID: `${wnmRandom}.${Date.now()}.01.0`,
        WEVNSM: "1.0.0",
        // 和现有 lib/music-service.ts 里给远程 API 传的 realIP 保持同一策略：伪装成安卓客户端。
        osver: "14",
        os: "android",
        channel: "xiaomi",
        appver: "8.20.20.231215173437",
    };
}

function loadOrCreateDeviceFields(): DeviceFields {
    try {
        const raw = kvGet(NETEASE_DEVICE_KEY);
        if (raw) return JSON.parse(raw) as DeviceFields;
    } catch { /* fall through and regenerate */ }
    const fields = generateDeviceFields();
    try { kvSet(NETEASE_DEVICE_KEY, JSON.stringify(fields)); } catch { /* ignore */ }
    return fields;
}

/**
 * 拼出这次请求要用的完整 cookie 对象：固定设备字段 + 已登录的会话 cookie（MUSIC_U/MUSIC_A 等）。
 * 对应原版 request.js 里的 processCookieObject。
 */
export function buildRequestCookie(uri: string): Record<string, string> {
    const device = loadOrCreateDeviceFields();
    const loginCookie = cookieToJson(loadNeteaseCookie());
    const merged: Record<string, string> = {
        ...device,
        __remember_me: "true",
        ntes_kaola_ad: "1",
        ...loginCookie,
    };
    if (!uri.includes("login")) {
        merged.NMTID = randomHex(16);
    }
    return merged;
}

/** 把响应里的 Set-Cookie 数组（已剥掉 Domain=... 片段）合并进已保存的登录 cookie 字符串。 */
export function mergeSetCookie(setCookieValues: string[]): void {
    if (!setCookieValues || setCookieValues.length === 0) return;
    const cleaned = setCookieValues.map((v) => v.replace(/\s*Domain=[^;]+;*/i, ""));
    const existing = cookieToJson(loadNeteaseCookie());
    for (const raw of cleaned) {
        const [pair] = raw.split(";");
        const idx = pair.indexOf("=");
        if (idx > 0) existing[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
    }
    saveNeteaseCookie(cookieObjToString(existing));
}

export function isNeteaseLoggedIn(): boolean {
    return !!cookieToJson(loadNeteaseCookie()).MUSIC_U;
}
