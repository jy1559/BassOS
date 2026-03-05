import type { Lang } from "../../i18n";
import type { RecordPeriodState, RecordPeriodUnit, RecordPeriodWindow } from "../../types/models";

function toYmdLocal(input: Date): string {
  const yyyy = input.getFullYear();
  const mm = String(input.getMonth() + 1).padStart(2, "0");
  const dd = String(input.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseYmd(input: string | null | undefined): Date | null {
  if (!input || input.length < 10) return null;
  const [y, m, d] = input.slice(0, 10).split("-").map((token) => Number(token));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  return new Date(y, m - 1, d);
}

function addDays(input: Date, days: number): Date {
  const next = new Date(input);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(input: Date, months: number): Date {
  const next = new Date(input);
  next.setMonth(next.getMonth() + months);
  return next;
}

function addYears(input: Date, years: number): Date {
  const next = new Date(input);
  next.setFullYear(next.getFullYear() + years);
  return next;
}

function startOfWeekMon(input: Date): Date {
  const base = new Date(input.getFullYear(), input.getMonth(), input.getDate());
  const day = base.getDay();
  const diffToMonday = day === 0 ? 6 : day - 1;
  return addDays(base, -diffToMonday);
}

function endOfWeekMon(input: Date): Date {
  return addDays(startOfWeekMon(input), 6);
}

function startOfMonth(input: Date): Date {
  return new Date(input.getFullYear(), input.getMonth(), 1);
}

function endOfMonth(input: Date): Date {
  return new Date(input.getFullYear(), input.getMonth() + 1, 0);
}

function startOfYear(input: Date): Date {
  return new Date(input.getFullYear(), 0, 1);
}

function endOfYear(input: Date): Date {
  return new Date(input.getFullYear(), 11, 31);
}

function formatRangeLabel(start: Date, end: Date): string {
  return `${toYmdLocal(start)} ~ ${toYmdLocal(end)}`;
}

function safeAnchor(anchorDate: string): Date {
  return parseYmd(anchorDate) ?? new Date();
}

export function createDefaultRecordPeriodState(today = new Date()): RecordPeriodState {
  return {
    scope: "all",
    periodUnit: "week",
    recentDays: 7,
    anchorDate: toYmdLocal(today),
  };
}

export function buildRecordPeriodWindow(state: RecordPeriodState, lang: Lang, now = new Date()): RecordPeriodWindow {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayKey = toYmdLocal(today);
  if (state.scope === "all") {
    return {
      scope: "all",
      anchorKey: todayKey,
      startKey: null,
      endKey: null,
      prevStartKey: null,
      prevEndKey: null,
      label: lang === "ko" ? "전체" : "All time",
    };
  }

  if (state.scope === "recent") {
    const days = state.recentDays;
    const start = addDays(today, -(days - 1));
    const end = today;
    const prevStart = addDays(start, -days);
    const prevEnd = addDays(start, -1);
    return {
      scope: "recent",
      recentDays: days,
      anchorKey: todayKey,
      startKey: toYmdLocal(start),
      endKey: toYmdLocal(end),
      prevStartKey: toYmdLocal(prevStart),
      prevEndKey: toYmdLocal(prevEnd),
      label: lang === "ko" ? `최근 ${days}일` : `Recent ${days} days`,
    };
  }

  const anchor = safeAnchor(state.anchorDate);
  const unit = state.periodUnit;
  let start = startOfWeekMon(anchor);
  let end = endOfWeekMon(anchor);
  let prevStart = addDays(start, -7);
  let prevEnd = addDays(end, -7);
  let label = formatRangeLabel(start, end);

  if (unit === "month") {
    start = startOfMonth(anchor);
    end = endOfMonth(anchor);
    const prevAnchor = addMonths(anchor, -1);
    prevStart = startOfMonth(prevAnchor);
    prevEnd = endOfMonth(prevAnchor);
    label = `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, "0")}`;
  } else if (unit === "year") {
    start = startOfYear(anchor);
    end = endOfYear(anchor);
    const prevAnchor = addYears(anchor, -1);
    prevStart = startOfYear(prevAnchor);
    prevEnd = endOfYear(prevAnchor);
    label = `${anchor.getFullYear()}`;
  }

  return {
    scope: "period",
    periodUnit: unit,
    anchorKey: toYmdLocal(anchor),
    startKey: toYmdLocal(start),
    endKey: toYmdLocal(end),
    prevStartKey: toYmdLocal(prevStart),
    prevEndKey: toYmdLocal(prevEnd),
    label,
  };
}

export function shiftRecordAnchor(anchorDate: string, unit: RecordPeriodUnit, delta: number): string {
  const anchor = safeAnchor(anchorDate);
  if (unit === "week") return toYmdLocal(addDays(anchor, delta * 7));
  if (unit === "month") return toYmdLocal(addMonths(anchor, delta));
  return toYmdLocal(addYears(anchor, delta));
}

export function inRecordPeriodWindow(startAt: string, window: RecordPeriodWindow): boolean {
  const key = String(startAt || "").slice(0, 10);
  if (!key) return false;
  if (window.startKey && key < window.startKey) return false;
  if (window.endKey && key > window.endKey) return false;
  return true;
}
