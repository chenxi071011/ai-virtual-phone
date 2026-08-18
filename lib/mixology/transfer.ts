// lib/mixology/transfer.ts
// 独家特调 · 材料的离线搬运：导出成 JSON 文件、从 JSON 文件导入。
// 官网大厅之外的第二条路——备份、私下发给朋友、跨设备迁移都不用联网。

import { downloadFile } from "@/lib/download-utils";
import {
    MIX_SLOT_ORDER,
    createMixId,
    type MixMaterial,
    type MixMaterialKind,
} from "./types";

const FILE_MARK = "float-mixology-material";
const FILE_VERSION = 1;

/** PNG 卡的文本块关键字——自有格式，故意与酒馆卡（chara/ccv3）不同 */
const PNG_KEYWORD = "float-mixology-card";
/** 第三方角色卡格式的关键字（SillyTavern V2/V3 等），一律拒收 */
const THIRD_PARTY_PNG_KEYWORDS = ["chara", "ccv3"];

type MixTransferFile = {
    mark: typeof FILE_MARK;
    version: number;
    material: MixMaterial;
};

function safeFileName(name: string): string {
    // 文件名里不能出现的字符统一换成下划线；中文保留
    const cleaned = name.replace(/[\\/:*?"<>|]/g, "_").trim();
    return cleaned || "material";
}


// ── PNG 卡：自有格式的图内嵌数据 ──────────────────────
// 数据以 base64 JSON 写进 PNG 的 tEXt 块（关键字 float-mixology-card），
// 图即是卡。解析时若发现酒馆系关键字（chara/ccv3）直接报错拒收。

const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];

function isPng(u8: Uint8Array): boolean {
    return PNG_SIG.every((b, i) => u8[i] === b);
}

/** 遍历 PNG 文本块，返回 keyword → 文本 的映射（tEXt 为 latin1，iTXt 未压缩段为 utf8） */
function readPngTextChunks(u8: Uint8Array): Map<string, string> {
    const out = new Map<string, string>();
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let offset = 8;
    while (offset + 12 <= u8.length) {
        const length = dv.getUint32(offset);
        const type = String.fromCharCode(u8[offset + 4], u8[offset + 5], u8[offset + 6], u8[offset + 7]);
        const data = u8.subarray(offset + 8, offset + 8 + length);
        if (type === "tEXt") {
            const sep = data.indexOf(0);
            if (sep > 0) {
                out.set(new TextDecoder().decode(data.subarray(0, sep)).toLowerCase(), new TextDecoder("latin1").decode(data.subarray(sep + 1)));
            }
        } else if (type === "iTXt") {
            const pos = data.indexOf(0);
            if (pos > 0) {
                const kw = new TextDecoder().decode(data.subarray(0, pos)).toLowerCase();
                const compressed = data[pos + 1];
                let cursor = pos + 3;
                cursor = data.indexOf(0, cursor) + 1; // 语言标签
                cursor = data.indexOf(0, cursor) + 1; // 翻译关键字
                if (compressed === 0 && cursor > 0) out.set(kw, new TextDecoder().decode(data.subarray(cursor)));
            }
        }
        if (type === "IEND") break;
        offset += 12 + length;
    }
    return out;
}

let _crcTable: Uint32Array | null = null;
function crc32(buf: Uint8Array): number {
    if (!_crcTable) {
        _crcTable = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            _crcTable[n] = c;
        }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ _crcTable[(crc ^ buf[i]) & 0xff];
    return (crc ^ 0xffffffff) >>> 0;
}

/** 在 IEND 前插入一个 tEXt 块 */
function insertPngTextChunk(u8: Uint8Array, keyword: string, text: string): Uint8Array {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let offset = 8;
    let iendOffset = -1;
    while (offset + 12 <= u8.length) {
        const length = dv.getUint32(offset);
        const type = String.fromCharCode(u8[offset + 4], u8[offset + 5], u8[offset + 6], u8[offset + 7]);
        if (type === "IEND") { iendOffset = offset; break; }
        offset += 12 + length;
    }
    if (iendOffset < 0) throw new Error("PNG 结构异常。");
    const kwBytes = new TextEncoder().encode(keyword);
    const textBytes = Uint8Array.from(text, (ch) => ch.charCodeAt(0) & 0xff); // base64 是纯 ASCII
    const payload = new Uint8Array(kwBytes.length + 1 + textBytes.length);
    payload.set(kwBytes, 0);
    payload[kwBytes.length] = 0;
    payload.set(textBytes, kwBytes.length + 1);
    const chunk = new Uint8Array(12 + payload.length);
    const cdv = new DataView(chunk.buffer);
    cdv.setUint32(0, payload.length);
    chunk.set(new TextEncoder().encode("tEXt"), 4);
    chunk.set(payload, 8);
    const crcBody = chunk.subarray(4, 8 + payload.length);
    cdv.setUint32(8 + payload.length, crc32(crcBody));
    const out = new Uint8Array(u8.length + chunk.length);
    out.set(u8.subarray(0, iendOffset), 0);
    out.set(chunk, iendOffset);
    out.set(u8.subarray(iendOffset), iendOffset + chunk.length);
    return out;
}

/** 从 PNG 卡解析材料；酒馆卡等第三方格式一律报错 */
export function parseMixMaterialsFromPng(buffer: ArrayBuffer): MixMaterial[] {
    const u8 = new Uint8Array(buffer);
    if (!isPng(u8)) throw new Error("这不是一个有效的 PNG 文件。");
    const chunks = readPngTextChunks(u8);
    const ours = chunks.get(PNG_KEYWORD);
    if (ours) {
        let json: string;
        try {
            json = decodeURIComponent(escape(atob(ours.trim())));
        } catch {
            throw new Error("这张卡的数据已损坏，请重新导出一张。");
        }
        return parseMixMaterialsFromJson(json);
    }
    if (THIRD_PARTY_PNG_KEYWORDS.some((kw) => chunks.has(kw))) {
        throw new Error("不支持第三方角色卡格式。");
    }
    throw new Error("这张 PNG 里没有特调卡数据。");
}

/** 把封面 dataURL 画成 PNG 底图；无封面时画一张纯色占位卡 */
async function buildCardImage(card: MixMaterial): Promise<Uint8Array> {
    const W = 600;
    const H = 880;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("当前环境不支持画布。");
    if (card.cover) {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const el = new Image();
            el.onload = () => resolve(el);
            el.onerror = () => reject(new Error("封面解码失败"));
            el.src = card.cover as string;
        });
        // cover 填满裁切
        const scale = Math.max(W / img.width, H / img.height);
        const dw = img.width * scale;
        const dh = img.height * scale;
        ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    } else {
        const grad = ctx.createLinearGradient(0, 0, W * 0.7, H);
        grad.addColorStop(0, "#2a2438");
        grad.addColorStop(0.55, "#161320");
        grad.addColorStop(1, "#0c0a12");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = "rgba(242, 240, 247, 0.9)";
        ctx.font = "600 44px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(card.name.slice(0, 12), W / 2, H / 2);
    }
    const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG 编码失败"))), "image/png");
    });
    return new Uint8Array(await blob.arrayBuffer());
}

/**
 * 导出一件材料为自有格式的 PNG 卡（图即是卡）。
 * 落盘统一走 downloadFile：iOS 上是系统分享面板，其余平台是普通下载——
 * 与应用市场、主题包、正则组这些导出保持同一种行为。
 */
export async function exportMixMaterialPng(material: MixMaterial): Promise<void> {
    const payload: MixTransferFile = { mark: FILE_MARK, version: FILE_VERSION, material };
    const base64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    const png = insertPngTextChunk(await buildCardImage(material), PNG_KEYWORD, base64);
    const blob = new Blob([png.buffer as ArrayBuffer], { type: "image/png" });
    await downloadFile(blob, `${safeFileName(material.name)}.png`);
}

/** 导出一件材料为 .json 文件（同上：iOS 走系统分享） */
export async function exportMixMaterial(material: MixMaterial): Promise<void> {
    const payload: MixTransferFile = { mark: FILE_MARK, version: FILE_VERSION, material };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    await downloadFile(blob, `${safeFileName(material.name)}.json`);
}

function isMixKind(value: unknown): value is MixMaterialKind {
    return typeof value === "string" && (MIX_SLOT_ORDER as string[]).includes(value);
}

/**
 * 解析导入的 JSON 文本。
 * 兼容三种写法：本工具导出的带壳文件、裸材料对象、以及一次多件的数组。
 * 导入一律换新 id，避免覆盖酒柜里的同名旧件。
 */
export function parseMixMaterialsFromJson(text: string): MixMaterial[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new Error("这不是一个有效的 JSON 文件。");
    }

    const candidates: unknown[] = [];
    const collect = (value: unknown) => {
        if (Array.isArray(value)) {
            value.forEach(collect);
            return;
        }
        if (!value || typeof value !== "object") return;
        const record = value as Record<string, unknown>;
        if (record.mark === FILE_MARK && record.material) {
            collect(record.material);
            return;
        }
        candidates.push(record);
    };
    collect(parsed);

    const now = Date.now();
    const materials: MixMaterial[] = [];
    for (const candidate of candidates) {
        const record = candidate as Record<string, unknown>;
        if (!isMixKind(record.kind)) continue;
        const name = typeof record.name === "string" ? record.name.trim() : "";
        if (!name) continue;
        // 角色卡至少要有一句开场白，否则开不了局
        if (record.kind === "character") {
            const openings = Array.isArray(record.openings)
                ? record.openings.filter((o): o is string => typeof o === "string" && Boolean(o.trim()))
                : [];
            if (openings.length === 0) continue;
            // 文件导入一律视为自己的本地作品：换新 id、剥掉发布关联与导入标记，
            // 修改/导出/发布全部照常（酒材页入柜的"别人的作品"限制与此无关）
            materials.push({
                ...(record as unknown as MixMaterial),
                id: createMixId("mixmat"),
                publishedId: undefined,
                publishedAt: undefined,
                imported: undefined,
                name,
                openings,
                createdAt: now,
                updatedAt: now,
            } as MixMaterial);
            continue;
        }
        materials.push({
            ...(record as unknown as MixMaterial),
            id: createMixId("mixmat"),
            publishedId: undefined,
            publishedAt: undefined,
            imported: undefined,
            name,
            createdAt: now,
            updatedAt: now,
        } as MixMaterial);
    }

    if (materials.length === 0) {
        // 酒馆卡（SillyTavern V2/V3）等第三方 JSON：给出明确拒收提示而不是"认不出来"
        const isThirdPartyCard = (value: unknown): boolean => {
            if (!value || typeof value !== "object") return false;
            const record = value as Record<string, unknown>;
            const spec = typeof record.spec === "string" ? record.spec : "";
            if (/^chara_card/i.test(spec)) return true;
            if ("first_mes" in record || "mes_example" in record) return true;
            const data = record.data;
            return Boolean(data && typeof data === "object" && "first_mes" in (data as Record<string, unknown>));
        };
        if (candidates.some(isThirdPartyCard)) {
            throw new Error("不支持第三方角色卡格式。");
        }
        throw new Error("文件里没有能认出来的材料。");
    }
    return materials;
}
