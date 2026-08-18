"use client";

// 「角色电脑」设置：一键部署（用户自己的 Cloudflare 账号）+ 地址/密钥 + 连接测试。
// 可插拔模块：不配置就等于不存在。

import { useState } from "react";
import { Laptop, Loader2, Rocket } from "lucide-react";
import { Input, Toggle } from "@/components/ui/form";
import {
    AGENT_COMPUTER_CONTAINER_DEPLOY_URL,
    AGENT_COMPUTER_DEPLOY_URL,
    loadAgentComputerConfig,
    saveAgentComputerConfig,
    testAgentComputer,
    type AgentComputerStatus,
} from "@/lib/agent-computer";
import {
    AGENT_COMPUTER_CAPABILITY_ID,
    getInternalCapability,
    loadInternalCapabilities,
    saveInternalCapabilities,
} from "@/lib/internal-capability-storage";

export function AgentComputerSettings({ onNotice }: { onNotice?: (msg: string) => void }) {
    const [config, setConfig] = useState(() => loadAgentComputerConfig());
    const [testing, setTesting] = useState(false);
    const [status, setStatus] = useState<AgentComputerStatus | null>(null);
    // 部署按钮的目标：开 = 容器版（container 分支，配置已内置），关 = 普通版
    const [containerDeploy, setContainerDeploy] = useState(false);
    // 电脑归谁用的两个开关：小坊存在连接配置里，角色走内置能力（与旧工具箱开关同一份数据）
    const [connected, setConnected] = useState(() => {
        const saved = loadAgentComputerConfig();
        return Boolean(saved.endpoint && saved.token);
    });
    const [workshopOn, setWorkshopOn] = useState(() => loadAgentComputerConfig().workshopEnabled !== false);
    const [characterOn, setCharacterOn] = useState(() => {
        const capability = getInternalCapability(AGENT_COMPUTER_CAPABILITY_ID);
        return Boolean(capability && capability.enabled && capability.mode !== "off");
    });

    const handleWorkshopToggle = (value: boolean) => {
        const saved = loadAgentComputerConfig();
        saveAgentComputerConfig({ ...saved, workshopEnabled: value });
        setWorkshopOn(value);
    };

    const handleCharacterToggle = (value: boolean) => {
        const items = loadInternalCapabilities().map(item =>
            item.id === AGENT_COMPUTER_CAPABILITY_ID
                ? { ...item, enabled: value, mode: (value ? "auto" : "off") as typeof item.mode, updatedAt: Date.now() }
                : item);
        saveInternalCapabilities(items);
        setCharacterOn(value);
    };

    const handleTest = async () => {
        const draft = { ...config, endpoint: config.endpoint.trim().replace(/\/+$/, ""), token: config.token.trim() };
        if (!draft.endpoint || !draft.token) {
            onNotice?.("请先填写 Worker 地址和连接密钥");
            return;
        }
        setTesting(true);
        setStatus(null);
        try {
            const result = await testAgentComputer(draft);
            setStatus(result);
            if (result.ok) {
                const saved = { ...draft, mode: result.mode };
                saveAgentComputerConfig(saved);
                setConfig(saved);
                setConnected(true);
                onNotice?.(result.mode === "container"
                    ? "已连接：容器模式（真 Linux）"
                    : result.mode === "shell" ? "已连接：完整模式（硬盘 + shell）" : "已连接：基础模式（硬盘）");
            }
        } finally {
            setTesting(false);
        }
    };

    const handleDisconnect = () => {
        saveAgentComputerConfig({ endpoint: "", token: "", workshopEnabled: workshopOn });
        setConfig({ endpoint: "", token: "", workshopEnabled: workshopOn });
        setStatus(null);
        setConnected(false);
        onNotice?.("已断开角色电脑（云端数据仍在你的 Cloudflare 账号里）");
    };

    return (
        <div className="flex flex-col gap-[16px]">
            <div className="ui-group-card !items-stretch">
                <div className="flex items-start gap-3">
                    <div className="ui-icon-circle shrink-0"><Laptop size={20} /></div>
                    <div className="flex-1 flex flex-col gap-1">
                        <span className="menu-label font-medium">角色电脑</span>
                        <span className="menu-desc !mt-0">
                            给角色和小坊各配一台云端小电脑：持久硬盘 + 常用命令。
                            部署在你自己的 Cloudflare 账号里（免费计划即可），数据只属于你。
                        </span>
                    </div>
                </div>
                <div className="flex flex-col gap-3 mt-4">
                    <div className="flex items-center gap-3">
                        <div className="flex-1 flex flex-col gap-1 min-w-0">
                            <span className="menu-label">容器版（真 Linux）</span>
                            <span className="menu-desc !mt-0">可装软件、全功能联网；需 Cloudflare 付费计划（$5/月起）</span>
                        </div>
                        <Toggle checked={containerDeploy} onChange={setContainerDeploy} />
                    </div>
                    <button
                        type="button"
                        className="ui-btn ui-btn-primary w-full justify-center"
                        onClick={() => window.open(containerDeploy ? AGENT_COMPUTER_CONTAINER_DEPLOY_URL : AGENT_COMPUTER_DEPLOY_URL, "_blank", "noopener")}
                    >
                        <Rocket size={16} /> {containerDeploy ? "一键部署（容器版）到 Cloudflare" : "一键部署到 Cloudflare"}
                    </button>
                    <span className="menu-desc !mt-0 text-center">
                        {containerDeploy
                            ? "容器版配置已内置，流程与普通部署相同、无需改任何文件；部署时同样需要自定「AGENT_TOKEN」密钥。"
                            : "部署时需要自定一段「AGENT_TOKEN」连接密钥；完成后把 Worker 地址和密钥填到下面。"}
                    </span>
                    <button
                        type="button"
                        className="menu-desc !mt-0 text-center underline bg-transparent border-none cursor-pointer"
                        onClick={() => window.open("https://github.com/xiaolongbao0709/agent-computer#部署按钮失败--想删掉重新部署", "_blank", "noopener")}
                    >
                        一键部署失败？这里有另一条路
                    </button>
                </div>
            </div>

            <div className="ui-group-card !items-stretch">
                <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1.5">
                        <span className="menu-label font-medium">Worker 地址</span>
                        <Input
                            value={config.endpoint}
                            placeholder="https://ai-phone-agent-computer.xxx.workers.dev"
                            onChange={e => setConfig(current => ({ ...current, endpoint: e.target.value }))}
                        />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <span className="menu-label font-medium">连接密钥（AGENT_TOKEN）</span>
                        <Input
                            type="password"
                            value={config.token}
                            placeholder="部署时自定的那串密钥"
                            onChange={e => setConfig(current => ({ ...current, token: e.target.value }))}
                        />
                    </div>
                    <button
                        type="button"
                        className="ui-btn ui-btn-primary w-full justify-center"
                        disabled={testing}
                        onClick={() => void handleTest()}
                    >
                        {testing ? <><Loader2 size={16} className="animate-spin" /> 测试中…</> : "连接测试并保存"}
                    </button>
                    {status && (
                        <span className="menu-desc !mt-0 text-center">
                            {status.ok
                                ? status.mode === "container"
                                    ? "✓ 已连接：容器模式（真 Linux，可 npm/pip、全功能网络）"
                                    : status.mode === "shell"
                                        ? "✓ 已连接：完整模式（硬盘 + shell 命令）"
                                        : "✓ 已连接：基础模式（硬盘可用；shell 暂不可用，见部署说明）"
                                : `✗ 连接失败：${status.error}`}
                        </span>
                    )}
                    {config.endpoint.trim() !== "" && (
                        <button type="button" className="ui-btn w-full justify-center text-[var(--c-danger)]" onClick={handleDisconnect}>
                            断开连接
                        </button>
                    )}
                </div>
            </div>

            {connected && (
                <div className="ui-group-card !items-stretch">
                    <span className="menu-label font-medium">谁在用这台电脑</span>
                    <div className="flex items-center gap-3 mt-3">
                        <div className="flex-1 flex flex-col gap-1 min-w-0">
                            <span className="menu-label">角色</span>
                            <span className="menu-desc !mt-0">每个角色一台独立电脑：写日记、翻旧文件、发文件、跑命令</span>
                        </div>
                        <Toggle checked={characterOn} onChange={handleCharacterToggle} />
                    </div>
                    <div className="flex items-center gap-3 mt-3">
                        <div className="flex-1 flex flex-col gap-1 min-w-0">
                            <span className="menu-label">小坊（工坊）</span>
                            <span className="menu-desc !mt-0">给小坊一台工作机：读写文件、执行命令，产出文件交付给你</span>
                        </div>
                        <Toggle checked={workshopOn} onChange={handleWorkshopToggle} />
                    </div>
                </div>
            )}
        </div>
    );
}
