// 微信云端助手 HTTP 入口。本文件不能单独运行：构建脚本
// （scripts/build-weixin-assistant-dist.mjs）会把它拼接到 assistant-core.mjs 之后，
// 生成可直接粘贴到 Supabase Edge Functions 的单文件云函数。
// 这里可以直接使用 core 里的 pollOnce、getObjectJson、putObject 等函数（同一模块作用域）。

const CLOUD_CRON_SECRET_PATH = "weixin-cloud/cron-secret.json";
const CLOUD_ASSISTANT_STATE_PATH = "weixin-cloud/state/cloud-assistant.json";
const CLOUD_CRON_JOB_NAME = "ai-phone-weixin-assistant";
const CLOUD_CORE_CODE_PATH = "weixin-cloud/function-core.mjs";

// ── 自更新加载器 ──
// 小手机同步运行包时会把最新的 assistant-core.mjs 上传到桶里；这里每次运行
// 优先动态加载桶里的核心逻辑（60 秒内存缓存），失败则回退到本文件内置的
// 拼接版本。这样部署一次之后，后续逻辑更新随小手机同步自动生效，
// 用户无需再到 Supabase 里改代码。
let cachedBucketCore = null;
let cachedBucketCoreAt = 0;

async function loadBucketCore(env) {
  const now = Date.now();
  if (cachedBucketCore && now - cachedBucketCoreAt < 60_000) return cachedBucketCore;
  try {
    const res = await fetch(storageObjectUrl(env, CLOUD_CORE_CODE_PATH), {
      headers: supabaseHeaders(env),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const code = await res.text();
    if (!code.includes("export async function pollOnce")) return null;
    const bytes = new TextEncoder().encode(code);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    const mod = await import(`data:application/javascript;base64,${btoa(bin)}`);
    if (typeof mod.pollOnce !== "function" || typeof mod.setMediaReplyEnabled !== "function") return null;
    cachedBucketCore = mod;
    cachedBucketCoreAt = now;
    return mod;
  } catch {
    return null;
  }
}
// 单次调用的时间预算：Edge Function 免费档墙钟上限 150s。只留 10s 给
// 收尾动作（状态回写/心跳/响应），把尽量多的时间让给 LLM 与媒体生成，
// 减少"预算不足降级模板卡"的频率；各环节的内层预留见 assistant-core。
const CLOUD_POLL_BUDGET_MS = 140_000;

const CLOUD_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function cloudJsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CLOUD_CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function buildCloudEnv(body) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("missing_supabase_env: 未读到 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY，请确认函数部署在你自己的 Supabase 项目里。");
  }
  return {
    SUPABASE_URL: supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    SUPABASE_BUCKET: typeof body?.bucket === "string" && body.bucket.trim() ? body.bucket.trim() : DEFAULT_BUCKET,
    WEIXIN_AUTO_REPLY: "true",
  };
}

async function verifyCloudCronToken(env, body) {
  const provided = typeof body?.token === "string" ? body.token.trim() : "";
  if (!provided) return { ok: false, status: 401, error: "missing_token" };
  const secret = await getObjectJson(env, CLOUD_CRON_SECRET_PATH).catch(() => null);
  const expected = typeof secret?.token === "string" ? secret.token.trim() : "";
  if (!expected) {
    return { ok: false, status: 500, error: "missing_cron_secret: 云端还没有部署密钥，请回到小手机微信设置重新复制定时 SQL。" };
  }
  if (provided !== expected) return { ok: false, status: 401, error: "invalid_token" };
  return { ok: true };
}

// 在线开关定时任务：小手机传 action=enable/disable/status，函数直连数据库
// 执行 cron.schedule / cron.unschedule（SUPABASE_DB_URL 由平台自动注入）。
// postgres 驱动按需动态加载，正常轮询路径不引入额外依赖。
async function runCloudScheduleAction(env, action) {
  const dbUrl = Deno.env.get("SUPABASE_DB_URL") || "";
  if (!dbUrl) {
    throw new Error("missing_SUPABASE_DB_URL: 当前环境读不到数据库连接串，无法在线开关定时任务，请改用手动 SQL。");
  }
  const { default: postgres } = await import("npm:postgres@3.4.7");
  const sql = postgres(dbUrl, { prepare: false });
  try {
    if (action === "enable") {
      const secret = await getObjectJson(env, CLOUD_CRON_SECRET_PATH).catch(() => null);
      const token = typeof secret?.token === "string" ? secret.token.trim() : "";
      if (!token) throw new Error("missing_cron_secret: 请回到小手机重新点「开启云端轮询」。");
      const functionUrl = `${env.SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/weixin-assistant`;
      await sql.unsafe("create extension if not exists pg_cron");
      await sql.unsafe("create extension if not exists pg_net");
      await sql.unsafe(`select cron.schedule('${CLOUD_CRON_JOB_NAME}', '10 seconds', $CRON$
  select net.http_post(
    url     := '${functionUrl}',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := jsonb_build_object('token', '${token}', 'bucket', '${env.SUPABASE_BUCKET}'),
    timeout_milliseconds := 8000
  );
$CRON$)`);
      return { scheduled: true };
    }
    if (action === "disable") {
      await sql.unsafe(`select cron.unschedule('${CLOUD_CRON_JOB_NAME}')`).catch(() => {});
      return { scheduled: false };
    }
    const rows = await sql.unsafe(`select active from cron.job where jobname = '${CLOUD_CRON_JOB_NAME}'`);
    return { scheduled: rows.length > 0 && rows[0].active !== false };
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

async function writeCloudHeartbeat(env, state) {
  await putObject(env, CLOUD_ASSISTANT_STATE_PATH, JSON.stringify({
    format: "ai-phone-weixin-cloud-assistant-state",
    version: 1,
    ...state,
  }, null, 2), "application/json").catch(() => {});
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CLOUD_CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return cloudJsonResponse(405, { ok: false, error: "method_not_allowed" });
  }

  const body = await req.json().catch(() => ({}));
  let env;
  try {
    env = buildCloudEnv(body);
  } catch (err) {
    return cloudJsonResponse(500, { ok: false, error: errorMessage(err) });
  }

  const auth = await verifyCloudCronToken(env, body);
  if (!auth.ok) {
    return cloudJsonResponse(auth.status, { ok: false, error: auth.error });
  }

  const action = typeof body?.action === "string" ? body.action.trim() : "";
  if (action === "enable" || action === "disable" || action === "status") {
    try {
      const result = await runCloudScheduleAction(env, action);
      return cloudJsonResponse(200, { ok: true, action, ...result });
    } catch (err) {
      return cloudJsonResponse(500, { ok: false, action, error: errorMessage(err) });
    }
  }

  // 优先使用桶里的最新核心逻辑，失败回退到内置版本。
  const bucketCore = await loadBucketCore(env);
  const core = bucketCore || { pollOnce, setMediaReplyEnabled };

  // 媒体回复开关以运行包 promptContext.mediaReply 为准（随小手机同步下发）；
  // 请求体传 {"media": true} 可在旧运行包上强制开启。
  core.setMediaReplyEnabled(body?.media === true);

  const startedAt = Date.now();
  const targetBotId = typeof body?.bot === "string" && body.bot.trim() ? body.bot.trim() : undefined;
  try {
    const result = await core.pollOnce(env, targetBotId, {
      deadlineAt: startedAt + CLOUD_POLL_BUDGET_MS,
      debug: body?.debug === true,
    });
    const rows = Array.isArray(result?.results) ? result.results : [];
    const summary = {
      polled: rows.length,
      received: rows.reduce((sum, row) => sum + Number(row.received || 0), 0),
      stored: rows.reduce((sum, row) => sum + Number(row.stored || 0), 0),
      sent: rows.reduce((sum, row) => sum + Number(row.autoReply?.sent || 0), 0),
      skippedForDeadline: Number(result?.skippedForDeadline || 0),
      elapsedMs: Date.now() - startedAt,
      codeSource: bucketCore ? "bucket" : "bundled",
      bots: rows.map(row => ({
        botId: row.botId,
        characterId: row.characterId,
        received: row.received,
        ilinkErrorCode: row.ilinkErrorCode,
        autoReplyStatus: row.autoReply?.status,
      })),
      error: rows.map(row =>
        row.autoReply?.error
        || (row.tokenExpired ? "Token 已过期，请重新扫码" : "")
        || (row.ilinkErrorCode !== undefined ? `iLink error_code ${row.ilinkErrorCode}` : ""),
      ).find(Boolean),
    };
    console.log(`[weixin-assistant] ${JSON.stringify(summary)}`);
    await writeCloudHeartbeat(env, {
      lastRunAt: new Date().toISOString(),
      lastError: summary.error,
      ...summary,
    });
    return cloudJsonResponse(200, { ok: true, ...summary });
  } catch (err) {
    const message = errorMessage(err);
    await writeCloudHeartbeat(env, {
      lastRunAt: new Date().toISOString(),
      lastError: message,
      elapsedMs: Date.now() - startedAt,
    });
    return cloudJsonResponse(500, { ok: false, error: message });
  }
});
