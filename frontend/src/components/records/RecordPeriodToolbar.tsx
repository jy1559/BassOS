import { useMemo, useRef } from "react";
import type { Lang } from "../../i18n";
import type { RecordPeriodState, RecordPeriodUnit, RecordRecentDays } from "../../types/models";
import { buildRecordPeriodWindow, shiftRecordAnchor } from "./recordPeriod";

type Props = {
  lang: Lang;
  value: RecordPeriodState;
  onChange: (next: RecordPeriodState) => void;
  className?: string;
  testIdPrefix?: string;
  compact?: boolean;
};

export function RecordPeriodToolbar({
  lang,
  value,
  onChange,
  className = "",
  testIdPrefix = "record-period",
  compact = false,
}: Props) {
  const windowInfo = useMemo(() => buildRecordPeriodWindow(value, lang), [value, lang]);
  const dateInputRef = useRef<HTMLInputElement | null>(null);

  const updateScope = (scope: RecordPeriodState["scope"]) => {
    if (scope === value.scope) return;
    onChange({ ...value, scope });
  };

  const updatePeriodUnit = (unit: RecordPeriodUnit) => {
    if (value.periodUnit === unit && value.scope === "period") return;
    onChange({ ...value, scope: "period", periodUnit: unit });
  };

  const updateRecentDays = (days: RecordRecentDays) => {
    if (value.recentDays === days && value.scope === "recent") return;
    onChange({ ...value, scope: "recent", recentDays: days });
  };

  return (
    <div className={`record-period-toolbar ${compact ? "compact" : ""} ${className}`.trim()}>
      <div className="record-period-row">
        <div className="switch-row">
          <button
            type="button"
            className={`ghost-btn ${value.scope === "all" ? "active-mini" : ""}`}
            data-testid={`${testIdPrefix}-scope-all`}
            onClick={() => updateScope("all")}
          >
            {lang === "ko" ? "전체" : "All"}
          </button>
          <button
            type="button"
            className={`ghost-btn ${value.scope === "period" ? "active-mini" : ""}`}
            data-testid={`${testIdPrefix}-scope-period`}
            onClick={() => updateScope("period")}
          >
            {lang === "ko" ? "기간" : "Period"}
          </button>
          <button
            type="button"
            className={`ghost-btn ${value.scope === "recent" ? "active-mini" : ""}`}
            data-testid={`${testIdPrefix}-scope-recent`}
            onClick={() => updateScope("recent")}
          >
            {lang === "ko" ? "최근" : "Recent"}
          </button>
        </div>
        <small className="muted record-period-label">{windowInfo.label}</small>
      </div>

      {value.scope === "period" ? (
        <div className="record-period-row record-period-sub">
          <div className="switch-row">
            {(["week", "month", "year"] as RecordPeriodUnit[]).map((unit) => (
              <button
                key={unit}
                type="button"
                className={`ghost-btn ${value.periodUnit === unit ? "active-mini" : ""}`}
                data-testid={`${testIdPrefix}-unit-${unit}`}
                onClick={() => updatePeriodUnit(unit)}
              >
                {unit === "week" ? (lang === "ko" ? "주간" : "Week") : unit === "month" ? (lang === "ko" ? "월간" : "Month") : lang === "ko" ? "연간" : "Year"}
              </button>
            ))}
          </div>

          <div className="record-period-nav">
            <button
              type="button"
              className="ghost-btn icon-btn"
              data-testid={`${testIdPrefix}-prev`}
              onClick={() => onChange({ ...value, anchorDate: shiftRecordAnchor(value.anchorDate, value.periodUnit, -1) })}
            >
              {"<"}
            </button>
            <strong>{windowInfo.label}</strong>
            <button
              type="button"
              className="ghost-btn icon-btn"
              data-testid={`${testIdPrefix}-next`}
              onClick={() => onChange({ ...value, anchorDate: shiftRecordAnchor(value.anchorDate, value.periodUnit, 1) })}
            >
              {">"}
            </button>
            <button
              type="button"
              className="ghost-btn icon-btn"
              data-testid={`${testIdPrefix}-calendar`}
              onClick={() => dateInputRef.current?.click()}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 2h2v3h6V2h2v3h3v17H4V5h3V2Zm11 7H6v11h12V9Zm-9 3h2v2H9v-2Zm4 0h2v2h-2v-2Zm-4 4h2v2H9v-2Z" />
              </svg>
            </button>
            <input
              ref={dateInputRef}
              type="date"
              className="record-period-date-input"
              value={value.anchorDate}
              onChange={(event) => onChange({ ...value, anchorDate: event.target.value || value.anchorDate })}
            />
          </div>
        </div>
      ) : null}

      {value.scope === "recent" ? (
        <div className="record-period-row record-period-sub">
          <div className="switch-row">
            {([7, 30, 90] as RecordRecentDays[]).map((days) => (
              <button
                key={days}
                type="button"
                className={`ghost-btn ${value.recentDays === days ? "active-mini" : ""}`}
                data-testid={`${testIdPrefix}-recent-${days}`}
                onClick={() => updateRecentDays(days)}
              >
                {days}d
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
