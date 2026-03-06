import type {
  Achievement,
  AchievementPackExportResult,
  AchievementRecent,
  AdminAchievementMasterItem,
  AchievementRuleOptions,
  BackupInfo,
  GalleryItem,
  HudSummary,
  LevelUpCopy,
  MockDatasetExportResult,
  PlayerXP,
  PlayerXPWindow,
  Quest,
  MockDataStatus,
  MockDatasetInfo,
  RecordAttachment,
  RecordPost,
  SessionItem,
  SessionFinalizeInput,
  SessionFinalizeResult,
  SessionStopInput,
  SessionStopResult,
  SessionUpdateInput,
  Settings,
  RecordScope,
  RecordPeriodUnit,
  RecordRecentDays,
  StatsOverview,
  TutorialCompleteResponse,
  TutorialProgressResponse,
  TutorialState
} from "./types/models";

type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends (infer U)[]
    ? DeepPartial<U>[]
    : T[P] extends object
      ? DeepPartial<T[P]>
      : T[P];
};

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? {});
  if (!(init?.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(url, {
    ...init,
    headers
  });
  const body = await response.json();
  if (!response.ok || body.ok === false) {
    throw new Error(body.message ?? "Request failed");
  }
  return body as T;
}

export async function getSettings(): Promise<Settings> {
  const data = await call<{ settings: Settings; ok: true }>("/api/settings");
  return data.settings;
}

export async function putBasicSettings(patch: DeepPartial<Settings>): Promise<Settings> {
  const data = await call<{ settings: Settings; ok: true }>("/api/settings/basic", {
    method: "PUT",
    body: JSON.stringify(patch)
  });
  return data.settings;
}

export async function putCriticalSettings(patch: Record<string, unknown>): Promise<Settings> {
  const data = await call<{ settings: Settings; ok: true }>("/api/settings/critical", {
    method: "PUT",
    body: JSON.stringify(patch)
  });
  return data.settings;
}

export async function startSession(input?: {
  activity?: string;
  sub_activity?: string;
  song_library_id?: string;
  drill_id?: string;
  title?: string;
  notes?: string;
}): Promise<void> {
  await call("/api/session/start", { method: "POST", body: JSON.stringify(input ?? {}) });
}

export async function switchSession(input?: {
  activity?: string;
  sub_activity?: string;
  song_library_id?: string;
  drill_id?: string;
  title?: string;
  notes?: string;
}): Promise<{
  switched: boolean;
  session: Record<string, unknown>;
  auto_saved?: SessionStopResult | null;
  chain_count?: number;
  under_min_skipped?: boolean;
}> {
  return call("/api/session/switch", { method: "POST", body: JSON.stringify(input ?? {}) });
}

export async function retargetSession(input?: {
  activity?: string;
  sub_activity?: string;
  song_library_id?: string;
  drill_id?: string;
  title?: string;
  notes?: string;
}): Promise<{
  retargeted: boolean;
  session: Record<string, unknown>;
}> {
  return call("/api/session/retarget", { method: "POST", body: JSON.stringify(input ?? {}) });
}

export async function discardSession(input?: { chain_mode?: "last" | "all" }): Promise<{
  discarded?: boolean;
  chain_mode?: string;
  removed_saved_count?: number;
}> {
  return call("/api/session/discard", { method: "POST", body: JSON.stringify(input ?? {}) });
}

export async function stopSession(input: SessionStopInput): Promise<SessionStopResult> {
  return call<SessionStopResult & { ok: true }>("/api/session/stop", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function finalizeSession(input: SessionFinalizeInput): Promise<SessionFinalizeResult> {
  return call<SessionFinalizeResult & { ok: true }>("/api/session/finalize", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function quickLog(input: SessionStopInput): Promise<SessionStopResult> {
  return call<SessionStopResult & { ok: true }>("/api/session/quick-log", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function getLevelUpCopy(input: {
  level: number;
  before_level: number;
  lang?: "ko" | "en";
}): Promise<LevelUpCopy> {
  const params = new URLSearchParams({
    level: String(Math.max(1, Number(input.level || 1))),
    before_level: String(Math.max(1, Number(input.before_level || 1))),
    lang: input.lang ?? "ko",
  });
  const data = await call<{ ok: true; copy: LevelUpCopy }>(`/api/gamification/level-up-copy?${params.toString()}`);
  return data.copy;
}

export async function getHudSummary(): Promise<HudSummary> {
  const data = await call<{ summary: HudSummary; ok: true }>("/api/hud/summary");
  return data.summary;
}

export async function getQuests(): Promise<Quest[]> {
  const data = await call<{ quests: Quest[]; ok: true }>("/api/quests/current");
  return data.quests;
}

export async function claimQuest(questId: string): Promise<void> {
  await call(`/api/quests/${questId}/claim`, { method: "POST", body: JSON.stringify({}) });
}

export async function failQuest(questId: string): Promise<void> {
  await call(`/api/quests/${questId}/fail`, { method: "POST", body: JSON.stringify({}) });
}

export async function updateQuest(
  questId: string,
  payload: {
    title?: string;
    emoji?: string;
    description?: string;
    priority?: "low" | "normal" | "urgent";
    difficulty?: "low" | "mid" | "high";
    target?: number;
    due_date?: string;
  }
): Promise<Record<string, string>> {
  const data = await call<{ quest: Record<string, string>; ok: true }>(`/api/quests/${questId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  return data.quest;
}

export async function createCustomQuest(payload: {
  title: string;
  emoji?: string;
  description?: string;
  period_class?: "short" | "mid" | "long";
  difficulty?: "low" | "mid" | "high";
  priority?: "low" | "normal" | "urgent";
  genre_tags?: string[];
  linked_song_ids?: string[];
  linked_drill_ids?: string[];
  rule_type?: "count_events" | "sum_duration" | "manual";
  rule_filter?: Record<string, unknown>;
  target?: number;
  due_date?: string;
}): Promise<Record<string, string>> {
  const data = await call<{ quest: Record<string, string>; ok: true }>("/api/quests", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return data.quest;
}

export async function refreshAutoQuests(payload?: {
  period_class?: "short" | "mid" | "long";
  force?: boolean;
}): Promise<{ created_ids: string[]; expired_ids: string[]; periods: string[]; quests: Quest[] }> {
  return call<{ created_ids: string[]; expired_ids: string[]; periods: string[]; quests: Quest[]; ok: true }>(
    "/api/quests/auto/refresh",
    {
      method: "POST",
      body: JSON.stringify(payload ?? {}),
    }
  );
}

export async function getAchievements(): Promise<Achievement[]> {
  const data = await call<{ achievements: Achievement[]; ok: true }>("/api/achievements");
  return data.achievements;
}

export async function claimAchievement(achievementId: string): Promise<void> {
  await call(`/api/achievements/${achievementId}/claim`, {
    method: "POST",
    body: JSON.stringify({})
  });
}

export async function getRecentAchievements(limit = 5): Promise<AchievementRecent[]> {
  const data = await call<{ items: AchievementRecent[]; ok: true }>(`/api/achievements/recent?limit=${limit}`);
  return data.items;
}

export async function getAdminAchievementsMaster(): Promise<AdminAchievementMasterItem[]> {
  const data = await call<{ items: AdminAchievementMasterItem[]; ok: true }>("/api/admin/achievements/master");
  return data.items;
}

export async function getAchievementRuleOptions(): Promise<AchievementRuleOptions> {
  return call<AchievementRuleOptions & { ok: true }>("/api/admin/achievements/rule-options");
}

export async function createAdminAchievementMaster(payload: Record<string, unknown>): Promise<AdminAchievementMasterItem> {
  const data = await call<{ item: AdminAchievementMasterItem; ok: true }>("/api/admin/achievements/master", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return data.item;
}

export async function updateAdminAchievementMaster(
  achievementId: string,
  payload: Record<string, unknown>
): Promise<AdminAchievementMasterItem> {
  const data = await call<{ item: AdminAchievementMasterItem; ok: true }>(
    `/api/admin/achievements/master/${encodeURIComponent(achievementId)}`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    }
  );
  return data.item;
}

export async function deleteAdminAchievementMaster(
  achievementId: string,
  scope: "row" | "group" = "row"
): Promise<{ deleted: number }> {
  const data = await call<{ deleted: number; ok: true }>(
    `/api/admin/achievements/master/${encodeURIComponent(achievementId)}?scope=${scope}`,
    {
      method: "DELETE",
    }
  );
  return { deleted: data.deleted };
}

export async function resetCuratedAchievements(): Promise<{ count: number }> {
  const data = await call<{ count: number; ok: true }>("/api/admin/achievements/reset-curated", {
    method: "POST",
    body: JSON.stringify({}),
  });
  return { count: data.count };
}

export async function exportAchievementPack(input: {
  dataset_id: string;
  name?: string;
  description?: string;
}): Promise<AchievementPackExportResult> {
  return call<AchievementPackExportResult & { ok: true }>("/api/admin/achievements/export-pack", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function uploadAchievementIcon(file: File): Promise<{ path: string; url: string }> {
  const formData = new FormData();
  formData.append("file", file);
  return call<{ path: string; url: string; ok: true }>("/api/admin/achievements/icon-upload", {
    method: "POST",
    body: formData,
  });
}

export async function getCatalogs(): Promise<{
  song_ladder: Array<Record<string, string>>;
  song_library: Array<Record<string, string>>;
  drills: Array<Record<string, string>>;
  drill_library: Array<Record<string, string>>;
  backing_tracks: Array<Record<string, string>>;
}> {
  return call("/api/catalogs");
}

export async function createSong(item: Record<string, string>): Promise<void> {
  await call("/api/song-library", { method: "POST", body: JSON.stringify(item) });
}

export async function updateSong(libraryId: string, patch: Record<string, string>): Promise<void> {
  await call(`/api/song-library/${libraryId}`, { method: "PUT", body: JSON.stringify(patch) });
}

export async function deleteSong(libraryId: string): Promise<void> {
  await call(`/api/song-library/${libraryId}`, { method: "DELETE" });
}

export async function getMedia(): Promise<Array<Record<string, unknown>>> {
  const data = await call<{ media: Array<Record<string, unknown>>; ok: true }>("/api/media/list");
  return data.media;
}

export async function uploadByPath(sourcePath: string, mediaType: "audio" | "video"): Promise<{ path: string }> {
  return call<{ path: string; ok: true }>("/api/media/upload", {
    method: "POST",
    body: JSON.stringify({ source_path: sourcePath, media_type: mediaType })
  });
}

export async function uploadEvidenceFile(file: File, mediaType: "audio" | "video"): Promise<{ path: string }> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("media_type", mediaType);
  return call<{ path: string; ok: true }>("/api/media/upload", {
    method: "POST",
    body: formData
  });
}

export async function uploadAnyMediaFile(file: File, mediaType: "audio" | "video" | "image"): Promise<{ path: string }> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("media_type", mediaType);
  return call<{ path: string; ok: true }>("/api/media/upload", {
    method: "POST",
    body: formData
  });
}

export async function completeOnboarding(payload: {
  nickname: string;
  weekly_goal_sessions: number;
  theme: string;
  language: "ko" | "en";
  audio_enabled: boolean;
}): Promise<void> {
  await call("/api/onboarding/complete", { method: "POST", body: JSON.stringify(payload) });
}

export async function getTutorialState(campaignId = "core_v1"): Promise<TutorialState> {
  return call<TutorialState & { ok: true }>(`/api/tutorial/state?campaign_id=${encodeURIComponent(campaignId)}`);
}

export async function startTutorial(campaignId: string): Promise<TutorialProgressResponse> {
  return call<TutorialProgressResponse & { ok: true }>("/api/tutorial/start", {
    method: "POST",
    body: JSON.stringify({ campaign_id: campaignId }),
  });
}

export async function saveTutorialProgress(campaignId: string, stepIndex: number): Promise<TutorialProgressResponse> {
  return call<TutorialProgressResponse & { ok: true }>("/api/tutorial/progress", {
    method: "POST",
    body: JSON.stringify({ campaign_id: campaignId, step_index: stepIndex }),
  });
}

export async function markTutorialBannerSeen(campaignId: string): Promise<{ campaign_id: string; banner_seen: boolean }> {
  return call<{ campaign_id: string; banner_seen: boolean; ok: true }>("/api/tutorial/banner-seen", {
    method: "POST",
    body: JSON.stringify({ campaign_id: campaignId }),
  });
}

export async function completeTutorial(campaignId: string): Promise<TutorialCompleteResponse> {
  return call<TutorialCompleteResponse & { ok: true }>("/api/tutorial/complete", {
    method: "POST",
    body: JSON.stringify({ campaign_id: campaignId }),
  });
}

export async function createExport(): Promise<{ file: string; path: string }> {
  const data = await call<{ file: string; path: string; ok: true }>("/api/export", {
    method: "POST",
    body: JSON.stringify({})
  });
  return { file: data.file, path: data.path };
}

export async function getBackupList(): Promise<BackupInfo[]> {
  const data = await call<{ backups: BackupInfo[]; ok: true }>("/api/backup/list");
  return data.backups;
}

export async function restoreBackup(backupName: string): Promise<void> {
  await call("/api/backup/restore", {
    method: "POST",
    body: JSON.stringify({ backup_name: backupName }),
  });
}

export async function createBackupSnapshot(): Promise<{ created?: boolean; reason?: string; file?: string }> {
  return call<{ backup: { created?: boolean; reason?: string; file?: string }; ok: true }>("/api/system/pre-exit", {
    method: "POST",
    body: JSON.stringify({}),
  }).then((data) => data.backup);
}

export async function getUnlockables(): Promise<{ level: number; items: Array<Record<string, unknown>> }> {
  return call("/api/unlockables");
}

export async function getSessions(limit = 400): Promise<SessionItem[]> {
  const data = await call<{ sessions: SessionItem[]; ok: true }>(`/api/sessions?limit=${limit}`);
  return data.sessions;
}

export async function deleteSession(eventId: string): Promise<void> {
  await call(`/api/sessions/${eventId}`, { method: "DELETE" });
}

export async function updateSession(eventId: string, patch: SessionUpdateInput): Promise<SessionItem> {
  const data = await call<{ session: SessionItem; ok: true }>(`/api/sessions/${eventId}`, {
    method: "PUT",
    body: JSON.stringify(patch)
  });
  return data.session;
}

export async function getStatsOverview(questRange: "7d" | "30d" | "6m" | "all" = "all"): Promise<StatsOverview> {
  const data = await call<{ stats: StatsOverview; ok: true }>(
    `/api/stats/overview?quest_range=${encodeURIComponent(questRange)}`
  );
  return data.stats;
}

export async function getPlayerXP(): Promise<PlayerXP> {
  const data = await call<{ player: PlayerXP; ok: true }>("/api/player/xp");
  return data.player;
}

export async function getPlayerXPWindow(input: {
  scope?: RecordScope;
  period_unit?: RecordPeriodUnit;
  anchor?: string;
  recent_days?: RecordRecentDays;
}): Promise<PlayerXPWindow> {
  const params = new URLSearchParams();
  if (input.scope) params.set("scope", input.scope);
  if (input.period_unit) params.set("period_unit", input.period_unit);
  if (input.anchor) params.set("anchor", input.anchor);
  if (input.recent_days) params.set("recent_days", String(input.recent_days));
  const query = params.toString();
  const data = await call<{ window: PlayerXPWindow; ok: true }>(`/api/player/xp-window${query ? `?${query}` : ""}`);
  return data.window;
}

export async function getDrillLibrary(): Promise<Array<Record<string, string>>> {
  const data = await call<{ items: Array<Record<string, string>>; ok: true }>("/api/drill-library");
  return data.items;
}

export async function createDrill(item: Record<string, string>): Promise<void> {
  await call("/api/drill-library", { method: "POST", body: JSON.stringify(item) });
}

export async function updateDrill(drillId: string, patch: Record<string, string>): Promise<void> {
  await call(`/api/drill-library/${drillId}`, { method: "PUT", body: JSON.stringify(patch) });
}

export async function deleteDrill(drillId: string): Promise<void> {
  await call(`/api/drill-library/${drillId}`, { method: "DELETE" });
}

export async function getBackingTracks(): Promise<Array<Record<string, string>>> {
  const data = await call<{ items: Array<Record<string, string>>; ok: true }>("/api/backing-tracks");
  return data.items;
}

export async function createBackingTrack(item: Record<string, string>): Promise<void> {
  await call("/api/backing-tracks", { method: "POST", body: JSON.stringify(item) });
}

export async function updateBackingTrack(backingId: string, patch: Record<string, string>): Promise<void> {
  await call(`/api/backing-tracks/${backingId}`, { method: "PUT", body: JSON.stringify(patch) });
}

export async function deleteBackingTrack(backingId: string): Promise<void> {
  await call(`/api/backing-tracks/${backingId}`, { method: "DELETE" });
}

export async function adminGrantXp(xp: number): Promise<void> {
  await call("/api/admin/grant-xp", { method: "POST", body: JSON.stringify({ xp }) });
}

export async function adminResetProgress(): Promise<void> {
  await call("/api/admin/reset-progress", { method: "POST", body: JSON.stringify({}) });
}

export async function adminResetAll(): Promise<void> {
  await call("/api/admin/reset-all", { method: "POST", body: JSON.stringify({}) });
}

export async function getMockDatasets(): Promise<MockDatasetInfo[]> {
  const data = await call<{ ok: true; datasets: MockDatasetInfo[] }>("/api/admin/mock-data/datasets");
  return data.datasets;
}

export async function getMockDataStatus(): Promise<MockDataStatus> {
  return call<MockDataStatus & { ok: true }>("/api/admin/mock-data/status");
}

export async function activateMockData(datasetId: string, reset = false): Promise<MockDataStatus> {
  return call<MockDataStatus & { ok: true }>("/api/admin/mock-data/activate", {
    method: "POST",
    body: JSON.stringify({ dataset_id: datasetId, reset }),
  });
}

export async function deactivateMockData(): Promise<MockDataStatus> {
  return call<MockDataStatus & { ok: true }>("/api/admin/mock-data/deactivate", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function exportCurrentToMockDataset(input: {
  dataset_id: string;
  name?: string;
  description?: string;
  generate_sessions_60d?: boolean;
  session_days?: number;
}): Promise<MockDatasetExportResult> {
  return call<MockDatasetExportResult & { ok: true }>("/api/admin/mock-data/export-current", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getGallery(limit = 500): Promise<GalleryItem[]> {
  const data = await call<{ items: GalleryItem[]; ok: true }>(`/api/gallery/list?limit=${limit}`);
  return data.items;
}

export async function getRecords(params?: {
  limit?: number;
  q?: string;
  post_type?: string;
  media_type?: "all" | "image" | "video" | "audio";
  song_library_id?: string;
  drill_id?: string;
}): Promise<RecordPost[]> {
  const query = new URLSearchParams();
  query.set("limit", String(params?.limit ?? 500));
  if (params?.q) query.set("q", params.q);
  if (params?.post_type) query.set("post_type", params.post_type);
  if (params?.media_type && params.media_type !== "all") query.set("media_type", params.media_type);
  if (params?.song_library_id) query.set("song_library_id", params.song_library_id);
  if (params?.drill_id) query.set("drill_id", params.drill_id);
  const data = await call<{ items: RecordPost[]; ok: true }>(`/api/records/list?${query.toString()}`);
  return data.items;
}

export async function createRecordPost(
  payload: {
    title: string;
    body: string;
    post_type: string;
    tags: string[];
    linked_song_ids: string[];
    linked_drill_ids: string[];
    free_targets: string[];
    source_context?: string;
  },
  files: File[]
): Promise<RecordPost> {
  const formData = new FormData();
  formData.append("title", payload.title);
  formData.append("body", payload.body);
  formData.append("post_type", payload.post_type);
  formData.append("tags", JSON.stringify(payload.tags));
  formData.append("linked_song_ids", JSON.stringify(payload.linked_song_ids));
  formData.append("linked_drill_ids", JSON.stringify(payload.linked_drill_ids));
  formData.append("free_targets", JSON.stringify(payload.free_targets));
  if (payload.source_context) formData.append("source_context", payload.source_context);
  files.forEach((file) => formData.append("files", file));
  const data = await call<{ item: RecordPost; ok: true }>("/api/records", {
    method: "POST",
    body: formData,
  });
  return data.item;
}

export async function updateRecordPost(
  postId: string,
  patch: {
    title?: string;
    body?: string;
    post_type?: string;
    tags?: string[];
    linked_song_ids?: string[];
    linked_drill_ids?: string[];
    free_targets?: string[];
    source_context?: string;
  }
): Promise<RecordPost> {
  const data = await call<{ item: RecordPost; ok: true }>(`/api/records/${postId}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });
  return data.item;
}

export async function deleteRecordPost(postId: string): Promise<void> {
  await call(`/api/records/${postId}`, { method: "DELETE" });
}

export async function deleteRecordAttachment(postId: string, attachmentId: string): Promise<void> {
  await call(`/api/records/${postId}/attachments/${attachmentId}`, { method: "DELETE" });
}

export async function updateRecordAttachment(
  postId: string,
  attachmentId: string,
  patch: { title?: string; notes?: string; sort_order?: number }
): Promise<RecordAttachment> {
  const data = await call<{ attachment: RecordAttachment; ok: true }>(
    `/api/records/${postId}/attachments/${attachmentId}`,
    {
      method: "PUT",
      body: JSON.stringify(patch),
    }
  );
  return data.attachment;
}

export async function uploadGalleryFile(
  file: File,
  mediaType: "image" | "video" | "audio",
  title = "",
  notes = "",
  extras?: {
    tags?: string;
    song_library_id?: string;
    drill_id?: string;
    source_context?: string;
  }
): Promise<void> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("media_type", mediaType);
  if (title) formData.append("title", title);
  if (notes) formData.append("notes", notes);
  if (extras?.tags) formData.append("tags", extras.tags);
  if (extras?.song_library_id) formData.append("song_library_id", extras.song_library_id);
  if (extras?.drill_id) formData.append("drill_id", extras.drill_id);
  if (extras?.source_context) formData.append("source_context", extras.source_context);
  await call("/api/gallery/upload", { method: "POST", body: formData });
}

export async function deleteGalleryItem(eventId: string): Promise<void> {
  await call(`/api/gallery/${eventId}`, { method: "DELETE" });
}

export async function updateGalleryItem(
  eventId: string,
  patch: {
    title?: string;
    notes?: string;
    tags?: string | string[];
    song_library_id?: string;
    drill_id?: string;
    source_context?: string;
  }
): Promise<void> {
  await call(`/api/gallery/${eventId}`, { method: "PUT", body: JSON.stringify(patch) });
}
