import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";

export type DownloadFileOptions = {
    disableNativeShare?: boolean;
    nativeShareOnly?: boolean;
};

export function isAndroidBrowser(): boolean {
    return typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
}

/**
 * 常规的 <a download> 在这两种环境里都不管用：iOS Safari 压根不理这个属性；
 * Capacitor 原生壳里 downloadFile() 会走 Filesystem 直接写文件，不弹下载框。
 * UI 用这个判断要不要展示"导出完成，请点击保存"这一步。
 */
export function usesNativeShareSheet(): boolean {
    return isIOSBrowser() || Capacitor.isNativePlatform();
}

export function isIOSBrowser(): boolean {
    if (typeof navigator === "undefined") return false;
    const ua = navigator.userAgent || "";
    const platform = navigator.platform || "";
    return /iPad|iPhone|iPod/i.test(ua) || (platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error);
        reader.onload = () => {
            const result = String(reader.result || "");
            // readAsDataURL 前缀是 "data:<mime>;base64,"，Filesystem.writeFile 只要纯 base64。
            const comma = result.indexOf(",");
            resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.readAsDataURL(blob);
    });
}

/**
 * 原生层直接把文件写进手机存储（公共 Documents 目录，文件管理器能看到），
 * 走 Capacitor 的原生桥接而不是浏览器 API，不受 isSecureContext 限制——
 * navigator.share 和 crypto.subtle 都要求安全上下文（https/localhost），
 * 这个 App 走局域网 http:// 开发模式时两个都用不了，Filesystem 插件不吃这一套。
 */
async function saveFileNative(blob: Blob, filename: string): Promise<string> {
    const base64 = await blobToBase64(blob);
    const result = await Filesystem.writeFile({
        path: filename,
        data: base64,
        directory: Directory.Documents,
        recursive: true,
    });
    return result.uri;
}

/** 返回值：Capacitor 原生壳直接写文件成功时给出保存路径（其余环境走下载/分享，没有路径可给）。 */
export async function downloadFile(blob: Blob, filename: string, options: DownloadFileOptions = {}): Promise<string | void> {
    if (Capacitor.isNativePlatform() && !options.disableNativeShare) {
        return await saveFileNative(blob, filename);
    }

    const url = URL.createObjectURL(blob);
    const anchorDownload = () => {
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
    };

    // iOS Safari 不能指望 <a download>（它本来就不理这个属性），改走系统分享面板。
    const shouldUseNativeShare = options.nativeShareOnly
        || (!options.disableNativeShare && isIOSBrowser());
    if (shouldUseNativeShare) {
        const file = new File([blob], filename, { type: blob.type || "application/octet-stream" });
        const canNativeShare = typeof navigator !== "undefined"
            && typeof navigator.share === "function"
            && typeof navigator.canShare === "function"
            && navigator.canShare({ files: [file] });
        if (canNativeShare) {
            try {
                await navigator.share({ files: [file] });
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                return;
            } catch (err) {
                // User explicitly dismissed the share sheet → respect it, don't force a download.
                if (err instanceof DOMException && err.name === "AbortError") {
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                    return;
                }
                // Any other failure (webview without real file-share support, lost user
                // activation, etc.) is surfaced to the caller instead of silently falling
                // back to the anchor trick, which does nothing in this environment anyway.
            }
        }
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        throw new Error("当前环境没有成功打开系统分享，请稍后重试，或导出轻量备份后再试。");
    }

    anchorDownload();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadUrl(url: string, filename: string): Promise<void> {
    let blob: Blob | null = null;

    try {
        const res = await fetch(url);
        if (res.ok) blob = await res.blob();
    } catch { /* CORS or network error — try proxy */ }

    if (!blob && /^https?:\/\//.test(url)) {
        try {
            const res = await fetch("/api/tool-proxy", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url, method: "GET" }),
            });
            if (res.ok) blob = await res.blob();
        } catch { /* proxy also failed */ }
    }

    if (blob) {
        await downloadFile(blob, filename);
    } else {
        const a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
    }
}
