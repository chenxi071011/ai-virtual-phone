"use client";

import { useEffect, useMemo, useState } from "react";
import { appNowISO } from "@/lib/app-clock";
import { useCheckPhoneRefresh } from "@/lib/checkphone-refresh-tracker";
import { ChevronLeft, RefreshCw, Trash2 } from "lucide-react";
import { CheckPhoneBilingualText } from "@/components/checkphone/checkphone-bilingual-text";
import { CheckPhoneDebugErrorCard } from "@/components/checkphone/checkphone-debug-error-card";
import { ConfirmDialog } from "@/components/ui";
import type { Character } from "@/lib/character-types";
import type {
  CheckPhoneNotesPayload,
  CheckPhoneSnapshot,
} from "@/lib/checkphone-config";
import { generateCheckPhoneNotes } from "@/lib/checkphone-engine";
import {
  clearPhoneSnapshot,
  loadPhoneSnapshot,
  savePhoneSnapshot,
} from "@/lib/checkphone-storage";

type CheckPhoneNotesPageProps = {
  character: Character;
  onBack: () => void;
};

export function CheckPhoneNotesPage({
  character,
  onBack,
}: CheckPhoneNotesPageProps) {
  const [snapshot, setSnapshot] =
    useState<CheckPhoneSnapshot<CheckPhoneNotesPayload> | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useCheckPhoneRefresh(character.id, "notes", setSnapshot);
  const [error, setError] = useState<string | null>(null);
  const [debugRawOutput, setDebugRawOutput] = useState<string | null>(null);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setError(null);
    setDebugRawOutput(null);
    setSnapshot(null);
    (async () => {
      const cached = await loadPhoneSnapshot<CheckPhoneNotesPayload>(
        character.id,
        "notes",
      );
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
    const {
      payload,
      summary,
      error: nextError,
      debugRawOutput: nextDebugRawOutput,
    } = await generateCheckPhoneNotes(
      character.id,
      snapshot?.payload ?? null,
      snapshot?.updatedAt,
    );
    if (payload) {
      const now = appNowISO();
      const nextSnapshot: CheckPhoneSnapshot<CheckPhoneNotesPayload> = {
        id: `${character.id}:notes`,
        characterId: character.id,
        appId: "notes",
        generatedAt: snapshot?.generatedAt ?? now,
        updatedAt: now,
        summary,
        payload,
      };
      await savePhoneSnapshot(nextSnapshot);
      setSnapshot(nextSnapshot);
    }
    setError(nextError ?? null);
    setDebugRawOutput(nextDebugRawOutput ?? null);
    setLoading(false);
    setLoaded(true);
  }

  async function handleClear() {
    if (loading) return;
    await clearPhoneSnapshot(character.id, "notes");
    setSnapshot(null);
    setError(null);
    setDebugRawOutput(null);
    setLoaded(true);
    setConfirmClearOpen(false);
  }

  const payload = snapshot?.payload ?? null;
  const notes = useMemo(() => payload?.notes ?? [], [payload]);

  return (
    <div
      className="cp-notes-module"
      style={{
        background: "#fffced",
        minHeight: "100%",
        display: "flex",
        flexDirection: "column",
        fontFamily: "'Inter', sans-serif",
      }}
    >
      <header
        style={{
          padding: "var(--cp-appbar-safe-top) 24px 12px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            style={{
              background: "#fff",
              border: "none",
              borderRadius: "50%",
              width: "38px",
              height: "38px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
            }}
          >
            <ChevronLeft size={20} color="#111" strokeWidth={2} />
          </button>

          <div style={{ display: "flex", gap: "10px" }}>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={loading}
              aria-label="Refresh"
              style={{
                background: "#fae389",
                color: "#111",
                border: "none",
                width: "38px",
                height: "38px",
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                padding: 0,
              }}
            >
              <RefreshCw
                size={17}
                strokeWidth={2.5}
                className={loading ? "cp-spin" : ""}
              />
            </button>
            <button
              type="button"
              onClick={() => setConfirmClearOpen(true)}
              disabled={loading || !snapshot}
              aria-label="Clear notes snapshot"
              style={{
                background: "#fff",
                color: "#111",
                border: "none",
                width: "38px",
                height: "38px",
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 0,
                boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
              }}
            >
              <Trash2 size={17} strokeWidth={2} />
            </button>
          </div>
        </div>
      </header>

      {loading && (
        <div
          className="cp-refresh-indicator cp-refresh-indicator--floating"
          aria-live="polite"
        >
          <span className="cp-refresh-indicator-text">正在刷新备忘录</span>
          <span className="cp-refresh-indicator-dots" aria-hidden="true">
            <i></i>
            <i></i>
            <i></i>
          </span>
        </div>
      )}

      <div style={{ flex: 1, padding: "0 16px 48px", overflowY: "auto" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px", margin: "0 8px 20px" }}>
          <h1
            style={{
              fontSize: "calc(36px*var(--app-text-scale,1))",
              fontWeight: 900,
              fontStyle: "italic",
              color: "#111",
              margin: 0,
              letterSpacing: 0,
              lineHeight: 1,
            }}
          >
            Memos
          </h1>
          <div
            style={{
              maxWidth: "100%",
              fontSize: "calc(12px*var(--app-text-scale,1))",
              lineHeight: 1.65,
              color: "#777",
              fontStyle: "italic",
            }}
          >
            PRIVATE FRAGMENTS
          </div>
        </div>

        {!loaded && (
          <div
            style={{
              padding: "48px 24px",
              textAlign: "center",
              color: "#999",
              fontSize: "calc(14px*var(--app-text-scale,1))",
              fontStyle: "italic",
            }}
          >
            Retrieving fragments...
          </div>
        )}

        {loaded && !payload && !loading && (
          <div className="cp-empty-copy">
            <p>暂无备忘录内容</p>
            <span>点刷新同步备忘录片段</span>
          </div>
        )}

        {error ? <CheckPhoneDebugErrorCard error={error} debugRawOutput={debugRawOutput} /> : null}

        {payload && (
          <div>
            {notes.map((note) => {
              return (
                <article
                  key={note.id}
                  style={{
                    marginBottom: "20px",
                    background: "#fff",
                    padding: "20px 18px 30px",
                    borderRadius: "16px",
                    boxShadow: "0 10px 30px rgba(60, 45, 20, 0.075)",
                    border: "1px solid #f9f9f9",
                    position: "relative",
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      top: "-8px",
                      right: "-8px",
                      width: "54px",
                      height: "20px",
                      background: "#fae389",
                      transform: "rotate(10deg)",
                      zIndex: 10,
                      boxShadow: "0 2px 4px rgba(0,0,0,0.05)",
                      opacity: 0.55,
                      borderRadius: "2px",
                    }}
                  />

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: "18px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                      }}
                    >
                      <div
                        style={{
                          width: "32px",
                          height: "32px",
                          borderRadius: "50%",
                          background: "#111",
                          color: "#fff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "calc(14px*var(--app-text-scale,1))",
                          fontWeight: 800,
                        }}
                      >
                        {character.name.trim().slice(0, 1) || "?"}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <span
                          style={{
                            fontSize: "calc(12px*var(--app-text-scale,1))",
                            fontWeight: 700,
                            color: "#111",
                          }}
                        >
                          {character.name}
                        </span>
                        <span style={{ fontSize: "calc(10px*var(--app-text-scale,1))", color: "#999" }}>
                          {note.updatedLabel}
                        </span>
                      </div>
                    </div>
                    {note.pinned ? (
                      <div
                        style={{
                          background: "#ecfdf5",
                          color: "#10b981",
                          fontSize: "calc(10px*var(--app-text-scale,1))",
                          padding: "3px 7px",
                          borderRadius: "4px",
                          fontWeight: 500,
                        }}
                      >
                        ✓ 置顶
                      </div>
                    ) : note.tagLabel ? (
                      <div
                        style={{
                          background: "#ecfdf5",
                          color: "#10b981",
                          fontSize: "calc(10px*var(--app-text-scale,1))",
                          padding: "3px 7px",
                          borderRadius: "4px",
                          fontWeight: 500,
                        }}
                      >
                        ✓ {note.tagLabel}
                      </div>
                    ) : null}
                  </div>

                  <div style={{ marginBottom: "10px" }}>
                    {note.title && (
                      <h2
                        style={{
                          fontSize: "calc(20px*var(--app-text-scale,1))",
                          fontWeight: 800,
                          color: "#111",
                          margin: 0,
                          lineHeight: 1.3,
                          position: "relative",
                          display: "inline-block",
                        }}
                      >
                        <span style={{ position: "relative", zIndex: 1 }}>
                          <CheckPhoneBilingualText text={note.title} tone="notes" />
                          <span
                            style={{
                              position: "absolute",
                              bottom: "2px",
                              left: 0,
                              right: 0,
                              height: "8px",
                              background: "rgba(250, 227, 137, 0.8)",
                              zIndex: -1,
                            }}
                          />
                        </span>
                      </h2>
                    )}
                  </div>

                  <p
                    style={{
                      fontSize: "calc(13px*var(--app-text-scale,1))",
                      color: "#666",
                      lineHeight: 1.95,
                      margin: 0,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    <CheckPhoneBilingualText text={note.body} tone="notes" />
                  </p>
                  {note.imageDescription && (
                    <div
                      style={{
                        alignSelf: "center",
                        width: "100%",
                        marginTop: "18px",
                        padding: "10px 12px",
                        background: "#fff1a8",
                        color: "#6f642f",
                        fontSize: "calc(11px*var(--app-text-scale,1))",
                        fontStyle: "italic",
                        lineHeight: 1.55,
                        boxShadow: "0 2px 5px rgba(92, 73, 22, 0.035)",
                        borderRadius: "2px",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      <CheckPhoneBilingualText text={note.imageDescription} tone="notes" />
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
      {confirmClearOpen && (
        <ConfirmDialog
          title="清空备忘录内容？"
          message="确认后会清空当前备忘录缓存。之后重新刷新时，不会再带入旧备忘录内容。"
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
