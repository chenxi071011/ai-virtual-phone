"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { appNowISO } from "@/lib/app-clock";
import { useCheckPhoneRefresh } from "@/lib/checkphone-refresh-tracker";
import { ChevronLeft, RefreshCw, Trash2 } from "lucide-react";
import { CheckPhoneBilingualText } from "@/components/checkphone/checkphone-bilingual-text";
import { CheckPhoneDebugErrorCard } from "@/components/checkphone/checkphone-debug-error-card";
import { ConfirmDialog } from "@/components/ui";
import type { Character } from "@/lib/character-types";
import type {
  CheckPhoneSnapshot,
  CheckPhoneSteamLibraryGame,
  CheckPhoneSteamPayload,
  CheckPhoneSteamRecentGame,
  CheckPhoneSteamWishlistGame,
} from "@/lib/checkphone-config";
import { generateCheckPhoneSteam } from "@/lib/checkphone-engine";
import { clearPhoneSnapshot, loadPhoneSnapshot, savePhoneSnapshot } from "@/lib/checkphone-storage";

type CheckPhoneSteamPageProps = {
  character: Character;
  onBack: () => void;
};

type SteamTabId = "recent" | "wishlist" | "library";

type SteamEntry =
  | (CheckPhoneSteamRecentGame & { section: "recent" })
  | (CheckPhoneSteamWishlistGame & { section: "wishlist" })
  | (CheckPhoneSteamLibraryGame & { section: "library" });

const STEAM_TABS: Array<{ id: SteamTabId; label: string }> = [
  { id: "recent", label: "最近在玩" },
  { id: "wishlist", label: "愿望单" },
  { id: "library", label: "游戏库" },
];

const GAME_LIBRARY_ACCENTS = ["#f5a25b", "#e96b8f", "#5b9eff", "#5fd4a4", "#ef6c5b", "#a584ff"];

function formatSteamRelativeTime(iso: string): string {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return iso;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const hhmm = value.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  if (value >= todayStart) return `今天 ${hhmm}`;
  if (value >= yesterdayStart) return `昨天 ${hhmm}`;
  return value.toLocaleDateString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  }).replace(/\//g, ".") + ` ${hhmm}`;
}

function formatSteamDaysAgo(iso: string): string {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return iso;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const valueStart = new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const diffDays = Math.max(0, Math.floor((todayStart - valueStart) / 86400000));
  return `${diffDays}天前`;
}

function formatHours(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1).replace(/\.0$/, "")} 小时`;
}

function formatPrice(value: number): string {
  return value <= 0 ? "免费" : `¥${Number.isInteger(value) ? value : value.toFixed(2).replace(/\.00$/, "")}`;
}

function formatCompactHours(value: number): string {
  if (value <= 0) return "0h";
  return `${Number.isInteger(value) ? value : value.toFixed(1).replace(/\.0$/, "")}h`;
}

function getTabEntries(payload: CheckPhoneSteamPayload | null, tab: SteamTabId): SteamEntry[] {
  if (!payload) return [];
  if (tab === "recent") return payload.recentlyPlayed.map((item) => ({ ...item, section: "recent" }));
  if (tab === "wishlist") return payload.wishlist.map((item) => ({ ...item, section: "wishlist" }));
  return payload.library.map((item) => ({ ...item, section: "library" }));
}

function formatGameLibraryHeaderTitle(title: string | undefined): string {
  const trimmed = title?.trim();
  return !trimmed || trimmed === "Steam" ? "游戏库" : trimmed;
}

function getEntryAccent(entry: SteamEntry, index: number): string {
  const seed = entry.title.length + entry.genre.length + index;
  return GAME_LIBRARY_ACCENTS[seed % GAME_LIBRARY_ACCENTS.length];
}

function getEntryProgress(entry: SteamEntry): number {
  if (entry.section === "wishlist") return 0;
  const value = Number(entry.progressPercent);
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function getEntryMetaLine(entry: SteamEntry): string {
  if (entry.section === "wishlist") return entry.reason;
  return entry.status;
}

function getEntrySideMetric(entry: SteamEntry): string {
  if (entry.section === "wishlist") return formatPrice(entry.price);
  if (entry.section === "recent") return formatCompactHours(entry.recentHours);
  return formatCompactHours(entry.totalHours);
}

function getEntrySubMetric(entry: SteamEntry): string | null {
  if (entry.section === "wishlist") return null;
  if (entry.section === "recent") return `总计 ${formatCompactHours(entry.totalHours)}`;
  return formatSteamDaysAgo(entry.lastPlayedAt);
}

export function CheckPhoneSteamPage({ character, onBack }: CheckPhoneSteamPageProps) {
  const [snapshot, setSnapshot] = useState<CheckPhoneSnapshot<CheckPhoneSteamPayload> | null>(null);
  const [selectedTab, setSelectedTab] = useState<SteamTabId>("recent");
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useCheckPhoneRefresh(character.id, "steam", setSnapshot);
  const [error, setError] = useState<string | null>(null);
  const [debugRawOutput, setDebugRawOutput] = useState<string | null>(null);
  const [debugSanitizedOutput, setDebugSanitizedOutput] = useState<string | null>(null);
  const [debugParseMode, setDebugParseMode] = useState<"raw" | "sanitized" | "failed" | null>(null);
  const [debugParseError, setDebugParseError] = useState<string | null>(null);
  const [debugNormalizeError, setDebugNormalizeError] = useState<string | null>(null);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setError(null);
    setSnapshot(null);
    setSelectedTab("recent");
    setSelectedEntryId(null);
    setDebugRawOutput(null);
    setDebugSanitizedOutput(null);
    setDebugParseMode(null);
    setDebugParseError(null);
    setDebugNormalizeError(null);
    (async () => {
      const cached = await loadPhoneSnapshot<CheckPhoneSteamPayload>(character.id, "steam");
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
    setDebugNormalizeError(null);
    const {
      payload,
      summary,
      error: nextError,
      debugRawOutput: nextDebugRawOutput,
      debugSanitizedOutput: nextDebugSanitizedOutput,
      debugParseMode: nextDebugParseMode,
      debugParseError: nextDebugParseError,
      debugNormalizeError: nextDebugNormalizeError,
    } = await generateCheckPhoneSteam(character.id, snapshot?.payload ?? null, snapshot?.updatedAt);
    if (payload) {
      const now = appNowISO();
      const nextSnapshot: CheckPhoneSnapshot<CheckPhoneSteamPayload> = {
        id: `${character.id}:steam`,
        characterId: character.id,
        appId: "steam",
        generatedAt: snapshot?.generatedAt ?? now,
        updatedAt: now,
        summary,
        payload,
      };
      await savePhoneSnapshot(nextSnapshot);
      setSnapshot(nextSnapshot);
      setSelectedEntryId(null);
    }
    setError(nextError ?? null);
    setDebugRawOutput(nextDebugRawOutput ?? null);
    setDebugSanitizedOutput(nextDebugSanitizedOutput ?? null);
    setDebugParseMode(nextDebugParseMode ?? null);
    setDebugParseError(nextDebugParseError ?? null);
    setDebugNormalizeError(nextDebugNormalizeError ?? null);
    setLoading(false);
    setLoaded(true);
  }

  async function handleClear() {
    if (loading) return;
    await clearPhoneSnapshot(character.id, "steam");
    setSnapshot(null);
    setSelectedTab("recent");
    setSelectedEntryId(null);
    setError(null);
    setDebugRawOutput(null);
    setDebugSanitizedOutput(null);
    setDebugParseMode(null);
    setDebugParseError(null);
    setDebugNormalizeError(null);
    setLoaded(true);
    setConfirmClearOpen(false);
  }

  const payload = snapshot?.payload ?? null;
  const currentEntries = useMemo(() => getTabEntries(payload, selectedTab), [payload, selectedTab]);
  const allEntries = useMemo(
    () =>
      payload
        ? [
            ...payload.recentlyPlayed.map((item) => ({ ...item, section: "recent" as const })),
            ...payload.wishlist.map((item) => ({ ...item, section: "wishlist" as const })),
            ...payload.library.map((item) => ({ ...item, section: "library" as const })),
          ]
        : [],
    [payload],
  );
  const activeEntry = useMemo(
    () => allEntries.find((item) => item.id === selectedEntryId) ?? null,
    [allEntries, selectedEntryId],
  );
  const activeEntryIndex = activeEntry ? allEntries.findIndex((item) => item.id === activeEntry.id) : -1;
  const totalOwnedCount = payload ? payload.recentlyPlayed.length + payload.library.length : 0;
  const totalHours = payload
    ? [...payload.recentlyPlayed, ...payload.library].reduce((sum, item) => sum + item.totalHours, 0)
    : 0;
  const recentHours = payload
    ? payload.recentlyPlayed.reduce((sum, item) => sum + item.recentHours, 0)
    : 0;

  const subtitle = "游玩记录与收藏状态概览";

  return (
    <div className="cp-steam-module">
      <header className="cp-steam-appbar">
        <button type="button" className="cp-float-back" onClick={activeEntry ? () => setSelectedEntryId(null) : onBack} aria-label="Back">
          <ChevronLeft size={22} strokeWidth={2.5} />
        </button>
        <div className="cp-steam-header-stack">
          <div className="cp-steam-header-title">{formatGameLibraryHeaderTitle(payload?.headerTitle)}</div>
          <div className="cp-steam-header-subtitle">{subtitle}</div>
        </div>
        <div className="cp-appbar-actions">
          <button type="button" className="cp-float-refresh" onClick={handleRefresh} disabled={loading} aria-label="Refresh">
            <RefreshCw size={18} strokeWidth={2.5} className={loading ? "cp-spin" : ""} />
          </button>
          <button type="button" className="cp-float-clear" onClick={() => setConfirmClearOpen(true)} disabled={loading || !snapshot} aria-label="Clear game library snapshot">
            <Trash2 size={17} strokeWidth={2.25} />
          </button>
        </div>
      </header>

      {loading && (
        <div className="cp-refresh-indicator cp-refresh-indicator--floating" aria-live="polite">
          <span className="cp-refresh-indicator-text">正在刷新游戏库</span>
          <span className="cp-refresh-indicator-dots" aria-hidden="true">
            <i></i><i></i><i></i>
          </span>
        </div>
      )}

      <div className="cp-steam-body">
        {!loaded && <div className="cp-steam-status">正在同步游戏库档案...</div>}

        {loaded && !payload && !loading && (
          <div className="cp-steam-status cp-empty-copy">
            <p>暂无游戏库内容</p>
            <span className="cp-steam-hint">点刷新同步最近在玩愿望单和游戏库</span>
          </div>
        )}

        {error ? (
          <CheckPhoneDebugErrorCard
            title="暂时无法解析游戏库内容。"
            error={error}
            debugParseMode={debugParseMode}
            debugParseError={debugParseError}
            debugNormalizeError={debugNormalizeError}
            debugRawOutput={debugRawOutput}
            debugSanitizedOutput={debugSanitizedOutput}
          />
        ) : null}

        {payload && !activeEntry && (
          <>
            <section className="cp-steam-profile-card">
              <div className="cp-steam-profile-main">
                <div className="cp-steam-avatar-shell" aria-hidden="true">
                  <div className="cp-steam-profile-avatar">{payload.profile.name.slice(0, 1) || "S"}</div>
                  <span className="cp-steam-profile-status-dot" />
                </div>
                <div className="cp-steam-profile-copy">
                  <div className="cp-steam-profile-name-row">
                    <h3>{payload.profile.name}</h3>
                    <span className="cp-steam-profile-badge">GAME ID</span>
                  </div>
                  <span className="cp-steam-profile-handle">{payload.profile.handle}</span>
                  <p><CheckPhoneBilingualText text={payload.profile.bio} tone="steam" /></p>
                </div>
              </div>
              <div className="cp-steam-profile-stats" aria-label="游戏库统计">
                <div>
                  <strong>{totalOwnedCount}</strong>
                  <span>游戏数</span>
                </div>
                <div>
                  <strong>{formatCompactHours(totalHours)}</strong>
                  <span>总时长</span>
                </div>
                <div>
                  <strong>{formatCompactHours(recentHours)}</strong>
                  <span>两周内</span>
                </div>
              </div>
            </section>

            <div className="cp-steam-tabs" role="tablist" aria-label="游戏库分类">
              {STEAM_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`cp-steam-tab${selectedTab === tab.id ? " is-active" : ""}`}
                  onClick={() => setSelectedTab(tab.id)}
                  role="tab"
                  aria-selected={selectedTab === tab.id}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {currentEntries.length === 0 ? (
              <div className="cp-steam-status">
                <p>这个分区暂时没有内容</p>
                <span className="cp-steam-hint">切换上方分区或刷新同步新的游戏记录</span>
              </div>
            ) : (
              <div className="cp-steam-list">
                {currentEntries.map((entry, index) => {
                  const progress = entry.section === "wishlist" ? null : getEntryProgress(entry);
                  const subMetric = getEntrySubMetric(entry);
                  const cardStyle = {
                    "--entry-accent": getEntryAccent(entry, index),
                    "--entry-progress": `${progress ?? 0}%`,
                  } as CSSProperties;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      className={`cp-steam-card${progress === null ? " cp-steam-card--no-progress" : ""}`}
                      style={cardStyle}
                      onClick={() => setSelectedEntryId(entry.id)}
                    >
                      <div className="cp-steam-card-cover" aria-hidden="true">
                        <span className="cp-steam-card-icon">{entry.icon}</span>
                        <span className="cp-steam-card-sheen" />
                      </div>
                      <div className="cp-steam-card-main">
                        <div className="cp-steam-card-head">
                          <strong><CheckPhoneBilingualText text={entry.title} tone="steam" /></strong>
                          <span className="cp-steam-card-genre">{entry.genre}</span>
                        </div>
                        {progress !== null ? (
                          <div className="cp-steam-card-meta">
                            <span>{`进度 ${progress}%`}</span>
                          </div>
                        ) : null}
                        <p><CheckPhoneBilingualText text={getEntryMetaLine(entry)} tone="steam" /></p>
                      </div>
                      <div className="cp-steam-card-side">
                        <strong>{getEntrySideMetric(entry)}</strong>
                        {subMetric ? <span>{subMetric}</span> : null}
                      </div>
                      {progress !== null ? (
                        <div
                          className="cp-steam-card-progress"
                          role="progressbar"
                          aria-label={`${entry.title}进度`}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={progress}
                        >
                          <span />
                        </div>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}

        {payload && activeEntry && (
          <div className="cp-steam-detail">
            <div
              className="cp-steam-detail-card"
              style={{
                "--entry-accent": getEntryAccent(activeEntry, Math.max(0, activeEntryIndex)),
                "--entry-progress": `${getEntryProgress(activeEntry)}%`,
              } as CSSProperties}
            >
              <div className="cp-steam-detail-cover" aria-hidden="true">
                <div className="cp-steam-detail-icon">{activeEntry.icon}</div>
              </div>
              <div className="cp-steam-detail-head">
                <div>
                  <h3><CheckPhoneBilingualText text={activeEntry.title} tone="steam" /></h3>
                  <div className="cp-steam-detail-meta">
                    <span>{activeEntry.genre}</span>
                    <span>
                      {activeEntry.section === "wishlist"
                        ? formatPrice(activeEntry.price)
                        : formatSteamRelativeTime(activeEntry.lastPlayedAt)}
                    </span>
                  </div>
                </div>
              </div>

              {activeEntry.section !== "wishlist" ? (
                <section className="cp-steam-section">
                  <div className="cp-steam-section-title">游玩记录</div>
                  <div className="cp-steam-detail-progress" aria-hidden="true">
                    <span />
                  </div>
                  <div className="cp-steam-stats">
                    <div>
                      <strong>{formatHours(activeEntry.totalHours)}</strong>
                      <span>总时长</span>
                    </div>
                    {"recentHours" in activeEntry ? (
                      <div>
                        <strong>{formatHours(activeEntry.recentHours)}</strong>
                        <span>近两周</span>
                      </div>
                    ) : null}
                  </div>
                </section>
              ) : (
                <section className="cp-steam-section">
                  <div className="cp-steam-section-title">价格</div>
                  <p>{formatPrice(activeEntry.price)}</p>
                </section>
              )}

              <section className="cp-steam-section">
                <div className="cp-steam-section-title">{activeEntry.section === "wishlist" ? "想玩原因" : "状态"}</div>
                <p><CheckPhoneBilingualText text={activeEntry.section === "wishlist" ? activeEntry.reason : activeEntry.status} tone="steam" /></p>
              </section>

              <section className="cp-steam-section">
                <div className="cp-steam-section-title">{activeEntry.section === "wishlist" ? "类型" : "感想"}</div>
                <p>{activeEntry.section === "wishlist" ? activeEntry.genre : <CheckPhoneBilingualText text={activeEntry.note} tone="steam" />}</p>
              </section>
            </div>
          </div>
        )}
      </div>

      {confirmClearOpen && (
        <ConfirmDialog
          title="清空游戏库内容？"
          message="确认后会清空这位角色已生成的游戏库缓存。之后重新刷新时，不会再带入旧内容。"
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
