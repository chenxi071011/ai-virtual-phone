// lib/netease/endpoints.ts — 移植自 NeteaseCloudMusicApi/module/*.js 里各个接口的参数拼装。
// 每个函数对应原版一个 module 文件；uri、crypto 模式、请求参数都是照抄，唯一区别是
// 通过 ./request.ts 的 neteaseRequest() 直接发给网易云真实服务器，不经过中间的 Node 代理。
import QRCode from "qrcode";
import { neteaseRequest } from "./request";

// ── 搜索 ── cloudsearch.js（crypto 默认 eapi）
export async function cloudSearch(keywords: string, limit = 20, offset = 0): Promise<any> {
    const res = await neteaseRequest("/api/cloudsearch/pc", {
        s: keywords, type: 1, limit, offset, total: true,
    }, "eapi");
    return res.body;
}

// ── 播放地址 ── song_url.js（eapi）
export async function songUrl(id: number): Promise<any> {
    const res = await neteaseRequest("/api/song/enhance/player/url", {
        ids: JSON.stringify([String(id)]), br: 999000,
    }, "eapi");
    return res.body;
}

// ── 歌词 ── lyric.js（eapi）
export async function lyric(id: number): Promise<any> {
    const res = await neteaseRequest("/api/song/lyric", {
        id, tv: -1, lv: -1, rv: -1, kv: -1, _nmclfl: 1,
    }, "eapi");
    return res.body;
}

// ── 歌曲详情 ── song_detail.js（weapi）
export async function songDetail(ids: number[]): Promise<any> {
    const c = `[${ids.map((id) => `{"id":${id}}`).join(",")}]`;
    const res = await neteaseRequest("/api/v3/song/detail", { c }, "weapi");
    return res.body;
}

// ── 扫码登录 ── login_qr_key.js（eapi）
export async function qrKey(): Promise<string | null> {
    const res = await neteaseRequest<{ data?: { unikey?: string } }>("/api/login/qrcode/unikey", { type: 3 }, "eapi");
    return res.body?.data?.unikey || null;
}

// ── 二维码图片 ── login_qr_create.js：原版就是纯本地拼 URL + 生成二维码图片，不发请求。
export async function qrImage(key: string): Promise<string> {
    const url = `https://music.163.com/login?codekey=${key}`;
    return QRCode.toDataURL(url);
}

// ── 扫码状态 ── login_qr_check.js（eapi）。成功后 cookie 已经在 neteaseRequest 内部
// 自动合并进本地存储了，这里额外把当前持久化的 cookie 字符串带出去，方便调用方按老接口
// 形状继续 `if (res.cookie) saveNeteaseCookie(res.cookie)`（重复存一次没有副作用）。
export async function qrCheck(key: string): Promise<{ code: number; message?: string; nickname?: string; cookie?: string }> {
    const res = await neteaseRequest<{ code?: number; message?: string; profile?: { nickname?: string } }>(
        "/api/login/qrcode/client/login",
        { key, type: 3 },
        "eapi",
    );
    const { loadNeteaseCookie } = await import("./cookie-store");
    return {
        code: res.body?.code || 0,
        message: res.body?.message,
        nickname: res.body?.profile?.nickname,
        cookie: loadNeteaseCookie(),
    };
}

// ── 登录状态 ── login_status.js（weapi），响应形状包一层 { data: {...} }
export async function loginStatus(): Promise<any> {
    const res = await neteaseRequest("/api/w/nuser/account/get", {}, "weapi");
    return { data: res.body };
}

// ── 用户歌单 ── user_playlist.js（weapi）
export async function userPlaylist(uid: number, limit = 30, offset = 0): Promise<any> {
    const res = await neteaseRequest("/api/user/playlist", {
        uid, limit, offset, includeVideo: true,
    }, "weapi");
    return res.body;
}

// ── 歌单详情 ── playlist_detail.js（eapi）
export async function playlistDetail(id: number, s = 8): Promise<any> {
    const res = await neteaseRequest("/api/v6/playlist/detail", { id, n: 100000, s }, "eapi");
    return res.body;
}

// ── 歌单全部歌曲 ── playlist_track_all.js：先拿歌单详情要 trackIds，再按 id 批量查详情（eapi）
export async function playlistTrackAll(id: number, limit = 1000, offset = 0): Promise<any> {
    const detail = await neteaseRequest<{ playlist?: { trackIds?: Array<{ id: number }> } }>(
        "/api/v6/playlist/detail",
        { id, n: 100000, s: 8 },
        "eapi",
    );
    const trackIds = detail.body?.playlist?.trackIds || [];
    const c = `[${trackIds.slice(offset, offset + limit).map((t) => `{"id":${t.id}}`).join(",")}]`;
    const res = await neteaseRequest("/api/v3/song/detail", { c }, "eapi");
    return res.body;
}

// ── 每日推荐歌曲 ── recommend_songs.js（weapi）
export async function recommendSongs(): Promise<any> {
    const res = await neteaseRequest("/api/v3/discovery/recommend/songs", {}, "weapi");
    return res.body;
}

// ── 私人 FM ── personal_fm.js（weapi）
export async function personalFm(): Promise<any> {
    const res = await neteaseRequest("/api/v1/radio/get", {}, "weapi");
    return res.body;
}

// ── 推荐歌单 ── personalized.js（weapi）
export async function personalized(limit = 12): Promise<any> {
    const res = await neteaseRequest("/api/personalized/playlist", { limit, total: true, n: 1000 }, "weapi");
    return res.body;
}

// ── 每日推荐歌单 ── recommend_resource.js（weapi）
export async function recommendResource(): Promise<any> {
    const res = await neteaseRequest("/api/v1/discovery/recommend/resource", {}, "weapi");
    return res.body;
}

// ── 热搜列表 ── search_hot_detail.js（weapi）
export async function hotSearchDetail(): Promise<any> {
    const res = await neteaseRequest("/api/hotsearchlist/get", {}, "weapi");
    return res.body;
}

// ── 榜单摘要 ── toplist_detail.js（weapi）
export async function toplistDetail(): Promise<any> {
    const res = await neteaseRequest("/api/toplist/detail", {}, "weapi");
    return res.body;
}

// ── 歌曲评论 ── comment_music.js（weapi）
export async function commentMusic(id: number, limit = 20, offset = 0, before = 0): Promise<any> {
    const res = await neteaseRequest(`/api/v1/resource/comments/R_SO_4_${id}`, {
        rid: id, limit, offset, beforeTime: before,
    }, "weapi");
    return res.body;
}

// ── 听歌排行 ── user_record.js（weapi）
export async function userRecord(uid: number, type: 0 | 1 = 0): Promise<any> {
    const res = await neteaseRequest("/api/v1/play/record", { uid, type }, "weapi");
    return res.body;
}
