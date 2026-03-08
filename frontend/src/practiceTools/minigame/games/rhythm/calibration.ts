import type { RCCalibrationProfile } from "../../types/models";

export const RC_CALIBRATION_STORAGE_KEY = "mg_rc_calibration_v1";

export function computeMean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

export function computeStd(values: number[]): number {
  if (!values.length) return 0;
  const mean = computeMean(values);
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(Math.max(0, variance));
}

export function rankByStd(stdMs: number, thresholds: Record<string, number>): string {
  const s = Number(thresholds.S ?? 18);
  const a = Number(thresholds.A ?? 30);
  const b = Number(thresholds.B ?? 45);
  const c = Number(thresholds.C ?? 65);
  if (stdMs <= s) return "S";
  if (stdMs <= a) return "A";
  if (stdMs <= b) return "B";
  if (stdMs <= c) return "C";
  return "D";
}

export function loadCalibrationProfile(): RCCalibrationProfile | null {
  try {
    const raw = window.localStorage.getItem(RC_CALIBRATION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RCCalibrationProfile;
    if (typeof parsed !== "object" || !parsed) return null;
    return {
      avg_offset_ms: Number(parsed.avg_offset_ms ?? 0),
      std_ms: Number(parsed.std_ms ?? 0),
      rank: String(parsed.rank ?? "D"),
      captured_at: String(parsed.captured_at ?? ""),
    };
  } catch {
    return null;
  }
}

export function saveCalibrationProfile(profile: RCCalibrationProfile): void {
  window.localStorage.setItem(RC_CALIBRATION_STORAGE_KEY, JSON.stringify(profile));
}
