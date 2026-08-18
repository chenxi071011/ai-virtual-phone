// 工坊的「电脑」工具：小坊的云端工作机（用户自部署的 agent-computer Worker）。
// 只在设置里连接了角色电脑、且「小坊使用」开关打开时才注入（getQaTools 里按 isWorkshopComputerEnabled 判断），
// 未配置时这些工具对模型完全不可见。
// 小坊固定使用 workshop 工作区，与各角色的电脑相互隔离。
//
// 暴露给模型的只有两个工具（电脑文件 + 电脑执行命令），控制提示词体积；
// 早期的四个单操作工具保留为隐藏别名（可执行、不进提示词），旧调用不报错。

import {
    WORKSHOP_WORKSPACE,
    agentComputerRequest,
    isContainerComputer,
} from "./agent-computer";

// 与 qa-agent-tools 的 QaTool 结构保持一致（避免循环依赖，重复声明最小形状）
type QaComputerTool = {
    name: string;
    nativeName: string;
    description: string;
    schemaLines: string[];
    parameters: Record<string, unknown>;
    run: (args: Record<string, unknown>) => Promise<string>;
};

// ── 文件卡标记：op=send 的结果里携带，工坊 UI 解析后渲染可保存的文件卡 ──
// 标记随工具结果持久化，刷新后卡片仍在；内容按需从工作机拉取，不占存储。

export type QaFileCardInfo = { workspace: string; path: string; name: string };

const QA_FILE_MARKER_RE = /\n?\[\[qa-file:(\{.*?\})\]\]/;

export function parseQaFileMarker(result: string): { text: string; file: QaFileCardInfo | null } {
    const match = result.match(QA_FILE_MARKER_RE);
    if (!match) return { text: result, file: null };
    try {
        const parsed = JSON.parse(match[1]) as QaFileCardInfo;
        if (parsed && typeof parsed.workspace === "string" && typeof parsed.path === "string" && typeof parsed.name === "string") {
            return { text: result.replace(QA_FILE_MARKER_RE, ""), file: parsed };
        }
    } catch { /* 落回原文 */ }
    return { text: result, file: null };
}

function text(value: unknown, max = 4000): string {
    return typeof value === "string" ? value.slice(0, max).trim() : "";
}

// ── 四种文件操作的实现（统一工具与隐藏别名共用）──

async function runList(args: Record<string, unknown>): Promise<string> {
    const path = text(args.path) || "/";
    const data = await agentComputerRequest<{ entries: Array<{ name: string; dir: boolean }> }>(
        "list", WORKSHOP_WORKSPACE, { path });
    if (!data.entries.length) return `${path} 是空目录。`;
    return `${path} 下共 ${data.entries.length} 项：\n` + data.entries
        .map(entry => `  ${entry.dir ? "📁" : "📄"} ${entry.name}`)
        .join("\n");
}

async function runRead(args: Record<string, unknown>): Promise<string> {
    const path = text(args.path);
    if (!path) return "缺少 path。";
    const maxChars = typeof args.maxChars === "number" ? args.maxChars : undefined;
    const data = await agentComputerRequest<{ content: string; truncated: boolean }>(
        "read", WORKSHOP_WORKSPACE, { path, ...(maxChars ? { maxChars } : {}) });
    return `${path} 的内容：\n${data.content}${data.truncated ? "\n…（文件较长已截断，可用 maxChars 调整）" : ""}`;
}

async function runWrite(args: Record<string, unknown>): Promise<string> {
    const path = text(args.path);
    if (!path) return "缺少 path。";
    const content = typeof args.content === "string" ? args.content : "";
    await agentComputerRequest("write", WORKSHOP_WORKSPACE, { path, content });
    return `✓ 已写入 ${path}（${content.length} 字符）。`;
}

async function runDelete(args: Record<string, unknown>): Promise<string> {
    const path = text(args.path);
    if (!path) return "缺少 path。";
    await agentComputerRequest("delete", WORKSHOP_WORKSPACE, { path });
    return `✓ 已删除 ${path}。`;
}

async function runSend(args: Record<string, unknown>): Promise<string> {
    const path = text(args.path);
    if (!path) return "缺少 path。";
    const name = path.split("/").pop() || path;
    // lastIndexOf 无斜杠时返回 -1，slice(0,-1) 会把末位字符切掉——必须先判界
    const slashIndex = path.lastIndexOf("/");
    const parent = slashIndex <= 0 ? "/" : path.slice(0, slashIndex);
    const data = await agentComputerRequest<{ entries: Array<{ name: string; dir: boolean }> }>(
        "list", WORKSHOP_WORKSPACE, { path: parent });
    const hit = data.entries.find(entry => entry.name === name && !entry.dir);
    if (!hit) return `${path} 不存在或不是文件（先用 op=list 确认路径）。`;
    const marker = `\n[[qa-file:${JSON.stringify({ workspace: WORKSHOP_WORKSPACE, path, name })}]]`;
    return `✓ 已把 ${name} 递给用户：对话里出现了文件卡，用户可预览和保存。${marker}`;
}

// ── 暴露给模型的统一工具 ──

const computerFilesTool: QaComputerTool = {
    name: "电脑文件",
    nativeName: "computer_files",
    description:
        "操作工作机（云端电脑）上的文件：op=list 列目录 / read 读文件 / write 写文件（整文件覆盖，父目录自动创建）/ delete 删除（递归，删了找不回）/ send 把文件递给用户（对话中出现可预览保存的文件卡，交付成果用它）。"
        + "硬盘是持久的，适合保存脚本、中间结果、要交付的文件。",
    schemaLines: [
        "  参数：",
        "    · op (必填) — list / read / write / delete / send",
        "    · path — 文件或目录路径（list 缺省为 /）",
        "    · content — 写入的完整内容（op=write 必填）",
        "    · maxChars (可选) — 读取上限（op=read）",
        '  调用：[执行动作:电脑文件({"op":"write","path":"/notes.md","content":"…"})]',
    ],
    parameters: {
        type: "object",
        properties: {
            op: { type: "string", enum: ["list", "read", "write", "delete", "send"], description: "操作类型" },
            path: { type: "string", description: "文件或目录路径" },
            content: { type: "string", description: "写入内容（op=write 必填）" },
            maxChars: { type: "number", description: "读取上限（op=read）" },
        },
        required: ["op"],
    },
    async run(args) {
        switch (text(args.op, 20)) {
            case "list": return runList(args);
            case "read": return runRead(args);
            case "write": return runWrite(args);
            case "delete": return runDelete(args);
            case "send": return runSend(args);
            default: return "op 需为 list / read / write / delete / send 之一。";
        }
    },
};

const computerExecTool: QaComputerTool = {
    name: "电脑执行命令",
    nativeName: "computer_exec",
    // 描述按连接测试探到的模式动态措辞：容器 = 真 Linux；否则 = 内嵌工具集
    get description() {
        if (isContainerComputer()) {
            return "在工作机上执行 shell 命令。工作机是真 Linux 容器：bash 完整、可 npm/pip 装软件、网络全功能（curl 不限方法）、"
                + "硬盘挂载在 /workspace（持久保存）。适合跑脚本、装工具、生成文档等真实任务。";
        }
        return "在工作机上执行 shell 命令。内嵌 POSIX 工具集：ls/cat/grep/sed/awk/find/sort/wc/xargs、jq/sqlite3/yq、tar/gzip、curl（只读 GET/HEAD）等，"
            + "支持管道/重定向/循环/函数。不是完整 Linux：没有 ps/top 等系统命令，装不了软件包（npm/pip 不可用），跑不了任意二进制。"
            + "注意：基础模式的电脑没有 shell（会返回明确提示），此时改用「电脑文件」完成任务。";
    },
    schemaLines: [
        "  参数：",
        "    · command (必填) — 要执行的命令",
        '  调用：[执行动作:电脑执行命令({"command":"ls /"})]',
    ],
    parameters: {
        type: "object",
        properties: {
            command: { type: "string", description: "shell 命令" },
        },
        required: ["command"],
    },
    async run(args) {
        const command = text(args.command);
        if (!command) return "缺少 command。";
        try {
            const data = await agentComputerRequest<{ exitCode: number; stdout: string; stderr: string }>(
                "exec", WORKSHOP_WORKSPACE, { command });
            const parts = [`$ ${command}`, `退出码：${data.exitCode}`];
            if (data.stdout) parts.push(`stdout：\n${data.stdout}`);
            if (data.stderr) parts.push(`stderr：\n${data.stderr}`);
            if (!data.stdout && !data.stderr) parts.push("（无输出）");
            return parts.join("\n");
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (/shell 不可用|execution backend/i.test(message)) {
                return "这台工作机是基础模式（没有 shell），无法执行命令。请改用「电脑文件」完成任务，需要计算或转换时在对话里自行完成后写回文件。";
            }
            throw err;
        }
    },
};

export const QA_COMPUTER_TOOLS = [computerFilesTool, computerExecTool];

// ── 隐藏别名（可执行、不进提示词）：兼容早期的四个单操作工具名 ──

function alias(name: string, nativeName: string, run: (args: Record<string, unknown>) => Promise<string>): QaComputerTool {
    return {
        name,
        nativeName,
        description: `（隐藏别名）等价于 电脑文件 的对应操作`,
        schemaLines: [],
        parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" }, maxChars: { type: "number" } } },
        run,
    };
}

export const QA_COMPUTER_ALIAS_TOOLS = [
    alias("电脑列目录", "computer_list_dir", runList),
    alias("电脑读文件", "computer_read_file", runRead),
    alias("电脑写文件", "computer_write_file", runWrite),
    alias("电脑删除文件", "computer_delete", runDelete),
];
