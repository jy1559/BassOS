import { useEffect, useRef, useState, type CSSProperties } from "react";
import { getPlayerXP, getPlayerXPWindow, getSessions, putBasicSettings } from "../api";
import { RecordPeriodToolbar } from "../components/records/RecordPeriodToolbar";
import { RecordTabHeader } from "../components/records/RecordTabHeader";
import { createDefaultRecordPeriodState } from "../components/records/recordPeriod";
import type { Lang } from "../i18n";
import type { PlayerXP, PlayerXPWindow, RecordPeriodState, SessionItem, Settings, XPGranularityKey } from "../types/models";
import { formatDisplayXp, getXpDisplayScale } from "../utils/xpDisplay";

type Props = {
  lang: Lang;
  refreshToken?: number;
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
};

type HeatmapMode = "all" | "6w" | "1y";

type HeatPoint = {
  key: string;
  minutes: number;
  xp: number;
};

type AllYearWeekCell = {
  key: string;
  weekStartKey: string;
  weekEndKey: string;
  minutes: number;
  xp: number;
  intensity: 0 | 1 | 2 | 3 | 4;
};

type AllYearWeekRow = {
  year: number;
  cells: AllYearWeekCell[];
};

type YearMonthDayCell = HeatPoint & {
  month: number;
  day: number;
  outside: boolean;
  intensity: 0 | 1 | 2 | 3 | 4;
};

type YearMonthRow = {
  month: number;
  label: string;
  cells: YearMonthDayCell[];
};

type YearMonthGrid = {
  year: number;
  dayHeaders: number[];
  rows: YearMonthRow[];
};

type CompactHeatCell = HeatPoint & {
  row: number;
  col: number;
  intensity: 0 | 1 | 2 | 3 | 4;
};

type ActivityBreakdownMode = "overall" | "song_title" | "song_genre" | "drill_type";

type ActivityRow = {
  key: string;
  label: string;
  xp: number;
  color: string;
};

type BarLabelParts = {
  top: string;
  bottom: string;
};

const QUEST_XP_MATRIX: Record<"short" | "mid" | "long", Record<"low" | "mid" | "high", number>> = {
  short: { low: 80, mid: 110, high: 140 },
  mid: { low: 150, mid: 210, high: 280 },
  long: { low: 260, mid: 360, high: 480 },
};

function toYmdLocal(input: Date): string {
  const yyyy = input.getFullYear();
  const mm = String(input.getMonth() + 1).padStart(2, "0");
  const dd = String(input.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseYmd(input: string): Date | null {
  if (!input || input.length < 10) return null;
  const [y, m, d] = input.slice(0, 10).split("-").map((v) => Number(v));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  return new Date(y, m - 1, d);
}

function addDays(input: Date, days: number): Date {
  const next = new Date(input);
  next.setDate(next.getDate() + days);
  return next;
}

function diffDays(start: Date, end: Date): number {
  const s = Math.floor(Date.UTC(start.getFullYear(), start.getMonth(), start.getDate()) / 86400000);
  const e = Math.floor(Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()) / 86400000);
  return e - s;
}

function mondayIndex(input: Date): number {
  const day = input.getDay();
  return day === 0 ? 6 : day - 1;
}

function formatMinutes(total: number, lang: Lang): string {
  const safe = Math.max(0, Math.round(total));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  if (lang === "ko") return `${h}시간 ${m}분`;
  return `${h}h ${m}m`;
}

function shortMonthEn(date: Date): string {
  return date.toLocaleString("en-US", { month: "short" });
}

function parseIsoWeekKey(key: string): { year: number; week: number } | null {
  const match = String(key || "").match(/^(\d{4})-W(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(week) || week < 1 || week > 53) return null;
  return { year, week };
}

function isoWeekStartDate(year: number, week: number): Date {
  const jan4 = new Date(year, 0, 4);
  const week1Monday = addDays(jan4, -mondayIndex(jan4));
  return addDays(week1Monday, (week - 1) * 7);
}

function formatBarLabelParts(key: string, granularity: XPGranularityKey, lang: Lang): BarLabelParts | null {
  if (!key) return null;
  if (granularity === "day") {
    const day = parseYmd(key);
    if (!day) return null;
    return {
      top: shortMonthEn(day),
      bottom: String(day.getDate()).padStart(2, "0"),
    };
  }
  if (granularity === "week") {
    const parsed = parseIsoWeekKey(key);
    if (!parsed) return { top: key.slice(0, 4), bottom: key.slice(5) };
    const start = isoWeekStartDate(parsed.year, parsed.week);
    return {
      top: shortMonthEn(start),
      bottom: `W${String(parsed.week).padStart(2, "0")}`,
    };
  }
  if (key.length >= 7) {
    const year = Number(key.slice(0, 4));
    const month = Number(key.slice(5, 7));
    if (Number.isFinite(year) && Number.isFinite(month) && month >= 1 && month <= 12) {
      return {
        top: String(year),
        bottom: lang === "ko" ? `${month}월` : shortMonthEn(new Date(year, month - 1, 1)),
      };
    }
    return { top: key.slice(0, 4), bottom: key.slice(5, 7) };
  }
  return { top: key, bottom: "" };
}

function formatBarPointKey(key: string, granularity: XPGranularityKey): string {
  if (!key) return "-";
  if (granularity === "day") {
    const day = parseYmd(key);
    return day ? `${shortMonthEn(day)} ${String(day.getDate()).padStart(2, "0")}` : key;
  }
  if (granularity === "week") {
    const parsed = parseIsoWeekKey(key);
    if (!parsed) return key;
    const start = isoWeekStartDate(parsed.year, parsed.week);
    const end = addDays(start, 6);
    return `${toYmdLocal(start)} ~ ${toYmdLocal(end)}`;
  }
  return key;
}

function markerLabelForBar(key: string, granularity: XPGranularityKey): string | null {
  if (!key) return null;
  if (granularity === "day") {
    const day = parseYmd(key);
    if (!day || day.getDate() !== 1) return null;
    return shortMonthEn(day);
  }
  if (granularity === "week") {
    const parsed = parseIsoWeekKey(key);
    if (!parsed) return null;
    const start = isoWeekStartDate(parsed.year, parsed.week);
    for (let offset = 0; offset < 7; offset += 1) {
      const day = addDays(start, offset);
      if (day.getDate() === 1) return shortMonthEn(day);
    }
    return null;
  }
  const monthToken = String(key || "").slice(5, 7);
  if (monthToken === "01") return key.slice(0, 4);
  return null;
}

function toPositiveNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed > 0 ? parsed : fallback;
}

function toNumberOr(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function xpToNextByCurve(level: number, curve: Record<string, unknown>): number {
  const lv = Math.max(1, Math.round(Number(level) || 1));
  const curveType = String(curve.type || "quadratic").trim().toLowerCase();
  if (curveType === "decade_linear") {
    const base = Number(curve.base ?? 220);
    const slope = Number(curve.slope ?? 5);
    const step10 = Number(curve.step_10 ?? 50);
    const step20 = Number(curve.step_20 ?? 110);
    const step30 = Number(curve.step_30 ?? 240);
    const step40 = Number(curve.step_40 ?? 434);
    const step = lv >= 40 ? step40 : lv >= 30 ? step30 : lv >= 20 ? step20 : lv >= 10 ? step10 : 0;
    return Math.max(1, Math.round(base + slope * (lv - 1) + step));
  }
  const a = Number(curve.a ?? 230);
  const b = Number(curve.b ?? 13);
  const c = Number(curve.c ?? 1.1);
  const n = lv - 1;
  return Math.max(1, Math.round(a + b * n + c * n * n));
}

function questPeriodLabel(period: "short" | "mid" | "long", lang: Lang): string {
  if (lang === "ko") return period === "short" ? "Short(단기)" : period === "mid" ? "Mid(중기)" : "Long(장기)";
  return period;
}

function questDifficultyLabel(difficulty: "low" | "mid" | "high", lang: Lang): string {
  if (lang === "ko") return difficulty === "low" ? "Low(낮음)" : difficulty === "mid" ? "Mid(보통)" : "High(높음)";
  return difficulty;
}

function buildSampleIndices(length: number, targetCount = 5): number[] {
  if (length <= 0) return [];
  if (length === 1) return [0];
  const set = new Set<number>([0, length - 1]);
  const safeCount = Math.max(2, targetCount);
  for (let idx = 1; idx < safeCount - 1; idx += 1) {
    set.add(Math.round((idx / (safeCount - 1)) * (length - 1)));
  }
  return Array.from(set).sort((a, b) => a - b);
}

function formatSignedPct(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  if (safe > 0) return `+${safe}%`;
  return `${safe}%`;
}

function normalizeGoalInput(raw: string): string {
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return "";
  return String(Math.max(0, Number(digits)));
}

function formatYmdCompact(ymd: string, lang: Lang): string {
  if (!ymd || ymd.length < 10) return "-";
  const yy = ymd.slice(2, 4);
  const mm = ymd.slice(5, 7);
  const dd = ymd.slice(8, 10);
  return lang === "ko" ? `${yy}/${mm}/${dd}` : `${yy}-${mm}-${dd}`;
}

function formatDateRange(startKey: string | null | undefined, endKey: string | null | undefined, lang: Lang): string {
  if (!startKey || !endKey) return "-";
  return `${formatYmdCompact(startKey, lang)} ~ ${formatYmdCompact(endKey, lang)}`;
}

function intensityByMinutes(minutes: number, maxValue: number): 0 | 1 | 2 | 3 | 4 {
  if (minutes <= 0 || maxValue <= 0) return 0;
  const ratio = minutes / maxValue;
  if (ratio >= 0.75) return 4;
  if (ratio >= 0.5) return 3;
  if (ratio >= 0.25) return 2;
  return 1;
}

function normalizeToken(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]/g, "");
}

const ACTIVITY_ROW_COLORS = ["#2bc2c7", "#56a2ff", "#7dc38e", "#f2b24d", "#9d80ff", "#ff7d6b", "#86b4ff", "#52c4a3"];

function sessionDayKey(session: SessionItem): string {
  const candidates = [session.start_at, session.created_at, session.end_at];
  for (const raw of candidates) {
    if (typeof raw === "string" && raw.length >= 10) return raw.slice(0, 10);
  }
  return "";
}

function inKeyRange(dayKey: string, startKey?: string, endKey?: string): boolean {
  if (!dayKey) return false;
  if (startKey && dayKey < startKey) return false;
  if (endKey && dayKey > endKey) return false;
  return true;
}

function isSongSessionRow(session: SessionItem): boolean {
  const activityToken = normalizeToken(session.activity);
  const subToken = normalizeToken(session.sub_activity ?? "");
  return activityToken.includes("song") || activityToken.includes("곡") || subToken.includes("song");
}

function isDrillSessionRow(session: SessionItem): boolean {
  const activityToken = normalizeToken(session.activity);
  const subToken = normalizeToken(session.sub_activity ?? "");
  return (
    activityToken.includes("drill") ||
    activityToken.includes("드릴") ||
    subToken.includes("core") ||
    subToken.includes("funk") ||
    subToken.includes("slap") ||
    subToken.includes("theory") ||
    subToken.includes("드릴")
  );
}

function finalizeActivityRows(map: Map<string, number>, keyPrefix: string, lang: Lang, maxRows = 8): ActivityRow[] {
  const rows = Array.from(map.entries())
    .filter(([, xp]) => xp > 0)
    .map(([label, xp]) => ({ label, xp }))
    .sort((a, b) => b.xp - a.xp);
  if (!rows.length) return [];

  const limitedRows = rows.length > maxRows ? rows.slice(0, maxRows - 1) : rows.slice();
  if (rows.length > maxRows) {
    const restXp = rows.slice(maxRows - 1).reduce((sum, row) => sum + row.xp, 0);
    if (restXp > 0) {
      limitedRows.push({ label: lang === "ko" ? "기타" : "Other", xp: restXp });
    }
  }

  return limitedRows.map((row, index) => ({
    key: `${keyPrefix}_${normalizeToken(row.label) || index}`,
    label: row.label,
    xp: row.xp,
    color: ACTIVITY_ROW_COLORS[index % ACTIVITY_ROW_COLORS.length],
  }));
}

function calcDeltaPct(current: number, previous: number): number {
  const safeCurrent = Math.max(0, Number.isFinite(current) ? current : 0);
  const safePrevious = Math.max(0, Number.isFinite(previous) ? previous : 0);
  if (safePrevious <= 0) return safeCurrent > 0 ? 100 : 0;
  return Math.round(((safeCurrent - safePrevious) / safePrevious) * 1000) / 10;
}

function buildAllYearWeekRows(
  minYear: number,
  maxYear: number,
  minuteMap: Map<string, number>,
  xpMap: Map<string, number>
): { rows: AllYearWeekRow[]; maxWeeks: number } {
  const rawRows: Array<{ year: number; cells: Omit<AllYearWeekCell, "intensity">[] }> = [];
  let maxWeekMinutes = 0;
  let maxWeeks = 1;

  for (let year = minYear; year <= maxYear; year += 1) {
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31);
    const gridStart = addDays(yearStart, -mondayIndex(yearStart));
    const gridEnd = addDays(yearEnd, 6 - mondayIndex(yearEnd));
    const totalWeeks = Math.max(1, Math.ceil((Math.max(0, diffDays(gridStart, gridEnd)) + 1) / 7));
    maxWeeks = Math.max(maxWeeks, totalWeeks);

    const cells: Omit<AllYearWeekCell, "intensity">[] = [];
    for (let week = 0; week < totalWeeks; week += 1) {
      const weekStart = addDays(gridStart, week * 7);
      const weekEnd = addDays(weekStart, 6);
      let minutes = 0;
      let xp = 0;
      for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
        const day = addDays(weekStart, dayOffset);
        if (day.getFullYear() !== year) continue;
        const dayKey = toYmdLocal(day);
        minutes += Math.max(0, Number(minuteMap.get(dayKey) ?? 0));
        xp += Math.max(0, Number(xpMap.get(dayKey) ?? 0));
      }
      maxWeekMinutes = Math.max(maxWeekMinutes, minutes);
      cells.push({
        key: `${year}_w_${String(week + 1).padStart(2, "0")}`,
        weekStartKey: toYmdLocal(weekStart),
        weekEndKey: toYmdLocal(weekEnd),
        minutes,
        xp,
      });
    }
    rawRows.push({ year, cells });
  }

  return {
    maxWeeks,
    rows: rawRows.map((row) => ({
      year: row.year,
      cells: row.cells.map((cell) => ({
        ...cell,
        intensity: intensityByMinutes(cell.minutes, maxWeekMinutes),
      })),
    })),
  };
}

function buildYearMonthGrid(year: number, minuteMap: Map<string, number>, xpMap: Map<string, number>, lang: Lang): YearMonthGrid {
  const dayHeaders = Array.from({ length: 31 }, (_, idx) => idx + 1);
  let maxYearMinutes = 0;
  const baseRows: Array<{ month: number; label: string; cells: Omit<YearMonthDayCell, "intensity">[] }> = [];

  for (let monthIdx = 0; monthIdx < 12; monthIdx += 1) {
    const month = monthIdx + 1;
    const daysInMonth = new Date(year, month, 0).getDate();
    const monthDate = new Date(year, monthIdx, 1);
    const label = lang === "ko" ? `${month}월` : shortMonthEn(monthDate);
    const cells: Omit<YearMonthDayCell, "intensity">[] = [];

    for (let day = 1; day <= 31; day += 1) {
      const key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const outside = day > daysInMonth;
      const minutes = outside ? 0 : Math.max(0, Number(minuteMap.get(key) ?? 0));
      const xp = outside ? 0 : Math.max(0, Number(xpMap.get(key) ?? 0));
      if (!outside) maxYearMinutes = Math.max(maxYearMinutes, minutes);
      cells.push({
        key,
        minutes,
        xp,
        month,
        day,
        outside,
      });
    }

    baseRows.push({
      month,
      label,
      cells,
    });
  }

  return {
    year,
    dayHeaders,
    rows: baseRows.map((row) => ({
      month: row.month,
      label: row.label,
      cells: row.cells.map((cell) => ({
        ...cell,
        intensity: intensityByMinutes(cell.minutes, maxYearMinutes),
      })),
    })),
  };
}

function buildCompactGrid(start: Date, minuteMap: Map<string, number>, xpMap: Map<string, number>) {
  const cells: CompactHeatCell[] = [];
  for (let offset = 0; offset < 42; offset += 1) {
    const day = addDays(start, offset);
    const key = toYmdLocal(day);
    const minutes = Math.max(0, Number(minuteMap.get(key) ?? 0));
    const xp = Math.max(0, Number(xpMap.get(key) ?? 0));
    cells.push({
      key,
      minutes,
      xp,
      row: Math.floor(offset / 14),
      col: offset % 14,
      intensity: 0,
    });
  }
  const maxValue = Math.max(0, ...cells.map((item) => item.minutes));
  return {
    cells: cells.map((item) => ({
      ...item,
      intensity: intensityByMinutes(item.minutes, maxValue),
    })),
  };
}

export function XPPage({ lang, refreshToken, settings, onSettingsChange }: Props) {
  const [player, setPlayer] = useState<PlayerXP | null>(null);
  const [windowData, setWindowData] = useState<PlayerXPWindow | null>(null);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [periodState, setPeriodState] = useState<RecordPeriodState>(() => createDefaultRecordPeriodState());
  const [granularity, setGranularity] = useState<XPGranularityKey>("day");
  const [editingGoals, setEditingGoals] = useState(false);
  const [savingGoals, setSavingGoals] = useState(false);
  const [goalWeeklyInput, setGoalWeeklyInput] = useState("");
  const [goalMonthlyInput, setGoalMonthlyInput] = useState("");
  const [heatmapMode, setHeatmapMode] = useState<HeatmapMode>("6w");
  const [heatmap6wPage, setHeatmap6wPage] = useState(0);
  const [heatmapYear, setHeatmapYear] = useState(new Date().getFullYear());
  const [activityBreakdownMode, setActivityBreakdownMode] = useState<ActivityBreakdownMode>("overall");
  const [activityChartMode, setActivityChartMode] = useState<"bar" | "pie">("bar");
  const [xpGuideOpen, setXpGuideOpen] = useState(false);
  const xpDisplayScale = getXpDisplayScale(settings);
  const lineShellRef = useRef<HTMLDivElement | null>(null);
  const yearGridRef = useRef<HTMLDivElement | null>(null);
  const [lineShellWidth, setLineShellWidth] = useState(0);
  const [yearGridWidth, setYearGridWidth] = useState(0);
  const levelCurveConfig = (settings.level_curve as Record<string, unknown>) ?? {};
  const xpConfig = (settings.xp as Record<string, unknown>) ?? {};
  const criticalConfig = (settings.critical as Record<string, unknown>) ?? {};
  const guideMaxLevel = Math.max(2, Math.round(toPositiveNumber(levelCurveConfig.max_level, 50)));
  const guideLevelRows = Array.from({ length: guideMaxLevel - 1 }, (_, idx) => {
    const level = idx + 1;
    const needPoint = xpToNextByCurve(level, levelCurveConfig);
    return {
      level,
      nextLevel: level + 1,
      needPoint,
      needDisplay: formatDisplayXp(needPoint, xpDisplayScale),
    };
  });
  const guideTotalPoint = guideLevelRows.reduce((sum, row) => sum + row.needPoint, 0);
  const sessionPerMinPoint = Math.max(0, Math.round(Number((xpConfig.session as Record<string, unknown> | undefined)?.per_min ?? 3)));
  const sessionMultiplier = Math.max(0, toNumberOr(criticalConfig.session_xp_multiplier, 1));
  const backfillMultiplier = Math.max(0, toNumberOr(
    xpConfig.backfill_multiplier ?? criticalConfig.backfill_multiplier_default,
    0.5
  ));
  const questMultiplier = Math.max(0, toNumberOr(criticalConfig.quest_xp_multiplier, 0.15));
  const achievementMultiplier = Math.max(0, toNumberOr(criticalConfig.achievement_xp_multiplier, 0.15));
  const questGuideRows = (Object.keys(QUEST_XP_MATRIX) as Array<"short" | "mid" | "long">).flatMap((period) =>
    (Object.keys(QUEST_XP_MATRIX[period]) as Array<"low" | "mid" | "high">).map((difficulty) => {
      const rawBase = QUEST_XP_MATRIX[period][difficulty];
      const autoPoint = Math.round(rawBase * questMultiplier);
      const manualPoint = Math.round((rawBase / 6) * questMultiplier);
      return { period, difficulty, autoPoint, manualPoint };
    })
  );

  const loadBase = async () => {
    const [next, sessionRows] = await Promise.all([getPlayerXP(), getSessions(2400).catch(() => [] as SessionItem[])]);
    setPlayer(next);
    setSessions(sessionRows);
  };

  const loadWindow = async (state: RecordPeriodState) => {
    const payload =
      state.scope === "period"
        ? { scope: "period" as const, period_unit: state.periodUnit, anchor: state.anchorDate }
        : state.scope === "recent"
          ? { scope: "recent" as const, recent_days: state.recentDays }
          : { scope: "all" as const };
    const next = await getPlayerXPWindow(payload);
    setWindowData(next);
  };

  useEffect(() => {
    void loadBase();
  }, [refreshToken]);

  useEffect(() => {
    void loadWindow(periodState);
  }, [periodState.scope, periodState.periodUnit, periodState.anchorDate, periodState.recentDays, refreshToken]);

  useEffect(() => {
    if (!player) return;
    setGoalWeeklyInput(String(player.story.goals.weekly.manual ?? ""));
    setGoalMonthlyInput(String(player.story.goals.monthly.manual ?? ""));
    const history = player.story.heatmap.history ?? [];
    if (history.length) {
      const lastDate = parseYmd(history[history.length - 1].key);
      if (lastDate) setHeatmapYear(lastDate.getFullYear());
    }
    setHeatmap6wPage(0);
  }, [player]);

  useEffect(() => {
    const node = lineShellRef.current;
    if (!node) return;
    const updateWidth = () => setLineShellWidth(Math.max(0, node.clientWidth));
    updateWidth();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWidth);
      return () => window.removeEventListener("resize", updateWidth);
    }
    const observer = new ResizeObserver(updateWidth);
    observer.observe(node);
    return () => observer.disconnect();
  }, [windowData, periodState.scope, periodState.periodUnit, periodState.anchorDate, periodState.recentDays]);

  useEffect(() => {
    const node = yearGridRef.current;
    if (!node) {
      setYearGridWidth(0);
      return;
    }
    const updateWidth = () => setYearGridWidth(Math.max(0, node.clientWidth));
    updateWidth();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWidth);
      return () => window.removeEventListener("resize", updateWidth);
    }
    const observer = new ResizeObserver(updateWidth);
    observer.observe(node);
    return () => observer.disconnect();
  }, [heatmapMode, heatmapYear, windowData]);

  useEffect(() => {
    if (!xpGuideOpen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setXpGuideOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [xpGuideOpen]);

  if (!player || !windowData) return <div className="card">Loading...</div>;

  const summary = windowData.summary;
  const weeklyGoal = player.story.goals.weekly;
  const monthlyGoal = player.story.goals.monthly;
  const rangeStartKey = windowData.window.start_key ?? undefined;
  const rangeEndKey = windowData.window.end_key ?? undefined;
  const xpRows = windowData.charts[granularity] ?? [];
  const levelRows = windowData.level_progress ?? [];
  const sessionActivityRows = windowData.xp_by_activity ?? [];
  const sourceRows = windowData.xp_sources ?? [];
  const sourceMap = new Map<string, number>(sourceRows.map((row) => [String(row.key).toLowerCase(), Math.max(0, row.xp)]));
  const practiceXp = sourceMap.get("practice") ?? 0;
  const questXp = (sourceMap.get("quest") ?? 0) + (sourceMap.get("long_goal") ?? 0);
  const achievementXp = sourceMap.get("achievement") ?? 0;
  const songSessionXp = sessionActivityRows.reduce((total, row) => {
    const token = normalizeToken(row.key);
    if (token.includes("song") || token.includes("곡")) return total + Math.max(0, row.xp);
    return total;
  }, 0);
  const drillSessionXp = sessionActivityRows.reduce((total, row) => {
    const token = normalizeToken(row.key);
    if (token.includes("drill") || token.includes("core") || token.includes("funk") || token.includes("slap") || token.includes("theory") || token.includes("드릴")) {
      return total + Math.max(0, row.xp);
    }
    return total;
  }, 0);
  const otherSessionXp = Math.max(0, practiceXp - songSessionXp - drillSessionXp);
  const scopedSessions = sessions.filter((session) => inKeyRange(sessionDayKey(session), rangeStartKey, rangeEndKey));

  const activityCategoryRows: ActivityRow[] = [
    { key: "song", label: lang === "ko" ? "곡연습" : "Song Practice", xp: songSessionXp, color: "#2bc2c7" },
    { key: "drill", label: lang === "ko" ? "드릴연습" : "Drill Practice", xp: drillSessionXp, color: "#56a2ff" },
    { key: "other", label: lang === "ko" ? "기타세션" : "Other Session", xp: otherSessionXp, color: "#7dc38e" },
    { key: "quest", label: lang === "ko" ? "퀘스트" : "Quest", xp: questXp, color: "#f2b24d" },
    { key: "achievement", label: lang === "ko" ? "업적" : "Achievement", xp: achievementXp, color: "#9d80ff" },
  ];

  const songByTitleRows = (() => {
    const bucket = new Map<string, number>();
    for (const session of scopedSessions) {
      if (!isSongSessionRow(session)) continue;
      const label =
        String(session.song_title || "").trim() ||
        (session.song_library_id ? `${lang === "ko" ? "곡" : "Song"} #${session.song_library_id}` : lang === "ko" ? "미지정 곡" : "Untitled Song");
      const xp = Math.max(0, Number(session.xp ?? 0));
      bucket.set(label, (bucket.get(label) ?? 0) + xp);
    }
    return finalizeActivityRows(bucket, "song_title", lang);
  })();

  const songByGenreRows = (() => {
    const bucket = new Map<string, number>();
    for (const session of scopedSessions) {
      if (!isSongSessionRow(session)) continue;
      const label = String(session.song_genre || "").trim() || (lang === "ko" ? "미분류 장르" : "Unclassified Genre");
      const xp = Math.max(0, Number(session.xp ?? 0));
      bucket.set(label, (bucket.get(label) ?? 0) + xp);
    }
    return finalizeActivityRows(bucket, "song_genre", lang);
  })();

  const drillByTypeRows = (() => {
    const bucket = new Map<string, number>();
    for (const session of scopedSessions) {
      if (!isDrillSessionRow(session)) continue;
      const label =
        String(session.sub_activity || "").trim() ||
        String(session.drill_name || "").trim() ||
        (lang === "ko" ? "기타 드릴" : "Other Drill");
      const xp = Math.max(0, Number(session.xp ?? 0));
      bucket.set(label, (bucket.get(label) ?? 0) + xp);
    }
    return finalizeActivityRows(bucket, "drill_type", lang);
  })();

  const activityRows =
    activityBreakdownMode === "song_title"
      ? songByTitleRows
      : activityBreakdownMode === "song_genre"
        ? songByGenreRows
        : activityBreakdownMode === "drill_type"
          ? drillByTypeRows
          : activityCategoryRows;

  const pieRows = activityRows.filter((item) => item.xp > 0);
  const pieTotalXp = pieRows.reduce((sum, item) => sum + item.xp, 0);
  const maxActivity = Math.max(1, ...activityRows.map((row) => row.xp));
  const ringStyle = {
    ["--xp-level-progress" as string]: `${Math.max(0, Math.min(100, player.hud.progress_pct))}%`,
  } as CSSProperties;
  const xpToNext = Math.max(0, player.hud.xp_to_next - player.hud.current_level_xp);

  const hasXp = xpRows.some((row) => row.xp > 0);
  const rawMaxXp = Math.max(0, ...xpRows.map((row) => row.xp));
  const chartMaxXp = hasXp ? Math.max(10, Math.ceil(rawMaxXp / 10) * 10) : 100;
  const yTicks = [0, 1, 2, 3, 4].map((idx) => Math.round((chartMaxXp / 4) * idx));
  const barLabelStep = Math.max(1, Math.ceil(Math.max(1, xpRows.length) / 10));
  const barMarkerMap = new Map<number, string>();
  xpRows.forEach((row, idx) => {
    const marker = markerLabelForBar(row.key, granularity);
    if (marker) barMarkerMap.set(idx, marker);
  });
  const windowStart = parseYmd(windowData.window.start_key);
  const windowEnd = parseYmd(windowData.window.end_key);
  const windowDaySpan = windowStart && windowEnd ? Math.max(1, diffDays(windowStart, windowEnd) + 1) : Math.max(1, xpRows.length);

  const levelMin = Math.floor(Math.min(...(levelRows.length ? levelRows.map((row) => row.value) : [player.hud.level])));
  const rawLevelMax = Math.ceil(Math.max(...(levelRows.length ? levelRows.map((row) => row.value) : [player.hud.level + 1])));
  const levelMax = rawLevelMax <= levelMin ? levelMin + 1 : rawLevelMax;
  const levelSpan = Math.max(1, levelMax - levelMin);
  const lineSvgWidth = Math.max(220, Math.round(lineShellWidth || 0));
  const linePaddingX = Math.max(12, Math.min(30, Math.round(lineSvgWidth * 0.07)));
  const linePlotWidth = Math.max(1, lineSvgWidth - linePaddingX * 2);
  const pointAt = (row: { value: number }, idx: number, length: number) => {
    const x = length <= 1 ? lineSvgWidth / 2 : linePaddingX + (idx / (length - 1)) * linePlotWidth;
    const y = 94 - ((row.value - levelMin) / levelSpan) * 86;
    return { x, y };
  };
  const polyline = levelRows
    .map((row, idx) => {
      const point = pointAt(row, idx, levelRows.length);
      return `${point.x},${point.y}`;
    })
    .join(" ");
  const latestLevelPoint = levelRows.length ? pointAt(levelRows[levelRows.length - 1], levelRows.length - 1, levelRows.length) : null;

  const lineXLabels = (() => {
    if (!levelRows.length) return [];
    const labelCount = Math.max(4, Math.min(7, Math.floor(lineSvgWidth / 120) + 1));
    return buildSampleIndices(levelRows.length, labelCount)
      .map((idx) => {
        const point = pointAt(levelRows[idx], idx, levelRows.length);
        return { key: levelRows[idx].key, leftPct: Math.max(0, Math.min(100, (point.x / lineSvgWidth) * 100)) };
      });
  })();

  const levelTicks = (() => {
    const desiredTickCount = Math.max(4, Math.min(7, Math.floor(lineSvgWidth / 120) + 2));
    const roughStep = levelSpan / Math.max(1, desiredTickCount - 1);
    const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(1, roughStep))));
    const stepCandidates = [1, 2, 5, 10].map((factor) => factor * magnitude);
    const step = stepCandidates.find((candidate) => candidate >= roughStep) ?? stepCandidates[stepCandidates.length - 1];
    const start = Math.floor(levelMin / step) * step;
    const end = Math.ceil(levelMax / step) * step;
    const out: number[] = [];
    for (let lv = start; lv <= end + 0.0001; lv += step) out.push(Math.round(lv));
    if (!out.includes(levelMin)) out.push(levelMin);
    if (!out.includes(levelMax)) out.push(levelMax);
    return [...new Set(out)].sort((a, b) => a - b);
  })();
  const reverseLevelTicks = [...levelTicks].reverse();

  const weeklyRangeLabel = formatDateRange(weeklyGoal.period_start_key, weeklyGoal.period_end_key, lang);
  const monthlyRangeLabel = formatDateRange(monthlyGoal.period_start_key, monthlyGoal.period_end_key, lang);
  const weeklyPrevXp = Math.max(0, weeklyGoal.prev_xp ?? 0);
  const monthlyPrevXp = Math.max(0, monthlyGoal.prev_xp ?? 0);
  const weeklyDeltaPct = calcDeltaPct(weeklyGoal.current_xp, weeklyPrevXp);
  const monthlyDeltaPct = calcDeltaPct(monthlyGoal.current_xp, monthlyPrevXp);
  const pointWithDisplay = (point: number) => `${formatDisplayXp(point, xpDisplayScale)} XP (${Math.max(0, Math.round(point)).toLocaleString()}p)`;
  const pieGradient = (() => {
    if (!pieRows.length || pieTotalXp <= 0) return "conic-gradient(color-mix(in srgb, var(--border) 80%, transparent) 0 100%)";
    let cursor = 0;
    const segments: string[] = [];
    for (const row of pieRows) {
      const next = cursor + (row.xp / pieTotalXp) * 100;
      segments.push(`${row.color} ${cursor}% ${next}%`);
      cursor = next;
    }
    return `conic-gradient(${segments.join(", ")})`;
  })();

  const historyRows = player.story.heatmap.history ?? [];
  const heatHistory: HeatPoint[] = historyRows.length
    ? historyRows.map((item) => ({ key: item.key, minutes: item.minutes, xp: Math.max(0, item.xp ?? 0) }))
    : player.story.heatmap.cells.map((item) => ({ key: item.key, minutes: item.minutes, xp: Math.max(0, item.xp ?? 0) }));
  const minuteMap = new Map<string, number>(heatHistory.map((item) => [item.key, item.minutes]));
  const xpMap = new Map<string, number>(heatHistory.map((item) => [item.key, item.xp]));
  const historyDateRows = heatHistory
    .map((item) => parseYmd(item.key))
    .filter((item): item is Date => Boolean(item))
    .sort((a, b) => a.getTime() - b.getTime());
  const historyStartDate = historyDateRows[0] ?? new Date();
  const historyEndDate = historyDateRows[historyDateRows.length - 1] ?? new Date();

  const sixWeekEnd = addDays(historyEndDate, -heatmap6wPage * 42);
  const sixWeekStart = addDays(sixWeekEnd, -41);
  const sixWeekCompact = buildCompactGrid(sixWeekStart, minuteMap, xpMap);
  const canOlder6w = diffDays(historyStartDate, sixWeekStart) > 0;
  const canNewer6w = heatmap6wPage > 0;

  const minHistoryYear = historyStartDate.getFullYear();
  const maxHistoryYear = historyEndDate.getFullYear();
  const yearMonthGrid = buildYearMonthGrid(heatmapYear, minuteMap, xpMap, lang);
  const yearLabelWidth = yearGridWidth >= 640 ? 36 : yearGridWidth >= 520 ? 34 : 32;
  const approxYearCellWidth = Math.floor(Math.max(1, (Math.max(0, yearGridWidth - (yearLabelWidth + 44)) / 31)));
  const yearCellHeight = Math.max(2, Math.min(5, approxYearCellWidth));
  const { rows: allWeekRows, maxWeeks: allWeekMaxWeeks } = buildAllYearWeekRows(minHistoryYear, maxHistoryYear, minuteMap, xpMap);
  const canOlderYear = heatmapYear > minHistoryYear;
  const canNewerYear = heatmapYear < maxHistoryYear;
  const activeHeatRangeLabel =
    heatmapMode === "6w"
      ? `${formatYmdCompact(toYmdLocal(sixWeekStart), lang)} ~ ${formatYmdCompact(toYmdLocal(sixWeekEnd), lang)}`
      : heatmapMode === "1y"
        ? String(heatmapYear)
        : `${minHistoryYear} ~ ${maxHistoryYear}`;

  const saveGoals = async () => {
    const weekly = Math.max(0, Math.round(Number(goalWeeklyInput || 0)));
    const monthly = Math.max(0, Math.round(Number(goalMonthlyInput || 0)));
    setSavingGoals(true);
    try {
      const updated = await putBasicSettings({
        profile: {
          ...settings.profile,
          xp_goal_weekly: weekly,
          xp_goal_monthly: monthly,
        },
      });
      onSettingsChange(updated);
      setEditingGoals(false);
      await Promise.all([loadBase(), loadWindow(periodState)]);
    } finally {
      setSavingGoals(false);
    }
  };

  return (
    <div className="page-grid xp-page xp-story-page">
      <section className="card xp-range-bar xp-story-range-bar">
        <RecordTabHeader
          title={lang === "ko" ? "XP 기록" : "XP Story"}
          subtitle={lang === "ko" ? "규모, 레벨업 근접도, 다음 보상을 한 화면에서 확인하세요." : "Read your scale, level proximity, and next unlock in one glance."}
          toolbar={<RecordPeriodToolbar lang={lang} value={periodState} onChange={setPeriodState} testIdPrefix="xp-period" compact />}
        />
      </section>

      <section className="card xp-story-top-card xp-story-level-card">
        <div className="xp-story-level-head">
          <h2>{lang === "ko" ? "현재 레벨 진행" : "Level Progress"}</h2>
          <button
            type="button"
            className="ghost-btn xp-story-mini-icon-btn"
            title={lang === "ko" ? "XP 규칙 보기" : "View XP rules"}
            aria-label={lang === "ko" ? "XP 규칙 보기" : "View XP rules"}
            onClick={() => setXpGuideOpen(true)}
          >
            i
          </button>
        </div>
        <div className="xp-story-level-body">
          <div className="xp-story-level-ring" style={ringStyle}>
            <div className="xp-story-level-core">
              <strong>Lv.{player.hud.level}</strong>
              <small>{player.hud.progress_pct.toFixed(1)}%</small>
            </div>
          </div>
          <div className="xp-story-level-meta">
            <div>
              <span>Total XP</span>
              <strong>{formatDisplayXp(player.hud.total_xp, xpDisplayScale)}</strong>
            </div>
            <div>
              <span>{lang === "ko" ? "다음 레벨까지" : "To Next Level"}</span>
              <strong>{formatDisplayXp(xpToNext, xpDisplayScale)} XP</strong>
            </div>
            <div>
              <span>{lang === "ko" ? "이번 기간 획득" : "XP This Range"}</span>
              <strong>{formatDisplayXp(summary.xp_total, xpDisplayScale)} XP</strong>
            </div>
            <div>
              <span>{lang === "ko" ? "연속 연습" : "Current Streak"}</span>
              <strong>{player.story.streaks.current_days}{lang === "ko" ? "일" : "d"}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="card xp-story-top-card xp-story-performance-card">
        <div className="xp-story-card-head">
          <h2>{lang === "ko" ? "이번 기간 성과" : "Range Performance"}</h2>
          <div className="xp-story-performance-actions">
            <small className={summary.delta_pct >= 0 ? "xp-story-positive" : "xp-story-negative"}>
              {lang === "ko" ? "직전 구간 대비" : "vs Previous"} {formatSignedPct(summary.delta_pct)}
            </small>
            {!editingGoals ? (
              <button className="ghost-btn xp-story-goal-edit-trigger" onClick={() => setEditingGoals(true)}>
                {lang === "ko" ? "목표 수정" : "Edit Goals"}
              </button>
            ) : null}
          </div>
        </div>
        <div className="xp-story-period-value">{formatDisplayXp(summary.xp_total, xpDisplayScale)} XP</div>

        <div className="xp-story-mixed-kpi-grid">
          <div className="xp-story-mixed-kpi-item">
            <span>{lang === "ko" ? "주간 XP" : "Weekly XP"}</span>
            <strong>{formatDisplayXp(weeklyGoal.current_xp, xpDisplayScale)} XP</strong>
            <small className={weeklyDeltaPct >= 0 ? "xp-story-positive" : "xp-story-negative"}>
              {lang === "ko" ? "직전 주 대비" : "vs Prev Week"} {formatSignedPct(weeklyDeltaPct)}
            </small>
          </div>
          <div className="xp-story-mixed-kpi-item">
            <span>{lang === "ko" ? "월간 XP" : "Monthly XP"}</span>
            <strong>{formatDisplayXp(monthlyGoal.current_xp, xpDisplayScale)} XP</strong>
            <small className={monthlyDeltaPct >= 0 ? "xp-story-positive" : "xp-story-negative"}>
              {lang === "ko" ? "직전 월 대비" : "vs Prev Month"} {formatSignedPct(monthlyDeltaPct)}
            </small>
          </div>
        </div>

        <div className="xp-story-goal-row">
          <div className="xp-story-goal-label">
            <span>
              {lang === "ko" ? "주간 목표" : "Weekly Goal"}
              <small className="xp-story-goal-period">{weeklyRangeLabel}</small>
            </span>
            <strong>{formatDisplayXp(weeklyGoal.current_xp, xpDisplayScale)} / {formatDisplayXp(weeklyGoal.effective, xpDisplayScale)} XP</strong>
          </div>
          <div className="progress-bar"><div style={{ width: `${Math.max(2, Math.min(100, weeklyGoal.progress_pct))}%` }} /></div>
          <small className="xp-story-goal-compare">
            {lang === "ko"
              ? `직전 ${formatDisplayXp(weeklyPrevXp, xpDisplayScale)} XP · ${formatSignedPct(weeklyDeltaPct)}`
              : `Prev ${formatDisplayXp(weeklyPrevXp, xpDisplayScale)} XP · ${formatSignedPct(weeklyDeltaPct)}`}
          </small>
        </div>

        <div className="xp-story-goal-row">
          <div className="xp-story-goal-label">
            <span>
              {lang === "ko" ? "월간 목표" : "Monthly Goal"}
              <small className="xp-story-goal-period">{monthlyRangeLabel}</small>
            </span>
            <strong>{formatDisplayXp(monthlyGoal.current_xp, xpDisplayScale)} / {formatDisplayXp(monthlyGoal.effective, xpDisplayScale)} XP</strong>
          </div>
          <div className="progress-bar"><div style={{ width: `${Math.max(2, Math.min(100, monthlyGoal.progress_pct))}%` }} /></div>
          <small className="xp-story-goal-compare">
            {lang === "ko"
              ? `직전 ${formatDisplayXp(monthlyPrevXp, xpDisplayScale)} XP · ${formatSignedPct(monthlyDeltaPct)}`
              : `Prev ${formatDisplayXp(monthlyPrevXp, xpDisplayScale)} XP · ${formatSignedPct(monthlyDeltaPct)}`}
          </small>
        </div>

        {editingGoals ? (
          <div className="xp-story-goal-edit">
            <label>
              {lang === "ko" ? "주간 목표 XP" : "Weekly XP Goal"}
              <input value={goalWeeklyInput} onChange={(event) => setGoalWeeklyInput(normalizeGoalInput(event.target.value))} />
            </label>
            <label>
              {lang === "ko" ? "월간 목표 XP" : "Monthly XP Goal"}
              <input value={goalMonthlyInput} onChange={(event) => setGoalMonthlyInput(normalizeGoalInput(event.target.value))} />
            </label>
            <div className="switch-row">
              <button className="primary-btn" disabled={savingGoals} onClick={() => void saveGoals()}>{lang === "ko" ? "저장" : "Save"}</button>
              <button className="ghost-btn" disabled={savingGoals} onClick={() => setEditingGoals(false)}>{lang === "ko" ? "취소" : "Cancel"}</button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="card xp-story-top-card xp-story-unlock-card" data-testid="xp-next-win">
        <h2>{lang === "ko" ? "다음 해금" : "Next Unlock"}</h2>
        {player.story.unlock_preview.next ? (
          <div className="xp-story-next-unlock">
            <strong>Lv.{player.story.unlock_preview.next.level_required} · {player.story.unlock_preview.next.name}</strong>
            <small>{player.story.unlock_preview.next.description}</small>
            <div className="progress-bar"><div style={{ width: `${Math.max(2, player.story.unlock_preview.next.progress_pct)}%` }} /></div>
          </div>
        ) : (
          <small className="muted">{lang === "ko" ? "모든 해금을 달성했습니다." : "All unlocks achieved."}</small>
        )}
        <div className="xp-story-unlock-list">
          {player.story.unlock_preview.upcoming.slice(0, 2).map((unlock) => (
            <div key={`${unlock.level_required}_${unlock.name}`} className="xp-story-unlock-item">
              <div className="xp-story-unlock-title-row">
                <strong>Lv.{unlock.level_required} · {unlock.name}</strong>
                <small>{unlock.type}</small>
              </div>
              <div className="progress-bar"><div style={{ width: `${Math.max(2, unlock.progress_pct)}%` }} /></div>
            </div>
          ))}
        </div>
      </section>

      <section className="card xp-story-chart-main">
        <div className="xp-story-card-head">
          <h2>{lang === "ko" ? "XP 그래프" : "XP Timeline"}</h2>
          <div className="switch-row">
            {(["day", "week", "month"] as XPGranularityKey[]).map((key) => (
              <button key={key} className={`ghost-btn ${granularity === key ? "active-mini" : ""}`} onClick={() => setGranularity(key)}>
                {key === "day" ? (lang === "ko" ? "일간" : "Daily") : key === "week" ? (lang === "ko" ? "주간" : "Weekly") : (lang === "ko" ? "월간" : "Monthly")}
              </button>
            ))}
          </div>
        </div>
        <div className="xp-story-bar-shell">
          <div className="xp-story-y-axis">
            {[...yTicks].reverse().map((tick) => <span key={`tick_${tick}`}>{formatDisplayXp(tick, xpDisplayScale)}</span>)}
          </div>
          <div className="xp-story-bar-canvas">
            {[...yTicks].reverse().map((tick, idx) => <div key={`grid_${idx}_${tick}`} className="xp-story-grid-line" style={{ top: `${(idx / (yTicks.length - 1)) * 100}%` }} />)}
            <div className="xp-story-bars">
              {xpRows.map((row, idx) => {
                const height = Math.max(0, Math.round((row.xp / chartMaxXp) * 100));
                const markerLabel = barMarkerMap.get(idx);
                const showLabel = idx === 0 || idx === xpRows.length - 1 || idx % barLabelStep === 0 || Boolean(markerLabel);
                const labelParts = showLabel ? formatBarLabelParts(row.key, granularity, lang) : null;
                const pointLabel = granularity === "day" ? (lang === "ko" ? "해당 일자 XP" : "XP on date") : (lang === "ko" ? "해당 구간 XP" : "XP in period");
                return (
                  <div key={`${row.key}_${idx}`} className="xp-story-bar-item">
                    <div className="xp-story-bar-column">
                      <span className="xp-story-bar-tip">
                        <span>{lang === "ko" ? `${windowDaySpan}일 데이터` : `${windowDaySpan} days in range`}</span>
                        <span>
                          {lang === "ko"
                            ? `구간 총 XP ${formatDisplayXp(summary.xp_total, xpDisplayScale)}`
                            : `Range total ${formatDisplayXp(summary.xp_total, xpDisplayScale)} XP`}
                        </span>
                        <span>{`${formatBarPointKey(row.key, granularity)} · ${pointLabel} ${formatDisplayXp(row.xp, xpDisplayScale)}`}</span>
                      </span>
                      {markerLabel ? (
                        <>
                          <span className="xp-story-bar-marker-line" />
                          <span className="xp-story-bar-marker-label">{markerLabel}</span>
                        </>
                      ) : null}
                      <div className="xp-story-bar" style={{ height: `${height}%` }} />
                    </div>
                    <small>
                      {labelParts ? (
                        <>
                          <span>{labelParts.top}</span>
                          <span>{labelParts.bottom}</span>
                        </>
                      ) : null}
                    </small>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="card xp-story-chart-side">
        <h2>{lang === "ko" ? "레벨 진행" : "Level Progress"}</h2>
        <div className="xp-story-line-wrap">
          <div className="xp-story-line-yaxis">
            {reverseLevelTicks.map((lv) => (
              <span key={`ylv_${lv}`}>{lv}</span>
            ))}
          </div>
          <div className="xp-story-line-shell" ref={lineShellRef}>
            <svg viewBox={`0 0 ${lineSvgWidth} 100`} preserveAspectRatio="none">
              {levelTicks.map((lv) => {
                const y = 94 - ((lv - levelMin) / levelSpan) * 86;
                return (
                  <g key={`lv_${lv}`}>
                    <line x1="0" y1={y} x2={lineSvgWidth} y2={y} className="xp-story-line-grid" />
                  </g>
                );
              })}
              {polyline ? <polyline points={polyline} className="xp-story-line-path" /> : null}
              {latestLevelPoint ? (
                <g>
                  <circle cx={latestLevelPoint.x} cy={latestLevelPoint.y} r="1.6" className="xp-story-line-dot" />
                </g>
              ) : null}
            </svg>
          </div>
        </div>
        <div className="xp-story-line-xlabels">
          {lineXLabels.map((item) => (
            <small key={`x_${item.key}`} style={{ left: `${item.leftPct}%` }}>
              {formatBarPointKey(item.key, "day")}
            </small>
          ))}
        </div>
      </section>

      <section className="card xp-story-bottom-card">
        <div className="xp-story-card-head">
          <h2>{lang === "ko" ? "연습 잔디" : "Practice Grass"}</h2>
          <div className="switch-row">
            {(["all", "6w", "1y"] as HeatmapMode[]).map((mode) => (
              <button key={mode} className={`ghost-btn ${heatmapMode === mode ? "active-mini" : ""}`} onClick={() => setHeatmapMode(mode)}>
                {mode === "all" ? (lang === "ko" ? "전체" : "All") : mode === "6w" ? (lang === "ko" ? "6주" : "6w") : (lang === "ko" ? "1년" : "1y")}
              </button>
            ))}
          </div>
        </div>
        <div className="xp-story-heat-toolbar">
          {heatmapMode === "6w" ? (
            <div className="switch-row">
              <button className="ghost-btn" disabled={!canOlder6w} onClick={() => setHeatmap6wPage((prev) => prev + 1)}>{lang === "ko" ? "이전" : "Prev"}</button>
              <small className="muted">{activeHeatRangeLabel}</small>
              <button className="ghost-btn" disabled={!canNewer6w} onClick={() => setHeatmap6wPage((prev) => Math.max(0, prev - 1))}>{lang === "ko" ? "다음" : "Next"}</button>
            </div>
          ) : null}
          {heatmapMode === "1y" ? (
            <div className="switch-row">
              <button className="ghost-btn" disabled={!canOlderYear} onClick={() => setHeatmapYear((prev) => prev - 1)}>{lang === "ko" ? "이전" : "Prev"}</button>
              <small className="muted">{heatmapYear}</small>
              <button className="ghost-btn" disabled={!canNewerYear} onClick={() => setHeatmapYear((prev) => prev + 1)}>{lang === "ko" ? "다음" : "Next"}</button>
            </div>
          ) : null}
          {heatmapMode === "all" ? <small className="muted">{activeHeatRangeLabel}</small> : null}
        </div>

        {heatmapMode === "all" ? (
          <div className="xp-story-heatmap-all-grid" style={{ ["--all-week-max" as string]: String(allWeekMaxWeeks) }}>
            {allWeekRows.map((row) => (
              <div key={`all_${row.year}`} className="xp-story-heatmap-all-year-row" style={{ gridTemplateColumns: `44px repeat(${row.cells.length}, minmax(0, 1fr))` }}>
                <strong>{row.year}</strong>
                {row.cells.map((cell) => (
                  <i
                    key={cell.key}
                    className={`xp-story-heat-cell heat-i-${cell.intensity}`}
                    title={`${cell.weekStartKey} ~ ${cell.weekEndKey} · ${formatDisplayXp(cell.xp, xpDisplayScale)} XP`}
                  />
                ))}
              </div>
            ))}
          </div>
        ) : heatmapMode === "6w" ? (
          <div className="xp-story-heatmap-compact">
            {sixWeekCompact.cells.map((cell) => (
              <i
                key={`compact_${cell.key}_${cell.row}_${cell.col}`}
                className={`xp-story-heat-cell heat-i-${cell.intensity}`}
                style={{ gridColumn: cell.col + 1, gridRow: cell.row + 1 }}
                title={`${cell.key} · ${formatDisplayXp(cell.xp, xpDisplayScale)} XP`}
              />
            ))}
          </div>
        ) : (
          <div
            className="xp-story-heatmap-year-grid"
            ref={yearGridRef}
            style={{
              ["--xp-year-cell-h" as string]: `${yearCellHeight}px`,
              ["--xp-year-label-w" as string]: `${yearLabelWidth}px`,
            }}
          >
            {yearMonthGrid.rows.map((row) => (
              <div key={`ym_${yearMonthGrid.year}_${row.month}`} className="xp-story-heatmap-year-row">
                <strong>{row.label}</strong>
                {row.cells.map((cell) => (
                  <i
                    key={`heat_${cell.key}_${cell.month}_${cell.day}`}
                    className={`xp-story-heat-cell heat-i-${cell.intensity} ${cell.outside ? "outside placeholder" : ""}`}
                    title={cell.outside ? `${row.label}` : `${cell.key} · ${formatDisplayXp(cell.xp, xpDisplayScale)} XP`}
                  />
                ))}
              </div>
            ))}
          </div>
        )}

        <div className="xp-story-chip-row">
          <span className="achievement-chip">{lang === "ko" ? "연속" : "Current"} {player.story.streaks.current_days}{lang === "ko" ? "일" : "d"}</span>
          <span className="achievement-chip">{lang === "ko" ? "최장 연속" : "Best"} {player.story.streaks.longest_days}{lang === "ko" ? "일" : "d"}</span>
          <span className="achievement-chip">{lang === "ko" ? "최장 연속 주" : "Best Weeks"} {player.story.streaks.longest_weeks}</span>
        </div>
      </section>

      <section className="card xp-story-bottom-card">
        <div className="xp-story-card-head">
          <h2>{lang === "ko" ? "활동별 XP" : "XP by Activity"}</h2>
          <div className="xp-story-activity-controls">
            <select className="xp-story-activity-select" value={activityBreakdownMode} onChange={(event) => setActivityBreakdownMode(event.target.value as ActivityBreakdownMode)}>
              <option value="overall">{lang === "ko" ? "전체 활동" : "All Activities"}</option>
              <option value="song_title">{lang === "ko" ? "곡연습 · 곡별" : "Song · By Title"}</option>
              <option value="song_genre">{lang === "ko" ? "곡연습 · 장르별" : "Song · By Genre"}</option>
              <option value="drill_type">{lang === "ko" ? "드릴연습 · 유형별" : "Drill · By Type"}</option>
            </select>
            <div className="switch-row">
              <button className={`ghost-btn ${activityChartMode === "bar" ? "active-mini" : ""}`} onClick={() => setActivityChartMode("bar")}>
                {lang === "ko" ? "막대" : "Bar"}
              </button>
              <button className={`ghost-btn ${activityChartMode === "pie" ? "active-mini" : ""}`} onClick={() => setActivityChartMode("pie")}>
                {lang === "ko" ? "파이" : "Pie"}
              </button>
            </div>
          </div>
        </div>
        {!activityRows.length ? (
          <small className="muted">{lang === "ko" ? "선택한 구간에 데이터가 없습니다." : "No data in this range."}</small>
        ) : activityChartMode === "bar" ? (
          <div className="activity-bars">
            {activityRows.map((item) => (
              <div key={item.key} className="activity-row" title={`${item.label} · ${formatDisplayXp(item.xp, xpDisplayScale)} XP`}>
                <span>{item.label}</span>
                <div className="progress-bar">
                  <div style={{ width: `${Math.max(2, Math.round((item.xp / maxActivity) * 100))}%`, background: item.color }} />
                </div>
                <strong>{formatDisplayXp(item.xp, xpDisplayScale)}</strong>
              </div>
            ))}
          </div>
        ) : (
          <div className="xp-story-pie-wrap">
            <div className="xp-story-pie-chart" style={{ background: pieGradient }}>
              <small>{lang === "ko" ? "총 XP" : "Total XP"}</small>
              <strong>{formatDisplayXp(pieTotalXp, xpDisplayScale)}</strong>
            </div>
            <div className="xp-story-pie-legend">
              {activityRows.map((item) => {
                const pct = pieTotalXp > 0 ? (item.xp / pieTotalXp) * 100 : 0;
                return (
                  <div
                    key={`legend_${item.key}`}
                    className="xp-story-pie-item"
                    title={`${item.label} · ${formatDisplayXp(item.xp, xpDisplayScale)} XP`}
                  >
                    <i style={{ background: item.color }} />
                    <span>{item.label}</span>
                    <small>{pct.toFixed(1)}%</small>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {xpGuideOpen ? (
        <div className="modal-backdrop" onClick={() => setXpGuideOpen(false)}>
          <div className="modal xp-guide-modal" onClick={(event) => event.stopPropagation()}>
            <div className="row">
              <h3>{lang === "ko" ? "XP 규칙 보기" : "XP Rulebook"}</h3>
              <button className="ghost-btn compact-add-btn" onClick={() => setXpGuideOpen(false)}>
                {lang === "ko" ? "닫기" : "Close"}
              </button>
            </div>

            <div className="xp-guide-grid">
              <section className="xp-guide-section">
                <h4>{lang === "ko" ? "레벨별 필요 XP" : "XP Required Per Level"}</h4>
                <small className="muted">
                  {lang === "ko"
                    ? `커브 타입: ${String(levelCurveConfig.type || "quadratic")} · Lv.${guideMaxLevel}까지`
                    : `Curve type: ${String(levelCurveConfig.type || "quadratic")} · up to Lv.${guideMaxLevel}`}
                </small>
                <div className="table-wrap xp-guide-table-wrap">
                  <table className="session-table xp-guide-table">
                    <thead>
                      <tr>
                        <th>{lang === "ko" ? "레벨" : "Level"}</th>
                        <th>{lang === "ko" ? "다음 레벨 필요" : "Need for Next Level"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {guideLevelRows.map((row) => (
                        <tr key={`xp_guide_lv_${row.level}`}>
                          <td>Lv.{row.level} → Lv.{row.nextLevel}</td>
                          <td>{row.needDisplay} XP</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <small className="muted">
                  {lang === "ko"
                    ? `Lv.${guideMaxLevel} 누적 총합: ${pointWithDisplay(guideTotalPoint)}`
                    : `Total to Lv.${guideMaxLevel}: ${pointWithDisplay(guideTotalPoint)}`}
                </small>
              </section>

              <section className="xp-guide-section">
                <h4>{lang === "ko" ? "활동별 XP 기준" : "XP by Activity"}</h4>
                <div className="xp-guide-kv-list">
                  <div>
                    <span>{lang === "ko" ? "세션 기본" : "Session Base"}</span>
                    <strong>{lang === "ko" ? `분당 ${sessionPerMinPoint}p` : `${sessionPerMinPoint}p per min`}</strong>
                  </div>
                  <div>
                    <span>{lang === "ko" ? "세션 배율" : "Session Multiplier"}</span>
                    <strong>x{sessionMultiplier.toFixed(2)}</strong>
                  </div>
                  <div>
                    <span>{lang === "ko" ? "백필 배율" : "Backfill Multiplier"}</span>
                    <strong>x{backfillMultiplier.toFixed(2)}</strong>
                  </div>
                  <div>
                    <span>{lang === "ko" ? "퀘스트 배율" : "Quest Multiplier"}</span>
                    <strong>x{questMultiplier.toFixed(2)}</strong>
                  </div>
                  <div>
                    <span>{lang === "ko" ? "업적 배율" : "Achievement Multiplier"}</span>
                    <strong>x{achievementMultiplier.toFixed(2)}</strong>
                  </div>
                </div>

                <div className="xp-guide-example-row">
                  <small>{lang === "ko" ? "세션 예시(배율 적용 후)" : "Session examples (after multiplier)"}</small>
                  <small>10m: {pointWithDisplay(sessionPerMinPoint * 10 * sessionMultiplier)}</small>
                  <small>30m: {pointWithDisplay(sessionPerMinPoint * 30 * sessionMultiplier)}</small>
                  <small>60m: {pointWithDisplay(sessionPerMinPoint * 60 * sessionMultiplier)}</small>
                </div>

                <div className="table-wrap xp-guide-table-wrap">
                  <table className="session-table xp-guide-table">
                    <thead>
                      <tr>
                        <th>{lang === "ko" ? "퀘스트" : "Quest"}</th>
                        <th>{lang === "ko" ? "자동/일반" : "Auto/Normal"}</th>
                        <th>{lang === "ko" ? "수동" : "Manual"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {questGuideRows.map((row) => (
                        <tr key={`xp_guide_quest_${row.period}_${row.difficulty}`}>
                          <td>{questPeriodLabel(row.period, lang)} · {questDifficultyLabel(row.difficulty, lang)}</td>
                          <td>{pointWithDisplay(row.autoPoint)}</td>
                          <td>{pointWithDisplay(row.manualPoint)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <small className="muted">
                  {lang === "ko"
                    ? "업적은 업적 마스터의 base 보상에 업적 배율이 적용됩니다."
                    : "Achievement XP = master base reward × achievement multiplier."}
                </small>
              </section>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
