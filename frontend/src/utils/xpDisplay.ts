import type { Settings } from "../types/models";

export const DEFAULT_XP_DISPLAY_SCALE = 50;

export function getXpDisplayScale(settings: Settings | null | undefined): number {
  const xp = (settings?.xp as Record<string, unknown>) ?? {};
  const raw = Number(xp.display_scale ?? DEFAULT_XP_DISPLAY_SCALE);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_XP_DISPLAY_SCALE;
  return Math.round(raw);
}

export function scaleDisplayXp(points: number, scale: number): number {
  const value = Number(points);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * scale);
}

export function formatDisplayXp(points: number, scale: number): string {
  return scaleDisplayXp(points, scale).toLocaleString();
}
