import CryptoJS from "crypto-js";

const BLOB_MARKER = "__aiPhoneBlob";          // legacy: media inlined as base64 dataUrl (read-only compat)
const MEDIA_REF_MARKER = "__aiPhoneMediaRef"; // new: media stored as a separate binary object, referenced by content hash

type SerializedBlob = {
  [BLOB_MARKER]: true;
  mimeType: string;
  dataUrl: string;
};

type SerializedMediaRef = {
  [MEDIA_REF_MARKER]: true;
  mimeType: string;
  ref: string;                  // sha256 of the binary
  encoding: "blob" | "dataurl"; // how to rebuild the original value on restore
};

/** Collects media out-of-band during serialization, returns a content-hash ref (dedupes). */
export type MediaCollector = { add(blob: Blob): Promise<string> };
/** Resolves a media ref back to its raw bytes during deserialization (null if missing). */
export type MediaResolver = (ref: string) => Promise<Uint8Array | null>;

// Only extract sizeable base64 data-URLs; tiny strings stay inline (not worth a separate object).
const MEDIA_DATAURL_RE = /^data:([^;,]*);base64,/i;
const MEDIA_MIN_LENGTH = 2048;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(blob);
  });
}

function bytesToBlob(bytes: Uint8Array, mimeType: string): Blob {
  // Cast: TS 5.7 types Uint8Array as <ArrayBufferLike>, BlobPart wants <ArrayBuffer>.
  return new Blob([bytes as unknown as BlobPart], { type: mimeType || "application/octet-stream" });
}

function dataUrlToBlob(dataUrl: string, mimeType: string): Blob {
  return bytesToBlob(base64ToBytes(extractBase64(dataUrl)), mimeType);
}

function extractBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

// Chunked to avoid blowing the call-stack / arg limit on large media.
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

async function sha256Hex(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  // crypto.subtle 只在"安全上下文"（https:// / localhost）里才有——手机 App 走的
  // http://局域网IP:端口 不算安全上下文，crypto.subtle 在那儿是 undefined，调
  // .digest 直接炸（"Cannot read properties of undefined (reading 'digest')"）。
  // 换成 crypto-js 的纯 JS 实现，不依赖安全上下文，网页版和手机 App 都能用。
  const wordArray = CryptoJS.lib.WordArray.create(new Uint8Array(buffer));
  return CryptoJS.SHA256(wordArray).toString(CryptoJS.enc.Hex);
}

/** Content-addressed media collector (sha256 → dedupes identical media across the backup). */
export function createMediaCollector(): MediaCollector & { media: Map<string, Blob> } {
  const media = new Map<string, Blob>();
  return {
    media,
    async add(blob: Blob): Promise<string> {
      const ref = await sha256Hex(blob);
      if (!media.has(ref)) media.set(ref, blob);
      return ref;
    },
  };
}

export async function serializeValue(value: unknown, collector?: MediaCollector): Promise<unknown> {
  if (value instanceof Blob) {
    if (collector) {
      const ref = await collector.add(value);
      return { [MEDIA_REF_MARKER]: true, mimeType: value.type, ref, encoding: "blob" } satisfies SerializedMediaRef;
    }
    // No collector → legacy inline base64 (kept for callers that don't extract media).
    return { [BLOB_MARKER]: true, mimeType: value.type, dataUrl: await blobToDataUrl(value) } satisfies SerializedBlob;
  }

  if (typeof value === "string") {
    // Big base64 data-URLs (images/audio stored as strings, e.g. theme assets) → extract to binary.
    if (collector && value.length >= MEDIA_MIN_LENGTH) {
      const match = MEDIA_DATAURL_RE.exec(value);
      if (match) {
        // Preserve the exact mime (even empty) so the restored data-URL is byte-identical.
        const mimeType = match[1] ?? "";
        const blob = bytesToBlob(base64ToBytes(extractBase64(value)), mimeType || "application/octet-stream");
        const ref = await collector.add(blob);
        return { [MEDIA_REF_MARKER]: true, mimeType, ref, encoding: "dataurl" } satisfies SerializedMediaRef;
      }
    }
    return value;
  }

  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => serializeValue(item, collector)));
  }

  if (isPlainObject(value)) {
    const entries = await Promise.all(
      Object.entries(value).map(async ([key, child]) => [key, await serializeValue(child, collector)] as const)
    );
    return Object.fromEntries(entries);
  }

  return value;
}

export async function deserializeValue(value: unknown, resolver?: MediaResolver): Promise<unknown> {
  // New media-ref marker → fetch the binary and rebuild original (Blob or dataUrl string).
  if (isPlainObject(value) && value[MEDIA_REF_MARKER] === true) {
    const ref = typeof value.ref === "string" ? value.ref : "";
    const mimeType = typeof value.mimeType === "string" ? value.mimeType : "application/octet-stream";
    const encoding = value.encoding === "dataurl" ? "dataurl" : "blob";
    const bytes = resolver ? await resolver(ref) : null;
    if (!bytes) {
      // Media object missing → return an empty placeholder so the rest of the record still restores.
      return encoding === "dataurl" ? "" : new Blob([], { type: mimeType });
    }
    return encoding === "dataurl"
      ? `data:${mimeType};base64,${bytesToBase64(bytes)}`
      : bytesToBlob(bytes, mimeType);
  }

  // Legacy inline-base64 marker (old backups) → rebuild Blob directly.
  if (isPlainObject(value) && value[BLOB_MARKER] === true) {
    const dataUrl = typeof value.dataUrl === "string" ? value.dataUrl : "";
    const mimeType = typeof value.mimeType === "string" ? value.mimeType : "application/octet-stream";
    return dataUrlToBlob(dataUrl, mimeType);
  }

  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => deserializeValue(item, resolver)));
  }

  if (isPlainObject(value)) {
    const entries = await Promise.all(
      Object.entries(value).map(async ([key, child]) => [key, await deserializeValue(child, resolver)] as const)
    );
    return Object.fromEntries(entries);
  }

  return value;
}

export function estimateValueBytes(value: unknown): number {
  if (typeof Blob !== "undefined" && value instanceof Blob) return value.size;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (value === undefined) return 0;
  if (value === null) return 4;

  const textBytes = (text: string) => {
    try {
      return new Blob([text]).size;
    } catch {
      return text.length;
    }
  };

  if (typeof value === "string") return textBytes(JSON.stringify(value));
  if (typeof value === "number" || typeof value === "boolean") return textBytes(JSON.stringify(value));

  if (Array.isArray(value)) {
    if (value.length === 0) return 2;
    return 2 + Math.max(0, value.length - 1) + value.reduce((sum, item) => sum + estimateValueBytes(item), 0);
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return 2;
    return 2 + Math.max(0, entries.length - 1) + entries.reduce((sum, [key, child]) => {
      return sum + textBytes(JSON.stringify(key)) + 1 + estimateValueBytes(child);
    }, 0);
  }

  try {
    return textBytes(JSON.stringify(value));
  } catch {
    return 0;
  }
}
