// lib/netease/anon-token.ts — 移植自 NeteaseCloudMusicApi 的 register_anonimous + generateConfig。
// 原版服务端启动时注册一个匿名设备身份，换回一个 MUSIC_A cookie，后续所有未登录请求都带着它。
// 这里改成客户端启动时（首次使用网易云功能前）调用一次，结果存进 cookie-store，
// 和真正登录后的 MUSIC_U 是同一份 cookie 字符串，互不冲突。

import CryptoJS from "crypto-js";
import { kvGet, kvSet, registerKvMigration } from "@/lib/kv-db";
import { neteaseRequest } from "./request";
import { getOrCreateDeviceId, isNeteaseLoggedIn } from "./cookie-store";

const ID_XOR_KEY = "3go8&$8*3*3h0k(2)2";
const ANON_TOKEN_READY_KEY = "ai_phone_netease_anon_ready_v1";
registerKvMigration(ANON_TOKEN_READY_KEY);

function xorEncodeId(someId: string): string {
    let xored = "";
    for (let i = 0; i < someId.length; i++) {
        const code = someId.charCodeAt(i) ^ ID_XOR_KEY.charCodeAt(i % ID_XOR_KEY.length);
        xored += String.fromCharCode(code);
    }
    const digest = CryptoJS.MD5(CryptoJS.enc.Utf8.parse(xored));
    return CryptoJS.enc.Base64.stringify(digest);
}

let inflight: Promise<void> | null = null;

/**
 * 保证匿名身份已经注册过，拿到 MUSIC_A cookie。已登录、或者这个设备已经注册过，就直接跳过。
 * 幂等、可以随便多次调用（并发调用会共享同一次请求）。
 */
export async function ensureNeteaseAnonymousToken(): Promise<void> {
    if (isNeteaseLoggedIn()) return;
    if (kvGet(ANON_TOKEN_READY_KEY) === "1") return;
    if (inflight) return inflight;

    inflight = (async () => {
        const deviceId = getOrCreateDeviceId();
        const encodedId = CryptoJS.enc.Base64.stringify(
            CryptoJS.enc.Utf8.parse(`${deviceId} ${xorEncodeId(deviceId)}`),
        );
        try {
            const res = await neteaseRequest<{ code?: number }>(
                "/api/register/anonimous",
                { username: encodedId },
                "weapi",
            );
            if (res.status === 200) {
                kvSet(ANON_TOKEN_READY_KEY, "1");
            }
        } catch (e) {
            console.warn("[NeteaseAnon] register_anonimous failed:", e);
        }
    })();
    try {
        await inflight;
    } finally {
        inflight = null;
    }
}
