// lib/netease/request.ts — 客户端直连网易云音乐服务器，移植自 NeteaseCloudMusicApi/util/request.js
// 的 createRequest()。原版用 axios 从 Node 服务器发请求；这里换成 CapacitorHttp（Capacitor 原生层，
// 天然绕过 WebView 的 CORS 限制），手机上不需要再跑一个本地/远程的 Node 代理进程。
//
// 只实现了 weapi / eapi 两种加密模式——这是 lib/music-service.ts 实际用到的这批接口
// （search/lyric/playlist/song-url/login-qr/user-record 等）用的全部模式，linuxapi 和明文 api
// 模式没有调用方用到，没有移植。

import { CapacitorHttp } from "@capacitor/core";
import { weapi, eapi } from "./crypto";
import { buildRequestCookie, cookieObjToString, mergeSetCookie } from "./cookie-store";

const DOMAIN = "https://music.163.com";
const API_DOMAIN = "https://interface.music.163.com";
// 不少歌曲（尤其是有版权限制的）只有大陆 IP 才能拿到播放地址，搜索接口不受影响所以感觉不出来，
// 一到取播放链接就会拿到 null。远程代理路径（lib/music-service.ts 的 withNeteaseParams）一直是
// 靠这个伪装 IP 才能放这些歌的，这里必须补上同一个头，否则会出现"能搜到、放不了"的情况。
const NETEASE_REAL_IP = process.env.NEXT_PUBLIC_NETEASE_REAL_IP || "116.25.146.177";
const WEAPI_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0";
const EAPI_UA = "NeteaseMusic/9.1.65.240927161425(9001065);Dalvik/2.1.0 (Linux; U; Android 14; 23013RK75C Build/UKQ1.230804.001)";

export type NeteaseCryptoMode = "weapi" | "eapi";

export type NeteaseResponse<T = unknown> = {
    status: number;
    body: T;
};

function generateRequestId(): string {
    return `${Date.now()}_${Math.floor(Math.random() * 1000).toString().padStart(4, "0")}`;
}

function findHeader(headers: Record<string, string>, name: string): string | undefined {
    const key = Object.keys(headers || {}).find((k) => k.toLowerCase() === name.toLowerCase());
    return key ? headers[key] : undefined;
}

/** 原生层把多条 Set-Cookie 合并成一个字符串时常用逗号拼接，这里按"逗号后面跟着一个 cookie 名="
 *  的规律切开，避免把 Expires 里的逗号（"Wed, 21-Oct-2026"）误判成分隔符。 */
function splitSetCookie(raw: string): string[] {
    return raw.split(/,(?=\s*[^,;=\s]+=)/g).map((s) => s.trim()).filter(Boolean);
}

/**
 * uri 形如 "/api/xxx/yyy"（和原版保持一致，方便对照 NeteaseCloudMusicApi 的 module/*.js）。
 */
export async function neteaseRequest<T = unknown>(
    uri: string,
    data: Record<string, unknown>,
    crypto: NeteaseCryptoMode = "eapi",
): Promise<NeteaseResponse<T>> {
    const cookie = buildRequestCookie(uri);
    const headers: Record<string, string> = {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Real-IP": NETEASE_REAL_IP,
        "X-Forwarded-For": NETEASE_REAL_IP,
    };

    let url: string;
    let encryptData: Record<string, unknown>;

    if (crypto === "weapi") {
        headers["Referer"] = DOMAIN;
        headers["User-Agent"] = WEAPI_UA;
        headers["Cookie"] = cookieObjToString(cookie);
        const payload = { ...data, csrf_token: cookie.__csrf || "" };
        encryptData = weapi(payload);
        url = `${DOMAIN}/weapi/${uri.slice(5)}`;
    } else {
        const header: Record<string, string> = {
            osver: cookie.osver,
            deviceId: cookie.deviceId,
            os: cookie.os,
            appver: cookie.appver,
            versioncode: cookie.versioncode || "140",
            mobilename: cookie.mobilename || "",
            buildver: cookie.buildver || Date.now().toString().slice(0, 10),
            resolution: cookie.resolution || "1920x1080",
            __csrf: cookie.__csrf || "",
            channel: cookie.channel,
            requestId: generateRequestId(),
        };
        if (cookie.MUSIC_U) header.MUSIC_U = cookie.MUSIC_U;
        if (cookie.MUSIC_A) header.MUSIC_A = cookie.MUSIC_A;

        headers["Cookie"] = cookieObjToString(header);
        headers["User-Agent"] = EAPI_UA;

        const payload = { ...data, header };
        encryptData = eapi(uri, payload);
        url = `${API_DOMAIN}/eapi/${uri.slice(5)}`;
    }

    const body = new URLSearchParams(encryptData as Record<string, string>).toString();

    const res = await CapacitorHttp.request({
        method: "POST",
        url,
        headers,
        data: body,
        responseType: "text",
    });

    const setCookieRaw = findHeader(res.headers, "set-cookie");
    if (setCookieRaw) mergeSetCookie(splitSetCookie(setCookieRaw));

    let responseBody: unknown = res.data;
    if (typeof responseBody === "string") {
        try { responseBody = JSON.parse(responseBody); } catch { /* leave as raw string */ }
    }

    let status = Number((responseBody as { code?: number })?.code) || res.status;
    if (!(status > 100 && status < 600)) status = res.status;

    return { status, body: responseBody as T };
}
