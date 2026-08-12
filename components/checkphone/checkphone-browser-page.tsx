"use client";

import { useEffect, useState } from "react";
import { appNowISO } from "@/lib/app-clock";
import { useCheckPhoneRefresh } from "@/lib/checkphone-refresh-tracker";
import { ChevronLeft, RefreshCw, Search, Trash2, Clock, Bookmark, Globe } from "lucide-react";
import { CheckPhoneBilingualText } from "@/components/checkphone/checkphone-bilingual-text";
import { CheckPhoneDebugErrorCard } from "@/components/checkphone/checkphone-debug-error-card";
import { ConfirmDialog } from "@/components/ui";
import type { Character } from "@/lib/character-types";
import type {
  CheckPhoneBrowserPayload,
  CheckPhoneSnapshot,
} from "@/lib/checkphone-config";
import { generateCheckPhoneBrowser } from "@/lib/checkphone-engine";
import { clearPhoneSnapshot, loadPhoneSnapshot, savePhoneSnapshot } from "@/lib/checkphone-storage";
import { formatChatUiTime } from "@/lib/chat-time";

type CheckPhoneBrowserPageProps = {
  character: Character;
  onBack: () => void;
};

export function CheckPhoneBrowserPage({ character, onBack }: CheckPhoneBrowserPageProps) {
  const [snapshot, setSnapshot] = useState<CheckPhoneSnapshot<CheckPhoneBrowserPayload> | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useCheckPhoneRefresh(character.id, "browser", setSnapshot);
  const [error, setError] = useState<string | null>(null);
  const [debugRawOutput, setDebugRawOutput] = useState<string | null>(null);
  const [debugSanitizedOutput, setDebugSanitizedOutput] = useState<string | null>(null);
  const [debugParseMode, setDebugParseMode] = useState<"raw" | "sanitized" | "failed" | null>(null);
  const [debugParseError, setDebugParseError] = useState<string | null>(null);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"history" | "bookmarks">("history");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function toggleExpand(id: string) {
    setExpandedId(prev => prev === id ? null : id);
  }

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setError(null);
    setSnapshot(null);
    setDebugRawOutput(null);
    setDebugSanitizedOutput(null);
    setDebugParseMode(null);
    setDebugParseError(null);
    (async () => {
      const cached = await loadPhoneSnapshot<CheckPhoneBrowserPayload>(character.id, "browser");
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
    setDebugParseMode(null);
    setDebugParseError(null);
    const {
      payload,
      summary,
      error: nextError,
      debugRawOutput: nextDebugRawOutput,
      debugSanitizedOutput: nextDebugSanitizedOutput,
      debugParseMode: nextDebugParseMode,
      debugParseError: nextDebugParseError,
    } = await generateCheckPhoneBrowser(character.id, snapshot?.payload ?? null, snapshot?.updatedAt);
    if (payload) {
      const now = appNowISO();
      const nextSnapshot: CheckPhoneSnapshot<CheckPhoneBrowserPayload> = {
        id: `${character.id}:browser`,
        characterId: character.id,
        appId: "browser",
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
    setDebugSanitizedOutput(nextDebugSanitizedOutput ?? null);
    setDebugParseMode(nextDebugParseMode ?? null);
    setDebugParseError(nextDebugParseError ?? null);
    setLoading(false);
    setLoaded(true);
  }

  async function handleClear() {
    if (loading) return;
    await clearPhoneSnapshot(character.id, "browser");
    setSnapshot(null);
    setError(null);
    setDebugRawOutput(null);
    setDebugSanitizedOutput(null);
    setDebugParseMode(null);
    setDebugParseError(null);
    setLoaded(true);
    setConfirmClearOpen(false);
  }

  const payload = snapshot?.payload ?? null;
  const history = payload?.history ?? [];
  const bookmarks = payload?.bookmarks ?? [];

  return (
    <div className="cp-browser-module">
      {/* Light Aurora Background Layer */}
      <div className="cp-browser-aurora-bg">
        <div className="cp-aurora-orb cp-aurora-orb-1"></div>
        <div className="cp-aurora-orb cp-aurora-orb-2"></div>
        <div className="cp-aurora-orb cp-aurora-orb-3"></div>
      </div>

      <header className="cp-browser-appbar cp-browser-appbar--unified">
        <div className="cp-browser-unified-compact">
          <div className="cp-unified-header-left">
            <button type="button" className="cp-unified-btn" onClick={onBack} aria-label="Back">
              <ChevronLeft size={20} strokeWidth={2.5} />
            </button>
          </div>

          <div className="cp-unified-title-stack">
            <div className="cp-unified-title-row">
              <i className="cp-unified-blink"></i>
              <span className="cp-unified-title">{payload?.headerTitle || "浏览器"}</span>
            </div>
            <div className="cp-unified-subtitle">{payload?.headerSubtitle || "历史记录与收藏夹"}</div>
          </div>

          <div className="cp-unified-header-right">
            <div className="cp-unified-actions">
              <button type="button" className="cp-unified-btn" onClick={handleRefresh} disabled={loading} aria-label="Refresh">
                <RefreshCw size={16} strokeWidth={2.5} className={loading ? "cp-spin" : ""} />
              </button>
              <button
                type="button"
                className="cp-unified-btn cp-unified-btn--danger"
                onClick={() => setConfirmClearOpen(true)}
                disabled={loading || !snapshot}
                aria-label="Clear browser snapshot"
              >
                <Trash2 size={16} strokeWidth={2.5} />
              </button>
            </div>
          </div>
        </div>
        
        <div className="cp-unified-status-bar">
          <span className="cp-unified-mini-text">[ SYS.NET : ONLINE ]</span>
          <span className="cp-unified-mini-text">SEC 9 {">"} PORT 443</span>
        </div>
      </header>

      {loading && (
        <div className="cp-refresh-indicator cp-refresh-indicator--floating" aria-live="polite">
          <span className="cp-refresh-indicator-text">正在刷新浏览器</span>
          <span className="cp-refresh-indicator-dots" aria-hidden="true">
            <i></i><i></i><i></i>
          </span>
        </div>
      )}

      <div className="cp-browser-body">
        <div className="cp-browser-scroll">
          <div className="cp-browser-searchbar-dymo">
            <div className="cp-dymo-tape">
              <span>[ SEARCH / INPUT URL ]</span>
            </div>
          </div>

        {!loaded && <div className="cp-browser-status">Reading browser...</div>}

        {loaded && !payload && !loading && (
          <div className="cp-browser-status cp-empty-copy">
            <p>暂无浏览内容</p>
            <span className="cp-browser-hint">点刷新同步历史记录和收藏夹</span>
          </div>
        )}

        {error ? (
          <CheckPhoneDebugErrorCard
            title="暂时无法解析浏览器内容。"
            error={error}
            debugParseMode={debugParseMode}
            debugParseError={debugParseError}
            debugRawOutput={debugRawOutput}
            debugSanitizedOutput={debugSanitizedOutput}
          />
        ) : null}

        {payload && (
          <>
            <div className="cp-browser-tabs-folder">
              <button 
                type="button" 
                className={`cp-folder-tab ${activeTab === 'history' ? 'active' : ''}`}
                onClick={() => setActiveTab('history')}
              >
                历史记录
              </button>
              <button 
                type="button" 
                className={`cp-folder-tab ${activeTab === 'bookmarks' ? 'active' : ''}`}
                onClick={() => setActiveTab('bookmarks')}
              >
                收藏夹
              </button>
            </div>

            <div className="cp-receipt-wrapper">
              <div className="cp-receipt-paperclips">
                <div className="cp-paperclip-left">
                  <svg width="11" height="32" viewBox="0 0 22 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M11 50V14C11 11.2386 13.2386 9 16 9C18.7614 9 21 11.2386 21 14V50C21 55.5228 16.5228 60 11 60C5.47715 60 1 55.5228 1 50V10C1 5.02944 5.02944 1 10 1C14.9706 1 19 5.02944 19 10V46" stroke="#b0b0b8" strokeWidth="2.8" strokeLinecap="round"/>
                  </svg>
                </div>
                <div className="cp-paperclip-right">
                  <svg width="11" height="32" viewBox="0 0 22 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M11 50V14C11 11.2386 13.2386 9 16 9C18.7614 9 21 11.2386 21 14V50C21 55.5228 16.5228 60 11 60C5.47715 60 1 55.5228 1 50V10C1 5.02944 5.02944 1 10 1C14.9706 1 19 5.02944 19 10V46" stroke="#b0b0b8" strokeWidth="2.8" strokeLinecap="round"/>
                  </svg>
                </div>
              </div>
              <div className="cp-browser-list">
              {activeTab === 'history' && history.length === 0 && (
                <div className="cp-browser-empty-list">无历史记录</div>
              )}
              {activeTab === 'bookmarks' && bookmarks.length === 0 && (
                <div className="cp-browser-empty-list">无收藏记录</div>
              )}

              {activeTab === 'history' && history.map((item) => {
                const isExpanded = expandedId === item.id;
                return (
                  <article key={item.id} className={`cp-browser-list-item ${isExpanded ? 'expanded' : ''}`}>
                    <button type="button" className="cp-browser-item-header" onClick={() => toggleExpand(item.id)}>
                      <div className="cp-browser-item-icon">
                        <Globe size={18} strokeWidth={2.2} />
                      </div>
                      <div className="cp-browser-item-info">
                        <div className="cp-browser-item-title-row">
                          <h4><CheckPhoneBilingualText text={item.title} tone="browser" variant="inline" /></h4>
                          <time className="cp-browser-item-date">{formatChatUiTime(item.createdAt) || item.createdAt}</time>
                        </div>
                        <span>{item.urlLabel}</span>
                        {item.content && (
                          <div className="cp-browser-item-snippet">
                            <CheckPhoneBilingualText text={item.content} tone="browser" />
                          </div>
                        )}
                      </div>
                    </button>
                    
                    {isExpanded && (item.context || item.innerThought) && (
                      <div className="cp-browser-item-details">
                        {item.context && (
                          <div className="cp-browser-history-note">
                            <b>情境</b>
                            <span><CheckPhoneBilingualText text={item.context} tone="browser" /></span>
                          </div>
                        )}
                        {item.innerThought && (
                          <div className="cp-browser-history-note cp-note-thought">
                            <b>内心</b>
                            <span><CheckPhoneBilingualText text={item.innerThought} tone="browser" /></span>
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}

              {activeTab === 'bookmarks' && bookmarks.map((item) => {
                const isExpanded = expandedId === item.id;
                return (
                  <article key={item.id} className={`cp-browser-list-item ${isExpanded ? 'expanded' : ''}`}>
                    <button type="button" className="cp-browser-item-header" onClick={() => toggleExpand(item.id)}>
                      <div className="cp-browser-item-icon cp-icon-bookmark">
                        <Bookmark size={18} strokeWidth={2.2} />
                      </div>
                      <div className="cp-browser-item-info">
                        <div className="cp-browser-item-title-row">
                          <h4><CheckPhoneBilingualText text={item.title} tone="browser" variant="inline" /></h4>
                          <span className="cp-list-tag">{item.categoryLabel}</span>
                        </div>
                        <span>{item.urlLabel}</span>
                        {item.content && (
                          <div className="cp-browser-item-snippet">
                            <CheckPhoneBilingualText text={item.content} tone="browser" />
                          </div>
                        )}
                      </div>
                    </button>
                    
                    {isExpanded && item.reason && (
                      <div className="cp-browser-item-details">
                        <span className="cp-browser-bookmark-reason">
                          <CheckPhoneBilingualText text={item.reason} tone="browser" />
                        </span>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </div>
          </>
        )}
        </div>
      </div>
      {confirmClearOpen && (
        <ConfirmDialog
          title="清空浏览器内容？"
          message="确认后会清空当前浏览器缓存。之后重新刷新时，不会再带入旧浏览内容。"
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
