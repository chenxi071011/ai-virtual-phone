import { CLOUD_BACKUP_BUCKET, normalizeBackupUrl, type CloudBackupConfig } from "./config";

/**
 * Thin client for the user's OWN Supabase Storage (REST), using their anon key
 * directly from the browser. Scoped entirely to the ai-phone-backup bucket.
 * No @supabase/supabase-js dependency — plain fetch against /storage/v1.
 */

type Creds = { url: string; key: string };

function resolveCreds(config: CloudBackupConfig): Creds | null {
  const url = normalizeBackupUrl(config.url);
  const key = (config.key || "").trim();
  if (!url || !key) return null;
  return { url, key };
}

function authHeaders(key: string): Record<string, string> {
  return { apikey: key, Authorization: `Bearer ${key}` };
}

function objectUrl(creds: Creds, path: string): string {
  return `${creds.url}/storage/v1/object/${CLOUD_BACKUP_BUCKET}/${path.replace(/^\/+/, "")}`;
}

/** Upload (overwrites if present). Body can be a Blob/ArrayBuffer/string. */
export async function putObject(config: CloudBackupConfig, path: string, body: BlobPart, contentType = "application/octet-stream"): Promise<void> {
  const creds = resolveCreds(config);
  if (!creds) throw new Error("未配置 Supabase 地址或 key。");
  const res = await fetch(objectUrl(creds, path), {
    method: "POST",
    headers: { ...authHeaders(creds.key), "Content-Type": contentType, "x-upsert": "true" },
    body: body instanceof Blob ? body : new Blob([body], { type: contentType }),
  });
  if (!res.ok) throw new Error(await describeError(res));
}

/** Download an object's bytes. Returns null if the object doesn't exist.
 *  Supabase Storage 对不存在的对象返回 400 "Object not found" 而不是 404，
 *  与 removeObject 相同，两种都视为不存在。 */
export async function getObject(config: CloudBackupConfig, path: string): Promise<Blob | null> {
  const creds = resolveCreds(config);
  if (!creds) throw new Error("未配置 Supabase 地址或 key。");
  const res = await fetch(objectUrl(creds, path), { headers: authHeaders(creds.key), cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) {
    const error = await describeError(res);
    if (res.status === 400 && /object not found|not found/i.test(error)) return null;
    throw new Error(error);
  }
  return await res.blob();
}

export async function removeObject(config: CloudBackupConfig, path: string): Promise<void> {
  const creds = resolveCreds(config);
  if (!creds) throw new Error("未配置 Supabase 地址或 key。");
  const res = await fetch(objectUrl(creds, path), { method: "DELETE", headers: authHeaders(creds.key) });
  if (res.ok || res.status === 404) return;
  const error = await describeError(res);
  if (res.status === 400 && /object not found|not found/i.test(error)) return;
  throw new Error(error);
}

export type StorageObject = { name: string; size: number; updatedAt?: string };

/** List objects under a prefix (e.g. "manifests/"). */
export async function listObjects(config: CloudBackupConfig, prefix = "", limit = 100): Promise<StorageObject[]> {
  const creds = resolveCreds(config);
  if (!creds) throw new Error("未配置 Supabase 地址或 key。");
  const res = await fetch(`${creds.url}/storage/v1/object/list/${CLOUD_BACKUP_BUCKET}`, {
    method: "POST",
    headers: { ...authHeaders(creds.key), "Content-Type": "application/json" },
    body: JSON.stringify({ prefix, limit, offset: 0, sortBy: { column: "name", order: "asc" } }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(await describeError(res));
  const rows = (await res.json().catch(() => [])) as Array<Record<string, unknown>>;
  return (Array.isArray(rows) ? rows : []).map(row => ({
    name: String(row.name ?? ""),
    size: Number((row.metadata as Record<string, unknown> | undefined)?.size ?? 0),
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : undefined,
  })).filter(item => item.name);
}

/**
 * Create the backup bucket if it doesn't exist. Requires a service_role key
 * (bucket creation is an admin operation); succeeds idempotently if present.
 */
export async function ensureBucket(config: CloudBackupConfig): Promise<void> {
  const creds = resolveCreds(config);
  if (!creds) throw new Error("未配置 Supabase 地址或 key。");
  const res = await fetch(`${creds.url}/storage/v1/bucket`, {
    method: "POST",
    headers: { ...authHeaders(creds.key), "Content-Type": "application/json" },
    body: JSON.stringify({ id: CLOUD_BACKUP_BUCKET, name: CLOUD_BACKUP_BUCKET, public: false }),
  });
  if (res.ok) return;
  const text = await res.text().catch(() => "");
  // Bucket already there → that's fine, treat as success.
  if (res.status === 409 || /already exists|Duplicate|resource already exists/i.test(text)) return;
  throw new Error(`${res.status} ${text || res.statusText}`.trim());
}

/**
 * Validate the full path the backup engine needs: auto-create the bucket (with
 * the service_role key), then write a tiny probe object and delete it. Proves
 * the project + key work and the bucket is ready — no manual SQL/dashboard setup.
 */
export async function testCloudBackupConnection(config: CloudBackupConfig): Promise<{ ok: true } | { ok: false; error: string }> {
  const creds = resolveCreds(config);
  if (!creds) return { ok: false, error: "请先填写 Supabase 地址和 key。" };
  try {
    await ensureBucket(config);
  } catch (err) {
    return { ok: false, error: mapStorageError(err instanceof Error ? err.message : String(err)) };
  }
  const probePath = `.healthcheck/${Date.now()}.txt`;
  try {
    await putObject(config, probePath, "ok", "text/plain");
  } catch (err) {
    return { ok: false, error: mapStorageError(err instanceof Error ? err.message : String(err)) };
  }
  // Best-effort cleanup; failure here doesn't fail the test.
  try { await removeObject(config, probePath); } catch { /* ignore */ }
  return { ok: true };
}

async function describeError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  let message = text;
  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    message = String(data.message ?? data.error ?? text);
  } catch { /* keep raw text */ }
  return `${res.status} ${message || res.statusText}`.trim();
}

function mapStorageError(error: string): string {
  if (/403|not authorized|permission|new row violates row-level security/i.test(error)) {
    return "权限不足：请填 service_role key（Supabase → Project Settings → API → service_role），不是 anon key。";
  }
  if (/401|invalid.*(jwt|key|token)|JWSError|signature/i.test(error)) {
    return "key 无效或不匹配该项目：请检查 Supabase 地址和 service_role key 是否对应同一个项目。";
  }
  if (/getaddrinfo|ENOTFOUND|fetch failed|Failed to fetch|networkerror/i.test(error)) {
    return "连不上该 Supabase 地址：请检查 URL 是否正确、网络是否可达。";
  }
  return error;
}
