// lib/resource-hub-profile.ts
// 资源集市的"摊主资料"：昵称 + 头像，只存在本机。
// 昵称会作为投稿人默认值；头像在上传/编辑时压成 64×64 PNG 一并发布，
// 这样别人在详情页也能看到作者头像。

import { kvGet, kvSet, registerKvMigration } from "./kv-db";

const PROFILE_KEY = "ai_phone_resource_hub_profile_v1";
registerKvMigration(PROFILE_KEY);

/** 发布用头像边长：够清晰又不至于把资源仓库撑大 */
const AVATAR_SIZE = 64;

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

/** 把用户选的图片裁成正方形并压到 64×64 PNG（data URL） */
export async function fileToAvatarDataUrl(file: File): Promise<string> {
    const bitmap = await createImageBitmap(file);
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_SIZE;
    canvas.height = AVATAR_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法处理图片");
    // 居中裁剪，避免非正方形头像被拉变形
    ctx.drawImage(
        bitmap,
        (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side,
        0, 0, AVATAR_SIZE, AVATAR_SIZE,
    );
    bitmap.close?.();
    return canvas.toDataURL("image/png");
}

/** data URL → 纯 base64（上传接口要的格式）；没头像返回空串 */
export function avatarBase64(dataUrl: string): string {
    const comma = dataUrl.indexOf(",");
    return dataUrl.startsWith("data:image/") && comma > 0 ? dataUrl.slice(comma + 1) : "";
}
