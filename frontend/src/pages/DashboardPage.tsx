import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  claimQuest,
  getSessions,
  getStatsOverview,
  putBasicSettings,
  quickLog,
  startSession,
  uploadAnyMediaFile
} from "../api";
import { SessionStopModal } from "../components/session/SessionStopModal";
import { t, type Lang } from "../i18n";
import { pickSessionCoachLine } from "../utils/gameCopy";
import { formatDisplayXp, getXpDisplayScale } from "../utils/xpDisplay";
import type {
  Achievement,
  AchievementRecent,
  GalleryItem,
  HudSummary,
  Quest,
  SessionStopResult,
  SessionItem,
  Settings,
  StatsOverview
} from "../types/models";

type Props = {
  lang: Lang;
  hud: HudSummary;
  quests: Quest[];
  achievements: Achievement[];
  recentAchievements: AchievementRecent[];
  gallery: GalleryItem[];
  catalogs: {
    song_ladder: Array<Record<string, string>>;
    song_library: Array<Record<string, string>>;
    drills: Array<Record<string, string>>;
    drill_library: Array<Record<string, string>>;
  };
  settings: Settings;
  onRefresh: () => Promise<void>;
  notify: (message: string, type?: "success" | "error" | "info") => void;
  onNavigate: (tab: "dashboard" | "practice" | "tools" | "sessions" | "review" | "xp" | "quests" | "achievements" | "recommend" | "songs" | "drills" | "gallery" | "media" | "settings") => void;
  onSettingsChange: (settings: Settings) => void;
  onSessionCompleted?: (result: SessionStopResult, source: "normal" | "quick") => void;
  onQuestClaimed?: (questTitle: string) => void;
};

type MainActivity = "Song" | "Drill" | "Etc";
type StartMode = "simple" | "song" | "drill";
type QuickLogDurationPreset = "10" | "30" | "60" | "custom";
type QuickLogTarget = "none" | "song" | "drill" | "etc";
type DrillSubActivity = "Core" | "Funk" | "Slap" | "Theory";
type EtcSubActivity = "SongDiscovery" | "Community" | "Gear" | "Etc";
type BadgeTier = "bronze" | "silver" | "gold" | "platinum" | "diamond" | "challenger";
type DashboardVersion = "legacy" | "focus";
type DashboardWidgetKey =
  | "hud"
  | "timer"
  | "progress"
  | "achievements"
  | "photo"
  | "songShortcut"
  | "nextWin";
type WidgetLayout = { x: number; y: number; w: number; h: number; visible: boolean };
type DashboardPhotoItem = {
  id: string;
  title: string;
  path: string;
  created_at: string;
};

const legacyWidgetLayout: Record<DashboardWidgetKey, WidgetLayout> = {
  hud: { x: 1, y: 1, w: 1, h: 1, visible: true },
  timer: { x: 2, y: 1, w: 1, h: 1, visible: true },
  progress: { x: 1, y: 2, w: 2, h: 1, visible: true },
  nextWin: { x: 3, y: 3, w: 1, h: 1, visible: true },
  songShortcut: { x: 1, y: 3, w: 2, h: 1, visible: true },
  photo: { x: 3, y: 1, w: 1, h: 2, visible: true },
  achievements: { x: 1, y: 4, w: 2, h: 1, visible: false },
};

const focusWidgetLayout: Record<DashboardWidgetKey, WidgetLayout> = {
  hud: { x: 1, y: 1, w: 1, h: 1, visible: true },
  timer: { x: 2, y: 1, w: 1, h: 1, visible: true },
  nextWin: { x: 3, y: 4, w: 1, h: 1, visible: true },
  progress: { x: 1, y: 2, w: 2, h: 1, visible: true },
  songShortcut: { x: 1, y: 3, w: 2, h: 1, visible: true },
  achievements: { x: 1, y: 4, w: 2, h: 1, visible: true },
  photo: { x: 3, y: 1, w: 1, h: 3, visible: true },
};

function defaultWidgetLayout(version: DashboardVersion): Record<DashboardWidgetKey, WidgetLayout> {
  return version === "focus" ? focusWidgetLayout : legacyWidgetLayout;
}

function normalizeWidgetLayout(raw: unknown, version: DashboardVersion): Record<DashboardWidgetKey, WidgetLayout> {
  const defaults = defaultWidgetLayout(version);
  const source = typeof raw === "object" && raw ? (raw as Record<string, Partial<WidgetLayout>>) : {};
  const out = { ...defaults };
  for (const key of Object.keys(defaults) as DashboardWidgetKey[]) {
    const row = source[key] || {};
    out[key] = {
      x: Math.max(1, Math.min(3, Number(row.x) || defaults[key].x)),
      y: Math.max(1, Math.min(4, Number(row.y) || defaults[key].y)),
      w: Math.max(1, Math.min(3, Number(row.w) || defaults[key].w)),
      h: Math.max(1, Math.min(3, Number(row.h) || defaults[key].h)),
      visible: row.visible === undefined ? defaults[key].visible : Boolean(row.visible),
    };
  }
  out.hud.visible = true;
  out.timer.visible = true;
  if (version === "focus") {
    out.nextWin.h = 1;
  }
  return out;
}

function widgetStyle(layout: WidgetLayout): CSSProperties {
  return {
    gridColumn: `${layout.x} / span ${layout.w}`,
    gridRow: `${layout.y} / span ${layout.h}`,
  };
}

function LegacyDashboardView({ children }: { children: ReactNode }) {
  return <div className="dashboard-grid dashboard-grid-legacy">{children}</div>;
}

function FocusDashboardView({ children }: { children: ReactNode }) {
  return <div className="dashboard-grid dashboard-grid-focus">{children}</div>;
}

function splitList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((v) => String(v || "").trim()).filter(Boolean);
}

function dashboardPhotosFromProfile(raw: unknown): DashboardPhotoItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const row = item as Record<string, unknown>;
      const path = String(row.path || "").trim();
      if (!path) return null;
      return {
        id: String(row.id || `photo_${Math.random().toString(36).slice(2, 10)}`),
        title: String(row.title || "Dashboard Photo"),
        path,
        created_at: String(row.created_at || new Date().toISOString()),
      } satisfies DashboardPhotoItem;
    })
    .filter((item): item is DashboardPhotoItem => Boolean(item))
    .slice(-30);
}

function formatMinutes(total: number, lang: Lang): string {
  const safe = Math.max(0, total);
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  if (lang === "ko") return `${h}시간 ${m}분`;
  return `${h}h ${m}m`;
}

function isFavorite(value: string): boolean {
  const raw = String(value || "").toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

function fmtSec(sec: number): string {
  const mm = String(Math.floor(sec / 60)).padStart(2, "0");
  const ss = String(sec % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  return target.isContentEditable;
}

function imageUrl(item: DashboardPhotoItem | null): string {
  if (!item) return "";
  return item.path ? `/media/${item.path}` : "";
}

function songCoverUrl(song: Record<string, string> | null): string {
  if (!song) return "";
  if (song.cover_url) return song.cover_url;
  return song.cover_path ? `/media/${song.cover_path}` : "";
}

async function readClipboardImage(): Promise<File | null> {
  if (!navigator.clipboard || typeof navigator.clipboard.read !== "function") return null;
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const imageType = item.types.find((t) => t.startsWith("image/"));
      if (!imageType) continue;
      const blob = await item.getType(imageType);
      return new File([blob], `clipboard_${Date.now()}.png`, { type: imageType });
    }
  } catch {
    return null;
  }
  return null;
}

function rankItems(items: Array<Record<string, string>>, sessions: SessionItem[], kind: "song" | "drill", query: string): Array<Record<string, string>> {
  const normalized = query.trim().toLowerCase();
  const count = new Map<string, number>();
  sessions.forEach((s) => {
    const id = kind === "song" ? (s.song_library_id || "") : (s.drill_id || "");
    if (!id) return;
    count.set(id, (count.get(id) ?? 0) + 1);
  });
  return [...items]
    .filter((item) => {
      const id = kind === "song" ? (item.library_id || "") : (item.drill_id || "");
      const title = kind === "song" ? (item.title || "") : (item.name || "");
      const merged = `${id} ${title}`.toLowerCase();
      return !normalized || merged.includes(normalized);
    })
    .sort((a, b) => {
      const aId = kind === "song" ? (a.library_id || "") : (a.drill_id || "");
      const bId = kind === "song" ? (b.library_id || "") : (b.drill_id || "");
      const diff = (count.get(bId) ?? 0) - (count.get(aId) ?? 0);
      if (diff !== 0) return diff;
      return String((kind === "song" ? a.title : a.name) || "").localeCompare(String((kind === "song" ? b.title : b.name) || ""));
    });
}

function badgeTier(level: number): BadgeTier {
  if (level >= 50) return "challenger";
  if (level >= 40) return "diamond";
  if (level >= 30) return "platinum";
  if (level >= 20) return "gold";
  if (level >= 10) return "silver";
  return "bronze";
}

function badgeStep(level: number): number {
  const lv = Math.max(1, level);
  if (lv >= 50) return 10;
  if (lv >= 40) return lv - 39;
  if (lv >= 30) return lv - 29;
  if (lv >= 20) return lv - 19;
  if (lv >= 10) return lv - 9;
  return lv;
}

function tierLabel(tier: BadgeTier, lang: Lang): string {
  const ko: Record<BadgeTier, string> = {
    bronze: "브론즈",
    silver: "실버",
    gold: "골드",
    platinum: "플래티넘",
    diamond: "다이아",
    challenger: "챌린저"
  };
  const en: Record<BadgeTier, string> = {
    bronze: "Bronze",
    silver: "Silver",
    gold: "Gold",
    platinum: "Platinum",
    diamond: "Diamond",
    challenger: "Challenger"
  };
  return lang === "ko" ? ko[tier] : en[tier];
}

function normalizeGoalText(text: string, _lang: Lang): string {
  return text;
}

function remainDays(dueDate: string): number {
  const due = new Date(`${String(dueDate || "").slice(0, 10)}T00:00:00`).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.ceil((due - today) / (24 * 60 * 60 * 1000));
}

export function DashboardPage({
  lang,
  hud,
  quests,
  achievements,
  recentAchievements,
  gallery,
  catalogs,
  settings,
  onRefresh,
  notify,
  onNavigate,
  onSettingsChange,
  onSessionCompleted,
  onQuestClaimed,
}: Props) {
  const dashboardVersion: DashboardVersion =
    settings.ui.dashboard_version === "legacy" || settings.ui.dashboard_version === "focus"
      ? settings.ui.dashboard_version
      : settings.profile.onboarded
      ? "legacy"
      : "focus";
  const activeLayoutRaw =
    dashboardVersion === "focus" ? settings.ui.dashboard_layout_focus : settings.ui.dashboard_layout_legacy;
  const activeStart = hud.active_session?.start_at ? new Date(hud.active_session.start_at).getTime() : 0;
  const [seconds, setSeconds] = useState(0);
  const [showStopModal, setShowStopModal] = useState(false);
  const [stats, setStats] = useState<StatsOverview | null>(null);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [songQuery, setSongQuery] = useState("");
  const [drillQuery, setDrillQuery] = useState("");
  const [startSongId, setStartSongId] = useState(hud.active_session?.song_library_id ?? "");
  const [startDrillId, setStartDrillId] = useState(hud.active_session?.drill_id ?? "");
  const [startMode, setStartMode] = useState<StartMode>("simple");
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [showPhotoMenu, setShowPhotoMenu] = useState(false);
  const [showShortcutMenu, setShowShortcutMenu] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [featuredAspectRatio, setFeaturedAspectRatio] = useState(1);
  const [featuredPhotoId, setFeaturedPhotoId] = useState(String(settings.profile?.dashboard_featured_photo_id ?? ""));
  const [photoAnchor, setPhotoAnchor] = useState<"center" | "top" | "bottom" | "left" | "right">(
    (settings.profile?.dashboard_photo_anchor as "center" | "top" | "bottom" | "left" | "right") || "center"
  );
  const [widgetLayout, setWidgetLayout] = useState<Record<DashboardWidgetKey, WidgetLayout>>(
    normalizeWidgetLayout(activeLayoutRaw, dashboardVersion)
  );
  const [weeklyGoalSessions, setWeeklyGoalSessions] = useState(Number(settings.profile?.weekly_goal_sessions ?? 3));
  const [weeklyGoalMinutes, setWeeklyGoalMinutes] = useState(Number((settings.profile as Record<string, unknown>)?.weekly_goal_minutes ?? 90));
  const [monthlyGoalMinutes, setMonthlyGoalMinutes] = useState(Number((settings.profile as Record<string, unknown>)?.monthly_goal_minutes ?? 420));
  const [lastCoachMessage, setLastCoachMessage] = useState("");
  const [lastNextWinHint, setLastNextWinHint] = useState("");
  const [showQuickLogModal, setShowQuickLogModal] = useState(false);
  const [quickLogBusy, setQuickLogBusy] = useState(false);
  const [quickDurationPreset, setQuickDurationPreset] = useState<QuickLogDurationPreset>("10");
  const [quickDurationCustom, setQuickDurationCustom] = useState("10");
  const [quickTarget, setQuickTarget] = useState<QuickLogTarget>("none");
  const [quickSongId, setQuickSongId] = useState("");
  const [quickDrillSubActivity, setQuickDrillSubActivity] = useState<DrillSubActivity>("Core");
  const [quickEtcSubActivity, setQuickEtcSubActivity] = useState<EtcSubActivity>("Etc");

  useEffect(() => {
    setWidgetLayout(normalizeWidgetLayout(activeLayoutRaw, dashboardVersion));
  }, [activeLayoutRaw, dashboardVersion]);

  useEffect(() => {
    setPhotoAnchor(
      (settings.profile?.dashboard_photo_anchor as "center" | "top" | "bottom" | "left" | "right") || "center"
    );
  }, [settings.profile?.dashboard_photo_anchor]);

  useEffect(() => {
    setFeaturedPhotoId(String(settings.profile?.dashboard_featured_photo_id ?? ""));
  }, [settings.profile?.dashboard_featured_photo_id]);

  useEffect(() => {
    if (!activeStart) return setSeconds(0);
    const tick = () => setSeconds(Math.max(0, Math.floor((Date.now() - activeStart) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [activeStart]);

  useEffect(() => {
    void getStatsOverview().then(setStats).catch(() => undefined);
    void getSessions(800).then(setSessions).catch(() => undefined);
  }, [hud.total_xp]);

  const rankedSongs = useMemo(() => rankItems(catalogs.song_library, sessions, "song", songQuery), [catalogs.song_library, sessions, songQuery]);
  const rankedDrills = useMemo(() => rankItems([...catalogs.drills, ...catalogs.drill_library], sessions, "drill", drillQuery), [catalogs.drills, catalogs.drill_library, sessions, drillQuery]);
  const timerSongGroups = useMemo(() => {
    const favorites = rankedSongs.filter((item) => isFavorite(item.favorite || ""));
    const others = rankedSongs.filter((item) => !isFavorite(item.favorite || ""));
    return [
      {
        key: "favorites",
        label: lang === "ko" ? `즐겨찾기 (${favorites.length})` : `Favorites (${favorites.length})`,
        items: favorites,
      },
      {
        key: "others",
        label: lang === "ko" ? `전체 (${others.length})` : `All (${others.length})`,
        items: others,
      },
    ].filter((group) => group.items.length > 0);
  }, [rankedSongs, lang]);
  const timerDrillGroups = useMemo(() => {
    const favorites = rankedDrills.filter((item) => isFavorite(item.favorite || ""));
    const others = rankedDrills.filter((item) => !isFavorite(item.favorite || ""));
    return [
      {
        key: "favorites",
        label: lang === "ko" ? `즐겨찾기 (${favorites.length})` : `Favorites (${favorites.length})`,
        items: favorites,
      },
      {
        key: "others",
        label: lang === "ko" ? `전체 (${others.length})` : `All (${others.length})`,
        items: others,
      },
    ].filter((group) => group.items.length > 0);
  }, [rankedDrills, lang]);
  const safeRemainDays = (q: Quest): number => {
    const days = remainDays(q.due_date || "");
    return Number.isFinite(days) ? days : 9999;
  };
  const questHighlights = useMemo(() => {
    const priorityRank: Record<string, number> = { urgent: 0, normal: 1, low: 2 };
    const dueBucket = (q: Quest): number => {
      const days = safeRemainDays(q);
      if (q.claimable) return 0;
      if (days === 0) return 1;
      if (days >= 1 && days <= 7) return 2;
      return 3;
    };
    return [...quests]
      .filter((q) => q.status === "Active" || q.claimable)
      .sort((a, b) => {
        const bucketA = dueBucket(a);
        const bucketB = dueBucket(b);
        if (bucketA !== bucketB) return bucketA - bucketB;

        const daysA = safeRemainDays(a);
        const daysB = safeRemainDays(b);

        if (bucketA === 2 && daysA !== daysB) return daysA - daysB;
        if (bucketA === 3) {
          const priority = (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9);
          if (priority !== 0) return priority;
          if (daysA !== daysB) return daysA - daysB;
        }

        const dueDate = String(a.due_date || "").localeCompare(String(b.due_date || ""));
        if (dueDate !== 0) return dueDate;

        if (a.xp_reward !== b.xp_reward) return b.xp_reward - a.xp_reward;
        return String(a.quest_id || "").localeCompare(String(b.quest_id || ""));
      })
      .slice(0, dashboardVersion === "focus" ? 1 : 3);
  }, [dashboardVersion, quests]);
  const actionableQuests = useMemo(
    () => quests.filter((q) => q.status === "Active" || q.claimable),
    [quests]
  );
  const dueTodayCount = useMemo(
    () => actionableQuests.filter((q) => safeRemainDays(q) === 0).length,
    [actionableQuests]
  );
  const dueInSevenDaysCount = useMemo(
    () =>
      actionableQuests.filter((q) => {
        const days = safeRemainDays(q);
        return days >= 1 && days <= 7;
      }).length,
    [actionableQuests]
  );
  const profileMeta = settings.profile as Record<string, unknown>;
  const dashboardPhotos = useMemo(
    () => dashboardPhotosFromProfile(profileMeta.dashboard_photo_items),
    [profileMeta.dashboard_photo_items]
  );
  const featuredImage = useMemo(() => {
    if (featuredPhotoId) return dashboardPhotos.find((i) => i.id === featuredPhotoId) ?? null;
    return dashboardPhotos[0] ?? null;
  }, [dashboardPhotos, featuredPhotoId]);
  const activeSong = useMemo(
    () => catalogs.song_library.find((item) => item.library_id === (hud.active_session?.song_library_id || "")) ?? null,
    [catalogs.song_library, hud.active_session?.song_library_id]
  );
  const activeSongCover = useMemo(() => songCoverUrl(activeSong), [activeSong]);
  const featuredImageUrl = useMemo(() => imageUrl(featuredImage), [featuredImage]);
  const portraitPhoto = featuredAspectRatio > 0 && featuredAspectRatio < 0.95;

  useEffect(() => {
    if (!featuredImageUrl) {
      setFeaturedAspectRatio(1);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const ratio = img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : 1;
      setFeaturedAspectRatio(Number.isFinite(ratio) && ratio > 0 ? ratio : 1);
    };
    img.onerror = () => {
      if (cancelled) return;
      setFeaturedAspectRatio(1);
    };
    img.src = featuredImageUrl;
    return () => {
      cancelled = true;
    };
  }, [featuredImageUrl]);

  const weekInfo = (stats?.weekly ?? []).slice(-1)[0];
  const monthInfo = (stats?.monthly ?? []).slice(-1)[0];
  const weekSessions = weekInfo?.session_count ?? 0;
  const weekMinutes = weekInfo?.duration_min ?? 0;
  const monthMinutes = monthInfo?.duration_min ?? 0;
  const sessionPct = Math.min(100, Math.round((weekSessions / Math.max(1, weeklyGoalSessions)) * 100));
  const weekMinPct = Math.min(100, Math.round((weekMinutes / Math.max(10, weeklyGoalMinutes)) * 100));
  const monthMinPct = Math.min(100, Math.round((monthMinutes / Math.max(30, monthlyGoalMinutes)) * 100));
  const almostDone = achievements.filter((a) => !a.claimed && a.target > 0 && (a.progress / a.target) >= 0.75).slice(0, 3);
  const claimedAchievementCount = achievements.filter((a) => a.claimed).length;
  const achievementProgressPct = achievements.length
    ? Math.round((claimedAchievementCount / achievements.length) * 100)
    : 0;
  const shortcutIds = useMemo(() => splitList(profileMeta.song_shortcuts).slice(0, 8), [profileMeta.song_shortcuts]);
  const shortcutSongs = useMemo(
    () =>
      shortcutIds
        .map((id) => catalogs.song_library.find((song) => song.library_id === id))
        .filter((song): song is Record<string, string> => Boolean(song)),
    [shortcutIds, catalogs.song_library]
  );
  const totalPracticeMin = stats?.summary.total_duration_min ?? 0;

  const currentTier = badgeTier(hud.level);
  const currentStep = badgeStep(hud.level);
  const nextLevel = Math.min(50, hud.level + 1);
  const nextTier = badgeTier(nextLevel);
  const nextStep = badgeStep(nextLevel);
  const xpNeeded = Math.max(0, hud.xp_to_next - hud.current_level_xp);
  const xpDisplayScale = getXpDisplayScale(settings);
  const dashboardShellClass = [
    "dashboard-shell",
    dashboardVersion === "focus" ? "dashboard-focus" : "dashboard-legacy",
    settings.ui.dashboard_glass_cards === false ? "" : "glass-cards",
  ].filter(Boolean).join(" ");
  const dashboardShellStyle = undefined;

  const savePhotoItems = async (
    next: DashboardPhotoItem[],
    nextFeaturedId?: string,
    nextAnchor?: "center" | "top" | "bottom" | "left" | "right"
  ) => {
    const trimmed = next.slice(-30);
    const updated = await putBasicSettings({
      profile: {
        ...settings.profile,
        dashboard_photo_items: trimmed,
        dashboard_featured_photo_id: nextFeaturedId ?? featuredPhotoId,
        dashboard_photo_anchor: nextAnchor ?? photoAnchor,
      },
    });
    onSettingsChange(updated);
  };

  const uploadDashboardPhoto = async (selectedFile: File | null) => {
    if (!selectedFile) return;
    try {
      setPhotoUploading(true);
      const uploaded = await uploadAnyMediaFile(selectedFile, "image");
      const id = `dp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const title = selectedFile.name || "Dashboard Photo";
      const next = [
        ...dashboardPhotos,
        { id, title, path: uploaded.path, created_at: new Date().toISOString() },
      ].slice(-30);
      setFeaturedPhotoId(id);
      setPhotoAnchor("center");
      await savePhotoItems(next, id, "center");
    } finally {
      setPhotoUploading(false);
    }
  };

  const savePhotoSettings = async (nextAnchor: "center" | "top" | "bottom" | "left" | "right") => {
    const updated = await putBasicSettings({
      profile: {
        ...settings.profile,
        dashboard_photo_anchor: nextAnchor,
      },
    });
    onSettingsChange(updated);
  };

  const saveSongShortcuts = async (next: string[]) => {
    const updated = await putBasicSettings({
      profile: {
        ...settings.profile,
        song_shortcuts: next.filter(Boolean).slice(0, 8),
      },
    });
    onSettingsChange(updated);
  };

  const quickDetailValue =
    quickTarget === "song"
      ? quickSongId
      : quickTarget === "drill"
      ? quickDrillSubActivity
      : quickTarget === "etc"
      ? quickEtcSubActivity
      : "none";
  const quickDetailOptions = useMemo(() => {
    if (quickTarget === "none") {
      return [{ value: "none", label: lang === "ko" ? "선택 없음" : "None" }];
    }
    if (quickTarget === "song") {
      const out: Array<{ value: string; label: string }> = [{ value: "", label: lang === "ko" ? "(선택 없음)" : "(None)" }];
      timerSongGroups.forEach((group) => {
        group.items.forEach((song) => {
          out.push({
            value: song.library_id || "",
            label: `${group.label} - ${song.title || song.library_id || "-"}`,
          });
        });
      });
      return out;
    }
    if (quickTarget === "drill") {
      return [
        { value: "Core", label: lang === "ko" ? "기본기" : "Core" },
        { value: "Funk", label: lang === "ko" ? "펑크" : "Funk" },
        { value: "Slap", label: lang === "ko" ? "슬랩" : "Slap" },
        { value: "Theory", label: lang === "ko" ? "이론" : "Theory" },
      ];
    }
    return [
      { value: "SongDiscovery", label: lang === "ko" ? "곡 탐색" : "Song discovery" },
      { value: "Community", label: lang === "ko" ? "커뮤니티" : "Community" },
      { value: "Gear", label: lang === "ko" ? "장비" : "Gear" },
      { value: "Etc", label: lang === "ko" ? "기타" : "Etc" },
    ];
  }, [lang, quickTarget, timerSongGroups]);

  const setQuickDetailSelection = useCallback(
    (value: string) => {
      if (quickTarget === "song") {
        setQuickSongId(value);
        return;
      }
      if (quickTarget === "drill") {
        setQuickDrillSubActivity(value as DrillSubActivity);
        return;
      }
      if (quickTarget === "etc") {
        setQuickEtcSubActivity(value as EtcSubActivity);
      }
    },
    [quickTarget]
  );

  const openQuickLogModal = useCallback(() => {
    setQuickDurationPreset("10");
    setQuickDurationCustom("10");
    setQuickTarget("none");
    setQuickSongId("");
    setQuickDrillSubActivity("Core");
    setQuickEtcSubActivity("Etc");
    setShowQuickLogModal(true);
  }, []);

  const closeQuickLogModal = useCallback(() => {
    if (quickLogBusy) return;
    setShowQuickLogModal(false);
  }, [quickLogBusy]);

  const saveQuickLog = useCallback(async () => {
    if (quickLogBusy) return;

    const durationMin =
      quickDurationPreset === "custom"
        ? Math.max(1, Number.parseInt(quickDurationCustom, 10) || 10)
        : Number.parseInt(quickDurationPreset, 10);

    let activity: MainActivity = "Etc";
    let subActivity = "Etc";
    let songLibraryId = "";
    let drillId = "";
    let tags = ["QUICK", "ETC"];

    if (quickTarget === "song") {
      activity = "Song";
      subActivity = "SongPractice";
      songLibraryId = quickSongId;
      tags = ["QUICK", "SONG", "SONG_PRACTICE"];
    } else if (quickTarget === "drill") {
      activity = "Drill";
      subActivity = quickDrillSubActivity;
      tags = ["QUICK", "DRILL", quickDrillSubActivity.toUpperCase()];
    } else if (quickTarget === "etc") {
      activity = "Etc";
      subActivity = quickEtcSubActivity;
      tags = ["QUICK", "ETC", quickEtcSubActivity.toUpperCase()];
    }

    try {
      setQuickLogBusy(true);
      const result = await quickLog({
        activity,
        sub_activity: subActivity,
        song_library_id: songLibraryId,
        drill_id: drillId,
        tags,
        duration_min: durationMin,
        notes: "Quick Log",
      });
      onSessionCompleted?.(result, "quick");
      notify(
        `${lang === "ko" ? "빠른 기록 저장" : "Quick log saved"} (+${formatDisplayXp(result.xp_breakdown.total_xp, xpDisplayScale)} XP)`,
        "success"
      );
      setShowQuickLogModal(false);
      await onRefresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Quick log failed", "error");
    } finally {
      setQuickLogBusy(false);
    }
  }, [
    lang,
    notify,
    onRefresh,
    onSessionCompleted,
    quickDrillSubActivity,
    quickDurationCustom,
    quickDurationPreset,
    quickEtcSubActivity,
    quickLogBusy,
    quickSongId,
    quickTarget,
    xpDisplayScale,
  ]);

  useEffect(() => {
    if (!showQuickLogModal) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeQuickLogModal();
        return;
      }
      const isSaveKey =
        (event.key === "Enter" && !event.shiftKey) || event.key === " " || event.key === "Spacebar";
      if (isSaveKey) {
        if (isEditableTarget(event.target)) return;
        event.preventDefault();
        void saveQuickLog();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeQuickLogModal, saveQuickLog, showQuickLogModal]);

  const startNow = async () => {
    let activity: MainActivity | undefined;
    let sub: string | undefined;
    let songId = "";
    let drillId = "";

    if (startMode === "song") {
      activity = "Song";
      sub = "SongPractice";
      songId = startSongId;
    } else if (startMode === "drill") {
      activity = "Drill";
      sub = "Core";
      drillId = startDrillId;
    }

    const payload =
      startMode === "simple"
        ? { activity: "Etc", sub_activity: "Etc" }
        : { activity, sub_activity: sub, song_library_id: songId, drill_id: drillId };
    await startSession(payload);
    notify(lang === "ko" ? "세션 시작" : "Session started", "info");
    if (songId || drillId) onNavigate("practice");
    await onRefresh();
  };

  const remainText = (days: number): string => {
    if (lang === "ko") {
      if (days > 0) return `${days}일 남음`;
      if (days === 0) return "오늘 마감";
      return `${Math.abs(days)}일 지남`;
    }
    if (days > 0) return `${days}d left`;
    if (days === 0) return "Due today";
    return `${Math.abs(days)}d overdue`;
  };

  const claimQuestQuick = async (questId: string) => {
    try {
      await claimQuest(questId);
      const claimedQuest = quests.find((item) => item.quest_id === questId);
      onQuestClaimed?.(claimedQuest?.title || (lang === "ko" ? "퀘스트" : "Quest"));
      await onRefresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Claim failed", "error");
    }
  };
  const questFooterText =
    lang === "ko"
      ? `오늘 마감 ${dueTodayCount} · 7일 이내 ${dueInSevenDaysCount} · 전체 ${quests.length}`
      : `Due today ${dueTodayCount} · Due in 7d ${dueInSevenDaysCount} · Total ${quests.length}`;
  const DashboardView = dashboardVersion === "focus" ? FocusDashboardView : LegacyDashboardView;

  return (
    <div className={dashboardShellClass} style={dashboardShellStyle}>
      <DashboardView>
      <section className="card hud-card big-hud" style={widgetStyle(widgetLayout.hud)} data-testid="tutorial-dashboard-hud">
        <div className="hud-topline">
          <div>
            <div className="row player-name-row">
              <h2 className="player-name-big">{settings.profile.nickname || "Bassist"}</h2>
              <button className="tiny-info" onClick={() => setShowGoalModal(true)} title={lang === "ko" ? "목표 설정" : "Goal settings"}>...</button>
            </div>
            <small className="muted">{hud.level_title}</small>
          </div>
          <div className="hud-badge-stack">
            <div className={`hud-emblem tier-${currentTier} step-${Math.min(10, currentStep)}`}>
              <span className="emblem-core" />
              {currentStep >= 2 ? <span className="emblem-ring ring-1" /> : null}
              {currentStep >= 4 ? <span className="emblem-ring ring-2" /> : null}
              {currentStep >= 6 ? <span className="emblem-wing left" /> : null}
              {currentStep >= 7 ? <span className="emblem-wing right" /> : null}
              {currentStep >= 8 ? <span className="emblem-gem" /> : null}
              {currentStep >= 10 ? <span className="emblem-crown" /> : null}
            </div>
            <div className={`rank-badge ${currentTier} xl-badge no-wrap`}>{tierLabel(currentTier, lang)} · Lv.{hud.level}</div>
          </div>
        </div>

        <div className="hud-badge-ornate-row">
          <div className={`badge-core badge-${currentTier}`}>
            {Array.from({ length: Math.min(5, Math.max(1, Math.ceil(currentStep / 2))) }).map((_, idx) => (
              <span key={idx} className="badge-star">*</span>
            ))}
          </div>
          <small className="muted">{lang === "ko" ? "다음 배지" : "Next badge"} Lv.{nextLevel} · {tierLabel(nextTier, lang)} {nextStep}/10</small>
          {currentStep === 1 ? <span className="rank-badge no-wrap">{lang === "ko" ? "티어 시작" : "Tier Start"}</span> : null}
        </div>

        <div className="hud-stats">
          <div className="hud-stat"><span>{t(lang, "level")}</span><strong>{hud.level}</strong></div>
          <div className="hud-stat hud-stat-rank"><span>{t(lang, "rank")}</span><strong className="hud-rank-value">{hud.rank}</strong></div>
          <div className="hud-stat hud-stat-practice"><span>{lang === "ko" ? "총 연습 시간" : "Practice Time"}</span><strong className="hud-practice-time">{formatMinutes(totalPracticeMin, lang)}</strong></div>
        </div>
        <small className="muted hud-total-xp">{t(lang, "totalXp")} {formatDisplayXp(hud.total_xp, xpDisplayScale)} XP</small>

        <div className="progress-wrap">
          <div className="progress-bar huge"><div style={{ width: `${Math.max(0, Math.min(100, hud.progress_pct))}%` }} /></div>
          <small>
            {formatDisplayXp(hud.current_level_xp, xpDisplayScale)} / {formatDisplayXp(hud.xp_to_next, xpDisplayScale)} XP {" "}
            {lang === "ko" ? `다음 레벨까지 ${formatDisplayXp(xpNeeded, xpDisplayScale)} XP` : `${formatDisplayXp(xpNeeded, xpDisplayScale)} XP to next level`}
          </small>
        </div>
        <div className="hud-id-meta">
          <small>{lang === "ko" ? "이번 주 XP" : "Week XP"} · {formatDisplayXp(hud.week_xp, xpDisplayScale)}</small>
          <small>{lang === "ko" ? "다음 해금" : "Next Unlock"} · {hud.next_unlock?.name || (lang === "ko" ? "완료" : "Completed")}</small>
          {recentAchievements[0] ? <small>{lang === "ko" ? "최근 업적" : "Recent Achievement"} · {normalizeGoalText(recentAchievements[0].name, lang)}</small> : null}
        </div>
      </section>

      <section className="card timer-card" style={widgetStyle(widgetLayout.timer)} data-testid="tutorial-dashboard-timer">
        <h2>{lang === "ko" ? "세션 타이머" : "SESSION TIMER"}</h2>
        <div className="timer-value">{fmtSec(seconds)}</div>
        {activeSong ? (
          <div className="timer-song-panel">
            {activeSongCover ? <img src={activeSongCover} alt={activeSong.title || "cover"} /> : null}
            <div>
              <strong>{activeSong.title || activeSong.library_id}</strong>
              <small className="muted">{activeSong.artist || "-"}</small>
            </div>
          </div>
        ) : null}
        {!activeStart ? (
          <div className="timer-start-layout">
            <div className="timer-mode-main">
              <div className="timer-start-actions">
                <button className="primary-btn timer-main-action" onClick={startNow}>
                  {t(lang, "startSession")}
                </button>
                <button
                  className="ghost-btn timer-main-action"
                  data-testid="dashboard-quick-log-open"
                  onClick={openQuickLogModal}
                >
                  {lang === "ko" ? "빠른 기록" : "Quick Log"}
                </button>
              </div>
              <div className="timer-mode-list-inline" role="listbox" aria-label={lang === "ko" ? "시작 방식" : "Start mode"}>
                <button
                  className={`ghost-btn timer-mode-item ${startMode === "simple" ? "active-mini" : ""}`}
                  onClick={() => setStartMode("simple")}
                >
                  {lang === "ko" ? "바로 시작" : "Quick Start"}
                </button>
                <button
                  className={`ghost-btn timer-mode-item ${startMode === "song" ? "active-mini" : ""}`}
                  onClick={() => setStartMode("song")}
                >
                  {lang === "ko" ? "곡" : "Song"}
                </button>
                <button
                  className={`ghost-btn timer-mode-item ${startMode === "drill" ? "active-mini" : ""}`}
                  onClick={() => setStartMode("drill")}
                >
                  {lang === "ko" ? "드릴" : "Drill"}
                </button>
              </div>
              {startMode === "song" ? (
                <div className="song-form-grid timer-target-grid">
                  <label>{lang === "ko" ? "시작 곡" : "Start Song"}
                    <input value={songQuery} onChange={(e) => setSongQuery(e.target.value)} placeholder={lang === "ko" ? "검색" : "Search"} />
                    <select value={startSongId} onChange={(e) => setStartSongId(e.target.value)}>
                      <option value="">{lang === "ko" ? "(선택 없음)" : "(None)"}</option>
                      {timerSongGroups.map((group) => (
                        <optgroup key={group.key} label={group.label}>
                          {group.items.map((s) => (
                            <option key={s.library_id} value={s.library_id}>
                              {s.title || s.library_id}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                </div>
              ) : null}

              {startMode === "drill" ? (
                <div className="song-form-grid timer-target-grid">
                  <label>{lang === "ko" ? "시작 드릴" : "Start Drill"}
                    <input value={drillQuery} onChange={(e) => setDrillQuery(e.target.value)} placeholder={lang === "ko" ? "검색" : "Search"} />
                    <select value={startDrillId} onChange={(e) => setStartDrillId(e.target.value)}>
                      <option value="">{lang === "ko" ? "(선택 없음)" : "(None)"}</option>
                      {timerDrillGroups.map((group) => (
                        <optgroup key={group.key} label={group.label}>
                          {group.items.map((d) => (
                            <option key={d.drill_id} value={d.drill_id}>
                              {d.name || d.drill_id}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                </div>
              ) : null}

              {startMode === "simple" ? (
                <small className="muted">{lang === "ko" ? "목표 없이 바로 시작합니다." : "You can start a session without selecting a target."}</small>
              ) : null}
            </div>
          </div>
        ) : (
          <button className="danger-btn" data-testid="dashboard-stop-session" onClick={() => setShowStopModal(true)}>
            {t(lang, "stopSession")}
          </button>
        )}
      </section>

      {widgetLayout.nextWin.visible ? (
        <section className="card dashboard-achievement-card quest-center-card" style={widgetStyle(widgetLayout.nextWin)} data-testid="dashboard-next-win">
          <div className="row">
            <h2>{lang === "ko" ? "퀘스트 센터" : "Quest Center"}</h2>
            <button className="ghost-btn dashboard-link-btn-xs" onClick={() => onNavigate("quests")}>
              {lang === "ko" ? "퀘스트 탭" : "Open Quests"}
            </button>
          </div>
          <div className="dashboard-mini-list quest-center-list">
            {questHighlights.length ? (
              questHighlights.map((q) => {
                const due = safeRemainDays(q);
                return (
                  <div key={q.quest_id} className="quest-center-item">
                    <div className="quest-center-main">
                      <strong>{normalizeGoalText(q.title, lang)}</strong>
                      <small>{remainText(due)} · {q.progress}/{q.target} · +{formatDisplayXp(q.xp_reward, xpDisplayScale)} XP</small>
                    </div>
                    {q.claimable ? (
                      <button className="ghost-btn" onClick={() => void claimQuestQuick(q.quest_id)}>
                        {lang === "ko" ? "빠른 수령" : "Quick Claim"}
                      </button>
                    ) : null}
                  </div>
                );
              })
            ) : (
              <small className="muted">{lang === "ko" ? "처리할 퀘스트가 없습니다." : "No actionable quests."}</small>
            )}
          </div>
          {questFooterText ? <small className="muted quest-center-summary">{questFooterText}</small> : null}
          {lastNextWinHint || lastCoachMessage ? (
            <small className="muted quest-center-summary-sub">
              {[lastNextWinHint, lastCoachMessage].map((item) => String(item || "").trim()).filter(Boolean).join(" · ")}
            </small>
          ) : null}
        </section>
      ) : null}

      {widgetLayout.progress.visible ? (
        <section className="card dashboard-extra dashboard-progress-card" style={widgetStyle(widgetLayout.progress)}>
          <div className="row progress-settings-row"><span /><button className="tiny-info" onClick={() => setShowGoalModal(true)}>...</button></div>
          <div className="stat-grid">
            <div><span>{lang === "ko" ? "주간 세션" : "Weekly Sessions"}</span><strong>{weekSessions}/{weeklyGoalSessions}</strong></div>
            <div><span>{lang === "ko" ? "주간 시간(분)" : "Weekly Min"}</span><strong>{weekMinutes}/{weeklyGoalMinutes}</strong></div>
            <div><span>{lang === "ko" ? "월간 시간(분)" : "Monthly Min"}</span><strong>{monthMinutes}/{monthlyGoalMinutes}</strong></div>
            <div><span>{lang === "ko" ? "이번 주 XP" : "Week XP"}</span><strong>{formatDisplayXp(hud.week_xp, xpDisplayScale)}</strong></div>
          </div>
          <div className="progress-wrap"><div className="progress-bar"><div style={{ width: `${sessionPct}%` }} /></div><small>{lang === "ko" ? "주간 세션 목표" : "Weekly session goal"} {sessionPct}%</small></div>
          <div className="progress-wrap"><div className="progress-bar"><div style={{ width: `${weekMinPct}%` }} /></div><small>{lang === "ko" ? "주간 시간 목표" : "Weekly minute goal"} {weekMinPct}%</small></div>
          <div className="progress-wrap"><div className="progress-bar"><div style={{ width: `${monthMinPct}%` }} /></div><small>{lang === "ko" ? "월간 시간 목표" : "Monthly minute goal"} {monthMinPct}%</small></div>
        </section>
      ) : null}

      {widgetLayout.achievements.visible ? (
        <section className="card dashboard-achievement-card" style={widgetStyle(widgetLayout.achievements)}>
          <div className="row">
            <h2>{lang === "ko" ? "업적 진행" : "Achievement Snapshot"}</h2>
            <button className="ghost-btn dashboard-link-btn-xs" onClick={() => onNavigate("achievements")}>
              {lang === "ko" ? "업적 탭" : "Achievements"}
            </button>
          </div>
          <div className="achievement-overview">
            <div className="achievement-logo-mark">ACH</div>
            <div className="achievement-overview-progress">
              <small>
                {lang === "ko" ? `완료 ${claimedAchievementCount}/${achievements.length}` : `Completed ${claimedAchievementCount}/${achievements.length}`}
              </small>
              <div className="progress-bar">
                <div style={{ width: `${achievementProgressPct}%` }} />
              </div>
              <small>{achievementProgressPct}%</small>
            </div>
          </div>
          <div className="dashboard-mini-list">
            <strong>{lang === "ko" ? "최근 획득" : "Recent"}</strong>
            {recentAchievements.slice(0, 2).map((i) => (
              <small key={i.achievement_id + i.created_at}>{normalizeGoalText(i.name, lang)}</small>
            ))}
          </div>
          <div className="dashboard-mini-list">
            <strong>{lang === "ko" ? "얼마 안 남은 업적" : "Almost done"}</strong>
            {almostDone.slice(0, 2).map((a) => (
              <small key={a.achievement_id}>{normalizeGoalText(a.name, lang)} ({a.progress}/{a.target})</small>
            ))}
          </div>
        </section>
      ) : null}

      {widgetLayout.photo.visible ? (
        <section
          className="card dashboard-image-card dashboard-photo-only"
          style={widgetStyle(widgetLayout.photo)}
          data-testid="tutorial-dashboard-photo"
          onContextMenu={(e) => { e.preventDefault(); setShowPhotoMenu((v) => !v); }}
        >
          <button className="tiny-info dashboard-photo-gear" onClick={() => setShowPhotoMenu((v) => !v)}>...</button>
          {showPhotoMenu && (
            <div className="dashboard-photo-menu">
              <label>
                {lang === "ko" ? "표시 사진" : "Featured"}
                <select
                  value={featuredPhotoId}
                  onChange={async (e) => {
                    const selected = e.target.value;
                    setFeaturedPhotoId(selected);
                    const updated = await putBasicSettings({
                      profile: {
                        ...settings.profile,
                        dashboard_featured_photo_id: selected,
                      },
                    });
                    onSettingsChange(updated);
                  }}
                >
                  <option value="">{lang === "ko" ? "자동" : "Auto"}</option>
                  {dashboardPhotos.map((img) => (
                    <option key={img.id} value={img.id}>
                      {(img.created_at || "").slice(5, 16)} · {img.title || img.id}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {lang === "ko" ? "대시보드 사진 업로드" : "Upload Dashboard Photo"}
                <input
                  type="file"
                  accept="image/*"
                  disabled={photoUploading}
                  onChange={async (event) => {
                    const selectedFile = event.target.files?.[0] ?? null;
                    event.target.value = "";
                    await uploadDashboardPhoto(selectedFile);
                  }}
                />
              </label>
              <button
                className="ghost-btn"
                disabled={photoUploading}
                onClick={async () => {
                  const clipped = await readClipboardImage();
                  if (!clipped) {
                    notify(lang === "ko" ? "클립보드 이미지가 없습니다." : "No image in clipboard.", "error");
                    return;
                  }
                  await uploadDashboardPhoto(clipped);
                }}
              >
                {lang === "ko" ? "클립보드 이미지 붙여넣기" : "Paste from Clipboard"}
              </button>
              <label>
                {lang === "ko" ? "맞춤 방식" : "Fit"}
                <select value="contain" disabled>
                  <option value="contain">{lang === "ko" ? "전체 표시(크롭 없음)" : "Contain (no crop)"}</option>
                </select>
              </label>
              {portraitPhoto ? (
                <small className="muted">
                  {lang === "ko" ? "세로 사진은 항상 전체 표시됩니다." : "Portrait images are always shown fully."}
                </small>
              ) : null}
              <label>
                {lang === "ko" ? "정렬 위치" : "Anchor"}
                <select
                  value={photoAnchor}
                  onChange={async (e) => {
                    const value = e.target.value as "center" | "top" | "bottom" | "left" | "right";
                    setPhotoAnchor(value);
                    await savePhotoSettings(value);
                  }}
                >
                  <option value="center">{lang === "ko" ? "중앙" : "Center"}</option>
                  <option value="top">{lang === "ko" ? "위" : "Top"}</option>
                  <option value="bottom">{lang === "ko" ? "아래" : "Bottom"}</option>
                  <option value="left">{lang === "ko" ? "왼쪽" : "Left"}</option>
                  <option value="right">{lang === "ko" ? "오른쪽" : "Right"}</option>
                </select>
              </label>
            </div>
          )}
          {featuredImage ? (
            <div
              className="dashboard-photo-stage contain"
              style={
                {
                  ["--dashboard-photo-image" as string]: `url("${featuredImageUrl.replace(/"/g, "%22")}")`,
                  ["--dashboard-photo-pos" as string]: photoAnchor,
                } as CSSProperties
              }
            >
              <img className="dashboard-photo" src={featuredImageUrl} alt={featuredImage.title || "featured"} />
            </div>
          ) : (
            <p className="muted">{lang === "ko" ? "대시보드 사진을 업로드하세요." : "Upload dashboard photos."}</p>
          )}
        </section>
      ) : null}

      {widgetLayout.songShortcut.visible ? (
        <section
          className="card dashboard-extra song-shortcut-card"
          style={widgetStyle(widgetLayout.songShortcut)}
          data-testid="tutorial-dashboard-shortcuts"
          onContextMenu={(e) => {
            e.preventDefault();
            setShowShortcutMenu((v) => !v);
          }}
        >
          <div className="row">
            <h2 className="section-title-subtle">{lang === "ko" ? "곡 바로가기" : "Song Shortcuts"}</h2>
            <button className="tiny-info" onClick={() => setShowShortcutMenu((v) => !v)}>...</button>
          </div>
          {showShortcutMenu ? (
            <div className="dashboard-photo-menu">
              {Array.from({ length: 8 }).map((_, idx) => (
                <label key={`shortcut-${idx}`}>
                  {lang === "ko" ? `슬롯 ${idx + 1}` : `Slot ${idx + 1}`}
                  <div className="row">
                    <select
                      value={shortcutIds[idx] || ""}
                      onChange={async (e) => {
                        const next = [...shortcutIds];
                        next[idx] = e.target.value;
                        await saveSongShortcuts(next);
                      }}
                    >
                      <option value="">{lang === "ko" ? "(비어 있음)" : "(Empty)"}</option>
                      {catalogs.song_library.map((song) => (
                        <option key={song.library_id} value={song.library_id}>{song.title || song.library_id}</option>
                      ))}
                    </select>
                    <button
                      className="ghost-btn danger-border"
                      onClick={async () => {
                        const next = [...shortcutIds];
                        next[idx] = "";
                        await saveSongShortcuts(next);
                      }}
                    >
                      {lang === "ko" ? "비우기" : "Clear"}
                    </button>
                  </div>
                </label>
              ))}
              <button className="ghost-btn" onClick={() => onNavigate("songs")}>
                {lang === "ko" ? "곡 라이브러리 열기" : "Open Song Library"}
              </button>
            </div>
          ) : null}
          <div className="song-cover-grid song-shortcut-grid">
            {shortcutSongs.map((song) => {
              const cover = songCoverUrl(song);
              return (
                <button
                  key={song.library_id}
                  className="song-cover-grid-item song-shortcut-btn"
                  title={song.title || song.library_id}
                  onClick={async () => {
                    if (hud.active_session?.session_id) {
                      const go = window.confirm(lang === "ko" ? "진행 중인 세션이 있습니다. 새로 시작할까요?" : "Active session exists. Start a new one?");
                      if (!go) return;
                    }
                    await startSession({ activity: "Song", sub_activity: "SongPractice", song_library_id: song.library_id });
                    notify(lang === "ko" ? `${song.title || song.library_id} 시작` : `${song.title || song.library_id} started`, "info");
                    onNavigate("practice");
                    await onRefresh();
                  }}
                >
                  {cover ? <img src={cover} alt={song.title || song.library_id} /> : <div className="song-cover-thumb empty" />}
                  <small className="song-shortcut-title">{song.title || song.library_id}</small>
                </button>
              );
            })}
            {shortcutSongs.length === 0 ? (
              <div className="muted">{lang === "ko" ? "우클릭 또는 톱니 버튼으로 곡 바로가기를 설정하세요." : "Use right-click or gear to configure song shortcuts."}</div>
            ) : null}
          </div>
        </section>
      ) : null}
      </DashboardView>

      {showQuickLogModal ? (
        <div className="modal-backdrop" data-testid="dashboard-quick-log-backdrop" onClick={closeQuickLogModal}>
          <div className="modal quick-log-modal" data-testid="dashboard-quick-log-modal" onClick={(event) => event.stopPropagation()}>
            <div className="row">
              <h3>{lang === "ko" ? "빠른 기록" : "Quick Log"}</h3>
              <small className="muted">{lang === "ko" ? "Enter/Space 저장 | Esc 닫기" : "Enter/Space to save | Esc to close"}</small>
            </div>
                        <div className="quick-log-layout">
              <div className="quick-log-time-row">
                <label className="quick-log-time-label">{lang === "ko" ? "시간" : "Time"}</label>
                <div className="timer-mode-list-inline quick-log-duration-row" data-testid="dashboard-quick-log-duration-preset">
                  {([
                    { key: "10", labelKo: "10분", labelEn: "10m" },
                    { key: "30", labelKo: "30분", labelEn: "30m" },
                    { key: "60", labelKo: "1시간", labelEn: "1h" },
                    { key: "custom", labelKo: "직접설정", labelEn: "Custom" },
                  ] as Array<{ key: QuickLogDurationPreset; labelKo: string; labelEn: string }>).map((item) => (
                    <button
                      key={`quick-duration-${item.key}`}
                      type="button"
                      className={`ghost-btn timer-mode-item quick-duration-item ${quickDurationPreset === item.key ? "active-mini" : ""}`}
                      data-testid={`dashboard-quick-log-duration-${item.key}`}
                      onClick={() => setQuickDurationPreset(item.key)}
                    >
                      {lang === "ko" ? item.labelKo : item.labelEn}
                    </button>
                  ))}
                </div>
                {quickDurationPreset === "custom" ? (
                  <label className="quick-log-custom-minutes">
                    {lang === "ko" ? "직접 시간(분)" : "Custom minutes"}
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={quickDurationCustom}
                      data-testid="dashboard-quick-log-duration-custom"
                      onChange={(event) => setQuickDurationCustom(event.target.value)}
                    />
                  </label>
                ) : null}
              </div>
              <div className="song-form-grid quick-log-target-row">
                <label>
                  {lang === "ko" ? "유형" : "Type"}
                  <select
                    value={quickTarget}
                    data-testid="dashboard-quick-log-target"
                    onChange={(event) => setQuickTarget(event.target.value as QuickLogTarget)}
                  >
                    <option value="none">{lang === "ko" ? "선택 없음" : "None"}</option>
                    <option value="song">{lang === "ko" ? "곡" : "Song"}</option>
                    <option value="drill">{lang === "ko" ? "드릴" : "Drill"}</option>
                    <option value="etc">{lang === "ko" ? "기타" : "Etc"}</option>
                  </select>
                </label>
                <label>
                  {lang === "ko" ? "세부 설정" : "Value"}
                  <select
                    value={quickDetailValue}
                    data-testid="dashboard-quick-log-detail"
                    onChange={(event) => setQuickDetailSelection(event.target.value)}
                  >
                    {quickDetailOptions.map((item) => (
                      <option key={`quick-detail-${item.value}-${item.label}`} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            <div className="modal-actions">
              <button
                className="primary-btn"
                data-testid="dashboard-quick-log-save"
                disabled={quickLogBusy}
                onClick={() => void saveQuickLog()}
              >
                {lang === "ko" ? "저장" : "Add"}
              </button>
              <button
                className="ghost-btn"
                data-testid="dashboard-quick-log-cancel"
                disabled={quickLogBusy}
                onClick={closeQuickLogModal}
              >
                {lang === "ko" ? "취소" : "Cancel"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <SessionStopModal
        open={showStopModal}
        lang={lang}
        xpDisplayScale={xpDisplayScale}
        songs={catalogs.song_library}
        drills={rankedDrills}
        activeSession={hud.active_session}
        testIdPrefix="dashboard"
        notify={notify}
        onClose={() => setShowStopModal(false)}
        onSaved={async (result) => {
          setLastCoachMessage(pickSessionCoachLine(lang, result.coach_message));
          onSessionCompleted?.(result, "normal");
          if (result.next_win_hint) setLastNextWinHint(result.next_win_hint);
          await onRefresh();
        }}
        onDiscarded={async () => {
          await onRefresh();
        }}
      />

      {showGoalModal && <div className="modal-backdrop"><div className="modal"><h3>{lang === "ko" ? "목표 설정" : "Goal Settings"}</h3><label>{lang === "ko" ? "주간 세션" : "Weekly Sessions"}<input type="number" value={weeklyGoalSessions} onChange={(e) => setWeeklyGoalSessions(Number(e.target.value || 0))} /></label><label>{lang === "ko" ? "주간 시간(분)" : "Weekly Minutes"}<input type="number" value={weeklyGoalMinutes} onChange={(e) => setWeeklyGoalMinutes(Number(e.target.value || 0))} /></label><label>{lang === "ko" ? "월간 시간(분)" : "Monthly Minutes"}<input type="number" value={monthlyGoalMinutes} onChange={(e) => setMonthlyGoalMinutes(Number(e.target.value || 0))} /></label><div className="modal-actions"><button className="primary-btn" onClick={async () => {
        const updated = await putBasicSettings({ profile: { ...settings.profile, weekly_goal_sessions: Math.max(1, weeklyGoalSessions), weekly_goal_minutes: Math.max(10, weeklyGoalMinutes), monthly_goal_minutes: Math.max(30, monthlyGoalMinutes) } });
        onSettingsChange(updated);
        setShowGoalModal(false);
      }}>{lang === "ko" ? "저장" : "Save"}</button><button className="ghost-btn" onClick={() => setShowGoalModal(false)}>{lang === "ko" ? "취소" : "Cancel"}</button></div></div></div>}
    </div>
  );
}
