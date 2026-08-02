"use client";

import { useState, useEffect, useRef } from "react";
import { Plus, Trash2, Wifi, WifiOff, AlertCircle, MessageSquare, Loader2, RefreshCw, Cloud, CloudUpload, Copy, Download, ChevronDown, PlayCircle, Power, PowerOff } from "lucide-react";
import QRCode from "qrcode";
import {
    loadWeixinBots,
    addExclusiveWeixinBot,
    updateWeixinBot,
    removeWeixinBot,
    loadKeepAlive,
    saveKeepAlive,
    type WeixinBotConfig,
} from "@/lib/weixin-storage";
import {
    isWeixinCloudSupabaseReady,
    buildWeixinLocalAssistantConfigCode,
    buildWeixinCloudAssistantCronSql,
    deployWeixinCloudFunction,
    ensureWeixinCloudCronSecret,
    fetchWeixinCloudAssistantHeartbeat,
    setWeixinCloudAssistantScheduled,
    loadWeixinCloudSyncConfig,
    pullWeixinCloudMessagesFromCloud,
    saveWeixinCloudSyncConfig,
    syncAllWeixinBotRuntimesToCloud,
    syncWeixinBotRuntimeToCloud,
    testWeixinCloudAssistantOnce,
    WEIXIN_CLOUD_CRON_JOB_NAME,
    WEIXIN_CLOUD_FUNCTION_SLUG,
    type WeixinCloudAssistantHeartbeat,
    type WeixinCloudSyncConfig,
} from "@/lib/weixin-cloud-sync";
import { getWeixinBotStatus } from "@/lib/use-weixin-bridge";
import { getLoginQrCode, pollQrCodeStatus, type QrLoginStatus } from "@/lib/weixin-bridge";
import { loadCharacters } from "@/lib/character-storage";
import type { Character } from "@/lib/character-types";
import { Toggle, Select } from "@/components/ui/form";
import { ConfirmDialog, ContentDialog } from "@/components/ui/modal";
import { Alert } from "@/components/ui/feedback";

type AddStep = "select-character" | "scanning" | "done";

const LOCAL_ASSISTANT_CARD_ASSETS = [
    "generic-red-packet-card-v1.png",
    "generic-transfer-card-v1.png",
    "generic-music-card-v1.png",
    "generic-photo-card-v1.png",
];

function formatCloudSyncBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatCloudSyncTime(value?: string): string {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

async function copyTextToClipboard(text: string): Promise<void> {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }
    const input = document.createElement("textarea");
    input.value = text;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.focus();
    input.select();
    document.execCommand("copy");
    document.body.removeChild(input);
}

function buildLocalAssistantStartBat(): string {
    return [
        "@echo off",
        "setlocal",
        "cd /d \"%~dp0\"",
        "if exist \"runtime\\node.exe\" (",
        "  \"runtime\\node.exe\" assistant.mjs",
        "  pause",
        "  exit /b %errorlevel%",
        ")",
        "where node.exe >NUL 2>&1",
        "if errorlevel 1 (",
        "  echo Node.js was not found.",
        "  echo Please install Node.js 20+ or use the package with built-in runtime.",
        "  start \"\" \"https://nodejs.org/\"",
        "  pause",
        "  exit /b 1",
        ")",
        "node.exe assistant.mjs",
        "pause",
        "exit /b %errorlevel%",
        "",
    ].join("\r\n");
}

function buildLocalAssistantOnceBat(): string {
    return [
        "@echo off",
        "setlocal",
        "cd /d \"%~dp0\"",
        "if exist \"runtime\\node.exe\" (",
        "  \"runtime\\node.exe\" assistant.mjs --once",
        "  pause",
        "  exit /b %errorlevel%",
        ")",
        "where node.exe >NUL 2>&1",
        "if errorlevel 1 (",
        "  echo Node.js was not found.",
        "  echo Please install Node.js 20+ or use the package with built-in runtime.",
        "  start \"\" \"https://nodejs.org/\"",
        "  pause",
        "  exit /b 1",
        ")",
        "node.exe assistant.mjs --once",
        "pause",
        "exit /b %errorlevel%",
        "",
    ].join("\r\n");
}

function buildLocalAssistantReadme(): string {
    return `AI Phone 微信本地助手

使用方法：
1. 解压这个文件夹。
2. 双击「启动助手.bat」。
3. 保持这个窗口打开，电脑在线时会自动轮询微信并回复。

测试：
- 双击「测试一次.bat」只轮询一次，适合检查配置是否正常。

注意：
- config.txt 已由小手机自动写入，不需要手动复制配置码。
- config.txt 包含你的 Supabase 私密密钥，不要公开分享这个文件夹。
- 角色、API、预设、世界书或记忆改动后，请回到小手机重新下载本地助手包。
- 如果提示未检测到 Node.js，请安装 Node.js 20+，或使用后续提供的内置运行时版本。
`;
}

export function WeixinSettings({ onOpenDataManagement }: { onOpenDataManagement?: () => void } = {}) {
    const [bots, setBots] = useState<WeixinBotConfig[]>([]);
    const [characters, setCharacters] = useState<Character[]>([]);
    const [statusTick, setStatusTick] = useState(0);
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    const [keepAlive, setKeepAlive] = useState(false);
    const [cloudSyncConfig, setCloudSyncConfig] = useState<WeixinCloudSyncConfig>(loadWeixinCloudSyncConfig);
    const [cloudSyncingId, setCloudSyncingId] = useState<string | null>(null);
    const [cloudSyncNotice, setCloudSyncNotice] = useState<{ ok: boolean; text: string } | null>(null);
    const [showLocalAssistantAdvanced, setShowLocalAssistantAdvanced] = useState(false);
    const [cloudAssistantBusy, setCloudAssistantBusy] = useState<string | null>(null);
    const [showCloudAssistantNotes, setShowCloudAssistantNotes] = useState(false);
    const [showManualCloudDeploy, setShowManualCloudDeploy] = useState(false);
    const [cloudDeployToken, setCloudDeployToken] = useState("");
    const [cloudAssistantNotice, setCloudAssistantNotice] = useState<{ ok: boolean; text: string } | null>(null);
    const [cloudHeartbeat, setCloudHeartbeat] = useState<WeixinCloudAssistantHeartbeat | null>(null);
    const [cloudHeartbeatCheckedAt, setCloudHeartbeatCheckedAt] = useState<string | null>(null);

    // 添加流程
    const [addStep, setAddStep] = useState<AddStep | null>(null);
    const [newCharacterId, setNewCharacterId] = useState("");
    const [addError, setAddError] = useState("");

    // QR 码状态
    const [qrImgUrl, setQrImgUrl] = useState("");
    const [qrStatus, setQrStatus] = useState<QrLoginStatus | "loading">("loading");
    const qrAbort = useRef<AbortController | null>(null);

    useEffect(() => {
        setBots(loadWeixinBots());
        setCharacters(loadCharacters());
        setKeepAlive(loadKeepAlive());
        setCloudSyncConfig(loadWeixinCloudSyncConfig());
    }, []);

    useEffect(() => {
        const refresh = () => {
            setBots(loadWeixinBots());
            setStatusTick(t => t + 1);
        };
        window.addEventListener("weixin-status-changed", refresh);
        window.addEventListener("weixin-config-changed", refresh);
        return () => {
            window.removeEventListener("weixin-status-changed", refresh);
            window.removeEventListener("weixin-config-changed", refresh);
        };
    }, []);

    // 清理 QR 轮询
    useEffect(() => {
        return () => { qrAbort.current?.abort(); };
    }, []);

    const notifyChange = () => {
        window.dispatchEvent(new CustomEvent("weixin-config-changed"));
    };

    const updateCloudSyncConfig = (patch: Partial<WeixinCloudSyncConfig>) => {
        const next = { ...cloudSyncConfig, ...patch };
        setCloudSyncConfig(next);
        saveWeixinCloudSyncConfig(next);
    };

    const handleSyncRuntime = async (botId: string) => {
        if (cloudSyncingId) return;
        setCloudSyncNotice(null);
        setCloudSyncingId(botId);
        try {
            const result = await syncWeixinBotRuntimeToCloud(botId);
            setCloudSyncConfig(loadWeixinCloudSyncConfig());
            setCloudSyncNotice({
                ok: true,
                text: `已同步「${result.snapshot.character.name}」运行包：${result.snapshot.stats.messageCount} 条消息，${formatCloudSyncBytes(result.bytes)}。`,
            });
        } catch (err) {
            setCloudSyncNotice({ ok: false, text: err instanceof Error ? err.message : String(err) });
        } finally {
            setCloudSyncingId(null);
        }
    };

    const handleSyncAllRuntimes = async () => {
        if (cloudSyncingId) return;
        setCloudSyncNotice(null);
        setCloudSyncingId("all");
        try {
            const results = await syncAllWeixinBotRuntimesToCloud();
            setCloudSyncConfig(loadWeixinCloudSyncConfig());
            if (results.length === 0) {
                setCloudSyncNotice({ ok: false, text: "没有可同步的已启用微信 Bot。" });
            } else {
                const totalBytes = results.reduce((sum, item) => sum + item.bytes, 0);
                setCloudSyncNotice({
                    ok: true,
                    text: `已同步当前微信运行包，共 ${formatCloudSyncBytes(totalBytes)}。`,
                });
            }
        } catch (err) {
            setCloudSyncNotice({ ok: false, text: err instanceof Error ? err.message : String(err) });
        } finally {
            setCloudSyncingId(null);
        }
    };

    const handlePullCloudMessages = async () => {
        if (cloudSyncingId) return;
        setCloudSyncNotice(null);
        setCloudSyncingId("pull");
        try {
            const result = await pullWeixinCloudMessagesFromCloud();
            setCloudSyncNotice({
                ok: result.errors.length === 0,
                text: `已拉取同步消息：新增 ${result.added}，跳过 ${result.skipped}${result.errors.length ? `，错误 ${result.errors.length}` : ""}。`,
            });
            for (const sessionId of result.sessionIds) {
                window.dispatchEvent(new CustomEvent("weixin-messages-updated", { detail: { sessionId } }));
            }
        } catch (err) {
            setCloudSyncNotice({ ok: false, text: err instanceof Error ? err.message : String(err) });
        } finally {
            setCloudSyncingId(null);
        }
    };

    const handleCopyLocalAssistantConfig = async () => {
        setCloudSyncNotice(null);
        try {
            const code = buildWeixinLocalAssistantConfigCode({ pollIntervalSeconds: 5 });
            await copyTextToClipboard(code);
            setCloudSyncNotice({
                ok: true,
                text: "已复制本地助手配置码。配置码包含 Supabase 私密密钥，请只粘贴到你自己的本地助手。",
            });
        } catch (err) {
            setCloudSyncNotice({ ok: false, text: err instanceof Error ? err.message : String(err) });
        }
    };

    const handleDownloadLocalAssistantPackage = async () => {
        if (cloudSyncingId) return;
        setCloudSyncNotice(null);
        setCloudSyncingId("package");
        try {
            const results = await syncAllWeixinBotRuntimesToCloud();
            if (results.length === 0) {
                setCloudSyncNotice({ ok: false, text: "没有可同步的已启用微信 Bot。" });
                return;
            }

            const code = buildWeixinLocalAssistantConfigCode({ pollIntervalSeconds: 5 });
            const scriptRes = await fetch("/weixin-local-assistant/assistant.mjs", { cache: "no-store" });
            if (!scriptRes.ok) throw new Error("下载助手脚本失败，请重新部署后再试。");
            const assistantScript = await scriptRes.text();
            const coreRes = await fetch("/weixin-local-assistant/assistant-core.mjs", { cache: "no-store" });
            if (!coreRes.ok) throw new Error("下载助手核心模块失败，请重新部署后再试。");
            const assistantCoreScript = await coreRes.text();
            const JSZip = (await import("jszip")).default;
            const { downloadFile } = await import("@/lib/download-utils");
            const zip = new JSZip();
            zip.file("assistant.mjs", assistantScript);
            zip.file("assistant-core.mjs", assistantCoreScript);
            zip.file("config.txt", code);
            zip.file("启动助手.bat", buildLocalAssistantStartBat());
            zip.file("测试一次.bat", buildLocalAssistantOnceBat());
            zip.file("README.txt", buildLocalAssistantReadme());
            for (const fileName of LOCAL_ASSISTANT_CARD_ASSETS) {
                const assetPath = `/weixin-local-assistant/generated-cards/${fileName}`;
                const assetRes = await fetch(assetPath, { cache: "no-store" });
                if (!assetRes.ok) throw new Error(`下载助手卡片素材失败：${fileName}`);
                zip.file(`generated-cards/${fileName}`, await assetRes.arrayBuffer(), {
                    binary: true,
                    compression: "STORE",
                });
            }
            const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
            await downloadFile(blob, `ai-phone-weixin-local-assistant-${new Date().toISOString().slice(0, 10)}.zip`);
            const totalBytes = results.reduce((sum, item) => sum + item.bytes, 0);
            setCloudSyncConfig(loadWeixinCloudSyncConfig());
            setCloudSyncNotice({
                ok: true,
                text: `已生成本地助手包，并同步运行包 ${formatCloudSyncBytes(totalBytes)}。解压后双击「启动助手.bat」即可运行。`,
            });
        } catch (err) {
            setCloudSyncNotice({ ok: false, text: err instanceof Error ? err.message : String(err) });
        } finally {
            setCloudSyncingId(null);
        }
    };

    const handleCopyCloudFunctionCode = async () => {
        if (cloudAssistantBusy) return;
        setCloudAssistantNotice(null);
        setCloudAssistantBusy("code");
        try {
            const results = await syncAllWeixinBotRuntimesToCloud();
            if (results.length === 0) {
                setCloudAssistantNotice({ ok: false, text: "没有可同步的已启用微信 Bot，请先添加并启用微信 Bot。" });
                return;
            }
            await ensureWeixinCloudCronSecret();
            const res = await fetch("/weixin-local-assistant/cloud-function.mjs", { cache: "no-store" });
            if (!res.ok) throw new Error("下载云函数代码失败，请重新部署站点后再试。");
            await copyTextToClipboard(await res.text());
            setCloudSyncConfig(loadWeixinCloudSyncConfig());
            setCloudAssistantNotice({
                ok: true,
                text: `已复制云函数代码并同步运行包。到 Supabase 控制台 Edge Functions 新建名为「${WEIXIN_CLOUD_FUNCTION_SLUG}」的函数粘贴部署，并关闭该函数的 JWT 校验。`,
            });
        } catch (err) {
            setCloudAssistantNotice({ ok: false, text: err instanceof Error ? err.message : String(err) });
        } finally {
            setCloudAssistantBusy(null);
        }
    };

    const handleCopyCloudCronSql = async () => {
        if (cloudAssistantBusy) return;
        setCloudAssistantNotice(null);
        setCloudAssistantBusy("sql");
        try {
            const token = await ensureWeixinCloudCronSecret();
            await copyTextToClipboard(buildWeixinCloudAssistantCronSql(token));
            setCloudAssistantNotice({
                ok: true,
                text: "已复制定时 SQL（含专属密钥，不要公开分享）。到 Supabase 控制台 SQL Editor 整段执行即可，每 10 秒轮询一次。",
            });
        } catch (err) {
            setCloudAssistantNotice({ ok: false, text: err instanceof Error ? err.message : String(err) });
        } finally {
            setCloudAssistantBusy(null);
        }
    };

    const refreshCloudHeartbeat = async () => {
        const heartbeat = await fetchWeixinCloudAssistantHeartbeat();
        setCloudHeartbeat(heartbeat);
        setCloudHeartbeatCheckedAt(new Date().toISOString());
        return heartbeat;
    };

    const handleTestCloudAssistant = async () => {
        if (cloudAssistantBusy) return;
        setCloudAssistantNotice(null);
        setCloudAssistantBusy("test");
        try {
            const result = await testWeixinCloudAssistantOnce();
            await refreshCloudHeartbeat().catch(() => null);
            setCloudAssistantNotice({
                ok: true,
                text: result.error
                    ? `云函数已运行，但轮询报错：${result.error}`
                    : "云端测试成功！云函数已正常轮询微信消息。定时 SQL 执行后即可 24 小时自动回复。",
            });
        } catch (err) {
            setCloudAssistantNotice({ ok: false, text: err instanceof Error ? err.message : String(err) });
        } finally {
            setCloudAssistantBusy(null);
        }
    };

    const handleDeployCloudFunction = async () => {
        if (cloudAssistantBusy) return;
        setCloudAssistantNotice(null);
        setCloudAssistantBusy("deploy");
        try {
            const results = await syncAllWeixinBotRuntimesToCloud();
            if (results.length === 0) {
                setCloudAssistantNotice({ ok: false, text: "没有可同步的已启用微信 Bot，请先添加并启用微信 Bot。" });
                return;
            }
            await ensureWeixinCloudCronSecret();
            await deployWeixinCloudFunction(cloudDeployToken);
            setCloudSyncConfig(loadWeixinCloudSyncConfig());
            setCloudDeployToken("");
            setCloudAssistantNotice({
                ok: true,
                text: "云函数部署成功（已自动关闭 JWT 校验，Token 未保存）。现在点「开启云端轮询」即可。",
            });
        } catch (err) {
            setCloudAssistantNotice({ ok: false, text: err instanceof Error ? err.message : String(err) });
        } finally {
            setCloudAssistantBusy(null);
        }
    };

    const handleSetCloudSchedule = async (enabled: boolean) => {
        if (cloudAssistantBusy) return;
        setCloudAssistantNotice(null);
        setCloudAssistantBusy(enabled ? "enable" : "disable");
        try {
            if (enabled) {
                const results = await syncAllWeixinBotRuntimesToCloud();
                if (results.length === 0) {
                    setCloudAssistantNotice({ ok: false, text: "没有可同步的已启用微信 Bot，请先添加并启用微信 Bot。" });
                    return;
                }
                setCloudSyncConfig(loadWeixinCloudSyncConfig());
            }
            await setWeixinCloudAssistantScheduled(enabled);
            setCloudAssistantNotice({
                ok: true,
                text: enabled
                    ? "云端轮询已开启，每 10 秒一次。刚开启时微信恢复在线可能需要几分钟，之后回复稳定在 10～60 秒。"
                    : "云端轮询已停用，不再消耗任何配额。想恢复时点「开启云端轮询」即可，无需重新部署。",
            });
        } catch (err) {
            setCloudAssistantNotice({ ok: false, text: err instanceof Error ? err.message : String(err) });
        } finally {
            setCloudAssistantBusy(null);
        }
    };

    const handleRefreshCloudHeartbeat = async () => {
        if (cloudAssistantBusy) return;
        setCloudAssistantNotice(null);
        setCloudAssistantBusy("heartbeat");
        try {
            const heartbeat = await refreshCloudHeartbeat();
            if (!heartbeat) {
                setCloudAssistantNotice({ ok: false, text: "还没有读到云端心跳。请确认云函数已部署、定时 SQL 已执行，稍等半分钟再刷新。" });
            }
        } catch (err) {
            setCloudAssistantNotice({ ok: false, text: err instanceof Error ? err.message : String(err) });
        } finally {
            setCloudAssistantBusy(null);
        }
    };

    const handleToggle = (id: string, enabled: boolean) => {
        updateWeixinBot(id, { enabled });
        setBots(loadWeixinBots());
        notifyChange();
    };

    const handleDelete = (id: string) => {
        removeWeixinBot(id);
        setBots(loadWeixinBots());
        notifyChange();
    };

    const cancelAdd = () => {
        qrAbort.current?.abort();
        setAddStep(null);
        setNewCharacterId("");
        setAddError("");
        setQrImgUrl("");
        setQrStatus("loading");
    };

    // 将 qrcode_img_content 转为可显示的 data URL
    const resolveQrImage = async (raw: string): Promise<string> => {
        // 已经是 data URI
        if (raw.startsWith("data:")) return raw;
        // 是 base64 图片数据（无前缀）
        if (!raw.startsWith("http") && raw.length > 100) return `data:image/png;base64,${raw}`;
        // 是 URL：需要生成二维码图片（用户用微信扫这个 URL）
        return QRCode.toDataURL(raw, { width: 280, margin: 2 });
    };

    // 开始扫码流程
    const startQrLogin = async () => {
        setAddError("");
        if (!newCharacterId) { setAddError("请选择角色"); return; }

        setAddStep("scanning");
        setQrStatus("loading");

        try {
            const qr = await getLoginQrCode();
            if (!qr.qrcode || !qr.qrcode_img_content) {
                throw new Error("获取二维码失败");
            }
            const imgUrl = await resolveQrImage(qr.qrcode_img_content);
            setQrImgUrl(imgUrl);
            setQrStatus("wait");

            // 开始轮询扫码状态
            qrAbort.current?.abort();
            const ctrl = new AbortController();
            qrAbort.current = ctrl;

            while (!ctrl.signal.aborted) {
                await new Promise(r => setTimeout(r, 2000));
                if (ctrl.signal.aborted) break;

                try {
                    const status = await pollQrCodeStatus(qr.qrcode);
                    setQrStatus(status.status);

                    if (status.status === "confirmed" && status.bot_token) {
                        // 登录成功！保存 bot 配置
                        const char = characters.find(c => c.id === newCharacterId);
                        addExclusiveWeixinBot({
                            characterId: newCharacterId,
                            botToken: status.bot_token,
                            enabled: true,
                            nickname: char?.name,
                        });
                        setBots(loadWeixinBots());
                        notifyChange();
                        setAddStep("done");
                        return;
                    }

                    if (status.status === "expired") {
                        setAddError("二维码已过期，请重试");
                        setAddStep("select-character");
                        return;
                    }
                } catch {
                    // 单次轮询失败，继续
                }
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            setAddError(`登录失败: ${msg}`);
            setAddStep("select-character");
        }
    };

    const statusDot = (id: string) => {
        void statusTick;
        const s = getWeixinBotStatus(id);
        if (s.status === "running") return <Wifi size={14} className="text-green-500" />;
        if (s.status === "error") return <AlertCircle size={14} className="text-red-500" />;
        return <WifiOff size={14} className="text-[var(--c-text-muted)]" />;
    };

    const statusLabel = (id: string) => {
        void statusTick;
        const bot = bots.find(item => item.id === id);
        if (cloudSyncConfig.enabled && bot?.enabled) return "本地助手同步：小手机负责同步消息，本地电脑负责自动回复";
        const s = getWeixinBotStatus(id);
        if (s.status === "running") return "运行中";
        if (s.status === "error") return s.message ?? "错误";
        return "已停止";
    };

    const boundCharacterIds = new Set(bots.map(b => b.characterId));
    const availableCharacters = characters.filter(
        c => !boundCharacterIds.has(c.id) || c.id === newCharacterId
    );
    const cloudSupabaseReady = isWeixinCloudSupabaseReady();

    const qrStatusText: Record<string, string> = {
        loading: "正在获取二维码…",
        wait: "请用微信扫描二维码",
        scaned: "已扫描，请在微信上确认登录",
        confirmed: "登录成功！",
        expired: "二维码已过期",
    };

    return (
        <div className="flex flex-col gap-[24px] h-full">
            <div className="flex justify-between items-center gap-3">
                <p className="settings-menu-section-title">WeChat Bots</p>
                {!addStep && (
                    <button
                        className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[18px] bg-black px-3 text-xs font-bold text-white shadow-sm transition-all hover:bg-gray-800 hover:shadow-md active:scale-95 focus:outline-none"
                        onClick={() => { setAddStep("select-character"); setAddError(""); }}
                    >
                        <Plus size={14} strokeWidth={1.8} />
                        添加微信 Bot
                    </button>
                )}
            </div>

            {/* 保活开关 */}
            <div className="ui-group-card !flex-row !items-center">
                <div className="flex-1 flex flex-col gap-1">
                    <span className="menu-label font-medium">后台保活</span>
                    <span className="menu-desc !mt-0">切到后台时尽量保持网页运行，不依赖 Bot 是否启用</span>
                </div>
                <Toggle checked={keepAlive} onChange={v => { setKeepAlive(v); saveKeepAlive(v); notifyChange(); }} />
            </div>

            <div className="ui-group-card !items-stretch">
                <div className="flex items-start gap-3">
                    <div className="ui-icon-circle shrink-0"><CloudUpload size={20} /></div>
                    <div className="flex-1 flex flex-col gap-1">
                        <span className="menu-label font-medium">微信本地助手</span>
                        <span className="menu-desc !mt-0">
                            下载后在电脑上运行，小手机会自动和云端同步消息。
                        </span>
                    </div>
                    <Toggle
                        checked={cloudSyncConfig.enabled}
                        onChange={v => updateCloudSyncConfig({ enabled: v })}
                    />
                </div>

                <div className="flex flex-col gap-3 mt-4">
                    <div className="flex flex-col gap-1.5">
                        <button
                            type="button"
                            className="ui-btn ui-btn-primary w-full justify-center"
                            disabled={!cloudSupabaseReady || Boolean(cloudSyncingId)}
                            onClick={() => void handleDownloadLocalAssistantPackage()}
                        >
                            {cloudSyncingId === "package"
                                ? <><Loader2 size={16} className="animate-spin" /> 打包中…</>
                                : <><Download size={16} /> 下载本地助手包</>}
                        </button>
                        <span className="menu-desc !mt-0 text-center">上次同步：{cloudSyncConfig.lastSyncedAt ? formatCloudSyncTime(cloudSyncConfig.lastSyncedAt) : "尚未同步"}</span>
                    </div>
                    <div className="flex flex-col gap-2">
                        <span className="menu-desc !mt-0">
                            自动同步开启后，小手机打开或回到前台时会自动拉取微信消息；小手机里发出的消息也会自动写入云端。
                        </span>
                        <button
                            type="button"
                            className="flex h-11 w-full items-center justify-between rounded-[14px] border border-black/10 bg-black/[0.035] px-3 text-left text-[13px] font-semibold text-[var(--c-text)] transition-colors hover:bg-black/[0.055] active:scale-[0.99] focus:outline-none"
                            onClick={() => setShowLocalAssistantAdvanced(v => !v)}
                            aria-expanded={showLocalAssistantAdvanced}
                        >
                            <span>{showLocalAssistantAdvanced ? "收起高级选项" : "展开高级选项"}</span>
                            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/80 shadow-sm">
                                <ChevronDown
                                    size={17}
                                    className={`transition-transform ${showLocalAssistantAdvanced ? "rotate-180" : ""}`}
                                />
                            </span>
                        </button>
                    </div>
                    {showLocalAssistantAdvanced && (
                        <span className="menu-desc !mt-0">
                            运行包会包含微信 token、当前角色绑定的 API 配置和提示词快照，仅写入你自己的 Supabase 私有备份桶。角色、API、预设、世界书或记忆变更后，请重新下载或同步运行包。本地助手包和配置码包含 Supabase 私密密钥，不要公开分享。
                        </span>
                    )}
                    {showLocalAssistantAdvanced && (
                        <div className="grid grid-cols-3 gap-2 rounded-[18px] bg-black/[0.03] p-3">
                            <button
                                type="button"
                                className="ui-btn ui-btn-outline min-w-0 justify-center whitespace-nowrap !gap-1 !px-2 !text-[11px]"
                                disabled={!cloudSupabaseReady || Boolean(cloudSyncingId)}
                                onClick={() => void handleSyncAllRuntimes()}
                            >
                                {cloudSyncingId === "all"
                                    ? <><Loader2 size={14} className="animate-spin" /> 同步中…</>
                                    : <><CloudUpload size={14} /> 同步运行包</>}
                            </button>
                            <button
                                type="button"
                                className="ui-btn ui-btn-outline min-w-0 justify-center whitespace-nowrap !gap-1 !px-2 !text-[11px]"
                                disabled={!cloudSupabaseReady || Boolean(cloudSyncingId)}
                                onClick={() => void handlePullCloudMessages()}
                            >
                                {cloudSyncingId === "pull"
                                    ? <><Loader2 size={14} className="animate-spin" /> 拉取中…</>
                                    : "手动拉取消息"}
                            </button>
                            <button
                                type="button"
                                className="ui-btn ui-btn-outline min-w-0 justify-center whitespace-nowrap !gap-1 !px-2 !text-[11px]"
                                disabled={!cloudSupabaseReady}
                                onClick={() => void handleCopyLocalAssistantConfig()}
                            >
                                <Copy size={14} />
                                复制配置码
                            </button>
                        </div>
                    )}
                    {!cloudSupabaseReady && (
                        <Alert variant="warning">请先到「数据管理」配置并测试 Supabase 云端备份。</Alert>
                    )}
                    {cloudSyncNotice && (
                        <Alert variant={cloudSyncNotice.ok ? "success" : "danger"}>{cloudSyncNotice.text}</Alert>
                    )}
                </div>
            </div>

            {/* 微信云端助手 */}
            <div className="ui-group-card !items-stretch">
                <div className="flex items-start gap-3">
                    <div className="ui-icon-circle shrink-0"><Cloud size={20} /></div>
                    <div className="flex-1 flex flex-col gap-1">
                        <span className="menu-label font-medium">微信云端助手</span>
                        <span className="menu-desc !mt-0">
                            部署到你自己的 Supabase，无需电脑常开，云端每 10 秒自动回复。
                        </span>
                    </div>
                </div>

                <div className="flex flex-col gap-3 mt-4">
                    {/* 三步部署引导（参考现实桥快捷指令教程的分步样式） */}
                    <div className="flex flex-col gap-4 rounded-[18px] bg-black/[0.03] p-4">
                        <div className="flex items-start gap-3">
                            <span className={`mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold text-white ${cloudSupabaseReady ? "bg-green-500" : "bg-black"}`}>{cloudSupabaseReady ? "✓" : "1"}</span>
                            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                                <span className="text-[13px] font-bold leading-snug text-[var(--c-text)]">配置 Supabase</span>
                                {cloudSupabaseReady ? (
                                    <span className="menu-desc !mt-0 text-green-600">已检测到 Supabase 云端备份配置，这一步完成了。</span>
                                ) : (
                                    <>
                                        <span className="menu-desc !mt-0">云端助手的数据和函数都放在你自己的 Supabase 项目里（免费注册）。请先到「数据管理」配置并测试 Supabase 云端备份，完成前下面的按钮不可用。</span>
                                        <button
                                            type="button"
                                            className="ui-btn ui-btn-outline mt-0.5 self-start whitespace-nowrap !gap-1.5 !px-3 !text-[12px]"
                                            onClick={() => onOpenDataManagement?.()}
                                        >
                                            去数据管理配置
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                        <div className="flex items-start gap-3">
                            <span className="mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-black text-[11px] font-extrabold text-white">2</span>
                            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                                <span className="text-[13px] font-bold leading-snug text-[var(--c-text)]">一键部署云函数</span>
                                <span className="menu-desc !mt-0">① 打开 supabase.com → 点右上角<b>头像</b> → 选「Account」进入账户设置 → 再点右上角<b>三横线（☰）菜单</b> → 「Access Tokens」→ 点「Generate new token」（名字随意）→ 复制生成的 token。也可以直接访问 supabase.com/dashboard/account/tokens；</span>
                                <span className="menu-desc !mt-0">② 粘贴到下方，点「一键部署」。Token 只用这一次，经本站点服务端转发给 Supabase（不存储、不记录），部署时会自动关闭 JWT 校验。用完可随时在 Supabase 里 Revoke。</span>
                                <span className="menu-desc !mt-0">📌 只需部署这一次：之后小手机每次同步运行包都会把最新逻辑传到云端，函数自动使用。</span>
                                <input
                                    type="password"
                                    className="h-10 w-full rounded-[12px] border border-black/10 bg-white px-3 text-[13px] focus:outline-none focus:ring-1 focus:ring-black/30"
                                    placeholder="粘贴 Access Token（sbp_ 开头）"
                                    value={cloudDeployToken}
                                    onChange={e => setCloudDeployToken(e.target.value)}
                                    autoComplete="off"
                                />
                                <button
                                    type="button"
                                    className="ui-btn ui-btn-outline mt-0.5 self-start whitespace-nowrap !gap-1.5 !px-3 !text-[12px]"
                                    disabled={!cloudSupabaseReady || Boolean(cloudAssistantBusy) || !cloudDeployToken.trim()}
                                    onClick={() => void handleDeployCloudFunction()}
                                >
                                    {cloudAssistantBusy === "deploy"
                                        ? <><Loader2 size={14} className="animate-spin" /> 部署中…</>
                                        : <><CloudUpload size={14} /> 一键部署</>}
                                </button>
                                <button
                                    type="button"
                                    className="ui-link-btn self-start !text-[11px]"
                                    data-variant="muted"
                                    onClick={() => setShowManualCloudDeploy(v => !v)}
                                    aria-expanded={showManualCloudDeploy}
                                >
                                    {showManualCloudDeploy ? "收起手动部署方式" : "不想生成 Token？展开手动部署方式"}
                                </button>
                                {showManualCloudDeploy && (
                                    <div className="flex flex-col gap-1.5 rounded-[14px] bg-black/[0.03] p-3">
                                        <span className="menu-desc !mt-0">① Supabase 控制台 → 左侧「Edge Functions」→ 点绿色「Deploy a new function」→ 选「Via Editor」；</span>
                                        <span className="menu-desc !mt-0">② 先把函数名改成 <b>{WEIXIN_CLOUD_FUNCTION_SLUG}</b>（不要用自动生成的随机名，部署后改名无效，只能删掉重建）；</span>
                                        <span className="menu-desc !mt-0">③ 清空编辑器里的示例代码，粘贴下方复制的代码，点「Deploy」（建议在电脑上操作，手机浏览器里代码编辑器很难用）；</span>
                                        <span className="menu-desc !mt-0">④ 进入函数页 →「Settings」标签 → 关掉「Verify JWT with legacy secret」开关（部分版本叫 Enforce JWT verification）→ 点「Save changes」。</span>
                                        <button
                                            type="button"
                                            className="ui-btn ui-btn-outline mt-0.5 self-start whitespace-nowrap !gap-1.5 !px-3 !text-[12px]"
                                            disabled={!cloudSupabaseReady || Boolean(cloudAssistantBusy)}
                                            onClick={() => void handleCopyCloudFunctionCode()}
                                        >
                                            {cloudAssistantBusy === "code"
                                                ? <><Loader2 size={14} className="animate-spin" /> 准备中…</>
                                                : <><Copy size={14} /> 复制云函数代码</>}
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="flex items-start gap-3">
                            <span className="mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-black text-[11px] font-extrabold text-white">3</span>
                            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                                <span className="text-[13px] font-bold leading-snug text-[var(--c-text)]">开启 / 停用轮询</span>
                                <span className="menu-desc !mt-0">开启后云端每 10 秒自动轮询回复；停用立刻生效、零配额消耗，随时可再开启，都不用去 Supabase 操作。</span>
                                <div className="flex flex-wrap items-center gap-2">
                                    <button
                                        type="button"
                                        className="ui-btn ui-btn-outline mt-0.5 self-start whitespace-nowrap !gap-1.5 !px-3 !text-[12px]"
                                        disabled={!cloudSupabaseReady || Boolean(cloudAssistantBusy)}
                                        onClick={() => void handleSetCloudSchedule(true)}
                                    >
                                        {cloudAssistantBusy === "enable"
                                            ? <><Loader2 size={14} className="animate-spin" /> 开启中…</>
                                            : <><Power size={14} /> 开启云端轮询</>}
                                    </button>
                                    <button
                                        type="button"
                                        className="ui-btn ui-btn-outline mt-0.5 self-start whitespace-nowrap !gap-1.5 !px-3 !text-[12px]"
                                        disabled={!cloudSupabaseReady || Boolean(cloudAssistantBusy)}
                                        onClick={() => void handleSetCloudSchedule(false)}
                                    >
                                        {cloudAssistantBusy === "disable"
                                            ? <><Loader2 size={14} className="animate-spin" /> 停用中…</>
                                            : <><PowerOff size={14} /> 停用</>}
                                    </button>
                                    <button
                                        type="button"
                                        className="ui-link-btn mt-0.5 shrink-0 !text-[11px]"
                                        data-variant="muted"
                                        disabled={!cloudSupabaseReady || Boolean(cloudAssistantBusy)}
                                        onClick={() => void handleCopyCloudCronSql()}
                                        title="在线开启失败时的手动方式：复制 SQL 到 SQL Editor 执行"
                                    >
                                        {cloudAssistantBusy === "sql"
                                            ? <><Loader2 size={12} className="animate-spin" /> 生成中…</>
                                            : "手动方式：复制定时 SQL"}
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div className="flex items-start gap-3">
                            <span className="mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-black text-[11px] font-extrabold text-white">4</span>
                            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                                <span className="text-[13px] font-bold leading-snug text-[var(--c-text)]">验证部署</span>
                                <span className="menu-desc !mt-0">点下方按钮立刻触发一轮「拉消息 → 生成 → 回复」；提示成功后，给 Bot 的微信发条消息试试。</span>
                                <span className="menu-desc !mt-0">⏳ 刚部署（或停用较久后重新开启）时，微信恢复 Bot 在线状态需要几分钟：第一条回复可能要等上几分钟，期间 Bot 可能显示「暂无法连接」，都是正常现象。恢复后回复会稳定在 10～60 秒内。</span>
                                <button
                                    type="button"
                                    className="ui-btn ui-btn-outline mt-0.5 self-start whitespace-nowrap !gap-1.5 !px-3 !text-[12px]"
                                    disabled={!cloudSupabaseReady || Boolean(cloudAssistantBusy)}
                                    onClick={() => void handleTestCloudAssistant()}
                                >
                                    {cloudAssistantBusy === "test"
                                        ? <><Loader2 size={14} className="animate-spin" /> 测试中…</>
                                        : <><PlayCircle size={14} /> 云端测试一次</>}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* 云端心跳状态行 */}
                    <div className="flex items-center gap-2">
                        <span
                            className={`h-2 w-2 shrink-0 rounded-full ${
                                cloudHeartbeat?.lastError
                                    ? "bg-red-500"
                                    : cloudHeartbeat?.lastRunAt && Date.now() - new Date(cloudHeartbeat.lastRunAt).getTime() < 60_000
                                        ? "bg-green-500"
                                        : "bg-black/20"
                            }`}
                        />
                        <span className="menu-desc !mt-0 flex-1">
                            {cloudHeartbeat?.lastRunAt
                                ? `云端最近轮询：${formatCloudSyncTime(cloudHeartbeat.lastRunAt)}${cloudHeartbeat.lastError ? `（错误：${cloudHeartbeat.lastError}）` : ""}`
                                : cloudHeartbeatCheckedAt
                                    ? "未读到云端心跳"
                                    : "云端心跳：尚未检查"}
                        </span>
                        <button
                            type="button"
                            className="ui-link-btn shrink-0"
                            data-variant="muted"
                            disabled={!cloudSupabaseReady || Boolean(cloudAssistantBusy)}
                            onClick={() => void handleRefreshCloudHeartbeat()}
                            title="刷新云端心跳"
                        >
                            {cloudAssistantBusy === "heartbeat" ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                        </button>
                    </div>

                    {cloudAssistantNotice && (
                        <Alert variant={cloudAssistantNotice.ok ? "success" : "danger"}>{cloudAssistantNotice.text}</Alert>
                    )}

                    <button
                        type="button"
                        className="flex h-11 w-full items-center justify-between rounded-[14px] border border-black/10 bg-black/[0.035] px-3 text-left text-[13px] font-semibold text-[var(--c-text)] transition-colors hover:bg-black/[0.055] active:scale-[0.99] focus:outline-none"
                        onClick={() => setShowCloudAssistantNotes(v => !v)}
                        aria-expanded={showCloudAssistantNotes}
                    >
                        <span>{showCloudAssistantNotes ? "收起使用说明" : "展开使用说明"}</span>
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/80 shadow-sm">
                            <ChevronDown
                                size={17}
                                className={`transition-transform ${showCloudAssistantNotes ? "rotate-180" : ""}`}
                            />
                        </span>
                    </button>
                    {showCloudAssistantNotes && (
                        <div className="flex flex-col gap-2 rounded-[18px] bg-black/[0.03] p-3">
                            <span className="menu-desc !mt-0">· 冷启动：刚部署或停用较久后重新开启时，微信侧要几分钟才把 Bot 恢复为在线，期间回复慢、可能显示「暂无法连接」；停用期间收到的消息不会补发。让定时任务一直跑着就不会再遇到。</span>
                            <span className="menu-desc !mt-0">· 与本地助手共用同一套逻辑和防重复锁，可同时开启互为备份。</span>
                            <span className="menu-desc !mt-0">· 对方发来的图片：在 API 设置开启「图像识别」后角色可以看到并回应（遵循聊天信息页的传入图片数），图片也会同步回小手机显示；语音和文件暂以文字占位提示。</span>
                            <span className="menu-desc !mt-0">· 角色发出的媒体：支持生图照片（遵循小手机「图像生成」设置）、表情包与语音（遵循语音配置），与本地助手一致。</span>
                            <span className="menu-desc !mt-0">· 微信 token 过期后仍需回到小手机重新扫码。</span>
                            <span className="menu-desc !mt-0">· 角色、API、预设等变更后，记得重新同步运行包。</span>
                            <span className="menu-desc !mt-0">· 停用：步骤②的「停用」按钮，停用后零配额消耗；也可在 SQL Editor 执行 select cron.unschedule(&apos;{WEIXIN_CLOUD_CRON_JOB_NAME}&apos;);</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Bot 列表 */}
            {bots.length > 0 && (
                <div className="flex flex-col gap-2">
                    {bots.map(bot => {
                        const char = characters.find(c => c.id === bot.characterId);
                        const status = getWeixinBotStatus(bot.id);
                        return (
                            <div key={bot.id} className="ui-group-card !flex-row !items-center">
                                <div className="flex-1 flex flex-col gap-1">
                                    <div className="flex items-center gap-[6px]">
                                        {statusDot(bot.id)}
                                        <span className="menu-label">{char?.name ?? bot.nickname ?? bot.characterId}</span>
                                    </div>
                                    <span className={`menu-desc !mt-0 ${status.status === "running" ? "text-green-500" : status.status === "error" ? "text-red-500" : ""}`}>
                                        {statusLabel(bot.id)}
                                    </span>
                                </div>
                                <div className="flex items-center gap-3 shrink-0">
                                    <button
                                        className="ui-link-btn"
                                        data-variant="muted"
                                        onClick={() => void handleSyncRuntime(bot.id)}
                                        disabled={!cloudSupabaseReady || Boolean(cloudSyncingId)}
                                        title="同步本地助手运行包"
                                    >
                                        {cloudSyncingId === bot.id ? <Loader2 size={14} className="animate-spin" /> : <CloudUpload size={14} />}
                                    </button>
                                    <button className="ui-link-btn" data-variant="muted" onClick={() => setConfirmDeleteId(bot.id)}>
                                        <Trash2 size={14} />
                                    </button>
                                    <Toggle checked={bot.enabled} onChange={v => handleToggle(bot.id, v)} />
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* 空状态 */}
            {bots.length === 0 && !addStep && (
                <div className="ui-empty mt-2">
                    <div className="ui-icon-circle"><MessageSquare size={24} /></div>
                    <span className="menu-label font-semibold">暂无微信 Bot</span>
                    <span className="menu-desc max-w-[240px]">通过 iLink 协议让 AI 角色以真实微信号回复消息。</span>
                    <button className="ui-btn ui-btn-primary" onClick={() => { setAddStep("select-character"); setAddError(""); }}>
                        <Plus size={16} /> 添加 Bot
                    </button>
                </div>
            )}

            {/* 添加弹窗 */}
            {addStep && (
                <ContentDialog
                    title={addStep === "done" ? "添加成功" : "添加微信 Bot"}
                    confirmLabel={addStep === "select-character" ? "扫码登录" : addStep === "done" ? "完成" : ""}
                    cancelLabel={addStep === "done" ? "" : "取消"}
                    onConfirm={() => {
                        if (addStep === "select-character") startQrLogin();
                        else cancelAdd();
                    }}
                    onCancel={cancelAdd}
                >
                    {addStep === "select-character" && (
                        <div className="flex flex-col gap-3">
                            <div className="flex flex-col gap-1">
                                <label className="menu-desc ml-1">选择角色</label>
                                <Select value={newCharacterId} onChange={e => setNewCharacterId(e.target.value)}>
                                    <option value="">请选择…</option>
                                    {availableCharacters.map(c => (<option key={c.id} value={c.id}>{c.name}</option>))}
                                </Select>
                            </div>
                            {addError && <Alert variant="danger">{addError}</Alert>}
                        </div>
                    )}
                    {addStep === "scanning" && (
                        <div className="flex flex-col items-center gap-3">
                            <span className="menu-label font-semibold">{characters.find(c => c.id === newCharacterId)?.name}</span>
                            <div className="w-48 h-48 rounded-lg bg-white flex items-center justify-center overflow-hidden">
                                {qrImgUrl ? (
                                    <img src={qrImgUrl} alt="微信登录二维码" className="w-full h-full object-contain" />
                                ) : (
                                    <Loader2 size={28} className="animate-spin opacity-30" />
                                )}
                            </div>
                            <span className={`menu-desc !mt-0 ${qrStatus === "scaned" ? "text-amber-500 font-medium" : ""}`}>
                                {qrStatusText[qrStatus] ?? "等待中…"}
                            </span>
                            {qrStatus === "expired" && (
                                <button className="ui-btn flex items-center gap-1" onClick={startQrLogin}>
                                    <RefreshCw size={12} /> 刷新二维码
                                </button>
                            )}
                        </div>
                    )}
                    {addStep === "done" && (
                        <div className="flex flex-col items-center gap-2">
                            <span className="menu-label font-semibold text-green-500">登录成功！</span>
                            <span className="menu-desc">{characters.find(c => c.id === newCharacterId)?.name} 的微信 Bot 已启用</span>
                        </div>
                    )}
                </ContentDialog>
            )}

            {confirmDeleteId && (
                <ConfirmDialog
                    title="确认删除？"
                    message="删除此 Bot 配置？聊天记录不会删除。"
                    confirmLabel="确认删除"
                    icon={AlertCircle}
                    variant="danger"
                    onConfirm={() => { handleDelete(confirmDeleteId); setConfirmDeleteId(null); }}
                    onCancel={() => setConfirmDeleteId(null)}
                />
            )}
        </div>
    );
}
