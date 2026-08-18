/**
 * 独家特调专用 Supabase 连接。
 *
 * 特调的数据（mixology_items / mixology_recipes / mixology_likes / mixology_saves /
 * mixology_comments 五张表，外加 mixology_item_list / mixology_recipe_list 两个列表 RPC）
 * 已整体迁到独立的 Supabase 项目，只认这两个环境变量：
 *
 *   MIXOLOGY_SUPABASE_URL
 *   MIXOLOGY_SUPABASE_SERVICE_ROLE_KEY
 *
 * 这里刻意不做任何 fallback：没配这两个变量就当「特调库没接」处理（setupRequired / 503），
 * 绝不回退到主库的 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY。主库现在只剩账号与 session
 * 那条线（getCurrentAccount，走 lib/server/supabase-rest.ts）——一旦回退，特调的读写会
 * 落回旧库，和新库对不上账。
 */
import { encodeSupabaseFilter, formatSupabaseRestError } from "./supabase-rest";

type MixologySupabaseConfig = {
  url: string;
  key: string;
};

export type MixologyRestResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: string; status: number };

export function getMixologySupabaseConfig(): MixologySupabaseConfig | null {
  const url = (process.env.MIXOLOGY_SUPABASE_URL ?? "").trim();
  const key = (process.env.MIXOLOGY_SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ""), key };
}

export function mixologySupabaseHeaders(config: { key: string }): HeadersInit {
  return {
    apikey: config.key,
    Authorization: `Bearer ${config.key}`,
    "Content-Type": "application/json",
  };
}

export async function mixologyRestFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<MixologyRestResult<T>> {
  const config = getMixologySupabaseConfig();
  // 前缀带 mixology_，同时保留 missing_supabase_env 子串：
  // components/mixology/mixology-hall.tsx 用它判「本地部署没有云端后厨」
  if (!config) return { ok: false, error: "mixology_missing_supabase_env", status: 503 };

  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      ...mixologySupabaseHeaders(config),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const message = typeof data === "object" && data && "message" in data
      ? String((data as { message?: unknown }).message)
      : text || response.statusText;
    return { ok: false, error: message, status: response.status };
  }

  return { ok: true, data: data as T, status: response.status };
}

// 纯字符串处理，和连的是哪个库无关，直接复用主库那份实现，
// 顺带让 app/api/mixology/** 只 import 这一个模块（好 grep 出漏网的主库引用）
export { encodeSupabaseFilter as encodeMixologyFilter, formatSupabaseRestError as formatMixologyError };
