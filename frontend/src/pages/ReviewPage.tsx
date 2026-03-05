import { useEffect, useMemo, useState } from "react";
import { getRecords, getSessions } from "../api";
import { RecordPeriodToolbar } from "../components/records/RecordPeriodToolbar";
import { RecordTabHeader } from "../components/records/RecordTabHeader";
import { buildRecordPeriodWindow, createDefaultRecordPeriodState, inRecordPeriodWindow } from "../components/records/recordPeriod";
import { buildGenreGroups, collectGenrePool, parseGenreTokens } from "../genreCatalog";
import type { Lang } from "../i18n";
import type { RecordPeriodState, RecordPost, SessionItem } from "../types/models";

type Props = {
  lang: Lang;
  refreshToken?: number;
  catalogs: {
    song_library: Array<Record<string, string>>;
    drill_library: Array<Record<string, string>>;
  };
};

type DistMetric = "duration" | "count";
type ChartType = "bar" | "pie";
type RowValue = { key: string; label: string; value: number; color?: string };
type SongDrillCardKey =
  | "song_title"
  | "song_purpose"
  | "song_status"
  | "song_genre"
  | "song_mood"
  | "song_difficulty"
  | "drill_name"
  | "drill_area";

type StreakInfo = { length: number; start: string; end: string };

const DAY_LABELS_KO = ["월", "화", "수", "목", "금", "토", "일"];
const DAY_LABELS_EN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const STATUS_COLORS: Record<string, string> = {
  before: "color-mix(in srgb, var(--accent) 36%, #8ea2b4)",
  progress: "color-mix(in srgb, var(--accent) 64%, #2e8fcf)",
  done: "color-mix(in srgb, var(--accent) 58%, #42a374)",
  other: "color-mix(in srgb, var(--accent) 34%, #9f86b4)",
};

const CHART_THEME_COLORS = [
  "color-mix(in srgb, var(--accent) 56%, #2f8fce)",
  "color-mix(in srgb, var(--accent) 52%, #5f76c9)",
  "color-mix(in srgb, var(--accent) 56%, #3da686)",
  "color-mix(in srgb, var(--accent) 50%, #c37e3f)",
  "color-mix(in srgb, var(--accent) 50%, #b56d9e)",
  "color-mix(in srgb, var(--accent) 48%, #4d9fae)",
  "color-mix(in srgb, var(--accent) 46%, #92a141)",
  "color-mix(in srgb, var(--accent) 48%, #7f8fb4)",
];

function genreGroupColor(groupName: string): string {
  const key = normalizeLower(groupName);
  if (key.includes("팝") || key.includes("가요") || key.includes("pop")) return "color-mix(in srgb, var(--accent) 58%, #4d8fd8)";
  if (key.includes("록") || key.includes("메탈") || key.includes("rock") || key.includes("metal")) return "color-mix(in srgb, var(--accent) 46%, #758aa0)";
  if (key.includes("그루브") || key.includes("groove")) return "color-mix(in srgb, var(--accent) 58%, #3ea08a)";
  if (key.includes("펑키") || key.includes("펑크") || key.includes("funk")) return "color-mix(in srgb, var(--accent) 54%, #4b9f8f)";
  if (key.includes("재즈") || key.includes("jazz")) return "color-mix(in srgb, var(--accent) 48%, #8b74b6)";
  if (key.includes("발라드") || key.includes("ballad")) return "color-mix(in srgb, var(--accent) 46%, #a181c6)";
  return "color-mix(in srgb, var(--accent) 44%, #8799ae)";
}

function toDayKey(value: string): string {
  return String(value || "").slice(0, 10);
}

function toMinute(value: number | undefined | null): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed);
}

function parseCsvLike(raw: string): string[] {
  return String(raw || "")
    .split(/[,\n;|]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeLower(text: string): string {
  return String(text || "").trim().toLowerCase();
}

function mondayIndexFromDate(date: Date): number {
  const day = date.getDay();
  return day === 0 ? 6 : day - 1;
}

function toYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function dayDiff(a: Date, b: Date): number {
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((utcB - utcA) / 86400000);
}

function formatRange(start: string, end: string): string {
  if (!start || !end) return "-";
  return `${start} ~ ${end}`;
}

function formatDateCompact(key: string, lang: Lang): string {
  if (!key || key.length < 10) return "-";
  if (lang === "ko") return `${key.slice(5, 7)}/${key.slice(8, 10)}`;
  return key;
}

function formatDateTimeCompact(input: string, lang: Lang): string {
  if (!input || input.length < 10) return "-";
  const key = input.slice(0, 10);
  return formatDateCompact(key, lang);
}

function safePct(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function groupedStatus(status: string): "before" | "progress" | "done" | "other" {
  const normalized = normalizeLower(status);
  if (["목표", "예정", "카피중", "before", "planned"].includes(normalized)) return "before";
  if (["시작", "루프 연습", "연습 중", "progress", "in progress"].includes(normalized)) return "progress";
  if (["마무리", "공연완료", "포기", "done", "complete", "completed"].includes(normalized)) return "done";
  return "other";
}

function groupedStatusLabel(key: "before" | "progress" | "done" | "other", lang: Lang): string {
  if (key === "before") return lang === "ko" ? "시작 전" : "Before Start";
  if (key === "progress") return lang === "ko" ? "진행 중" : "In Progress";
  if (key === "done") return lang === "ko" ? "완료" : "Done";
  return lang === "ko" ? "기타" : "Other";
}

function topRows(input: RowValue[], maxRows = 12, otherLabel = "기타"): RowValue[] {
  if (input.length <= maxRows) return input;
  const head = input.slice(0, maxRows - 1);
  const tail = input.slice(maxRows - 1);
  const sum = tail.reduce((acc, row) => acc + row.value, 0);
  return [...head, { key: "other", label: otherLabel, value: sum, color: "#92a5b3" }];
}

function makePieStyle(rows: RowValue[]): React.CSSProperties {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  if (total <= 0) {
    return { background: "conic-gradient(#d8e2e6 0turn 1turn)" };
  }
  let acc = 0;
  const chunks = rows.map((row, index) => {
    const start = acc;
    acc += row.value / total;
    const end = acc;
    const color = row.color || CHART_THEME_COLORS[index % CHART_THEME_COLORS.length];
    return `${color} ${start}turn ${end}turn`;
  });
  return { background: `conic-gradient(${chunks.join(", ")})` };
}

function buildStreak(days: string[]): StreakInfo {
  if (!days.length) return { length: 0, start: "", end: "" };
  const sorted = [...new Set(days)].sort();
  let best: StreakInfo = { length: 1, start: sorted[0], end: sorted[0] };
  let start = sorted[0];
  let prev = sorted[0];
  let len = 1;
  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i];
    const prevDate = new Date(prev);
    const currDate = new Date(current);
    if (dayDiff(prevDate, currDate) === 1) {
      len += 1;
      prev = current;
      continue;
    }
    if (len > best.length) best = { length: len, start, end: prev };
    start = current;
    prev = current;
    len = 1;
  }
  if (len > best.length) best = { length: len, start, end: prev };
  return best;
}

function buildWeekStreak(days: string[]): StreakInfo {
  if (!days.length) return { length: 0, start: "", end: "" };
  const weekKeys = Array.from(
    new Set(
      days.map((day) => {
        const date = new Date(day);
        const weekStart = addDays(date, -mondayIndexFromDate(date));
        return toYmd(weekStart);
      })
    )
  ).sort();
  return buildStreak(weekKeys);
}

function formatMetricValue(value: number, metric: DistMetric, lang: Lang): string {
  const rounded = Math.round(value * 10) / 10;
  if (metric === "duration") {
    if (rounded >= 60) {
      const hours = Math.round((rounded / 60) * 10) / 10;
      return lang === "ko" ? `${hours}시간` : `${hours}h`;
    }
    return lang === "ko" ? `${rounded}분` : `${rounded}m`;
  }
  if (Math.abs(rounded - Math.round(rounded)) < 0.01) return lang === "ko" ? `${Math.round(rounded)}회` : `${Math.round(rounded)} times`;
  return lang === "ko" ? `${rounded}회` : `${rounded} times`;
}

function paintRows(rows: RowValue[]): RowValue[] {
  return rows.map((row, index) => {
    if (row.color) return row;
    if (row.key === "other") return { ...row, color: "#9aa9b4" };
    return { ...row, color: CHART_THEME_COLORS[index % CHART_THEME_COLORS.length] };
  });
}

function renderBarRows(rows: RowValue[], options?: { testId?: string; metric?: DistMetric; lang?: Lang }) {
  const metric = options?.metric ?? "count";
  const lang = options?.lang ?? "ko";
  if (!rows.length) {
    return (
      <div className="review-chart-empty" data-testid={options?.testId}>
        {lang === "ko" ? "데이터 없음" : "No data"}
      </div>
    );
  }
  const maxValue = Math.max(1, ...rows.map((row) => row.value));
  return (
    <div className="review-bar-list" data-testid={options?.testId}>
      {rows.map((row) => {
        const pct = Math.max(0, Math.min(100, (row.value / maxValue) * 100));
        const displayValue = formatMetricValue(row.value, metric, lang);
        return (
          <div className="review-bar-row" key={row.key} title={`${row.label}: ${displayValue}`}>
            <span className="review-bar-label">{row.label}</span>
            <div className="review-bar-track">
              <div className="review-bar-fill" style={{ width: `${pct}%`, background: row.color || "var(--accent)" }} />
            </div>
            <strong className="review-bar-value">{displayValue}</strong>
          </div>
        );
      })}
    </div>
  );
}

function polarPoint(cx: number, cy: number, radius: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
}

function pieSlicePath(cx: number, cy: number, radius: number, startAngle: number, endAngle: number): string {
  const start = polarPoint(cx, cy, radius, startAngle);
  const end = polarPoint(cx, cy, radius, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
}

function renderPie(rows: RowValue[], lang: Lang, metric: DistMetric = "count") {
  if (!rows.length) return <div className="review-chart-empty">{lang === "ko" ? "데이터 없음" : "No data"}</div>;
  const coloredRows = paintRows(rows);
  const total = coloredRows.reduce((sum, row) => sum + row.value, 0);
  const cx = 80;
  const cy = 80;
  const radius = 79;
  let acc = 0;
  const slices = coloredRows.map((row) => {
    const ratio = total > 0 ? row.value / total : 0;
    const start = acc;
    const end = acc + ratio * 360;
    acc = end;
    return { row, start, end, ratio };
  });
  return (
    <div className="review-pie-wrap">
      <div className="review-pie" style={makePieStyle(coloredRows)}>
        <svg className="review-pie-hitmap" viewBox="0 0 160 160" aria-hidden="true">
          {slices.map((slice) => {
            if (slice.row.value <= 0 || slice.ratio <= 0) return null;
            return (
              <path key={slice.row.key} d={pieSlicePath(cx, cy, radius, slice.start, slice.end)} fill="rgba(0,0,0,0.001)" stroke="none">
                <title>{`${slice.row.label} - ${formatMetricValue(slice.row.value, metric, lang)} (${Math.round(slice.ratio * 1000) / 10}%)`}</title>
              </path>
            );
          })}
        </svg>
      </div>
      <div className="review-pie-legend">
        {coloredRows.map((row, index) => {
          const pct = total > 0 ? Math.round((row.value / total) * 1000) / 10 : 0;
          const color = row.color || CHART_THEME_COLORS[index % CHART_THEME_COLORS.length];
          return (
            <div key={row.key} className="review-pie-legend-row" title={`${row.label} - ${formatMetricValue(row.value, metric, lang)}`}>
              <span className="review-pie-color" style={{ background: color }} />
              <span className="review-pie-text">{row.label}</span>
              <small className="review-pie-meta">{`${formatMetricValue(row.value, metric, lang)} · ${pct}%`}</small>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ReviewPage({ lang, refreshToken, catalogs }: Props) {
  const [periodState, setPeriodState] = useState<RecordPeriodState>(() => createDefaultRecordPeriodState());
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [records, setRecords] = useState<RecordPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [distMetric, setDistMetric] = useState<DistMetric>("duration");
  const [practiceChart, setPracticeChart] = useState<ChartType>("bar");
  const [songDrillMetric, setSongDrillMetric] = useState<DistMetric>("duration");
  const [songDrillChart, setSongDrillChart] = useState<ChartType>("bar");
  const [songStatusMode, setSongStatusMode] = useState<"group" | "detail">("group");
  const [songGenreMode, setSongGenreMode] = useState<"major" | "minor">("major");
  const [recordChart, setRecordChart] = useState<ChartType>("bar");

  const periodWindow = useMemo(() => buildRecordPeriodWindow(periodState, lang), [periodState, lang]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      setLoading(true);
      try {
        const [sessionRows, recordRows] = await Promise.all([getSessions(2400), getRecords({ limit: 1200 })]);
        if (!alive) return;
        setSessions(sessionRows);
        setRecords(recordRows);
      } finally {
        if (alive) setLoading(false);
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, [refreshToken]);

  const scopedSessions = useMemo(
    () => sessions.filter((row) => inRecordPeriodWindow(row.start_at || row.created_at || row.end_at, periodWindow)),
    [sessions, periodWindow]
  );

  const scopedRecords = useMemo(
    () => records.filter((row) => inRecordPeriodWindow(row.created_at, periodWindow)),
    [records, periodWindow]
  );

  const songMap = useMemo(() => {
    const map = new Map<string, Record<string, string>>();
    catalogs.song_library.forEach((row) => {
      if (row.library_id) map.set(row.library_id, row);
    });
    return map;
  }, [catalogs.song_library]);

  const drillMap = useMemo(() => {
    const map = new Map<string, Record<string, string>>();
    catalogs.drill_library.forEach((row) => {
      if (row.drill_id) map.set(row.drill_id, row);
    });
    return map;
  }, [catalogs.drill_library]);

  const songGenreGroupMap = useMemo(() => {
    const pool = collectGenrePool(catalogs.song_library.map((row) => String(row.genre || "")));
    const groups = buildGenreGroups(pool);
    const map = new Map<string, string>();
    groups.forEach((group) => {
      group.values.forEach((value) => map.set(value, group.name));
    });
    return map;
  }, [catalogs.song_library]);

  const summary = useMemo(() => {
    const totalMinutes = scopedSessions.reduce((sum, row) => sum + toMinute(row.duration_min), 0);
    const totalXp = scopedSessions.reduce((sum, row) => sum + toMinute(row.xp), 0);
    const totalSessions = scopedSessions.length;
    const avgMinutes = totalSessions > 0 ? Math.round((totalMinutes / totalSessions) * 10) / 10 : 0;
    const activeDays = new Set(scopedSessions.map((row) => toDayKey(row.start_at || row.created_at || row.end_at)).filter(Boolean)).size;
    return { totalMinutes, totalXp, totalSessions, avgMinutes, activeDays };
  }, [scopedSessions]);

  const highlights = useMemo(() => {
    const byDay = new Map<string, number>();
    scopedSessions.forEach((row) => {
      const day = toDayKey(row.start_at || row.created_at || row.end_at);
      if (!day) return;
      byDay.set(day, (byDay.get(day) ?? 0) + toMinute(row.duration_min));
    });
    const bestDay =
      Array.from(byDay.entries())
        .map(([day, minutes]) => ({ day, minutes }))
        .sort((a, b) => b.minutes - a.minutes)[0] ?? { day: "", minutes: 0 };

    const activeDayKeys = Array.from(byDay.keys()).sort();
    const dayStreak = buildStreak(activeDayKeys);
    const weekStreak = buildWeekStreak(activeDayKeys);
    return { bestDay, dayStreak, weekStreak };
  }, [scopedSessions]);

  const practiceDist = useMemo(() => {
    const dayRows: RowValue[] = Array.from({ length: 7 }).map((_, dayIndex) => ({
      key: String(dayIndex),
      label: lang === "ko" ? DAY_LABELS_KO[dayIndex] : DAY_LABELS_EN[dayIndex],
      value: 0,
    }));
    const hourRows: RowValue[] = Array.from({ length: 24 }).map((_, hour) => ({
      key: String(hour),
      label: String(hour).padStart(2, "0"),
      value: 0,
    }));
    const bucketRows: RowValue[] = [
      { key: "b1", label: "<=10", value: 0 },
      { key: "b2", label: "10~30", value: 0 },
      { key: "b3", label: "30~60", value: 0 },
      { key: "b4", label: "60~120", value: 0 },
      { key: "b5", label: "120+", value: 0 },
    ];

    const byDayMinutes = new Map<string, number>();
    scopedSessions.forEach((row) => {
      const duration = toMinute(row.duration_min);
      const weight = distMetric === "duration" ? duration : 1;
      const dateRaw = row.start_at || row.created_at || row.end_at;
      const date = new Date(dateRaw);
      if (Number.isNaN(date.getTime())) return;
      const dow = mondayIndexFromDate(date);
      dayRows[dow].value += weight;
      hourRows[date.getHours()].value += weight;
      const day = toYmd(date);
      byDayMinutes.set(day, (byDayMinutes.get(day) ?? 0) + duration);
      if (duration <= 10) bucketRows[0].value += weight;
      else if (duration <= 30) bucketRows[1].value += weight;
      else if (duration <= 60) bucketRows[2].value += weight;
      else if (duration <= 120) bucketRows[3].value += weight;
      else bucketRows[4].value += weight;
    });

    const endAnchor = periodWindow.endKey ? new Date(periodWindow.endKey) : new Date();
    const heatRows: Array<{ rowLabel: string; cells: Array<{ key: string; value: number }> }> = [];
    const startAnchor = addDays(endAnchor, -41);
    const startMonday = addDays(startAnchor, -mondayIndexFromDate(startAnchor));
    const heatCells = Array.from({ length: 42 }).map((_, index) => {
      const day = addDays(startMonday, index);
      const key = toYmd(day);
      return { key, value: byDayMinutes.get(key) ?? 0 };
    });
    for (let row = 0; row < 3; row += 1) {
      const cells = heatCells.slice(row * 14, row * 14 + 14);
      const rowLabel = `${formatDateCompact(cells[0].key, lang)}~${formatDateCompact(cells[cells.length - 1].key, lang)}`;
      heatRows.push({ rowLabel, cells });
    }
    const heatMax = Math.max(1, ...heatRows.flatMap((week) => week.cells.map((cell) => cell.value)));

    const today = periodWindow.endKey ? new Date(periodWindow.endKey) : new Date();
    const start7 = addDays(today, -6);
    const start30 = addDays(today, -29);
    const active7 = Array.from(byDayMinutes.keys()).filter((day) => day >= toYmd(start7) && day <= toYmd(today)).length;
    const active30 = Array.from(byDayMinutes.keys()).filter((day) => day >= toYmd(start30) && day <= toYmd(today)).length;

    const weekMap = new Map<string, number>();
    scopedSessions.forEach((row) => {
      const date = new Date(row.start_at || row.created_at || row.end_at);
      if (Number.isNaN(date.getTime())) return;
      const weekStart = toYmd(addDays(date, -mondayIndexFromDate(date)));
      weekMap.set(weekStart, (weekMap.get(weekStart) ?? 0) + 1);
    });
    const hitWeeks = Array.from(weekMap.values()).filter((count) => count >= 3).length;
    const totalWeeks = weekMap.size;
    const avgSessionMin = summary.totalSessions > 0 ? summary.totalMinutes / summary.totalSessions : 0;

    return {
      dayRows,
      hourRows,
      heatRows,
      heatMax,
      bucketRows,
      engagement: {
        revisit7dRate: safePct(active7, 7),
        activeDays30: active30,
        weeklyGoalHitRate: safePct(hitWeeks, Math.max(1, totalWeeks)),
        avgSessionMin: Math.round(avgSessionMin * 10) / 10,
      },
    };
  }, [scopedSessions, distMetric, periodWindow.endKey, lang, summary.totalSessions, summary.totalMinutes]);

  const hourRowsPie = useMemo(() => {
    const bins: RowValue[] = Array.from({ length: 8 }).map((_, index) => {
      const from = index * 3;
      const to = from + 2;
      return {
        key: `h3:${from}`,
        label: `${String(from).padStart(2, "0")}-${String(to).padStart(2, "0")}`,
        value: 0,
      };
    });
    practiceDist.hourRows.forEach((row) => {
      const hour = Number(row.key);
      if (!Number.isFinite(hour) || hour < 0 || hour > 23) return;
      const bucket = Math.floor(hour / 3);
      bins[bucket].value += row.value;
    });
    return paintRows(bins);
  }, [practiceDist.hourRows]);

  const songDrillRows = useMemo(() => {
    const mapByKey: Record<SongDrillCardKey, Map<string, RowValue>> = {
      song_title: new Map(),
      song_purpose: new Map(),
      song_status: new Map(),
      song_genre: new Map(),
      song_mood: new Map(),
      song_difficulty: new Map(),
      drill_name: new Map(),
      drill_area: new Map(),
    };
    const push = (map: Map<string, RowValue>, key: string, label: string, value: number, color?: string) => {
      if (!label) return;
      const prev = map.get(key);
      if (prev) {
        prev.value += value;
        return;
      }
      map.set(key, { key, label, value, color });
    };

    scopedSessions.forEach((row) => {
      const weight = songDrillMetric === "duration" ? toMinute(row.duration_min) : 1;
      if (weight <= 0) return;
      const song = row.song_library_id ? songMap.get(row.song_library_id) : undefined;
      const drill = row.drill_id ? drillMap.get(row.drill_id) : undefined;

      if (song) {
        const songLabel = (song.title || "").trim() || (song.artist || "").trim() || song.library_id || (lang === "ko" ? "미지정" : "Unknown");
        push(mapByKey.song_title, `song-title:${songLabel}`, songLabel, weight);

        const statusDetail = (song.status || "").trim() || (lang === "ko" ? "미분류" : "Uncategorized");
        const statusGroup = groupedStatus(song.status || "");
        const statusLabel = songStatusMode === "group" ? groupedStatusLabel(statusGroup, lang) : statusDetail;
        push(mapByKey.song_status, `song-status:${statusLabel}`, statusLabel, weight, STATUS_COLORS[statusGroup]);

        const purposeValues = parseCsvLike(song.purpose || "");
        if (!purposeValues.length) purposeValues.push(lang === "ko" ? "미지정" : "None");
        purposeValues.forEach((label) => push(mapByKey.song_purpose, `song-purpose:${label}`, label, weight));

        const moodValues = parseCsvLike(song.mood || "");
        if (!moodValues.length) moodValues.push(lang === "ko" ? "미지정" : "None");
        moodValues.forEach((label) => push(mapByKey.song_mood, `song-mood:${label}`, label, weight));

        const genreValues = parseGenreTokens(song.genre || "");
        if (!genreValues.length) genreValues.push(lang === "ko" ? "미지정" : "None");
        genreValues.forEach((token) => {
          const groupLabel = songGenreGroupMap.get(token) || token;
          const label = songGenreMode === "major" ? groupLabel : token;
          push(mapByKey.song_genre, `song-genre:${label}`, label, weight, genreGroupColor(groupLabel));
        });

        const difficulty = (song.difficulty || "").trim() || (lang === "ko" ? "미지정" : "None");
        push(mapByKey.song_difficulty, `song-diff:${difficulty}`, difficulty, weight);
      }

      if (drill) {
        const drillName = (drill.name || drill.drill_id || "").trim() || (lang === "ko" ? "미지정" : "None");
        push(mapByKey.drill_name, `drill-name:${drillName}`, drillName, weight);
        const drillArea = (drill.area || "").trim() || (lang === "ko" ? "미지정" : "None");
        push(mapByKey.drill_area, `drill-area:${drillArea}`, drillArea, weight);
      }
    });

    const toRows = (key: SongDrillCardKey, maxRows: number, keepOriginalColor = false) => {
      const rows = topRows(
        Array.from(mapByKey[key].values()).sort((a, b) => b.value - a.value),
        maxRows,
        lang === "ko" ? "기타" : "Other"
      );
      return keepOriginalColor ? rows : paintRows(rows);
    };

    return {
      song_title: toRows("song_title", 10),
      song_purpose: toRows("song_purpose", 10),
      song_status: toRows("song_status", 10, true),
      song_genre: toRows("song_genre", 10, true),
      song_mood: toRows("song_mood", 10),
      song_difficulty: toRows("song_difficulty", 10),
      drill_name: toRows("drill_name", 10),
      drill_area: toRows("drill_area", 10),
    };
  }, [scopedSessions, songDrillMetric, songMap, drillMap, lang, songStatusMode, songGenreMode, songGenreGroupMap]);

  const recordStats = useMemo(() => {
    const attachmentCounts = { image: 0, video: 0, audio: 0 };
    const contextMap = new Map<string, number>();
    const linkMap = new Map<string, number>();
    const tagMap = new Map<string, number>();
    const freeMap = new Map<string, number>();

    scopedRecords.forEach((row) => {
      (row.attachments || []).forEach((attachment) => {
        if (attachment.media_type === "image") attachmentCounts.image += 1;
        if (attachment.media_type === "video") attachmentCounts.video += 1;
        if (attachment.media_type === "audio") attachmentCounts.audio += 1;
      });
      const ctx = row.source_context || (lang === "ko" ? "미분류" : "Unknown");
      contextMap.set(ctx, (contextMap.get(ctx) ?? 0) + 1);

      if (row.linked_song_ids?.length) {
        const key = lang === "ko" ? "연결 곡" : "Linked Songs";
        linkMap.set(key, (linkMap.get(key) ?? 0) + row.linked_song_ids.length);
      }
      if (row.linked_drill_ids?.length) {
        const key = lang === "ko" ? "연결 드릴" : "Linked Drills";
        linkMap.set(key, (linkMap.get(key) ?? 0) + row.linked_drill_ids.length);
      }
      (row.tags || []).forEach((tag) => {
        if (!tag) return;
        tagMap.set(tag, (tagMap.get(tag) ?? 0) + 1);
      });
      (row.free_targets || []).forEach((tag) => {
        if (!tag) return;
        freeMap.set(tag, (freeMap.get(tag) ?? 0) + 1);
      });
    });

    const toRows = (map: Map<string, number>, prefix: string): RowValue[] =>
      topRows(
        Array.from(map.entries())
          .map(([label, value]) => ({ key: `${prefix}:${label}`, label, value }))
          .sort((a, b) => b.value - a.value),
        10,
        lang === "ko" ? "기타" : "Other"
      );

    return {
      totalPosts: scopedRecords.length,
      videoCount: attachmentCounts.video,
      audioCount: attachmentCounts.audio,
      imageCount: attachmentCounts.image,
      rows: {
        context: toRows(contextMap, "ctx"),
        linked: toRows(linkMap, "link"),
        tags: toRows(tagMap, "tag"),
        free: toRows(freeMap, "free"),
      },
    };
  }, [scopedRecords, lang]);

  const recordChartLabels: Record<keyof typeof recordStats.rows, string> = {
    context: lang === "ko" ? "맥락별 분포" : "By Context",
    linked: lang === "ko" ? "연결 곡/드릴 분포" : "Linked Song/Drill",
    tags: lang === "ko" ? "태그별 분포" : "Tags",
    free: lang === "ko" ? "자유 태그 분포" : "Free Tags",
  };
  const hourMax = Math.max(1, ...practiceDist.hourRows.map((row) => row.value));

  return (
    <div className="page-grid review-page-refined">
      <section className="card review-header-card">
        <RecordTabHeader
          title={lang === "ko" ? "돌아보기" : "Review"}
          subtitle={loading ? (lang === "ko" ? "데이터 불러오는 중..." : "Loading data...") : periodWindow.label}
          toolbar={<RecordPeriodToolbar lang={lang} value={periodState} onChange={setPeriodState} testIdPrefix="review-period" compact />}
        />
      </section>

      <div className="review-top-row">
        <section className="card review-top-card">
          <h2>{lang === "ko" ? "누적 성과" : "Cumulative"}</h2>
          <div className="stat-grid">
            <div>
              <span>{lang === "ko" ? "총 세션" : "Sessions"}</span>
              <strong>{summary.totalSessions}</strong>
            </div>
            <div>
              <span>{lang === "ko" ? "총 연습 시간(분)" : "Minutes"}</span>
              <strong>{summary.totalMinutes}</strong>
            </div>
            <div>
              <span>XP</span>
              <strong>{summary.totalXp}</strong>
            </div>
            <div>
              <span>{lang === "ko" ? "평균 세션(분)" : "Avg Session"}</span>
              <strong>{summary.avgMinutes}</strong>
            </div>
            <div>
              <span>{lang === "ko" ? "활동일" : "Active Days"}</span>
              <strong>{summary.activeDays}</strong>
            </div>
            <div>
              <span>{lang === "ko" ? "기간" : "Window"}</span>
              <strong className="review-period-value">
                {periodWindow.startKey ? formatRange(periodWindow.startKey, periodWindow.endKey || periodWindow.startKey) : lang === "ko" ? "전체" : "All"}
              </strong>
            </div>
          </div>
        </section>

        <section className="card review-top-card" data-testid="review-highlights">
          <h2>{lang === "ko" ? "하이라이트" : "Highlights"}</h2>
          <div className="review-highlights-grid">
            <div className="review-highlight-card">
              <span>{lang === "ko" ? "최장 연습 시간/일" : "Best Daily Minutes"}</span>
              <strong>{formatMetricValue(highlights.bestDay.minutes, "duration", lang)}</strong>
              <small>{formatDateCompact(highlights.bestDay.day, lang)}</small>
            </div>
            <div className="review-highlight-card">
              <span>{lang === "ko" ? "최다 연속 연습일" : "Longest Day Streak"}</span>
              <strong>{highlights.dayStreak.length}{lang === "ko" ? "일" : "d"}</strong>
              <small>{formatRange(formatDateCompact(highlights.dayStreak.start, lang), formatDateCompact(highlights.dayStreak.end, lang))}</small>
            </div>
            <div className="review-highlight-card">
              <span>{lang === "ko" ? "최다 연속 연습주" : "Longest Week Streak"}</span>
              <strong>{highlights.weekStreak.length}{lang === "ko" ? "주" : "w"}</strong>
              <small>{formatRange(formatDateCompact(highlights.weekStreak.start, lang), formatDateCompact(highlights.weekStreak.end, lang))}</small>
            </div>
          </div>
        </section>
      </div>

      <details className="card review-toggle-section" data-testid="review-toggle-practice">
        <summary>{lang === "ko" ? "연습 분포" : "Practice Distribution"}</summary>
        <div className="review-toggle-body">
          <div className="review-control-grid review-practice-control-grid">
            <label>
              {lang === "ko" ? "차트" : "Chart"}
              <div className="switch-row">
                <button className={`ghost-btn ${practiceChart === "bar" ? "active-mini" : ""}`} onClick={() => setPracticeChart("bar")}>
                  {lang === "ko" ? "막대" : "Bar"}
                </button>
                <button className={`ghost-btn ${practiceChart === "pie" ? "active-mini" : ""}`} onClick={() => setPracticeChart("pie")}>
                  {lang === "ko" ? "파이" : "Pie"}
                </button>
              </div>
            </label>
            <label>
              {lang === "ko" ? "기준" : "Metric"}
              <div className="switch-row">
                <button className={`ghost-btn ${distMetric === "duration" ? "active-mini" : ""}`} onClick={() => setDistMetric("duration")}>
                  {lang === "ko" ? "시간" : "Time"}
                </button>
                <button className={`ghost-btn ${distMetric === "count" ? "active-mini" : ""}`} onClick={() => setDistMetric("count")}>
                  {lang === "ko" ? "세션 수" : "Sessions"}
                </button>
              </div>
            </label>
          </div>

          <div className="review-practice-grid">
            <article className="review-subcard practice-card-heatmap">
              <h3>{lang === "ko" ? "6주 히트맵" : "6 Week Heatmap"}</h3>
              <div className="review-heatmap-grid" data-testid="review-6w-heatmap">
                {practiceDist.heatRows.map((row) => (
                  <div key={row.rowLabel} className="review-heatmap-row">
                    <small>{row.rowLabel}</small>
                    <div className="review-heatmap-cells">
                      {row.cells.map((cell) => {
                        const intensity = Math.min(1, cell.value / practiceDist.heatMax);
                        return (
                          <span
                            key={cell.key}
                            className="review-heat-cell"
                            title={`${cell.key} · ${Math.round(cell.value)}m`}
                            style={{ opacity: 0.14 + intensity * 0.86 }}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </article>
            <article className="review-subcard practice-card-engagement">
              <h3>{lang === "ko" ? "참여 지표" : "Engagement"}</h3>
              <div className="review-engagement-grid">
                <div>
                  <span>{lang === "ko" ? "7일 재방문율" : "7d Revisit"}</span>
                  <strong>{practiceDist.engagement.revisit7dRate}%</strong>
                </div>
                <div>
                  <span>{lang === "ko" ? "30일 활동일" : "30d Active Days"}</span>
                  <strong>{practiceDist.engagement.activeDays30}</strong>
                </div>
                <div>
                  <span>{lang === "ko" ? "주간 목표 달성률" : "Weekly Goal Hit"}</span>
                  <strong>{practiceDist.engagement.weeklyGoalHitRate}%</strong>
                </div>
                <div>
                  <span>{lang === "ko" ? "평균 세션 시간(분)" : "Avg Session Min"}</span>
                  <strong>{practiceDist.engagement.avgSessionMin}</strong>
                </div>
              </div>
            </article>
            <article className="review-subcard practice-card-weekly">
              <h3>{lang === "ko" ? "주간 리듬" : "Weekly Rhythm"}</h3>
              <div className="review-chart-frame">
                {practiceChart === "bar"
                  ? renderBarRows(practiceDist.dayRows, { testId: "review-week-rhythm", metric: distMetric, lang })
                  : renderPie(paintRows(practiceDist.dayRows), lang, distMetric)}
              </div>
            </article>
            <article className="review-subcard practice-card-hourly">
              <h3>{lang === "ko" ? "시간별 리듬" : "Hourly Rhythm"}</h3>
              <div className="review-chart-frame">
                {practiceChart === "bar" ? (
                  <div className="review-hour-bars">
                    {practiceDist.hourRows.map((row) => {
                      return (
                        <div key={row.key} className="review-hour-col" title={`${row.label}: ${formatMetricValue(row.value, distMetric, lang)}`}>
                          <div className="review-hour-track">
                            <div className="review-hour-fill" style={{ height: `${(row.value / hourMax) * 100}%` }} />
                          </div>
                          <small className="review-hour-label">{row.label}</small>
                          <small className="review-hour-value">{formatMetricValue(row.value, distMetric, lang)}</small>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  renderPie(hourRowsPie, lang, distMetric)
                )}
              </div>
            </article>
            <article className="review-subcard practice-card-bucket">
              <h3>{lang === "ko" ? "세션당 시간 분포" : "Duration per Session"}</h3>
              <div className="review-chart-frame">
                {practiceChart === "bar"
                  ? renderBarRows(practiceDist.bucketRows, { testId: "review-session-duration-buckets", metric: distMetric, lang })
                  : renderPie(paintRows(practiceDist.bucketRows), lang, distMetric)}
              </div>
            </article>
          </div>
        </div>
      </details>

      <details className="card review-toggle-section" data-testid="review-toggle-songdrill">
        <summary>{lang === "ko" ? "곡/드릴 분포" : "Song/Drill Distribution"}</summary>
        <div className="review-toggle-body">
          <div className="review-control-grid">
            <label>
              {lang === "ko" ? "차트" : "Chart"}
              <div className="switch-row">
                <button className={`ghost-btn ${songDrillChart === "bar" ? "active-mini" : ""}`} onClick={() => setSongDrillChart("bar")}>
                  {lang === "ko" ? "막대" : "Bar"}
                </button>
                <button className={`ghost-btn ${songDrillChart === "pie" ? "active-mini" : ""}`} onClick={() => setSongDrillChart("pie")}>
                  {lang === "ko" ? "파이" : "Pie"}
                </button>
              </div>
            </label>
            <label>
              {lang === "ko" ? "기준" : "Metric"}
              <div className="switch-row">
                <button className={`ghost-btn ${songDrillMetric === "duration" ? "active-mini" : ""}`} onClick={() => setSongDrillMetric("duration")}>
                  {lang === "ko" ? "시간" : "Time"}
                </button>
                <button className={`ghost-btn ${songDrillMetric === "count" ? "active-mini" : ""}`} onClick={() => setSongDrillMetric("count")}>
                  {lang === "ko" ? "세션 수" : "Sessions"}
                </button>
              </div>
            </label>
            <label>
              {lang === "ko" ? "곡 상태 그룹" : "Status Group"}
              <div className="switch-row">
                <button className={`ghost-btn ${songStatusMode === "group" ? "active-mini" : ""}`} onClick={() => setSongStatusMode("group")}>
                  {lang === "ko" ? "상위" : "Group"}
                </button>
                <button className={`ghost-btn ${songStatusMode === "detail" ? "active-mini" : ""}`} onClick={() => setSongStatusMode("detail")}>
                  {lang === "ko" ? "세부" : "Detail"}
                </button>
              </div>
            </label>
            <label>
              {lang === "ko" ? "곡 장르 그룹" : "Genre Group"}
              <div className="switch-row">
                <button className={`ghost-btn ${songGenreMode === "major" ? "active-mini" : ""}`} onClick={() => setSongGenreMode("major")}>
                  {lang === "ko" ? "상위" : "Major"}
                </button>
                <button className={`ghost-btn ${songGenreMode === "minor" ? "active-mini" : ""}`} onClick={() => setSongGenreMode("minor")}>
                  {lang === "ko" ? "세부" : "Minor"}
                </button>
              </div>
            </label>
          </div>

          <div className="review-songdrill-grid">
            {([
              ["song_title", lang === "ko" ? "곡" : "Song"],
              ["song_purpose", lang === "ko" ? "곡 목적" : "Song Purpose"],
              ["song_status", lang === "ko" ? "곡 상태" : "Song Status"],
              ["song_genre", lang === "ko" ? "곡 장르" : "Song Genre"],
              ["song_mood", lang === "ko" ? "곡 분위기" : "Song Mood"],
              ["song_difficulty", lang === "ko" ? "곡 난이도" : "Song Difficulty"],
              ["drill_name", lang === "ko" ? "드릴 이름" : "Drill Name"],
              ["drill_area", lang === "ko" ? "드릴 영역" : "Drill Area"],
            ] as Array<[SongDrillCardKey, string]>).map(([key, title]) => (
              <article className="review-subcard" key={key} data-testid={key === "song_status" ? "review-songdrill-chart" : undefined}>
                <h3>{title}</h3>
                <div className="review-chart-frame">
                  {songDrillChart === "bar"
                    ? renderBarRows(songDrillRows[key], {
                        testId: key === "song_status" ? "review-songdrill-chart-bars" : undefined,
                        metric: songDrillMetric,
                        lang,
                      })
                    : renderPie(songDrillRows[key], lang, songDrillMetric)}
                </div>
              </article>
            ))}
          </div>
        </div>
      </details>

      <details className="card review-toggle-section" data-testid="review-toggle-records">
        <summary>{lang === "ko" ? "기록" : "Records"}</summary>
        <div className="review-toggle-body">
          <div className="review-control-grid review-record-control-grid">
            <label>
              {lang === "ko" ? "차트" : "Chart"}
              <div className="switch-row">
                <button className={`ghost-btn ${recordChart === "bar" ? "active-mini" : ""}`} onClick={() => setRecordChart("bar")}>
                  {lang === "ko" ? "막대" : "Bar"}
                </button>
                <button className={`ghost-btn ${recordChart === "pie" ? "active-mini" : ""}`} onClick={() => setRecordChart("pie")}>
                  {lang === "ko" ? "파이" : "Pie"}
                </button>
              </div>
            </label>
          </div>

          <div className="review-record-top-stats">
            <div>
              <span>{lang === "ko" ? "전체 업로드" : "Total Posts"}</span>
              <strong>{recordStats.totalPosts}</strong>
            </div>
            <div>
              <span>{lang === "ko" ? "영상 수" : "Videos"}</span>
              <strong>{recordStats.videoCount}</strong>
            </div>
            <div>
              <span>{lang === "ko" ? "음성 수" : "Audios"}</span>
              <strong>{recordStats.audioCount}</strong>
            </div>
            <div>
              <span>{lang === "ko" ? "이미지 수" : "Images"}</span>
              <strong>{recordStats.imageCount}</strong>
            </div>
          </div>

          <div className="review-record-grid">
            {(Object.keys(recordStats.rows) as Array<keyof typeof recordStats.rows>).map((key) => {
              const rows = paintRows(recordStats.rows[key]);
              return (
                <article className="review-subcard" key={key}>
                  <h3>{recordChartLabels[key]}</h3>
                  <div className="review-chart-frame">{recordChart === "bar" ? renderBarRows(rows, { lang }) : renderPie(rows, lang)}</div>
                </article>
              );
            })}
          </div>
        </div>
      </details>

      <section className="card review-footer-card">
        <small className="muted">
          {lang === "ko"
            ? `세션 ${summary.totalSessions}건 · 최근 업데이트 ${scopedSessions[0]?.created_at ? formatDateTimeCompact(scopedSessions[0].created_at, lang) : "-"}`
            : `${summary.totalSessions} sessions · updated ${scopedSessions[0]?.created_at ? formatDateTimeCompact(scopedSessions[0].created_at, lang) : "-"}`}
        </small>
      </section>
    </div>
  );
}
