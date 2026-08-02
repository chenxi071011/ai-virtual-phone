"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Clock3, Droplets, MapPin, Plus, Wand2, Trash2, Bot, Check, Palette, X, HeartPulse, MoreHorizontal } from "lucide-react";
import { Avatar, EmptyState, GlassCard } from "./ui/primitives";
import { SessionCustomCSS } from "@/components/ui/session-custom-css";
import { Input, Select } from "./ui/form";
import type { CalendarOwnerType, CalendarScheduleItem, CalendarWeekPlan } from "@/lib/calendar-types";
import {
  deleteCalendarScheduleItem,
  loadCalendarConfig,
  loadCalendarWeekPlan,
  loadOwnerCalendarPlans,
  saveCalendarConfig,
  upsertCalendarScheduleItem,
  validateScheduleDraft,
} from "@/lib/calendar-storage";
import { createDefaultScheduleDraft, generateWeeklyCalendarSchedule } from "@/lib/calendar-engine";
import { loadCharacters } from "@/lib/character-storage";
import { loadChatSessions } from "@/lib/chat-storage";
import { resolveUserIdentity } from "@/lib/settings-storage";
import {
  CALENDAR_HOUR_END,
  CALENDAR_HOUR_START,
  formatIsoDate,
  formatMonthDay,
  formatWeekRangeLabel,
  getMonthMatrix,
  getWeekDates,
  getWeekStartIso,
  getWeekdayLabel,
  isDateInWeek,
  isSameMonth,
  parseIsoDate,
  pickScheduleColorKey,
  timeToMinutes,
} from "@/lib/calendar-utils";
import {
  buildMenstrualDayMap,
  cancelFinishCurrentPeriod,
  cancelCurrentPeriodStart,
  finishCurrentPeriod,
  deleteMenstrualRecord,
  getMenstrualSummary,
  loadMenstrualConfig,
  loadMenstrualRecords,
  saveMenstrualConfig,
  startCurrentPeriod,
  validateMenstrualSettings,
  type MenstrualRecord,
} from "@/lib/menstrual-storage";

type OwnerOption = {
  key: string;
  ownerType: CalendarOwnerType;
  ownerId: string;
  name: string;
  avatar?: string | null;
};

type PeriodCareCharacterOption = {
  characterId: string;
  name: string;
  avatar?: string | null;
};

const TOTAL_MINUTES = (CALENDAR_HOUR_END - CALENDAR_HOUR_START) * 60;

function buildOwnerOptions(): OwnerOption[] {
  const options: OwnerOption[] = [];
  const identity = resolveUserIdentity(undefined, "calendar") ?? resolveUserIdentity() ?? null;
  options.push({
    key: "user:me",
    ownerType: "user",
    ownerId: "self",
    name: identity?.name?.trim() || "我",
    avatar: identity?.avatarUrl || null,
  });
  for (const char of loadCharacters()) {
    options.push({
      key: `character:${char.id}`,
      ownerType: "character",
      ownerId: char.id,
      name: char.name,
      avatar: char.avatar,
    });
  }
  return options;
}

function buildPeriodCareCharacterOptions(): PeriodCareCharacterOption[] {
  const characters = loadCharacters();
  const characterById = new Map(characters.map(char => [char.id, char]));
  const latestSessionByCharacter = new Map<string, ReturnType<typeof loadChatSessions>[number]>();
  for (const session of loadChatSessions()) {
    if (session.isGroup) continue;
    const character = characterById.get(session.contactId);
    if (!character) continue;
    const existing = latestSessionByCharacter.get(session.contactId);
    if (!existing || session.updatedAt > existing.updatedAt) {
      latestSessionByCharacter.set(session.contactId, session);
    }
  }
  return Array.from(latestSessionByCharacter.values())
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(session => {
      const character = characterById.get(session.contactId)!;
      return {
        characterId: character.id,
        name: session.alias || character.name,
        avatar: character.avatar,
      };
    });
}

function CalendarGeneratingLabel({ loading, idle }: { loading: boolean; idle: string }) {
  if (!loading) return <>{idle}</>;
  return (
    <span className="calendar-generating-label">
      生成中
      <span className="calendar-generating-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </span>
  );
}

import { CALENDAR_CSS_EXAMPLE } from "@/lib/css-examples";
import CSSSchemeBar from "@/components/ui/css-scheme-picker";
import { kvGet, kvSet, kvRemove } from "@/lib/kv-db";

export function PhoneCalendarApp({
  onClose,
  onNotice,
}: {
  onClose: () => void;
  onNotice?: (text: string) => void;
}) {
  const [owners, setOwners] = useState<OwnerOption[]>(() => buildOwnerOptions());
  const [selectedKey, setSelectedKey] = useState<string>(() => buildOwnerOptions()[0]?.key ?? "user:me");
  const [weekStart, setWeekStart] = useState<string>(() => getWeekStartIso(new Date()));
  const [selectedDate, setSelectedDate] = useState<string>(() => formatIsoDate(new Date()));
  const [monthExpanded, setMonthExpanded] = useState(false);
  const [plan, setPlan] = useState<CalendarWeekPlan | null>(null);
  const [ownerPlans, setOwnerPlans] = useState<CalendarWeekPlan[]>([]);
  const [config, setConfig] = useState(() => loadCalendarConfig());
  const [menstrualConfig, setMenstrualConfig] = useState(() => loadMenstrualConfig());
  const [menstrualRecords, setMenstrualRecords] = useState<MenstrualRecord[]>(() => loadMenstrualRecords());
  const autoGenerateEnabled = config.autoGenerateEnabled;
  const [showThemePanel, setShowThemePanel] = useState(false);
  const [showMenstrualSettings, setShowMenstrualSettings] = useState(false);
  const [menstrualDraft, setMenstrualDraft] = useState<{
    cycleLength: string;
    periodLength: string;
    periodCareEnabled: boolean;
    periodCareCharacterIds: string[];
    periodCareLeadDays: "1" | "2" | "3";
  }>(() => {
    const initial = loadMenstrualConfig();
    return {
      cycleLength: String(initial.cycleLength),
      periodLength: String(initial.periodLength),
      periodCareEnabled: initial.periodCareEnabled,
      periodCareCharacterIds: initial.periodCareCharacterIds,
      periodCareLeadDays: String(initial.periodCareLeadDays) as "1" | "2" | "3",
    };
  });
  const [calendarCustomCss, setCalendarCustomCss] = useState(() =>
    typeof window !== "undefined" ? kvGet("calendar-custom-css") || "" : ""
  );
  const [appliedCalendarCss, setAppliedCalendarCss] = useState(() =>
    typeof window !== "undefined" ? kvGet("calendar-custom-css") || "" : ""
  );
  const handleApplyCalendarCss = () => {
    const trimmed = calendarCustomCss.trim();
    if (trimmed) kvSet("calendar-custom-css", trimmed);
    else kvRemove("calendar-custom-css");
    setAppliedCalendarCss(trimmed);
    window.dispatchEvent(new CustomEvent("calendar-css-updated", { detail: trimmed }));
  };
  // Listen for live CSS updates from 小卷
  useEffect(() => {
    const onCSSUpdate = (e: Event) => {
      const css = (e as CustomEvent).detail || "";
      setAppliedCalendarCss(css);
      setCalendarCustomCss(css);
    };
    window.addEventListener("calendar-css-updated", onCSSUpdate);
    return () => window.removeEventListener("calendar-css-updated", onCSSUpdate);
  }, []);
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showGenerateConfirm, setShowGenerateConfirm] = useState(false);
  const [showAutoConfirm, setShowAutoConfirm] = useState(false);
  const autoAttemptedRef = useRef<Set<string>>(new Set());
  const [editingItem, setEditingItem] = useState<{
    id?: string;
    date: string;
    startTime: string;
    endTime: string;
    location: string;
    title: string;
  } | null>(null);

  const selectedOwner = useMemo(
    () => owners.find(owner => owner.key === selectedKey) ?? owners[0] ?? null,
    [owners, selectedKey],
  );
  const weekEventCount = plan?.items.length ?? 0;

  const weekDates = useMemo(() => getWeekDates(weekStart), [weekStart]);
  const monthMatrix = useMemo(() => getMonthMatrix(weekStart), [weekStart]);
  const monthDates = useMemo(() => monthMatrix.flat(), [monthMatrix]);
  const itemsByDate = useMemo(() => {
    const map = new Map<string, CalendarScheduleItem[]>();
    for (const item of plan?.items ?? []) {
      const list = map.get(item.date) || [];
      list.push(item);
      list.sort((a, b) => a.startTime.localeCompare(b.startTime));
      map.set(item.date, list);
    }
    return map;
  }, [plan]);
  const countsByDate = useMemo(() => {
    const map = new Map<string, number>();
    for (const ownerPlan of ownerPlans) {
      for (const item of ownerPlan.items) {
        map.set(item.date, (map.get(item.date) || 0) + 1);
      }
    }
    return map;
  }, [ownerPlans]);
  const menstrualDayMap = useMemo(() => {
    if (selectedOwner?.ownerType !== "user" || monthDates.length === 0) return new Map();
    return buildMenstrualDayMap(monthDates[0], monthDates[monthDates.length - 1], menstrualRecords, menstrualConfig);
  }, [selectedOwner, monthDates, menstrualRecords, menstrualConfig]);
  const weekMenstrualMap = useMemo(() => {
    if (selectedOwner?.ownerType !== "user" || weekDates.length === 0) return new Map();
    return buildMenstrualDayMap(weekDates[0], weekDates[weekDates.length - 1], menstrualRecords, menstrualConfig);
  }, [selectedOwner, weekDates, menstrualRecords, menstrualConfig]);
  const menstrualSummary = useMemo(() => getMenstrualSummary(menstrualRecords, menstrualConfig, selectedDate), [menstrualRecords, menstrualConfig, selectedDate]);
  const periodCareCharacterOptions = useMemo(
    () => showMenstrualSettings ? buildPeriodCareCharacterOptions() : [],
    [showMenstrualSettings],
  );

  useEffect(() => {
    setOwners(buildOwnerOptions());
  }, []);

  const ownerStripRef = useRef<HTMLElement>(null);
  const isDragging = useRef(false);
  const isClicking = useRef(false);
  const startX = useRef(0);
  const scrollLeft = useRef(0);
  const scrollTimeout = useRef<NodeJS.Timeout | undefined>(undefined);

  useEffect(() => {
    if (!selectedOwner) return;
    setPlan(loadCalendarWeekPlan(selectedOwner.ownerType, selectedOwner.ownerId, weekStart));
    setOwnerPlans(loadOwnerCalendarPlans(selectedOwner.ownerType, selectedOwner.ownerId));

    // Smooth scroll the selected avatar into view if clicked
    if (isClicking.current) {
      setTimeout(() => {
        if (ownerStripRef.current) {
          const activeEl = ownerStripRef.current.querySelector('[data-active="true"]') as HTMLElement;
          if (activeEl) {
            const container = ownerStripRef.current;
            const targetScroll = activeEl.offsetLeft - container.clientWidth / 2 + activeEl.clientWidth / 2;
            container.scrollTo({ left: targetScroll, behavior: 'smooth' });
          }
        }
        setTimeout(() => { isClicking.current = false; }, 300);
      }, 50);
    }
  }, [selectedOwner, weekStart]);

  // Listen for cross-app calendar updates (e.g. action-parser dispatches from chat)
  useEffect(() => {
    const handler = () => {
      if (!selectedOwner) return;
      setPlan(loadCalendarWeekPlan(selectedOwner.ownerType, selectedOwner.ownerId, weekStart));
      setOwnerPlans(loadOwnerCalendarPlans(selectedOwner.ownerType, selectedOwner.ownerId));
    };
    window.addEventListener("calendar-updated", handler);
    return () => window.removeEventListener("calendar-updated", handler);
  }, [selectedOwner, weekStart]);

  const handleScroll = () => {
    if (!ownerStripRef.current || isDragging.current || isClicking.current) return;
    clearTimeout(scrollTimeout.current);
    scrollTimeout.current = setTimeout(() => {
      const container = ownerStripRef.current;
      if (!container) return;
      const center = container.scrollLeft + container.clientWidth / 2;
      let minDistance = Infinity;
      let closestKey: string | null = null;
      
      Array.from(container.children).forEach((child: any) => {
        // Calculate child's absolute center relative to scroll container
        const childCenter = child.offsetLeft + child.clientWidth / 2 - container.offsetLeft;
        const dist = Math.abs(childCenter - center);
        if (dist < minDistance) {
          minDistance = dist;
          closestKey = child.getAttribute('data-key');
        }
      });
      
      if (closestKey && closestKey !== selectedKey) {
        setSelectedKey(closestKey);
        setWeekStart(getWeekStartIso(new Date()));
      }
    }, 150); // wait for scroll to snap
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!ownerStripRef.current) return;
    isDragging.current = true;
    startX.current = e.pageX - ownerStripRef.current.offsetLeft;
    scrollLeft.current = ownerStripRef.current.scrollLeft;
  };

  const snapToClosest = () => {
    if (!ownerStripRef.current) return;
    const container = ownerStripRef.current;
    const center = container.scrollLeft + container.clientWidth / 2;
    let minDistance = Infinity;
    let closestKey: string | null = null;
    let closestChild: HTMLElement | null = null;

    Array.from(container.children).forEach((child: any) => {
      const childCenter = child.offsetLeft + child.clientWidth / 2 - container.offsetLeft;
      const dist = Math.abs(childCenter - center);
      if (dist < minDistance) {
        minDistance = dist;
        closestKey = child.getAttribute('data-key');
        closestChild = child;
      }
    });

    if (closestChild) {
      const targetScroll = (closestChild as HTMLElement).offsetLeft - container.clientWidth / 2 + (closestChild as HTMLElement).clientWidth / 2;
      container.scrollTo({ left: targetScroll, behavior: 'smooth' });
    }
    if (closestKey && closestKey !== selectedKey) {
      setSelectedKey(closestKey);
      setWeekStart(getWeekStartIso(new Date()));
    }
  };

  const handleMouseLeave = () => {
    if (isDragging.current) {
      isDragging.current = false;
      snapToClosest();
    }
  };

  const handleMouseUp = () => {
    if (isDragging.current) {
      isDragging.current = false;
      snapToClosest();
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging.current || !ownerStripRef.current) return;
    e.preventDefault();
    const x = e.pageX - ownerStripRef.current.offsetLeft;
    const walk = (x - startX.current) * 1.5; 
    ownerStripRef.current.scrollLeft = scrollLeft.current - walk;
  };

  useEffect(() => {
    if (!selectedOwner || !autoGenerateEnabled || selectedOwner.ownerType !== "character" || isGenerating) return;
    const autoKey = `${selectedOwner.ownerType}:${selectedOwner.ownerId}:${weekStart}`;
    if (autoAttemptedRef.current.has(autoKey)) return;
    const existing = loadCalendarWeekPlan(selectedOwner.ownerType, selectedOwner.ownerId, weekStart);
    if (existing && existing.items.length > 0) return;
    void (async () => {
      autoAttemptedRef.current.add(autoKey);
      setIsGenerating(true);
      const result = await generateWeeklyCalendarSchedule(selectedOwner.ownerType, selectedOwner.ownerId, weekStart);
      setIsGenerating(false);
      if (!result.success) {
        onNotice?.(result.error || "自动生成失败");
        return;
      }
      refreshPlans();
      onNotice?.("已自动生成本周角色日程");
    })();
  }, [autoGenerateEnabled, isGenerating, onNotice, selectedOwner, weekStart]);

  const refreshPlans = () => {
    if (!selectedOwner) return;
    setPlan(loadCalendarWeekPlan(selectedOwner.ownerType, selectedOwner.ownerId, weekStart));
    setOwnerPlans(loadOwnerCalendarPlans(selectedOwner.ownerType, selectedOwner.ownerId));
  };

  const moveWeek = (delta: number) => {
    const next = parseIsoDate(weekStart);
    next.setDate(next.getDate() + delta * 7);
    setWeekStart(getWeekStartIso(next));
    const nextSelected = parseIsoDate(selectedDate);
    nextSelected.setDate(nextSelected.getDate() + delta * 7);
    setSelectedDate(formatIsoDate(nextSelected));
  };

  const handleGenerate = async () => {
    if (!selectedOwner || isGenerating || selectedOwner.ownerType !== "character") return;
    setShowGenerateConfirm(false);
    setIsGenerating(true);
    const result = await generateWeeklyCalendarSchedule(selectedOwner.ownerType, selectedOwner.ownerId, weekStart);
    setIsGenerating(false);
    if (!result.success) {
      onNotice?.(result.error || "生成失败");
      return;
    }
    refreshPlans();
    onNotice?.("本周日程已生成");
  };

  const handleSaveDraft = () => {
    if (!selectedOwner || !editingItem) return;
    const error = validateScheduleDraft(editingItem);
    if (error) {
      onNotice?.(error);
      return;
    }
    upsertCalendarScheduleItem(selectedOwner.ownerType, selectedOwner.ownerId, weekStart, {
      id: editingItem.id,
      date: editingItem.date,
      startTime: editingItem.startTime,
      endTime: editingItem.endTime,
      location: editingItem.location,
      title: editingItem.title,
      source: "manual",
      colorKey: pickScheduleColorKey(editingItem.startTime),
    });
    setEditingItem(null);
    refreshPlans();
    onNotice?.("日程已保存");
  };

  const handleDeleteItem = () => {
    if (!selectedOwner || !editingItem?.id) return;
    deleteCalendarScheduleItem(selectedOwner.ownerType, selectedOwner.ownerId, weekStart, editingItem.id);
    setEditingItem(null);
    refreshPlans();
    onNotice?.("日程已删除");
  };

  const refreshMenstrual = () => {
    setMenstrualConfig(loadMenstrualConfig());
    setMenstrualRecords(loadMenstrualRecords());
  };

  const openMenstrualSettings = () => {
    setMenstrualDraft({
      cycleLength: String(menstrualConfig.cycleLength),
      periodLength: String(menstrualConfig.periodLength),
      periodCareEnabled: menstrualConfig.periodCareEnabled,
      periodCareCharacterIds: menstrualConfig.periodCareCharacterIds,
      periodCareLeadDays: String(menstrualConfig.periodCareLeadDays) as "1" | "2" | "3",
    });
    setShowMenstrualSettings(true);
  };

  const togglePeriodCareCharacter = (characterId: string) => {
    setMenstrualDraft(prev => {
      const selected = new Set(prev.periodCareCharacterIds);
      if (selected.has(characterId)) selected.delete(characterId);
      else selected.add(characterId);
      return { ...prev, periodCareCharacterIds: Array.from(selected) };
    });
  };

  const handleSaveMenstrualSettings = () => {
    const cycleLength = Number(menstrualDraft.cycleLength);
    const periodLength = Number(menstrualDraft.periodLength);
    const error = validateMenstrualSettings({ cycleLength, periodLength });
    if (error) {
      onNotice?.(error);
      return;
    }
    const availableCharacterIds = new Set(periodCareCharacterOptions.map(option => option.characterId));
    const periodCareCharacterIds = menstrualDraft.periodCareCharacterIds.filter(id => availableCharacterIds.has(id));
    if (menstrualDraft.periodCareEnabled && periodCareCharacterIds.length === 0) {
      onNotice?.("请选择至少一个已有聊天角色");
      return;
    }
    const savedConfig = saveMenstrualConfig({
      ...menstrualConfig,
      cycleLength,
      periodLength,
      periodCareEnabled: menstrualDraft.periodCareEnabled,
      periodCareCharacterIds,
      periodCareLeadDays: Number(menstrualDraft.periodCareLeadDays) as 1 | 2 | 3,
    });
    setMenstrualConfig(savedConfig);
    window.dispatchEvent(new CustomEvent("menstrual-period-care-updated"));
    setShowMenstrualSettings(false);
    onNotice?.("周期设置已保存");
  };

  const handleDeleteMenstrual = (recordId: string) => {
    setMenstrualRecords(deleteMenstrualRecord(recordId));
    refreshMenstrual();
    onNotice?.("经期记录已删除");
  };

  const handleStartMenstrual = () => {
    setMenstrualConfig(startCurrentPeriod(selectedDate));
    setMenstrualRecords(loadMenstrualRecords());
    onNotice?.("已记录经期来了");
  };

  const handleCancelMenstrualStart = () => {
    setMenstrualConfig(cancelCurrentPeriodStart(selectedDate));
    setMenstrualRecords(loadMenstrualRecords());
    onNotice?.("已取消这一天的经期来了");
  };

  const handleFinishMenstrual = () => {
    const result = finishCurrentPeriod(selectedDate);
    if (!result.saved) {
      onNotice?.("请先记录经期来了");
      return;
    }
    setMenstrualConfig(result.config);
    setMenstrualRecords(result.records);
    onNotice?.("已记录经期走了");
  };

  const handleCancelMenstrualFinish = () => {
    const result = cancelFinishCurrentPeriod(selectedDate);
    if (!result.restored) {
      onNotice?.("这一天还没有记录经期走了");
      return;
    }
    setMenstrualConfig(result.config);
    setMenstrualRecords(result.records);
    onNotice?.("已取消这一天的经期走了");
  };

  const formatSimpleDate = (dateText: string | null) => {
    if (!dateText) return "待记录";
    const date = parseIsoDate(dateText);
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  };

  const todayIso = formatIsoDate(new Date());
  const canCancelSelectedStart = menstrualSummary.currentPeriodStartDate === selectedDate && !menstrualSummary.todayFinished;
  const canStartSelected = !menstrualSummary.todayStarted && !menstrualSummary.isPeriodActive;
  const canCancelSelectedFinish = menstrualSummary.todayFinished;
  const canFinishSelected = menstrualSummary.isPeriodActive && !!menstrualSummary.currentPeriodStartDate && selectedDate >= menstrualSummary.currentPeriodStartDate && !menstrualSummary.todayFinished;

  return (
    <div className="calendar-app-shell" data-calendar-theme={config.theme}>
      {appliedCalendarCss && <SessionCustomCSS css={appliedCalendarCss} scope=".calendar-app-shell" />}
      <div className="calendar-app">
        <header className="calendar-header">
          <div className="calendar-header-left">
            <button type="button" className="calendar-header-action" onClick={onClose} aria-label="返回">
              <ChevronLeft size={20} />
            </button>
          </div>
          <div className="calendar-header-center">
            <span className="calendar-header-eyebrow">Weekly Planner</span>
          </div>
          <div className="calendar-header-right">
            <button type="button" className="calendar-header-action" onClick={() => setShowThemePanel(true)} aria-label="主题色">
              <Palette size={18} />
            </button>
          </div>
        </header>

        <div className="calendar-scroll hide-scrollbar">
          <section
            ref={ownerStripRef}
            className="calendar-owner-strip hide-scrollbar"
            onScroll={handleScroll}
            onMouseDown={handleMouseDown}
            onMouseLeave={handleMouseLeave}
            onMouseUp={handleMouseUp}
            onMouseMove={handleMouseMove}
          >
            {owners.map(owner => (
              <button
                key={owner.key}
                type="button"
                className="calendar-owner-chip"
                data-key={owner.key}
                data-active={owner.key === selectedKey ? "true" : undefined}
                onClick={(e) => {
                  if (Math.abs(ownerStripRef.current!.scrollLeft - scrollLeft.current) > 5) {
                    e.preventDefault();
                    return;
                  }
                  isClicking.current = true;
                  setSelectedKey(owner.key);
                  setWeekStart(getWeekStartIso(new Date()));
                  setSelectedDate(formatIsoDate(new Date()));
                }}
              >
                <Avatar src={owner.avatar || undefined} name={owner.name} size="lg" />
                <span>{owner.name}</span>
              </button>
            ))}
          </section>

          <div className="calendar-week-card">
            <div className="calendar-hero">
              <div className="calendar-hero-copy">
                <span className="calendar-hero-kicker">
                  {selectedOwner?.ownerType === "user" ? "手动管理" : "角色周程"}
                </span>
                <div className="calendar-week-title">
                  <strong>{selectedOwner?.name || "日程"}</strong>
                  <span className="calendar-week-owner">{formatWeekRangeLabel(weekStart)}</span>
                </div>
              </div>
              <div className="calendar-hero-stat">
                <span>本周事项</span>
                <strong>{weekEventCount}</strong>
              </div>
            </div>

            <div className="calendar-unified-grid">
              <div className="calendar-unified-weekdays">
                {["一", "二", "三", "四", "五", "六", "日"].map(label => (
                  <span key={label}>{label}</span>
                ))}
              </div>
              <div className="calendar-unified-body">
                {monthMatrix.map((week, weekIdx) => {
                  const isCurrentWeek = week.some(d => isDateInWeek(d, weekStart));
                  if (!monthExpanded && !isCurrentWeek) return null;
                  return (
                    <div
                      key={weekIdx}
                      className="calendar-unified-row"
                      data-current={isCurrentWeek ? "true" : undefined}
                    >
                      {week.map(date => {
                        const hasItems = countsByDate.has(date);
                        const isOutside = !isSameMonth(date, weekStart);
                        const isInWeek = isDateInWeek(date, weekStart);
                        const menstrualState = selectedOwner?.ownerType === "user" ? weekMenstrualMap.get(date) || menstrualDayMap.get(date) : null;
                        return (
                          <button
                            key={date}
                            type="button"
                            className="calendar-unified-cell"
                            data-outside={isOutside ? "true" : undefined}
                            data-in-week={isInWeek ? "true" : undefined}
                            data-has-items={hasItems ? "true" : undefined}
                            data-selected={date === selectedDate ? "true" : undefined}
                            data-today={date === todayIso ? "true" : undefined}
                            data-cycle={menstrualState?.type}
                            onClick={() => {
                              setWeekStart(getWeekStartIso(parseIsoDate(date)));
                              setSelectedDate(date);
                            }}
                          >
                            <span className="calendar-unified-date">{parseIsoDate(date).getDate()}</span>
                            <span className="calendar-unified-indicators">
                              {menstrualState ? <i className="calendar-unified-cycle-dot" data-type={menstrualState.type} /> : null}
                              {hasItems ? <i className="calendar-unified-dot" /> : null}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="calendar-week-header">
              <button type="button" className="calendar-month-toggle" onClick={() => setMonthExpanded(prev => !prev)} aria-label={monthExpanded ? "收起月历" : "展开月历"}>
                <ChevronDown size={16} style={{ transform: monthExpanded ? "rotate(180deg)" : undefined, transition: "transform 0.3s" }} />
              </button>
            </div>
          </div>

          {selectedOwner?.ownerType === "user" ? (
            <div className="calendar-menstrual-card">
              <div className="calendar-menstrual-head">
                <div className="calendar-menstrual-copy">
                  <span className="calendar-menstrual-kicker">Cycle Tracker</span>
                  <div className="calendar-menstrual-title-row">
                    <strong>经期记录</strong>
                    {menstrualSummary.todayState ? (
                      <span className="calendar-menstrual-title-tag" data-type={menstrualSummary.todayState.type}>
                        {menstrualSummary.todayState.shortLabel}
                      </span>
                    ) : null}
                  </div>
                  <span>
                    {menstrualSummary.isPeriodActive
                      ? `本次经期从 ${formatSimpleDate(menstrualSummary.currentPeriodStartDate)} 开始`
                      : menstrualSummary.latest
                        ? "已根据最近记录在日历中标注预测经期和排卵期"
                        : "点按“经期来了”后，会自动开始预测经期和排卵期"}
                  </span>
                </div>
                <button
                  type="button"
                  className="calendar-menstrual-settings-trigger"
                  onClick={openMenstrualSettings}
                  aria-label="周期设置"
                  title="周期设置"
                >
                  <MoreHorizontal size={17} />
                </button>
              </div>

              <div className="calendar-menstrual-action-row">
                <button
                  type="button"
                  className="calendar-menstrual-pill"
                  data-active={menstrualSummary.todayStarted ? "true" : undefined}
                  onClick={canCancelSelectedStart ? handleCancelMenstrualStart : handleStartMenstrual}
                  disabled={!canCancelSelectedStart && !canStartSelected}
                >
                  <span className="calendar-menstrual-pill-label">
                    <Droplets size={12} />
                    经期来了
                  </span>
                  <span className="calendar-menstrual-pill-switch" aria-hidden="true">
                    <span className="calendar-menstrual-pill-switch-thumb" />
                  </span>
                </button>
                <button
                  type="button"
                  className="calendar-menstrual-pill"
                  data-active={menstrualSummary.todayFinished ? "true" : undefined}
                  onClick={canCancelSelectedFinish ? handleCancelMenstrualFinish : handleFinishMenstrual}
                  disabled={!canCancelSelectedFinish && !canFinishSelected}
                >
                  <span className="calendar-menstrual-pill-label">
                    <Droplets size={12} />
                    经期走了
                  </span>
                  <span className="calendar-menstrual-pill-switch" aria-hidden="true">
                    <span className="calendar-menstrual-pill-switch-thumb" />
                  </span>
                </button>
              </div>

              <div className="calendar-menstrual-stats">
                <div className="calendar-menstrual-stat-row">
                  <div className="calendar-menstrual-stat">
                    <span>最近一次</span>
                    <strong>
                      {menstrualSummary.latest
                        ? `${formatSimpleDate(menstrualSummary.latest.startDate)} - ${formatSimpleDate(menstrualSummary.latest.endDate)}`
                        : "暂无记录"}
                    </strong>
                  </div>
                  <div className="calendar-menstrual-stat calendar-menstrual-stat-column-only">
                    <span>周期 / 经期</span>
                    <strong>{menstrualConfig.cycleLength}天 / {menstrualConfig.periodLength}天</strong>
                  </div>
                </div>
              </div>

              <div className="calendar-menstrual-legend">
                <span data-type="period">经期</span>
                <span data-type="predicted_period">预计</span>
                <span data-type="fertile">易孕</span>
                <span data-type="ovulation">排卵</span>
              </div>
            </div>
          ) : null}

          <div className="calendar-grid-card">
            <div className="calendar-grid-header" onClick={() => setExpandedDate(null)} style={{ cursor: "pointer" }}>
              <div className="calendar-grid-heading">
                <strong>本周安排</strong>
                <span>{selectedOwner?.ownerType === "user" ? "手动维护你的时间表" : "像课表一样查看角色的时间块"}</span>
              </div>
              <span className="calendar-grid-counter">{weekEventCount} 项</span>
            </div>

            {!plan || plan.items.length === 0 ? (
              <EmptyState
                icon={CalendarDays}
                message={selectedOwner?.ownerType === "user" ? "你本周还没有安排" : "这个角色本周还没有安排"}
                action={selectedOwner?.ownerType === "character" ? (
                  <button
                    type="button"
                    className="ui-btn calendar-generate-button mt-3"
                    data-loading={isGenerating ? "true" : undefined}
                    onClick={() => setShowGenerateConfirm(true)}
                    disabled={isGenerating}
                    aria-busy={isGenerating}
                  >
                    <Wand2 size={16} className="calendar-generate-button-icon" />
                    <CalendarGeneratingLabel loading={isGenerating} idle="生成日程" />
                  </button>
                ) : undefined}
              />
            ) : (
              <div className="calendar-grid-shell">
                <div className="calendar-grid-days-head">
                  <span />
                  <div className="calendar-grid-day-heads" style={expandedDate ? { gridTemplateColumns: weekDates.map(d => d === expandedDate ? "3fr" : "1fr").join(" ") } : undefined}>
                    {weekDates.map(date => (
                      <div
                        key={date}
                        className="calendar-grid-day-head"
                        data-selected={date === expandedDate ? "true" : undefined}
                        onClick={() => setExpandedDate(prev => prev === date ? null : date)}
                        style={{ cursor: "pointer" }}
                      >
                        <strong>{getWeekdayLabel(date)}</strong>
                        <span>{formatMonthDay(date)}</span>
                        {selectedOwner?.ownerType === "user" && weekMenstrualMap.get(date) ? (
                          <i className="calendar-grid-day-phase-dot" data-type={weekMenstrualMap.get(date)?.type} />
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="calendar-grid-layout">
                  <div className="calendar-time-column">
                    {Array.from({ length: CALENDAR_HOUR_END - CALENDAR_HOUR_START }, (_, idx) => CALENDAR_HOUR_START + idx).map(hour => (
                      <span key={hour}>{String(hour).padStart(2, "0")}:00</span>
                    ))}
                  </div>
                  <div className="calendar-day-columns" style={expandedDate ? { gridTemplateColumns: weekDates.map(d => d === expandedDate ? "3fr" : "1fr").join(" ") } : undefined}>
                    {weekDates.map(date => (
                      <div key={date} className="calendar-day-column">
                        {Array.from({ length: CALENDAR_HOUR_END - CALENDAR_HOUR_START }, (_, idx) => (
                          <div key={idx} className="calendar-hour-cell" />
                        ))}
                        {(itemsByDate.get(date) || []).map(item => {
                          const start = timeToMinutes(item.startTime);
                          const end = timeToMinutes(item.endTime);
                          const top = ((start - CALENDAR_HOUR_START * 60) / TOTAL_MINUTES) * 100;
                          const height = Math.max(((end - start) / TOTAL_MINUTES) * 100, 5.5);
                          return (
                            <button
                              key={item.id}
                              type="button"
                              className="calendar-event-block"
                              data-color={item.colorKey}
                              style={{ top: `${top}%`, height: `${height}%` }}
                              onClick={() =>
                                setEditingItem({
                                  id: item.id,
                                  date: item.date,
                                  startTime: item.startTime,
                                  endTime: item.endTime,
                                  location: item.location,
                                  title: item.title,
                                })
                              }
                            >
                              <strong>{item.title}</strong>
                              <span><Clock3 size={12} />{item.startTime}-{item.endTime}</span>
                              <span><MapPin size={12} />{item.location || "未定"}</span>
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

        </div>

          <div className="calendar-fab-stack">
            {selectedOwner?.ownerType === "character" ? (
              <>
                <button
                  type="button"
                  className={`calendar-fab ${autoGenerateEnabled ? 'calendar-fab-primary' : 'calendar-fab-secondary'}`}
                  onClick={() => setShowAutoConfirm(true)}
                  aria-label="切换自动生成"
                >
                  <Bot size={18} />
                </button>
                <button
                  type="button"
                  className="calendar-fab calendar-fab-secondary"
                  onClick={() => setShowGenerateConfirm(true)}
                  disabled={isGenerating}
                  data-loading={isGenerating ? "true" : undefined}
                  aria-label="AI 生成并覆盖本周日程"
                >
                  <Wand2 size={18} />
                </button>
              </>
            ) : null}
            <button
              type="button"
              className="calendar-fab calendar-fab-primary"
              onClick={() => setEditingItem(createDefaultScheduleDraft(weekDates[0]))}
              aria-label="新增事项"
            >
              <Plus size={18} />
            </button>
          </div>
      </div>

      {showThemePanel && (
        <div className="modal-overlay calendar-edit-modal-overlay" onClick={() => setShowThemePanel(false)}>
          <div className="calendar-edit-modal" style={{ padding: 24 }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="ts-14 font-semibold text-[var(--c-calendar-text)]">主题色</div>
              <button type="button" onClick={() => setShowThemePanel(false)} className="p-1 rounded-full" style={{ color: "var(--c-calendar-sub)" }}>
                <X size={18} />
              </button>
            </div>
            <div className="flex flex-wrap gap-3 justify-start">
              {[
                { id: "ocean", color: "#7BC6EC", name: "海洋" },
                { id: "orange", color: "#FF7E5F", name: "橘汽" },
                { id: "honey", color: "#D4A373", name: "蜜糖" },
                { id: "mint", color: "#80CBC4", name: "薄荷" },
                { id: "mist", color: "#B399D4", name: "晨雾" },
                { id: "melon", color: "#D1E5D0", name: "蜜瓜" }
              ].map(t => (
                <button
                  key={t.id}
                  onClick={() => {
                    const nextConfig = { ...config, theme: t.id };
                    setConfig(nextConfig);
                    saveCalendarConfig(nextConfig);
                  }}
                  className="flex flex-col items-center gap-1"
                >
                  <div
                    style={{
                      width: 32, height: 32, borderRadius: "50%",
                      background: t.color,
                      border: config.theme === t.id ? "2px solid var(--c-calendar-text)" : "2px solid transparent",
                      boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                      transition: "all 0.2s"
                    }}
                  />
                  <span className="ts-11 text-[var(--c-calendar-sub)]">{t.name}</span>
                </button>
              ))}
            </div>

            <div className="ts-14 font-semibold text-[var(--c-calendar-text)] mt-5 mb-2">自定义 CSS</div>
            <textarea
              className="w-full ts-12 px-3 py-2 rounded-lg"
              style={{
                background: "var(--c-calendar-glass-5)",
                border: "1px solid var(--c-calendar-glass-4)",
                color: "var(--c-calendar-text)",
                height: 280, resize: "none",
                fontFamily: "'SF Mono', 'Menlo', 'Monaco', monospace",
                lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-all",
              }}
              value={calendarCustomCss}
              onChange={e => setCalendarCustomCss(e.target.value)}
              placeholder="/* 输入 CSS 覆盖日历样式... */"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
            <div className="flex gap-1 mt-2 items-center">
              <CSSSchemeBar target="calendar" currentCSS={calendarCustomCss} onLoad={setCalendarCustomCss} btnStyle={{
                width: 30, height: 30,
                border: "1px solid var(--c-calendar-border, rgba(167,139,250,0.2))",
                background: "var(--c-calendar-glass-5, rgba(255,255,255,0.1))",
                color: "var(--c-calendar-text, #4A6B7C)",
              }} modalVars={{
                panel: "var(--c-calendar-bg-top, #E8F4F8)",
                border: "var(--c-calendar-border, rgba(167,139,250,0.2))",
                text: "var(--c-calendar-text, #4A6B7C)",
                textDim: "var(--c-calendar-sub, #8AA8B8)",
                input: "var(--c-calendar-glass-5, rgba(255,255,255,0.1))",
                inputBorder: "var(--c-calendar-border, rgba(167,139,250,0.2))",
                accent: "var(--c-calendar-action, #5B8FB9)",
              }} />
              <button type="button" className="ui-btn ui-btn-outline flex-1" style={{ borderColor: "var(--c-calendar-action)", color: "var(--c-calendar-action)", fontSize: "calc(11px*var(--app-text-scale,1))", padding: "6px 0", minWidth: 0 }} onClick={() => setCalendarCustomCss(CALENDAR_CSS_EXAMPLE)}>示例</button>
              <button type="button" className="ui-btn ui-btn-outline flex-1" style={{ borderColor: "var(--c-calendar-action)", color: "var(--c-calendar-action)", fontSize: "calc(11px*var(--app-text-scale,1))", padding: "6px 0", minWidth: 0 }} onClick={() => setCalendarCustomCss("")}>清空</button>
              <button type="button" className="ui-btn ui-btn-primary flex-1" style={{ background: "var(--c-calendar-action)", fontSize: "calc(11px*var(--app-text-scale,1))", padding: "6px 0", minWidth: 0 }} onClick={handleApplyCalendarCss}>应用</button>
            </div>
          </div>
        </div>
      )}

      {editingItem && (
        <div className="modal-overlay calendar-edit-modal-overlay" onClick={() => setEditingItem(null)}>
          <div className="calendar-edit-modal" data-ui="calendar-edit-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header" data-ui="modal-header">
              <button onClick={() => setEditingItem(null)} className="modal-header-btn modal-header-btn-muted">
                <ChevronLeft size={18} />
              </button>
              <span className="modal-header-title">{editingItem.id ? "编辑日程" : "新增日程"}</span>
              <button onClick={handleSaveDraft} className="modal-header-btn modal-header-btn-action" aria-label="保存">
                <Check size={18} />
              </button>
            </div>

            <div className="modal-body hide-scrollbar flex flex-col gap-3 pb-10" data-ui="modal-body">
              <div className="flex flex-col gap-3">
                {/* Row 1: Date */}
                <div className="flex flex-col gap-1">
                  <label className="menu-desc ml-1">日期</label>
                  <Select
                    value={editingItem.date}
                    onChange={e => setEditingItem(prev => prev ? { ...prev, date: e.target.value } : prev)}
                  >
                    {weekDates.map(date => (
                      <option key={date} value={date}>{date} {getWeekdayLabel(date)}</option>
                    ))}
                  </Select>
                </div>

                {/* Row 2: Start Time and End Time */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="menu-desc ml-1">开始时间</label>
                    <Input
                      type="time"
                      value={editingItem.startTime}
                      onChange={e => setEditingItem(prev => prev ? { ...prev, startTime: e.target.value } : prev)}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="menu-desc ml-1">结束时间</label>
                    <Input
                      type="time"
                      value={editingItem.endTime}
                      onChange={e => setEditingItem(prev => prev ? { ...prev, endTime: e.target.value } : prev)}
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="menu-desc ml-1">地点</label>
                <Input
                  value={editingItem.location}
                  onChange={e => setEditingItem(prev => prev ? { ...prev, location: e.target.value } : prev)}
                  placeholder="例如：公司会议室 / 家里 / 商场"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="menu-desc ml-1">事项</label>
                <Input
                  value={editingItem.title}
                  onChange={e => setEditingItem(prev => prev ? { ...prev, title: e.target.value } : prev)}
                  placeholder="例如：部门周会"
                />
              </div>

              {editingItem.id ? (
                <button type="button" className="ui-btn ui-btn-outline" onClick={handleDeleteItem} style={{ color: "var(--c-danger)" }}>
                  <Trash2 size={16} />
                  删除该事项
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {showMenstrualSettings && (
        <div className="modal-overlay calendar-edit-modal-overlay" onClick={() => setShowMenstrualSettings(false)}>
          <div className="calendar-edit-modal calendar-menstrual-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header" data-ui="modal-header">
              <button onClick={() => setShowMenstrualSettings(false)} className="modal-header-btn modal-header-btn-muted">
                <ChevronLeft size={18} />
              </button>
              <span className="modal-header-title">周期设置</span>
              <button onClick={handleSaveMenstrualSettings} className="modal-header-btn modal-header-btn-action" aria-label="保存">
                <Check size={18} />
              </button>
            </div>

            <div className="modal-body hide-scrollbar flex flex-col gap-3 pb-10" data-ui="modal-body">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="menu-desc ml-1">周期长度</label>
                  <Input
                    type="number"
                    min={21}
                    max={60}
                    value={menstrualDraft.cycleLength}
                    onChange={e => setMenstrualDraft(prev => ({ ...prev, cycleLength: e.target.value }))}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="menu-desc ml-1">经期天数</label>
                  <Input
                    type="number"
                    min={2}
                    max={10}
                    value={menstrualDraft.periodLength}
                    onChange={e => setMenstrualDraft(prev => ({ ...prev, periodLength: e.target.value }))}
                  />
                </div>
              </div>

              <div className="calendar-menstrual-care-panel">
                <button
                  type="button"
                  className="calendar-menstrual-care-toggle"
                  data-active={menstrualDraft.periodCareEnabled ? "true" : undefined}
                  onClick={() => setMenstrualDraft(prev => ({ ...prev, periodCareEnabled: !prev.periodCareEnabled }))}
                >
                  <span className="calendar-menstrual-care-toggle-icon">
                    <HeartPulse size={16} />
                  </span>
                  <span className="calendar-menstrual-care-toggle-copy">
                    <strong>让TA关心我的经期</strong>
                    <span>只显示已有聊天会话的角色</span>
                  </span>
                  <span className="calendar-menstrual-pill-switch" aria-hidden="true">
                    <span className="calendar-menstrual-pill-switch-thumb" />
                  </span>
                </button>

                {menstrualDraft.periodCareEnabled ? (
                  <div className="calendar-menstrual-care-body">
                    <div className="calendar-menstrual-care-section">
                      <label className="menu-desc ml-1">提前多久关心</label>
                      <div className="calendar-period-care-lead-row">
                        {(["1", "2", "3"] as const).map(value => (
                          <button
                            key={value}
                            type="button"
                            className="calendar-period-care-lead"
                            data-active={menstrualDraft.periodCareLeadDays === value ? "true" : undefined}
                            onClick={() => setMenstrualDraft(prev => ({ ...prev, periodCareLeadDays: value }))}
                          >
                            {value}天
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="calendar-menstrual-care-section">
                      <label className="menu-desc ml-1">选择角色</label>
                      {periodCareCharacterOptions.length > 0 ? (
                        <div className="calendar-period-care-avatars">
                          {periodCareCharacterOptions.map(option => {
                            const selected = menstrualDraft.periodCareCharacterIds.includes(option.characterId);
                            return (
                              <button
                                key={option.characterId}
                                type="button"
                                className="calendar-period-care-avatar"
                                data-active={selected ? "true" : undefined}
                                onClick={() => togglePeriodCareCharacter(option.characterId)}
                              >
                                <Avatar src={option.avatar || undefined} name={option.name} size="md" />
                                <span>{option.name}</span>
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="calendar-menstrual-empty">已有聊天会话的角色会显示在这里。</div>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>

              {menstrualRecords.length > 0 ? (
                <div className="calendar-menstrual-modal-history">
                  <label className="menu-desc ml-1">最近完成的经期</label>
                  <div className="calendar-menstrual-modal-list">
                    {menstrualRecords.slice(0, 4).map(record => (
                      <div key={record.id} className="calendar-menstrual-modal-item">
                        <div>
                          <strong>{formatSimpleDate(record.startDate)} - {formatSimpleDate(record.endDate)}</strong>
                          <span>{record.startDate} 至 {record.endDate}</span>
                        </div>
                        <button
                          type="button"
                          className="calendar-menstrual-modal-delete"
                          onClick={() => handleDeleteMenstrual(record.id)}
                          aria-label="删除记录"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="calendar-menstrual-empty">还没有完成的经期记录。先在主页点“经期来了”，结束时再点“经期走了”。</div>
              )}
            </div>
          </div>
        </div>
      )}

      {showGenerateConfirm && selectedOwner && (
        <div className="modal-overlay calendar-edit-modal-overlay" onClick={() => setShowGenerateConfirm(false)}>
          <div className="calendar-edit-modal calendar-confirm-dialog" onClick={e => e.stopPropagation()}>
            <Wand2 size={28} className="calendar-confirm-icon" />
            <div className="calendar-confirm-title">
              确认生成日程？
            </div>
            <div className="calendar-confirm-desc">
              将为 <strong>{selectedOwner.name}</strong> 生成一周日程并覆盖当前已有安排
            </div>
            <div className="calendar-confirm-footer">
              <button className="ui-btn ui-btn-outline" style={{ borderColor: "var(--c-calendar-action)", color: "var(--c-calendar-action)" }} onClick={() => setShowGenerateConfirm(false)}>取消</button>
              <button
                className="ui-btn calendar-generate-button calendar-confirm-generate-button"
                data-loading={isGenerating ? "true" : undefined}
                onClick={handleGenerate}
                disabled={isGenerating}
                aria-busy={isGenerating}
              >
                <CalendarGeneratingLabel loading={isGenerating} idle="确认" />
              </button>
            </div>
          </div>
        </div>
      )}

      {showAutoConfirm && selectedOwner && (
        <div className="modal-overlay calendar-edit-modal-overlay" onClick={() => setShowAutoConfirm(false)}>
          <div className="calendar-edit-modal calendar-confirm-dialog" onClick={e => e.stopPropagation()}>
            <Bot size={28} className="calendar-confirm-icon" />
            <div className="calendar-confirm-title">
              {autoGenerateEnabled ? "关闭自动生成？" : "开启自动生成？"}
            </div>
            <div className="calendar-confirm-desc">
              {autoGenerateEnabled
                ? "关闭后将不再自动为角色生成每周日程"
                : <>每周将自动为 <strong>{selectedOwner.name}</strong> 生成日程安排</>}
            </div>
            <div className="calendar-confirm-footer">
              <button className="ui-btn ui-btn-outline" style={{ borderColor: "var(--c-calendar-action)", color: "var(--c-calendar-action)" }} onClick={() => setShowAutoConfirm(false)}>取消</button>
              <button className="ui-btn ui-btn-primary" style={{ background: "var(--c-calendar-action)" }} onClick={() => {
                const next = !autoGenerateEnabled;
                const nextConfig = { ...config, autoGenerateEnabled: next };
                setConfig(nextConfig);
                saveCalendarConfig(nextConfig);
                setShowAutoConfirm(false);
                onNotice?.(next ? "已开启每周自动生成" : "已关闭每周自动生成");
              }}>
                确认
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
