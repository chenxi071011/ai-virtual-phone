/**
 * 农历小字：基于 Intl 的 chinese 历法实现，零数据表。
 * 现代浏览器（Chromium / Safari / Firefox 均已支持 zh-u-ca-chinese）；
 * 不支持时静默返回 null，日历上不显示农历，不影响其它功能。
 */

const LUNAR_DAY_NAMES = [
  "初一", "初二", "初三", "初四", "初五", "初六", "初七", "初八", "初九", "初十",
  "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十",
  "廿一", "廿二", "廿三", "廿四", "廿五", "廿六", "廿七", "廿八", "廿九", "三十",
] as const;

const LUNAR_MONTH_NAMES = [
  "正月", "二月", "三月", "四月", "五月", "六月",
  "七月", "八月", "九月", "十月", "冬月", "腊月",
] as const;

export type LunarInfo = {
  /** 月名，如 正月 / 闰四月 / 腊月 */
  monthLabel: string;
  /** 日名，如 初一 / 十五 / 廿三 */
  dayLabel: string;
  /** 当天是否初一（初一显示月名） */
  isFirstDay: boolean;
  /** 日历格子里显示的小字：初一显示月名，其余显示日名 */
  cellLabel: string;
};

let lunarFormatter: Intl.DateTimeFormat | null | undefined;
const lunarCache = new Map<string, LunarInfo | null>();
const LUNAR_CACHE_LIMIT = 800;

function getFormatter(): Intl.DateTimeFormat | null {
  if (lunarFormatter !== undefined) return lunarFormatter;
  try {
    lunarFormatter = new Intl.DateTimeFormat("zh-CN-u-ca-chinese", {
      month: "numeric",
      day: "numeric",
    });
    // 简单自检：能格式化且能取出 month/day part 才算可用
    const parts = lunarFormatter.formatToParts(new Date(2024, 1, 10));
    if (!parts.some(part => part.type === "day")) lunarFormatter = null;
  } catch {
    lunarFormatter = null;
  }
  return lunarFormatter;
}

/** 取某天的农历信息；环境不支持时返回 null。 */
export function getLunarInfo(date: Date): LunarInfo | null {
  const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  if (lunarCache.has(key)) return lunarCache.get(key) ?? null;

  const formatter = getFormatter();
  let info: LunarInfo | null = null;
  if (formatter) {
    try {
      const parts = formatter.formatToParts(date);
      const monthPart = parts.find(part => part.type === "month")?.value ?? "";
      const dayPart = parts.find(part => part.type === "day")?.value ?? "";
      const dayNumber = Number(dayPart);
      if (dayNumber >= 1 && dayNumber <= 30) {
        // month 可能是 "四"、"4"、"闰四" 等形态，统一转成中文月名
        const isLeap = monthPart.includes("闰");
        const monthText = monthPart.replace("闰", "").replace("月", "");
        const monthIndex = resolveMonthIndex(monthText);
        const monthLabel = monthIndex >= 0
          ? `${isLeap ? "闰" : ""}${LUNAR_MONTH_NAMES[monthIndex]}`
          : `${isLeap ? "闰" : ""}${monthText}月`;
        const dayLabel = LUNAR_DAY_NAMES[dayNumber - 1];
        info = {
          monthLabel,
          dayLabel,
          isFirstDay: dayNumber === 1,
          cellLabel: dayNumber === 1 ? monthLabel : dayLabel,
        };
      }
    } catch {
      info = null;
    }
  }

  if (lunarCache.size >= LUNAR_CACHE_LIMIT) lunarCache.clear();
  lunarCache.set(key, info);
  return info;
}

const CN_MONTH_TEXTS = ["正", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二", "冬", "腊"];

function resolveMonthIndex(text: string): number {
  const numeric = Number(text);
  if (numeric >= 1 && numeric <= 12) return numeric - 1;
  const idx = CN_MONTH_TEXTS.indexOf(text);
  if (idx < 0) return -1;
  if (text === "正" || text === "一") return 0;
  if (text === "冬" || text === "十一") return 10;
  if (text === "腊" || text === "十二") return 11;
  if (text === "十") return 9;
  const mapped = Number.isNaN(numeric) ? CN_MONTH_TEXTS.indexOf(text) : numeric;
  // 二~九
  const base = ["二", "三", "四", "五", "六", "七", "八", "九"].indexOf(text);
  if (base >= 0) return base + 1;
  return mapped >= 0 && mapped <= 11 ? mapped : -1;
}

/** ISO(YYYY-MM-DD) 版便捷入口。 */
export function getLunarInfoByIso(isoDate: string): LunarInfo | null {
  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return getLunarInfo(date);
}
