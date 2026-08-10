// lib/resource-hub-types.ts
// 资源集市：GitHub 仓库当后端的社区资源市场。
// 仓库文件夹结构完全自由——市场首页显示仓库根目录的文件夹，
// 索引 _index.json 由资源仓库的 GitHub Actions 自动生成（含时间/说明/图片）。

export type ShareIndexFolder = {
    name: string;
    count: number;
};

export type ShareIndexEntry = {
    /** 所属一级文件夹名 */
    folder: string;
    /** 展示名（子文件夹名或文件名去扩展名） */
    name: string;
    /** dir = 子文件夹式资源；file = 孤立文件式资源 */
    type: "dir" | "file";
    /** 仓库相对路径 */
    path: string;
    /** 资源本体文件（不含说明与图片） */
    files: string[];
    /** 图片（仓库相对路径），列表页显示第一张 */
    images: string[];
    /** 说明摘要（来自 说明.txt / README.md） */
    description: string;
    /** 投稿人（来自 .author 文件，可为空） */
    author?: string;
    /** 最近更新时间（ISO），索引生成时来自 git log */
    updatedAt: string | null;
};

export type ShareIndex = {
    schema: "ai_phone_share_index";
    schemaVersion: number;
    generatedAt?: string;
    folders: ShareIndexFolder[];
    entries: ShareIndexEntry[];
};

export type ResourceHubSource = {
    owner: string;
    repo: string;
    branch: string;
};

export const RESOURCE_HUB_DEFAULT_SOURCE: ResourceHubSource = {
    owner: "xiaolongbao0709",
    repo: "ai-virtual-phone-share",
    branch: "main",
};

/** 导入目的地（用户在导入时选择） */
export type ImportDestination =
    | "preset"
    | "regex"
    | "worldbook"
    | "character"
    | "chat_session_css"
    | "chat_app_css"
    | "global_css"
    | "custom_app"
    | "game"
    | "theater"
    | "plugin";

export const IMPORT_DESTINATIONS: Array<{ key: ImportDestination; label: string; hint: string }> = [
    { key: "preset", label: "预设", hint: "预设管理页导出的 JSON" },
    { key: "regex", label: "正则", hint: "正则管理页导出的 JSON" },
    { key: "worldbook", label: "世界书", hint: "世界书管理页导出的 JSON" },
    { key: "character", label: "角色卡", hint: "角色卡 JSON 或 PNG" },
    { key: "chat_session_css", label: "聊天室CSS", hint: "需选择应用到哪个角色" },
    { key: "chat_app_css", label: "聊天主页CSS", hint: "应用到聊天主页" },
    { key: "global_css", label: "全局CSS", hint: "应用到外观页全局样式" },
    { key: "custom_app", label: "应用", hint: "应用市场 zip 安装包或单 HTML" },
    { key: "game", label: "游戏", hint: "游戏草稿箱导出的 JSON" },
    { key: "theater", label: "黑市剧场", hint: "剧场草稿箱导出的 JSON" },
    { key: "plugin", label: "插件", hint: "聊天插件 JS 源码文件" },
];
