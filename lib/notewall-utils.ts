import { jsonrepair } from "jsonrepair";
import { appNowISO } from "./app-clock";
import {
  DEFAULT_NOTE_WALL_BOARD,
  NOTE_WALL_BOARD_ID,
  NOTE_WALL_SIZE_PRESETS,
  type NoteWallBoard,
  type NoteWallComment,
  type NoteWallCommentInput,
  type NoteWallNote,
  type NoteWallNoteInput,
  type NoteWallNotePatch,
  type NoteWallSize,
} from "./notewall-types";

const SAFE_CSS_PROPERTIES = new Set([
  "background",
  "background-color",
  "color",
  "border",
  "border-color",
  "border-style",
  "border-width",
  "border-radius",
  "box-shadow",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "text-align",
  "line-height",
  "letter-spacing",
]);

const FORBIDDEN_CSS_VALUE = /url\s*\(|javascript:|expression\s*\(|behavior\s*:|@import|<|>|\\|position\s*:|display\s*:|z-index\s*:/i;
// ID 为历史遗留名（存量数据+LLM协议依赖）；实际字体为可商用的「字制区喜脉喜欢体」与「鸿雷小纸条青春体」。
const NOTE_WALL_FONT_IDS = new Set(["default", "huangyou", "shangshangqian", "huiwen"]);
const LEGACY_FONT_MAP: Record<string, string> = {
  serif: "huiwen",
  handwritten: "huiwen",
  mono: "shangshangqian",
};
const NOTE_WALL_PAPER_IDS = new Set(["plain", "cream", "pink", "blue", "kraft"]);
const NOTE_WALL_DECORATION_IDS = new Set(["none", "star", "flower", "heart"]);

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, maxLength);
}

function cleanMultilineText(value: unknown, maxLength: number): string {
  return cleanText(value, maxLength)
    .replace(/\r\n?/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n");
}

function normalizeCssProperty(name: string): string {
  return name.trim().toLowerCase().replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

function sanitizeCssValue(property: string, value: string): string | null {
  const v = value.trim().replace(/\s+/g, " ");
  if (!v || v.length > 160 || FORBIDDEN_CSS_VALUE.test(v)) return null;

  if (property === "font-size") {
    const match = /^(\d+(?:\.\d+)?)(px)?$/i.exec(v);
    if (!match) return null;
    const numeric = Math.max(10, Math.min(22, Number(match[1])));
    return `${numeric}px`;
  }

  if (property === "line-height") {
    const numeric = Number(v);
    if (!Number.isFinite(numeric)) return null;
    return String(Math.max(1, Math.min(2.2, numeric)));
  }

  if (property === "letter-spacing") {
    const match = /^(\d+(?:\.\d+)?)(px)?$/i.exec(v);
    if (!match) return null;
    return `${Math.max(0, Math.min(2, Number(match[1])))}px`;
  }

  if (property === "border-radius") {
    const match = /^(\d+(?:\.\d+)?)(px|rem|em|%)?$/i.exec(v);
    if (!match) return null;
    const unit = match[2] ?? "px";
    const max = unit === "%" ? 50 : 18;
    return `${Math.max(0, Math.min(max, Number(match[1])))}${unit}`;
  }

  if (property === "border-width") {
    const match = /^(\d+(?:\.\d+)?)(px)?$/i.exec(v);
    if (!match) return null;
    return `${Math.max(0, Math.min(6, Number(match[1])))}px`;
  }

  if (property === "font-weight") {
    if (/^(normal|bold|lighter|bolder)$/i.test(v)) return v.toLowerCase();
    const numeric = Number(v);
    if (!Number.isFinite(numeric)) return null;
    return String(Math.max(100, Math.min(900, Math.round(numeric / 100) * 100)));
  }

  if (property === "font-style") {
    return /^(normal|italic|oblique)$/i.test(v) ? v.toLowerCase() : null;
  }

  if (property === "text-align") {
    return /^(left|right|center|justify|start|end)$/i.test(v) ? v.toLowerCase() : null;
  }

  return v;
}

export function sanitizeNoteWallCss(rawCss: unknown): Record<string, string> {
  const raw = String(rawCss ?? "").slice(0, 1200);
  if (!raw || /[{}@<>]/.test(raw)) return {};

  const safe: Record<string, string> = {};
  for (const declaration of raw.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon <= 0) continue;
    const property = normalizeCssProperty(declaration.slice(0, colon));
    if (!SAFE_CSS_PROPERTIES.has(property)) continue;
    const value = sanitizeCssValue(property, declaration.slice(colon + 1));
    if (value) safe[property] = value;
  }
  return safe;
}

function sanitizeNoteWallStyleRecord(rawStyle: unknown): Record<string, string> {
  if (!rawStyle || typeof rawStyle !== "object" || Array.isArray(rawStyle)) return {};

  const safe: Record<string, string> = {};
  for (const [rawProperty, rawValue] of Object.entries(rawStyle as Record<string, unknown>)) {
    const property = normalizeCssProperty(rawProperty);
    if (!SAFE_CSS_PROPERTIES.has(property)) continue;
    const value = sanitizeCssValue(property, String(rawValue ?? ""));
    if (value) safe[property] = value;
  }
  return safe;
}

export function normalizeNoteWallSize(size: unknown): NoteWallSize {
  return size === "small" || size === "large" ? size : "medium";
}

export function normalizeNoteWallFont(font: unknown): string {
  const value = cleanText(font ?? "default", 32) || "default";
  if (NOTE_WALL_FONT_IDS.has(value)) return value;
  return LEGACY_FONT_MAP[value] ?? "default";
}

export function normalizeNoteWallPaper(paper: unknown): string {
  const value = cleanText(paper ?? "plain", 32) || "plain";
  return NOTE_WALL_PAPER_IDS.has(value) ? value : "plain";
}

export function normalizeNoteWallDecoration(decoration: unknown): string {
  const value = cleanText(decoration ?? "none", 32) || "none";
  return NOTE_WALL_DECORATION_IDS.has(value) ? value : "none";
}

export function getNoteWallSize(size: unknown): { size: NoteWallSize; width: number; height: number } {
  const normalized = normalizeNoteWallSize(size);
  return { size: normalized, ...NOTE_WALL_SIZE_PRESETS[normalized] };
}

export function normalizeNoteWallBoard(raw: unknown): NoteWallBoard {
  const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return {
    id: cleanText(record.id ?? NOTE_WALL_BOARD_ID, 80) || NOTE_WALL_BOARD_ID,
    title: cleanText(record.title ?? "便签墙", 80) || "便签墙",
    width: clampNumber(record.width, 800, 20000, DEFAULT_NOTE_WALL_BOARD.width),
    height: clampNumber(record.height, 800, 20000, DEFAULT_NOTE_WALL_BOARD.height),
    createdAt: typeof record.created_at === "string" ? record.created_at : undefined,
    updatedAt: typeof record.updated_at === "string" ? record.updated_at : undefined,
  };
}

export function normalizeNoteWallNote(raw: unknown): NoteWallNote | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = cleanText(record.id, 80);
  if (!id) return null;
  const size = normalizeNoteWallSize(record.size);
  const preset = NOTE_WALL_SIZE_PRESETS[size];
  return {
    id,
    boardId: cleanText(record.board_id ?? NOTE_WALL_BOARD_ID, 80) || NOTE_WALL_BOARD_ID,
    authorType: record.author_type === "character" ? "character" : "user",
    authorId: cleanText(record.author_id, 120) || "unknown",
    authorName: record.is_anonymous ? "匿名" : cleanText(record.author_name, 80) || "匿名",
    isAnonymous: Boolean(record.is_anonymous),
    summary: cleanText(record.summary, 180) || "想在这里留一张便签",
    body: cleanText(record.body, 5000),
    x: clampNumber(record.x, 0, 20000, 24),
    y: clampNumber(record.y, 0, 20000, 24),
    width: clampNumber(record.width, 120, 420, preset.width),
    height: clampNumber(record.height, 96, 360, preset.height),
    size,
    paper: normalizeNoteWallPaper(record.paper),
    tape: cleanText(record.tape ?? "none", 32) || "none",
    font: normalizeNoteWallFont(record.font),
    decoration: normalizeNoteWallDecoration(record.decoration),
    rawCss: cleanText(record.raw_css ?? "", 1200),
    safeStyle: sanitizeNoteWallStyleRecord(record.safe_style),
    commentCount: clampNumber(record.comment_count ?? record.commentCount, 0, 100000, 0),
    createdBy: typeof record.created_by === "string" ? record.created_by : undefined,
    updatedBy: typeof record.updated_by === "string" ? record.updated_by : undefined,
    deletedBy: typeof record.deleted_by === "string" ? record.deleted_by : undefined,
    deletedAt: typeof record.deleted_at === "string" ? record.deleted_at : null,
    createdAt: typeof record.created_at === "string" ? record.created_at : appNowISO(),
    updatedAt: typeof record.updated_at === "string" ? record.updated_at : appNowISO(),
  };
}

export function buildNoteWallInsertPayload(input: NoteWallNoteInput): Record<string, unknown> {
  const size = getNoteWallSize(input.size);
  const summary = cleanText(input.summary, 180);
  const body = cleanText(input.body, 5000);
  return {
    board_id: cleanText(input.boardId ?? NOTE_WALL_BOARD_ID, 80) || NOTE_WALL_BOARD_ID,
    author_type: input.authorType === "character" ? "character" : "user",
    author_id: cleanText(input.authorId, 120) || "unknown",
    author_name: cleanText(input.authorName, 80) || "匿名",
    summary: summary || body.slice(0, 48) || "想在这里留一张便签",
    body: body || summary || "……",
    x: clampNumber(input.x, 0, 20000, 24),
    y: clampNumber(input.y, 0, 20000, 24),
    width: size.width,
    height: size.height,
    size: size.size,
    paper: normalizeNoteWallPaper(input.paper),
    tape: cleanText(input.tape ?? "none", 32) || "none",
    font: normalizeNoteWallFont(input.font),
    decoration: normalizeNoteWallDecoration(input.decoration),
    is_anonymous: Boolean(input.isAnonymous),
    raw_css: cleanText(input.rawCss ?? "", 1200),
    safe_style: sanitizeNoteWallCss(input.rawCss),
    created_by: cleanText(input.actorId ?? input.authorId, 120) || "unknown",
  };
}

export function buildNoteWallPatchPayload(input: NoteWallNotePatch): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    updated_at: appNowISO(),
  };
  if (input.summary !== undefined) patch.summary = cleanText(input.summary, 180) || "想在这里留一张便签";
  if (input.body !== undefined) patch.body = cleanText(input.body, 5000) || "……";
  if (input.x !== undefined) patch.x = clampNumber(input.x, 0, 20000, 24);
  if (input.y !== undefined) patch.y = clampNumber(input.y, 0, 20000, 24);
  if (input.size !== undefined) {
    const size = getNoteWallSize(input.size);
    patch.size = size.size;
    patch.width = size.width;
    patch.height = size.height;
  }
  if (input.paper !== undefined) patch.paper = normalizeNoteWallPaper(input.paper);
  if (input.tape !== undefined) patch.tape = cleanText(input.tape, 32) || "none";
  if (input.font !== undefined) patch.font = normalizeNoteWallFont(input.font);
  if (input.decoration !== undefined) patch.decoration = normalizeNoteWallDecoration(input.decoration);
  if (input.isAnonymous !== undefined) patch.is_anonymous = Boolean(input.isAnonymous);
  if (input.rawCss !== undefined) {
    patch.raw_css = cleanText(input.rawCss, 1200);
    patch.safe_style = sanitizeNoteWallCss(input.rawCss);
  }
  if (input.actorId !== undefined) patch.updated_by = cleanText(input.actorId, 120) || undefined;
  return patch;
}

export function normalizeNoteWallComment(raw: unknown): NoteWallComment | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = cleanText(record.id, 80);
  const noteId = cleanText(record.note_id, 80);
  if (!id || !noteId) return null;
  return {
    id,
    noteId,
    authorId: cleanText(record.author_id, 120) || "unknown",
    authorName: record.is_anonymous ? "匿名" : cleanText(record.author_name, 80) || "匿名",
    body: cleanText(record.body, 1200),
    isAnonymous: Boolean(record.is_anonymous),
    createdBy: typeof record.created_by === "string" ? record.created_by : undefined,
    deletedBy: typeof record.deleted_by === "string" ? record.deleted_by : undefined,
    deletedAt: typeof record.deleted_at === "string" ? record.deleted_at : null,
    createdAt: typeof record.created_at === "string" ? record.created_at : appNowISO(),
    updatedAt: typeof record.updated_at === "string" ? record.updated_at : appNowISO(),
  };
}

export function buildNoteWallCommentInsertPayload(input: NoteWallCommentInput): Record<string, unknown> {
  return {
    note_id: cleanText(input.noteId, 80),
    author_id: cleanText(input.authorId, 120) || "unknown",
    author_name: cleanText(input.authorName, 80) || "匿名",
    body: cleanText(input.body, 1200),
    is_anonymous: Boolean(input.isAnonymous),
    created_by: cleanText(input.actorId ?? input.authorId, 120) || "unknown",
  };
}

export function getBoardSizeForNotes(board: NoteWallBoard, notes: NoteWallNote[]): NoteWallBoard {
  let width = Math.max(board.width, DEFAULT_NOTE_WALL_BOARD.width);
  let height = Math.max(board.height, DEFAULT_NOTE_WALL_BOARD.height);
  for (const note of notes) {
    if (note.deletedAt) continue;
    width = Math.max(width, note.x + note.width + 96);
    height = Math.max(height, note.y + note.height + 96);
  }
  return { ...board, width, height };
}

function overlaps(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
  return a.x < b.x + b.width + 16
    && a.x + a.width + 16 > b.x
    && a.y < b.y + b.height + 16
    && a.y + a.height + 16 > b.y;
}

export function findNoteWallPlacement(
  notes: NoteWallNote[],
  board: NoteWallBoard,
  sizeName: NoteWallSize = "medium",
): { x: number; y: number } {
  const size = NOTE_WALL_SIZE_PRESETS[sizeName];
  const active = notes.filter(note => !note.deletedAt);
  const margin = 28;
  const step = 36;
  const maxY = Math.max(board.height - size.height - margin, margin);
  const maxX = Math.max(board.width - size.width - margin, margin);

  for (let y = margin; y <= maxY; y += step) {
    for (let x = margin; x <= maxX; x += step) {
      const candidate = { x, y, width: size.width, height: size.height };
      if (!active.some(note => overlaps(candidate, note))) return { x, y };
    }
  }

  return { x: margin, y: board.height + margin };
}

export type ParsedNoteWallAction = {
  authorName: string;
  summary: string;
  body: string;
  size: NoteWallSize;
  paper: string;
  tape: string;
  font: string;
  rawCss: string;
  isAnonymous: boolean;
};

function normalizeAnonymousChoice(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const text = cleanText(value, 24).toLowerCase();
  return text === "true"
    || text === "1"
    || text === "yes"
    || text === "y"
    || text === "anonymous"
    || text === "匿名";
}

function parseJsonLike(content: string): unknown | null {
  const jsonCandidate = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(jsonCandidate);
  } catch {
    try {
      return JSON.parse(jsonrepair(jsonCandidate));
    } catch {
      return null;
    }
  }
}

function parseNoteWallToolCalls(content: string, expectedName: string): Record<string, unknown>[] {
  const calls: Record<string, unknown>[] = [];
  const pattern = /\[[""\u201C]?([^""\u201D\]]*?)[""\u201D]?\s*(?:执行动作|工具调用)[:：]\s*([^(（\]]+?)\s*[（(]([\s\S]*?)[)）]\]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const name = match[2]?.trim();
    if (name !== expectedName) continue;
    const rawArgs = match[3]?.trim() ?? "";
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(rawArgs);
    } catch {
      try {
        parsed = JSON.parse(jsonrepair(rawArgs.replace(/'/g, "\"")));
      } catch {
        parsed = null;
      }
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      calls.push(parsed as Record<string, unknown>);
    }
  }
  return calls;
}

export function parseNoteWallActionContent(content: string): ParsedNoteWallAction {
  const trimmed = content.trim();
  const noteToolCall = parseNoteWallToolCalls(trimmed, "发送便签")[0];
  const parsed = noteToolCall ?? parseJsonLike(trimmed);

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    const [first, ...rest] = trimmed.split(/\n+/);
    return {
      authorName: "",
      summary: cleanText(first, 80) || "想在这里留一张便签",
      body: cleanMultilineText(rest.join("\n").trim() || trimmed, 3000),
      size: "medium",
      paper: "plain",
      tape: "none",
      font: "default",
      rawCss: "",
      isAnonymous: false,
    };
  }

  const record = parsed as Record<string, unknown>;
  const body = cleanMultilineText(record.body ?? record.full ?? record.content ?? record.text, 3000);
  const summary = cleanText(record.summary ?? record.title ?? record.heading ?? body.slice(0, 48), 80);
  return {
    authorName: cleanText(record.authorName ?? record.author_name ?? record.signature ?? record.name, 80),
    summary: summary || "想在这里留一张便签",
    body: body || summary || "……",
    size: normalizeNoteWallSize(record.size),
    paper: normalizeNoteWallPaper(record.paper),
    tape: cleanText(record.tape ?? "none", 32) || "none",
    font: normalizeNoteWallFont(record.font),
    rawCss: "",
    isAnonymous: normalizeAnonymousChoice(record.isAnonymous ?? record.is_anonymous ?? record.anonymous),
  };
}

export type ParsedNoteWallReply = {
  noteId: string;
  authorName: string;
  body: string;
  isAnonymous: boolean;
};

export function parseNoteWallReplyContent(content: string, allowedNoteIds: readonly string[]): ParsedNoteWallReply[] {
  const allowed = new Set(allowedNoteIds);
  const commentToolCalls = parseNoteWallToolCalls(content, "发送便签评论");
  const parsed = commentToolCalls.length > 0 ? commentToolCalls : parseJsonLike(content);
  let rawReplies: unknown[] = [];

  if (Array.isArray(parsed)) {
    rawReplies = parsed;
  } else if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    const collection = record.replies ?? record.comments ?? record.items;
    if (Array.isArray(collection)) {
      rawReplies = collection;
    } else {
      rawReplies = Object.entries(record).map(([noteId, body]) => ({ noteId, body }));
    }
  }

  const seen = new Set<string>();
  const replies: ParsedNoteWallReply[] = [];
  for (const item of rawReplies) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const noteId = cleanText(record.noteId ?? record.note_id ?? record.id, 120);
    const authorName = cleanText(record.authorName ?? record.author_name ?? record.signature ?? record.name, 80);
    const body = cleanMultilineText(record.body ?? record.reply ?? record.comment ?? record.text, 1200);
    if (!noteId || !allowed.has(noteId) || seen.has(noteId) || !body) continue;
    seen.add(noteId);
    replies.push({
      noteId,
      authorName,
      body,
      isAnonymous: normalizeAnonymousChoice(record.isAnonymous ?? record.is_anonymous ?? record.anonymous),
    });
    if (replies.length >= 5) break;
  }
  return replies;
}
