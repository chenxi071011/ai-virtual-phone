import { kvGet, kvKeysWithPrefix, kvRemove, kvSet, registerDynamicPrefix } from "./kv-db";
import { appNowISO } from "./app-clock";
import { formatChatTimestamp } from "./llm-prompt-assembler";
import type { XiaohongshuComment, XiaohongshuNote } from "./xiaohongshu-types";

const XIAOHONGSHU_EVENT_PREFIX = "ai_phone_xiaohongshu_events_";
const MAX_EVENTS_PER_CHARACTER = 120;

registerDynamicPrefix(XIAOHONGSHU_EVENT_PREFIX);

export type XiaohongshuProjectionEntry = {
  id: string;
  timestamp: string;
  content: string;
  noteId?: string;
  commentId?: string;
};

type RecordXiaohongshuPostEventInput = {
  characterId: string;
  characterName: string;
  note: XiaohongshuNote;
};

type RecordXiaohongshuCommentEventInput = {
  characterId: string;
  characterName: string;
  note: XiaohongshuNote;
  comment: XiaohongshuComment;
  liked?: boolean;
  saved?: boolean;
};

type RecordXiaohongshuReplyEventInput = {
  characterId: string;
  characterName: string;
  note: XiaohongshuNote;
  comment: XiaohongshuComment;
  targetComment?: XiaohongshuComment;
};

type RecordXiaohongshuFollowUserEventInput = {
  characterId: string;
  characterName: string;
  userDisplayName: string;
  timestamp?: string;
};

function storageKey(characterId: string): string {
  return `${XIAOHONGSHU_EVENT_PREFIX}${characterId}`;
}

function cleanEventText(value: unknown, maxLength: number): string {
  const text = String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function formatAuthorLabel(
  authorType: XiaohongshuNote["source"] | XiaohongshuComment["authorType"] | undefined,
  value: unknown,
  fallback: string,
): string {
  const name = cleanEventText(value, 80) || fallback;
  return authorType === "user" ? `“${name}”（用户的小红书账号）` : `“${name}”`;
}

function loadEventsByKey(key: string): XiaohongshuProjectionEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = kvGet(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is XiaohongshuProjectionEntry =>
        entry
        && typeof entry.id === "string"
        && typeof entry.timestamp === "string"
        && typeof entry.content === "string"
      )
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  } catch {
    return [];
  }
}

function loadEvents(characterId: string): XiaohongshuProjectionEntry[] {
  return loadEventsByKey(storageKey(characterId));
}

function saveEventsByKey(key: string, events: XiaohongshuProjectionEntry[]): void {
  if (typeof window === "undefined") return;
  const compacted = [...events]
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .slice(-MAX_EVENTS_PER_CHARACTER);
  kvSet(key, JSON.stringify(compacted));
}

function saveEvents(characterId: string, events: XiaohongshuProjectionEntry[]): void {
  saveEventsByKey(storageKey(characterId), events);
}

function upsertEvent(characterId: string, entry: XiaohongshuProjectionEntry): void {
  const events = loadEvents(characterId);
  const next = events.filter(item => item.id !== entry.id);
  next.push(entry);
  saveEvents(characterId, next);
}

function noteTitle(note: XiaohongshuNote): string {
  return cleanEventText(note.title || note.body.slice(0, 24) || "未命名笔记", 80);
}

function imageText(note: XiaohongshuNote): string {
  if (note.imageDescription?.trim()) return cleanEventText(note.imageDescription, 160);
  if (note.imageAssetId) return "真实图片";
  if (note.videoDescription?.trim()) return cleanEventText(note.videoDescription, 160);
  return "无";
}

function belongsToNote(entry: XiaohongshuProjectionEntry, noteId: string): boolean {
  return entry.noteId === noteId
    || entry.id === `xiaohongshu_post_${noteId}`
    || entry.content.includes(`noteId：${noteId}`)
    || entry.content.includes(`noteId:${noteId}`);
}

export function recordXiaohongshuPostEvent(input: RecordXiaohongshuPostEventInput): void {
  const timestamp = input.note.createdAt || appNowISO();
  const time = formatChatTimestamp(timestamp);
  const characterName = cleanEventText(input.characterName, 80) || "角色";
  const title = noteTitle(input.note);
  const body = cleanEventText(input.note.body, 500);
  const image = imageText(input.note);

  upsertEvent(input.characterId, {
    id: `xiaohongshu_post_${input.note.id}`,
    noteId: input.note.id,
    timestamp,
    content: `[小红书 ${time}] ${characterName}在小红书发布了一篇笔记，标题：“${title}”。正文：“${body}”。图片：“${image}”。`,
  });
}

export function recordXiaohongshuCommentEvent(input: RecordXiaohongshuCommentEventInput): void {
  if (!input.comment.text.trim()) return;
  const timestamp = input.comment.createdAt || appNowISO();
  const time = formatChatTimestamp(timestamp);
  const characterName = cleanEventText(input.characterName, 80) || "角色";
  const authorLabel = formatAuthorLabel(input.note.source, input.note.authorName, "小红书用户");
  const title = noteTitle(input.note);
  const body = cleanEventText(input.comment.text, 360);

  upsertEvent(input.characterId, {
    id: `xiaohongshu_comment_${input.comment.id}`,
    noteId: input.note.id,
    commentId: input.comment.id,
    timestamp,
    content: `[小红书 ${time}] ${characterName}在小红书评论了${authorLabel}的笔记《${title}》，评论：“${body}”。点赞：${input.liked ? "是" : "否"}，收藏：${input.saved ? "是" : "否"}。`,
  });
}

export function recordXiaohongshuReplyEvent(input: RecordXiaohongshuReplyEventInput): void {
  if (!input.comment.text.trim()) return;
  const timestamp = input.comment.createdAt || appNowISO();
  const time = formatChatTimestamp(timestamp);
  const characterName = cleanEventText(input.characterName, 80) || "角色";
  const targetLabel = input.targetComment
    ? formatAuthorLabel(input.targetComment.authorType, input.targetComment.authorName, "某人")
    : formatAuthorLabel(undefined, input.comment.replyTo, "某人");
  const title = noteTitle(input.note);
  const targetBody = cleanEventText(input.targetComment?.text, 360);
  const body = cleanEventText(input.comment.text, 360);

  upsertEvent(input.characterId, {
    id: `xiaohongshu_reply_${input.comment.id}`,
    noteId: input.note.id,
    commentId: input.comment.id,
    timestamp,
    content: `[小红书 ${time}] ${characterName}在小红书回复了${targetLabel}在笔记《${title}》下的评论${targetBody ? `，${targetLabel}评论：“${targetBody}”` : ""}，回复：“${body}”。`,
  });
}

export function recordXiaohongshuFollowUserEvent(input: RecordXiaohongshuFollowUserEventInput): void {
  const timestamp = input.timestamp || appNowISO();
  const time = formatChatTimestamp(timestamp);
  const characterName = cleanEventText(input.characterName, 80) || "角色";
  const userDisplayName = cleanEventText(input.userDisplayName, 80) || "小红书用户";

  upsertEvent(input.characterId, {
    id: "xiaohongshu_follow_user",
    timestamp,
    content: `[小红书 ${time}] ${characterName}关注了“${userDisplayName}”（用户的小红书账号）。`,
  });
}

export function deleteXiaohongshuProjectionEventsForNote(noteId: string): void {
  if (!noteId || typeof window === "undefined") return;
  for (const key of kvKeysWithPrefix(XIAOHONGSHU_EVENT_PREFIX)) {
    const events = loadEventsByKey(key);
    const next = events.filter(entry => !belongsToNote(entry, noteId));
    if (next.length !== events.length) {
      saveEventsByKey(key, next);
    }
  }
}

export function deleteXiaohongshuProjectionEventForComment(commentId: string): void {
  if (!commentId || typeof window === "undefined") return;
  for (const key of kvKeysWithPrefix(XIAOHONGSHU_EVENT_PREFIX)) {
    const events = loadEventsByKey(key);
    const next = events.filter(entry =>
      entry.commentId !== commentId
      && entry.id !== `xiaohongshu_comment_${commentId}`
      && entry.id !== `xiaohongshu_reply_${commentId}`
    );
    if (next.length !== events.length) {
      saveEventsByKey(key, next);
    }
  }
}

export function clearXiaohongshuProjectionEvents(): void {
  if (typeof window === "undefined") return;
  for (const key of kvKeysWithPrefix(XIAOHONGSHU_EVENT_PREFIX)) {
    kvRemove(key);
  }
}

export function loadXiaohongshuProjectionEntries(
  characterId: string,
  options?: { afterTimestamp?: string },
): XiaohongshuProjectionEntry[] {
  const events = loadEvents(characterId);
  if (!options?.afterTimestamp) return events;
  return events.filter(entry => entry.timestamp > options.afterTimestamp!);
}
