"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronLeft, Palette } from "lucide-react";
import type { CalendarScheduleItem } from "@/lib/calendar-types";
import type { MenstrualDayState } from "@/lib/menstrual-storage";
import { formatIsoDate } from "@/lib/calendar-utils";
import { getLunarInfoByIso } from "@/lib/lunar";

const MONTH_CN = ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];
const WEEKDAY_CN = ["日", "一", "二", "三", "四", "五", "六"];

type MonthCell = {
  iso: string;
  day: number;
  weekday: number;      // 0 = 周日
  lunarLabel: string;
  lunarFirst: boolean;
};

type MonthBlock = {
  ym: string;           // "2026-7"（月份为 0 基）
  year: number;
  month: number;        // 0 基
  firstWeekday: number;
  weeks: MonthCell[][];
};

/** 构建 today ±12 个月的月历数据（农历只算一次） */
function buildMonths(todayIso: string): MonthBlock[] {
  const today = new Date(`${todayIso}T00:00:00`);
  const blocks: MonthBlock[] = [];
  for (let m = -12; m <= 12; m++) {
    const first = new Date(today.getFullYear(), today.getMonth() + m, 1);
    const year = first.getFullYear();
    const month = first.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const weeks: MonthCell[][] = [];
    let week: MonthCell[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(year, month, day);
      if (week.length > 0 && d.getDay() === 0) {
        weeks.push(week);
        week = [];
      }
      const lunar = getLunarInfoByIso(formatIsoDate(d));
      week.push({
        iso: formatIsoDate(d),
        day,
        weekday: d.getDay(),
        lunarLabel: lunar?.cellLabel ?? "",
        lunarFirst: lunar?.isFirstDay ?? false,
      });
    }
    if (week.length > 0) weeks.push(week);
    blocks.push({ ym: `${year}-${month}`, year, month, firstWeekday: first.getDay(), weeks });
  }
  return blocks;
}

export function CalendarMonthPage({
  todayIso,
  itemsByDate,
  cycleMap,
  ownerStrip,
  onPickDay,
  onClose,
  onOpenTheme,
}: {
  todayIso: string;
  itemsByDate: Map<string, CalendarScheduleItem[]>;
  cycleMap: Map<string, MenstrualDayState> | null;
  ownerStrip: ReactNode;
  onPickDay: (iso: string) => void;
  onClose: () => void;
  onOpenTheme: () => void;
}) {
  const months = useMemo(() => buildMonths(todayIso), [todayIso]);
  const todayYm = useMemo(() => {
    const d = new Date(`${todayIso}T00:00:00`);
    return `${d.getFullYear()}-${d.getMonth()}`;
  }, [todayIso]);
  const [titleYm, setTitleYm] = useState(todayYm);
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerH, setHeaderH] = useState(0);
  const headerHRef = useRef(0);
  headerHRef.current = headerH;
  const tickingRef = useRef(false);

  // 顶部玻璃悬浮层高度 → 滚动区 padding-top
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const measure = () => setHeaderH(header.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  const scrollToYm = (ym: string, smooth: boolean) => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const block = scroller.querySelector<HTMLElement>(`[data-ym="${ym}"]`);
    if (!block) return;
    scroller.scrollTo({ top: block.offsetTop - headerHRef.current, behavior: smooth ? "smooth" : "auto" });
    setTitleYm(ym);
  };

  // 首次定位到当前月（等 header 量高后）
  const didInitRef = useRef(false);
  useEffect(() => {
    if (didInitRef.current || headerH === 0) return;
    didInitRef.current = true;
    requestAnimationFrame(() => scrollToYm(todayYm, false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headerH]);

  const handleScroll = () => {
    if (tickingRef.current) return;
    tickingRef.current = true;
    requestAnimationFrame(() => {
      tickingRef.current = false;
      const scroller = scrollRef.current;
      if (!scroller) return;
      const probe = scroller.scrollTop + headerHRef.current + 60;
      for (const child of Array.from(scroller.children) as HTMLElement[]) {
        if (!(child instanceof HTMLElement) || !child.dataset.ym) continue;
        if (child.offsetTop + child.offsetHeight > probe) {
          const ym = child.dataset.ym;
          setTitleYm(prev => (prev === ym ? prev : ym));
          break;
        }
      }
    });
  };

  const [titleYear, titleMonth] = titleYm.split("-").map(Number);

  return (
    <div className="calendar-page calendar-page-month">
      <div className="calendar-month-scroll hide-scrollbar" ref={scrollRef} onScroll={handleScroll} style={{ paddingTop: headerH }}>
        {months.map(block => (
          <div key={block.ym} className="calendar-month-block" data-ym={block.ym}>
            <div
              className="calendar-month-label"
              style={{ "--label-offset": `${(block.firstWeekday / 7) * 100}%` } as CSSProperties}
            >
              <strong data-current={block.ym === todayYm ? "true" : undefined}>{block.month + 1}月</strong>
            </div>
            {block.weeks.map((week, wi) => (
              <div key={wi} className="calendar-month-week">
                {week.map(cell => {
                  const items = itemsByDate.get(cell.iso);
                  const cycle = cycleMap?.get(cell.iso) ?? null;
                  return (
                    <button
                      key={cell.iso}
                      type="button"
                      className="calendar-month-cell"
                      data-today={cell.iso === todayIso ? "true" : undefined}
                      style={{ gridColumnStart: cell.weekday + 1 }}
                      aria-label={`${block.month + 1}月${cell.day}日${items?.length ? `，${items.length}个日程` : ""}`}
                      onClick={() => onPickDay(cell.iso)}
                    >
                      <span className="calendar-month-num">{cell.day}</span>
                      <span className={`calendar-month-lunar${cell.lunarFirst ? " is-first" : ""}`}>{cell.lunarLabel}</span>
                      <span className="calendar-month-dots" aria-hidden="true">
                        {cycle ? <i className="calendar-cycle-dot" data-type={cycle.type} /> : null}
                        {items && items.length > 0 ? <i className="calendar-event-dot" data-color={items[0].colorKey} /> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* 顶部玻璃悬浮层：周几及以上区域，日历内容从下方透出 */}
      <div className="calendar-month-header" ref={headerRef}>
        <div className="calendar-apple-topbar">
          <button type="button" className="calendar-pill-btn calendar-back-btn" onClick={onClose} aria-label="返回桌面">
            <ChevronLeft size={19} />
            {titleYear}年
          </button>
          <span className="calendar-topbar-space" />
          <button type="button" className="calendar-icon-btn" onClick={onOpenTheme} aria-label="主题与自定义">
            <Palette size={17} />
          </button>
        </div>

        {ownerStrip}

        <div className="calendar-month-title">
          <strong>{MONTH_CN[titleMonth] ?? ""}</strong>
        </div>
        <div className="calendar-weekday-head" aria-hidden="true">
          {WEEKDAY_CN.map(w => (
            <span key={w}>{w}</span>
          ))}
        </div>
      </div>

      {/* 底部渐隐模糊 */}
      <div className="calendar-bottom-fade" aria-hidden="true" />

      <div className="calendar-float-bar">
        <button type="button" className="calendar-pill-btn" onClick={() => scrollToYm(todayYm, true)}>
          今天
        </button>
      </div>
    </div>
  );
}
