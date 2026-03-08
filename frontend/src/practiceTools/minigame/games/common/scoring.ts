export type RhythmGrade = "PERFECT" | "GOOD" | "MISS";

export function classifyTiming(diffMs: number, windowMs: number): RhythmGrade {
  const ad = Math.abs(diffMs);
  const perfectWindow = Math.max(12, windowMs * 0.68);
  if (ad <= perfectWindow) return "PERFECT";
  if (ad <= windowMs) return "GOOD";
  return "MISS";
}

export function rhythmTimingQuality(diffMs: number, windowMs: number): number {
  const safeWindow = Math.max(1, windowMs);
  const perfectWindow = Math.max(12, safeWindow * 0.45);
  const absDiff = Math.abs(diffMs);
  if (absDiff <= perfectWindow) return 1;

  const gradingRange = Math.max(1, safeWindow - perfectWindow);
  const ratio = (absDiff - perfectWindow) / gradingRange;
  const quality = 1 - ratio * 0.12;
  return Math.max(0.88, Math.min(1, quality));
}

export function scoreByGrade(grade: RhythmGrade): number {
  if (grade === "PERFECT") return 2;
  if (grade === "GOOD") return 1;
  return 0;
}

export function calcAccuracy(correctHits: number, totalInputs: number): number {
  if (totalInputs <= 0) return 0;
  return Number(((correctHits / totalInputs) * 100).toFixed(1));
}
