import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  activateMockData,
  adminGrantXp,
  adminResetAll,
  adminResetProgress,
  createBackupSnapshot,
  createExport,
  deactivateMockData,
  exportCurrentToMockDataset,
  getBackupList,
  getMockDatasets,
  getMockDataStatus,
  putBasicSettings,
  putCriticalSettings,
  restoreBackup,
} from "../api";
import type { Lang } from "../i18n";
import type {
  BackupInfo,
  DashboardLayoutItem,
  GenreGroup,
  HudSummary,
  MockDataStatus,
  MockDatasetInfo,
  Settings,
} from "../types/models";
import {
  DEFAULT_KEYBOARD_SHORTCUT_SETTINGS,
  DEFAULT_SHORTCUT_BINDINGS,
  SHORTCUT_ACTIONS,
  SHORTCUT_GROUP_LABELS,
  eventToShortcutBinding,
  findShortcutConflict,
  formatShortcutBinding,
  normalizeKeyboardShortcutSettings,
  shortcutMetaById,
  type ShortcutActionId,
  type ShortcutBinding,
  type ShortcutGroupId,
} from "../keyboardShortcuts";
import { AchievementAdminPanel } from "./settings/AchievementAdminPanel";
import { buildGenreGroups, normalizeGenre, normalizeGenreGroups } from "../genreCatalog";
import { formatDisplayXp, getXpDisplayScale } from "../utils/xpDisplay";

type Props = {
  lang: Lang;
  settings: Settings;
  hud: HudSummary;
  unlockables: Array<Record<string, unknown>>;
  onSettingsChange: (settings: Settings) => void;
  setMessage: (message: string) => void;
  onRefresh: () => Promise<void>;
};

type DashboardVersion = "legacy" | "focus";
type DashboardWidgetKey = "hud" | "timer" | "progress" | "nextWin" | "photo" | "songShortcut" | "achievements";
type SectionId =
  | "basic"
  | "appearance"
  | "soundMotion"
  | "keyboard"
  | "goals"
  | "dataBackup"
  | "misc";

type QuestSettingsForm = {
  period_days: { short: number; mid: number; long: number };
  auto_enabled_by_period: { short: boolean; mid: boolean; long: boolean };
  auto_target_minutes_by_period: { short: number; mid: number; long: number };
  auto_priority_by_period: {
    short: "low" | "normal" | "urgent";
    mid: "low" | "normal" | "urgent";
    long: "low" | "normal" | "urgent";
  };
  auto_difficulty_by_period: {
    short: "low" | "mid" | "high";
    mid: "low" | "mid" | "high";
    long: "low" | "mid" | "high";
  };
  ui_style: {
    period_border: { short: string; mid: string; long: string };
    period_fill: { short: string; mid: string; long: string };
    priority_border: { urgent: string; normal: string; low: string };
    difficulty_fill: { low: string; mid: string; high: string };
  };
};

const DASHBOARD_WIDGET_KEYS: DashboardWidgetKey[] = [
  "hud",
  "timer",
  "progress",
  "nextWin",
  "photo",
  "songShortcut",
  "achievements",
];

const SECTION_ORDER: SectionId[] = [
  "basic",
  "appearance",
  "soundMotion",
  "keyboard",
  "goals",
  "dataBackup",
  "misc",
];

const ADMIN_PIN_HASH = "40c0bb054bf07d5c614c8aa3c827ce5da20eaf4c04a338f344b9bf91505c6cce";
const RESET_PROGRESS_CONFIRM_TEXT = "진행도 초기화";
const RESET_ALL_CONFIRM_TEXT = "RESET ALL";

const SHORTCUT_GROUP_ORDER: ShortcutGroupId[] = ["tabs", "video", "metronome", "pin", "pip", "popup"];

const GOAL_PRESETS = [
  {
    id: "light",
    title: { ko: "가볍게", en: "Light" },
    summary: { ko: "주 3회 · 90분", en: "3 sessions · 90 min" },
    profile: {
      weekly_goal_sessions: 3,
      weekly_goal_minutes: 90,
      monthly_goal_minutes: 420,
      xp_goal_weekly: 800,
      xp_goal_monthly: 3200,
    },
  },
  {
    id: "steady",
    title: { ko: "꾸준히", en: "Steady" },
    summary: { ko: "주 5회 · 180분", en: "5 sessions · 180 min" },
    profile: {
      weekly_goal_sessions: 5,
      weekly_goal_minutes: 180,
      monthly_goal_minutes: 720,
      xp_goal_weekly: 1500,
      xp_goal_monthly: 6000,
    },
  },
  {
    id: "intense",
    title: { ko: "집중", en: "Intense" },
    summary: { ko: "주 7회 · 300분", en: "7 sessions · 300 min" },
    profile: {
      weekly_goal_sessions: 7,
      weekly_goal_minutes: 300,
      monthly_goal_minutes: 1200,
      xp_goal_weekly: 2500,
      xp_goal_monthly: 10000,
    },
  },
] as const;

const SOUND_PRESETS = [
  {
    id: "balanced",
    title: { ko: "기본 추천", en: "Balanced" },
    description: { ko: "알림과 이펙트를 적당히 유지합니다.", en: "Keep a balanced mix of alerts and effects." },
    patch: {
      audio: { enabled: true, master_volume: 0.6 },
      ui: {
        animation_intensity: "adaptive" as const,
        practice_video_tab_switch_playback: "continue" as const,
        practice_video_pip_mode: "mini" as const,
        notify_level_up: true,
        notify_achievement_unlock: true,
        notify_quest_complete: true,
        fx_level_up_overlay: true,
        enable_confetti: true,
        fx_session_complete_normal: true,
        fx_session_complete_quick: false,
        fx_claim_quest: true,
        fx_claim_achievement: true,
      },
    },
  },
  {
    id: "focus",
    title: { ko: "집중 모드", en: "Focus" },
    description: { ko: "방해가 적게 조용한 연습 환경으로 맞춥니다.", en: "Quiet mode with fewer interruptions." },
    patch: {
      audio: { enabled: true, master_volume: 0.35 },
      ui: {
        animation_intensity: "low" as const,
        practice_video_tab_switch_playback: "pause" as const,
        practice_video_pip_mode: "none" as const,
        notify_level_up: true,
        notify_achievement_unlock: false,
        notify_quest_complete: false,
        fx_level_up_overlay: false,
        enable_confetti: false,
        fx_session_complete_normal: false,
        fx_session_complete_quick: false,
        fx_claim_quest: false,
        fx_claim_achievement: false,
      },
    },
  },
] as const;

const DASHBOARD_VERSION_OPTIONS = [
  {
    id: "focus" as const,
    title: { ko: "포커스", en: "Focus" },
    description: { ko: "오늘 할 일과 진행 상황을 크게 보여줍니다.", en: "Emphasize today's work and progress." },
  },
  {
    id: "legacy" as const,
    title: { ko: "클래식", en: "Classic" },
    description: { ko: "익숙한 카드형 대시보드 배치를 사용합니다.", en: "Use the familiar card dashboard layout." },
  },
] as const;

const PHOTO_ANCHOR_OPTIONS = [
  { id: "center" as const, label: { ko: "가운데", en: "Center" } },
  { id: "top" as const, label: { ko: "위쪽", en: "Top" } },
  { id: "bottom" as const, label: { ko: "아래쪽", en: "Bottom" } },
  { id: "left" as const, label: { ko: "왼쪽", en: "Left" } },
  { id: "right" as const, label: { ko: "오른쪽", en: "Right" } },
] as const;

const DEFAULT_SONG_GENRES = [
  "Rock",
  "Punk Rock",
  "Alt Rock",
  "Hard Rock",
  "Metal",
  "Funk",
  "Jazz",
  "Fusion",
  "R&B",
  "Soul",
  "Hip-hop",
  "Pop",
  "City Pop",
  "Ballad",
  "Disco",
  "Blues",
  "Latin",
  "World",
];

const DEFAULT_ACHIEVEMENT_STYLE_MAP: Record<string, { border: string; fill: string }> = {
  tier_bronze: { border: "#b88746", fill: "#f8f1e7" },
  tier_silver: { border: "#8ca0ad", fill: "#eff4f7" },
  tier_gold: { border: "#d6aa2d", fill: "#fcf6e7" },
  tier_platinum: { border: "#6e85a8", fill: "#eef2ff" },
  tier_diamond: { border: "#4e7eb6", fill: "#eaf5ff" },
  tier_master: { border: "#6d4aa6", fill: "#f2ecff" },
  single_event: { border: "#4f8b92", fill: "#ebf6f8" },
  single_hidden: { border: "#59606a", fill: "#f0f2f5" },
};

const ACHIEVEMENT_STYLE_EDITOR_KEYS = [
  "tier_bronze",
  "tier_silver",
  "tier_gold",
  "tier_platinum",
  "tier_diamond",
  "tier_master",
  "single_event",
  "single_hidden",
] as const;

const ACHIEVEMENT_STYLE_LABELS: Record<(typeof ACHIEVEMENT_STYLE_EDITOR_KEYS)[number], { ko: string; en: string }> = {
  tier_bronze: { ko: "Bronze", en: "Bronze" },
  tier_silver: { ko: "Silver", en: "Silver" },
  tier_gold: { ko: "Gold", en: "Gold" },
  tier_platinum: { ko: "Platinum", en: "Platinum" },
  tier_diamond: { ko: "Diamond", en: "Diamond" },
  tier_master: { ko: "Master", en: "Master" },
  single_event: { ko: "Single Event", en: "Single Event" },
  single_hidden: { ko: "Single Hidden", en: "Single Hidden" },
};

function compactGenreAliasKey(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[._]/g, "-");
}

function dedupeStringList(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  values.forEach((value) => {
    const token = String(value || "").trim();
    if (!token) return;
    const key = token.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(token);
  });
  return out;
}

const dashboardLayoutLegacyDefault: Record<DashboardWidgetKey, DashboardLayoutItem> = {
  hud: { x: 1, y: 1, w: 1, h: 1, visible: true },
  timer: { x: 2, y: 1, w: 1, h: 1, visible: true },
  progress: { x: 1, y: 2, w: 2, h: 1, visible: true },
  nextWin: { x: 3, y: 3, w: 1, h: 1, visible: true },
  photo: { x: 3, y: 1, w: 1, h: 2, visible: true },
  songShortcut: { x: 1, y: 3, w: 2, h: 1, visible: true },
  achievements: { x: 1, y: 4, w: 2, h: 1, visible: false },
};

const dashboardLayoutFocusDefault: Record<DashboardWidgetKey, DashboardLayoutItem> = {
  hud: { x: 1, y: 1, w: 1, h: 1, visible: true },
  timer: { x: 2, y: 1, w: 1, h: 1, visible: true },
  nextWin: { x: 3, y: 4, w: 1, h: 1, visible: true },
  progress: { x: 1, y: 2, w: 2, h: 1, visible: true },
  photo: { x: 3, y: 1, w: 1, h: 3, visible: true },
  songShortcut: { x: 1, y: 3, w: 2, h: 1, visible: true },
  achievements: { x: 1, y: 4, w: 2, h: 1, visible: true },
};

const THEME_PRESETS: Array<{
  id: string;
  name: string;
  unlockLevel: number;
  subtitle: { ko: string; en: string };
  swatches: [string, string, string];
}> = [
  {
    id: "studio",
    name: "Studio",
    unlockLevel: 1,
    subtitle: { ko: "Default theme", en: "Default theme" },
    swatches: ["#f3f6f7", "#ffffff", "#006769"],
  },
  {
    id: "dark",
    name: "Dark",
    unlockLevel: 2,
    subtitle: { ko: "Low-light focus", en: "Low-light focus" },
    swatches: ["#11161d", "#1a2430", "#4cced0"],
  },
  {
    id: "jazz",
    name: "Jazz Lounge",
    unlockLevel: 9,
    subtitle: { ko: "Vintage tone", en: "Vintage tone" },
    swatches: ["#f4efe6", "#fffaf2", "#8b5a2b"],
  },
  {
    id: "neon",
    name: "Neon",
    unlockLevel: 12,
    subtitle: { ko: "High contrast glow", en: "High contrast glow" },
    swatches: ["#0e0f19", "#171a29", "#31f0c3"],
  },
  {
    id: "sunset",
    name: "Sunset Punch",
    unlockLevel: 16,
    subtitle: { ko: "Warm sunset", en: "Warm sunset" },
    swatches: ["#fff2e7", "#fffaf4", "#f06b3f"],
  },
  {
    id: "forest",
    name: "Forest Groove",
    unlockLevel: 22,
    subtitle: { ko: "Comfort green", en: "Comfort green" },
    swatches: ["#edf5ef", "#f7fcf7", "#2c8d5a"],
  },
  {
    id: "ocean",
    name: "Ocean Drive",
    unlockLevel: 26,
    subtitle: { ko: "Cool cyan", en: "Cool cyan" },
    swatches: ["#0f2130", "#173247", "#33c4d3"],
  },
  {
    id: "midnight",
    name: "Midnight Pulse",
    unlockLevel: 30,
    subtitle: { ko: "Deep blue pulse", en: "Deep blue pulse" },
    swatches: ["#0f1526", "#1a2440", "#6ca9ff"],
  },
  {
    id: "candy",
    name: "Candy Pop",
    unlockLevel: 34,
    subtitle: { ko: "Bright pop pink", en: "Bright pop pink" },
    swatches: ["#fff1f4", "#fff8fb", "#ff5b95"],
  },
  {
    id: "volcanic",
    name: "Volcanic Ember",
    unlockLevel: 40,
    subtitle: { ko: "Dark ember", en: "Dark ember" },
    swatches: ["#1f1514", "#2a1d1a", "#ff7a3c"],
  },
];

function exportShareCard(input: { nickname: string; level: number; rank: string; totalXp: number }) {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 630;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const g = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  g.addColorStop(0, "#0f2f36");
  g.addColorStop(1, "#1e5b5a");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#d9f5f2";
  ctx.font = "700 58px Segoe UI";
  ctx.fillText("BassOS Progress", 70, 130);
  ctx.font = "600 46px Segoe UI";
  ctx.fillText(input.nickname || "Bassist", 70, 230);
  ctx.font = "500 34px Segoe UI";
  ctx.fillText(`LV.${input.level}  ${input.rank}`, 70, 300);
  ctx.fillText(`Total XP: ${input.totalXp}`, 70, 360);
  ctx.fillStyle = "#72f3df";
  ctx.fillRect(70, 410, 380, 16);
  ctx.fillStyle = "#ffffff";
  ctx.font = "500 28px Segoe UI";
  ctx.fillText("Keep your groove alive.", 70, 470);
  const link = document.createElement("a");
  link.href = canvas.toDataURL("image/png");
  link.download = `bassos_card_lv${input.level}.png`;
  link.click();
}

function isUnlocked(unlockables: Array<Record<string, unknown>>, keyword: string): boolean {
  return unlockables.some((item) => String(item.name).includes(keyword) && Boolean(item.unlocked));
}

function normalizeGoalText(text: string): string {
  return text;
}

function defaultDashboardLayout(version: DashboardVersion): Record<DashboardWidgetKey, DashboardLayoutItem> {
  return version === "focus" ? dashboardLayoutFocusDefault : dashboardLayoutLegacyDefault;
}

function normalizeDashboardLayout(raw: unknown, version: DashboardVersion): Record<DashboardWidgetKey, DashboardLayoutItem> {
  const defaults = defaultDashboardLayout(version);
  const source = typeof raw === "object" && raw ? (raw as Record<string, Partial<DashboardLayoutItem>>) : {};
  const out = { ...defaults };
  for (const key of DASHBOARD_WIDGET_KEYS) {
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

function dashboardWidgetLabel(key: DashboardWidgetKey, lang: Lang): string {
  if (lang === "ko") {
    if (key === "hud") return "HUD";
    if (key === "timer") return "타이머";
    if (key === "progress") return "진행률";
    if (key === "nextWin") return "퀘스트 센터";
    if (key === "photo") return "사진";
    if (key === "songShortcut") return "곡 바로가기";
    return "업적";
  }
  if (key === "hud") return "HUD";
  if (key === "timer") return "Timer";
  if (key === "progress") return "Progress";
  if (key === "nextWin") return "Quest Center";
  if (key === "photo") return "Photo";
  if (key === "songShortcut") return "Song Shortcuts";
  return "Achievements";
}

function normalizeHex(raw: string, fallback: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : fallback;
}

function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const idx = Math.min(units.length - 1, Math.floor(Math.log(size) / Math.log(1024)));
  const value = size / 1024 ** idx;
  return `${value.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function makeSectionRefMap(): Record<SectionId, HTMLElement | null> {
  return {
    basic: null,
    appearance: null,
    soundMotion: null,
    keyboard: null,
    goals: null,
    dataBackup: null,
    misc: null,
  };
}

async function sha256Text(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await window.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function SettingsPage({ lang, settings, hud, unlockables, onSettingsChange, setMessage, onRefresh }: Props) {
  const periodKeys: Array<"short" | "mid" | "long"> = ["short", "mid", "long"];
  const canShareCard = isUnlocked(unlockables, "공유 카드 생성");

  const xpDisplayScale = getXpDisplayScale(settings);
  const critical = (settings.critical as Record<string, unknown>) ?? {};
  const levelCurve = (settings.level_curve as Record<string, unknown>) ?? {};
  const profile = settings.profile ?? ({} as Settings["profile"]);
  const ui = settings.ui ?? ({} as Settings["ui"]);
  const audio = settings.audio ?? ({} as Settings["audio"]);
  const backup = settings.backup ?? {};
  const performance = settings.performance ?? {};
  const admin = settings.admin ?? {};

  const dashboardVersion: DashboardVersion =
    settings.ui.dashboard_version === "legacy" || settings.ui.dashboard_version === "focus"
      ? settings.ui.dashboard_version
      : settings.profile.onboarded
        ? "legacy"
        : "focus";

  const [searchQuery, setSearchQuery] = useState("");
  const [tocOpen, setTocOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionId>("basic");
  const normalizedShortcutSettings = useMemo(() => normalizeKeyboardShortcutSettings(ui.keyboard_shortcuts), [ui.keyboard_shortcuts]);
  const [capturingShortcutId, setCapturingShortcutId] = useState<ShortcutActionId | null>(null);
  const [keyboardConflictText, setKeyboardConflictText] = useState("");

  const [nicknameDraft, setNicknameDraft] = useState(String(profile.nickname || ""));
  const [newGenre, setNewGenre] = useState("");
  const [newGenreGroupName, setNewGenreGroupName] = useState("");
  const [newGenreTargetGroup, setNewGenreTargetGroup] = useState("");
  const [adminOverlayOpen, setAdminOverlayOpen] = useState(false);
  const [adminAuthOpen, setAdminAuthOpen] = useState(false);
  const [adminPasswordDraft, setAdminPasswordDraft] = useState("");
  const [adminAuthError, setAdminAuthError] = useState("");
  const [adminAuthBusy, setAdminAuthBusy] = useState(false);
  const [resetOverlayOpen, setResetOverlayOpen] = useState(false);
  const [achievementManagerOpen, setAchievementManagerOpen] = useState(false);

  const [criticalForm, setCriticalForm] = useState({
    backfill_multiplier_default: Number(critical.backfill_multiplier_default ?? 0.5),
    achievement_xp_multiplier: Number(critical.achievement_xp_multiplier ?? 0.15),
    quest_xp_multiplier: Number(critical.quest_xp_multiplier ?? 0.15),
    base: Number(levelCurve.base ?? 220),
    slope: Number(levelCurve.slope ?? 5),
    step_10: Number(levelCurve.step_10 ?? 50),
    step_20: Number(levelCurve.step_20 ?? 110),
    step_30: Number(levelCurve.step_30 ?? 240),
    step_40: Number(levelCurve.step_40 ?? 434),
    max_level: Number(levelCurve.max_level ?? 50),
  });

  const [mockDatasets, setMockDatasets] = useState<MockDatasetInfo[]>([]);
  const [mockStatus, setMockStatus] = useState<MockDataStatus>({ active: false, profile: "real", dataset_id: null });
  const [selectedMockDataset, setSelectedMockDataset] = useState("");
  const [mockBusy, setMockBusy] = useState(false);
  const [mockExportBusy, setMockExportBusy] = useState(false);
  const [mockExportDatasetId, setMockExportDatasetId] = useState(
    `snapshot_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`
  );

  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);

  const [questForm, setQuestForm] = useState<QuestSettingsForm>({
    period_days: { short: 7, mid: 30, long: 90 },
    auto_enabled_by_period: { short: true, mid: true, long: true },
    auto_target_minutes_by_period: { short: 120, mid: 360, long: 900 },
    auto_priority_by_period: { short: "normal", mid: "normal", long: "urgent" },
    auto_difficulty_by_period: { short: "low", mid: "mid", long: "high" },
    ui_style: {
      period_border: { short: "#44728a", mid: "#5e6f8f", long: "#6e5f8d" },
      period_fill: { short: "#e7f5ff", mid: "#eef2ff", long: "#f4efff" },
      priority_border: { urgent: "#d8664a", normal: "#4f8bc4", low: "#6b8892" },
      difficulty_fill: { low: "#eef8f5", mid: "#eef2ff", high: "#fff0f1" },
    },
  });
  const [questDirty, setQuestDirty] = useState(false);
  const [questSaving, setQuestSaving] = useState(false);

  const [dashboardLayoutDraft, setDashboardLayoutDraft] = useState<Record<DashboardWidgetKey, DashboardLayoutItem>>(
    normalizeDashboardLayout(
      dashboardVersion === "focus" ? settings.ui.dashboard_layout_focus : settings.ui.dashboard_layout_legacy,
      dashboardVersion
    )
  );
  const [layoutDirty, setLayoutDirty] = useState(false);
  const [layoutSaving, setLayoutSaving] = useState(false);
  const questHydratedRef = useRef(false);
  const layoutHydratedRef = useRef(false);

  const backupConfig = {
    enabled: backup.enabled !== undefined ? Boolean(backup.enabled) : true,
    max_files: Math.max(1, Number(backup.max_files ?? 3)),
    min_hours_between: Math.max(1, Number(backup.min_hours_between ?? 12)),
  };
  const perfConfig = {
    target_dashboard_ms: Math.max(100, Number(performance.target_dashboard_ms ?? 1000)),
  };
  const adminConfig = {
    gate_enabled: Boolean(admin.gate_enabled ?? true),
    pin_hash: String(admin.pin_hash ?? ADMIN_PIN_HASH),
  };

  const currentGenres = useMemo(() => {
    const source =
      Array.isArray(ui.song_genres) && ui.song_genres.length > 0
        ? ui.song_genres.map((item) => normalizeGenre(String(item || "")))
        : [...DEFAULT_SONG_GENRES];
    return dedupeStringList(source);
  }, [ui.song_genres]);

  const genreAliasMap = useMemo(() => {
    const out: Record<string, string> = {};
    if (ui.song_genre_aliases && typeof ui.song_genre_aliases === "object") {
      Object.entries(ui.song_genre_aliases).forEach(([rawKey, rawValue]) => {
        const key = compactGenreAliasKey(rawKey);
        const value = normalizeGenre(String(rawValue || ""));
        if (!key || !value) return;
        out[key] = value;
      });
    }
    return out;
  }, [ui.song_genre_aliases]);

  const currentGenreGroups = useMemo(() => {
    const fromSettings = Array.isArray(ui.song_genre_groups) ? ui.song_genre_groups : null;
    const normalized = normalizeGenreGroups(fromSettings, currentGenres, { keepEmpty: true });
    return normalized.length ? normalized : buildGenreGroups(currentGenres);
  }, [ui.song_genre_groups, currentGenres]);

  const genreGroupNames = useMemo(() => currentGenreGroups.map((group) => group.name), [currentGenreGroups]);

  const genreToGroupMap = useMemo(() => {
    const map = new Map<string, string>();
    currentGenreGroups.forEach((group) => {
      group.values.forEach((value) => map.set(value.toLowerCase(), group.name));
    });
    return map;
  }, [currentGenreGroups]);

  const achievementStyleMap = useMemo(() => {
    const source = settings.ui?.achievement_card_styles || {};
    const out = { ...DEFAULT_ACHIEVEMENT_STYLE_MAP };
    for (const key of ACHIEVEMENT_STYLE_EDITOR_KEYS) {
      out[key] = {
        border: normalizeHex(String(source[key]?.border || ""), DEFAULT_ACHIEVEMENT_STYLE_MAP[key].border),
        fill: normalizeHex(String(source[key]?.fill || ""), DEFAULT_ACHIEVEMENT_STYLE_MAP[key].fill),
      };
    }
    return out;
  }, [settings.ui?.achievement_card_styles]);
  const dashboardPhotoAnchor =
    (profile.dashboard_photo_anchor as "center" | "top" | "bottom" | "left" | "right" | undefined) ?? "center";

  const query = searchQuery.trim().toLowerCase();
  const sections = useMemo(
    () => [
      {
        id: "basic" as const,
        title: lang === "ko" ? "프로필" : "Profile",
        keywords: ["basic", "nickname", "name", "profile"],
      },
      {
        id: "appearance" as const,
        title: lang === "ko" ? "테마" : "Theme",
        keywords: ["theme", "appearance", "preview"],
      },
      {
        id: "soundMotion" as const,
        title: lang === "ko" ? "사운드/알림/효과" : "Sound / Notifications / Effects",
        keywords: ["audio", "sound", "motion", "animation", "volume", "notification", "effect"],
      },
      {
        id: "keyboard" as const,
        title: lang === "ko" ? "키보드 단축키" : "Keyboard Shortcuts",
        keywords: ["keyboard", "shortcut", "hotkey", "video", "pip", "metronome", "tab"],
      },
      {
        id: "goals" as const,
        title: lang === "ko" ? "목표" : "Goals",
        keywords: ["goal", "xp", "weekly", "monthly", "growth", "preset"],
      },
      {
        id: "dataBackup" as const,
        title: lang === "ko" ? "데이터/백업" : "Data / Backup",
        keywords: ["backup", "restore", "export", "snapshot", "data"],
      },
      {
        id: "misc" as const,
        title: lang === "ko" ? "기타 설정" : "Misc Settings",
        keywords: ["misc", "dashboard", "glass", "photo", "share", "reset", "admin"],
      },
    ],
    [lang]
  );

  const sectionMatch = useMemo(() => {
    const initial = {} as Record<SectionId, boolean>;
    for (const item of sections) {
      if (!query) {
        initial[item.id] = true;
        continue;
      }
      const haystack = `${item.title.toLowerCase()} ${item.keywords.join(" ").toLowerCase()}`;
      initial[item.id] = haystack.includes(query);
    }
    return initial;
  }, [sections, query]);

  const filteredCount = useMemo(() => sections.filter((item) => sectionMatch[item.id]).length, [sections, sectionMatch]);
  const visibleSections = useMemo(() => sections.filter((item) => sectionMatch[item.id]), [sections, sectionMatch]);
  const getErrorMessage = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

  const applyBasicPatch = async (patch: Record<string, unknown>, doneMessage?: string) => {
    try {
      const updated = await putBasicSettings(patch as any);
      onSettingsChange(updated);
      if (doneMessage) setMessage(doneMessage);
    } catch (error) {
      setMessage(getErrorMessage(error, lang === "ko" ? "설정 저장 실패" : "Failed to save settings"));
    }
  };

  const applyCriticalPatch = async (patch: Record<string, unknown>, doneMessage?: string) => {
    try {
      const updated = await putCriticalSettings(patch);
      onSettingsChange(updated);
      if (doneMessage) setMessage(doneMessage);
    } catch (error) {
      setMessage(getErrorMessage(error, lang === "ko" ? "관리자 설정 저장 실패" : "Failed to save admin settings"));
    }
  };

  const openSection = (id: SectionId) => {
    setActiveSection(id);
    setTocOpen(false);
  };

  const applyGoalPreset = async (presetId: (typeof GOAL_PRESETS)[number]["id"]) => {
    const preset = GOAL_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    await applyBasicPatch(
      {
        profile: {
          weekly_goal_sessions: preset.profile.weekly_goal_sessions,
          weekly_goal_minutes: preset.profile.weekly_goal_minutes,
          monthly_goal_minutes: preset.profile.monthly_goal_minutes,
          xp_goal_weekly: preset.profile.xp_goal_weekly,
          xp_goal_monthly: preset.profile.xp_goal_monthly,
        } as Partial<Settings["profile"]>,
      },
      lang === "ko" ? `${preset.title.ko} 목표 프리셋 적용` : `Applied ${preset.title.en} goal preset`
    );
  };

  const applySoundPreset = async (presetId: (typeof SOUND_PRESETS)[number]["id"]) => {
    const preset = SOUND_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    await applyBasicPatch(
      {
        audio: preset.patch.audio,
        ui: preset.patch.ui as Partial<Settings["ui"]>,
      },
      lang === "ko" ? `${preset.title.ko} 적용` : `Applied ${preset.title.en}`
    );
  };

  const keyboardActionGroups = useMemo(
    () =>
      SHORTCUT_GROUP_ORDER.map((groupId) => ({
        id: groupId,
        title: SHORTCUT_GROUP_LABELS[groupId][lang],
        items: SHORTCUT_ACTIONS.filter((item) => item.group === groupId),
      })),
    [lang]
  );

  const saveShortcutBinding = async (actionId: ShortcutActionId, binding: ShortcutBinding | null) => {
    setKeyboardConflictText("");
    setCapturingShortcutId(null);
    const actionLabel = shortcutMetaById(actionId).label[lang];
    await applyBasicPatch(
      {
        ui: {
          keyboard_shortcuts: {
            bindings: {
              [actionId]: binding,
            },
          },
        },
      },
      lang === "ko" ? `${actionLabel} 단축키 저장 완료` : `${actionLabel} shortcut saved`
    );
  };

  const resetAllShortcutBindings = async () => {
    setKeyboardConflictText("");
    setCapturingShortcutId(null);
    await applyBasicPatch(
      {
        ui: {
          keyboard_shortcuts: DEFAULT_KEYBOARD_SHORTCUT_SETTINGS,
        },
      },
      lang === "ko" ? "키보드 단축키 기본값 복원 완료" : "Keyboard shortcuts reset to defaults"
    );
  };

  useEffect(() => {
    if (!capturingShortcutId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();

      const isBareEscape = event.key === "Escape" && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey;
      if (isBareEscape) {
        setCapturingShortcutId(null);
        setKeyboardConflictText("");
        return;
      }
      const isClearKey =
        (event.key === "Delete" || event.key === "Backspace") &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        !event.metaKey;
      if (isClearKey) {
        void saveShortcutBinding(capturingShortcutId, null);
        return;
      }
      const binding = eventToShortcutBinding(event);
      if (!binding) return;
      const conflictId = findShortcutConflict(normalizedShortcutSettings.bindings, binding, capturingShortcutId);
      if (conflictId) {
        const conflictLabel = shortcutMetaById(conflictId).label[lang];
        setKeyboardConflictText(
          lang === "ko"
            ? `${formatShortcutBinding(binding, lang)} 는 이미 "${conflictLabel}"에 사용 중입니다.`
            : `${formatShortcutBinding(binding, lang)} is already used by "${conflictLabel}".`
        );
        return;
      }
      void saveShortcutBinding(capturingShortcutId, binding);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [capturingShortcutId, lang, normalizedShortcutSettings.bindings]);

  const persistGenreConfig = async (
    nextGenres: string[],
    nextGroups: GenreGroup[],
    nextAliases: Record<string, string>,
    doneMessage?: string
  ) => {
    const genres = dedupeStringList(nextGenres.map((item) => normalizeGenre(item)));
    const groups = normalizeGenreGroups(nextGroups, genres, { keepEmpty: true }).map((group) => ({
      name: String(group.name || "").trim(),
      values: dedupeStringList(group.values.map((value) => normalizeGenre(value))),
    }));
    const aliases: Record<string, string> = {};
    Object.entries(nextAliases).forEach(([rawKey, rawValue]) => {
      const key = compactGenreAliasKey(rawKey);
      const value = normalizeGenre(String(rawValue || ""));
      if (!key || !value) return;
      aliases[key] = value;
    });
    await applyBasicPatch(
      {
        ui: {
          song_genres: genres,
          song_genre_groups: groups,
          song_genre_aliases: aliases,
        } as Partial<Settings["ui"]>,
      },
      doneMessage
    );
  };

  const addGenreToGroup = async () => {
    const token = normalizeGenre(newGenre.trim());
    if (!token) return;
    if (currentGenres.some((item) => item.toLowerCase() === token.toLowerCase())) {
      setMessage(lang === "ko" ? "이미 존재하는 장르입니다." : "Genre already exists.");
      return;
    }
    const fallbackGroup = newGenreTargetGroup || currentGenreGroups[0]?.name || "";
    const groups = currentGenreGroups.map((group) =>
      group.name === fallbackGroup ? { ...group, values: [...group.values, token] } : group
    );
    await persistGenreConfig([...currentGenres, token], groups, genreAliasMap, lang === "ko" ? "장르 추가 완료" : "Genre added");
    setNewGenre("");
  };

  const moveGenreToGroup = async (genre: string, targetGroupName: string) => {
    if (!targetGroupName) return;
    const currentGroup = genreToGroupMap.get(genre.toLowerCase());
    if (currentGroup === targetGroupName) return;
    const groups = currentGenreGroups.map((group) => {
      const filtered = group.values.filter((value) => value.toLowerCase() !== genre.toLowerCase());
      if (group.name === targetGroupName) return { ...group, values: [...filtered, genre] };
      return { ...group, values: filtered };
    });
    await persistGenreConfig(currentGenres, groups, genreAliasMap);
  };

  const renameGenreEverywhere = async (genre: string) => {
    const renamedRaw = window.prompt(lang === "ko" ? "새 장르 이름을 입력하세요." : "Enter new genre name.", genre);
    const renamed = normalizeGenre(String(renamedRaw || "").trim());
    if (!renamed) return;
    if (renamed.toLowerCase() === genre.toLowerCase()) return;
    if (currentGenres.some((item) => item.toLowerCase() === renamed.toLowerCase())) {
      setMessage(lang === "ko" ? "같은 이름의 장르가 이미 있습니다." : "A genre with that name already exists.");
      return;
    }
    const nextGenres = currentGenres.map((item) => (item.toLowerCase() === genre.toLowerCase() ? renamed : item));
    const nextGroups = currentGenreGroups.map((group) => ({
      ...group,
      values: group.values.map((value) => (value.toLowerCase() === genre.toLowerCase() ? renamed : value)),
    }));
    const nextAliases = { ...genreAliasMap, [compactGenreAliasKey(genre)]: renamed };
    Object.keys(nextAliases).forEach((key) => {
      if (String(nextAliases[key] || "").toLowerCase() === genre.toLowerCase()) {
        nextAliases[key] = renamed;
      }
    });
    await persistGenreConfig(
      nextGenres,
      nextGroups,
      nextAliases,
      lang === "ko" ? "장르 이름 변경 완료 (기존 곡 할당 유지)" : "Genre renamed (existing song assignments preserved)"
    );
  };

  const removeGenreFromPool = async (genre: string) => {
    const ok = window.confirm(
      lang === "ko"
        ? `장르 '${genre}'를 목록에서 제거할까요? 곡 데이터는 삭제되지 않습니다.`
        : `Remove '${genre}' from the genre pool? Song records are not deleted.`
    );
    if (!ok) return;
    const nextGenres = currentGenres.filter((item) => item.toLowerCase() !== genre.toLowerCase());
    const nextGroups = currentGenreGroups.map((group) => ({
      ...group,
      values: group.values.filter((value) => value.toLowerCase() !== genre.toLowerCase()),
    }));
    const nextAliases = { ...genreAliasMap };
    delete nextAliases[compactGenreAliasKey(genre)];
    await persistGenreConfig(nextGenres, nextGroups, nextAliases, lang === "ko" ? "장르 제거 완료" : "Genre removed");
  };

  const addGenreGroup = async () => {
    const token = newGenreGroupName.trim();
    if (!token) return;
    if (genreGroupNames.some((name) => name.toLowerCase() === token.toLowerCase())) {
      setMessage(lang === "ko" ? "같은 이름의 그룹이 이미 있습니다." : "Group already exists.");
      return;
    }
    await persistGenreConfig(currentGenres, [...currentGenreGroups, { name: token, values: [] }], genreAliasMap);
    setNewGenreGroupName("");
  };

  const renameGenreGroup = async (groupName: string) => {
    const nextNameRaw = window.prompt(lang === "ko" ? "새 그룹 이름" : "New group name", groupName);
    const nextName = String(nextNameRaw || "").trim();
    if (!nextName) return;
    if (nextName.toLowerCase() === groupName.toLowerCase()) return;
    if (genreGroupNames.some((name) => name.toLowerCase() === nextName.toLowerCase())) {
      setMessage(lang === "ko" ? "같은 이름의 그룹이 이미 있습니다." : "A group with that name already exists.");
      return;
    }
    const nextGroups = currentGenreGroups.map((group) => (group.name === groupName ? { ...group, name: nextName } : group));
    await persistGenreConfig(currentGenres, nextGroups, genreAliasMap);
  };

  const deleteGenreGroup = async (groupName: string) => {
    const target = currentGenreGroups.find((group) => group.name === groupName);
    if (!target) return;
    if (currentGenreGroups.length <= 1) {
      setMessage(lang === "ko" ? "최소 1개의 그룹은 남아 있어야 합니다." : "At least one group must remain.");
      return;
    }
    const other = currentGenreGroups.find((group) => group.name !== groupName);
    if (!other) return;
    const nextGroups = currentGenreGroups
      .filter((group) => group.name !== groupName)
      .map((group) => {
        if (group.name !== other.name) return group;
        return { ...group, values: [...group.values, ...target.values] };
      });
    await persistGenreConfig(currentGenres, nextGroups, genreAliasMap);
  };

  const resetGenreCatalog = async () => {
    const defaults = dedupeStringList(DEFAULT_SONG_GENRES.map((item) => normalizeGenre(item)));
    const defaultGroups = buildGenreGroups(defaults);
    await persistGenreConfig(
      defaults,
      defaultGroups,
      {},
      lang === "ko" ? "장르/그룹 기본값 복원 완료" : "Genre catalog reset to default"
    );
  };

  const updateAchievementCardStyle = (key: (typeof ACHIEVEMENT_STYLE_EDITOR_KEYS)[number], field: "border" | "fill", value: string) => {
    const safe = normalizeHex(value, DEFAULT_ACHIEVEMENT_STYLE_MAP[key][field]);
    const next = {
      ...(settings.ui?.achievement_card_styles || {}),
      [key]: {
        ...(settings.ui?.achievement_card_styles?.[key] || {}),
        [field]: safe,
      },
    };
    void applyBasicPatch({
      ui: {
        achievement_card_styles: next,
      } as Partial<Settings["ui"]>,
    });
  };

  const resetAchievementCardStyles = () => {
    void applyBasicPatch(
      {
        ui: {
          achievement_card_styles: DEFAULT_ACHIEVEMENT_STYLE_MAP,
        } as Partial<Settings["ui"]>,
      },
      lang === "ko" ? "업적 카드 색상 기본값 복원 완료" : "Achievement card styles restored"
    );
  };

  const questPriorityLabel = (key: "low" | "normal" | "urgent") => {
    if (lang !== "ko") return key === "urgent" ? "Top" : key === "normal" ? "Normal" : "Relax";
    return key === "urgent" ? "우선" : key === "normal" ? "보통" : "느긋";
  };
  const questDifficultyLabel = (key: "low" | "mid" | "high") => {
    if (lang !== "ko") return key === "high" ? "High" : key === "mid" ? "Mid" : "Low";
    return key === "high" ? "상" : key === "mid" ? "중" : "하";
  };

  const renderColorInput = (label: string, value: string, onChange: (value: string) => void) => (
    <label className="settings-color-field">
      <span>{label}</span>
      <div className="settings-color-control">
        <input type="color" value={value} onChange={(event) => onChange(event.target.value)} />
        <span className="settings-color-preview" style={{ backgroundColor: value }} aria-hidden />
        <code className="settings-color-value">{value.toUpperCase()}</code>
      </div>
    </label>
  );

  const sanitizeQuestForm = (input: QuestSettingsForm): QuestSettingsForm => {
    return {
      period_days: {
        short: Math.max(1, Math.round(Number(input.period_days.short || 1))),
        mid: Math.max(1, Math.round(Number(input.period_days.mid || 1))),
        long: Math.max(1, Math.round(Number(input.period_days.long || 1))),
      },
      auto_enabled_by_period: {
        short: Boolean(input.auto_enabled_by_period.short),
        mid: Boolean(input.auto_enabled_by_period.mid),
        long: Boolean(input.auto_enabled_by_period.long),
      },
      auto_target_minutes_by_period: {
        short: Math.max(1, Math.round(Number(input.auto_target_minutes_by_period.short || 1))),
        mid: Math.max(1, Math.round(Number(input.auto_target_minutes_by_period.mid || 1))),
        long: Math.max(1, Math.round(Number(input.auto_target_minutes_by_period.long || 1))),
      },
      auto_priority_by_period: {
        short: input.auto_priority_by_period.short,
        mid: input.auto_priority_by_period.mid,
        long: input.auto_priority_by_period.long,
      },
      auto_difficulty_by_period: {
        short: input.auto_difficulty_by_period.short,
        mid: input.auto_difficulty_by_period.mid,
        long: input.auto_difficulty_by_period.long,
      },
      ui_style: {
        period_border: {
          short: normalizeHex(input.ui_style.period_border.short, "#44728a"),
          mid: normalizeHex(input.ui_style.period_border.mid, "#5e6f8f"),
          long: normalizeHex(input.ui_style.period_border.long, "#6e5f8d"),
        },
        period_fill: {
          short: normalizeHex(input.ui_style.period_fill.short, "#e7f5ff"),
          mid: normalizeHex(input.ui_style.period_fill.mid, "#eef2ff"),
          long: normalizeHex(input.ui_style.period_fill.long, "#f4efff"),
        },
        priority_border: {
          urgent: normalizeHex(input.ui_style.priority_border.urgent, "#d8664a"),
          normal: normalizeHex(input.ui_style.priority_border.normal, "#4f8bc4"),
          low: normalizeHex(input.ui_style.priority_border.low, "#6b8892"),
        },
        difficulty_fill: {
          low: normalizeHex(input.ui_style.difficulty_fill.low, "#eef8f5"),
          mid: normalizeHex(input.ui_style.difficulty_fill.mid, "#eef2ff"),
          high: normalizeHex(input.ui_style.difficulty_fill.high, "#fff0f1"),
        },
      },
    };
  };

  const saveQuestSettings = async (silent = false) => {
    const sanitized = sanitizeQuestForm(questForm);
    setQuestSaving(true);
    try {
      const updated = await putBasicSettings({
        profile: {
          quest_settings: sanitized,
        } as Partial<Settings["profile"]>,
      } as any);
      onSettingsChange(updated);
      setQuestDirty(false);
      if (!silent) {
        setMessage(lang === "ko" ? "퀘스트 설정 저장 완료" : "Quest settings saved");
      }
    } catch (error) {
      setMessage(getErrorMessage(error, lang === "ko" ? "퀘스트 설정 저장 실패" : "Failed to save quest settings"));
    } finally {
      setQuestSaving(false);
    }
  };

  const updateQuestForm = (updater: (prev: QuestSettingsForm) => QuestSettingsForm) => {
    setQuestDirty(true);
    setQuestForm((prev) => updater(prev));
  };

  const saveDashboardLayout = async (silent = false) => {
    const normalized = normalizeDashboardLayout(dashboardLayoutDraft, dashboardVersion);
    setLayoutSaving(true);
    try {
      const updated = await putBasicSettings({
        ui:
          dashboardVersion === "legacy"
            ? ({ dashboard_layout_legacy: normalized } as Partial<Settings["ui"]>)
            : ({ dashboard_layout_focus: normalized } as Partial<Settings["ui"]>),
      } as any);
      onSettingsChange(updated);
      setLayoutDirty(false);
      if (!silent) {
        setMessage(lang === "ko" ? "대시보드 레이아웃 저장 완료" : "Dashboard layout saved");
      }
    } catch (error) {
      setMessage(getErrorMessage(error, lang === "ko" ? "레이아웃 저장 실패" : "Failed to save layout"));
    } finally {
      setLayoutSaving(false);
    }
  };

  const updateDashboardLayoutDraft = (key: DashboardWidgetKey, patch: Partial<DashboardLayoutItem>) => {
    setLayoutDirty(true);
    setDashboardLayoutDraft((prev) => {
      const next = {
        ...prev,
        [key]: {
          ...prev[key],
          ...patch,
        },
      };
      next.hud = { ...next.hud, visible: true };
      next.timer = { ...next.timer, visible: true };
      if (dashboardVersion === "focus") {
        next.nextWin = { ...next.nextWin, h: 1 };
      }
      return next;
    });
  };

  const resetDashboardLayoutDraft = () => {
    setLayoutDirty(true);
    setDashboardLayoutDraft(normalizeDashboardLayout({}, dashboardVersion));
  };

  const loadMockDatasets = async () => {
    try {
      const [datasets, status] = await Promise.all([getMockDatasets(), getMockDataStatus()]);
      setMockDatasets(datasets);
      setMockStatus(status);
      if (!selectedMockDataset) {
        const fallback = status.dataset_id || datasets[0]?.id || "";
        setSelectedMockDataset(fallback);
      }
    } catch {
      setMockDatasets([]);
    }
  };

  const loadBackups = async () => {
    try {
      setBackupLoading(true);
      const list = await getBackupList();
      setBackups(list);
    } catch (error) {
      setMessage(getErrorMessage(error, lang === "ko" ? "백업 목록 조회 실패" : "Failed to load backups"));
    } finally {
      setBackupLoading(false);
    }
  };

  const restoreBackupWithConfirm = async (name: string) => {
    const firstConfirm = window.confirm(
      lang === "ko"
        ? "백업을 복원하면 현재 데이터가 덮어써집니다. 계속할까요?"
        : "Restoring backup will overwrite current runtime data. Continue?"
    );
    if (!firstConfirm) return;
    const token = window.prompt(lang === "ko" ? "복원을 계속하려면 RESTORE를 입력하세요." : "Type RESTORE to continue.");
    if ((token || "").trim().toUpperCase() !== "RESTORE") {
      setMessage(lang === "ko" ? "복원이 취소되었습니다." : "Restore cancelled.");
      return;
    }
    try {
      setBackupBusy(true);
      await restoreBackup(name);
      await Promise.all([onRefresh(), loadBackups()]);
      setMessage(lang === "ko" ? "백업 복원 완료" : "Backup restored");
    } catch (error) {
      setMessage(getErrorMessage(error, lang === "ko" ? "백업 복원 실패" : "Backup restore failed"));
    } finally {
      setBackupBusy(false);
    }
  };

  const openAdminAuth = () => {
    setAdminPasswordDraft("");
    setAdminAuthError("");
    setAdminAuthOpen(true);
  };

  const submitAdminAuth = async () => {
    try {
      setAdminAuthBusy(true);
      const hash = await sha256Text(adminPasswordDraft);
      if (hash !== adminConfig.pin_hash) {
        setAdminAuthError(lang === "ko" ? "비밀번호가 올바르지 않습니다." : "Incorrect password.");
        return;
      }
      setAdminAuthBusy(false);
      setAdminAuthOpen(false);
      setAdminPasswordDraft("");
      setAdminAuthError("");
      setAdminOverlayOpen(true);
    } finally {
      setAdminAuthBusy(false);
    }
  };

  const resetProgressWithConfirm = async () => {
    const first = window.confirm(
      lang === "ko"
        ? "진행도만 초기화합니다. 세션 기록, 라이브러리, 미디어 파일은 유지됩니다. 계속할까요?"
        : "This resets progress only. Sessions, library data, and media files stay intact. Continue?"
    );
    if (!first) return;
    const second = window.confirm(
      lang === "ko" ? "레벨, XP, 퀘스트, 업적 진행도를 초기화합니다." : "Level, XP, quest, and achievement progress will be reset."
    );
    if (!second) return;
    const token = window.prompt(
      lang === "ko"
        ? `계속하려면 "${RESET_PROGRESS_CONFIRM_TEXT}"를 입력하세요.`
        : `Type "${RESET_PROGRESS_CONFIRM_TEXT}" to continue.`
    );
    if ((token || "").trim() !== RESET_PROGRESS_CONFIRM_TEXT) {
      setMessage(lang === "ko" ? "진행도 초기화를 취소했습니다." : "Progress reset cancelled.");
      return;
    }
    try {
      await adminResetProgress();
      setMessage(lang === "ko" ? "진행도 초기화 완료" : "Progress reset complete");
      await onRefresh();
      setResetOverlayOpen(false);
    } catch (error) {
      setMessage(getErrorMessage(error, lang === "ko" ? "진행도 초기화 실패" : "Failed to reset progress"));
    }
  };

  const resetAllWithConfirm = async () => {
    const first = window.confirm(
      lang === "ko"
        ? "전체 초기화는 세션, 설정, 미디어, 진행도를 모두 되돌립니다. 계속할까요?"
        : "Full reset removes sessions, settings, media, and progress. Continue?"
    );
    if (!first) return;
    const second = window.confirm(
      lang === "ko"
        ? "한 번 더 확인합니다. 전체 초기화 후에는 현재 런타임 데이터를 되돌리기 어렵습니다."
        : "Confirm again. Current runtime data will be difficult to recover after full reset."
    );
    if (!second) return;
    const token = window.prompt(
      lang === "ko"
        ? `계속하려면 "${RESET_ALL_CONFIRM_TEXT}"를 입력하세요.`
        : `Type "${RESET_ALL_CONFIRM_TEXT}" to continue.`
    );
    if ((token || "").trim().toUpperCase() !== RESET_ALL_CONFIRM_TEXT) {
      setMessage(lang === "ko" ? "전체 초기화를 취소했습니다." : "Full reset cancelled.");
      return;
    }
    try {
      await adminResetAll();
      setMessage(lang === "ko" ? "전체 초기화 완료" : "Full reset complete");
      await onRefresh();
      setResetOverlayOpen(false);
    } catch (error) {
      setMessage(getErrorMessage(error, lang === "ko" ? "전체 초기화 실패" : "Full reset failed"));
    }
  };

  const sectionsTitleMap = useMemo(() => {
    const map = {} as Record<SectionId, string>;
    for (const item of sections) map[item.id] = item.title;
    return map;
  }, [sections]);

  const renderSection = (
    id: SectionId,
    subtitle: string,
    children: ReactNode,
    options?: { lowEmphasis?: boolean; extraClass?: string }
  ) => {
    if (activeSection !== id) return null;
    const filtered = Boolean(query) && !sectionMatch[id];
    if (filtered) return null;
    return (
      <section
        className={`card settings-section settings-section-active ${options?.lowEmphasis ? "settings-section-low" : ""} ${options?.extraClass ?? ""}`.trim()}
        data-testid={`settings-section-${id}`}
      >
        <div className="settings-section-head">
          <div>
            <h2>{sectionsTitleMap[id]}</h2>
            <small className="muted">{subtitle}</small>
          </div>
          <span className="settings-section-tag">{lang === "ko" ? "현재 탭" : "Current tab"}</span>
        </div>
        <div className="settings-section-body">{children}</div>
      </section>
    );
  };

  useEffect(() => {
    setNicknameDraft(String(profile.nickname || ""));
  }, [profile.nickname]);

  useEffect(() => {
    if (!currentGenreGroups.length) return;
    if (newGenreTargetGroup && currentGenreGroups.some((group) => group.name === newGenreTargetGroup)) return;
    setNewGenreTargetGroup(currentGenreGroups[0].name);
  }, [currentGenreGroups, newGenreTargetGroup]);

  useEffect(() => {
    setCriticalForm({
      backfill_multiplier_default: Number(critical.backfill_multiplier_default ?? 0.5),
      achievement_xp_multiplier: Number(critical.achievement_xp_multiplier ?? 0.15),
      quest_xp_multiplier: Number(critical.quest_xp_multiplier ?? 0.15),
      base: Number(levelCurve.base ?? 220),
      slope: Number(levelCurve.slope ?? 5),
      step_10: Number(levelCurve.step_10 ?? 50),
      step_20: Number(levelCurve.step_20 ?? 110),
      step_30: Number(levelCurve.step_30 ?? 240),
      step_40: Number(levelCurve.step_40 ?? 434),
      max_level: Number(levelCurve.max_level ?? 50),
    });
  }, [
    critical.backfill_multiplier_default,
    critical.achievement_xp_multiplier,
    critical.quest_xp_multiplier,
    levelCurve.base,
    levelCurve.slope,
    levelCurve.step_10,
    levelCurve.step_20,
    levelCurve.step_30,
    levelCurve.step_40,
    levelCurve.max_level,
  ]);

  useEffect(() => {
    const raw = settings.profile.quest_settings || {};
    const normalizePriority = (value: unknown, fallback: "low" | "normal" | "urgent") => {
      const token = String(value || "").toLowerCase();
      return token === "low" || token === "normal" || token === "urgent" ? token : fallback;
    };
    const normalizeDifficulty = (value: unknown, fallback: "low" | "mid" | "high") => {
      const token = String(value || "").toLowerCase();
      return token === "low" || token === "mid" || token === "high" ? token : fallback;
    };
    setQuestForm({
      period_days: {
        short: Number(raw.period_days?.short ?? 7),
        mid: Number(raw.period_days?.mid ?? 30),
        long: Number(raw.period_days?.long ?? 90),
      },
      auto_enabled_by_period: {
        short: Boolean(raw.auto_enabled_by_period?.short ?? true),
        mid: Boolean(raw.auto_enabled_by_period?.mid ?? true),
        long: Boolean(raw.auto_enabled_by_period?.long ?? true),
      },
      auto_target_minutes_by_period: {
        short: Number(raw.auto_target_minutes_by_period?.short ?? 120),
        mid: Number(raw.auto_target_minutes_by_period?.mid ?? 360),
        long: Number(raw.auto_target_minutes_by_period?.long ?? 900),
      },
      auto_priority_by_period: {
        short: normalizePriority(raw.auto_priority_by_period?.short, "normal"),
        mid: normalizePriority(raw.auto_priority_by_period?.mid, "normal"),
        long: normalizePriority(raw.auto_priority_by_period?.long, "urgent"),
      },
      auto_difficulty_by_period: {
        short: normalizeDifficulty(raw.auto_difficulty_by_period?.short, "low"),
        mid: normalizeDifficulty(raw.auto_difficulty_by_period?.mid, "mid"),
        long: normalizeDifficulty(raw.auto_difficulty_by_period?.long, "high"),
      },
      ui_style: {
        period_border: {
          short: normalizeHex(String(raw.ui_style?.period_border?.short || ""), "#44728a"),
          mid: normalizeHex(String(raw.ui_style?.period_border?.mid || ""), "#5e6f8f"),
          long: normalizeHex(String(raw.ui_style?.period_border?.long || ""), "#6e5f8d"),
        },
        period_fill: {
          short: normalizeHex(String(raw.ui_style?.period_fill?.short || ""), "#e7f5ff"),
          mid: normalizeHex(String(raw.ui_style?.period_fill?.mid || ""), "#eef2ff"),
          long: normalizeHex(String(raw.ui_style?.period_fill?.long || ""), "#f4efff"),
        },
        priority_border: {
          urgent: normalizeHex(String(raw.ui_style?.priority_border?.urgent || ""), "#d8664a"),
          normal: normalizeHex(String(raw.ui_style?.priority_border?.normal || ""), "#4f8bc4"),
          low: normalizeHex(String(raw.ui_style?.priority_border?.low || ""), "#6b8892"),
        },
        difficulty_fill: {
          low: normalizeHex(String(raw.ui_style?.difficulty_fill?.low || ""), "#eef8f5"),
          mid: normalizeHex(String(raw.ui_style?.difficulty_fill?.mid || ""), "#eef2ff"),
          high: normalizeHex(String(raw.ui_style?.difficulty_fill?.high || ""), "#fff0f1"),
        },
      },
    });
    setQuestDirty(false);
    questHydratedRef.current = true;
  }, [settings.profile.quest_settings]);

  useEffect(() => {
    if (!questHydratedRef.current || !questDirty) return undefined;
    const timer = window.setTimeout(() => {
      void saveQuestSettings(true);
    }, 480);
    return () => window.clearTimeout(timer);
  }, [questDirty, questForm]);

  useEffect(() => {
    const activeLayout =
      dashboardVersion === "focus" ? settings.ui.dashboard_layout_focus : settings.ui.dashboard_layout_legacy;
    setDashboardLayoutDraft(normalizeDashboardLayout(activeLayout, dashboardVersion));
    setLayoutDirty(false);
    layoutHydratedRef.current = true;
  }, [dashboardVersion, settings.ui.dashboard_layout_focus, settings.ui.dashboard_layout_legacy]);

  useEffect(() => {
    if (!layoutHydratedRef.current || !layoutDirty) return undefined;
    const timer = window.setTimeout(() => {
      void saveDashboardLayout(true);
    }, 480);
    return () => window.clearTimeout(timer);
  }, [layoutDirty, dashboardLayoutDraft, dashboardVersion]);

  useEffect(() => {
    void loadBackups();
  }, []);

  useEffect(() => {
    if (!adminOverlayOpen) return;
    void loadMockDatasets();
  }, [adminOverlayOpen]);

  useEffect(() => {
    if (!query) return;
    if (sectionMatch[activeSection]) return;
    const fallback = visibleSections[0]?.id ?? SECTION_ORDER[0];
    if (fallback !== activeSection) {
      setActiveSection(fallback);
    }
  }, [activeSection, query, sectionMatch, visibleSections]);

  useEffect(() => {
    if (!adminOverlayOpen && !adminAuthOpen && !resetOverlayOpen && !achievementManagerOpen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (achievementManagerOpen) {
        setAchievementManagerOpen(false);
        return;
      }
      if (adminOverlayOpen) {
        setAdminOverlayOpen(false);
        return;
      }
      if (adminAuthOpen) {
        setAdminAuthOpen(false);
        setAdminAuthError("");
        return;
      }
      if (resetOverlayOpen) {
        setResetOverlayOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [achievementManagerOpen, adminAuthOpen, adminOverlayOpen, resetOverlayOpen]);

  const xpToMax = useMemo(() => {
    const maxLevel = Math.max(2, Math.round(criticalForm.max_level));
    const base = criticalForm.base;
    const slope = criticalForm.slope;
    const step10 = criticalForm.step_10;
    const step20 = criticalForm.step_20;
    const step30 = criticalForm.step_30;
    const step40 = criticalForm.step_40;
    let total = 0;
    for (let level = 1; level < maxLevel; level += 1) {
      const linear = base + slope * (level - 1);
      const step = level >= 40 ? step40 : level >= 30 ? step30 : level >= 20 ? step20 : level >= 10 ? step10 : 0;
      total += Math.max(1, Math.round(linear + step));
    }
    return total;
  }, [
    criticalForm.base,
    criticalForm.slope,
    criticalForm.step_10,
    criticalForm.step_20,
    criticalForm.step_30,
    criticalForm.step_40,
    criticalForm.max_level,
  ]);

  const baseline30m = 90;

  const grantToNext = Math.max(0, hud.xp_to_next - hud.current_level_xp);

  const saveCriticalBalance = async () => {
    const updated = {
      xp: {
        session: {
          per_min: 3,
        },
        display_scale: xpDisplayScale,
      },
      critical: {
        backfill_multiplier_default: criticalForm.backfill_multiplier_default,
        achievement_xp_multiplier: criticalForm.achievement_xp_multiplier,
        quest_xp_multiplier: criticalForm.quest_xp_multiplier,
      },
      level_curve: {
        type: "decade_linear",
        base: criticalForm.base,
        slope: criticalForm.slope,
        step_10: criticalForm.step_10,
        step_20: criticalForm.step_20,
        step_30: criticalForm.step_30,
        step_40: criticalForm.step_40,
        max_level: criticalForm.max_level,
      },
    };
    await applyCriticalPatch(updated, lang === "ko" ? "Critical 설정 저장 완료" : "Critical settings saved");
    await onRefresh();
  };

  return (
    <div className="settings-shell">
      <aside className={`settings-toc ${tocOpen ? "open" : ""}`}>
        <div className="settings-toc-head">
          <strong>{lang === "ko" ? "설정 탭" : "Settings Tabs"}</strong>
          <small className="muted">
            {lang === "ko" ? `${filteredCount}/${sections.length}개 표시` : `${filteredCount}/${sections.length} visible`}
          </small>
        </div>
        <label className="settings-toc-search">
          <span>{lang === "ko" ? "찾기" : "Search"}</span>
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={lang === "ko" ? "예: 테마, 백업, 목표" : "e.g. theme, backup, goals"}
            data-testid="settings-search-input"
          />
        </label>
        <div className="settings-toc-list">
          {sections.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`settings-toc-item ${activeSection === item.id ? "active" : ""} ${sectionMatch[item.id] ? "" : "dim"}`}
              onClick={() => openSection(item.id)}
              data-testid={`settings-toc-${item.id}`}
            >
              {item.title}
            </button>
          ))}
        </div>
      </aside>

      <div className="settings-main">
        <section className="card settings-search-card">
          <div className="row">
            <div>
              <h2>{lang === "ko" ? "설정" : "Settings"}</h2>
              <small className="muted">
                {lang === "ko" ? "왼쪽 탭에서 항목을 고르면 바로 해당 설정이 열립니다." : "Choose a tab on the left to open that settings group."}
              </small>
            </div>
            <button type="button" className="ghost-btn compact-add-btn settings-mobile-toc-btn" onClick={() => setTocOpen((prev) => !prev)}>
              {tocOpen ? (lang === "ko" ? "탭 닫기" : "Hide Tabs") : lang === "ko" ? "탭 열기" : "Show Tabs"}
            </button>
          </div>
          <div className="settings-tab-status">
            <div>
              <strong>{sectionsTitleMap[activeSection]}</strong>
              <small className="muted">
                {lang === "ko"
                  ? query
                    ? `검색어 "${searchQuery.trim()}" 기준으로 맞는 탭만 표시 중입니다.`
                    : "사이드 탭 하나만 남기고, 관련 설정을 묶어서 정리했습니다."
                  : query
                    ? `Showing tabs that match "${searchQuery.trim()}".`
                    : "Use the sidebar tabs to open each settings group."}
              </small>
            </div>
            <small className="muted">{lang === "ko" ? `${filteredCount}개 탭` : `${filteredCount} tabs`}</small>
          </div>
        </section>

        {visibleSections.length === 0 ? (
          <section className="card settings-empty-state">
            <strong>{lang === "ko" ? "검색 결과가 없습니다." : "No matching settings found."}</strong>
            <small className="muted">
              {lang === "ko" ? "다른 키워드로 다시 검색하거나 왼쪽 탭에서 직접 선택하세요." : "Try a different keyword or choose a tab from the left."}
            </small>
          </section>
        ) : null}

        {renderSection(
          "basic",
          lang === "ko" ? "닉네임과 현재 진행 상황처럼 자주 확인하는 기본 정보입니다." : "Frequently used profile controls and current progress.",
          <>
            <div className="settings-split-grid">
              <label>
                {lang === "ko" ? "닉네임" : "Nickname"}
                <input
                  type="text"
                  value={nicknameDraft}
                  onChange={(event) => setNicknameDraft(event.target.value)}
                  onBlur={() => {
                    const next = nicknameDraft.trim();
                    if (next === String(profile.nickname || "")) return;
                    void applyBasicPatch(
                      { profile: { nickname: next } as Partial<Settings["profile"]> },
                      lang === "ko" ? "닉네임 저장 완료" : "Nickname saved"
                    );
                  }}
                />
                <small className="muted">{lang === "ko" ? "상단 표시 이름과 공유 카드에 함께 사용됩니다." : "Used for the top bar and share card."}</small>
              </label>
              <div className="settings-mini-summary-grid">
                <div className="settings-mini-summary-card">
                  <span>{lang === "ko" ? "현재 레벨" : "Current Level"}</span>
                  <strong>
                    Lv.{hud.level} · {hud.rank}
                  </strong>
                </div>
                <div className="settings-mini-summary-card">
                  <span>{lang === "ko" ? "주간 목표" : "Weekly Goal"}</span>
                  <strong>
                    {Number(profile.weekly_goal_sessions ?? 3)}회 / {Number(profile.weekly_goal_minutes ?? 90)}분
                  </strong>
                </div>
                <div className="settings-mini-summary-card">
                  <span>{lang === "ko" ? "다음 해금" : "Next Unlock"}</span>
                  <strong>{hud.next_unlock?.name || (lang === "ko" ? "표시 없음" : "None")}</strong>
                </div>
                <div className="settings-mini-summary-card">
                  <span>{lang === "ko" ? "표시 이름 미리보기" : "Display Name Preview"}</span>
                  <strong>{nicknameDraft.trim() || "Bassist"}</strong>
                </div>
              </div>
            </div>
          </>
        )}

        {renderSection(
          "appearance",
          lang === "ko" ? "앱 테마만 빠르게 바꿉니다." : "Switch the app theme.",
          <>
            <div className="settings-theme-grid">
              {THEME_PRESETS.map((theme) => {
                const selected = settings.ui.default_theme === theme.id;
                const locked = hud.level < theme.unlockLevel;
                return (
                  <button
                    key={theme.id}
                    type="button"
                    className={`settings-theme-card ${selected ? "active" : ""} ${locked ? "locked" : ""}`}
                    data-testid={`theme-card-${theme.id}`}
                    disabled={locked}
                    onClick={() => {
                      if (locked) return;
                      void applyBasicPatch(
                        { ui: { default_theme: theme.id } as Partial<Settings["ui"]> },
                        lang === "ko" ? `테마 변경 완료: ${theme.name}` : `Theme changed: ${theme.name}`
                      );
                    }}
                  >
                    <div className="settings-theme-preview" style={{ background: `linear-gradient(135deg, ${theme.swatches[0]}, ${theme.swatches[1]})` }}>
                      <span style={{ backgroundColor: theme.swatches[2] }} />
                    </div>
                    <div className="settings-theme-meta">
                      <strong>{theme.name}</strong>
                      <small>{theme.subtitle[lang]}</small>
                      <small className="muted">
                        {lang === "ko" ? `해금 Lv.${theme.unlockLevel}` : `Unlock Lv.${theme.unlockLevel}`}
                      </small>
                    </div>
                    {selected ? <span className="settings-theme-chip">{lang === "ko" ? "선택됨" : "Selected"}</span> : null}
                    {locked ? <span className="settings-theme-chip lock">{lang === "ko" ? "잠김" : "Locked"}</span> : null}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {renderSection(
          "soundMotion",
          lang === "ko" ? "사운드, 알림, 효과를 연습 스타일에 맞게 조정합니다." : "Tune sound, alerts, and effects for your practice style.",
          <>
            <div className="quest-setting-box">
              <strong>{lang === "ko" ? "연습 환경 프리셋" : "Practice Environment Presets"}</strong>
              <div className="settings-choice-grid">
                {SOUND_PRESETS.map((preset) => (
                  <button
                    key={`sound-preset-${preset.id}`}
                    type="button"
                    className="settings-choice-card"
                    onClick={() => void applySoundPreset(preset.id)}
                  >
                    <strong>{preset.title[lang]}</strong>
                    <small>{preset.description[lang]}</small>
                  </button>
                ))}
              </div>
            </div>
            <div className="settings-split-grid">
              <div className="quest-setting-box">
                <strong>{lang === "ko" ? "사운드" : "Sound"}</strong>
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={Boolean(audio.enabled)}
                    onChange={(event) => {
                      void applyBasicPatch(
                        { audio: { enabled: event.target.checked } as Partial<Settings["audio"]> },
                        lang === "ko" ? "오디오 설정 저장 완료" : "Audio setting saved"
                      );
                    }}
                  />
                  <span>{lang === "ko" ? "사운드 사용" : "Sound enabled"}</span>
                </label>
                <label>
                  {lang === "ko" ? "마스터 볼륨" : "Master Volume"} ({Number(audio.master_volume ?? 0.6).toFixed(2)})
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={Number(audio.master_volume ?? 0.6)}
                    onChange={(event) => {
                      void applyBasicPatch({
                        audio: { master_volume: Math.max(0, Math.min(1, Number(event.target.value))) } as Partial<Settings["audio"]>,
                      });
                    }}
                  />
                </label>
                <label>
                  {lang === "ko" ? "애니메이션 강도" : "Animation Intensity"}
                  <select
                    value={ui.animation_intensity ?? "adaptive"}
                    onChange={(event) => {
                      void applyBasicPatch(
                        { ui: { animation_intensity: event.target.value as "adaptive" | "low" | "high" } as Partial<Settings["ui"]> },
                        lang === "ko" ? "애니메이션 강도 변경 완료" : "Animation intensity updated"
                      );
                    }}
                  >
                    <option value="adaptive">{lang === "ko" ? "자동" : "Adaptive"}</option>
                    <option value="low">{lang === "ko" ? "낮음" : "Low"}</option>
                    <option value="high">{lang === "ko" ? "높음" : "High"}</option>
                  </select>
                </label>
              </div>
              <div className="quest-setting-box">
                <strong>{lang === "ko" ? "영상 / 탭 전환" : "Video / Tab Switching"}</strong>
                <div className="song-form-grid">
                  <label>
                    {lang === "ko" ? "탭 전환 시 영상 재생" : "Playback on tab switch"}
                    <select
                      value={ui.practice_video_tab_switch_playback ?? "continue"}
                      onChange={(event) => {
                        void applyBasicPatch(
                          {
                            ui: {
                              practice_video_tab_switch_playback: event.target.value as "continue" | "pause" | "pip_only",
                            } as Partial<Settings["ui"]>,
                          },
                          lang === "ko" ? "탭 전환 재생 정책 저장 완료" : "Tab switch playback policy saved"
                        );
                      }}
                    >
                      <option value="continue">{lang === "ko" ? "계속 재생" : "Continue"}</option>
                      <option value="pause">{lang === "ko" ? "일시정지" : "Pause"}</option>
                      <option value="pip_only">{lang === "ko" ? "PIP 전용" : "PIP only"}</option>
                    </select>
                  </label>
                  <label>
                    {lang === "ko" ? "영상 PIP 기본 모드" : "Video PIP default mode"}
                    <select
                      value={ui.practice_video_pip_mode ?? "mini"}
                      onChange={(event) => {
                        void applyBasicPatch(
                          {
                            ui: {
                              practice_video_pip_mode: event.target.value as "mini" | "none",
                            } as Partial<Settings["ui"]>,
                          },
                          lang === "ko" ? "PIP 기본 모드 저장 완료" : "PIP default mode saved"
                        );
                      }}
                    >
                      <option value="mini">{lang === "ko" ? "미니 플레이어" : "Mini"}</option>
                      <option value="none">{lang === "ko" ? "사용 안 함" : "Off"}</option>
                    </select>
                  </label>
                </div>
              </div>
            </div>
            <div className="quest-setting-box">
              <strong>{lang === "ko" ? "알림 토글" : "Notification toggles"}</strong>
              <div className="song-form-grid">
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={ui.notify_level_up !== false}
                    onChange={(event) =>
                      void applyBasicPatch({
                        ui: { notify_level_up: event.target.checked } as Partial<Settings["ui"]>,
                      })
                    }
                  />
                  <span>{lang === "ko" ? "레벨업 알림" : "Level-up notification"}</span>
                </label>
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={ui.notify_achievement_unlock !== false}
                    onChange={(event) =>
                      void applyBasicPatch({
                        ui: { notify_achievement_unlock: event.target.checked } as Partial<Settings["ui"]>,
                      })
                    }
                  />
                  <span>{lang === "ko" ? "업적 달성 알림" : "Achievement unlock notification"}</span>
                </label>
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={ui.notify_quest_complete !== false}
                    onChange={(event) =>
                      void applyBasicPatch({
                        ui: { notify_quest_complete: event.target.checked } as Partial<Settings["ui"]>,
                      })
                    }
                  />
                  <span>{lang === "ko" ? "퀘스트 완료 알림" : "Quest complete notification"}</span>
                </label>
              </div>
            </div>
            <div className="quest-setting-box">
              <strong>{lang === "ko" ? "이펙트 토글" : "Effect toggles"}</strong>
              <div className="song-form-grid">
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={ui.fx_level_up_overlay ?? ui.enable_confetti ?? true}
                    onChange={(event) =>
                      void applyBasicPatch({
                        ui: {
                          fx_level_up_overlay: event.target.checked,
                          enable_confetti: event.target.checked,
                        } as Partial<Settings["ui"]>,
                      })
                    }
                  />
                  <span>{lang === "ko" ? "레벨업 전체화면 이펙트" : "Level-up fullscreen effect"}</span>
                </label>
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={ui.fx_session_complete_normal !== false}
                    onChange={(event) =>
                      void applyBasicPatch({
                        ui: { fx_session_complete_normal: event.target.checked } as Partial<Settings["ui"]>,
                      })
                    }
                  />
                  <span>{lang === "ko" ? "일반 세션 완료 이펙트" : "Normal session complete effect"}</span>
                </label>
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={ui.fx_session_complete_quick === true}
                    onChange={(event) =>
                      void applyBasicPatch({
                        ui: { fx_session_complete_quick: event.target.checked } as Partial<Settings["ui"]>,
                      })
                    }
                  />
                  <span>{lang === "ko" ? "빠른 세션(<=10분) 완료 이펙트" : "Quick session (<=10m) complete effect"}</span>
                </label>
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={ui.fx_claim_quest !== false}
                    onChange={(event) =>
                      void applyBasicPatch({
                        ui: { fx_claim_quest: event.target.checked } as Partial<Settings["ui"]>,
                      })
                    }
                  />
                  <span>{lang === "ko" ? "퀘스트 수령 이펙트" : "Quest claim effect"}</span>
                </label>
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={ui.fx_claim_achievement !== false}
                    onChange={(event) =>
                      void applyBasicPatch({
                        ui: { fx_claim_achievement: event.target.checked } as Partial<Settings["ui"]>,
                      })
                    }
                  />
                  <span>{lang === "ko" ? "업적 수령 이펙트" : "Achievement claim effect"}</span>
                </label>
              </div>
            </div>
          </>
        )}

        {renderSection(
          "keyboard",
          lang === "ko" ? "주요 탭/PiP/팝업 단축키를 설정합니다." : "Configure major tab, PiP, and popup shortcuts.",
          <>
            <small className="muted">
              {lang === "ko"
                ? "단축키 입력 중에는 다른 앱 단축키보다 우선합니다. F5 / Ctrl+R 는 예약되어 변경할 수 없습니다."
                : "Shortcut capture takes priority. F5 / Ctrl+R remain reserved and cannot be assigned."}
            </small>
            {keyboardConflictText ? <div className="settings-inline-error">{keyboardConflictText}</div> : null}
            <div className="row settings-shortcut-toolbar">
              <button className="ghost-btn" data-testid="keyboard-reset-all" onClick={() => void resetAllShortcutBindings()}>
                {lang === "ko" ? "기본값 전체 복원" : "Reset All To Defaults"}
              </button>
              <small className="muted">
                {capturingShortcutId
                  ? lang === "ko"
                    ? `${shortcutMetaById(capturingShortcutId).label[lang]} 입력 대기 중 · Esc 취소 · Delete/Backspace 비우기`
                    : `Listening for ${shortcutMetaById(capturingShortcutId).label[lang]} · Esc cancels · Delete/Backspace clears`
                  : lang === "ko"
                    ? "변경을 누른 뒤 원하는 키를 입력하세요."
                    : "Click change and press the key combination you want."}
              </small>
            </div>
            {keyboardActionGroups.map((group) => (
              <div key={group.id} className="settings-shortcut-group">
                <strong>{group.title}</strong>
                <div className="settings-shortcut-list">
                  {group.items.map((item) => {
                    const binding = normalizedShortcutSettings.bindings[item.id];
                    const capturing = capturingShortcutId === item.id;
                    return (
                      <div
                        key={item.id}
                        className={`settings-shortcut-row ${capturing ? "capturing" : ""}`}
                        data-testid={`keyboard-shortcut-row-${item.id}`}
                      >
                        <span className="settings-shortcut-copy">
                          <strong>{item.label[lang]}</strong>
                          <small className="muted">{item.description[lang]}</small>
                        </span>
                        <code className="settings-shortcut-binding">
                          {capturing ? (lang === "ko" ? "입력 대기 중..." : "Listening...") : formatShortcutBinding(binding, lang)}
                        </code>
                        <div className="settings-shortcut-actions">
                          <button
                            type="button"
                            className={`ghost-btn compact-add-btn ${capturing ? "active-mini" : ""}`}
                            data-testid={`keyboard-shortcut-change-${item.id}`}
                            onClick={() => {
                              setKeyboardConflictText("");
                              setCapturingShortcutId((prev) => (prev === item.id ? null : item.id));
                            }}
                          >
                            {capturing ? (lang === "ko" ? "취소" : "Cancel") : lang === "ko" ? "변경" : "Change"}
                          </button>
                          <button
                            type="button"
                            className="ghost-btn compact-add-btn"
                            data-testid={`keyboard-shortcut-reset-${item.id}`}
                            onClick={() => void saveShortcutBinding(item.id, DEFAULT_SHORTCUT_BINDINGS[item.id] ? { ...DEFAULT_SHORTCUT_BINDINGS[item.id]! } : null)}
                          >
                            {lang === "ko" ? "초기화" : "Reset"}
                          </button>
                          <button
                            type="button"
                            className="ghost-btn compact-add-btn danger-border"
                            data-testid={`keyboard-shortcut-clear-${item.id}`}
                            onClick={() => void saveShortcutBinding(item.id, null)}
                          >
                            {lang === "ko" ? "비우기" : "Clear"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </>
        )}

        {renderSection(
          "goals",
          lang === "ko" ? "주간/월간 목표를 프리셋이나 직접 입력으로 맞춥니다." : "Choose a preset or fine-tune weekly and monthly goals.",
          <>
            <div className="quest-setting-box">
              <strong>{lang === "ko" ? "추천 목표 프리셋" : "Recommended Goal Presets"}</strong>
              <div className="settings-choice-grid">
                {GOAL_PRESETS.map((preset) => (
                  <button
                    key={`goal-preset-${preset.id}`}
                    type="button"
                    className="settings-choice-card"
                    onClick={() => void applyGoalPreset(preset.id)}
                  >
                    <strong>{preset.title[lang]}</strong>
                    <small>{preset.summary[lang]}</small>
                  </button>
                ))}
              </div>
            </div>
            <div className="song-form-grid">
              <label>
                {lang === "ko" ? "주간 목표 세션 수" : "Weekly Goal Sessions"}
                <input
                  type="number"
                  min={1}
                  max={14}
                  value={Number(profile.weekly_goal_sessions ?? 3)}
                  onChange={(event) => {
                    void applyBasicPatch({
                      profile: {
                        weekly_goal_sessions: Math.max(1, Number(event.target.value || 1)),
                      } as Partial<Settings["profile"]>,
                    });
                  }}
                />
              </label>
              <label>
                {lang === "ko" ? "주간 목표 분" : "Weekly Goal Minutes"}
                <input
                  type="number"
                  min={0}
                  value={Number(profile.weekly_goal_minutes ?? 90)}
                  onChange={(event) => {
                    void applyBasicPatch({
                      profile: {
                        weekly_goal_minutes: Math.max(0, Number(event.target.value || 0)),
                      } as Partial<Settings["profile"]>,
                    });
                  }}
                />
              </label>
              <label>
                {lang === "ko" ? "월간 목표 분" : "Monthly Goal Minutes"}
                <input
                  type="number"
                  min={0}
                  value={Number(profile.monthly_goal_minutes ?? 420)}
                  onChange={(event) => {
                    void applyBasicPatch({
                      profile: {
                        monthly_goal_minutes: Math.max(0, Number(event.target.value || 0)),
                      } as Partial<Settings["profile"]>,
                    });
                  }}
                />
              </label>
              <label>
                {lang === "ko" ? "주간 XP 목표" : "Weekly XP Goal"}
                <input
                  type="number"
                  min={0}
                  value={Number(profile.xp_goal_weekly ?? 0)}
                  onChange={(event) => {
                    void applyBasicPatch({
                      profile: {
                        xp_goal_weekly: Math.max(0, Number(event.target.value || 0)),
                      } as Partial<Settings["profile"]>,
                    });
                  }}
                />
              </label>
              <label>
                {lang === "ko" ? "월간 XP 목표" : "Monthly XP Goal"}
                <input
                  type="number"
                  min={0}
                  value={Number(profile.xp_goal_monthly ?? 0)}
                  onChange={(event) => {
                    void applyBasicPatch({
                      profile: {
                        xp_goal_monthly: Math.max(0, Number(event.target.value || 0)),
                      } as Partial<Settings["profile"]>,
                    });
                  }}
                />
              </label>
            </div>
          </>
        )}

        {renderSection(
          "dataBackup",
          lang === "ko" ? "내보내기, 즉시 백업, 자동 백업, 백업 복원만 노출합니다." : "Expose export, snapshot, auto backup, and restore only.",
          <>
            <div className="row">
              <button
                className="ghost-btn"
                onClick={async () => {
                  try {
                    const result = await createExport();
                    setMessage(lang === "ko" ? `내보내기 완료: ${result.file}` : `Export created: ${result.file}`);
                  } catch (error) {
                    setMessage(getErrorMessage(error, lang === "ko" ? "내보내기 실패" : "Export failed"));
                  }
                }}
              >
                {lang === "ko" ? "데이터 내보내기" : "Export Data"}
              </button>
              <button
                className="ghost-btn"
                disabled={backupBusy}
                onClick={async () => {
                  try {
                    setBackupBusy(true);
                    const result = await createBackupSnapshot();
                    if (result.created) {
                      setMessage(
                        lang === "ko"
                          ? `백업 생성 완료: ${result.file ?? "backup"}`
                          : `Backup snapshot created: ${result.file ?? "backup"}`
                      );
                    } else {
                      setMessage(
                        lang === "ko"
                          ? `백업 생성 건너뜀: ${result.reason ?? "unknown"}`
                          : `Backup skipped: ${result.reason ?? "unknown"}`
                      );
                    }
                    await loadBackups();
                  } catch (error) {
                    setMessage(getErrorMessage(error, lang === "ko" ? "백업 생성 실패" : "Failed to create backup"));
                  } finally {
                    setBackupBusy(false);
                  }
                }}
              >
                {lang === "ko" ? "지금 백업 생성" : "Create Backup Snapshot"}
              </button>
            </div>
            <div className="song-form-grid">
              <label className="inline">
                <input
                  type="checkbox"
                  checked={backupConfig.enabled}
                  onChange={(event) => {
                    void applyCriticalPatch({ backup: { ...backupConfig, enabled: event.target.checked } });
                  }}
                />
                <span>{lang === "ko" ? "자동 백업 사용" : "Automatic backup enabled"}</span>
              </label>
            </div>
            <div className="settings-backup-list-wrap">
              <div className="row">
                <strong>{lang === "ko" ? "백업 목록" : "Backup List"}</strong>
                <button className="ghost-btn compact-add-btn" onClick={() => void loadBackups()} disabled={backupLoading || backupBusy}>
                  {lang === "ko" ? "새로고침" : "Reload"}
                </button>
              </div>
              {backupLoading ? <small className="muted">{lang === "ko" ? "불러오는 중..." : "Loading..."}</small> : null}
              {!backupLoading && backups.length === 0 ? (
                <small className="muted">{lang === "ko" ? "백업이 없습니다." : "No backups found."}</small>
              ) : null}
              {backups.length > 0 ? (
                <div className="settings-backup-list">
                  {backups.map((item) => (
                    <div key={item.name} className="settings-backup-item">
                      <div>
                        <strong>{item.name}</strong>
                        <small className="muted">
                          {new Date(item.mtime * 1000).toLocaleString()} · {formatBytes(item.size)}
                        </small>
                      </div>
                      <button
                        className="ghost-btn danger-border"
                        data-testid="backup-restore-btn"
                        disabled={backupBusy}
                        onClick={() => void restoreBackupWithConfirm(item.name)}
                      >
                        {lang === "ko" ? "복원" : "Restore"}
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </>
        )}

        {renderSection(
          "misc",
          lang === "ko" ? "대시보드 자잘한 옵션과 관리 메뉴를 한곳에서 다룹니다." : "Manage dashboard extras and utility actions in one place.",
          <>
            <div className="settings-split-grid">
              <div className="quest-setting-box">
                <strong>{lang === "ko" ? "대시보드 스타일" : "Dashboard Style"}</strong>
                <div className="settings-choice-grid">
                  {DASHBOARD_VERSION_OPTIONS.map((item) => (
                    <button
                      key={`dashboard-version-${item.id}`}
                      type="button"
                      className={`settings-choice-card ${dashboardVersion === item.id ? "active" : ""}`}
                      onClick={() =>
                        void applyBasicPatch(
                          { ui: { dashboard_version: item.id } as Partial<Settings["ui"]> },
                          lang === "ko" ? `${item.title.ko} 대시보드 적용` : `Applied ${item.title.en} dashboard`
                        )
                      }
                    >
                      <strong>{item.title[lang]}</strong>
                      <small>{item.description[lang]}</small>
                    </button>
                  ))}
                </div>
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={ui.dashboard_glass_cards !== false}
                    onChange={(event) =>
                      void applyBasicPatch(
                        { ui: { dashboard_glass_cards: event.target.checked } as Partial<Settings["ui"]> },
                        lang === "ko" ? "카드 질감 설정 저장 완료" : "Card texture setting saved"
                      )
                    }
                  />
                  <span>{lang === "ko" ? "카드에 유리 느낌 효과 사용" : "Use glass card effect"}</span>
                </label>
              </div>
              <div className="quest-setting-box">
                <strong>{lang === "ko" ? "대시보드 사진 위치" : "Dashboard Photo Focus"}</strong>
                <small className="muted">
                  {lang === "ko" ? "대표 이미지가 어느 쪽을 중심으로 보일지 정합니다." : "Choose which area of the dashboard photo stays centered."}
                </small>
                <div className="settings-chip-row">
                  {PHOTO_ANCHOR_OPTIONS.map((item) => (
                    <button
                      key={`photo-anchor-${item.id}`}
                      type="button"
                      className={`settings-chip-button ${dashboardPhotoAnchor === item.id ? "active" : ""}`}
                      onClick={() =>
                        void applyBasicPatch(
                          { profile: { dashboard_photo_anchor: item.id } as Partial<Settings["profile"]> },
                          lang === "ko" ? "사진 위치 설정 저장 완료" : "Photo focus setting saved"
                        )
                      }
                    >
                      {item.label[lang]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="settings-split-grid">
              <div className="quest-setting-box">
                <strong>{lang === "ko" ? "대시보드 위젯 보이기" : "Dashboard Widgets"}</strong>
                <div className="song-form-grid">
                  {DASHBOARD_WIDGET_KEYS.map((key) => {
                    const locked = key === "hud" || key === "timer";
                    return (
                      <label key={`misc-widget-${key}`} className="inline">
                        <input
                          type="checkbox"
                          checked={dashboardLayoutDraft[key]?.visible !== false}
                          disabled={locked}
                          onChange={(event) => updateDashboardLayoutDraft(key, { visible: event.target.checked })}
                        />
                        <span>
                          {dashboardWidgetLabel(key, lang)}
                          {locked ? (lang === "ko" ? " (항상 표시)" : " (always on)") : ""}
                        </span>
                      </label>
                    );
                  })}
                </div>
                <div className="settings-inline-actions">
                  <button className="ghost-btn compact-add-btn" type="button" onClick={() => void saveDashboardLayout()}>
                    {lang === "ko" ? "위젯 배치 저장" : "Save Widget Layout"}
                  </button>
                  <button className="ghost-btn compact-add-btn" type="button" onClick={resetDashboardLayoutDraft}>
                    {lang === "ko" ? "기본 배치로 되돌리기" : "Reset Layout"}
                  </button>
                </div>
                {layoutDirty ? (
                  <small className="muted">{lang === "ko" ? "위젯 표시 변경 사항이 자동 저장 대기 중입니다." : "Widget changes are waiting to autosave."}</small>
                ) : null}
                <button
                  className="ghost-btn"
                  disabled={!canShareCard}
                  onClick={() => {
                    exportShareCard({
                      nickname: settings.profile.nickname,
                      level: hud.level,
                      rank: hud.rank,
                      totalXp: hud.total_xp,
                    });
                    setMessage(lang === "ko" ? "공유 카드 이미지를 저장했습니다." : "Share card image saved.");
                  }}
                >
                  {lang === "ko" ? "공유 카드 생성" : "Generate Share Card"} {canShareCard ? "" : lang === "ko" ? "(잠김)" : "(Locked)"}
                </button>
              </div>
              <div className="quest-setting-box">
                <strong>{lang === "ko" ? "작은 편의 설정" : "Convenience"}</strong>
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={ui.notify_level_up !== false}
                    onChange={(event) =>
                      void applyBasicPatch({
                        ui: { notify_level_up: event.target.checked } as Partial<Settings["ui"]>,
                      })
                    }
                  />
                  <span>{lang === "ko" ? "레벨업 알림 유지" : "Keep level-up notification"}</span>
                </label>
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={ui.notify_achievement_unlock !== false}
                    onChange={(event) =>
                      void applyBasicPatch({
                        ui: { notify_achievement_unlock: event.target.checked } as Partial<Settings["ui"]>,
                      })
                    }
                  />
                  <span>{lang === "ko" ? "업적 알림 유지" : "Keep achievement notifications"}</span>
                </label>
                <label>
                  {lang === "ko" ? "세션 타이머 PiP 위치" : "Session Timer PiP Corner"}
                  <select
                    value={ui.session_timer_pip_corner ?? "top-right"}
                    onChange={(event) =>
                      void applyBasicPatch({
                        ui: {
                          session_timer_pip_corner: event.target.value as
                            | "top-right"
                            | "top-left"
                            | "bottom-right"
                            | "bottom-left",
                        } as Partial<Settings["ui"]>,
                      })
                    }
                  >
                    <option value="top-right">{lang === "ko" ? "오른쪽 위" : "Top Right"}</option>
                    <option value="top-left">{lang === "ko" ? "왼쪽 위" : "Top Left"}</option>
                    <option value="bottom-right">{lang === "ko" ? "오른쪽 아래" : "Bottom Right"}</option>
                    <option value="bottom-left">{lang === "ko" ? "왼쪽 아래" : "Bottom Left"}</option>
                  </select>
                </label>
              </div>
            </div>
            <div className="settings-action-grid">
              <article className="card settings-action-card">
                <div className="settings-action-copy">
                  <strong>{lang === "ko" ? "초기화" : "Reset"}</strong>
                </div>
                <button
                  type="button"
                  className="ghost-btn danger-border"
                  data-testid="reset-tools-open-btn"
                  onClick={() => setResetOverlayOpen(true)}
                >
                  {lang === "ko" ? "초기화 열기" : "Open Reset"}
                </button>
              </article>
              <article className="card settings-action-card">
                <div className="settings-action-copy">
                  <strong>{lang === "ko" ? "관리자 도구" : "Admin Tools"}</strong>
                </div>
                <button
                  type="button"
                  className="ghost-btn"
                  data-testid="admin-tools-open-btn"
                  onClick={openAdminAuth}
                >
                  {lang === "ko" ? "관리자 도구 열기" : "Open Admin Tools"}
                </button>
              </article>
            </div>
          </>
        )}
      </div>

      {resetOverlayOpen ? (
        <div
          className="modal-backdrop settings-admin-backdrop"
          data-testid="settings-reset-modal"
          onClick={() => setResetOverlayOpen(false)}
        >
          <div className="modal settings-admin-modal settings-reset-modal" onClick={(event) => event.stopPropagation()}>
            <div className="settings-admin-head">
              <div>
                <h2>{lang === "ko" ? "초기화" : "Reset"}</h2>
                <small className="muted">
                  {lang === "ko"
                    ? "비밀번호는 필요 없지만, 실수 방지를 위해 여러 번 확인하고 마지막 문구를 입력해야 합니다."
                    : "No password is required, but multiple confirmations and a final phrase are required."}
                </small>
              </div>
              <button className="ghost-btn compact-add-btn" onClick={() => setResetOverlayOpen(false)}>
                {lang === "ko" ? "닫기" : "Close"}
              </button>
            </div>

            <section className="settings-admin-panel">
              <h3>{lang === "ko" ? "진행도 초기화" : "Progress Reset"}</h3>
              <p className="muted">
                {lang === "ko"
                  ? "레벨, XP, 퀘스트, 업적 진행도만 초기화합니다. 세션 기록, 라이브러리, 미디어는 유지됩니다."
                  : "Resets only level, XP, quests, and achievement progress. Sessions, library data, and media stay intact."}
              </p>
              <button
                type="button"
                className="ghost-btn danger-border"
                data-testid="reset-progress-btn"
                onClick={() => void resetProgressWithConfirm()}
              >
                {lang === "ko" ? "진행도 초기화 시작" : "Start Progress Reset"}
              </button>
            </section>

            <section className="settings-admin-panel danger-panel">
              <h3>{lang === "ko" ? "전체 초기화" : "Full Reset"}</h3>
              <p className="muted">
                {lang === "ko"
                  ? "현재 런타임의 세션, 설정, 미디어, 진행도를 모두 초기 상태로 되돌립니다."
                  : "Resets the current runtime sessions, settings, media, and progress back to the initial state."}
              </p>
              <button
                type="button"
                className="ghost-btn danger-border"
                data-testid="reset-all-btn"
                onClick={() => void resetAllWithConfirm()}
              >
                {lang === "ko" ? "전체 초기화 시작" : "Start Full Reset"}
              </button>
            </section>
          </div>
        </div>
      ) : null}

      {adminAuthOpen ? (
        <div
          className="modal-backdrop settings-admin-backdrop"
          data-testid="admin-auth-modal"
          onClick={() => {
            setAdminAuthOpen(false);
            setAdminAuthError("");
          }}
        >
          <div className="modal settings-admin-modal settings-auth-modal" onClick={(event) => event.stopPropagation()}>
            <form
              className="settings-auth-form"
              onSubmit={(event) => {
                event.preventDefault();
                void submitAdminAuth();
              }}
            >
              <div className="settings-admin-head">
                <div>
                  <h2>{lang === "ko" ? "관리자 도구 잠금 해제" : "Unlock Admin Tools"}</h2>
                  <small className="muted">
                    {lang === "ko"
                      ? "운영용 설정은 일반 사용자 화면에서 숨겨져 있습니다."
                      : "Operational settings stay hidden from the normal user view."}
                  </small>
                </div>
                <button
                  type="button"
                  className="ghost-btn compact-add-btn"
                  onClick={() => {
                    setAdminAuthOpen(false);
                    setAdminAuthError("");
                  }}
                >
                  {lang === "ko" ? "닫기" : "Close"}
                </button>
              </div>

              <section className="settings-admin-panel">
                <label>
                  {lang === "ko" ? "관리자 비밀번호" : "Admin Password"}
                  <input
                    type="password"
                    data-testid="admin-auth-input"
                    value={adminPasswordDraft}
                    onChange={(event) => {
                      setAdminPasswordDraft(event.target.value);
                      if (adminAuthError) setAdminAuthError("");
                    }}
                    placeholder={lang === "ko" ? "비밀번호 입력" : "Enter password"}
                    autoFocus
                  />
                </label>
                {adminAuthError ? <div className="settings-inline-error">{adminAuthError}</div> : null}
                <div className="row">
                  <button
                    type="submit"
                    className="primary-btn"
                    data-testid="admin-auth-submit"
                    disabled={adminAuthBusy || !adminPasswordDraft.trim()}
                  >
                    {lang === "ko" ? "들어가기" : "Unlock"}
                  </button>
                </div>
              </section>
            </form>
          </div>
        </div>
      ) : null}

      {adminOverlayOpen ? (
        <div className="modal-backdrop settings-admin-backdrop" data-testid="admin-overlay" onClick={() => setAdminOverlayOpen(false)}>
          <div className="modal settings-admin-modal" onClick={(event) => event.stopPropagation()}>
            <div className="settings-admin-head">
              <div>
                <h2>{lang === "ko" ? "관리자 도구" : "Admin Tools"}</h2>
                <small className="muted">
                  {lang === "ko"
                    ? "일반 사용자용 화면에서 숨긴 테스트/운영 항목만 여기서 조정합니다."
                    : "Only operational and testing controls hidden from the public settings are shown here."}
                </small>
              </div>
              <button className="ghost-btn compact-add-btn" onClick={() => setAdminOverlayOpen(false)}>
                {lang === "ko" ? "닫기" : "Close"}
              </button>
            </div>

            <section className="settings-admin-panel">
              <h3>{lang === "ko" ? "Critical Balance / 테스트" : "Critical Balance / Testing"}</h3>
              <div className="critical-grid">
                <div className="tag-help">
                  <small className="muted">
                    {lang === "ko"
                      ? "세션 XP는 분당 3 Point로 고정됩니다. (태그/체크 보너스 미적용)"
                      : "Session XP is fixed at 3 points per minute. (no tag/check bonus)"}
                  </small>
                </div>
                <label>
                  backfill_multiplier_default
                  <input
                    type="number"
                    step="0.05"
                    value={criticalForm.backfill_multiplier_default}
                    onChange={(event) =>
                      setCriticalForm((prev) => ({ ...prev, backfill_multiplier_default: Number(event.target.value) }))
                    }
                  />
                  <small className="muted">{lang === "ko" ? "백필 세션 배수" : "Backfill session multiplier"}</small>
                </label>
                <label>
                  achievement_xp_multiplier
                  <input
                    type="number"
                    step="0.05"
                    value={criticalForm.achievement_xp_multiplier}
                    onChange={(event) =>
                      setCriticalForm((prev) => ({ ...prev, achievement_xp_multiplier: Number(event.target.value) }))
                    }
                  />
                  <small className="muted">{lang === "ko" ? "업적 XP 계산 배수" : "Achievement XP multiplier"}</small>
                </label>
                <label>
                  quest_xp_multiplier
                  <input
                    type="number"
                    step="0.05"
                    value={criticalForm.quest_xp_multiplier}
                    onChange={(event) =>
                      setCriticalForm((prev) => ({ ...prev, quest_xp_multiplier: Number(event.target.value) }))
                    }
                  />
                  <small className="muted">{lang === "ko" ? "퀘스트 XP 계산 배수" : "Quest XP multiplier"}</small>
                </label>
                <label>
                  level_curve base
                  <input
                    type="number"
                    value={criticalForm.base}
                    onChange={(event) => setCriticalForm((prev) => ({ ...prev, base: Number(event.target.value) }))}
                  />
                  <small className="muted">{lang === "ko" ? "레벨 커브 기본값" : "Level curve base value"}</small>
                </label>
                <label>
                  level_curve slope
                  <input
                    type="number"
                    value={criticalForm.slope}
                    onChange={(event) => setCriticalForm((prev) => ({ ...prev, slope: Number(event.target.value) }))}
                  />
                  <small className="muted">{lang === "ko" ? "레벨 커브 선형 계수" : "Level curve linear slope"}</small>
                </label>
                <label>
                  level_curve step_10
                  <input
                    type="number"
                    value={criticalForm.step_10}
                    onChange={(event) => setCriticalForm((prev) => ({ ...prev, step_10: Number(event.target.value) }))}
                  />
                  <small className="muted">{lang === "ko" ? "10레벨대 추가치" : "Extra cost for Lv10~19"}</small>
                </label>
                <label>
                  level_curve step_20
                  <input
                    type="number"
                    value={criticalForm.step_20}
                    onChange={(event) => setCriticalForm((prev) => ({ ...prev, step_20: Number(event.target.value) }))}
                  />
                  <small className="muted">{lang === "ko" ? "20레벨대 추가치" : "Extra cost for Lv20~29"}</small>
                </label>
                <label>
                  level_curve step_30
                  <input
                    type="number"
                    value={criticalForm.step_30}
                    onChange={(event) => setCriticalForm((prev) => ({ ...prev, step_30: Number(event.target.value) }))}
                  />
                  <small className="muted">{lang === "ko" ? "30레벨대 추가치" : "Extra cost for Lv30~39"}</small>
                </label>
                <label>
                  level_curve step_40
                  <input
                    type="number"
                    value={criticalForm.step_40}
                    onChange={(event) => setCriticalForm((prev) => ({ ...prev, step_40: Number(event.target.value) }))}
                  />
                  <small className="muted">{lang === "ko" ? "40레벨대 추가치" : "Extra cost for Lv40~49"}</small>
                </label>
                <label>
                  max_level
                  <input
                    type="number"
                    min={10}
                    max={200}
                    value={criticalForm.max_level}
                    onChange={(event) => setCriticalForm((prev) => ({ ...prev, max_level: Number(event.target.value) }))}
                  />
                  <small className="muted">{lang === "ko" ? "최대 레벨" : "Maximum level"}</small>
                </label>
              </div>
              <div className="tag-help">
                <strong>{lang === "ko" ? "밸런스 요약" : "Balance Summary"}</strong>
                <div className="row">
                  <small>
                    {lang === "ko" ? "30분 기준 기본 XP" : "30m baseline XP"}: {formatDisplayXp(baseline30m, xpDisplayScale)}
                  </small>
                  <small>
                    {lang === "ko" ? `Lv.${criticalForm.max_level} 누적 필요 XP` : `XP to Lv.${criticalForm.max_level}`}:{" "}
                    {formatDisplayXp(xpToMax, xpDisplayScale)}
                  </small>
                </div>
              </div>
              <div className="row">
                <button className="primary-btn" onClick={() => void saveCriticalBalance()}>
                  {lang === "ko" ? "Critical 저장" : "Save Critical Settings"}
                </button>
                <button
                  className="ghost-btn"
                  data-testid="admin-grant-xp-btn"
                  onClick={async () => {
                    try {
                      const grant = Math.max(1, grantToNext);
                      await adminGrantXp(grant);
                      setMessage(
                        lang === "ko"
                          ? `다음 레벨 필요 XP 지급(+${formatDisplayXp(grant, xpDisplayScale)} XP)`
                          : `Granted XP to next level (+${formatDisplayXp(grant, xpDisplayScale)} XP)`
                      );
                      await onRefresh();
                    } catch (error) {
                      setMessage(getErrorMessage(error, lang === "ko" ? "테스트 레벨업 실패" : "Test level up failed"));
                    }
                  }}
                >
                  {lang === "ko"
                    ? `테스트 레벨업 (+${formatDisplayXp(Math.max(1, grantToNext), xpDisplayScale)} XP)`
                    : `Test Level Up (+${formatDisplayXp(Math.max(1, grantToNext), xpDisplayScale)} XP)`}
                </button>
                <button className="ghost-btn" onClick={() => setAchievementManagerOpen(true)}>
                  {lang === "ko" ? "업적 관리자 열기" : "Open Achievement Manager"}
                </button>
              </div>
            </section>

            <section className="settings-admin-panel">
              <h3>{lang === "ko" ? "운영 / 백업 세부값" : "Operations / Backup Details"}</h3>
              <div className="song-form-grid">
                <label>
                  backup.max_files
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={backupConfig.max_files}
                    onChange={(event) => {
                      void applyCriticalPatch({
                        backup: { ...backupConfig, max_files: Math.max(1, Number(event.target.value || 1)) },
                      });
                    }}
                  />
                </label>
                <label>
                  backup.min_hours_between
                  <input
                    type="number"
                    min={1}
                    max={168}
                    value={backupConfig.min_hours_between}
                    onChange={(event) => {
                      void applyCriticalPatch({
                        backup: { ...backupConfig, min_hours_between: Math.max(1, Number(event.target.value || 1)) },
                      });
                    }}
                  />
                </label>
                <label>
                  performance.target_dashboard_ms
                  <input
                    type="number"
                    min={100}
                    step={50}
                    value={perfConfig.target_dashboard_ms}
                    onChange={(event) => {
                      void applyCriticalPatch({
                        performance: { target_dashboard_ms: Math.max(100, Number(event.target.value || 100)) },
                      });
                    }}
                  />
                </label>
              </div>
              <small className="muted">
                {lang === "ko"
                  ? "일반 사용자 화면에서는 자동 백업 on/off만 노출하고, 보관 개수와 간격 같은 운영값은 여기서만 조정합니다."
                  : "The public settings expose only auto backup on/off; retention and timing stay here."}
              </small>
            </section>

            <section className="settings-admin-panel">
              <h3>{lang === "ko" ? "모의 데이터셋" : "Mock Datasets"}</h3>
              <small className="muted" data-testid="mock-profile-status">
                {lang === "ko"
                  ? `현재 프로필: ${mockStatus.profile}${mockStatus.dataset_id ? ` (${mockStatus.dataset_id})` : ""}`
                  : `Current profile: ${mockStatus.profile}${mockStatus.dataset_id ? ` (${mockStatus.dataset_id})` : ""}`}
              </small>
              <small className="muted">
                {lang === "ko"
                  ? `실데이터 경로: ${mockStatus.real_data_path ?? "app/data"}`
                  : `Real data path: ${mockStatus.real_data_path ?? "app/data"}`}
              </small>
              <small className="muted">
                {lang === "ko"
                  ? `모의 데이터셋 루트: ${mockStatus.datasets_root ?? "designPack/mock_datasets"}`
                  : `Mock datasets root: ${mockStatus.datasets_root ?? "designPack/mock_datasets"}`}
              </small>
              <div className="song-form-grid">
                <label>
                  {lang === "ko" ? "데이터셋" : "Dataset"}
                  <select
                    data-testid="mock-dataset-select"
                    value={selectedMockDataset}
                    onChange={(event) => setSelectedMockDataset(event.target.value)}
                  >
                    <option value="">{lang === "ko" ? "(선택)" : "(Select)"}</option>
                    {mockDatasets.map((dataset) => (
                      <option key={dataset.id} value={dataset.id}>
                        {dataset.name} ({dataset.file_count})
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="row">
                <button
                  className="ghost-btn"
                  data-testid="mock-activate-btn"
                  disabled={mockBusy || !selectedMockDataset}
                  onClick={async () => {
                    try {
                      setMockBusy(true);
                      const status = await activateMockData(selectedMockDataset, false);
                      setMockStatus(status);
                      setMessage(lang === "ko" ? "모의 데이터셋 적용 완료" : "Mock dataset activated");
                      await onRefresh();
                    } finally {
                      setMockBusy(false);
                    }
                  }}
                >
                  {lang === "ko" ? "모의데이터 적용" : "Activate Mock"}
                </button>
                <button
                  className="ghost-btn"
                  data-testid="mock-reload-btn"
                  disabled={mockBusy || !selectedMockDataset}
                  onClick={async () => {
                    try {
                      setMockBusy(true);
                      const status = await activateMockData(selectedMockDataset, true);
                      setMockStatus(status);
                      setMessage(lang === "ko" ? "모의 데이터셋 리로드 완료" : "Mock dataset reloaded");
                      await onRefresh();
                    } finally {
                      setMockBusy(false);
                    }
                  }}
                >
                  {lang === "ko" ? "모의데이터 리로드" : "Reload Mock"}
                </button>
                <button
                  className="ghost-btn danger-border"
                  data-testid="mock-deactivate-btn"
                  disabled={mockBusy}
                  onClick={async () => {
                    try {
                      setMockBusy(true);
                      const status = await deactivateMockData();
                      setMockStatus(status);
                      setMessage(lang === "ko" ? "실데이터 프로필로 복귀" : "Returned to real data profile");
                      await onRefresh();
                    } finally {
                      setMockBusy(false);
                    }
                  }}
                >
                  {lang === "ko" ? "실데이터 복귀" : "Back to Real Data"}
                </button>
              </div>
              <div className="song-form-grid">
                <label>
                  {lang === "ko" ? "현재 상태 저장 ID" : "Snapshot Dataset ID"}
                  <input
                    data-testid="mock-export-dataset-id"
                    value={mockExportDatasetId}
                    onChange={(event) => setMockExportDatasetId(event.target.value)}
                    placeholder={lang === "ko" ? "예: my_practice_snapshot" : "e.g. my_practice_snapshot"}
                  />
                </label>
              </div>
              <div className="row">
                <button
                  className="ghost-btn"
                  data-testid="mock-export-current-btn"
                  disabled={mockBusy || mockExportBusy || !mockExportDatasetId.trim()}
                  onClick={async () => {
                    try {
                      setMockExportBusy(true);
                      const result = await exportCurrentToMockDataset({
                        dataset_id: mockExportDatasetId.trim(),
                        generate_sessions_60d: true,
                        session_days: 60,
                      });
                      await loadMockDatasets();
                      setSelectedMockDataset(result.dataset_id);
                      setMessage(
                        lang === "ko"
                          ? `샌드박스 데이터셋 저장 완료: ${result.dataset_id} (${result.generated_sessions}개 세션 / 미디어 ${result.media_file_count}개 / 업적 정의·상태 포함)`
                          : `Sandbox dataset exported: ${result.dataset_id} (${result.generated_sessions} sessions / ${result.media_file_count} media files / achievements included)`
                      );
                    } finally {
                      setMockExportBusy(false);
                    }
                  }}
                >
                  {lang === "ko" ? "현재 상태를 샌드박스로 저장 (+60일 세션 + 미디어)" : "Export current state (+60d sessions + media)"}
                </button>
              </div>
            </section>
          </div>
        </div>
      ) : null}

      {achievementManagerOpen ? (
        <div className="modal-backdrop achievement-manager-backdrop">
          <div className="modal achievement-manager-modal">
            <div className="achievement-manager-head">
              <h2>{lang === "ko" ? "업적 관리자" : "Achievement Manager"}</h2>
              <button className="ghost-btn compact-add-btn" onClick={() => setAchievementManagerOpen(false)}>
                {lang === "ko" ? "닫기" : "Close"}
              </button>
            </div>
            <AchievementAdminPanel
              lang={lang}
              settings={settings}
              onSettingsChange={onSettingsChange}
              setMessage={setMessage}
              onRefresh={onRefresh}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
