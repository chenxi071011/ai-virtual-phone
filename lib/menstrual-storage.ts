import { formatIsoDate, parseIsoDate } from "./calendar-utils";
import { appNow, appNowISO } from "./app-clock";
import { kvGet, kvSet, registerKvMigration } from "./kv-db";

const MENSTRUAL_CONFIG_KEY = "ai_phone_menstrual_config_v1";
const MENSTRUAL_RECORDS_KEY = "ai_phone_menstrual_records_v1";
const MENSTRUAL_PERIOD_CARE_TRIGGERS_KEY = "ai_phone_menstrual_period_care_triggers_v1";
registerKvMigration(MENSTRUAL_CONFIG_KEY);
registerKvMigration(MENSTRUAL_RECORDS_KEY);
registerKvMigration(MENSTRUAL_PERIOD_CARE_TRIGGERS_KEY);

export type MenstrualPeriodCareLeadDays = 1 | 2 | 3;

export type MenstrualConfig = {
  enabled: boolean;
  cycleLength: number;
  periodLength: number;
  currentPeriodStartDate: string | null;
  periodCareEnabled: boolean;
  periodCareCharacterIds: string[];
  periodCareLeadDays: MenstrualPeriodCareLeadDays;
};

export type MenstrualRecord = {
  id: string;
  startDate: string;
  endDate: string;
  createdAt: string;
  updatedAt: string;
};

export type MenstrualDayType = "period" | "predicted_period" | "fertile" | "ovulation";

export type MenstrualDayState = {
  type: MenstrualDayType;
  label: string;
  shortLabel: string;
};

export type MenstrualPeriodCarePhase = "before" | "active" | "ended";

export type MenstrualPeriodCareEvent = {
  cycleKey: string;
  phase: MenstrualPeriodCarePhase;
  context: string;
};

export type MenstrualPeriodCareTrigger = {
  id: string;
  characterId: string;
  sessionId: string;
  cycleKey: string;
  triggeredAt: string;
};

const DEFAULT_CONFIG: MenstrualConfig = {
  enabled: false,
  cycleLength: 28,
  periodLength: 5,
  currentPeriodStartDate: null,
  periodCareEnabled: false,
  periodCareCharacterIds: [],
  periodCareLeadDays: 1,
};

function addDays(dateText: string, offset: number): string {
  const date = parseIsoDate(dateText);
  date.setDate(date.getDate() + offset);
  return formatIsoDate(date);
}

function eachDateInclusive(startDate: string, endDate: string): string[] {
  const result: string[] = [];
  let current = startDate;
  while (current <= endDate) {
    result.push(current);
    current = addDays(current, 1);
  }
  return result;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function normalizePeriodCareLeadDays(value: unknown): MenstrualPeriodCareLeadDays {
  const normalized = clampInt(Number(value ?? DEFAULT_CONFIG.periodCareLeadDays), 1, 3);
  return (normalized === 2 || normalized === 3 ? normalized : 1) as MenstrualPeriodCareLeadDays;
}

function normalizeCharacterIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(item => String(item).trim()).filter(Boolean)));
}

function daysBetween(startDate: string, endDate: string): number {
  const start = parseIsoDate(startDate).getTime();
  const end = parseIsoDate(endDate).getTime();
  return Math.round((end - start) / 86400000);
}

function getCycleKeyForActualStart(records: MenstrualRecord[], config: MenstrualConfig, actualStartDate: string): string {
  const previous = records.find(record => record.startDate < actualStartDate) ?? null;
  if (!previous) return actualStartDate;

  let predicted = addDays(previous.startDate, config.cycleLength);
  while (addDays(predicted, config.cycleLength) <= actualStartDate) {
    predicted = addDays(predicted, config.cycleLength);
  }

  const previousPredicted = addDays(predicted, -config.cycleLength);
  const candidates = [predicted, previousPredicted];
  const closest = candidates.reduce((best, candidate) => (
    Math.abs(daysBetween(candidate, actualStartDate)) < Math.abs(daysBetween(best, actualStartDate)) ? candidate : best
  ));

  return Math.abs(daysBetween(closest, actualStartDate)) <= 10 ? closest : actualStartDate;
}

function formatEndedDistance(daysAfterEnd: number): string {
  return daysAfterEnd <= 0 ? "今天" : `${daysAfterEnd}天前`;
}

function saveRawConfig(config: MenstrualConfig): MenstrualConfig {
  if (typeof window !== "undefined") {
    kvSet(MENSTRUAL_CONFIG_KEY, JSON.stringify(config));
  }
  return config;
}

export function loadMenstrualConfig(): MenstrualConfig {
  if (typeof window === "undefined") return { ...DEFAULT_CONFIG };
  try {
    const raw = kvGet(MENSTRUAL_CONFIG_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    const parsed = JSON.parse(raw) as Partial<MenstrualConfig>;
    return {
      enabled: !!parsed.enabled,
      cycleLength: clampInt(Number(parsed.cycleLength ?? DEFAULT_CONFIG.cycleLength), 21, 60),
      periodLength: clampInt(Number(parsed.periodLength ?? DEFAULT_CONFIG.periodLength), 2, 10),
      currentPeriodStartDate:
        typeof parsed.currentPeriodStartDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.currentPeriodStartDate)
          ? parsed.currentPeriodStartDate
          : null,
      periodCareEnabled: parsed.periodCareEnabled === true,
      periodCareCharacterIds: normalizeCharacterIds(parsed.periodCareCharacterIds),
      periodCareLeadDays: normalizePeriodCareLeadDays(parsed.periodCareLeadDays),
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveMenstrualConfig(config: MenstrualConfig): MenstrualConfig {
  return saveRawConfig({
    enabled: !!config.enabled,
    cycleLength: clampInt(config.cycleLength, 21, 60),
    periodLength: clampInt(config.periodLength, 2, 10),
    currentPeriodStartDate: config.currentPeriodStartDate ?? null,
    periodCareEnabled: config.periodCareEnabled === true,
    periodCareCharacterIds: normalizeCharacterIds(config.periodCareCharacterIds),
    periodCareLeadDays: normalizePeriodCareLeadDays(config.periodCareLeadDays),
  });
}

export function loadMenstrualRecords(): MenstrualRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = kvGet(MENSTRUAL_RECORDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is MenstrualRecord => !!entry && typeof entry.startDate === "string" && typeof entry.endDate === "string")
      .sort((a, b) => b.startDate.localeCompare(a.startDate));
  } catch {
    return [];
  }
}

function saveMenstrualRecords(records: MenstrualRecord[]): MenstrualRecord[] {
  const normalized = [...records].sort((a, b) => b.startDate.localeCompare(a.startDate));
  if (typeof window !== "undefined") {
    kvSet(MENSTRUAL_RECORDS_KEY, JSON.stringify(normalized));
  }
  return normalized;
}

export function validateMenstrualSettings(input: {
  cycleLength: number;
  periodLength: number;
}): string | null {
  if (input.cycleLength < 21 || input.cycleLength > 60) return "周期长度建议在 21 到 60 天之间";
  if (input.periodLength < 2 || input.periodLength > 10) return "经期天数建议在 2 到 10 天之间";
  return null;
}

export function startCurrentPeriod(dateText = formatIsoDate(appNow())): MenstrualConfig {
  const current = loadMenstrualConfig();
  return saveMenstrualConfig({
    ...current,
    enabled: true,
    currentPeriodStartDate: dateText,
  });
}

export function cancelCurrentPeriodStart(dateText = formatIsoDate(appNow())): MenstrualConfig {
  const current = loadMenstrualConfig();
  if (current.currentPeriodStartDate !== dateText) return current;
  const hasHistory = loadMenstrualRecords().length > 0;
  return saveMenstrualConfig({
    ...current,
    enabled: hasHistory ? current.enabled : false,
    currentPeriodStartDate: null,
  });
}

export function finishCurrentPeriod(dateText = formatIsoDate(appNow())): {
  config: MenstrualConfig;
  records: MenstrualRecord[];
  saved: boolean;
} {
  const current = loadMenstrualConfig();
  if (!current.currentPeriodStartDate || current.currentPeriodStartDate > dateText) {
    return { config: current, records: loadMenstrualRecords(), saved: false };
  }
  const now = appNowISO();
  const records = loadMenstrualRecords();
  const nextRecords = saveMenstrualRecords([
    {
      id: `menstrual_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      startDate: current.currentPeriodStartDate,
      endDate: dateText,
      createdAt: now,
      updatedAt: now,
    },
    ...records,
  ]);
  const nextConfig = saveMenstrualConfig({
    ...current,
    currentPeriodStartDate: null,
  });
  return { config: nextConfig, records: nextRecords, saved: true };
}

export function cancelFinishCurrentPeriod(dateText = formatIsoDate(appNow())): {
  config: MenstrualConfig;
  records: MenstrualRecord[];
  restored: boolean;
} {
  const current = loadMenstrualConfig();
  const records = loadMenstrualRecords();
  const target = records.find(record => record.endDate === dateText) ?? null;
  if (!target) {
    return { config: current, records, restored: false };
  }
  const nextRecords = saveMenstrualRecords(records.filter(record => record.id !== target.id));
  const nextConfig = saveMenstrualConfig({
    ...current,
    enabled: true,
    currentPeriodStartDate: target.startDate,
  });
  return { config: nextConfig, records: nextRecords, restored: true };
}

export function deleteMenstrualRecord(recordId: string): MenstrualRecord[] {
  const records = loadMenstrualRecords();
  return saveMenstrualRecords(records.filter(entry => entry.id !== recordId));
}

export function loadMenstrualPeriodCareTriggers(): MenstrualPeriodCareTrigger[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = kvGet(MENSTRUAL_PERIOD_CARE_TRIGGERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is MenstrualPeriodCareTrigger =>
      !!entry
      && typeof entry.id === "string"
      && typeof entry.characterId === "string"
      && typeof entry.sessionId === "string"
      && typeof entry.cycleKey === "string"
      && typeof entry.triggeredAt === "string",
    );
  } catch {
    return [];
  }
}

export function saveMenstrualPeriodCareTrigger(input: {
  characterId: string;
  sessionId: string;
  cycleKey: string;
}): MenstrualPeriodCareTrigger {
  const trigger: MenstrualPeriodCareTrigger = {
    id: `period_care_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    characterId: input.characterId,
    sessionId: input.sessionId,
    cycleKey: input.cycleKey,
    triggeredAt: appNowISO(),
  };
  if (typeof window !== "undefined") {
    kvSet(MENSTRUAL_PERIOD_CARE_TRIGGERS_KEY, JSON.stringify([trigger, ...loadMenstrualPeriodCareTriggers()]));
  }
  return trigger;
}

export function hasMenstrualPeriodCareTriggered(characterId: string, cycleKey: string): boolean {
  return loadMenstrualPeriodCareTriggers().some(trigger => trigger.characterId === characterId && trigger.cycleKey === cycleKey);
}

function setDayState(map: Map<string, MenstrualDayState>, date: string, state: MenstrualDayState) {
  if (map.has(date)) return;
  map.set(date, state);
}

function getPredictionAnchorDate(records: MenstrualRecord[], config: MenstrualConfig): string | null {
  if (config.currentPeriodStartDate) return config.currentPeriodStartDate;
  if (records.length > 0) return records[0].startDate;
  return null;
}

export function buildMenstrualDayMap(
  rangeStart: string,
  rangeEnd: string,
  records: MenstrualRecord[],
  config: MenstrualConfig,
): Map<string, MenstrualDayState> {
  const result = new Map<string, MenstrualDayState>();
  if (!config.enabled) return result;
  const today = formatIsoDate(appNow());

  for (const record of records) {
    for (const date of eachDateInclusive(record.startDate, record.endDate)) {
      if (date < rangeStart || date > rangeEnd) continue;
      result.set(date, { type: "period", label: "经期中", shortLabel: "经期" });
    }
  }

  if (config.currentPeriodStartDate) {
    const predictedCurrentEnd = addDays(config.currentPeriodStartDate, Math.max(config.periodLength - 1, 0));
    const actualCurrentEnd = today < predictedCurrentEnd ? today : predictedCurrentEnd;
    const currentActiveEnd = actualCurrentEnd < rangeEnd ? actualCurrentEnd : rangeEnd;
    if (config.currentPeriodStartDate <= currentActiveEnd) {
      for (const date of eachDateInclusive(config.currentPeriodStartDate, currentActiveEnd)) {
        if (date < rangeStart || date > rangeEnd) continue;
        result.set(date, { type: "period", label: "经期中", shortLabel: "经期" });
      }
    }

    if (today < predictedCurrentEnd) {
      const predictedFollowStart = addDays(today, 1);
      const predictedFollowEnd = predictedCurrentEnd < rangeEnd ? predictedCurrentEnd : rangeEnd;
      if (predictedFollowStart <= predictedFollowEnd) {
        for (const date of eachDateInclusive(predictedFollowStart, predictedFollowEnd)) {
          if (date < rangeStart || date > rangeEnd) continue;
          setDayState(result, date, { type: "predicted_period", label: "预计经期", shortLabel: "预计" });
        }
      }
    }
  }

  const anchorDate = getPredictionAnchorDate(records, config);
  if (!anchorDate) return result;

  let predictedStart = addDays(anchorDate, config.cycleLength);
  const predictionStartThreshold = addDays(rangeStart, -config.cycleLength);
  while (predictedStart < predictionStartThreshold) {
    predictedStart = addDays(predictedStart, config.cycleLength);
  }

  const predictionEndThreshold = addDays(rangeEnd, config.cycleLength);
  while (predictedStart <= predictionEndThreshold) {
    for (let offset = 0; offset < config.periodLength; offset += 1) {
      const date = addDays(predictedStart, offset);
      if (date < rangeStart || date > rangeEnd) continue;
      setDayState(result, date, { type: "predicted_period", label: "预计经期", shortLabel: "预计" });
    }

    const ovulationDate = addDays(predictedStart, -14);
    if (ovulationDate >= rangeStart && ovulationDate <= rangeEnd) {
      setDayState(result, ovulationDate, { type: "ovulation", label: "预计排卵", shortLabel: "排卵" });
    }
    for (let offset = -5; offset <= 1; offset += 1) {
      const date = addDays(ovulationDate, offset);
      if (date < rangeStart || date > rangeEnd) continue;
      setDayState(result, date, { type: "fertile", label: "易孕期", shortLabel: "易孕" });
    }

    predictedStart = addDays(predictedStart, config.cycleLength);
  }

  return result;
}

export function getNextPredictedPeriodStart(
  records: MenstrualRecord[],
  config: MenstrualConfig,
  fromDate = formatIsoDate(appNow()),
): string | null {
  if (!config.enabled) return null;
  const anchorDate = getPredictionAnchorDate(records, config);
  if (!anchorDate) return null;
  let next = addDays(anchorDate, config.cycleLength);
  while (next < fromDate) {
    next = addDays(next, config.cycleLength);
  }
  return next;
}

export function getMenstrualPeriodCareEvent(
  records: MenstrualRecord[],
  config: MenstrualConfig,
  targetDate = formatIsoDate(appNow()),
): MenstrualPeriodCareEvent | null {
  if (!config.enabled || !config.periodCareEnabled) return null;

  if (config.currentPeriodStartDate && config.currentPeriodStartDate <= targetDate) {
    const startDate = config.currentPeriodStartDate;
    const cycleKey = getCycleKeyForActualStart(records, config, startDate);
    const predictedEndDate = addDays(startDate, Math.max(config.periodLength - 1, 0));
    const dayIndex = daysBetween(startDate, targetDate) + 1;
    if (targetDate <= predictedEndDate) {
      return {
        cycleKey,
        phase: "active",
        context: `{{user}}已记录经期从${startDate}开始，现在可能处于第${dayIndex}天。`,
      };
    }

    const daysAfterPredictedEnd = daysBetween(predictedEndDate, targetDate);
    if (daysAfterPredictedEnd <= 5) {
      return {
        cycleKey,
        phase: "ended",
        context: `{{user}}已记录经期从${startDate}开始；按周期长度推算，可能已经结束${daysAfterPredictedEnd}天，但用户尚未记录结束。`,
      };
    }
    return null;
  }

  const latest = records[0] ?? null;
  if (latest && latest.endDate <= targetDate) {
    const daysAfterActualEnd = daysBetween(latest.endDate, targetDate);
    if (daysAfterActualEnd <= 5) {
      return {
        cycleKey: getCycleKeyForActualStart(records, config, latest.startDate),
        phase: "ended",
        context: `{{user}}已记录经期已于${latest.endDate}结束，是${formatEndedDistance(daysAfterActualEnd)}结束的。`,
      };
    }
  }

  const anchorDate = getPredictionAnchorDate(records, config);
  if (!anchorDate) return null;

  let predictedStart = addDays(anchorDate, config.cycleLength);
  while (addDays(predictedStart, config.cycleLength) <= targetDate) {
    predictedStart = addDays(predictedStart, config.cycleLength);
  }

  if (targetDate < predictedStart) {
    const daysUntil = daysBetween(targetDate, predictedStart);
    if (daysUntil <= config.periodCareLeadDays) {
      return {
        cycleKey: predictedStart,
        phase: "before",
        context: `按预测，{{user}}的经期预计还有${daysUntil}天到来，预计开始日期为${predictedStart}。`,
      };
    }
    return null;
  }

  const predictedEndDate = addDays(predictedStart, Math.max(config.periodLength - 1, 0));
  const dayIndex = daysBetween(predictedStart, targetDate) + 1;
  if (targetDate <= predictedEndDate) {
    return {
      cycleKey: predictedStart,
      phase: "active",
      context: `按预测，{{user}}的经期可能已经来了，现在约第${dayIndex}天，预计开始日期为${predictedStart}。`,
    };
  }

  const daysAfterPredictedEnd = daysBetween(predictedEndDate, targetDate);
  if (daysAfterPredictedEnd <= 5) {
    return {
      cycleKey: predictedStart,
      phase: "ended",
      context: `按预测，{{user}}的经期可能已经走了${daysAfterPredictedEnd}天，预计结束日期为${predictedEndDate}。`,
    };
  }

  return null;
}

export function getMenstrualSummary(records: MenstrualRecord[], config: MenstrualConfig, targetDate = formatIsoDate(appNow())) {
  const today = formatIsoDate(appNow());
  const latest = records[0] ?? null;
  const nextPredicted = getNextPredictedPeriodStart(records, config);
  const todayState = buildMenstrualDayMap(targetDate, targetDate, records, config).get(targetDate) ?? null;
  const todayStarted = config.currentPeriodStartDate === targetDate || records.some(record => record.startDate === targetDate);
  const todayFinished = records.some(record => record.endDate === targetDate);
  return {
    latest,
    nextPredicted,
    todayState,
    todayStarted,
    todayFinished,
    currentPeriodStartDate: config.currentPeriodStartDate,
    isPeriodActive: !!config.currentPeriodStartDate,
  };
}
