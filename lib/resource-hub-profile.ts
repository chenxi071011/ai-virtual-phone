// lib/resource-hub-profile.ts
// 资源集市的"摊主资料"：昵称 + 头像，只存在本机。
// 昵称会作为投稿人默认值；头像在上传/编辑时压成 64×64 PNG 一并发布，
// 这样别人在详情页也能看到作者头像。

import { kvGet, kvSet, registerKvMigration } from "./kv-db";

const PROFILE_KEY = "ai_phone_resource_hub_profile_v1";
registerKvMigration(PROFILE_KEY);

/** 发布用头像边长：够清晰又不至于把资源仓库撑大 */
const AVATAR_SIZE = 64;
/** 中间处理画布的最大边长，避免超大照片撑爆手机的画布上限 */
const WORK_MAX = 512;

export type HubProfile = {
    nickname: string;
    /** data URL（image/png），空表示用默认像素头像 */
    avatarDataUrl: string;
};

export function loadHubProfile(): HubProfile {
    try {
        const raw = kvGet(PROFILE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as Partial<HubProfile>;
            return {
                nickname: typeof parsed.nickname === "string" ? parsed.nickname : "",
                avatarDataUrl: typeof parsed.avatarDataUrl === "string" ? parsed.avatarDataUrl : "",
            };
        }
    } catch { /* 坏数据当没设过 */ }
    return { nickname: "", avatarDataUrl: "" };
}

export function saveHubProfile(profile: HubProfile): void {
    kvSet(PROFILE_KEY, JSON.stringify({
        nickname: profile.nickname.trim().slice(0, 24),
        avatarDataUrl: profile.avatarDataUrl,
    }));
}

/** 扫描 alpha 通道，找出真正有内容的范围（全透明的图返回整张） */
function contentBounds(ctx: CanvasRenderingContext2D, width: number, height: number) {
    let left = width, right = -1, top = height, bottom = -1;
    try {
        const { data } = ctx.getImageData(0, 0, width, height);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (data[(y * width + x) * 4 + 3] > 8) {
                    if (x < left) left = x;
                    if (x > right) right = x;
                    if (y < top) top = y;
                    if (y > bottom) bottom = y;
                }
            }
        }
    } catch {
        // 跨源图片会污染画布导致读取失败，那就按整张算
    }
    if (right < left || bottom < top) return { x: 0, y: 0, width, height };
    return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

/**
 * 把用户选的图片处理成 64×64 PNG（data URL）：
 * 先裁掉四周全透明的留白（很多头像 PNG 都带一圈透明边，不裁的话在方框里
 * 看起来就是"没铺满"），再居中裁成正方形，最后铺白底压到目标尺寸。
 */
export async function fileToAvatarDataUrl(file: File): Promise<string> {
    const bitmap = await createImageBitmap(file);
    try {
        // 先缩到安全尺寸再处理：手机拍的照片动辄四五千像素，
        // 按原尺寸开画布会超过 iOS 的画布上限，画出来是空白或只有一角。
        const scale = Math.min(1, WORK_MAX / Math.max(bitmap.width, bitmap.height));
        const workW = Math.max(1, Math.round(bitmap.width * scale));
        const workH = Math.max(1, Math.round(bitmap.height * scale));
        const work = document.createElement("canvas");
        work.width = workW;
        work.height = workH;
        const workCtx = work.getContext("2d", { willReadFrequently: true });
        if (!workCtx) throw new Error("无法处理图片");
        workCtx.drawImage(bitmap, 0, 0, workW, workH);

        const bounds = contentBounds(workCtx, workW, workH);
        // 在有内容的范围里居中取正方形，避免非正方形头像被拉变形
        const side = Math.min(bounds.width, bounds.height);
        const sx = bounds.x + (bounds.width - side) / 2;
        const sy = bounds.y + (bounds.height - side) / 2;

        const canvas = document.createElement("canvas");
        canvas.width = AVATAR_SIZE;
        canvas.height = AVATAR_SIZE;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("无法处理图片");
        // 半透明像素落到白底上，而不是透出方框的灰色
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
        // 从缩好的中间画布再取一次，全程不碰原始大图
        ctx.drawImage(work, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
        return canvas.toDataURL("image/png");
    } finally {
        bitmap.close?.();
    }
}

/** data URL → 纯 base64（上传接口要的格式）；没头像返回空串 */
export function avatarBase64(dataUrl: string): string {
    const comma = dataUrl.indexOf(",");
    return dataUrl.startsWith("data:image/") && comma > 0 ? dataUrl.slice(comma + 1) : "";
}
