#!/usr/bin/env node

// 微信本地助手 CLI 壳：负责读取 config.txt、解析命令行参数与轮询循环。
// 轮询/回复的核心逻辑在 assistant-core.mjs，与云端助手（Supabase Edge Function）共用，
// 修改行为请改核心文件，不要在这里复制逻辑。

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_BUCKET,
  clampInterval,
  errorMessage,
  pollOnce,
  setTemplateImageResolver,
  sleep,
  time,
} from "./assistant-core.mjs";

const here = dirname(fileURLToPath(import.meta.url));

setTemplateImageResolver((fileName) => {
  const candidates = [
    resolve(here, "generated-cards", fileName),
    resolve(here, "cards", fileName),
    resolve(here, "../../public/weixin-local-assistant/generated-cards", fileName),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const bytes = readFileSync(path);
    if (bytes.length > 0) return `data:image/png;base64,${bytes.toString("base64")}`;
  }
  return "";
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const config = loadAssistantConfig(args);
  const env = {
    SUPABASE_URL: config.supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: config.supabaseServiceRoleKey,
    SUPABASE_BUCKET: config.supabaseBucket || DEFAULT_BUCKET,
    WEIXIN_AUTO_REPLY: config.autoReply === false ? "false" : "true",
  };

  const intervalSeconds = clampInterval(args.interval ?? config.pollIntervalSeconds);
  const targetBotId = typeof args.bot === "string" && args.bot.trim() ? args.bot.trim() : undefined;

  console.log("[AI Phone Weixin Assistant] 已启动");
  console.log(`- Supabase: ${maskUrl(config.supabaseUrl)}`);
  console.log(`- Bucket: ${env.SUPABASE_BUCKET}`);
  console.log(`- 轮询间隔: ${intervalSeconds}s`);
  console.log(`- 自动回复: ${env.WEIXIN_AUTO_REPLY === "false" ? "关闭" : "开启"}`);
  if (targetBotId) console.log(`- 指定 Bot: ${targetBotId}`);

  let stopped = false;
  let running = false;
  process.on("SIGINT", () => {
    stopped = true;
    console.log("\n[AI Phone Weixin Assistant] 正在停止...");
  });
  process.on("SIGTERM", () => {
    stopped = true;
    console.log("\n[AI Phone Weixin Assistant] 正在停止...");
  });

  const runOne = async () => {
    if (running) return;
    running = true;
    const startedAt = Date.now();
    try {
      const result = await pollOnce(env, targetBotId);
      logPollResult(result, Date.now() - startedAt);
    } catch (err) {
      console.error(`[${time()}] 轮询失败：${errorMessage(err)}`);
    } finally {
      running = false;
    }
  };

  await runOne();
  if (args.once) return;

  while (!stopped) {
    await sleep(intervalSeconds * 1000);
    if (!stopped) await runOne();
  }
  console.log("[AI Phone Weixin Assistant] 已停止");
}

function loadAssistantConfig(args) {
  const raw = args.config || process.env.AI_PHONE_WEIXIN_CONFIG_CODE || readOptionalText(resolve(here, "config.txt")) || "";
  const code = raw.trim();
  if (!code) throw new Error("缺少配置码。请在小手机微信设置里复制本地助手配置码，粘贴到 tools/weixin-local-assistant/config.txt。");

  const parsed = parseConfigCode(code);
  if (parsed.format !== "ai-phone-weixin-local-assistant-config" || parsed.version !== 1) {
    throw new Error("配置码格式不正确，请重新从小手机复制。");
  }
  if (!parsed.supabaseUrl || !parsed.supabaseServiceRoleKey) throw new Error("配置码缺少 Supabase 地址或 service_role key。");
  return parsed;
}

function parseConfigCode(code) {
  if (code.startsWith("{")) return JSON.parse(code);
  const normalized = code.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--once") out.once = true;
    else if (arg === "--config") out.config = argv[++i] || "";
    else if (arg === "--interval") out.interval = Number(argv[++i]);
    else if (arg === "--bot") out.bot = argv[++i] || "";
  }
  return out;
}

function logPollResult(result, elapsedMs) {
  const rows = Array.isArray(result?.results) ? result.results : [];
  const received = rows.reduce((sum, row) => sum + Number(row.received || 0), 0);
  const stored = rows.reduce((sum, row) => sum + Number(row.stored || 0), 0);
  const sent = rows.reduce((sum, row) => sum + Number(row.autoReply?.sent || 0), 0);
  const errors = rows.map(row => row.autoReply?.error || (row.tokenExpired ? "Token 已过期，请重新扫码" : "")).filter(Boolean);
  const suffix = errors.length ? `；错误：${errors[0]}` : "";
  console.log(`[${time()}] 已轮询 ${rows.length} 个 Bot：收到 ${received}，写入 ${stored}，回复 ${sent}，耗时 ${elapsedMs}ms${suffix}`);
}

function readOptionalText(path) {
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8");
}

function maskUrl(url) {
  try {
    const parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return `${parsed.protocol}//${parsed.hostname}`;
  } catch {
    return "(invalid url)";
  }
}

function printHelp() {
  console.log(`AI Phone Weixin Local Assistant

用法：
  node tools/weixin-local-assistant/assistant.mjs
  node tools/weixin-local-assistant/assistant.mjs --once
  node tools/weixin-local-assistant/assistant.mjs --interval 3

配置：
  1. 在小手机「微信设置」下载本地助手包。
  2. 解压后运行本脚本；config.txt 已包含配置。

参数：
  --once          只轮询一次，用于测试
  --interval N    轮询间隔，3-60 秒，默认 5
  --bot BOT_ID    只轮询指定 Bot
  --config CODE   直接传入配置码
`);
}

main().catch((err) => {
  console.error(`[AI Phone Weixin Assistant] 启动失败：${errorMessage(err)}`);
  process.exitCode = 1;
});
