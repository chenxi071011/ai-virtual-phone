import { kvGet, kvKeysWithPrefix, kvSet, registerDynamicPrefix } from "./kv-db";
import { appNowISO } from "./app-clock";
import { formatChatTimestamp } from "./llm-prompt-assembler";
import type { NoteWallComment, NoteWallNote } from "./notewall-types";

const NOTE_WALL_EVENT_PREFIX = "ai_phone_notewall_events_";
const MAX_EVENTS_PER_CHARACTER = 120;

registerDynamicPrefix(NOTE_WALL_EVENT_PREFIX);

export type NoteWallProjectionEntry = {
  id: string;
  timestamp: string;
  content: string;
  noteId?: string;
  commentId?: string;
};

type RecordNoteWallNoteEventInput = {
  characterId: string;
  characterName: string;
  note: NoteWallNote;
};

type RecordNoteWallCommentEventInput = {
  characterId: string;
  characterName: string;
  comment: NoteWallComment;
};

function storageKey(characterId: string): string {
  return `${NOTE_WALL_EVENT_PREFIX}${characterId}`;
}

function cleanEventText(value: string, maxLength: number): string {
  const text = String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function loadEventsByKey(key: string): NoteWallProjectionEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = kvGet(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is NoteWallProjectionEntry =>
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

function loadEvents(characterId: string): NoteWallProjectionEntry[] {
  return loadEventsByKey(storageKey(characterId));
}

function saveEventsByKey(key: string, events: NoteWallProjectionEntry[]): void {
  if (typeof window === "undefined") return;
  const compacted = [...events]
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .slice(-MAX_EVENTS_PER_CHARACTER);
  kvSet(key, JSON.stringify(compacted));
}

function saveEvents(characterId: string, events: NoteWallProjectionEntry[]): void {
  saveEventsByKey(storageKey(characterId), events);
}

function upsertEvent(characterId: string, entry: NoteWallProjectionEntry): void {
  const events = loadEvents(characterId);
  const next = events.filter(item => item.id !== entry.id);
  next.push(entry);
  saveEvents(characterId, next);
}

function formatByline(authorName: string, isAnonymous: boolean): string {
  if (isAnonymous) return "匿名";
  return cleanEventText(authorName, 80) || "未署名";
}

export function recordNoteWallNoteEvent(input: RecordNoteWallNoteEventInput): void {
  const timestamp = input.note.createdAt || appNowISO();
  const time = formatChatTimestamp(timestamp);
  const characterName = cleanEventText(input.characterName, 80) || "角色";
  const byline = formatByline(input.note.authorName, input.note.isAnonymous);
  const title = cleanEventText(input.note.summary, 160);
  const body = cleanEventText(input.note.body || input.note.summary, 500);

  upsertEvent(input.characterId, {
    id: `notewall_note_${input.note.id}`,
    noteId: input.note.id,
    timestamp,
    content: `[便签墙 ${time}] ${characterName}在便签墙发布了一张便签，落款为${byline}，标题：“${title}”。正文：“${body}”`,
  });
}

export function recordNoteWallCommentEvent(input: RecordNoteWallCommentEventInput): void {
  const timestamp = input.comment.createdAt || appNowISO();
  const time = formatChatTimestamp(timestamp);
  const characterName = cleanEventText(input.characterName, 80) || "角色";
  const byline = formatByline(input.comment.authorName, input.comment.isAnonymous);
  const body = cleanEventText(input.comment.body, 360);

  upsertEvent(input.characterId, {
    id: `notewall_comment_${input.comment.id}`,
    noteId: input.comment.noteId,
    commentId: input.comment.id,
    timestamp,
    content: `[便签墙 ${time}] ${characterName}在便签墙回复了一张便签，落款为${byline}，noteId：${input.comment.noteId}。评论：“${body}”`,
  });
}

function belongsToNote(entry: NoteWallProjectionEntry, noteId: string): boolean {
  return entry.noteId === noteId
    || entry.id === `notewall_note_${noteId}`
    || entry.content.includes(`noteId：${noteId}`)
    || entry.content.includes(`noteId:${noteId}`);
}

export function deleteNoteWallProjectionEventsForNote(noteId: string): void {
  if (!noteId || typeof window === "undefined") return;
  for (const key of kvKeysWithPrefix(NOTE_WALL_EVENT_PREFIX)) {
    const events = loadEventsByKey(key);
    const next = events.filter(entry => !belongsToNote(entry, noteId));
    if (next.length !== events.length) {
      saveEventsByKey(key, next);
    }
  }
}

export function deleteNoteWallProjectionEventForComment(commentId: string): void {
  if (!commentId || typeof window === "undefined") return;
  for (const key of kvKeysWithPrefix(NOTE_WALL_EVENT_PREFIX)) {
    const events = loadEventsByKey(key);
    const next = events.filter(entry => entry.commentId !== commentId && entry.id !== `notewall_comment_${commentId}`);
    if (next.length !== events.length) {
      saveEventsByKey(key, next);
    }
  }
}

export function loadNoteWallProjectionEntries(
  characterId: string,
  options?: { afterTimestamp?: string },
): NoteWallProjectionEntry[] {
  const events = loadEvents(characterId);
  if (!options?.afterTimestamp) return events;
  return events.filter(entry => entry.timestamp > options.afterTimestamp!);
}
