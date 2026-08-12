import { reindexCoCreateChapters } from "./cocreate-storage";
import { appNowISO } from "./app-clock";
import type { LlmToolCall, LlmToolDefinition } from "./llm-provider-adapter";
import type {
  CoCreateCastMember,
  CoCreateChapter,
  CoCreatePendingMutation,
  CoCreatePendingMutationOperation,
  CoCreateRevision,
  CoCreateSession,
  CoCreateToolArtifact,
  CoCreateToolArtifactType,
} from "./cocreate-types";

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export type CoCreateToolCall = {
  name: string;
  args: Record<string, unknown>;
  actor?: string;
};

export type CoCreateToolFlowSegment =
  | { type: "text"; content: string }
  | { type: "tools"; toolCalls: CoCreateToolCall[] };

export type CoCreateToolResult = {
  name: string;
  success: boolean;
  data?: string;
  error?: string;
  notice: string;
  artifact?: CoCreateToolArtifact;
  pendingMutation?: CoCreatePendingMutation;
};

const MAX_TOOL_RESULT_LENGTH = 12000;

export const COCREATE_TOOL_DEFINITIONS = [
  { name: "查看", label: "查看", category: "read",  description: "读取章节、角色、关系档案、笔记本；带 keyword 时检索。" },
  { name: "追加", label: "追加", category: "write", description: "在正文 / 笔记本 / 关系档案末尾追加文本。" },
  { name: "编辑", label: "编辑", category: "write", description: "精准替换或整体覆写；path 不存在时按 new 创建。" },
  { name: "删除", label: "删除", category: "write", description: "删除整章 / 整个角色；或清空笔记本 / 关系档案。" },
  { name: "切换", label: "切换", category: "write", description: "把指定章节设为当前编辑章节。" },
] as const;

export type CoCreateToolDefinition = (typeof COCREATE_TOOL_DEFINITIONS)[number];

const VERB_SET: Set<string> = new Set(COCREATE_TOOL_DEFINITIONS.map((tool) => tool.name));

function canonicalToolName(name: string): string {
  return name.trim();
}

function isCoCreateToolEnabled(name: string, disabledToolNames: string[] = []): boolean {
  const canonical = canonicalToolName(name);
  return !disabledToolNames.map((item) => canonicalToolName(item)).includes(canonical);
}

export function getEnabledCoCreateTools(disabledToolNames: string[] = []): CoCreateToolDefinition[] {
  return COCREATE_TOOL_DEFINITIONS.filter((tool) => isCoCreateToolEnabled(tool.name, disabledToolNames));
}

export const NATIVE_TOOL_TO_COCREATE_NAME: Record<string, string> = {
  view: "查看",
  append: "追加",
  edit: "编辑",
  remove: "删除",
  switch: "切换",
};

const COCREATE_NAME_TO_NATIVE_TOOL: Record<string, string> = Object.fromEntries(
  Object.entries(NATIVE_TOOL_TO_COCREATE_NAME).map(([native, cocreate]) => [cocreate, native]),
);

export function getCoCreateNativeToolDefinitions(
  disabledToolNames: string[] = [],
  options?: { variant?: "write" | "read" },
): LlmToolDefinition[] {
  const variant = options?.variant ?? "write";
  const allowedForVariant = variant === "read"
    ? new Set(["查看"])
    : new Set(["查看", "追加", "编辑", "删除", "切换"]);

  return getEnabledCoCreateTools(disabledToolNames)
    .filter((tool) => allowedForVariant.has(tool.name))
    .map((tool) => {
      const name = COCREATE_NAME_TO_NATIVE_TOOL[tool.name];
      if (tool.name === "查看") {
        return {
          name,
          description: "读取章节、角色、人物关系或作品笔记；提供 keyword 时在目标范围检索。",
          parameters: {
            type: "object",
            additionalProperties: false,
            required: ["path"],
            properties: {
              path: { type: "string", description: "目标路径，如 章节、章节/01、章节/01/正文、角色、角色/李斯特、人物关系、笔记本。" },
              keyword: { type: "string", description: "可选检索关键词。" },
              limit: { type: "number", description: "可选命中数量，1-20。" },
            },
          },
        };
      }
      if (tool.name === "追加") {
        return {
          name,
          description: "把新内容追加到章节正文、人物关系或作品笔记末尾。",
          parameters: {
            type: "object",
            additionalProperties: false,
            required: ["path", "content"],
            properties: {
              path: { type: "string", description: "目标路径，如 章节/01/正文、人物关系、笔记本。" },
              content: { type: "string", description: "要追加的新内容。" },
            },
          },
        };
      }
      if (tool.name === "编辑") {
        return {
          name,
          description: "精准替换或整体覆写章节、角色、人物关系或作品笔记。path 不存在时可创建新章节或新角色。",
          parameters: {
            type: "object",
            additionalProperties: false,
            required: ["path", "new"],
            properties: {
              path: { type: "string", description: "目标路径，如 章节/01、章节/01/标题、章节/01/正文、角色/李斯特、人物关系、笔记本。" },
              old: { type: "string", description: "可选旧文本；提供时必须在目标中唯一命中，用于局部替换。" },
              new: { type: "string", description: "新文本；未提供 old 时整体覆写或创建。" },
            },
          },
        };
      }
      if (tool.name === "切换") {
        return {
          name,
          description: "把指定章节设为当前编辑章节。仅章节路径有效。",
          parameters: {
            type: "object",
            additionalProperties: false,
            required: ["path"],
            properties: {
              path: { type: "string", description: "目标章节路径，如 章节/03。" },
            },
          },
        };
      }
      return {
        name,
        description: "删除章节或角色；也可清空人物关系或作品笔记。",
        parameters: {
          type: "object",
          additionalProperties: false,
          required: ["path"],
          properties: {
            path: { type: "string", description: "目标路径，如 章节/01、角色/李斯特、人物关系、笔记本。" },
          },
        },
      };
    });
}

export function coCreateNativeToolCallToTextCall(call: LlmToolCall): CoCreateToolCall {
  return {
    name: NATIVE_TOOL_TO_COCREATE_NAME[call.name] || call.name,
    args: call.args,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic helpers
// ─────────────────────────────────────────────────────────────────────────────

function nowIso(): string {
  return appNowISO();
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function cleanText(value: unknown, maxLength: number): string {
  const text = String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function cleanInline(value: unknown, maxLength: number): string {
  return cleanText(value, maxLength).replace(/\s+/g, " ").trim();
}

function numericArg(args: Record<string, unknown>, key: string, fallback: number, min: number, max: number): number {
  const value = Number(args[key]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function stringArg(args: Record<string, unknown>, keys: string[], maxLength: number): string {
  for (const key of keys) {
    const value = cleanText(args[key], maxLength);
    if (value) return value;
  }
  return "";
}

function optionalStringArg(args: Record<string, unknown>, keys: string[], maxLength: number): string | undefined {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(args, key)) {
      return cleanText(args[key], maxLength);
    }
  }
  return undefined;
}

function countTextWords(text: string): number {
  return text.replace(/\s+/g, "").length;
}

function findUnique(source: string, needle: string): { ok: true; index: number } | { ok: false; count: number } {
  if (!needle) return { ok: false, count: 0 };
  let count = 0;
  let index = -1;
  let cursor = 0;
  while (true) {
    const found = source.indexOf(needle, cursor);
    if (found < 0) break;
    count += 1;
    index = found;
    cursor = found + Math.max(needle.length, 1);
    if (count > 1) break;
  }
  return count === 1 ? { ok: true, index } : { ok: false, count };
}

function makePreview(text: string, maxLength = 360): string {
  return cleanText(text, maxLength).replace(/\n{3,}/g, "\n\n");
}

function normalizeChapterNum(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const digits = raw.replace(/[^\d]/g, "");
  return digits ? digits.padStart(2, "0") : raw;
}

function normalizeCastColor(value: string, fallback = "#d4c5a0"): string {
  const color = value.trim();
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color) ? color : fallback;
}

function createAutoCastCode(name: string, existing?: CoCreateCastMember): string {
  const trimmed = name.trim();
  if (existing?.name === trimmed && existing.nameEn.trim()) return existing.nameEn;
  const ascii = trimmed.match(/[A-Za-z0-9]+/g)?.join(" ").trim();
  if (ascii) return ascii.toUpperCase().slice(0, 32);
  let hash = 0;
  for (const char of trimmed || "CAST") {
    hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
  }
  return `CAST-${hash.toString(36).toUpperCase().padStart(4, "0").slice(0, 4)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Path resolver
// ─────────────────────────────────────────────────────────────────────────────

type ResolvedPath =
  | { kind: "chapter-index" }
  | { kind: "chapter"; chapter: CoCreateChapter | null; raw: string; num: string }
  | { kind: "chapter-body"; chapter: CoCreateChapter | null; raw: string; num: string }
  | { kind: "chapter-title"; chapter: CoCreateChapter | null; raw: string; num: string }
  | { kind: "chapter-title-en"; chapter: CoCreateChapter | null; raw: string; num: string }
  | { kind: "cast-index" }
  | { kind: "cast"; member: CoCreateCastMember | null; raw: string; name: string }
  | { kind: "relationship" }
  | { kind: "notebook" }
  | { kind: "invalid"; raw: string; reason: string };

const CHAPTER_ROOT = new Set(["章节", "chapters", "chapter"]);
const CAST_ROOT = new Set(["角色", "cast"]);
const RELATIONSHIP_ROOT = new Set(["人物关系", "关系", "人物关系档案", "relationship", "relationships", "dossier"]);
const NOTEBOOK_ROOT = new Set(["笔记本", "notebook", "writerNotebook", "笔记"]);
const BODY_SEG = new Set(["正文", "body", "content"]);
const TITLE_SEG = new Set(["标题", "title"]);
const TITLE_EN_SEG = new Set(["英文标题", "titleEn", "englishTitle", "标题英文"]);

function splitPath(raw: string): string[] {
  return String(raw || "")
    .replace(/^\/+|\/+$/g, "")
    .split(/[\/]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function findChapterByNum(session: CoCreateSession, num: string): CoCreateChapter | null {
  const normalized = normalizeChapterNum(num);
  return session.chapters.find((chapter) => normalizeChapterNum(chapter.num) === normalized) || null;
}

function findCastByName(session: CoCreateSession, name: string): CoCreateCastMember | null {
  const lower = name.trim().toLocaleLowerCase();
  return session.cast.find((member) => (
    member.name === name
    || member.nameEn.toLocaleLowerCase() === lower
  )) || null;
}

function resolvePath(session: CoCreateSession, raw: string): ResolvedPath {
  const segments = splitPath(raw);
  if (segments.length === 0) return { kind: "invalid", raw, reason: "path 不能为空。" };
  const head = segments[0];

  if (RELATIONSHIP_ROOT.has(head)) return segments.length === 1 ? { kind: "relationship" } : { kind: "invalid", raw, reason: "人物关系是单文档，不能有子路径。" };
  if (NOTEBOOK_ROOT.has(head)) return segments.length === 1 ? { kind: "notebook" } : { kind: "invalid", raw, reason: "笔记本是单文档，不能有子路径。" };

  if (CHAPTER_ROOT.has(head)) {
    if (segments.length === 1) return { kind: "chapter-index" };
    const numRaw = segments[1];
    const num = normalizeChapterNum(numRaw);
    const chapter = findChapterByNum(session, numRaw);
    if (segments.length === 2) return { kind: "chapter", chapter, raw, num };
    const sub = segments[2];
    if (BODY_SEG.has(sub)) return { kind: "chapter-body", chapter, raw, num };
    if (TITLE_SEG.has(sub)) return { kind: "chapter-title", chapter, raw, num };
    if (TITLE_EN_SEG.has(sub)) return { kind: "chapter-title-en", chapter, raw, num };
    return { kind: "invalid", raw, reason: `章节子路径只支持 正文 / 标题 / 英文标题，得到「${sub}」。` };
  }

  if (CAST_ROOT.has(head)) {
    if (segments.length === 1) return { kind: "cast-index" };
    const name = segments.slice(1).join("/");
    const member = findCastByName(session, name);
    return { kind: "cast", member, raw, name };
  }

  return { kind: "invalid", raw, reason: `未知的根目录「${head}」。可用根目录：章节 / 角色 / 人物关系 / 笔记本。` };
}

function describePath(resolved: ResolvedPath): string {
  switch (resolved.kind) {
    case "chapter-index": return "章节目录";
    case "chapter": return `第 ${resolved.num} 章`;
    case "chapter-body": return `第 ${resolved.num} 章正文`;
    case "chapter-title": return `第 ${resolved.num} 章标题`;
    case "chapter-title-en": return `第 ${resolved.num} 章英文标题`;
    case "cast-index": return "角色目录";
    case "cast": return `角色「${resolved.name}」`;
    case "relationship": return "人物关系档案";
    case "notebook": return "作品笔记本";
    case "invalid": return resolved.raw || "(空 path)";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cast doc serialize/parse (markdown-ish)
// ─────────────────────────────────────────────────────────────────────────────

function formatCastDoc(member: CoCreateCastMember, options?: { revealSecret?: boolean }): string {
  const reveal = options?.revealSecret ?? !member.secretHidden;
  const lines = [
    `档案ID：${member.id}`,
    `姓名：${member.name}`,
    `英文代号：${member.nameEn}`,
    `身份：${member.role}`,
    `位置/背景：${member.major}`,
    `人物标签：${member.label}`,
    `颜色：${member.color}`,
    "公开设定：",
    member.desc || "(暂无)",
  ];
  if (member.secret) {
    lines.push("");
    if (reveal) {
      lines.push("暗线设定：", member.secret);
      lines.push("暗线隐藏：否");
    } else {
      lines.push("暗线设定：(隐藏，不展示)");
      lines.push("暗线隐藏：是");
    }
  }
  return lines.join("\n");
}

function formatCastListItem(member: CoCreateCastMember, index: number): string {
  const visible = member.secret && !member.secretHidden ? `\n已揭示暗线：${member.secret}` : "";
  const hidden = member.secret && member.secretHidden ? "\n暗线：存在但当前隐藏。" : "";
  return [
    `${index + 1}. ${member.name} / ${member.nameEn}`,
    `档案ID：${member.id}`,
    `身份：${member.role}`,
    `位置/背景：${member.major}`,
    `人物标签：${member.label}`,
    `公开设定：${member.desc}${visible}${hidden}`,
  ].join("\n");
}

function parseCastDoc(text: string, existing?: CoCreateCastMember): CoCreateCastMember {
  const get = (label: RegExp): string => {
    const match = label.exec(text);
    return match ? match[1].trim() : "";
  };
  const block = (label: RegExp): string => {
    const match = label.exec(text);
    if (!match) return "";
    const start = match.index + match[0].length;
    const rest = text.slice(start);
    const nextLabel = /\n(?:档案ID|姓名|英文代号|身份|位置\/背景|人物标签|颜色|公开设定|暗线设定|暗线隐藏)\s*[:：]/.exec(rest);
    return (nextLabel ? rest.slice(0, nextLabel.index) : rest).trim();
  };

  const inlineName = get(/(?:^|\n)姓名\s*[:：]\s*([^\n]+)/);
  const fallbackName = existing?.name ?? "";
  const name = inlineName || fallbackName;
  const nameEn = get(/(?:^|\n)英文代号\s*[:：]\s*([^\n]+)/) || existing?.nameEn || createAutoCastCode(name, existing);
  const role = get(/(?:^|\n)身份\s*[:：]\s*([^\n]+)/) || existing?.role || "未设定身份";
  const major = get(/(?:^|\n)位置\/背景\s*[:：]\s*([^\n]+)/) || existing?.major || "—";
  const label = get(/(?:^|\n)人物标签\s*[:：]\s*([^\n]+)/) || existing?.label || "未命名标签";
  const color = normalizeCastColor(get(/(?:^|\n)颜色\s*[:：]\s*([^\n]+)/), existing?.color ?? "#d4c5a0");
  const desc = block(/(?:^|\n)公开设定\s*[:：]/) || existing?.desc || "暂无公开设定。";
  const secretRaw = block(/(?:^|\n)暗线设定\s*[:：]/);
  const secret = secretRaw && !/^\(?隐藏/.test(secretRaw) ? secretRaw : existing?.secret ?? null;
  const hiddenRaw = get(/(?:^|\n)暗线隐藏\s*[:：]\s*([^\n]+)/).toLocaleLowerCase();
  const secretHidden = secret
    ? (hiddenRaw ? ["是", "true", "1", "yes", "隐藏"].includes(hiddenRaw) : existing?.secretHidden ?? true)
    : false;

  return {
    id: existing?.id || createId("cocreate_cast"),
    name: name.trim(),
    nameEn: nameEn.trim().toUpperCase().slice(0, 32) || createAutoCastCode(name, existing),
    role: role.trim(),
    color,
    major: major.trim(),
    label: label.trim(),
    desc: desc.trim(),
    secret: secret ? String(secret).trim() : null,
    secretHidden,
    tags: existing?.tags || [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Chapter doc serialize/read
// ─────────────────────────────────────────────────────────────────────────────

function getChapterBody(chapter: CoCreateChapter): string {
  return chapter.content?.trim() || "";
}

function formatChapterIndexLine(chapter: CoCreateChapter): string {
  const summary = chapter.summary ? ` 摘要：${chapter.summary}` : "";
  const state = chapter.archivedAt ? "archived" : "draft";
  return `${chapter.num}. ${chapter.title} / ${chapter.titleEn} [${state}] ${chapter.words}字${summary}`;
}

function formatChapterDoc(chapter: CoCreateChapter): string {
  const body = getChapterBody(chapter);
  return [
    `标题：${chapter.title}`,
    `英文标题：${chapter.titleEn}`,
    `状态：${chapter.archivedAt ? "archived" : "draft"}`,
    `字数：${chapter.words}`,
    chapter.summary ? `摘要：${chapter.summary}` : "摘要：(暂无)",
    "",
    "---",
    "",
    body || "(本章还没有正文)",
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Revision / pending mutation factories
// ─────────────────────────────────────────────────────────────────────────────

function makeArtifact(
  toolName: string,
  resultType: CoCreateToolArtifactType,
  summary: string,
  rawResult: string | undefined,
  createdTurn: number,
  expiresAfterTurns: number,
  chapterId?: string,
): CoCreateToolArtifact {
  return {
    id: createId("cocreate_tool"),
    toolName,
    resultType,
    chapterId,
    summary: cleanText(summary, 500),
    rawResult: rawResult ? cleanText(rawResult, MAX_TOOL_RESULT_LENGTH) : undefined,
    createdTurn,
    expiresAfterTurns,
    createdAt: nowIso(),
  };
}

function createChapterRevision(
  before: CoCreateChapter,
  toolName: string,
  summary: string,
  patch?: Partial<Pick<CoCreateRevision, "afterTitle" | "afterTitleEn" | "afterContent">>,
): CoCreateRevision {
  return {
    id: createId("cocreate_revision"),
    chapterId: before.id,
    toolName,
    beforeTitle: before.title,
    beforeTitleEn: before.titleEn,
    afterTitle: patch?.afterTitle,
    afterTitleEn: patch?.afterTitleEn,
    beforeContent: before.content,
    afterContent: patch?.afterContent,
    summary,
    createdAt: nowIso(),
  };
}

function updateChapterInSession(
  session: CoCreateSession,
  chapterId: string,
  updater: (chapter: CoCreateChapter) => CoCreateChapter,
  revision?: CoCreateRevision,
): CoCreateSession {
  return {
    ...session,
    chapters: session.chapters.map((chapter) => (chapter.id === chapterId ? updater(chapter) : chapter)),
    revisions: revision ? [...session.revisions, revision].slice(-80) : session.revisions,
  };
}

function makePendingMutation(
  toolName: string,
  summary: string,
  operation: CoCreatePendingMutationOperation,
  options?: {
    chapter?: CoCreateChapter | null;
    beforePreview?: string;
    afterPreview?: string;
  },
): CoCreatePendingMutation {
  return {
    id: createId("cocreate_pending"),
    toolName,
    chapterId: options?.chapter?.id,
    chapterNum: options?.chapter?.num,
    chapterTitle: options?.chapter?.title,
    summary,
    beforePreview: options?.beforePreview,
    afterPreview: options?.afterPreview,
    operation,
    createdAt: nowIso(),
  };
}

function queuePendingMutation(session: CoCreateSession, mutation: CoCreatePendingMutation): CoCreateSession {
  return {
    ...session,
    pendingMutations: [...session.pendingMutations, mutation].slice(-12),
  };
}

function pushArtifact(session: CoCreateSession, artifact: CoCreateToolArtifact): CoCreateSession {
  return {
    ...session,
    toolArtifacts: [...session.toolArtifacts, artifact].slice(-20),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Verb handlers
// ─────────────────────────────────────────────────────────────────────────────

type HandlerCtx = {
  session: CoCreateSession;
  createdTurn: number;
  autoAccept: boolean;
};

type HandlerOutput = { session: CoCreateSession; result: CoCreateToolResult };

function fail(name: string, message: string): CoCreateToolResult {
  return { name, success: false, error: message, notice: `${name}失败：${message}` };
}

function handle查看(ctx: HandlerCtx, args: Record<string, unknown>): HandlerOutput {
  const path = stringArg(args, ["path", "目标", "位置"], 200);
  if (!path) return { session: ctx.session, result: fail("查看", "缺少 path。") };
  const resolved = resolvePath(ctx.session, path);
  if (resolved.kind === "invalid") return { session: ctx.session, result: fail("查看", resolved.reason) };

  const keyword = optionalStringArg(args, ["keyword", "query", "关键词"], 80);
  if (keyword) return runSearch(ctx, resolved, keyword, args);

  switch (resolved.kind) {
    case "chapter-index": return readChapterIndex(ctx, resolved);
    case "chapter":       return readChapter(ctx, resolved);
    case "chapter-body":  return readChapterBody(ctx, resolved);
    case "chapter-title": return readChapterTitle(ctx, resolved, "zh");
    case "chapter-title-en": return readChapterTitle(ctx, resolved, "en");
    case "cast-index":    return readCastIndex(ctx);
    case "cast":          return readCast(ctx, resolved);
    case "relationship":  return readRelationship(ctx);
    case "notebook":      return readNotebook(ctx);
  }
}

function readChapterIndex(ctx: HandlerCtx, resolved: Extract<ResolvedPath, { kind: "chapter-index" }>): HandlerOutput {
  void resolved;
  const data = ctx.session.chapters.length === 0
    ? "当前还没有章节。"
    : ctx.session.chapters.map(formatChapterIndexLine).join("\n");
  const summary = `查看了章节目录，共 ${ctx.session.chapters.length} 章。`;
  return {
    session: pushArtifact(ctx.session, makeArtifact("查看", "index", summary, data, ctx.createdTurn, 2)),
    result: { name: "查看", success: true, data, notice: summary },
  };
}

function readChapter(ctx: HandlerCtx, resolved: Extract<ResolvedPath, { kind: "chapter" }>): HandlerOutput {
  if (!resolved.chapter) return { session: ctx.session, result: fail("查看", `第 ${resolved.num} 章不存在。`) };
  const data = formatChapterDoc(resolved.chapter);
  const summary = `查看了第 ${resolved.chapter.num} 章《${resolved.chapter.title}》，约 ${countTextWords(getChapterBody(resolved.chapter))} 字。`;
  return {
    session: pushArtifact(ctx.session, makeArtifact("查看", "fulltext", summary, data, ctx.createdTurn, 1, resolved.chapter.id)),
    result: { name: "查看", success: true, data, notice: summary },
  };
}

function readChapterBody(ctx: HandlerCtx, resolved: Extract<ResolvedPath, { kind: "chapter-body" }>): HandlerOutput {
  if (!resolved.chapter) return { session: ctx.session, result: fail("查看", `第 ${resolved.num} 章不存在。`) };
  const data = getChapterBody(resolved.chapter) || "(本章还没有正文)";
  const summary = `查看了第 ${resolved.chapter.num} 章正文。`;
  return {
    session: pushArtifact(ctx.session, makeArtifact("查看", "fulltext", summary, data, ctx.createdTurn, 1, resolved.chapter.id)),
    result: { name: "查看", success: true, data, notice: summary },
  };
}

function readChapterTitle(ctx: HandlerCtx, resolved: Extract<ResolvedPath, { kind: "chapter-title" | "chapter-title-en" }>, lang: "zh" | "en"): HandlerOutput {
  if (!resolved.chapter) return { session: ctx.session, result: fail("查看", `第 ${resolved.num} 章不存在。`) };
  const data = lang === "zh" ? resolved.chapter.title : resolved.chapter.titleEn;
  const summary = `查看了第 ${resolved.chapter.num} 章${lang === "zh" ? "标题" : "英文标题"}。`;
  return {
    session: pushArtifact(ctx.session, makeArtifact("查看", "fulltext", summary, data, ctx.createdTurn, 1, resolved.chapter.id)),
    result: { name: "查看", success: true, data, notice: summary },
  };
}

function readCastIndex(ctx: HandlerCtx): HandlerOutput {
  if (ctx.session.cast.length === 0) {
    return {
      session: pushArtifact(ctx.session, makeArtifact("查看", "cast", "查看角色目录，目前为空。", "当前没有角色档案。", ctx.createdTurn, 3)),
      result: { name: "查看", success: true, data: "当前没有角色档案。", notice: "查看了角色目录，目前为空。" },
    };
  }
  const data = ctx.session.cast.map(formatCastListItem).join("\n\n");
  const summary = `查看了全部角色档案，共 ${ctx.session.cast.length} 个。`;
  return {
    session: pushArtifact(ctx.session, makeArtifact("查看", "cast", summary, data, ctx.createdTurn, 3)),
    result: { name: "查看", success: true, data, notice: summary },
  };
}

function readCast(ctx: HandlerCtx, resolved: Extract<ResolvedPath, { kind: "cast" }>): HandlerOutput {
  if (!resolved.member) return { session: ctx.session, result: fail("查看", `角色「${resolved.name}」不存在。`) };
  const data = formatCastDoc(resolved.member);
  const summary = `查看了角色档案「${resolved.member.name}」。`;
  return {
    session: pushArtifact(ctx.session, makeArtifact("查看", "cast", summary, data, ctx.createdTurn, 3)),
    result: { name: "查看", success: true, data, notice: summary },
  };
}

function readRelationship(ctx: HandlerCtx): HandlerOutput {
  const data = ctx.session.relationshipDossier?.trim() || "当前还没有人物关系档案。";
  const summary = ctx.session.relationshipDossier?.trim() ? "查看了人物关系档案。" : "查看人物关系档案，目前为空。";
  return {
    session: pushArtifact(ctx.session, makeArtifact("查看", "dossier", summary, data, ctx.createdTurn, 3)),
    result: { name: "查看", success: true, data, notice: summary },
  };
}

function readNotebook(ctx: HandlerCtx): HandlerOutput {
  const data = ctx.session.writerNotebook?.trim() || "当前作品笔记本为空。";
  const summary = ctx.session.writerNotebook?.trim() ? "查看了作品笔记本。" : "查看作品笔记本，目前为空。";
  return {
    session: pushArtifact(ctx.session, makeArtifact("查看", "notebook", summary, data, ctx.createdTurn, 3)),
    result: { name: "查看", success: true, data, notice: summary },
  };
}

function makeSnippet(source: string, index: number, keyword: string): string {
  const start = Math.max(0, index - 80);
  const end = Math.min(source.length, index + keyword.length + 120);
  return source.slice(start, end).replace(/\s+/g, " ").trim();
}

function runSearch(ctx: HandlerCtx, resolved: ResolvedPath, keyword: string, args: Record<string, unknown>): HandlerOutput {
  const limit = numericArg(args, "limit", 8, 1, 20);
  const lowerKeyword = keyword.toLocaleLowerCase();
  const hits: string[] = [];

  const pushHits = (label: string, source: string) => {
    let cursor = 0;
    const lowerSource = source.toLocaleLowerCase();
    while (hits.length < limit) {
      const index = lowerSource.indexOf(lowerKeyword, cursor);
      if (index < 0) break;
      hits.push(`${label}：${makeSnippet(source, index, keyword)}`);
      cursor = index + Math.max(keyword.length, 1);
    }
  };

  if (resolved.kind === "chapter-index" || resolved.kind === "chapter" || resolved.kind === "chapter-body") {
    const chapters = resolved.kind === "chapter-index"
      ? ctx.session.chapters
      : resolved.chapter ? [resolved.chapter] : [];
    for (const chapter of chapters) {
      if (hits.length >= limit) break;
      const parts = resolved.kind === "chapter-body"
        ? [getChapterBody(chapter)]
        : [chapter.title, chapter.titleEn, chapter.summary || "", getChapterBody(chapter)];
      pushHits(`第 ${chapter.num} 章《${chapter.title}》`, parts.filter(Boolean).join("\n\n"));
    }
  } else if (resolved.kind === "notebook") {
    pushHits("笔记本", ctx.session.writerNotebook?.trim() || "");
  } else if (resolved.kind === "relationship") {
    pushHits("人物关系", ctx.session.relationshipDossier?.trim() || "");
  } else if (resolved.kind === "cast-index" || resolved.kind === "cast") {
    const members = resolved.kind === "cast-index" ? ctx.session.cast : resolved.member ? [resolved.member] : [];
    for (const member of members) {
      if (hits.length >= limit) break;
      pushHits(`角色「${member.name}」`, formatCastDoc(member, { revealSecret: false }));
    }
  } else {
    return { session: ctx.session, result: fail("查看", `路径「${describePath(resolved)}」不支持检索。`) };
  }

  const data = hits.length > 0 ? hits.join("\n\n") : `没有检索到关键词「${keyword}」。`;
  const summary = `在「${describePath(resolved)}」检索「${keyword}」，命中 ${hits.length} 条。`;
  return {
    session: pushArtifact(ctx.session, makeArtifact("查看", "search", summary, data, ctx.createdTurn, 3)),
    result: { name: "查看", success: true, data, notice: summary },
  };
}

// ── 追加 ─────────────────────────────────────────────────────────────────────

function handle追加(ctx: HandlerCtx, args: Record<string, unknown>): HandlerOutput {
  const path = stringArg(args, ["path", "目标", "位置"], 200);
  if (!path) return { session: ctx.session, result: fail("追加", "缺少 path。") };
  const content = stringArg(args, ["content", "text", "正文", "内容"], 12000);
  if (!content) return { session: ctx.session, result: fail("追加", "缺少 content。") };
  const resolved = resolvePath(ctx.session, path);
  if (resolved.kind === "invalid") return { session: ctx.session, result: fail("追加", resolved.reason) };

  if (resolved.kind === "chapter-body") {
    if (!resolved.chapter) return { session: ctx.session, result: fail("追加", `第 ${resolved.num} 章不存在。`) };
    const current = getChapterBody(resolved.chapter);
    const next = current ? `${current}\n\n${content}` : content;
    return applyChapterContentChange(ctx, resolved.chapter, next, `追加：第 ${resolved.chapter.num} 章新增约 ${countTextWords(content)} 字正文。`, content);
  }
  if (resolved.kind === "notebook") {
    const current = ctx.session.writerNotebook?.trim() || "";
    const next = current ? `${current}\n\n${content}` : content;
    return applyNotebookChange(ctx, next, `追加：作品笔记本新增约 ${countTextWords(content)} 字。`, content);
  }
  if (resolved.kind === "relationship") {
    const current = ctx.session.relationshipDossier?.trim() || "";
    const next = current ? `${current}\n\n${content}` : content;
    return applyDossierChange(ctx, next, `追加：人物关系档案新增约 ${countTextWords(content)} 字。`, content);
  }
  return { session: ctx.session, result: fail("追加", `「${describePath(resolved)}」不支持追加；只能追加到 章节/<编号>/正文、笔记本 或 人物关系。`) };
}

// ── 编辑 ─────────────────────────────────────────────────────────────────────

function handle编辑(ctx: HandlerCtx, args: Record<string, unknown>): HandlerOutput {
  const path = stringArg(args, ["path", "目标", "位置"], 200);
  if (!path) return { session: ctx.session, result: fail("编辑", "缺少 path。") };
  const resolved = resolvePath(ctx.session, path);
  if (resolved.kind === "invalid") return { session: ctx.session, result: fail("编辑", resolved.reason) };

  const newValue = stringArg(args, ["new", "newText", "content", "value", "新文", "新内容"], 30000);
  const oldValue = optionalStringArg(args, ["old", "oldText", "findText", "原文"], 6000);
  const explicitTitle = cleanInline(args["title"] ?? args["标题"], 80) || undefined;

  switch (resolved.kind) {
    case "chapter-index":
    case "cast-index":
      return { session: ctx.session, result: fail("编辑", `「${describePath(resolved)}」是目录，不能直接编辑。`) };
    case "chapter":
      return editChapterDoc(ctx, resolved, oldValue, newValue, explicitTitle);
    case "chapter-body":
      return editChapterBody(ctx, resolved, oldValue, newValue);
    case "chapter-title":
      return editChapterTitle(ctx, resolved, "zh", oldValue, newValue);
    case "chapter-title-en":
      return editChapterTitle(ctx, resolved, "en", oldValue, newValue);
    case "cast":
      return editCast(ctx, resolved, oldValue, newValue);
    case "relationship":
      return editRelationship(ctx, oldValue, newValue);
    case "notebook":
      return editNotebook(ctx, oldValue, newValue);
  }
}

function surgicalReplace(source: string, oldText: string, newText: string): { ok: true; next: string } | { ok: false; reason: string } {
  const found = findUnique(source, oldText);
  if (!found.ok) return { ok: false, reason: `old 在目标中命中 ${found.count} 次，必须唯一命中。` };
  const next = `${source.slice(0, found.index)}${newText}${source.slice(found.index + oldText.length)}`;
  return { ok: true, next };
}

// Models creating a chapter often imitate the doc format that 查看 returns
// (标题：…/状态：…/字数：…/--- separator/body), so metadata lines used to land
// inside the chapter body. Split that header off: 标题/英文标题/摘要 are applied
// to their real fields, derived lines (状态/字数) are dropped.
function parseChapterDocInput(raw: string): { title?: string; titleEn?: string; summary?: string; body: string } {
  const lines = raw.trim().split("\n");
  const meta: Record<string, string> = {};
  const metaRe = /^(标题|英文标题|状态|字数|摘要)\s*[:：]\s*(.*)$/;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) { i += 1; continue; }
    const match = metaRe.exec(line);
    if (!match) break;
    meta[match[1]] = match[2].trim();
    i += 1;
  }
  if (Object.keys(meta).length === 0) return { body: raw.trim() };
  while (i < lines.length && (lines[i].trim() === "" || /^-{3,}$/.test(lines[i].trim()))) i += 1;
  const summary = meta["摘要"] && !/^[(（]暂无[)）]$/.test(meta["摘要"]) ? meta["摘要"] : undefined;
  return {
    title: meta["标题"] || undefined,
    titleEn: meta["英文标题"] || undefined,
    summary,
    body: lines.slice(i).join("\n").trim(),
  };
}

function editChapterDoc(
  ctx: HandlerCtx,
  resolved: Extract<ResolvedPath, { kind: "chapter" }>,
  oldValue: string | undefined,
  newValue: string,
  explicitTitle?: string,
): HandlerOutput {
  if (!resolved.chapter) {
    if (!newValue) return { session: ctx.session, result: fail("编辑", "创建新章节时 new 不能为空。") };
    const num = resolved.num || normalizeChapterNum(String(ctx.session.chapters.length + 1));
    if (findChapterByNum(ctx.session, num)) return { session: ctx.session, result: fail("编辑", `第 ${num} 章已存在。`) };
    const doc = parseChapterDocInput(newValue);
    const content = doc.body;
    if (!content) return { session: ctx.session, result: fail("编辑", "创建新章节时正文不能为空（标题请用 title 参数或 章节/<编号>/标题）。") };
    const chapter: CoCreateChapter = {
      id: createId("chapter"),
      num,
      title: explicitTitle || doc.title || "未命名章节",
      titleEn: doc.titleEn || `CHAPTER ${num}`,
      ...(doc.summary ? { summary: doc.summary } : {}),
      words: countTextWords(content),
      content,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    const summary = `新建第 ${num} 章，约 ${chapter.words} 字。`;
    return commitMutation(ctx, "编辑", summary,
      { type: "create_chapter", chapter },
      {
        immediateApply: (session) => ({ ...session, chapters: [...session.chapters, chapter], activeChapterId: session.activeChapterId || chapter.id }),
        previewBefore: "(新章节)",
        previewAfter: makePreview(formatChapterDoc(chapter), 600),
        artifactType: "mutation",
      });
  }

  return { session: ctx.session, result: fail("编辑", "编辑整章请改用 章节/<编号>/正文 或 章节/<编号>/标题；查看整章请用 查看。") };
}

function editChapterBody(
  ctx: HandlerCtx,
  resolved: Extract<ResolvedPath, { kind: "chapter-body" }>,
  oldValue: string | undefined,
  newValue: string,
): HandlerOutput {
  if (!resolved.chapter) return { session: ctx.session, result: fail("编辑", `第 ${resolved.num} 章不存在。`) };
  const current = getChapterBody(resolved.chapter);
  let nextContent: string;
  let summary: string;
  let previewBefore = "";
  let previewAfter = "";

  if (oldValue == null || oldValue === "") {
    nextContent = newValue.trim();
    summary = `覆写：第 ${resolved.chapter.num} 章正文，约 ${countTextWords(nextContent)} 字。`;
    previewBefore = makePreview(current || "(空)");
    previewAfter = makePreview(nextContent);
  } else {
    if (!current) return { session: ctx.session, result: fail("编辑", `第 ${resolved.num} 章还没有正文，无法精准替换。`) };
    const replaced = surgicalReplace(current, oldValue, newValue);
    if (!replaced.ok) return { session: ctx.session, result: fail("编辑", replaced.reason) };
    nextContent = replaced.next.trim();
    summary = newValue === ""
      ? `删除：第 ${resolved.chapter.num} 章一处文本，约 ${countTextWords(oldValue)} 字。`
      : `编辑：第 ${resolved.chapter.num} 章一处文本。`;
    previewBefore = makePreview(oldValue);
    previewAfter = newValue ? makePreview(newValue) : "(删除)";
  }
  return applyChapterContentChange(ctx, resolved.chapter, nextContent, summary, previewAfter, previewBefore);
}

function applyChapterContentChange(
  ctx: HandlerCtx,
  chapter: CoCreateChapter,
  nextContent: string,
  summary: string,
  preview?: string,
  before?: string,
): HandlerOutput {
  return commitMutation(ctx, ctxToolName(ctx, summary), summary,
    { type: "set_chapter", chapterId: chapter.id, nextContent },
    {
      chapter,
      immediateApply: (session) => {
        const revision = createChapterRevision(chapter, ctxToolName(ctx, summary), summary, { afterContent: nextContent });
        return updateChapterInSession(session, chapter.id, (item) => ({
          ...item,
          content: nextContent,
          words: countTextWords(nextContent),
          updatedAt: nowIso(),
        }), revision);
      },
      previewBefore: before ?? makePreview(getChapterBody(chapter), 600),
      previewAfter: preview ?? makePreview(nextContent, 600),
      artifactType: "mutation",
    });
}

function ctxToolName(ctx: HandlerCtx, summary: string): string {
  void ctx;
  if (summary.startsWith("追加")) return "追加";
  if (summary.startsWith("删除")) return "删除";
  return "编辑";
}

function editChapterTitle(
  ctx: HandlerCtx,
  resolved: Extract<ResolvedPath, { kind: "chapter-title" | "chapter-title-en" }>,
  lang: "zh" | "en",
  oldValue: string | undefined,
  newValue: string,
): HandlerOutput {
  if (!resolved.chapter) return { session: ctx.session, result: fail("编辑", `第 ${resolved.num} 章不存在。`) };
  const current = lang === "zh" ? resolved.chapter.title : resolved.chapter.titleEn;
  let nextValue: string;
  if (oldValue == null || oldValue === "") {
    nextValue = newValue.trim();
  } else {
    const replaced = surgicalReplace(current, oldValue, newValue);
    if (!replaced.ok) return { session: ctx.session, result: fail("编辑", replaced.reason) };
    nextValue = replaced.next.trim();
  }
  if (!nextValue) return { session: ctx.session, result: fail("编辑", "标题不能为空。") };
  const summary = `编辑：第 ${resolved.chapter.num} 章${lang === "zh" ? "标题" : "英文标题"} 改为「${nextValue}」。`;
  const operation: CoCreatePendingMutationOperation = lang === "zh"
    ? { type: "set_chapter", chapterId: resolved.chapter.id, nextTitle: nextValue }
    : { type: "set_chapter", chapterId: resolved.chapter.id, nextTitleEn: nextValue };
  const chapter = resolved.chapter;
  return commitMutation(ctx, "编辑", summary, operation, {
    chapter,
    immediateApply: (session) => {
      const revision = createChapterRevision(chapter, "编辑", summary, lang === "zh" ? { afterTitle: nextValue } : { afterTitleEn: nextValue });
      return updateChapterInSession(session, chapter.id, (item) => ({
        ...item,
        title: lang === "zh" ? nextValue : item.title,
        titleEn: lang === "en" ? nextValue : item.titleEn,
        updatedAt: nowIso(),
      }), revision);
    },
    previewBefore: current,
    previewAfter: nextValue,
    artifactType: "mutation",
  });
}

function editCast(
  ctx: HandlerCtx,
  resolved: Extract<ResolvedPath, { kind: "cast" }>,
  oldValue: string | undefined,
  newValue: string,
): HandlerOutput {
  // Existing member → update
  if (resolved.member) {
    let nextDoc: string;
    if (oldValue == null || oldValue === "") {
      nextDoc = newValue;
    } else {
      const currentDoc = formatCastDoc(resolved.member, { revealSecret: true });
      const replaced = surgicalReplace(currentDoc, oldValue, newValue);
      if (!replaced.ok) return { session: ctx.session, result: fail("编辑", replaced.reason) };
      nextDoc = replaced.next;
    }
    const nextMember = parseCastDoc(nextDoc, resolved.member);
    if (!nextMember.name) return { session: ctx.session, result: fail("编辑", "更新后角色姓名为空。") };
    if (nextMember.name !== resolved.member.name && ctx.session.cast.some((item) => item.id !== resolved.member!.id && item.name === nextMember.name)) {
      return { session: ctx.session, result: fail("编辑", `已存在同名角色「${nextMember.name}」。`) };
    }
    const summary = `编辑：角色「${resolved.member.name}」档案。`;
    return commitMutation(ctx, "编辑", summary,
      { type: "set_cast", memberId: resolved.member.id, nextMember },
      {
        immediateApply: (session) => ({
          ...session,
          cast: session.cast.map((item) => (item.id === resolved.member!.id ? nextMember : item)),
        }),
        previewBefore: makePreview(formatCastDoc(resolved.member, { revealSecret: true }), 600),
        previewAfter: makePreview(formatCastDoc(nextMember, { revealSecret: true }), 600),
        artifactType: "mutation",
      });
  }

  // Member doesn't exist → create
  if (!newValue.trim()) return { session: ctx.session, result: fail("编辑", "新建角色档案时 new 不能为空。") };
  const seed: CoCreateCastMember = {
    id: createId("cocreate_cast"),
    name: resolved.name,
    nameEn: createAutoCastCode(resolved.name),
    role: "未设定身份",
    color: "#d4c5a0",
    major: "—",
    label: "未命名标签",
    desc: "暂无公开设定。",
    secret: null,
    secretHidden: false,
    tags: [],
  };
  const member = parseCastDoc(newValue, seed);
  if (!member.name) return { session: ctx.session, result: fail("编辑", "角色姓名为空。") };
  if (ctx.session.cast.some((item) => item.name === member.name)) {
    return { session: ctx.session, result: fail("编辑", `已存在同名角色「${member.name}」。`) };
  }
  const summary = `新建：角色档案「${member.name}」。`;
  return commitMutation(ctx, "编辑", summary,
    { type: "create_cast", member },
    {
      immediateApply: (session) => ({ ...session, cast: [...session.cast, member] }),
      previewBefore: "(新角色)",
      previewAfter: makePreview(formatCastDoc(member, { revealSecret: true }), 600),
      artifactType: "mutation",
    });
}

function editRelationship(ctx: HandlerCtx, oldValue: string | undefined, newValue: string): HandlerOutput {
  const current = ctx.session.relationshipDossier?.trim() || "";
  let next: string;
  if (oldValue == null || oldValue === "") {
    next = newValue.trim();
  } else {
    if (!current) return { session: ctx.session, result: fail("编辑", "人物关系档案为空。") };
    const replaced = surgicalReplace(current, oldValue, newValue);
    if (!replaced.ok) return { session: ctx.session, result: fail("编辑", replaced.reason) };
    next = replaced.next.trim();
  }
  const summary = `编辑：人物关系档案，约 ${countTextWords(next)} 字。`;
  return applyDossierChange(ctx, next, summary, next, current);
}

function editNotebook(ctx: HandlerCtx, oldValue: string | undefined, newValue: string): HandlerOutput {
  const current = ctx.session.writerNotebook?.trim() || "";
  let next: string;
  if (oldValue == null || oldValue === "") {
    next = newValue.trim();
  } else {
    if (!current) return { session: ctx.session, result: fail("编辑", "作品笔记本为空。") };
    const replaced = surgicalReplace(current, oldValue, newValue);
    if (!replaced.ok) return { session: ctx.session, result: fail("编辑", replaced.reason) };
    next = replaced.next.trim();
  }
  const summary = `编辑：作品笔记本，约 ${countTextWords(next)} 字。`;
  return applyNotebookChange(ctx, next, summary, next, current);
}

function applyDossierChange(
  ctx: HandlerCtx,
  next: string,
  summary: string,
  preview?: string,
  before?: string,
): HandlerOutput {
  return commitMutation(ctx, ctxToolName(ctx, summary), summary,
    { type: "set_dossier", content: next },
    {
      immediateApply: (session) => ({ ...session, relationshipDossier: next }),
      previewBefore: before ?? makePreview(ctx.session.relationshipDossier || "(空)"),
      previewAfter: makePreview(preview ?? next),
      artifactType: "dossier",
    });
}

function applyNotebookChange(
  ctx: HandlerCtx,
  next: string,
  summary: string,
  preview?: string,
  before?: string,
): HandlerOutput {
  return commitMutation(ctx, ctxToolName(ctx, summary), summary,
    { type: "set_notebook", content: next },
    {
      immediateApply: (session) => ({ ...session, writerNotebook: next }),
      previewBefore: before ?? makePreview(ctx.session.writerNotebook || "(空)"),
      previewAfter: makePreview(preview ?? next),
      artifactType: "notebook",
    });
}

// ── 删除 ─────────────────────────────────────────────────────────────────────

function handle删除(ctx: HandlerCtx, args: Record<string, unknown>): HandlerOutput {
  const path = stringArg(args, ["path", "目标", "位置"], 200);
  if (!path) return { session: ctx.session, result: fail("删除", "缺少 path。") };
  const resolved = resolvePath(ctx.session, path);
  if (resolved.kind === "invalid") return { session: ctx.session, result: fail("删除", resolved.reason) };

  switch (resolved.kind) {
    case "chapter-index":
    case "cast-index":
      return { session: ctx.session, result: fail("删除", `不能删除「${describePath(resolved)}」整个目录。`) };
    case "chapter": {
      if (!resolved.chapter) return { session: ctx.session, result: fail("删除", `第 ${resolved.num} 章不存在。`) };
      const chapter = resolved.chapter;
      const summary = `删除：第 ${chapter.num} 章《${chapter.title}》。`;
      return commitMutation(ctx, "删除", summary,
        { type: "delete_chapter", chapterId: chapter.id },
        {
          chapter,
          immediateApply: (session) => {
            const remaining = reindexCoCreateChapters(session.chapters.filter((item) => item.id !== chapter.id));
            return {
              ...session,
              chapters: remaining,
              revisions: session.revisions.filter((rev) => rev.chapterId !== chapter.id),
              toolArtifacts: session.toolArtifacts.filter((artifact) => artifact.chapterId !== chapter.id),
              activeChapterId: session.activeChapterId === chapter.id
                ? remaining[0]?.id || ""
                : session.activeChapterId,
            };
          },
          previewBefore: makePreview(formatChapterDoc(chapter), 600),
          previewAfter: "(删除)",
          artifactType: "mutation",
        });
    }
    case "chapter-body":
      if (!resolved.chapter) return { session: ctx.session, result: fail("删除", `第 ${resolved.num} 章不存在。`) };
      return applyChapterContentChange(ctx, resolved.chapter, "", `清空：第 ${resolved.chapter.num} 章正文。`, "(已清空)");
    case "chapter-title":
    case "chapter-title-en":
      return { session: ctx.session, result: fail("删除", "标题不能为空，请使用「编辑」改写标题。") };
    case "cast": {
      if (!resolved.member) return { session: ctx.session, result: fail("删除", `角色「${resolved.name}」不存在。`) };
      const member = resolved.member;
      const summary = `删除：角色档案「${member.name}」。`;
      return commitMutation(ctx, "删除", summary,
        { type: "delete_cast", memberId: member.id },
        {
          immediateApply: (session) => ({ ...session, cast: session.cast.filter((item) => item.id !== member.id) }),
          previewBefore: makePreview(formatCastDoc(member, { revealSecret: true }), 600),
          previewAfter: "(删除)",
          artifactType: "mutation",
        });
    }
    case "relationship":
      return applyDossierChange(ctx, "", "清空：人物关系档案。", "(已清空)");
    case "notebook":
      return applyNotebookChange(ctx, "", "清空：作品笔记本。", "(已清空)");
  }
}

function handle切换(ctx: HandlerCtx, args: Record<string, unknown>): HandlerOutput {
  const path = stringArg(args, ["path", "目标", "位置"], 200);
  if (!path) return { session: ctx.session, result: fail("切换", "缺少 path。") };
  const resolved = resolvePath(ctx.session, path);
  if (resolved.kind === "invalid") return { session: ctx.session, result: fail("切换", resolved.reason) };
  if (resolved.kind !== "chapter"
    && resolved.kind !== "chapter-body"
    && resolved.kind !== "chapter-title"
    && resolved.kind !== "chapter-title-en") {
    return { session: ctx.session, result: fail("切换", `只能切换章节路径，不能切换到「${describePath(resolved)}」。`) };
  }
  if (!resolved.chapter) {
    return { session: ctx.session, result: fail("切换", `第 ${resolved.num} 章不存在。`) };
  }
  const chapter = resolved.chapter;
  if (ctx.session.activeChapterId === chapter.id) {
    return {
      session: ctx.session,
      result: {
        name: "切换",
        success: true,
        data: `已是当前章节：第 ${chapter.num} 章《${chapter.title}》。`,
        notice: `已是当前章节：第 ${chapter.num} 章。`,
      },
    };
  }
  const nextSession: CoCreateSession = { ...ctx.session, activeChapterId: chapter.id };
  return {
    session: nextSession,
    result: {
      name: "切换",
      success: true,
      data: `当前编辑章节已切换到第 ${chapter.num} 章《${chapter.title}》。`,
      notice: `切换到第 ${chapter.num} 章《${chapter.title}》。`,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// commit pipeline: autoAccept → 立即落地 + revision；否则 → pending 队列
// ─────────────────────────────────────────────────────────────────────────────

function commitMutation(
  ctx: HandlerCtx,
  toolName: string,
  summary: string,
  operation: CoCreatePendingMutationOperation,
  options: {
    chapter?: CoCreateChapter | null;
    immediateApply: (session: CoCreateSession) => CoCreateSession;
    previewBefore?: string;
    previewAfter?: string;
    artifactType: CoCreateToolArtifactType;
  },
): HandlerOutput {
  if (ctx.autoAccept) {
    const applied = options.immediateApply(ctx.session);
    const artifact = makeArtifact(toolName, options.artifactType, summary, summary, ctx.createdTurn, 4, options.chapter?.id);
    return {
      session: pushArtifact(applied, artifact),
      result: { name: toolName, success: true, data: summary, notice: summary, artifact },
    };
  }

  const mutation = makePendingMutation(toolName, summary, operation, {
    chapter: options.chapter ?? null,
    beforePreview: options.previewBefore,
    afterPreview: options.previewAfter,
  });
  const queued = queuePendingMutation(ctx.session, mutation);
  const artifact = makeArtifact(toolName, options.artifactType, summary, summary, ctx.createdTurn, 4, options.chapter?.id);
  return {
    session: pushArtifact(queued, artifact),
    result: {
      name: toolName,
      success: true,
      data: `${summary} 用户确认后才会应用。`,
      notice: summary,
      artifact,
      pendingMutation: mutation,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispatcher
// ─────────────────────────────────────────────────────────────────────────────

export function executeCoCreateToolCalls(
  session: CoCreateSession,
  toolCalls: CoCreateToolCall[],
  createdTurn: number,
  disabledToolNames: string[] = [],
  options?: { autoAccept?: boolean },
): { session: CoCreateSession; results: CoCreateToolResult[]; resultContent: string; notices: string[] } {
  let working = session;
  const autoAccept = options?.autoAccept ?? session.settings?.autoAccept ?? true;
  const results: CoCreateToolResult[] = [];

  for (const call of toolCalls) {
    const verb = canonicalToolName(call.name);
    if (!VERB_SET.has(verb)) {
      results.push({ name: call.name, success: false, error: `未知动作「${call.name}」，只支持：查看 / 追加 / 编辑 / 删除 / 切换。`, notice: `动作执行失败：${call.name} 不存在。` });
      continue;
    }
    if (!isCoCreateToolEnabled(verb, disabledToolNames)) {
      results.push({ name: verb, success: false, error: "该动作已在设置中关闭。", notice: `动作执行失败：${verb} 已关闭。` });
      continue;
    }
    const ctx: HandlerCtx = { session: working, createdTurn, autoAccept };
    let output: HandlerOutput;
    switch (verb) {
      case "查看": output = handle查看(ctx, call.args); break;
      case "追加": output = handle追加(ctx, call.args); break;
      case "编辑": output = handle编辑(ctx, call.args); break;
      case "删除": output = handle删除(ctx, call.args); break;
      case "切换": output = handle切换(ctx, call.args); break;
      default:
        output = { session: working, result: fail(verb, "未实现的动作。") };
    }
    working = output.session;
    results.push(output.result);
  }

  const resultContent = [
    "<cocreate_action_results>",
    ...results.map((result) => [
      `<action_result name="${result.name}" success="${result.success ? "true" : "false"}">`,
      result.success ? result.data || result.notice : result.error || result.notice,
      "</action_result>",
    ].join("\n")),
    "</cocreate_action_results>",
    "继续。判断下一步：",
    "- 如果还需要再调一个动作（来完成用户原本的请求），只能再写一句极简过渡（≤30 字，如「我去看一下原文」），然后直接调用；也可以不写过渡直接调用。",
    "- 如果不再需要动作，再写完整的用户回应（正文创作 / 讨论反馈）。",
    "禁止：在中间轮（仍要调用动作时）写长段解释、复述刚才做过什么、汇报已完成、列计划。",
    "禁止：复述本次的 XML 标签或动作结果原文。",
    autoAccept
      ? "禁止：再次输出和这一轮完全相同的动作指令，除非还需要补查或确实是不同参数。"
      : "当前为「每个确认」模式：写动作不会立即生效，需要在最终轮提醒用户确认或取消。",
  ].join("\n");

  return {
    session: working,
    results,
    resultContent: cleanText(resultContent, MAX_TOOL_RESULT_LENGTH * 2),
    notices: results.map((result) => result.notice),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pending mutation apply / discard
// ─────────────────────────────────────────────────────────────────────────────

function removePendingMutation(session: CoCreateSession, mutationId: string): CoCreateSession {
  return {
    ...session,
    pendingMutations: session.pendingMutations.filter((mutation) => mutation.id !== mutationId),
  };
}

export function discardCoCreatePendingMutation(session: CoCreateSession, mutationId: string): CoCreateSession {
  return removePendingMutation(session, mutationId);
}

export function applyCoCreatePendingMutation(
  session: CoCreateSession,
  mutationId: string,
): { session: CoCreateSession; success: boolean; notice: string; error?: string } {
  const mutation = session.pendingMutations.find((item) => item.id === mutationId);
  if (!mutation) return { session, success: false, notice: "待确认修改不存在。", error: "待确认修改不存在。" };

  const baseSession = removePendingMutation(session, mutationId);
  const op = mutation.operation;

  if (op.type === "create_chapter") {
    if (baseSession.chapters.some((item) => item.id === op.chapter.id || normalizeChapterNum(item.num) === normalizeChapterNum(op.chapter.num))) {
      return { session: baseSession, success: false, notice: `新建失败：第 ${op.chapter.num} 章已存在。`, error: "目标章节已存在。" };
    }
    return {
      session: { ...baseSession, chapters: [...baseSession.chapters, op.chapter], activeChapterId: baseSession.activeChapterId || op.chapter.id },
      success: true,
      notice: `已新建第 ${op.chapter.num} 章。`,
    };
  }
  if (op.type === "delete_chapter") {
    const chapter = baseSession.chapters.find((item) => item.id === op.chapterId);
    if (!chapter) return { session: baseSession, success: false, notice: "删除失败：目标章节不存在。", error: "目标章节不存在。" };
    const remaining = reindexCoCreateChapters(baseSession.chapters.filter((item) => item.id !== chapter.id));
    return {
      session: {
        ...baseSession,
        chapters: remaining,
        revisions: baseSession.revisions.filter((rev) => rev.chapterId !== chapter.id),
        toolArtifacts: baseSession.toolArtifacts.filter((artifact) => artifact.chapterId !== chapter.id),
        activeChapterId: baseSession.activeChapterId === chapter.id
          ? remaining[0]?.id || ""
          : baseSession.activeChapterId,
      },
      success: true,
      notice: `已删除第 ${chapter.num} 章。`,
    };
  }
  if (op.type === "set_chapter") {
    const chapter = baseSession.chapters.find((item) => item.id === op.chapterId);
    if (!chapter) return { session: baseSession, success: false, notice: "应用失败：目标章节不存在。", error: "目标章节不存在。" };
    const nextTitle = op.nextTitle ?? chapter.title;
    const nextTitleEn = op.nextTitleEn ?? chapter.titleEn;
    const nextContent = op.nextContent ?? chapter.content;
    const revision = createChapterRevision(chapter, "编辑", mutation.summary, {
      afterTitle: op.nextTitle,
      afterTitleEn: op.nextTitleEn,
      afterContent: op.nextContent,
    });
    return {
      session: updateChapterInSession(baseSession, chapter.id, (item) => ({
        ...item,
        title: nextTitle,
        titleEn: nextTitleEn,
        content: nextContent,
        words: nextContent == null ? item.words : countTextWords(nextContent),
        updatedAt: nowIso(),
      }), revision),
      success: true,
      notice: mutation.summary,
    };
  }
  if (op.type === "create_cast") {
    if (baseSession.cast.some((item) => item.name === op.member.name)) {
      return { session: baseSession, success: false, notice: `新建失败：已存在角色「${op.member.name}」。`, error: "同名角色已存在。" };
    }
    return {
      session: { ...baseSession, cast: [...baseSession.cast, op.member] },
      success: true,
      notice: `已新建角色档案：${op.member.name}。`,
    };
  }
  if (op.type === "delete_cast") {
    const member = baseSession.cast.find((item) => item.id === op.memberId);
    if (!member) return { session: baseSession, success: false, notice: "删除失败：目标角色不存在。", error: "目标角色不存在。" };
    return {
      session: { ...baseSession, cast: baseSession.cast.filter((item) => item.id !== member.id) },
      success: true,
      notice: `已删除角色档案：${member.name}。`,
    };
  }
  if (op.type === "set_cast") {
    const member = baseSession.cast.find((item) => item.id === op.memberId);
    if (!member) return { session: baseSession, success: false, notice: "应用失败：目标角色不存在。", error: "目标角色不存在。" };
    if (op.nextMember.name !== member.name && baseSession.cast.some((item) => item.id !== member.id && item.name === op.nextMember.name)) {
      return { session: baseSession, success: false, notice: `应用失败：已存在同名角色「${op.nextMember.name}」。`, error: "同名角色已存在。" };
    }
    return {
      session: { ...baseSession, cast: baseSession.cast.map((item) => (item.id === member.id ? op.nextMember : item)) },
      success: true,
      notice: `已更新角色档案：${op.nextMember.name}。`,
    };
  }
  if (op.type === "set_dossier") {
    return { session: { ...baseSession, relationshipDossier: op.content }, success: true, notice: "人物关系档案已更新。" };
  }
  if (op.type === "set_notebook") {
    return { session: { ...baseSession, writerNotebook: op.content }, success: true, notice: "作品笔记本已更新。" };
  }

  return { session: baseSession, success: false, notice: "未知的待确认操作类型。", error: "未知的待确认操作类型。" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rollback (chapter only)
// ─────────────────────────────────────────────────────────────────────────────

export function rollbackCoCreateRevision(
  session: CoCreateSession,
  revisionId: string,
): { session: CoCreateSession; success: boolean; notice: string; error?: string } {
  const revision = session.revisions.find((item) => item.id === revisionId);
  if (!revision) return { session, success: false, notice: "修订记录不存在。", error: "修订记录不存在。" };
  const chapter = session.chapters.find((item) => item.id === revision.chapterId);
  if (!chapter) return { session, success: false, notice: "目标章节不存在，无法回滚。", error: "目标章节不存在。" };

  const nextSession = updateChapterInSession({
    ...session,
    revisions: session.revisions.filter((item) => item.id !== revisionId),
  }, chapter.id, (item) => ({
    ...item,
    title: revision.beforeTitle || item.title,
    titleEn: revision.beforeTitleEn || item.titleEn,
    content: revision.beforeContent ?? item.content,
    words: revision.beforeContent == null ? item.words : countTextWords(revision.beforeContent),
    updatedAt: nowIso(),
  }));
  return { session: nextSession, success: true, notice: `已回滚：${revision.summary}` };
}

// ─────────────────────────────────────────────────────────────────────────────
// Parser (JSON-only inline syntax)
// ─────────────────────────────────────────────────────────────────────────────

export function parseCoCreateToolCalls(text: string): { cleanText: string; toolCalls: CoCreateToolCall[] } {
  const flow = parseCoCreateToolFlow(text);
  return { cleanText: flow.cleanText, toolCalls: flow.toolCalls };
}

export function parseCoCreateToolFlow(text: string): {
  cleanText: string;
  toolCalls: CoCreateToolCall[];
  segments: CoCreateToolFlowSegment[];
} {
  const toolCalls: CoCreateToolCall[] = [];
  const segments: CoCreateToolFlowSegment[] = [];
  let cursor = 0;
  let lastIndex = 0;

  while (cursor < text.length) {
    const startToken = findActionToken(text, cursor);
    if (!startToken) break;

    const before = text.slice(lastIndex, startToken.start).replace(/\n{3,}/g, "\n\n").trim();
    if (before) segments.push({ type: "text", content: before });

    const block = text.slice(startToken.start, startToken.end);
    const call = parseInlineActionBlock(block);
    if (call) {
      toolCalls.push(call);
      segments.push({ type: "tools", toolCalls: [call] });
    } else {
      segments.push({ type: "text", content: block });
    }
    lastIndex = startToken.end;
    cursor = startToken.end;
  }
  const after = text.slice(lastIndex).replace(/\n{3,}/g, "\n\n").trim();
  if (after) segments.push({ type: "text", content: after });

  const cleanText = segments
    .filter((segment): segment is Extract<CoCreateToolFlowSegment, { type: "text" }> => segment.type === "text")
    .map((segment) => segment.content)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { cleanText, toolCalls, segments };
}

function findActionToken(text: string, from: number): { start: number; end: number } | null {
  const pattern = /\[[^\[\]]{0,40}?(?:执行动作|工具调用)\s*[:：]/g;
  pattern.lastIndex = from;
  const match = pattern.exec(text);
  if (!match) return null;
  const start = match.index;
  // Walk forward to find the matching `]` that closes this block, respecting JSON braces/strings.
  let inString = false;
  let escaped = false;
  let bracketDepth = 0;
  let braceDepth = 0;
  let parenDepth = 0;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (ch === "\"") inString = false;
      continue;
    }
    if (ch === "\"") { inString = true; continue; }
    if (ch === "{") braceDepth += 1;
    else if (ch === "}") braceDepth = Math.max(0, braceDepth - 1);
    else if (ch === "(" || ch === "（") parenDepth += 1;
    else if (ch === ")" || ch === "）") parenDepth = Math.max(0, parenDepth - 1);
    else if (ch === "[") bracketDepth += 1;
    else if (ch === "]") {
      bracketDepth -= 1;
      if (bracketDepth === 0 && braceDepth === 0 && parenDepth === 0) {
        return { start, end: i + 1 };
      }
    }
  }
  return null;
}

function parseInlineActionBlock(block: string): CoCreateToolCall | null {
  if (!block.startsWith("[") || !block.endsWith("]")) return null;
  const inner = block.slice(1, -1).trim();
  const actionIdx = Math.max(inner.indexOf("执行动作"), inner.indexOf("工具调用"));
  if (actionIdx < 0) return null;
  const actor = inner.slice(0, actionIdx).trim().replace(/^["'“”]+|["'“”]+$/g, "") || undefined;
  const afterAction = inner.slice(actionIdx).replace(/^(?:执行动作|工具调用)\s*[:：]\s*/, "").trim();
  const parsed = splitNameAndPayload(afterAction);
  if (!parsed.name) return null;
  return {
    name: parsed.name,
    args: parseArgsJson(parsed.payload),
    actor,
  };
}

function splitNameAndPayload(text: string): { name: string; payload: string } {
  const stops = ["(", "（", "{"]
    .map((marker) => text.indexOf(marker))
    .filter((index) => index >= 0);
  const stopIndex = stops.length > 0 ? Math.min(...stops) : -1;
  if (stopIndex >= 0) {
    return { name: text.slice(0, stopIndex).trim().replace(/[:：]\s*$/, ""), payload: text.slice(stopIndex).trim() };
  }
  return { name: text.trim(), payload: "" };
}

function parseArgsJson(payload: string): Record<string, unknown> {
  // Try the payload AS-IS first. Novel content legitimately contains Chinese
  // curly quotes (dialogue) inside string values — that is valid JSON. The old
  // code globally replaced “” with " before parsing, which corrupted those
  // values into unescaped quotes, failed strict parsing, and fell into the
  // loose parser whose catch-path kept \n as literal text in the chapter.
  // Quote replacement is now only a fallback for the case the model actually
  // used curly quotes as JSON delimiters.
  const rawJson = extractJsonObject(payload);
  const replacedJson = extractJsonObject(payload.replace(/[“”]/g, "\"").replace(/[‘’]/g, "'"));
  const candidates: string[] = [];
  for (const candidate of [rawJson, replacedJson, replacedJson.replace(/'/g, "\"")]) {
    if (candidate && !candidates.includes(candidate)) candidates.push(candidate);
  }
  if (candidates.length === 0) return {};
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // try next
    }
  }
  const loose = parseLooseArgs(rawJson || replacedJson);
  if (Object.keys(loose).length > 0) return loose;
  return parseLooseArgs(replacedJson);
}

function extractJsonObject(value: string): string {
  const start = value.indexOf("{");
  if (start < 0) return "";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (char === "\\") { escaped = true; continue; }
      if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") { inString = true; continue; }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return value.slice(start, index + 1);
    }
  }
  return value.slice(start);
}

function parseLooseArgs(value: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const pattern = /"([^"\\]+)"\s*:\s*"([\s\S]*?)"(?=\s*,\s*"[^"\\]+"\s*:|\s*}\s*$)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    try { result[match[1]] = JSON.parse(`"${match[2].replace(/\r?\n/g, "\\n")}"`); }
    catch {
      // Manual unescape so \n etc. never end up as literal text in chapters
      // (JSON.parse rejects values that contain unescaped inner quotes).
      result[match[1]] = match[2].replace(/\\(n|r|t|"|\\)/g, (_, ch: string) =>
        ch === "n" ? "\n" : ch === "r" ? "\r" : ch === "t" ? "\t" : ch);
    }
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt formatter
// ─────────────────────────────────────────────────────────────────────────────

export function formatCoCreateToolsForPrompt(
  disabledToolNames: string[] = [],
  options?: { autoAccept?: boolean; variant?: "write" | "read" },
): string {
  const variant = options?.variant ?? "write";
  const enabledVerbs = new Set(getEnabledCoCreateTools(disabledToolNames).map((tool) => tool.name));
  // Read variant only ever exposes the 查看 verb.
  const allowedForVariant = variant === "read"
    ? new Set(["查看"])
    : new Set(["查看", "追加", "编辑", "删除", "切换"]);
  const activeVerbs = new Set([...enabledVerbs].filter((verb) => allowedForVariant.has(verb)));

  if (activeVerbs.size === 0) {
    return [
      "<cocreate_actions>",
      "共创动作当前已全部关闭。",
      "不要输出动作指令；请只基于已有上下文自然回复用户。",
      "</cocreate_actions>",
    ].join("\n");
  }

  const lines: string[] = [];
  lines.push("<cocreate_actions>");
  lines.push("你和{{user}}共创一本小说。小说被组织成一个项目目录：");
  lines.push("");
  lines.push("  章节                       目录");
  lines.push("  章节/<编号>                整章只读视图（标题 + 状态 + 字数 + 摘要 + 正文）");
  if (variant === "write") {
    lines.push("  章节/<编号>/正文           纯正文文本");
    lines.push("  章节/<编号>/标题           中文标题");
    lines.push("  章节/<编号>/英文标题       英文标题");
  }
  lines.push("  角色                       目录");
  lines.push("  角色/<姓名>                单个角色档案");
  lines.push("  人物关系                   单文档");
  lines.push("  笔记本                     单文档");
  lines.push("");
  lines.push("动作语法统一为：[执行动作:动词({JSON对象})]");
  lines.push("");
  lines.push("【轮次结构 — 重要】");
  lines.push("一次用户请求可能需要多轮 LLM 调用。每一轮你的输出 = 0~1 句意图过渡 + 0~N 个动作。");
  lines.push("- 中间轮（你这一轮还要调用动作）：只允许极简意图过渡（≤30 字，例如「我去看一下原文」），或者不写过渡直接调用。**禁止解释、复述、汇报已完成、列计划**——这些是把每一轮都当最终回复的常见错误。");
  lines.push("- 最终轮（你不再调用任何动作）：才写完整的用户回应（正文创作 / 讨论反馈 / 询问细节）。");
  lines.push("- 动作结果由系统返回给你，不展示给用户；拿到结果后判断「继续动作」还是「写最终回应」，不要先汇报再下一步。");
  lines.push("");

  if (variant === "write") {
    const mode = options?.autoAccept === false ? "每个确认" : "自动接受";
    const modeNote = options?.autoAccept === false
      ? "当前为「每个确认」模式：所有写动作（追加 / 编辑 / 删除）不会立刻生效，会进入待确认队列，需要提醒用户在 UI 上确认或取消。"
      : "当前为「自动接受」模式：所有写动作（追加 / 编辑 / 删除）立即生效，可由用户回滚（仅章节相关变更）。";
    lines.push(`当前确认模式：${mode}。`);
    lines.push(modeNote);
    lines.push("");
  }

  if (activeVerbs.has("查看")) {
    lines.push("—— 查看 ——");
    lines.push("- {\"path\":\"章节\"}                                      列出章节目录");
    lines.push("- {\"path\":\"章节/03\"}                                   读取第 03 章");
    lines.push("- {\"path\":\"角色\"} / {\"path\":\"角色/角色A\"}             列出角色 / 单个档案");
    lines.push("- {\"path\":\"人物关系\"} / {\"path\":\"笔记本\"}            读取单文档");
    lines.push("- {\"path\":\"章节\",\"keyword\":\"怀表\",\"limit\":8}        在范围内检索关键词");
    lines.push("");
  }
  if (activeVerbs.has("追加")) {
    lines.push("—— 追加 ——");
    lines.push("- {\"path\":\"章节/03/正文\",\"content\":\"新增段落...\"}");
    lines.push("- {\"path\":\"笔记本\",\"content\":\"## 伏笔\\n...\"}");
    lines.push("- {\"path\":\"人物关系\",\"content\":\"...\"}");
    lines.push("");
  }
  if (activeVerbs.has("编辑")) {
    lines.push("—— 编辑 ——");
    lines.push("- 精准替换：{\"path\":\"章节/03/正文\",\"old\":\"唯一原文\",\"new\":\"新文本\"}（old 在 path 中必须唯一命中）");
    lines.push("- 整体覆写：{\"path\":\"章节/03/正文\",\"new\":\"新的完整正文\"}（不传 old）");
    lines.push("- 改标题：  {\"path\":\"章节/03/标题\",\"new\":\"雨夜归人\"}");
    lines.push("- 新建章节：{\"path\":\"章节/04\",\"title\":\"章节标题\",\"new\":\"第四章正文...\"}（path 不存在即创建；title 可选，new 里只写正文，不要写 标题/状态/字数 这类元信息行）");
    lines.push("- 改/建角色：{\"path\":\"角色/角色A\",\"new\":\"身份：配角\\n位置/背景：某个具体地点\\n人物标签：一个可识别的人物标签\\n公开设定：某个可公开的背景信息...\\n暗线设定：（写暗线）\\n暗线隐藏：是\"}");
    lines.push("- 整理关系：{\"path\":\"人物关系\",\"new\":\"...\"}");
    lines.push("- 改笔记：  {\"path\":\"笔记本\",\"old\":\"原段\",\"new\":\"新段\"}");
    lines.push("");
  }
  if (activeVerbs.has("删除")) {
    lines.push("—— 删除（谨慎使用）——");
    lines.push("- {\"path\":\"章节/03\"}         删除整章。破坏性强，请明确用户同意后再执行。");
    lines.push("- {\"path\":\"角色/角色A\"}       删除角色档案。");
    lines.push("- {\"path\":\"章节/03/正文\"}     清空章节正文。");
    lines.push("- {\"path\":\"人物关系\"} / {\"path\":\"笔记本\"}   清空单文档。");
    lines.push("");
  }
  if (activeVerbs.has("切换")) {
    lines.push("—— 切换 ——");
    lines.push("- {\"path\":\"章节/03\"}         把第 03 章设为当前编辑章节。");
    lines.push("- 只接受章节路径；切换不修改任何正文，立即生效。");
    lines.push("");
  }

  lines.push("通用规则：");
  if (variant === "write") {
    lines.push("- 不确定文本位置时，先用「查看」拿到内容再编辑。");
    lines.push("- 编辑时 old 必须能在 path 中唯一命中；不唯一会失败。");
    lines.push("- 新建/更新角色档案：desc 只写公开设定；未揭示的写到 secret，secretHidden 设为 是。");
    lines.push("- 笔记本只在确实影响后续创作时维护，不要每轮都更新。");
  } else {
    lines.push("- 「查看」用于补查讨论中需要参考的章节/角色/关系/笔记本内容；只查需要的部分，避免每轮都查。");
    lines.push("- 关键词检索支持在「章节」「角色」「笔记本」「人物关系」内做模糊匹配。");
  }
  lines.push("- 动作标签只用于系统执行，不要向用户解释标签格式。");
  lines.push("</cocreate_actions>");
  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Artifact lifecycle
// ─────────────────────────────────────────────────────────────────────────────

export function pruneCoCreateToolArtifacts(session: CoCreateSession, currentTurn: number): CoCreateSession {
  return {
    ...session,
    toolTurn: currentTurn,
    toolArtifacts: session.toolArtifacts
      .filter((artifact) => artifact.createdTurn + artifact.expiresAfterTurns >= currentTurn)
      .map((artifact) => artifact.createdTurn < currentTurn ? { ...artifact, rawResult: undefined } : artifact),
  };
}

export function finalizeCoCreateToolArtifacts(session: CoCreateSession): CoCreateSession {
  return {
    ...session,
    toolArtifacts: session.toolArtifacts.map((artifact) => ({ ...artifact, rawResult: undefined })),
  };
}
