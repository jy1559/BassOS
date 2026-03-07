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
  | "dashboard"
  | "goals"
  | "quests"
  | "design"
  | "library"
  | "dataBackup"
  | "mock"
  | "misc"
  | "developer";

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
  "dashboard",
  "goals",
  "quests",
  "design",
  "library",
  "dataBackup",
  "mock",
  "misc",
  "developer",
];

const SHORTCUT_GROUP_ORDER: ShortcutGroupId[] = ["tabs", "video", "metronome", "pin", "pip", "popup"];

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
    dashboard: null,
    goals: null,
    quests: null,
    design: null,
    library: null,
    dataBackup: null,
    mock: null,
    misc: null,
    developer: null,
  };
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
  const [sectionCollapsed, setSectionCollapsed] = useState<Record<SectionId, boolean>>({
    basic: false,
    appearance: false,
    soundMotion: false,
    keyboard: false,
    dashboard: false,
    goals: false,
    quests: false,
    design: false,
    library: false,
    dataBackup: false,
    mock: true,
    misc: true,
    developer: true,
  });
  const normalizedShortcutSettings = useMemo(() => normalizeKeyboardShortcutSettings(ui.keyboard_shortcuts), [ui.keyboard_shortcuts]);
  const [capturingShortcutId, setCapturingShortcutId] = useState<ShortcutActionId | null>(null);
  const [keyboardConflictText, setKeyboardConflictText] = useState("");

  const [nicknameDraft, setNicknameDraft] = useState(String(profile.nickname || ""));
  const [newGenre, setNewGenre] = useState("");
  const [newGenreGroupName, setNewGenreGroupName] = useState("");
  const [newGenreTargetGroup, setNewGenreTargetGroup] = useState("");
  const [adminOverlayOpen, setAdminOverlayOpen] = useState(false);
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

  const sectionRefs = useRef<Record<SectionId, HTMLElement | null>>(makeSectionRefMap());
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
    gate_enabled: Boolean(admin.gate_enabled ?? false),
    pin_hash: String(admin.pin_hash ?? ""),
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

  const query = searchQuery.trim().toLowerCase();
  const sections = useMemo(
    () => [
      {
        id: "basic" as const,
        title: lang === "ko" ? "기본" : "Basic",
        keywords: ["basic", "nickname", "language", "name", "profile"],
      },
      {
        id: "appearance" as const,
        title: lang === "ko" ? "외형/테마" : "Appearance / Themes",
        keywords: ["theme", "appearance", "unlock", "preview"],
      },
      {
        id: "soundMotion" as const,
        title: lang === "ko" ? "사운드/모션" : "Sound / Motion",
        keywords: ["audio", "sound", "motion", "animation", "volume"],
      },
      {
        id: "keyboard" as const,
        title: lang === "ko" ? "키보드 단축키" : "Keyboard Shortcuts",
        keywords: ["keyboard", "shortcut", "hotkey", "video", "pip", "metronome", "tab"],
      },
      {
        id: "dashboard" as const,
        title: lang === "ko" ? "대시보드" : "Dashboard",
        keywords: ["dashboard", "layout", "glass", "hud"],
      },
      {
        id: "goals" as const,
        title: lang === "ko" ? "목표/성장" : "Goals / Growth",
        keywords: ["goal", "xp", "weekly", "monthly", "growth"],
      },
      {
        id: "quests" as const,
        title: lang === "ko" ? "퀘스트 자동화" : "Quest Automation",
        keywords: ["quest", "period", "difficulty", "priority", "automation"],
      },
      {
        id: "design" as const,
        title: lang === "ko" ? "색상/디자인" : "Color / Design",
        keywords: ["design", "color", "style", "palette", "glass", "achievement"],
      },
      {
        id: "library" as const,
        title: lang === "ko" ? "라이브러리/추천" : "Library / Recommendation",
        keywords: ["genre", "group", "library", "recommend", "alias", "rename"],
      },
      {
        id: "dataBackup" as const,
        title: lang === "ko" ? "데이터/백업" : "Data / Backup",
        keywords: ["backup", "restore", "export", "snapshot", "data"],
      },
      {
        id: "mock" as const,
        title: lang === "ko" ? "테스트 데이터(Mock)" : "Test Data (Mock)",
        keywords: ["mock", "dataset", "sandbox", "test"],
      },
      {
        id: "misc" as const,
        title: lang === "ko" ? "기타 정보" : "Misc",
        keywords: ["unlock", "unlockables", "info"],
      },
      {
        id: "developer" as const,
        title: lang === "ko" ? "개발자" : "Developer",
        keywords: ["developer", "admin", "performance", "pin", "experimental"],
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

  const setSectionRef = (id: SectionId) => (node: HTMLElement | null) => {
    sectionRefs.current[id] = node;
  };

  const getScrollContainer = (): HTMLElement | null => document.querySelector(".content");

  const isSectionCollapsed = (id: SectionId): boolean => {
    if (query && !sectionMatch[id]) return true;
    return Boolean(sectionCollapsed[id]);
  };

  const toggleSectionCollapsed = (id: SectionId) => {
    setSectionCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const scrollToSection = (id: SectionId) => {
    const target = sectionRefs.current[id];
    const container = getScrollContainer();
    if (!target || !container) return;
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const top = container.scrollTop + (targetRect.top - containerRect.top) - 12;
    container.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    setActiveSection(id);
    setTocOpen(false);
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
    const collapsed = isSectionCollapsed(id);
    const filtered = Boolean(query) && !sectionMatch[id];
    return (
      <section
        ref={setSectionRef(id)}
        className={`card settings-section ${options?.lowEmphasis ? "settings-section-low" : ""} ${filtered ? "filtered-out" : ""} ${options?.extraClass ?? ""}`.trim()}
        data-testid={`settings-section-${id}`}
      >
        <div className="settings-section-head">
          <div>
            <h2>{sectionsTitleMap[id]}</h2>
            <small className="muted">{subtitle}</small>
          </div>
          <button
            type="button"
            className="ghost-btn compact-add-btn"
            onClick={() => toggleSectionCollapsed(id)}
            data-testid={`settings-section-toggle-${id}`}
          >
            {collapsed ? (lang === "ko" ? "펼치기" : "Expand") : lang === "ko" ? "접기" : "Collapse"}
          </button>
        </div>
        {collapsed ? (
          <small className="muted">
            {filtered
              ? lang === "ko"
                ? "검색어와 일치하지 않아 접힌 상태입니다."
                : "Collapsed because it does not match the current search."
              : lang === "ko"
                ? "섹션이 접혀 있습니다."
                : "Section is collapsed."}
          </small>
        ) : (
          <div className="settings-section-body">{children}</div>
        )}
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
    void loadMockDatasets();
    void loadBackups();
  }, []);

  useEffect(() => {
    const container = getScrollContainer();
    if (!container) return undefined;
    const recalc = () => {
      const containerRect = container.getBoundingClientRect();
      let bestId: SectionId = SECTION_ORDER[0];
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const id of SECTION_ORDER) {
        const section = sectionRefs.current[id];
        if (!section) continue;
        const rect = section.getBoundingClientRect();
        if (rect.bottom < containerRect.top + 72) continue;
        const distance = Math.abs(rect.top - containerRect.top - 92);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestId = id;
        }
      }
      setActiveSection((prev) => (prev === bestId ? prev : bestId));
    };
    recalc();
    container.addEventListener("scroll", recalc, { passive: true });
    window.addEventListener("resize", recalc);
    return () => {
      container.removeEventListener("scroll", recalc);
      window.removeEventListener("resize", recalc);
    };
  }, []);

  useEffect(() => {
    if (!adminOverlayOpen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAdminOverlayOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [adminOverlayOpen]);

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
    await applyCriticalPatch(updated, lang === "ko" ? "Critical settings saved" : "Critical settings saved");
    await onRefresh();
  };

  return (
    <div className="settings-shell">
      <aside className={`settings-toc ${tocOpen ? "open" : ""}`}>
        <div className="settings-toc-head">
          <strong>{lang === "ko" ? "설정 목차" : "Settings Index"}</strong>
          <small className="muted">
            {lang === "ko" ? `${filteredCount}/${sections.length} 섹션` : `${filteredCount}/${sections.length} sections`}
          </small>
        </div>
        <div className="settings-toc-list">
          {sections.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`settings-toc-item ${activeSection === item.id ? "active" : ""} ${sectionMatch[item.id] ? "" : "dim"}`}
              onClick={() => scrollToSection(item.id)}
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
                {lang === "ko"
                  ? "검색과 목차로 원하는 항목을 빠르게 찾을 수 있습니다."
                  : "Use search and index to jump to the exact setting."}
              </small>
            </div>
            <button type="button" className="ghost-btn compact-add-btn settings-mobile-toc-btn" onClick={() => setTocOpen((prev) => !prev)}>
              {tocOpen ? (lang === "ko" ? "목차 닫기" : "Hide Index") : lang === "ko" ? "목차 열기" : "Show Index"}
            </button>
          </div>
          <label>
            {lang === "ko" ? "설정 검색" : "Search Settings"}
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={lang === "ko" ? "예: backup, theme, xp..." : "e.g. backup, theme, xp..."}
              data-testid="settings-search-input"
            />
          </label>
        </section>

        {renderSection(
          "basic",
          lang === "ko" ? "프로필/언어 기본값" : "Profile and base locale",
          <>
            <label>
              Nickname
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
            </label>
            <label>
              {lang === "ko" ? "언어" : "Language"}
              <select
                value={ui.language}
                onChange={(event) => {
                  void applyBasicPatch(
                    { ui: { language: event.target.value as "ko" | "en" } as Partial<Settings["ui"]> },
                    lang === "ko" ? "언어 변경 완료" : "Language updated"
                  );
                }}
              >
                <option value="ko">Korean</option>
                <option value="en">English</option>
              </select>
            </label>
          </>
        )}

        {renderSection(
          "appearance",
          lang === "ko" ? "테마 미리보기와 선택" : "Theme gallery and selection",
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
                        `Theme changed: ${theme.name}`
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
            <div className="row">
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
                {lang === "ko" ? "공유 카드 생성" : "Generate Share Card"} {canShareCard ? "" : "(Locked)"}
              </button>
            </div>
          </>
        )}

        {renderSection(
          "soundMotion",
          lang === "ko" ? "사운드/모션" : "Sound and animation behavior",
          <>
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
                <option value="adaptive">Adaptive</option>
                <option value="low">Low</option>
                <option value="high">High</option>
              </select>
            </label>
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
                  <option value="mini">Mini</option>
                  <option value="none">{lang === "ko" ? "사용 안 함" : "Off"}</option>
                </select>
              </label>
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
          "dashboard",
          lang === "ko" ? "대시보드" : "Dashboard visual options",
          <small className="muted">
            {lang === "ko"
              ? "대시보드 구성 전환/배치는 대시보드 화면에서 직접 변경하세요."
              : "Use the Dashboard page for layout/version switching."}
          </small>
        )}

        {renderSection(
          "goals",
          lang === "ko" ? "목표/성장" : "Weekly/monthly and XP goals",
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
        )}

        {renderSection(
          "quests",
          lang === "ko" ? "퀘스트 자동 생성 규칙" : "Quest auto-generation rules",
          <>
            <div className="song-form-grid">
              {periodKeys.map((period) => (
                <div key={`quest-setting-${period}`} className="quest-setting-box">
                  <strong>
                    {period === "short"
                      ? lang === "ko"
                        ? "단기"
                        : "Short"
                      : period === "mid"
                        ? lang === "ko"
                          ? "중기"
                          : "Mid"
                        : lang === "ko"
                          ? "장기"
                          : "Long"}
                  </strong>
                  <label>
                    {lang === "ko" ? "기간(일)" : "Period Days"}
                    <input
                      type="number"
                      min={1}
                      value={questForm.period_days[period]}
                      onChange={(event) =>
                        updateQuestForm((prev) => ({
                          ...prev,
                          period_days: { ...prev.period_days, [period]: Number(event.target.value || 1) },
                        }))
                      }
                    />
                  </label>
                  <label className="inline">
                    <input
                      type="checkbox"
                      checked={questForm.auto_enabled_by_period[period]}
                      onChange={(event) =>
                        updateQuestForm((prev) => ({
                          ...prev,
                          auto_enabled_by_period: { ...prev.auto_enabled_by_period, [period]: event.target.checked },
                        }))
                      }
                    />
                    <span>{lang === "ko" ? "자동 생성 사용" : "Enable auto quest"}</span>
                  </label>
                  <label>
                    {lang === "ko" ? "자동 목표(분)" : "Auto Target Minutes"}
                    <input
                      type="number"
                      min={1}
                      value={questForm.auto_target_minutes_by_period[period]}
                      onChange={(event) =>
                        updateQuestForm((prev) => ({
                          ...prev,
                          auto_target_minutes_by_period: {
                            ...prev.auto_target_minutes_by_period,
                            [period]: Number(event.target.value || 1),
                          },
                        }))
                      }
                    />
                  </label>
                  <label>
                    {lang === "ko" ? "자동 중요도" : "Auto Priority"}
                    <select
                      value={questForm.auto_priority_by_period[period]}
                      onChange={(event) =>
                        updateQuestForm((prev) => ({
                          ...prev,
                          auto_priority_by_period: {
                            ...prev.auto_priority_by_period,
                            [period]: event.target.value as "low" | "normal" | "urgent",
                          },
                        }))
                      }
                    >
                      <option value="urgent">{questPriorityLabel("urgent")}</option>
                      <option value="normal">{questPriorityLabel("normal")}</option>
                      <option value="low">{questPriorityLabel("low")}</option>
                    </select>
                  </label>
                  <label>
                    {lang === "ko" ? "자동 난이도" : "Auto Difficulty"}
                    <select
                      value={questForm.auto_difficulty_by_period[period]}
                      onChange={(event) =>
                        updateQuestForm((prev) => ({
                          ...prev,
                          auto_difficulty_by_period: {
                            ...prev.auto_difficulty_by_period,
                            [period]: event.target.value as "low" | "mid" | "high",
                          },
                        }))
                      }
                    >
                      <option value="high">{questDifficultyLabel("high")}</option>
                      <option value="mid">{questDifficultyLabel("mid")}</option>
                      <option value="low">{questDifficultyLabel("low")}</option>
                    </select>
                  </label>
                </div>
              ))}
            </div>
            <div className="row">
              <small className="muted">{questSaving ? (lang === "ko" ? "퀘스트 설정 저장 중..." : "Saving quest settings...") : ""}</small>
              <button className="ghost-btn" onClick={() => void saveQuestSettings(false)}>
                {lang === "ko" ? "지금 저장" : "Save now"}
              </button>
            </div>
          </>
        )}

        {renderSection(
          "design",
          lang === "ko" ? "색상/디자인 커스터마이즈" : "Color and design customization",
          <>
            <div className="song-form-grid">
              <div className="quest-setting-box">
                <strong>{lang === "ko" ? "퀘스트 기간 레인 색상" : "Quest period lane colors"}</strong>
                {periodKeys.map((period) => (
                  <div key={`period-color-${period}`} className="row">
                    <span>
                      {period === "short" ? (lang === "ko" ? "단기" : "Short") : period === "mid" ? (lang === "ko" ? "중기" : "Mid") : lang === "ko" ? "장기" : "Long"}
                    </span>
                    {renderColorInput(lang === "ko" ? "테두리" : "Border", questForm.ui_style.period_border[period], (value) =>
                      updateQuestForm((prev) => ({
                        ...prev,
                        ui_style: {
                          ...prev.ui_style,
                          period_border: { ...prev.ui_style.period_border, [period]: value },
                        },
                      }))
                    )}
                    {renderColorInput(lang === "ko" ? "배경" : "Fill", questForm.ui_style.period_fill[period], (value) =>
                      updateQuestForm((prev) => ({
                        ...prev,
                        ui_style: {
                          ...prev.ui_style,
                          period_fill: { ...prev.ui_style.period_fill, [period]: value },
                        },
                      }))
                    )}
                  </div>
                ))}
              </div>

              <div className="quest-setting-box">
                <strong>{lang === "ko" ? "중요도/난이도 색상" : "Priority / Difficulty colors"}</strong>
                {(["urgent", "normal", "low"] as const).map((key) => (
                  <div key={`priority-color-${key}`}>
                    {renderColorInput(lang === "ko" ? `중요도 (${questPriorityLabel(key)})` : `Priority (${questPriorityLabel(key)})`, questForm.ui_style.priority_border[key], (value) =>
                      updateQuestForm((prev) => ({
                        ...prev,
                        ui_style: {
                          ...prev.ui_style,
                          priority_border: { ...prev.ui_style.priority_border, [key]: value },
                        },
                      }))
                    )}
                  </div>
                ))}
                {(["low", "mid", "high"] as const).map((key) => (
                  <div key={`difficulty-color-${key}`}>
                    {renderColorInput(lang === "ko" ? `난이도 (${questDifficultyLabel(key)})` : `Difficulty (${questDifficultyLabel(key)})`, questForm.ui_style.difficulty_fill[key], (value) =>
                      updateQuestForm((prev) => ({
                        ...prev,
                        ui_style: {
                          ...prev.ui_style,
                          difficulty_fill: { ...prev.ui_style.difficulty_fill, [key]: value },
                        },
                      }))
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="quest-setting-box">
              <strong>{lang === "ko" ? "일반 UI 옵션" : "General UI options"}</strong>
              <div className="song-form-grid">
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={Boolean(settings.ui.dashboard_glass_cards ?? true)}
                    onChange={(event) => {
                      void applyBasicPatch({
                        ui: { dashboard_glass_cards: event.target.checked } as Partial<Settings["ui"]>,
                      });
                    }}
                  />
                  <span>{lang === "ko" ? "대시보드 글래스 카드" : "Dashboard glass cards"}</span>
                </label>
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={Boolean(ui.fx_level_up_overlay ?? ui.enable_confetti ?? true)}
                    onChange={(event) => {
                      void applyBasicPatch({
                        ui: {
                          enable_confetti: event.target.checked,
                          fx_level_up_overlay: event.target.checked,
                        } as Partial<Settings["ui"]>,
                      });
                    }}
                  />
                  <span>{lang === "ko" ? "레벨업 컨페티 효과" : "Level-up confetti"}</span>
                </label>
              </div>
            </div>

            <div className="quest-setting-box">
              <div className="row">
                <strong>{lang === "ko" ? "업적 카드 색상" : "Achievement card palette"}</strong>
                <button className="ghost-btn compact-add-btn" onClick={resetAchievementCardStyles}>
                  {lang === "ko" ? "기본값 복원" : "Reset defaults"}
                </button>
              </div>
              <div className="settings-achievement-style-grid">
                {ACHIEVEMENT_STYLE_EDITOR_KEYS.map((key) => (
                  <div key={key} className="settings-achievement-style-item">
                    <strong>{ACHIEVEMENT_STYLE_LABELS[key][lang]}</strong>
                    {renderColorInput(lang === "ko" ? "테두리" : "Border", achievementStyleMap[key].border, (value) =>
                      updateAchievementCardStyle(key, "border", value)
                    )}
                    {renderColorInput(lang === "ko" ? "배경" : "Fill", achievementStyleMap[key].fill, (value) =>
                      updateAchievementCardStyle(key, "fill", value)
                    )}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {renderSection(
          "library",
          lang === "ko" ? "장르/상위 유형 관리" : "Genre and parent-group management",
          <>
            <div className="tag-help">
              <strong>{lang === "ko" ? "추천곡/곡 라이브러리 공통 장르 카탈로그" : "Shared genre catalog for songs and recommendations"}</strong>
              <small className="muted">
                {lang === "ko"
                  ? "장르 추가/삭제, 상위유형(그룹) 이동/추가/수정, 장르명 일괄 변경이 가능합니다."
                  : "Add/remove genres, edit parent groups, and rename genres globally."}
              </small>
            </div>

            <div className="song-form-grid settings-genre-manage-grid">
              <label>
                {lang === "ko" ? "새 그룹 이름" : "New group name"}
                <input
                  value={newGenreGroupName}
                  onChange={(event) => setNewGenreGroupName(event.target.value)}
                  placeholder={lang === "ko" ? "예: 팝/가요" : "e.g. Pop / K-pop"}
                />
              </label>
              <div className="row">
                <button className="ghost-btn" onClick={() => void addGenreGroup()}>
                  {lang === "ko" ? "그룹 추가" : "Add group"}
                </button>
                <button className="ghost-btn" onClick={() => void resetGenreCatalog()}>
                  {lang === "ko" ? "기본값 복원" : "Reset defaults"}
                </button>
              </div>
            </div>

            <div className="song-form-grid settings-genre-manage-grid">
              <label>
                {lang === "ko" ? "새 장르" : "New genre"}
                <input
                  value={newGenre}
                  onChange={(event) => setNewGenre(event.target.value)}
                  placeholder={lang === "ko" ? "예: Ballad" : "e.g. Ballad"}
                />
              </label>
              <label>
                {lang === "ko" ? "추가할 그룹" : "Target group"}
                <select value={newGenreTargetGroup} onChange={(event) => setNewGenreTargetGroup(event.target.value)}>
                  {genreGroupNames.map((name) => (
                    <option key={`genre-target-${name}`} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="row">
                <button className="ghost-btn" onClick={() => void addGenreToGroup()}>
                  {lang === "ko" ? "장르 추가" : "Add genre"}
                </button>
              </div>
            </div>

            <div className="settings-genre-group-admin-list">
              {currentGenreGroups.map((group) => (
                <section key={`genre-group-${group.name}`} className="settings-genre-group-admin">
                  <div className="settings-genre-group-admin-head">
                    <div>
                      <strong>{group.name}</strong>
                      <small className="muted">
                        {lang === "ko" ? `${group.values.length}개 장르` : `${group.values.length} genres`}
                      </small>
                    </div>
                    <div className="row">
                      <button className="ghost-btn compact-add-btn" onClick={() => void renameGenreGroup(group.name)}>
                        {lang === "ko" ? "이름 변경" : "Rename"}
                      </button>
                      <button
                        className="ghost-btn compact-add-btn danger-border"
                        disabled={currentGenreGroups.length <= 1}
                        onClick={() => void deleteGenreGroup(group.name)}
                      >
                        {lang === "ko" ? "그룹 삭제" : "Delete group"}
                      </button>
                    </div>
                  </div>

                  {group.values.length ? (
                    <div className="settings-genre-chip-grid settings-genre-chip-grid-admin">
                      {group.values.map((genre) => (
                        <div key={`${group.name}-${genre}`} className="settings-genre-chip settings-genre-chip-edit">
                          <span>{genre}</span>
                          <select
                            value={genreToGroupMap.get(genre.toLowerCase()) ?? group.name}
                            onChange={(event) => void moveGenreToGroup(genre, event.target.value)}
                          >
                            {genreGroupNames.map((name) => (
                              <option key={`genre-move-${genre}-${name}`} value={name}>
                                {name}
                              </option>
                            ))}
                          </select>
                          <button className="ghost-btn compact-add-btn" onClick={() => void renameGenreEverywhere(genre)}>
                            {lang === "ko" ? "이름변경" : "Rename"}
                          </button>
                          <button className="ghost-btn compact-add-btn danger-border" onClick={() => void removeGenreFromPool(genre)}>
                            {lang === "ko" ? "제거" : "Remove"}
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <small className="muted">{lang === "ko" ? "아직 장르가 없습니다." : "No genres in this group yet."}</small>
                  )}
                </section>
              ))}
            </div>
          </>
        )}

        {renderSection(
          "dataBackup",
          lang === "ko" ? "내보내기/백업 정책/복원" : "Export, backup policy and restore",
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
              <label>
                {lang === "ko" ? "최대 백업 파일 수" : "Max backup files"}
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
                {lang === "ko" ? "백업 최소 간격(시간)" : "Min interval between backups (hours)"}
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
          "mock",
          lang === "ko" ? "테스트용 모의 데이터셋 (저강조)" : "Sandbox datasets for testing (low priority)",
          <>
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
                        ? `샌드박스 데이터셋 저장 완료: ${result.dataset_id} (${result.generated_sessions}개 세션 생성)`
                        : `Sandbox dataset exported: ${result.dataset_id} (${result.generated_sessions} sessions)`
                    );
                  } finally {
                    setMockExportBusy(false);
                  }
                }}
              >
                {lang === "ko" ? "현재 상태를 샌드박스로 저장 (+60일 세션)" : "Export current state (+60d sessions)"}
              </button>
            </div>
          </>,
          { lowEmphasis: true }
        )}

        {renderSection(
          "misc",
          lang === "ko" ? "해금 정보" : "Unlock information",
          <div className="unlock-list">
            {unlockables.map((item) => (
              <div key={String(item.unlock_id)} className={`unlock-item ${item.unlocked ? "on" : "off"}`}>
                <div>
                  <strong>{normalizeGoalText(String(item.name))}</strong>
                  <small>
                    Lv.{String(item.level_required)} · {String(item.type)}
                  </small>
                </div>
                <span>{item.unlocked ? "Unlocked" : "Locked"}</span>
              </div>
            ))}
          </div>
        )}

        {renderSection(
          "developer",
          lang === "ko" ? "실험/개발자 설정" : "Experimental / developer settings",
          <>
            <small className="muted">
              {lang === "ko"
                ? "아래 항목은 향후 실험 기능용입니다. 현재 동작에 즉시 반영되지 않을 수 있습니다."
                : "These are experimental/future keys and may not immediately affect runtime behavior."}
            </small>
            <div className="song-form-grid">
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
              <label className="inline">
                <input
                  type="checkbox"
                  checked={adminConfig.gate_enabled}
                  onChange={(event) => {
                    void applyCriticalPatch({
                      admin: { ...adminConfig, gate_enabled: event.target.checked },
                    });
                  }}
                />
                <span>admin.gate_enabled</span>
              </label>
              <label>
                admin.pin_hash
                <input
                  value={adminConfig.pin_hash}
                  onChange={(event) => {
                    void applyCriticalPatch({
                      admin: { ...adminConfig, pin_hash: event.target.value },
                    });
                  }}
                />
              </label>
            </div>
            <div className="row">
              <button className="ghost-btn" onClick={() => setAchievementManagerOpen(true)}>
                {lang === "ko" ? "업적 관리자 열기" : "Open Achievement Manager"}
              </button>
            </div>
          </>
        )}

        <section className="settings-admin-launch-card">
          <button
            className="ghost-btn danger-border"
            data-testid="admin-overlay-open-btn"
            onClick={() => setAdminOverlayOpen(true)}
          >
            {lang === "ko" ? "관리자/초기화 열기" : "Open Admin / Reset"}
          </button>
        </section>
      </div>

      {adminOverlayOpen ? (
        <div className="modal-backdrop settings-admin-backdrop" data-testid="admin-overlay">
          <div className="modal settings-admin-modal" onClick={(event) => event.stopPropagation()}>
            <div className="settings-admin-head">
              <div>
                <h2>{lang === "ko" ? "Critical / 초기화" : "Critical / Reset"}</h2>
                <small className="muted">
                  {lang === "ko"
                    ? "각 파라미터 의미를 확인한 뒤 저장하세요."
                    : "Review each parameter meaning before saving."}
                </small>
              </div>
              <button className="ghost-btn compact-add-btn" onClick={() => setAdminOverlayOpen(false)}>
                {lang === "ko" ? "닫기" : "Close"}
              </button>
            </div>

            <section className="settings-admin-panel">
              <h3>{lang === "ko" ? "Critical Balance" : "Critical Balance"}</h3>
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
              <button className="primary-btn" onClick={() => void saveCriticalBalance()}>
                {lang === "ko" ? "Critical 저장" : "Save Critical Settings"}
              </button>
            </section>

            <section className="settings-admin-panel">
              <h3>{lang === "ko" ? "테스트 / 초기화" : "Testing / Reset"}</h3>
              <div className="row">
                <button
                  className="ghost-btn"
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
                <button
                  className="ghost-btn danger-border"
                  onClick={async () => {
                    const ok = window.confirm(
                      lang === "ko" ? "XP/레벨 기록을 초기화할까요?" : "Reset XP/level progress?"
                    );
                    if (!ok) return;
                    try {
                      await adminResetProgress();
                      setMessage(lang === "ko" ? "진행도 초기화 완료" : "Progress reset complete");
                      await onRefresh();
                    } catch (error) {
                      setMessage(
                        getErrorMessage(error, lang === "ko" ? "진행도 초기화 실패" : "Failed to reset progress")
                      );
                    }
                  }}
                >
                  {lang === "ko" ? "레벨/XP 초기화" : "Reset XP/Level"}
                </button>
                <button
                  className="ghost-btn danger-border"
                  onClick={async () => {
                    const first = window.confirm(
                      lang === "ko"
                        ? "정말 전체 초기화할까요? (세션/미디어/설정)"
                        : "Reset everything? (sessions/media/settings)"
                    );
                    if (!first) return;
                    const token = window.prompt(
                      lang === "ko"
                        ? "전체 초기화를 계속하려면 RESET ALL 을 입력하세요."
                        : "Type RESET ALL to continue full reset."
                    );
                    if ((token || "").trim().toUpperCase() !== "RESET ALL") {
                      setMessage(lang === "ko" ? "전체 초기화 취소됨" : "Full reset cancelled");
                      return;
                    }
                    try {
                      await adminResetAll();
                      setMessage(lang === "ko" ? "전체 초기화 완료" : "Full reset complete");
                      await onRefresh();
                      setAdminOverlayOpen(false);
                    } catch (error) {
                      setMessage(getErrorMessage(error, lang === "ko" ? "전체 초기화 실패" : "Full reset failed"));
                    }
                  }}
                >
                  {lang === "ko" ? "전체 초기화" : "Full Reset"}
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
