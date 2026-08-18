// 「角色电脑」客户端：连接用户自部署的 agent-computer Worker
//（模板在独立仓库 xiaolongbao0709/agent-computer，基于 @cloudflare/computer）。
// 可插拔模块：未配置时相关功能一律不出现，主站零依赖。

import { kvGet, kvSet } from "./kv-db";

const CONFIG_KEY = "ai_phone_agent_computer_cfg_v1";

/** 一键部署跳转地址（模板为独立小仓库，部署向导不支持子目录） */
export const AGENT_COMPUTER_DEPLOY_URL =
    "https://deploy.workers.cloudflare.com/?url=https://github.com/xiaolongbao0709/agent-computer";

/** 容器版一键部署（独立仓库：真 Linux，需 Workers 付费计划；配置已开好，零改动。
 *  独立成仓库而非分支——部署向导对 /tree/ 形式的 URL 时灵时不灵，根路径最稳） */
export const AGENT_COMPUTER_CONTAINER_DEPLOY_URL =
    "https://deploy.workers.cloudflare.com/?url=https://github.com/xiaolongbao0709/agent-computer-container";

export type AgentComputerMode = "container" | "shell" | "fs-only";

export type AgentComputerConfig = {
    /** Worker 地址，如 https://ai-phone-agent-computer.xxx.workers.dev */
    endpoint: string;
    /** 部署时自定的 AGENT_TOKEN */
    token: string;
    /** 小坊（工坊）是否使用这台电脑；缺省视为开 */
    workshopEnabled?: boolean;
    /** 最近一次连接测试探到的模式（container=真 Linux；用于工具说明的措辞） */
    mode?: AgentComputerMode;
};

export function loadAgentComputerConfig(): AgentComputerConfig {
    try {
        const raw = kvGet(CONFIG_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as Partial<AgentComputerConfig>;
            return {
                endpoint: typeof parsed.endpoint === "string" ? parsed.endpoint : "",
                token: typeof parsed.token === "string" ? parsed.token : "",
                workshopEnabled: parsed.workshopEnabled !== false,
                mode: parsed.mode === "container" || parsed.mode === "shell" || parsed.mode === "fs-only" ? parsed.mode : undefined,
            };
        }
    } catch { /* fall through */ }
    return { endpoint: "", token: "", workshopEnabled: true };
}

export function saveAgentComputerConfig(config: AgentComputerConfig): void {
    kvSet(CONFIG_KEY, JSON.stringify({
        endpoint: config.endpoint.trim().replace(/\/+$/, ""),
        token: config.token.trim(),
        workshopEnabled: config.workshopEnabled !== false,
        ...(config.mode ? { mode: config.mode } : {}),
    }));
}

/** 当前电脑是否为容器模式（真 Linux）；来自最近一次连接测试的记录 */
export function isContainerComputer(): boolean {
    return loadAgentComputerConfig().mode === "container";
}

export function isAgentComputerConfigured(): boolean {
    const config = loadAgentComputerConfig();
    return Boolean(config.endpoint && config.token);
}

/** 小坊是否可用这台电脑（已连接且开关打开） */
export function isWorkshopComputerEnabled(): boolean {
    const config = loadAgentComputerConfig();
    return Boolean(config.endpoint && config.token) && config.workshopEnabled !== false;
}

/** workspace 命名约定：角色一人一机，工坊单独一台 */
export function characterWorkspace(characterId: string): string {
    // workspace 只允许 [A-Za-z0-9:_-]；角色 id 里可能有别的字符，统一转十六进制
    const clean = /^[A-Za-z0-9_-]+$/.test(characterId)
        ? characterId
        : Array.from(new TextEncoder().encode(characterId)).map(byte => byte.toString(16).padStart(2, "0")).join("").slice(0, 100);
    return `char:${clean}`;
}

export const WORKSHOP_WORKSPACE = "workshop";

export type AgentComputerStatus = {
    ok: boolean;
    fs?: boolean;
    shell?: boolean;
    mode?: AgentComputerMode;
    error?: string;
};

type ActionPayload = Record<string, unknown>;

export async function agentComputerRequest<T = Record<string, unknown>>(
    action: string,
    workspace: string,
    payload: ActionPayload = {},
    config = loadAgentComputerConfig(),
): Promise<T> {
    if (!config.endpoint || !config.token) throw new Error("角色电脑未配置（设置 → 角色电脑）");
    const res = await fetch(config.endpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.token}`,
        },
        body: JSON.stringify({ action, workspace, ...payload }),
    });
    const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string } & T;
    if (!res.ok || data.ok !== true) throw new Error(data.error || `角色电脑请求失败（${res.status}）`);
    return data;
}

/** 连接测试：返回工作模式（shell / fs-only） */
export async function testAgentComputer(config: AgentComputerConfig): Promise<AgentComputerStatus> {
    try {
        const data = await agentComputerRequest<AgentComputerStatus>("status", "connect-test", {}, config);
        return { ok: true, fs: data.fs, shell: data.shell, mode: data.mode };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}
