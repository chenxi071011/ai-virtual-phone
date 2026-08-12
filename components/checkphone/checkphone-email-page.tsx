"use client";

import { useEffect, useMemo, useState } from "react";
import { appNowISO } from "@/lib/app-clock";
import { useCheckPhoneRefresh } from "@/lib/checkphone-refresh-tracker";
import { ChevronLeft, Paperclip, RefreshCw, Star, Trash2, Menu, Edit2, Mail, Video, Archive, MoreVertical, ChevronDown, CornerUpLeft, CornerUpRight, Smile } from "lucide-react";
import { CheckPhoneBilingualText } from "@/components/checkphone/checkphone-bilingual-text";
import { CheckPhoneDebugErrorCard } from "@/components/checkphone/checkphone-debug-error-card";
import { ConfirmDialog } from "@/components/ui";
import type { Character } from "@/lib/character-types";
import type {
  CheckPhoneEmailItem,
  CheckPhoneEmailPayload,
  CheckPhoneSnapshot,
} from "@/lib/checkphone-config";
import { generateCheckPhoneEmail } from "@/lib/checkphone-engine";
import { clearPhoneSnapshot, loadPhoneSnapshot, savePhoneSnapshot } from "@/lib/checkphone-storage";
import { normalizeBilingualTextInput, splitBilingualText } from "@/lib/bilingual-text";

type CheckPhoneEmailPageProps = {
  character: Character;
  onBack: () => void;
};

function parseEmailTimeLabel(label: string): Date | null {
  const match = label.match(/^(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const [, monthRaw, dayRaw, hourRaw, minuteRaw] = match;
  const now = new Date();
  let year = now.getFullYear();
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  let candidate = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (Number.isNaN(candidate.getTime())) return null;
  if (candidate.getTime() - now.getTime() > 36 * 60 * 60 * 1000) {
    year -= 1;
    candidate = new Date(year, month - 1, day, hour, minute, 0, 0);
  }
  return Number.isNaN(candidate.getTime()) ? null : candidate;
}

function formatEmailTimeLabel(label: string): string {
  const parsed = parseEmailTimeLabel(label);
  if (!parsed) return label;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(todayStart.getDate() - 1);
  const hh = String(parsed.getHours()).padStart(2, "0");
  const mm = String(parsed.getMinutes()).padStart(2, "0");
  if (parsed >= todayStart) return `今天 ${hh}:${mm}`;
  if (parsed >= yesterdayStart) return `昨天 ${hh}:${mm}`;
  return label;
}

function getEmailListPlainText(text: string): string {
  const normalized = normalizeBilingualTextInput(text);
  return splitBilingualText(normalized)?.original ?? normalized;
}

export function CheckPhoneEmailPage({ character, onBack }: CheckPhoneEmailPageProps) {
  const [snapshot, setSnapshot] = useState<CheckPhoneSnapshot<CheckPhoneEmailPayload> | null>(null);
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useCheckPhoneRefresh(character.id, "email", setSnapshot);
  const [error, setError] = useState<string | null>(null);
  const [debugRawOutput, setDebugRawOutput] = useState<string | null>(null);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setError(null);
    setDebugRawOutput(null);
    setSnapshot(null);
    setSelectedEmailId(null);
    (async () => {
      const cached = await loadPhoneSnapshot<CheckPhoneEmailPayload>(character.id, "email");
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
    } = await generateCheckPhoneEmail(
      character.id,
      snapshot?.payload ?? null,
      snapshot?.updatedAt,
    );
    if (payload) {
      const now = appNowISO();
      const nextSnapshot: CheckPhoneSnapshot<CheckPhoneEmailPayload> = {
        id: `${character.id}:email`,
        characterId: character.id,
        appId: "email",
        generatedAt: snapshot?.generatedAt ?? now,
        updatedAt: now,
        summary,
        payload,
      };
      await savePhoneSnapshot(nextSnapshot);
      setSnapshot(nextSnapshot);
      setSelectedEmailId(null);
    }
    setError(nextError ?? null);
    setDebugRawOutput(nextDebugRawOutput ?? null);
    setLoading(false);
    setLoaded(true);
  }

  async function handleClear() {
    if (loading) return;
    await clearPhoneSnapshot(character.id, "email");
    setSnapshot(null);
    setSelectedEmailId(null);
    setError(null);
    setDebugRawOutput(null);
    setLoaded(true);
    setConfirmClearOpen(false);
  }

  const payload = snapshot?.payload ?? null;
  const emails = useMemo(
    () =>
      (payload?.emails ?? [])
        .map((email, index) => ({
          ...email,
          displayTimeLabel: formatEmailTimeLabel(email.timeLabel),
          sortTimestamp: parseEmailTimeLabel(email.timeLabel)?.getTime() ?? Number.NEGATIVE_INFINITY,
          originalIndex: index,
        }))
        .sort((a, b) => {
          if (a.sortTimestamp !== b.sortTimestamp) return b.sortTimestamp - a.sortTimestamp;
          return a.originalIndex - b.originalIndex;
        }),
    [payload?.emails],
  );
  const activeEmail = useMemo(
    () => emails.find((email) => email.id === selectedEmailId) ?? null,
    [emails, selectedEmailId],
  );

  // A simple deterministic color generator for avatars
  const getAvatarColor = (name: string) => {
    const colors = [
      "#ef5350", "#ec407a", "#ab47bc", "#7e57c2", "#5c6bc0", 
      "#42a5f5", "#26c6da", "#26a69a", "#66bb6a", "#9ccc65", 
      "#ffa726", "#ff7043", "#8d6e63", "#78909c"
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  };

  return (
    <div className="cp-email-module">
      {/* 
        LIST VIEW 
      */}
      {!activeEmail && (
        <div className="cp-email-list-view">
          <header className="cp-email-md-appbar">
            <div className="cp-email-search-bar">
              <button 
                 className="cp-email-icon-btn" 
                 onClick={onBack} 
                 title="返回桌面"
              >
                <ChevronLeft size={24} strokeWidth={2.5} color="#444746" />
              </button>
              <input type="text" placeholder="搜索邮件" className="cp-email-search-input" readOnly />
              <button
                 className="cp-email-icon-btn"
                 onClick={handleRefresh}
                 disabled={loading}
                 title="刷新邮件"
                 style={{ transform: "translateX(8px)" }}
              >
                <RefreshCw size={20} className={loading ? "cp-spin" : ""} color="#444746" />
              </button>
              <button
                 className="cp-email-icon-btn"
                 onClick={() => setConfirmClearOpen(true)}
                 title="清空缓存"
              >
                <Trash2 size={20} color="#444746" />
              </button>
              <div className="cp-email-search-avatar">
                {character.name ? character.name.charAt(0).toUpperCase() : 'U'}
              </div>
            </div>
          </header>

          <div className="cp-email-list-container">
            {payload ? <div className="cp-email-list-label">主要</div> : null}

            {loading && (
              <div className="cp-email-status">正在刷新...</div>
            )}
            
            {loaded && !payload && !loading && (
              <div className="cp-email-status cp-empty-copy">
                <p>暂无邮件内容</p>
                <span>点刷新同步收件箱和邮件记录</span>
              </div>
            )}

            {error ? <CheckPhoneDebugErrorCard error={error} debugRawOutput={debugRawOutput} /> : null}

            {payload && (
              <div className="cp-email-list">
                {emails.map((email, index) => {
                  const avatarStyle = { background: getAvatarColor(email.senderName), color: "#fff" };

                  return (
                    <button
                      key={email.id}
                      type="button"
                      className={`cp-email-item ${email.unread ? "is-unread" : ""}`}
                      onClick={() => setSelectedEmailId(email.id)}
                      style={{ animationDelay: `${index * 0.03}s` }}
                    >
                      <div className="cp-email-item-avatar" style={avatarStyle}>
                        {email.senderName.charAt(0).toUpperCase()}
                      </div>
                      <div className="cp-email-item-content">
                        <div className="cp-email-item-header">
                          <strong className="cp-email-item-sender">
                            {email.unread && email.senderName.includes("Google") && <span className="cp-email-check-icon">✅</span>}
                            {getEmailListPlainText(email.senderName)}
                          </strong>
                          <span className="cp-email-item-time">{email.displayTimeLabel}</span>
                        </div>
                        <div className="cp-email-item-subject">
                          {getEmailListPlainText(email.subject)}
                        </div>
                        <div className="cp-email-item-preview">
                          {getEmailListPlainText(email.preview)}
                        </div>
                      </div>
                      <div className="cp-email-item-actions">
                        <Star size={20} strokeWidth={email.starred ? 2.5 : 1.5} className={email.starred ? 'cp-email-star-active' : 'cp-email-star'} />
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <button className="cp-email-fab" type="button">
            <Edit2 size={20} strokeWidth={2.5} color="#001d35" />
            <span style={{ color: "#001d35", fontWeight: 500 }}>写邮件</span>
          </button>

          <nav className="cp-email-bottom-nav">
            <div className="cp-email-nav-item is-active">
              <div className="cp-email-nav-icon-wrapper">
                <Mail size={22} fill="currentColor" />
              </div>
            </div>
            <div className="cp-email-nav-item">
              <div className="cp-email-nav-icon-wrapper">
                <Video size={24} strokeWidth={1.5} />
              </div>
            </div>
          </nav>
        </div>
      )}

      {/* 
        DETAIL VIEW 
      */}
      {payload && activeEmail && (
        <div className="cp-email-detail-view">
          <header className="cp-email-detail-topbar">
            <button className="cp-email-icon-btn" onClick={() => setSelectedEmailId(null)}>
               <ChevronLeft size={24} />
            </button>
            <div className="cp-email-detail-top-actions">
              <button className="cp-email-icon-btn"><Archive size={20} /></button>
              <button className="cp-email-icon-btn"><Mail size={20} /></button>
              <button className="cp-email-icon-btn"><MoreVertical size={20} /></button>
            </div>
          </header>

          <div className="cp-email-detail-scroll">
            <div className="cp-email-detail-subject-row">
               <div className="cp-email-detail-subject-text">
                 <h2><CheckPhoneBilingualText text={activeEmail.subject} tone="email" variant="inline" /></h2>
                 <span className="cp-email-tag">收件箱</span>
               </div>
               <button className="cp-email-star-btn">
                 <Star size={22} strokeWidth={1.5} />
               </button>
            </div>

            <div className="cp-email-detail-sender-row">
              <div className="cp-email-item-avatar" style={{ background: getAvatarColor(activeEmail.senderName), color: "#fff" }}>
                {activeEmail.senderName.charAt(0).toUpperCase()}
              </div>
              <div className="cp-email-detail-sender-info">
                <div className="cp-email-sender-name-line">
                  <strong>{activeEmail.senderName}</strong>
                  <span className="cp-email-detail-time">{activeEmail.displayTimeLabel}</span>
                </div>
                <div className="cp-email-detail-to">
                  发给 me <ChevronDown size={14} />
                </div>
              </div>
              <div className="cp-email-detail-sender-actions">
                <button className="cp-email-icon-btn"><Smile size={20}/></button>
                <button className="cp-email-icon-btn"><CornerUpLeft size={20}/></button>
                <button className="cp-email-icon-btn"><MoreVertical size={20}/></button>
              </div>
            </div>

            <div className="cp-email-detail-body">
              <CheckPhoneBilingualText text={activeEmail.body} tone="email" />
              {activeEmail.attachmentLabel ? (
                <div className="cp-email-attachment">
                  <Paperclip size={14} />
                  {activeEmail.attachmentLabel}
                </div>
              ) : null}
            </div>
          </div>

          <div className="cp-email-detail-bottom-actions">
             <button className="cp-email-action-pill"><CornerUpLeft size={16}/> 回复</button>
             <button className="cp-email-action-pill"><CornerUpRight size={16}/> 转发</button>
             <button className="cp-email-action-circle"><Smile size={18}/></button>
          </div>
        </div>
      )}

      {confirmClearOpen && (
        <ConfirmDialog
          title="清空邮箱内容？"
          message="确认后会清空当前邮箱缓存。之后重新刷新时，不会再带入旧邮箱内容。"
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
