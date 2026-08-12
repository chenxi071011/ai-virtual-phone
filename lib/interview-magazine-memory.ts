import { kvGet, kvKeysWithPrefix, kvRemove, kvSet, registerDynamicPrefix } from "./kv-db";
import { appNowISO } from "./app-clock";
import { formatChatTimestamp } from "./llm-prompt-assembler";
import { normalizeUserNameToMacro, USER_NAME_MACRO } from "./user-macro";

const INTERVIEW_MAGAZINE_EVENT_PREFIX = "ai_phone_interview_magazine_events_";
const MAX_INTERVIEW_PROJECTION_EVENTS = 120;

registerDynamicPrefix(INTERVIEW_MAGAZINE_EVENT_PREFIX);

export type InterviewMagazineProjectionEntry = {
  id: string;
  issueId: string;
  issueNumber: number;
  timestamp: string;
  content: string;
  title: string;
  theme: string;
  characterIds: string[];
  characterNames: string[];
  userName: string;
  shared: boolean;
};

type RecordInterviewMagazineProjectionInput = {
  issueId: string;
  issueNumber: number;
  title: string;
  theme: string;
  characterIds: string[];
  characterNames: string[];
  userName: string;
  summary: string;
  timestamp?: string;
};

function storageKey(characterId: string): string {
  return `${INTERVIEW_MAGAZINE_EVENT_PREFIX}${characterId}`;
}

function cleanText(value: unknown, maxLength: number): string {
  const text = String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function loadEventsByKey(key: string): InterviewMagazineProjectionEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = kvGet(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is InterviewMagazineProjectionEntry =>
        Boolean(entry)
        && typeof (entry as Partial<InterviewMagazineProjectionEntry>).id === "string"
        && typeof (entry as Partial<InterviewMagazineProjectionEntry>).issueId === "string"
        && typeof (entry as Partial<InterviewMagazineProjectionEntry>).timestamp === "string"
        && typeof (entry as Partial<InterviewMagazineProjectionEntry>).content === "string"
      )
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  } catch {
    return [];
  }
}

function saveEventsByKey(key: string, events: InterviewMagazineProjectionEntry[]): void {
  if (typeof window === "undefined") return;
  const compacted = [...events]
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .slice(-MAX_INTERVIEW_PROJECTION_EVENTS);
  kvSet(key, JSON.stringify(compacted));
}

export function recordInterviewMagazineProjectionEvent(input: RecordInterviewMagazineProjectionInput): InterviewMagazineProjectionEntry | null {
  const characterIds = [...new Set(input.characterIds.map((id) => cleanText(id, 160)).filter(Boolean))];
  if (!input.issueId || characterIds.length === 0) return null;

  const userName = cleanText(input.userName, 80) || "共同受访者";
  const summary = normalizeUserNameToMacro(cleanText(input.summary, 1800), userName);
  if (!summary) return null;

  const timestamp = input.timestamp || appNowISO();
  const characterNames = input.characterNames.map((name) => cleanText(name, 80)).filter(Boolean);
  const theme = cleanText(input.theme, 120) || "未命名主题";
  const title = cleanText(input.title, 80) || "未命名刊物";
  const shared = characterIds.length > 1;
  const guests = characterNames.length > 0 ? characterNames.join("、") : "嘉宾";
  const content = `[访谈 ${formatChatTimestamp(timestamp)}] ${guests}与${USER_NAME_MACRO}完成了一期访谈，本期成刊《${title}》。${summary}`;

  const entry: InterviewMagazineProjectionEntry = {
    id: `interview_issue_${input.issueId}`,
    issueId: input.issueId,
    issueNumber: input.issueNumber,
    timestamp,
    content,
    title,
    theme,
    characterIds,
    characterNames,
    userName,
    shared,
  };

  for (const characterId of characterIds) {
    const key = storageKey(characterId);
    const current = loadEventsByKey(key);
    saveEventsByKey(key, [entry, ...current.filter((item) => item.id !== entry.id)]);
  }

  return entry;
}

export function loadInterviewMagazineProjectionEntries(
  characterId: string,
  options?: { afterTimestamp?: string },
): InterviewMagazineProjectionEntry[] {
  const entries = loadEventsByKey(storageKey(characterId));
  if (!options?.afterTimestamp) return entries;
  return entries.filter((entry) => entry.timestamp > options.afterTimestamp!);
}

export function deleteInterviewMagazineProjectionEventForIssue(issueId: string): void {
  if (!issueId || typeof window === "undefined") return;
  const entryId = `interview_issue_${issueId}`;
  for (const key of kvKeysWithPrefix(INTERVIEW_MAGAZINE_EVENT_PREFIX)) {
    const current = loadEventsByKey(key);
    const next = current.filter((entry) => entry.issueId !== issueId && entry.id !== entryId);
    if (next.length === current.length) continue;
    if (next.length === 0) {
      kvRemove(key);
    } else {
      saveEventsByKey(key, next);
    }
  }
}
