import { kvGet, kvSet, registerKvMigration } from "./kv-db";
import { appNowISO } from "./app-clock";
import type {
  CoCreateCastMember,
  CoCreateChapter,
  CoCreateLibrary,
  CoCreateMessage,
  CoCreatePendingMutation,
  CoCreateBackendLog,
  CoCreateRevision,
  CoCreateSession,
  CoCreateSettings,
  CoCreateMode,
  CoCreateToolArtifact,
} from "./cocreate-types";

const COCREATE_LEGACY_SESSION_KEY = "ai_phone_cocreate_session_v1";
const COCREATE_LIBRARY_KEY = "ai_phone_cocreate_library_v1";
registerKvMigration(COCREATE_LEGACY_SESSION_KEY);
registerKvMigration(COCREATE_LIBRARY_KEY);

const DEFAULT_CAST: CoCreateCastMember[] = [];

const DEFAULT_CHAPTERS: CoCreateChapter[] = [];

const DEFAULT_MESSAGES: CoCreateMessage[] = [];
const DEFAULT_SETTINGS: CoCreateSettings = {
  recentFullTextChapters: 2,
  disabledToolNames: [],
  streamingEnabled: false,
  autoAccept: true,
  memorySummaryInterval: 20,
};

export function createDefaultCoCreateSettings(): CoCreateSettings {
  return {
    recentFullTextChapters: DEFAULT_SETTINGS.recentFullTextChapters,
    disabledToolNames: [...DEFAULT_SETTINGS.disabledToolNames],
    streamingEnabled: DEFAULT_SETTINGS.streamingEnabled,
    autoAccept: DEFAULT_SETTINGS.autoAccept,
    memorySummaryInterval: DEFAULT_SETTINGS.memorySummaryInterval,
  };
}

function clampRecentFullTextChapters(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_SETTINGS.recentFullTextChapters;
  return Math.max(0, Math.min(10, Math.round(numeric)));
}

function clampMemorySummaryInterval(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_SETTINGS.memorySummaryInterval;
  return Math.max(5, Math.min(100, Math.round(numeric)));
}

function normalizeDisabledToolNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => String(item || "").trim()).filter(Boolean)));
}

function normalizeSettings(value: unknown): CoCreateSettings {
  const rawSettings = value as Partial<CoCreateSettings> | undefined;
  return {
    recentFullTextChapters: clampRecentFullTextChapters(rawSettings?.recentFullTextChapters),
    disabledToolNames: normalizeDisabledToolNames(rawSettings?.disabledToolNames),
    streamingEnabled: rawSettings?.streamingEnabled === true,
    autoAccept: rawSettings?.autoAccept !== false,
    memorySummaryInterval: clampMemorySummaryInterval(rawSettings?.memorySummaryInterval),
  };
}

function nowIso(): string {
  return appNowISO();
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeMode(value: unknown): CoCreateMode | "chapter" {
  if (value === "story" || value === "write") return "write";
  if (value === "discuss") return "discuss";
  return "chapter";
}

function padChapterNumber(value: number): string {
  return String(Math.max(1, value)).padStart(2, "0");
}

function createChapterTitle(num: string): Pick<CoCreateChapter, "title" | "titleEn"> {
  return {
    title: "未命名章节",
    titleEn: `CHAPTER ${num}`,
  };
}

function createChapterId(num: string): string {
  return `chapter_${num}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function reindexCoCreateChapters(chapters: CoCreateChapter[]): CoCreateChapter[] {
  return chapters.map((chapter, index) => {
    const nextNum = padChapterNumber(index + 1);
    const titleEn = /^CHAPTER\s+\d+$/i.test(chapter.titleEn || "") ? `CHAPTER ${nextNum}` : chapter.titleEn;
    return {
      ...chapter,
      num: nextNum,
      titleEn,
      updatedAt: nowIso(),
    };
  });
}

export function createNextCoCreateChapter(existing: CoCreateChapter[]): CoCreateChapter {
  const maxNum = existing.reduce((acc, chapter) => {
    const parsed = parseInt(chapter.num, 10);
    return Number.isFinite(parsed) && parsed > acc ? parsed : acc;
  }, 0);
  const num = padChapterNumber(maxNum + 1);
  const title = createChapterTitle(num);
  const now = nowIso();
  return {
    id: createChapterId(num),
    num,
    ...title,
    words: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function createCoCreateMessage(
  role: CoCreateMessage["role"],
  mode: CoCreateMessage["mode"],
  content: string,
  authorName?: string,
  chapterId?: string,
  kind?: CoCreateMessage["kind"],
): CoCreateMessage {
  return {
    id: createId("cocreate_msg"),
    role,
    mode: normalizeMode(mode),
    kind,
    content,
    authorName,
    chapterId,
    createdAt: nowIso(),
  };
}

export function createDefaultCoCreateSession(
  partnerCharacterId = "",
  title = "未命名共创",
  settings: CoCreateSettings = createDefaultCoCreateSettings(),
): CoCreateSession {
  const now = nowIso();
  return {
    id: createId("cocreate_session"),
    title,
    subtitle: "",
    partnerCharacterId,
    activeChapterId: "",
    cast: [...DEFAULT_CAST],
    chapters: [...DEFAULT_CHAPTERS],
    messages: [...DEFAULT_MESSAGES],
    turnsSinceSummary: 0,
    settings: normalizeSettings(settings),
    toolTurn: 0,
    toolArtifacts: [],
    revisions: [],
    pendingMutations: [],
    backendLogs: [],
    seenArchiveNoteChapterIds: [],
    writerNotebook: "",
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeSession(value: unknown, fallbackPartnerId = ""): CoCreateSession | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<CoCreateSession>;
  if (!Array.isArray(item.messages)) return null;
  const chapters = Array.isArray(item.chapters)
    ? item.chapters.map((chapter, index) => {
      const num = String(chapter?.num || padChapterNumber(index + 1)).padStart(2, "0");
      const title = createChapterTitle(num);
      const legacyStatus = (chapter as { status?: string } | null | undefined)?.status;
      const archivedAt = chapter?.archivedAt
        || (legacyStatus === "done" ? (chapter?.updatedAt || chapter?.createdAt || nowIso()) : undefined);
      const legacyMemoryEntry = (chapter as { memoryEntry?: string } | null | undefined)?.memoryEntry;
      const memoryEntries = Array.isArray(chapter?.memoryEntries) && chapter!.memoryEntries!.length > 0
        ? chapter!.memoryEntries!.map((entry) => ({
          text: String(entry?.text || ""),
          archivedAt: String(entry?.archivedAt || archivedAt || nowIso()),
        })).filter((entry) => entry.text)
        : (legacyMemoryEntry && archivedAt
          ? [{ text: legacyMemoryEntry, archivedAt }]
          : undefined);
      return {
        id: chapter?.id || createChapterId(num),
        num,
        title: chapter?.title || title.title,
        titleEn: chapter?.titleEn || title.titleEn,
        words: Number(chapter?.words || 0),
        content: chapter?.content,
        summary: chapter?.summary,
        memoryEntries,
        archiveNote: chapter?.archiveNote,
        archivedAt,
        createdAt: chapter?.createdAt,
        updatedAt: chapter?.updatedAt,
      } satisfies CoCreateChapter;
    })
    : DEFAULT_CHAPTERS;
  const activeChapterId = item.activeChapterId || chapters.find((chapter) => !chapter.archivedAt)?.id || chapters[0]?.id || "";
  const messages = item.messages.map((message) => {
    const role: CoCreateMessage["role"] = message.role === "tool"
      ? "tool"
      : message.role === "assistant"
        ? "assistant"
        : message.role === "system"
          ? "system"
          : "user";
    return {
      ...message,
      role,
      mode: normalizeMode(message.mode),
      chapterId: message.chapterId || activeChapterId || undefined,
    };
  });
  const settings = normalizeSettings(item.settings);
  const toolArtifacts = Array.isArray(item.toolArtifacts)
    ? item.toolArtifacts.filter((artifact): artifact is CoCreateToolArtifact => (
      Boolean(artifact)
      && typeof (artifact as Partial<CoCreateToolArtifact>).id === "string"
      && typeof (artifact as Partial<CoCreateToolArtifact>).toolName === "string"
      && typeof (artifact as Partial<CoCreateToolArtifact>).summary === "string"
    ))
    : [];
  const revisions = Array.isArray(item.revisions)
    ? item.revisions.filter((revision): revision is CoCreateRevision => (
      Boolean(revision)
      && typeof (revision as Partial<CoCreateRevision>).id === "string"
      && typeof (revision as Partial<CoCreateRevision>).chapterId === "string"
      && typeof (revision as Partial<CoCreateRevision>).summary === "string"
    ))
    : [];
  const pendingMutations = Array.isArray(item.pendingMutations)
    ? item.pendingMutations.filter((mutation): mutation is CoCreatePendingMutation => (
      Boolean(mutation)
      && typeof (mutation as Partial<CoCreatePendingMutation>).id === "string"
      && typeof (mutation as Partial<CoCreatePendingMutation>).toolName === "string"
      && typeof (mutation as Partial<CoCreatePendingMutation>).summary === "string"
      && typeof (mutation as Partial<CoCreatePendingMutation>).operation === "object"
    ))
    : [];
  const backendLogs = Array.isArray(item.backendLogs)
    ? item.backendLogs.filter((log): log is CoCreateBackendLog => (
      Boolean(log)
      && typeof (log as Partial<CoCreateBackendLog>).id === "string"
      && typeof (log as Partial<CoCreateBackendLog>).kind === "string"
      && typeof (log as Partial<CoCreateBackendLog>).status === "string"
      && typeof (log as Partial<CoCreateBackendLog>).title === "string"
    ))
    : [];
  const seenArchiveNoteChapterIds = Array.isArray(item.seenArchiveNoteChapterIds)
    ? Array.from(new Set(item.seenArchiveNoteChapterIds.filter((id): id is string => typeof id === "string" && Boolean(id))))
    : [];
  return {
    ...createDefaultCoCreateSession(fallbackPartnerId),
    ...item,
    id: item.id || createId("cocreate_session"),
    partnerCharacterId: item.partnerCharacterId || fallbackPartnerId,
    cast: Array.isArray(item.cast) ? item.cast : DEFAULT_CAST,
    chapters,
    activeChapterId,
    messages,
    turnsSinceSummary: Number(item.turnsSinceSummary || 0),
    lastMemorySummarizedAt: typeof item.lastMemorySummarizedAt === "string" ? item.lastMemorySummarizedAt : undefined,
    settings,
    toolTurn: Number(item.toolTurn || 0),
    toolArtifacts,
    revisions,
    pendingMutations,
    backendLogs,
    seenArchiveNoteChapterIds,
    relationshipDossier: typeof item.relationshipDossier === "string" ? item.relationshipDossier : undefined,
    writerNotebook: typeof item.writerNotebook === "string" ? item.writerNotebook : "",
  };
}

function normalizeLibrary(value: unknown, fallbackPartnerId = ""): CoCreateLibrary | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<CoCreateLibrary>;
  if (!Array.isArray(item.sessions)) return null;
  const sessions = item.sessions
    .map((session) => normalizeSession(session, fallbackPartnerId))
    .filter((session): session is CoCreateSession => Boolean(session));
  const settings = normalizeSettings(item.settings || sessions[0]?.settings);
  const syncedSessions = sessions.map((session) => ({ ...session, settings }));
  if (syncedSessions.length === 0) return { activeSessionId: "", sessions: [], settings };
  const activeSessionId = item.activeSessionId && syncedSessions.some((session) => session.id === item.activeSessionId)
    ? item.activeSessionId
    : syncedSessions[0].id;
  return { activeSessionId, sessions: syncedSessions, settings };
}

function loadLegacySession(fallbackPartnerId = ""): CoCreateSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = kvGet(COCREATE_LEGACY_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    const legacy = normalizeSession(parsed, fallbackPartnerId);
    if (!legacy) return null;
    return {
      ...legacy,
      id: legacy.id && legacy.id !== "default" ? legacy.id : "default",
    };
  } catch {
    return null;
  }
}

export function loadCoCreateLibrary(fallbackPartnerId = ""): CoCreateLibrary {
  if (typeof window === "undefined") {
    return { activeSessionId: "", sessions: [], settings: createDefaultCoCreateSettings() };
  }
  try {
    const raw = kvGet(COCREATE_LIBRARY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      const normalized = normalizeLibrary(parsed, fallbackPartnerId);
      if (normalized) return normalized;
    }
  } catch {
    // Fall through to legacy migration/default creation.
  }

  const legacy = loadLegacySession(fallbackPartnerId);
  const library = legacy
    ? { activeSessionId: legacy.id, sessions: [legacy], settings: normalizeSettings(legacy.settings) }
    : { activeSessionId: "", sessions: [], settings: createDefaultCoCreateSettings() };
  saveCoCreateLibrary(library);
  return library;
}

export function saveCoCreateLibrary(library: CoCreateLibrary): CoCreateLibrary {
  const settings = normalizeSettings(library.settings);
  const sessions = library.sessions.map((session) => ({ ...session, settings }));
  const activeSessionId = sessions.some((session) => session.id === library.activeSessionId)
    ? library.activeSessionId
    : sessions[0]?.id || "";
  const next = { activeSessionId, sessions, settings };
  kvSet(COCREATE_LIBRARY_KEY, JSON.stringify(next));
  return next;
}

export function loadCoCreateSession(fallbackPartnerId = ""): CoCreateSession {
  const library = loadCoCreateLibrary(fallbackPartnerId);
  return library.sessions.find((session) => session.id === library.activeSessionId)
    || library.sessions[0]
    || createDefaultCoCreateSession(fallbackPartnerId, "未命名共创", library.settings);
}

export function saveCoCreateSession(session: CoCreateSession): CoCreateSession {
  const library = loadCoCreateLibrary(session.partnerCharacterId);
  const next = { ...session, settings: library.settings, updatedAt: nowIso() };
  const exists = library.sessions.some((item) => item.id === next.id);
  saveCoCreateLibrary({
    activeSessionId: next.id,
    sessions: exists
      ? library.sessions.map((item) => (item.id === next.id ? next : item))
      : [next, ...library.sessions],
    settings: library.settings,
  });
  return next;
}

export function createCoCreateSession(title: string, partnerCharacterId = ""): CoCreateSession {
  const library = loadCoCreateLibrary(partnerCharacterId);
  const session = createDefaultCoCreateSession(partnerCharacterId, title.trim() || "未命名共创", library.settings);
  saveCoCreateLibrary({
    activeSessionId: session.id,
    sessions: [session, ...library.sessions],
    settings: library.settings,
  });
  return session;
}

export function deleteCoCreateSession(sessionId: string, fallbackPartnerId = ""): CoCreateLibrary {
  const library = loadCoCreateLibrary(fallbackPartnerId);
  const sessions = library.sessions.filter((session) => session.id !== sessionId);
  return saveCoCreateLibrary({
    activeSessionId: library.activeSessionId === sessionId ? sessions[0]?.id || "" : library.activeSessionId,
    sessions,
    settings: library.settings,
  });
}

export function setActiveCoCreateSession(sessionId: string, fallbackPartnerId = ""): CoCreateSession | null {
  const library = loadCoCreateLibrary(fallbackPartnerId);
  const session = library.sessions.find((item) => item.id === sessionId) || null;
  if (!session) return null;
  saveCoCreateLibrary({ ...library, activeSessionId: session.id, settings: library.settings });
  return session;
}

export function ensureActiveCoCreateChapter(session: CoCreateSession): CoCreateSession {
  const activeChapter = session.chapters.find((chapter) => chapter.id === session.activeChapterId);
  if (activeChapter && !activeChapter.archivedAt) return session;
  const writingChapter = [...session.chapters].reverse().find((chapter) => !chapter.archivedAt);
  if (writingChapter) return { ...session, activeChapterId: writingChapter.id };
  const nextChapter = createNextCoCreateChapter(session.chapters);
  return {
    ...session,
    activeChapterId: nextChapter.id,
    chapters: [...session.chapters, nextChapter],
  };
}

export function getActiveCoCreateChapter(session: CoCreateSession): CoCreateChapter | null {
  return session.chapters.find((chapter) => chapter.id === session.activeChapterId) || null;
}
