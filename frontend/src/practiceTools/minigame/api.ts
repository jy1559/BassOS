import type { GameId, MinigameConfig, MinigameRecord, MinigameStats, RecordPeriod } from "./types";
import { normalizeUserSettings, type MinigameUserSettings } from "./userSettings";

type SeedPayload = {
  seed: string;
  numeric_seed: number;
};

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? {});
  if (!(init?.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(url, { ...init, headers });
  const raw = await response.text();
  const trimmed = raw.trim();
  const parsed = trimmed ? (JSON.parse(trimmed) as Record<string, unknown>) : {};
  if (!response.ok || parsed.ok === false) {
    throw new Error(String(parsed.message || `${response.status} ${response.statusText || "Request failed"}`));
  }
  return parsed as T;
}

export async function getConfig(): Promise<MinigameConfig> {
  const data = await call<{ ok: true; config: MinigameConfig }>("/api/minigame/config");
  return data.config;
}

export async function getSeed(date?: string): Promise<SeedPayload> {
  const query = date ? `?date=${encodeURIComponent(date)}` : "";
  return call<SeedPayload & { ok: true }>(`/api/minigame/seed${query}`);
}

export async function getRecords(params: {
  game?: GameId;
  difficulty?: string;
  period?: RecordPeriod;
  limit?: number;
}): Promise<MinigameRecord[]> {
  const query = new URLSearchParams();
  if (params.game) query.set("game", params.game);
  if (params.difficulty) query.set("difficulty", params.difficulty);
  if (params.period) query.set("period", params.period);
  if (params.limit) query.set("limit", String(params.limit));
  const data = await call<{ ok: true; items: MinigameRecord[] }>(`/api/minigame/records?${query.toString()}`);
  return data.items;
}

export async function postRecord(payload: {
  game: GameId;
  mode: "CHALLENGE";
  difficulty: string;
  score: number;
  accuracy?: number;
  seed: string;
  duration_sec: number;
  share_text: string;
  detail_json?: Record<string, unknown>;
  source?: string;
}): Promise<MinigameRecord> {
  const data = await call<{ ok: true; item: MinigameRecord }>("/api/minigame/records", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return data.item;
}

export async function deleteRecord(recordId: string): Promise<void> {
  await call(`/api/minigame/records/${encodeURIComponent(recordId)}`, { method: "DELETE" });
}

export async function getLeaderboard(params: {
  game?: GameId;
  difficulty?: string;
  period?: RecordPeriod;
  limit?: number;
}): Promise<MinigameRecord[]> {
  const query = new URLSearchParams();
  if (params.game) query.set("game", params.game);
  if (params.difficulty) query.set("difficulty", params.difficulty);
  if (params.period) query.set("period", params.period);
  if (params.limit) query.set("limit", String(params.limit));
  const data = await call<{ ok: true; items: MinigameRecord[] }>(`/api/minigame/leaderboard?${query.toString()}`);
  return data.items;
}

export async function getStats(params: {
  game?: GameId;
  difficulty?: string;
  period?: RecordPeriod;
}): Promise<MinigameStats> {
  const query = new URLSearchParams();
  if (params.game) query.set("game", params.game);
  if (params.difficulty) query.set("difficulty", params.difficulty);
  if (params.period) query.set("period", params.period);
  return call<MinigameStats & { ok: true }>(`/api/minigame/stats?${query.toString()}`);
}

export function getGameImageUrl(game: GameId): string {
  return `/api/minigame/game-image/${encodeURIComponent(game)}`;
}

export async function getUserSettings(): Promise<MinigameUserSettings> {
  const data = await call<{ ok: true; settings: unknown }>("/api/minigame/user-settings");
  return normalizeUserSettings(data.settings);
}

export async function putUserSettings(settings: MinigameUserSettings): Promise<MinigameUserSettings> {
  const data = await call<{ ok: true; settings: unknown }>("/api/minigame/user-settings", {
    method: "PUT",
    body: JSON.stringify({ settings }),
  });
  return normalizeUserSettings(data.settings);
}
