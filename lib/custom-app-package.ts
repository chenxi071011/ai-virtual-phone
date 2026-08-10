import type { CustomAppManifest, InstalledCustomApp } from "./custom-app-types";
import { normalizeCustomAppManifestId } from "./custom-app-storage";

// ── 自定义 APP 打包导出 ──────────────────────────────
// 把本机安装的 APP 反向打成市场同款 zip 包（manifest + 入口 + 资源），
// 供「编辑器导出」与工坊「导出文件」工具复用；产物可直接走市场上传/换包导入。

function normalizePackagePath(value: string, fallback: string): string {
    const text = (value || fallback).replace(/\\/g, "/").replace(/^\.?\//, "").replace(/^\/+/, "").trim();
    return text || fallback;
}

function bytesFromDataUrl(dataUrl: string): Uint8Array {
    const comma = dataUrl.indexOf(",");
    if (comma < 0) return new Uint8Array();
    const meta = dataUrl.slice(0, comma).toLowerCase();
    const payload = dataUrl.slice(comma + 1);
    if (meta.includes(";base64")) {
        const binary = atob(payload);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        return bytes;
    }
    return new TextEncoder().encode(decodeURIComponent(payload));
}

/** 把本机安装的 APP 打成 zip 包文件（与市场发布包同构，可直接导入）。 */
export async function createCustomAppPackageFile(app: InstalledCustomApp): Promise<File> {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    const manifest: CustomAppManifest = {
        ...app.manifest,
        name: app.name,
        version: app.version,
        author: app.author,
        description: app.description,
        permissions: app.permissions,
    };
    const entryPath = normalizePackagePath(manifest.entry || "index.html", "index.html");
    zip.file(entryPath, app.entryHtml);
    for (const asset of Object.values(app.assets)) {
        const path = normalizePackagePath(asset.path, asset.path);
        if (!path || path === "manifest.json" || path === entryPath) continue;
        zip.file(path, bytesFromDataUrl(asset.dataUrl));
    }
    zip.file("manifest.json", JSON.stringify({ ...manifest, entry: entryPath }, null, 2));
    const blob = await zip.generateAsync({ type: "blob", mimeType: "application/zip" });
    const manifestId = normalizeCustomAppManifestId(manifest.id, app.name);
    return new File([blob], `${manifestId}-${app.version}.zip`, { type: "application/zip" });
}
