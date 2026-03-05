import type { Lang } from "../i18n";

function asFiniteNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function formatMinutesAsTime(value: number, lang: Lang): string {
  const minutes = Math.max(0, asFiniteNumber(value));
  if (minutes >= 60) {
    const hours = Math.round((minutes / 60) * 10) / 10;
    return lang === "ko" ? `${hours.toFixed(1)}시간` : `${hours.toFixed(1)}h`;
  }
  const rounded = Math.round(minutes);
  return lang === "ko" ? `${rounded}분` : `${rounded}m`;
}
