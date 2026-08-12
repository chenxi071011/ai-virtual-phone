"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { appNowISO } from "@/lib/app-clock";
import { useCheckPhoneRefresh } from "@/lib/checkphone-refresh-tracker";
import { ChevronLeft, RefreshCw, Trash2, Wifi } from "lucide-react";
import { CheckPhoneBilingualText } from "@/components/checkphone/checkphone-bilingual-text";
import { CheckPhoneDebugErrorCard } from "@/components/checkphone/checkphone-debug-error-card";
import { ConfirmDialog } from "@/components/ui";
import type { Character } from "@/lib/character-types";
import type {
  CheckPhoneAssetsPayload,
  CheckPhoneAssetAccount,
  CheckPhoneAssetActivity,
  CheckPhoneSnapshot,
} from "@/lib/checkphone-config";
import { formatChatUiTime } from "@/lib/chat-time";
import { generateCheckPhoneAssets } from "@/lib/checkphone-engine";
import { clearPhoneSnapshot, loadPhoneSnapshot, savePhoneSnapshot } from "@/lib/checkphone-storage";

type CheckPhoneAssetsPageProps = {
  character: Character;
  onBack: () => void;
};

function getAccountKindLabel(kind: CheckPhoneAssetAccount["kind"]): string {
  switch (kind) {
    case "cash":
      return "流动";
    case "savings":
      return "储蓄";
    case "investment":
      return "投资";
    case "credit":
      return "信用";
    default:
      return "";
  }
}

function getActivityAmountClass(amount: string): string {
  return amount.trim().startsWith("-") ? "is-negative" : "is-positive";
}

function getCardStyleLabel(kind: CheckPhoneAssetAccount["kind"]): string {
  switch (kind) {
    case "cash":
      return "DEBIT";
    case "savings":
      return "RESERVE";
    case "investment":
      return "CAPITAL";
    case "credit":
      return "CREDIT";
    default:
      return "ACCOUNT";
  }
}

function getCardDisplayNumber(masked: string): string {
  const digits = masked.replace(/\D/g, "");
  let suffix = digits.slice(-4);
  if (suffix.length < 4) {
    suffix = suffix.padStart(4, "0");
  }
  return `•••• •••• •••• ${suffix}`;
}

function parseAssetAmount(amount: string): number {
  const normalized = amount.replace(/[,\s¥￥]/g, "");
  if (!normalized) return 0;
  const sign = normalized.startsWith("-") ? -1 : 1;
  const numeric = Number.parseFloat(normalized.replace(/^[+-]/, ""));
  return Number.isFinite(numeric) ? sign * numeric : 0;
}

function formatAssetDelta(amount: number): string {
  const sign = amount < 0 ? "-" : "+";
  const absolute = Math.abs(amount);
  const formatter = new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: Number.isInteger(absolute) ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `${sign} ¥${formatter.format(absolute)}`;
}

function formatAssetTotal(amount: number): string {
  const formatter = new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `¥ ${formatter.format(amount)}`;
}

function isSameLocalDay(date: Date, target: Date): boolean {
  return (
    date.getFullYear() === target.getFullYear() &&
    date.getMonth() === target.getMonth() &&
    date.getDate() === target.getDate()
  );
}

function getAssetActivityTimeLabel(createdAt: string): string {
  const label = formatChatUiTime(createdAt);
  if (label.startsWith("昨天 ") || label.includes("月") || label.includes("年") || label.startsWith("星期")) {
    return label;
  }
  return `今天 ${label}`;
}

function generateTransactionNo(activity: CheckPhoneAssetActivity): string {
  let hash = 0;
  for (let i = 0; i < activity.id.length; i++) {
    hash = ((hash << 5) - hash) + activity.id.charCodeAt(i);
    hash |= 0;
  }
  const safeHash = Math.abs(hash).toString().padStart(6, "0");
  const prefix = "10";
  const innerHash = safeHash.substring(0, 2);
  const suffixHash = safeHash.substring(2);

  const d = new Date(activity.createdAt);
  if (Number.isNaN(d.getTime())) return `${prefix}${safeHash}00000000000000`;

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const HH = String(d.getHours()).padStart(2, "0");
  const MM = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");

  return `${prefix}${innerHash}${yyyy}${mm}${dd}${HH}${MM}${ss}${suffixHash}`;
}

export function CheckPhoneAssetsPage({ character, onBack }: CheckPhoneAssetsPageProps) {
  const [snapshot, setSnapshot] = useState<CheckPhoneSnapshot<CheckPhoneAssetsPayload> | null>(null);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useCheckPhoneRefresh(character.id, "assets", setSnapshot);
  const [error, setError] = useState<string | null>(null);
  const [debugRawOutput, setDebugRawOutput] = useState<string | null>(null);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const cardStackRef = useRef<HTMLDivElement | null>(null);
  const listScrollTopRef = useRef(0);
  const cardStackScrollLeftRef = useRef(0);
  const shouldRestoreListScrollRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setError(null);
    setDebugRawOutput(null);
    setSnapshot(null);
    setActiveAccountId(null);
    setSelectedActivityId(null);
    (async () => {
      const cached = await loadPhoneSnapshot<CheckPhoneAssetsPayload>(character.id, "assets");
      if (cancelled) return;
      setSnapshot(cached);
      setActiveAccountId(cached?.payload?.accounts[0]?.id ?? null);
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
    } = await generateCheckPhoneAssets(
      character.id,
      snapshot?.payload ?? null,
      snapshot?.updatedAt,
    );
    if (payload) {
      const now = appNowISO();
      const nextSnapshot: CheckPhoneSnapshot<CheckPhoneAssetsPayload> = {
        id: `${character.id}:assets`,
        characterId: character.id,
        appId: "assets",
        generatedAt: snapshot?.generatedAt ?? now,
        updatedAt: now,
        summary,
        payload,
      };
      await savePhoneSnapshot(nextSnapshot);
      setSnapshot(nextSnapshot);
      setActiveAccountId(nextSnapshot.payload.accounts[0]?.id ?? null);
      setSelectedActivityId(null);
    }
    setError(nextError ?? null);
    setDebugRawOutput(nextDebugRawOutput ?? null);
    setLoading(false);
    setLoaded(true);
  }

  async function handleClear() {
    if (loading) return;
    await clearPhoneSnapshot(character.id, "assets");
    setSnapshot(null);
    setActiveAccountId(null);
    setSelectedActivityId(null);
    setError(null);
    setDebugRawOutput(null);
    setLoaded(true);
    setConfirmClearOpen(false);
  }

  const payload = snapshot?.payload ?? null;
  const accounts = payload?.accounts ?? [];
  const activities = payload?.activities ?? [];

  const activeAccount = useMemo(
    () => accounts.find((account) => account.id === activeAccountId) ?? accounts[0] ?? null,
    [accounts, activeAccountId],
  );
  const selectedActivity = useMemo(
    () => activities.find((activity) => activity.id === selectedActivityId) ?? null,
    [activities, selectedActivityId],
  );
  const activeAccountActivities = useMemo(
    () =>
      activeAccount
        ? activities
            .filter((item) => item.accountId === activeAccount.id)
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        : [],
    [activities, activeAccount],
  );
  const todayDelta = useMemo(() => {
    const today = new Date();
    return activities.reduce((sum, activity) => {
      const createdAt = new Date(activity.createdAt);
      if (Number.isNaN(createdAt.getTime()) || !isSameLocalDay(createdAt, today)) return sum;
      return sum + parseAssetAmount(activity.amount);
    }, 0);
  }, [activities]);
  const totalAssets = useMemo(
    () => accounts.reduce((sum, account) => sum + parseAssetAmount(account.balance), 0),
    [accounts],
  );
  const todayDeltaLabel = useMemo(() => formatAssetDelta(todayDelta), [todayDelta]);
  const totalAssetsLabel = useMemo(() => formatAssetTotal(totalAssets), [totalAssets]);

  const subtitle = selectedActivity
    ? selectedActivity.category
    : activeAccount
      ? activeAccount.title
      : payload?.headerSubtitle || "账户与近期变动";

  const backAction = selectedActivity
    ? () => {
        shouldRestoreListScrollRef.current = true;
        setSelectedActivityId(null);
      }
    : onBack;

  useLayoutEffect(() => {
    if (selectedActivity || !shouldRestoreListScrollRef.current) return;
    shouldRestoreListScrollRef.current = false;
    const body = bodyRef.current;
    const cardStack = cardStackRef.current;
    if (body) body.scrollTop = listScrollTopRef.current;
    if (cardStack) cardStack.scrollLeft = cardStackScrollLeftRef.current;
    requestAnimationFrame(() => {
      if (bodyRef.current) bodyRef.current.scrollTop = listScrollTopRef.current;
      if (cardStackRef.current) cardStackRef.current.scrollLeft = cardStackScrollLeftRef.current;
    });
  }, [selectedActivity]);

  useEffect(() => {
    const container = cardStackRef.current;
    if (!container || selectedActivity) return;

    let ticking = false;
    const syncActiveCardFromScroll = () => {
      ticking = false;
      const cards = Array.from(container.querySelectorAll<HTMLElement>(".cp-premium-bank-card"));
      if (cards.length === 0) return;

      const containerCenter = container.scrollLeft + container.clientWidth / 2;
      let nearestId: string | null = null;
      let nearestDistance = Number.POSITIVE_INFINITY;

      for (const card of cards) {
        const cardCenter = card.offsetLeft + card.offsetWidth / 2;
        const distance = Math.abs(cardCenter - containerCenter);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestId = card.dataset.accountId ?? null;
        }
      }

      if (nearestId && nearestId !== activeAccountId) {
        setActiveAccountId(nearestId);
      }
    };

    const handleScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(syncActiveCardFromScroll);
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    syncActiveCardFromScroll();
    return () => {
      container.removeEventListener("scroll", handleScroll);
    };
  }, [activeAccountId, selectedActivity, accounts.length]);

  function handleSelectAccount(accountId: string) {
    setActiveAccountId(accountId);
    const container = cardStackRef.current;
    const target = container?.querySelector<HTMLElement>(`.cp-premium-bank-card[data-account-id="${accountId}"]`);
    if (!container || !target) return;

    const maxScrollLeft = Math.max(0, container.scrollWidth - container.clientWidth);
    const centeredScrollLeft = target.offsetLeft + target.offsetWidth / 2 - container.clientWidth / 2;
    container.scrollTo({
      left: Math.min(maxScrollLeft, Math.max(0, centeredScrollLeft)),
      behavior: "smooth",
    });
  }

  function handleOpenActivity(activityId: string) {
    listScrollTopRef.current = bodyRef.current?.scrollTop ?? 0;
    cardStackScrollLeftRef.current = cardStackRef.current?.scrollLeft ?? 0;
    setSelectedActivityId(activityId);
  }

  return (
    <div className="cp-assets-module cp-assets-premium">
      <header className="cp-assets-appbar cp-appbar-minimal">
        <button type="button" className="cp-float-back" onClick={backAction} aria-label="Back">
          <ChevronLeft size={22} strokeWidth={2.5} />
        </button>
        <div className="cp-appbar-spacer"></div>
        <div className="cp-appbar-actions">
          <button type="button" className="cp-float-refresh" onClick={handleRefresh} disabled={loading} aria-label="Refresh">
            <RefreshCw size={18} strokeWidth={2.5} className={loading ? "cp-spin" : ""} />
          </button>
          <button
            type="button"
            className="cp-float-clear"
            onClick={() => setConfirmClearOpen(true)}
            disabled={loading || !snapshot}
            aria-label="Clear assets snapshot"
          >
            <Trash2 size={17} strokeWidth={2.25} />
          </button>
        </div>
      </header>

      {loading && (
        <div className="cp-refresh-indicator cp-refresh-indicator--floating" aria-live="polite">
          <span className="cp-refresh-indicator-text">正在刷新资产</span>
          <span className="cp-refresh-indicator-dots" aria-hidden="true">
            <i></i><i></i><i></i>
          </span>
        </div>
      )}

      <div className="cp-assets-body" ref={bodyRef}>
        {!loaded && <div className="cp-assets-status">Reading portfolio...</div>}

        {loaded && !payload && !loading && (
          <div className="cp-assets-status cp-empty-copy">
            <p>暂无资产内容</p>
            <span className="cp-assets-hint">点刷新同步资产记录</span>
          </div>
        )}

        {error ? <CheckPhoneDebugErrorCard error={error} debugRawOutput={debugRawOutput} /> : null}

        {payload && !selectedActivity && (
          <div className="cp-assets-scroll">
            
            {/* Minimalist Hero Integrated Title */}
            <section className="cp-premium-hero">
              <div className="cp-premium-hero-title-wrap">
                <h1>{payload?.headerTitle || "资产"}</h1>
                <span>{subtitle}</span>
              </div>
              <div className="cp-premium-hero-kicker">{payload.headline.totalLabel}</div>
              <div className="cp-premium-hero-amount">{totalAssetsLabel}</div>
              <div className="cp-premium-hero-delta">
                <span>今日变化</span>
                <b className={getActivityAmountClass(todayDeltaLabel)}>{todayDeltaLabel}</b>
                <em>{payload.headline.periodLabel}</em>
              </div>
            </section>

            {/* Realistic Old Money Card Stack */}
            <section className="cp-premium-cards-section">
              <div className="cp-premium-card-stack" role="tablist" aria-label="资产卡片" ref={cardStackRef}>
              {accounts.map((account) => (
                <button
                  key={account.id}
                  type="button"
                  data-account-id={account.id}
                  className={`cp-premium-bank-card cp-premium-bank-card--${account.cardStyle} ${activeAccount?.id === account.id ? "is-active" : ""}`}
                  onClick={() => handleSelectAccount(account.id)}
                  aria-pressed={activeAccount?.id === account.id}
                >
                  <div className="cp-card-texture"></div>
                  <div className="cp-card-dots"></div>
                  <div className="cp-card-overlay-shine"></div>

                  <div className="cp-card-top-row">
                    <div className="cp-card-bank-header">
                      <div className="cp-card-logo-mark"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 2v20 M12 12L22 12 M2 12h10"/></svg></div>
                      <div className="cp-card-bank-text">
                        <span className="cp-card-bank-name">{account.bankLabel}</span>
                        <span className="cp-card-bank-sub">CHINA CITIC BANK</span>
                      </div>
                    </div>
                    <div className="cp-card-top-right">
                       <span className="cp-card-custom-label">PLATINUM</span>
                    </div>
                  </div>
                  
                  <div className="cp-card-mid-row">
                    <div className="cp-card-chip">
                      <div className="cp-chip-line cp-chip-line-1"></div>
                      <div className="cp-chip-line cp-chip-line-2"></div>
                      <div className="cp-chip-line cp-chip-line-3"></div>
                      <div className="cp-chip-line cp-chip-line-4"></div>
                      <div className="cp-chip-line-center"></div>
                    </div>
                    <Wifi size={22} className="cp-card-nfc" />
                  </div>
                  
                  <div className="cp-card-number">{getCardDisplayNumber(account.maskedNumber)}</div>
                  
                  <div className="cp-card-bottom-row">
                    <div className="cp-card-holder-group">
                      <div className="cp-card-holder">
                        <span>CARDHOLDER</span>
                        <strong><CheckPhoneBilingualText text={account.title} tone="assets" /></strong>
                      </div>
                      <div className="cp-card-expiry">
                        <span>VALID THRU</span>
                        <strong>12/28</strong>
                      </div>
                    </div>
                    <div className="cp-card-brand-box">
                      <div className="cp-card-brand-label">{getCardStyleLabel(account.kind)}</div>
                      <strong>UNIONPAY</strong>
                    </div>
                  </div>
                </button>
              ))}
              </div>
            </section>

            {/* Premium Action Ledger Panel for Active Account */}
            {activeAccount && (
              <section className="cp-premium-ledger-panel">
                <div className="cp-ledger-header">
                  <div className="cp-ledger-line"></div>
                  <span>{getAccountKindLabel(activeAccount.kind)} ACCOUNT</span>
                  <div className="cp-ledger-line"></div>
                </div>
                
                <div className="cp-ledger-balance-wrap">
                  <div className="cp-ledger-balance-label">CURRENT BALANCE</div>
                  <div className="cp-ledger-balance">{activeAccount.balance}</div>
                  <div className="cp-ledger-meta">
                    — {activeAccount.accentLabel} —
                  </div>
                </div>
                
                <div className="cp-ledger-quick-actions">
                  <button className="cp-ledger-btn">
                    <div className="cp-ledger-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><path d="M7 7h.01"/><path d="M17 7h.01"/><path d="M7 17h.01"/><path d="M17 17h.01"/><path d="M7 12h10"/><path d="M12 7v10"/></svg></div>
                    <span>收付款</span>
                  </button>
                  <button className="cp-ledger-btn">
                    <div className="cp-ledger-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/><line x1="10" x2="8" y1="9" y2="9"/></svg></div>
                    <span>明细</span>
                  </button>
                  <button className="cp-ledger-btn">
                    <div className="cp-ledger-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>
                    <span>安全</span>
                  </button>
                  <button className="cp-ledger-btn">
                    <div className="cp-ledger-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg></div>
                    <span>管理</span>
                  </button>
                </div>
              </section>
            )}

            <section className="cp-premium-activities">
              <div className="cp-premium-section-title">
                {activeAccount ? `${activeAccount.title} 流水` : "近期变动"}
              </div>
              <div className="cp-premium-activity-list">
                {(() => {
                  const groups: { dateLabel: string; activities: typeof activeAccountActivities }[] = [];
                  let currentLabel = "";
                  let currentGroup: typeof activeAccountActivities = [];

                  const today = new Date();
                  const yesterday = new Date(today);
                  yesterday.setDate(yesterday.getDate() - 1);

                  for (const activity of activeAccountActivities) {
                    const date = new Date(activity.createdAt);
                    let label = "";
                    if (Number.isNaN(date.getTime())) {
                      label = "未知";
                    } else if (isSameLocalDay(date, today)) {
                      label = "今天";
                    } else if (isSameLocalDay(date, yesterday)) {
                      label = "昨天";
                    } else {
                      label = `${date.getMonth() + 1}月${date.getDate()}日`;
                      if (date.getFullYear() !== today.getFullYear()) {
                         label = `${date.getFullYear()}年${label}`;
                      }
                    }

                    if (label !== currentLabel) {
                      if (currentGroup.length > 0) {
                        groups.push({ dateLabel: currentLabel, activities: currentGroup });
                      }
                      currentLabel = label;
                      currentGroup = [activity];
                    } else {
                      currentGroup.push(activity);
                    }
                  }
                  if (currentGroup.length > 0) {
                    groups.push({ dateLabel: currentLabel, activities: currentGroup });
                  }

                  return groups.map(group => (
                    <div key={group.dateLabel} className="cp-premium-activity-group">
                      <div className="cp-premium-activity-date">{group.dateLabel}</div>
                      <div className="cp-premium-activity-group-items">
                      {group.activities.map((activity) => {
                        const date = new Date(activity.createdAt);
                        const timeLabel = Number.isNaN(date.getTime()) 
                          ? "" 
                          : `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
                        return (
                          <button
                            key={activity.id}
                            type="button"
                            className="cp-premium-activity-card"
                            onClick={() => handleOpenActivity(activity.id)}
                          >
                            <div className="cp-activity-icon">
                              {activity.amount.trim().startsWith("-") ? (
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="cp-icon-expense"><path d="m6 9 6 6 6-6"/></svg>
                              ) : (
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="cp-icon-income"><path d="m18 15-6-6-6 6"/></svg>
                              )}
                            </div>
                            <div className="cp-activity-info">
                              <span className="cp-activity-title"><CheckPhoneBilingualText text={activity.title} tone="assets" /></span>
                              <span className="cp-activity-time">{timeLabel} · {activity.category}</span>
                            </div>
                            <div className={`cp-activity-amount ${getActivityAmountClass(activity.amount)}`}>
                              {activity.amount}
                            </div>
                          </button>
                        );
                      })}
                      </div>
                    </div>
                  ));
                })()}
              </div>
            </section>
          </div>
        )}

        {payload && selectedActivity && (
          <div className="cp-assets-scroll">
            <article className="cp-premium-detail">
              <div className="cp-premium-detail-card">
                <div className="cp-detail-icon-wrap">
                   <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/><line x1="10" x2="8" y1="9" y2="9"/></svg>
                </div>
                <h3><CheckPhoneBilingualText text={selectedActivity.title} tone="assets" /></h3>
                <div className="cp-premium-detail-kicker">{selectedActivity.category}</div>
                <div className={`cp-premium-detail-amount ${getActivityAmountClass(selectedActivity.amount)}`}>
                  {selectedActivity.amount}
                </div>
                <div className="cp-premium-detail-time">{getAssetActivityTimeLabel(selectedActivity.createdAt)}</div>
              </div>
              <div className="cp-premium-detail-body">
                <div className="cp-premium-detail-row">
                  <span>关联账户</span>
                  <b>{accounts.find((account) => account.id === selectedActivity.accountId)?.title ?? "账户"}</b>
                </div>
                <div className="cp-premium-detail-row">
                  <span>交易单号</span>
                  <b className="cp-mono-text">{generateTransactionNo(selectedActivity)}</b>
                </div>
                <div className="cp-premium-detail-divider"></div>
                <div className="cp-premium-detail-row cp-col-row">
                  <span>记录说明</span>
                  <p><CheckPhoneBilingualText text={selectedActivity.detail} tone="assets" /></p>
                </div>
              </div>
            </article>
          </div>
        )}
      </div>
      {confirmClearOpen && (
        <ConfirmDialog
          title="清空资产内容？"
          message="确认后会清空当前资产缓存。之后重新刷新时，不会再带入旧资产内容。"
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
