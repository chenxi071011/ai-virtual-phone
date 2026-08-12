import { kvGet, kvSet, registerDynamicPrefix } from "./kv-db";
import { appNowISO } from "./app-clock";
import { formatChatTimestamp } from "./llm-prompt-assembler";
import { deleteMemoryEntries, loadMemoryEntries } from "./memory-storage";

const COCREATE_EVENT_PREFIX = "ai_phone_cocreate_events_";
const MAX_COCREATE_EVENTS = 40;

registerDynamicPrefix(COCREATE_EVENT_PREFIX);

export type CoCreateProjectionEntry = {
  id: string;
  sessionId: string;
  chapterId?: string;
  chapterNum?: string;
  chapterTitle?: string;
  timestamp: string;
  title: string;
  partnerName: string;
  userName: string;
  memory: string;
  summary?: string;
  content: string;
};

type RecordCoCreateProjectionInput = {
  sessionId: string;
  characterId: string;
  title: string;
  partnerName: string;
  userName: string;
  memory: string;
  chapterId?: string;
  chapterNum?: string;
  chapterTitle?: string;
  chapterVersion?: number;
  timestamp?: string;
};

function storageKey(characterId: string): string {
  return `${COCREATE_EVENT_PREFIX}${characterId}`;
}

function cleanText(value: unknown, maxLength: number): string {
  const text = String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function loadEventsByKey(key: string): CoCreateProjectionEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = kvGet(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is CoCreateProjectionEntry =>
        Boolean(entry)
        && typeof (entry as Partial<CoCreateProjectionEntry>).id === "string"
        && typeof (entry as Partial<CoCreateProjectionEntry>).sessionId === "string"
        && typeof (entry as Partial<CoCreateProjectionEntry>).timestamp === "string"
        && typeof (entry as Partial<CoCreateProjectionEntry>).content === "string"
      )
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  } catch {
    return [];
  }
}

function saveEventsByKey(key: string, events: CoCreateProjectionEntry[]): void {
  if (typeof window === "undefined") return;
  const compacted = [...events]
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .slice(-MAX_COCREATE_EVENTS);
  kvSet(key, JSON.stringify(compacted));
}

export function recordCoCreateProjectionEvent(input: RecordCoCreateProjectionInput): CoCreateProjectionEntry | null {
  const characterId = cleanText(input.characterId, 160);
  const sessionId = cleanText(input.sessionId, 160);
  const memory = cleanText(input.memory, 1200);
  if (!characterId || !sessionId || !memory) return null;

  const timestamp = input.timestamp || appNowISO();
  const title = cleanText(input.title, 80) || "未命名共创";
  const partnerName = cleanText(input.partnerName, 80) || "共创搭档";
  const userName = cleanText(input.userName, 80) || "用户";
  const chapterId = cleanText(input.chapterId, 160);
  const chapterNum = cleanText(input.chapterNum, 20);
  const chapterTitle = cleanText(input.chapterTitle, 80);
  const content = `[共创 ${formatChatTimestamp(timestamp)}] ${userName}和${partnerName}结束了一个共创章节。${memory}`;

  const versionSuffix = typeof input.chapterVersion === "number" && input.chapterVersion > 1
    ? `_v${input.chapterVersion}`
    : "";
  const entry: CoCreateProjectionEntry = {
    id: `cocreate_${sessionId}_${chapterId || timestamp}${versionSuffix}`,
    sessionId,
    chapterId: chapterId || undefined,
    chapterNum: chapterNum || undefined,
    chapterTitle: chapterTitle || undefined,
    timestamp,
    title,
    partnerName,
    userName,
    memory,
    summary: memory,
    content,
  };

  const key = storageKey(characterId);
  const current = loadEventsByKey(key);
  saveEventsByKey(key, [entry, ...current.filter((item) => item.id !== entry.id)]);
  return entry;
}

export function loadCoCreateProjectionEntries(
  characterId: string,
  options?: { afterTimestamp?: string },
): CoCreateProjectionEntry[] {
  const entries = loadEventsByKey(storageKey(characterId));
  if (!options?.afterTimestamp) return entries;
  return entries.filter((entry) => entry.timestamp > options.afterTimestamp!);
}

export function deleteCoCreateProjectionEntriesBySession(characterId: string, sessionId: string): number {
  const cleanCharacterId = cleanText(characterId, 160);
  const cleanSessionId = cleanText(sessionId, 160);
  if (!cleanCharacterId || !cleanSessionId) return 0;
  const key = storageKey(cleanCharacterId);
  const current = loadEventsByKey(key);
  const next = current.filter((entry) => entry.sessionId !== cleanSessionId);
  saveEventsByKey(key, next);
  return current.length - next.length;
}

export async function deleteCoCreateLongTermMemoriesBySession(characterId: string, sessionId: string): Promise<number> {
  const cleanCharacterId = cleanText(characterId, 160);
  const cleanSessionId = cleanText(sessionId, 160);
  if (!cleanCharacterId || !cleanSessionId) return 0;
  const entries = await loadMemoryEntries(cleanCharacterId);
  const ids = entries
    .filter((entry) => {
      const sourceSessionIds = entry.metadata?.sourceSessionIds;
      return Array.isArray(sourceSessionIds)
        && sourceSessionIds.map(String).includes(cleanSessionId);
    })
    .map((entry) => entry.id);
  await deleteMemoryEntries(ids);
  return ids.length;
}
