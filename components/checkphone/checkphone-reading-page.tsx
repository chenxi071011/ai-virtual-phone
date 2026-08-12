"use client";

import { useEffect, useMemo, useState } from "react";
import { appNowISO } from "@/lib/app-clock";
import { useCheckPhoneRefresh } from "@/lib/checkphone-refresh-tracker";
import { BookOpenText, ChevronLeft, Highlighter, LibraryBig, NotebookText, RefreshCw, Trash2 } from "lucide-react";
import { CheckPhoneBilingualText } from "@/components/checkphone/checkphone-bilingual-text";
import { CheckPhoneDebugErrorCard } from "@/components/checkphone/checkphone-debug-error-card";
import { ConfirmDialog } from "@/components/ui";
import type { Character } from "@/lib/character-types";
import type {
  CheckPhoneReadingBook,
  CheckPhoneReadingPayload,
  CheckPhoneSnapshot,
} from "@/lib/checkphone-config";
import { generateCheckPhoneReading } from "@/lib/checkphone-engine";
import { clearPhoneSnapshot, loadPhoneSnapshot, savePhoneSnapshot } from "@/lib/checkphone-storage";

type CheckPhoneReadingPageProps = {
  character: Character;
  onBack: () => void;
};

type ReadingTabId = "current" | "highlights" | "library" | "notes";

const READING_TABS: Array<{ id: ReadingTabId; label: string; icon: typeof BookOpenText }> = [
  { id: "current", label: "在读", icon: BookOpenText },
  { id: "highlights", label: "书摘", icon: Highlighter },
  { id: "library", label: "书架", icon: LibraryBig },
  { id: "notes", label: "笔记", icon: NotebookText },
];

const READING_HEADER_COPY: Record<ReadingTabId, { title: string; subtitle: string }> = {
  current: { title: "Reading", subtitle: "CURRENT BOOKS" },
  highlights: { title: "Highlights", subtitle: "SAVED LINES" },
  library: { title: "Bookshelf", subtitle: "WISHLIST AND SHELF" },
  notes: { title: "Notes", subtitle: "READING NOTES" },
};

function getCoverLayout(id: string) {
  const hash = Array.from(id).reduce((total, char) => total + char.charCodeAt(0), 0);
  return `layout-${(hash % 4) + 1}`;
}

function ReadingCover({
  book,
  large = false,
}: {
  book: CheckPhoneReadingBook;
  large?: boolean;
}) {
  const layout = getCoverLayout(book.id);
  return (
    <div className={`cp-reading-cover cp-reading-cover--${book.tone} cp-reading-cover--${layout} ${large ? "cp-reading-cover--large" : ""}`}>
      <span className="cp-reading-cover-author">{book.author}</span>
      <strong className="cp-reading-cover-title">{book.title}</strong>
      <span className={`cp-reading-cover-icon ${large ? "cp-reading-cover-icon--large" : ""}`}>{book.coverIcon}</span>
    </div>
  );
}

function ReadingBookCard({
  book,
  onOpen,
  shelf = false,
}: {
  book: CheckPhoneReadingBook;
  onOpen: () => void;
  shelf?: boolean;
}) {
  return (
    <button
      type="button"
      className={`cp-reading-book-card ${shelf ? "cp-reading-book-card--shelf" : ""}`}
      onClick={onOpen}
    >
      <ReadingCover book={book} />
      <div className="cp-reading-book-body">
        <strong><CheckPhoneBilingualText text={book.title} tone="reading" /></strong>
        <span>{book.author}</span>
        <p><CheckPhoneBilingualText text={book.summary} tone="reading" /></p>
        <em>{book.progressLabel}</em>
      </div>
    </button>
  );
}

export function CheckPhoneReadingPage({ character, onBack }: CheckPhoneReadingPageProps) {
  const [snapshot, setSnapshot] = useState<CheckPhoneSnapshot<CheckPhoneReadingPayload> | null>(null);
  const [selectedTab, setSelectedTab] = useState<ReadingTabId>("current");
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useCheckPhoneRefresh(character.id, "reading", setSnapshot);
  const [error, setError] = useState<string | null>(null);
  const [debugRawOutput, setDebugRawOutput] = useState<string | null>(null);
  const [debugSanitizedOutput, setDebugSanitizedOutput] = useState<string | null>(null);
  const [debugParseError, setDebugParseError] = useState<string | null>(null);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setError(null);
    setDebugRawOutput(null);
    setDebugSanitizedOutput(null);
    setDebugParseError(null);
    setSnapshot(null);
    setSelectedTab("current");
    setSelectedBookId(null);
    (async () => {
      const cached = await loadPhoneSnapshot<CheckPhoneReadingPayload>(character.id, "reading");
      if (cancelled) return;
      setSnapshot(cached);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [character.id]);

  async function handleRefresh() {
    if (loading) return;
    setLoading(true);
    setError(null);
    setDebugRawOutput(null);
    setDebugSanitizedOutput(null);
    setDebugParseError(null);
    const {
      payload,
      summary,
      error: nextError,
      debugRawOutput: nextDebugRawOutput,
      debugSanitizedOutput: nextDebugSanitizedOutput,
      debugParseError: nextDebugParseError,
    } = await generateCheckPhoneReading(
      character.id,
      snapshot?.payload ?? null,
      snapshot?.updatedAt,
    );
    if (payload) {
      const now = appNowISO();
      const nextSnapshot: CheckPhoneSnapshot<CheckPhoneReadingPayload> = {
        id: `${character.id}:reading`,
        characterId: character.id,
        appId: "reading",
        generatedAt: snapshot?.generatedAt ?? now,
        updatedAt: now,
        summary,
        payload,
      };
      await savePhoneSnapshot(nextSnapshot);
      setSnapshot(nextSnapshot);
      setSelectedBookId(null);
    }
    setError(nextError ?? null);
    setDebugRawOutput(nextDebugRawOutput ?? null);
    setDebugSanitizedOutput(nextDebugSanitizedOutput ?? null);
    setDebugParseError(nextDebugParseError ?? null);
    setLoading(false);
    setLoaded(true);
  }

  async function handleClear() {
    if (loading) return;
    await clearPhoneSnapshot(character.id, "reading");
    setSnapshot(null);
    setSelectedTab("current");
    setSelectedBookId(null);
    setError(null);
    setDebugRawOutput(null);
    setDebugSanitizedOutput(null);
    setDebugParseError(null);
    setLoaded(true);
    setConfirmClearOpen(false);
  }

  const payload = snapshot?.payload ?? null;
  const allBooks = useMemo(() => {
    const seen = new Set<string>();
    const books = [...(payload?.currentBooks ?? []), ...(payload?.libraryBooks ?? [])];
    return books.filter((book) => {
      if (seen.has(book.id)) return false;
      seen.add(book.id);
      return true;
    });
  }, [payload]);
  const activeBook = useMemo(
    () => allBooks.find((book) => book.id === selectedBookId) ?? null,
    [allBooks, selectedBookId],
  );
  const activeBookHighlights = useMemo(
    () => activeBook && payload ? payload.highlights.filter((item) => item.bookId === activeBook.id).slice(0, 2) : [],
    [activeBook, payload],
  );
  const activeBookNotes = useMemo(
    () => activeBook && payload ? payload.notes.filter((item) => item.bookId === activeBook.id).slice(0, 2) : [],
    [activeBook, payload],
  );

  const headerCopy = READING_HEADER_COPY[selectedTab];

  const backAction = activeBook
    ? () => setSelectedBookId(null)
    : onBack;

  return (
    <div className="cp-reading-module">
      <header className="cp-reading-appbar">
        <button type="button" className="cp-float-back" onClick={backAction} aria-label="Back">
          <ChevronLeft size={22} strokeWidth={2.5} />
        </button>
        <div className="cp-appbar-actions">
          <button type="button" className="cp-float-refresh" onClick={handleRefresh} disabled={loading} aria-label="Refresh">
            <RefreshCw size={18} strokeWidth={2.5} className={loading ? "cp-spin" : ""} />
          </button>
          <button
            type="button"
            className="cp-float-clear"
            onClick={() => setConfirmClearOpen(true)}
            disabled={loading || !snapshot}
            aria-label="Clear reading snapshot"
          >
            <Trash2 size={17} strokeWidth={2.25} />
          </button>
        </div>
      </header>

      {loading && (
        <div className="cp-refresh-indicator cp-refresh-indicator--floating" aria-live="polite">
          <span className="cp-refresh-indicator-text">正在刷新阅读</span>
          <span className="cp-refresh-indicator-dots" aria-hidden="true">
            <i></i><i></i><i></i>
          </span>
        </div>
      )}

      <div className="cp-reading-body">
        {!loaded && <div className="cp-reading-status">Syncing shelf...</div>}

        {loaded && !payload && !loading && (
          <div className="cp-reading-status cp-empty-copy">
            <p>暂无阅读内容</p>
            <span className="cp-reading-hint">点刷新同步在读书摘书架和笔记</span>
          </div>
        )}

        {error ? (
          <CheckPhoneDebugErrorCard
            error={error}
            debugRawOutput={debugRawOutput}
            debugSanitizedOutput={debugSanitizedOutput}
            debugParseError={debugParseError}
          />
        ) : null}

        {payload && (
          <>
            <div key={selectedTab} className="cp-reading-scroll">
              <div className="cp-reading-header-stack">
                <div className="cp-reading-header-title">{headerCopy.title}</div>
                <div className="cp-reading-header-subtitle">{headerCopy.subtitle}</div>
              </div>

              {selectedTab === "current" && (
                <section className="cp-reading-stage">
                  <div className="cp-reading-profile-card">
                    <p><CheckPhoneBilingualText text={payload.profile.status || payload.profile.summary || "最近的阅读痕迹"} tone="reading" /></p>
                    <time>{[character.name, payload.profile.updatedLabel].filter(Boolean).join(" · ")}</time>
                  </div>
                  <div className="cp-reading-book-stack">
                    {payload.currentBooks.map((book) => (
                      <ReadingBookCard key={book.id} book={book} shelf onOpen={() => setSelectedBookId(book.id)} />
                    ))}
                  </div>
                </section>
              )}

              {selectedTab === "highlights" && (
                <section className="cp-reading-list">
                  {payload.highlights.map((item) => {
                    const book = allBooks.find((entry) => entry.id === item.bookId);
                    return (
                      <article
                        key={item.id}
                        className="cp-reading-highlight-card"
                      >
                        <strong><CheckPhoneBilingualText text={item.quote} tone="reading" /></strong>
                        <p><CheckPhoneBilingualText text={item.note} tone="reading" /></p>
                        <div className="cp-reading-meta-row">
                          <span><CheckPhoneBilingualText text={book?.title || "未知书籍"} tone="reading" /></span>
                          <em>{item.chapterLabel}</em>
                        </div>
                      </article>
                    );
                  })}
                </section>
              )}

              {selectedTab === "library" && (
                <section className="cp-reading-library-grid">
                  {payload.libraryBooks.map((book) => (
                    <ReadingBookCard key={book.id} book={book} shelf onOpen={() => setSelectedBookId(book.id)} />
                  ))}
                </section>
              )}

              {selectedTab === "notes" && (
                <section className="cp-reading-list">
                  {payload.notes.map((item) => {
                    const book = allBooks.find((entry) => entry.id === item.bookId);
                    return (
                      <article
                        key={item.id}
                        className="cp-reading-note-card"
                      >
                        <strong><CheckPhoneBilingualText text={item.title} tone="reading" /></strong>
                        <p><CheckPhoneBilingualText text={item.body} tone="reading" /></p>
                        <div className="cp-reading-meta-row">
                          <span><CheckPhoneBilingualText text={book?.title || "未知书籍"} tone="reading" /></span>
                          <em>{item.updatedLabel}</em>
                        </div>
                      </article>
                    );
                  })}
                </section>
              )}
            </div>

            <nav className="cp-reading-tabbar" aria-label="阅读导航">
              {READING_TABS.map((tab) => {
                const Icon = tab.icon;
                const active = selectedTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    className={`cp-reading-tab ${active ? "is-active" : ""}`}
                    onClick={() => setSelectedTab(tab.id)}
                  >
                    <Icon size={16} strokeWidth={2.1} />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </nav>
          </>
        )}

      </div>

      {payload && activeBook && (
        <div
          className="cp-reading-book-modal-backdrop"
          role="presentation"
          onClick={() => setSelectedBookId(null)}
        >
          <article
            className="cp-reading-book-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`${activeBook.title} 详情`}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="cp-reading-book-modal-close"
              onClick={() => setSelectedBookId(null)}
              aria-label="Close book details"
            >
              ×
            </button>
            <div className="cp-reading-book-modal-scroll">
              <div className="cp-reading-book-modal-head">
                <ReadingCover book={activeBook} large />
                <div className="cp-reading-book-modal-title">
                  <span>{activeBook.author}</span>
                  <h3><CheckPhoneBilingualText text={activeBook.title} tone="reading" /></h3>
                  <div className="cp-reading-meta-row cp-reading-book-modal-meta">
                    <span>{activeBook.progressLabel}</span>
                    <em>{activeBook.status}</em>
                  </div>
                </div>
              </div>
              <div className="cp-reading-tag-row">
                {activeBook.tags.map((tag) => <em key={tag}>#{tag}</em>)}
              </div>
              <p className="cp-reading-detail-body"><CheckPhoneBilingualText text={activeBook.summary} tone="reading" /></p>
              {(activeBookHighlights.length > 0 || activeBookNotes.length > 0) && (
                <div className="cp-reading-related cp-reading-book-modal-related">
                  {activeBookHighlights.length > 0 && (
                    <>
                      <div className="cp-reading-section-head">相关书摘</div>
                      {activeBookHighlights.map((item) => (
                        <div key={item.id} className="cp-reading-related-card">
                          <strong><CheckPhoneBilingualText text={item.quote} tone="reading" /></strong>
                          <p><CheckPhoneBilingualText text={item.note} tone="reading" /></p>
                        </div>
                      ))}
                    </>
                  )}
                  {activeBookNotes.length > 0 && (
                    <>
                      <div className="cp-reading-section-head">相关笔记</div>
                      {activeBookNotes.map((item) => (
                        <div key={item.id} className="cp-reading-related-card">
                          <strong><CheckPhoneBilingualText text={item.title} tone="reading" /></strong>
                          <p><CheckPhoneBilingualText text={item.body} tone="reading" /></p>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          </article>
        </div>
      )}

      {confirmClearOpen && (
        <ConfirmDialog
          title="清空阅读内容？"
          message="确认后会清空当前阅读缓存。之后重新刷新时，不会再带入旧阅读内容。"
          variant="danger"
          confirmLabel="确认清空"
          cancelLabel="取消"
          onConfirm={handleClear}
          onCancel={() => setConfirmClearOpen(false)}
        />
      )}
    </div>
  );
}
