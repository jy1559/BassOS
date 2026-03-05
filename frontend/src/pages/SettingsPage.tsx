import { useEffect, useMemo, useState } from "react";
import {
  activateMockData,
  adminGrantXp,
  adminResetAll,
  adminResetProgress,
  createExport,
  deactivateMockData,
  exportCurrentToMockDataset,
  getMockDatasets,
  getMockDataStatus,
  putBasicSettings,
  putCriticalSettings,
} from "../api";
import type { Lang } from "../i18n";
import type { DashboardLayoutItem, HudSummary, MockDataStatus, MockDatasetInfo, Settings } from "../types/models";
import { AchievementAdminPanel } from "./settings/AchievementAdminPanel";

type TutorialSummary = {
  core_completed: boolean;
  core_resume_step_index: number;
  deep_dive_options: Array<{ id: string; label: string }>;
  guide_finisher_unlocked: boolean;
};

type Props = {
  lang: Lang;
  settings: Settings;
  hud: HudSummary;
  unlockables: Array<Record<string, unknown>>;
  onSettingsChange: (settings: Settings) => void;
  setMessage: (message: string) => void;
  onRefresh: () => Promise<void>;
  tutorialSummary: TutorialSummary;
  onStartTutorial: (campaignId: string, resume: boolean) => void;
};

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

function normalizeGoalText(text: string, _lang: Lang): string {
  return text;
}

type DashboardVersion = "legacy" | "focus";
type DashboardWidgetKey = "hud" | "timer" | "progress" | "nextWin" | "photo" | "songShortcut" | "achievements";

const DASHBOARD_WIDGET_KEYS: DashboardWidgetKey[] = [
  "hud",
  "timer",
  "progress",
  "nextWin",
  "photo",
  "songShortcut",
  "achievements",
];

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

export function SettingsPage({
  lang,
  settings,
  hud,
  unlockables,
  onSettingsChange,
  setMessage,
  onRefresh,
  tutorialSummary,
  onStartTutorial,
}: Props) {
  type QuestSettingsForm = {
    period_days: { short: number; mid: number; long: number };
    auto_enabled_by_period: { short: boolean; mid: boolean; long: boolean };
    auto_target_minutes_by_period: { short: number; mid: number; long: number };
    auto_priority_by_period: { short: "low" | "normal" | "urgent"; mid: "low" | "normal" | "urgent"; long: "low" | "normal" | "urgent" };
    auto_difficulty_by_period: { short: "low" | "mid" | "high"; mid: "low" | "mid" | "high"; long: "low" | "mid" | "high" };
    ui_style: {
      period_border: { short: string; mid: string; long: string };
      period_fill: { short: string; mid: string; long: string };
      priority_border: { urgent: string; normal: string; low: string };
      difficulty_fill: { low: string; mid: string; high: string };
    };
  };
  const periodKeys: Array<"short" | "mid" | "long"> = ["short", "mid", "long"];
  const questPriorityLabel = (key: "low" | "normal" | "urgent") => {
    if (lang !== "ko") return key === "urgent" ? "Top" : key === "normal" ? "Normal" : "Relax";
    return key === "urgent" ? "우선" : key === "normal" ? "보통" : "느긋";
  };
  const questDifficultyLabel = (key: "low" | "mid" | "high") => {
    if (lang !== "ko") return key === "high" ? "High (上)" : key === "mid" ? "Mid (中)" : "Low (下)";
    return key === "high" ? "上" : key === "mid" ? "中" : "下";
  };
  const canShareCard = isUnlocked(unlockables, "공유 카드");
  const themeUnlock: Record<string, number> = {
    studio: 1,
    dark: 2,
    jazz: 9,
    neon: 12,
    sunset: 16,
    forest: 22,
    ocean: 26,
    midnight: 30,
    candy: 34,
    volcanic: 40
  };

  const xp = (settings.xp as Record<string, unknown>) ?? {};
  const session = (xp.session as Record<string, unknown>) ?? {};
  const critical = (settings.critical as Record<string, unknown>) ?? {};
  const levelCurve = (settings.level_curve as Record<string, unknown>) ?? {};
  const dashboardVersion: DashboardVersion =
    settings.ui.dashboard_version === "legacy" || settings.ui.dashboard_version === "focus"
      ? settings.ui.dashboard_version
      : settings.profile.onboarded
      ? "legacy"
      : "focus";

  const [criticalForm, setCriticalForm] = useState({
    start_bonus: Number(session.start_bonus ?? 20),
    per_10min: Number(session.per_10min ?? 14),
    max_base_xp: Number(session.max_base_xp ?? 100),
    backfill_multiplier_default: Number(critical.backfill_multiplier_default ?? 0.5),
    achievement_xp_multiplier: Number(critical.achievement_xp_multiplier ?? 0.15),
    quest_xp_multiplier: Number(critical.quest_xp_multiplier ?? 0.06),
    a: Number(levelCurve.a ?? 230),
    b: Number(levelCurve.b ?? 13),
    c: Number(levelCurve.c ?? 1.1),
    max_level: Number(levelCurve.max_level ?? 50)
  });
  const [mockDatasets, setMockDatasets] = useState<MockDatasetInfo[]>([]);
  const [mockStatus, setMockStatus] = useState<MockDataStatus>({ active: false, profile: "real", dataset_id: null });
  const [selectedMockDataset, setSelectedMockDataset] = useState("");
  const [mockBusy, setMockBusy] = useState(false);
  const [mockExportBusy, setMockExportBusy] = useState(false);
  const [mockExportDatasetId, setMockExportDatasetId] = useState(
    `snapshot_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`
  );
  const [selectedDeepDive, setSelectedDeepDive] = useState(tutorialSummary.deep_dive_options[0]?.id ?? "");
  const [criticalTab, setCriticalTab] = useState<"balance">("balance");
  const [achievementManagerOpen, setAchievementManagerOpen] = useState(false);
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
  const [dashboardLayoutDraft, setDashboardLayoutDraft] = useState<Record<DashboardWidgetKey, DashboardLayoutItem>>(
    normalizeDashboardLayout(
      dashboardVersion === "focus" ? settings.ui.dashboard_layout_focus : settings.ui.dashboard_layout_legacy,
      dashboardVersion
    )
  );

  useEffect(() => {
    setCriticalForm({
      start_bonus: Number(session.start_bonus ?? 20),
      per_10min: Number(session.per_10min ?? 14),
      max_base_xp: Number(session.max_base_xp ?? 100),
      backfill_multiplier_default: Number(critical.backfill_multiplier_default ?? 0.5),
      achievement_xp_multiplier: Number(critical.achievement_xp_multiplier ?? 0.15),
      quest_xp_multiplier: Number(critical.quest_xp_multiplier ?? 0.06),
      a: Number(levelCurve.a ?? 230),
      b: Number(levelCurve.b ?? 13),
      c: Number(levelCurve.c ?? 1.1),
      max_level: Number(levelCurve.max_level ?? 50)
    });
  }, [session.start_bonus, session.per_10min, session.max_base_xp, critical.backfill_multiplier_default, critical.achievement_xp_multiplier, critical.quest_xp_multiplier, levelCurve.a, levelCurve.b, levelCurve.c, levelCurve.max_level]);

  useEffect(() => {
    const loadMock = async () => {
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
    void loadMock();
  }, []);

  useEffect(() => {
    if (!selectedDeepDive && tutorialSummary.deep_dive_options.length > 0) {
      setSelectedDeepDive(tutorialSummary.deep_dive_options[0].id);
    }
  }, [selectedDeepDive, tutorialSummary.deep_dive_options]);

  useEffect(() => {
    const raw = settings.profile.quest_settings || {};
    const normalizeColor = (value: unknown, fallback: string) => {
      const token = String(value || "").trim();
      return /^#[0-9a-fA-F]{6}$/.test(token) ? token : fallback;
    };
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
          short: normalizeColor(raw.ui_style?.period_border?.short, "#44728a"),
          mid: normalizeColor(raw.ui_style?.period_border?.mid, "#5e6f8f"),
          long: normalizeColor(raw.ui_style?.period_border?.long, "#6e5f8d"),
        },
        period_fill: {
          short: normalizeColor(raw.ui_style?.period_fill?.short, "#e7f5ff"),
          mid: normalizeColor(raw.ui_style?.period_fill?.mid, "#eef2ff"),
          long: normalizeColor(raw.ui_style?.period_fill?.long, "#f4efff"),
        },
        priority_border: {
          urgent: normalizeColor(raw.ui_style?.priority_border?.urgent, "#d8664a"),
          normal: normalizeColor(raw.ui_style?.priority_border?.normal, "#4f8bc4"),
          low: normalizeColor(raw.ui_style?.priority_border?.low, "#6b8892"),
        },
        difficulty_fill: {
          low: normalizeColor(raw.ui_style?.difficulty_fill?.low, "#eef8f5"),
          mid: normalizeColor(raw.ui_style?.difficulty_fill?.mid, "#eef2ff"),
          high: normalizeColor(raw.ui_style?.difficulty_fill?.high, "#fff0f1"),
        },
      },
    });
  }, [settings.profile.quest_settings]);

  useEffect(() => {
    const activeLayout =
      dashboardVersion === "focus" ? settings.ui.dashboard_layout_focus : settings.ui.dashboard_layout_legacy;
    setDashboardLayoutDraft(normalizeDashboardLayout(activeLayout, dashboardVersion));
  }, [dashboardVersion, settings.ui.dashboard_layout_focus, settings.ui.dashboard_layout_legacy]);

  const xpToMax = useMemo(() => {
    const maxLevel = Math.max(2, Math.round(criticalForm.max_level));
    const a = criticalForm.a;
    const b = criticalForm.b;
    const c = criticalForm.c;
    let total = 0;
    for (let level = 1; level < maxLevel; level += 1) {
      const n = level - 1;
      total += Math.max(1, Math.round(a + b * n + c * n * n));
    }
    return total;
  }, [criticalForm.a, criticalForm.b, criticalForm.c, criticalForm.max_level]);

  const baseline30m = useMemo(() => {
    const base = criticalForm.start_bonus + criticalForm.per_10min * 3;
    return Math.min(criticalForm.max_base_xp, base);
  }, [criticalForm.start_bonus, criticalForm.per_10min, criticalForm.max_base_xp]);

  const grantToNext = Math.max(0, hud.xp_to_next - hud.current_level_xp);

  const saveQuestSettings = async () => {
    const normalizeHex = (value: string, fallback: string) => (/^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback);
    const sanitized = {
      period_days: {
        short: Math.max(1, Math.round(Number(questForm.period_days.short || 1))),
        mid: Math.max(1, Math.round(Number(questForm.period_days.mid || 1))),
        long: Math.max(1, Math.round(Number(questForm.period_days.long || 1))),
      },
      auto_enabled_by_period: {
        short: Boolean(questForm.auto_enabled_by_period.short),
        mid: Boolean(questForm.auto_enabled_by_period.mid),
        long: Boolean(questForm.auto_enabled_by_period.long),
      },
      auto_target_minutes_by_period: {
        short: Math.max(1, Math.round(Number(questForm.auto_target_minutes_by_period.short || 1))),
        mid: Math.max(1, Math.round(Number(questForm.auto_target_minutes_by_period.mid || 1))),
        long: Math.max(1, Math.round(Number(questForm.auto_target_minutes_by_period.long || 1))),
      },
      auto_priority_by_period: {
        short: questForm.auto_priority_by_period.short,
        mid: questForm.auto_priority_by_period.mid,
        long: questForm.auto_priority_by_period.long,
      },
      auto_difficulty_by_period: {
        short: questForm.auto_difficulty_by_period.short,
        mid: questForm.auto_difficulty_by_period.mid,
        long: questForm.auto_difficulty_by_period.long,
      },
      ui_style: {
        period_border: {
          short: normalizeHex(questForm.ui_style.period_border.short, "#44728a"),
          mid: normalizeHex(questForm.ui_style.period_border.mid, "#5e6f8f"),
          long: normalizeHex(questForm.ui_style.period_border.long, "#6e5f8d"),
        },
        period_fill: {
          short: normalizeHex(questForm.ui_style.period_fill.short, "#e7f5ff"),
          mid: normalizeHex(questForm.ui_style.period_fill.mid, "#eef2ff"),
          long: normalizeHex(questForm.ui_style.period_fill.long, "#f4efff"),
        },
        priority_border: {
          urgent: normalizeHex(questForm.ui_style.priority_border.urgent, "#d8664a"),
          normal: normalizeHex(questForm.ui_style.priority_border.normal, "#4f8bc4"),
          low: normalizeHex(questForm.ui_style.priority_border.low, "#6b8892"),
        },
        difficulty_fill: {
          low: normalizeHex(questForm.ui_style.difficulty_fill.low, "#eef8f5"),
          mid: normalizeHex(questForm.ui_style.difficulty_fill.mid, "#eef2ff"),
          high: normalizeHex(questForm.ui_style.difficulty_fill.high, "#fff0f1"),
        },
      },
    };
    const updated = await putBasicSettings({
      profile: {
        ...settings.profile,
        quest_settings: sanitized,
      },
    });
    onSettingsChange(updated);
    setMessage(lang === "ko" ? "퀘스트 설정 저장 완료" : "Quest settings saved");
  };

  const updateDashboardLayoutDraft = (key: DashboardWidgetKey, patch: Partial<DashboardLayoutItem>) => {
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
    setDashboardLayoutDraft(normalizeDashboardLayout({}, dashboardVersion));
  };

  const saveDashboardLayoutDraft = async () => {
    const normalized = normalizeDashboardLayout(dashboardLayoutDraft, dashboardVersion);
    const updated = await putBasicSettings({
      ui: {
        ...settings.ui,
        dashboard_layout_legacy: dashboardVersion === "legacy" ? normalized : settings.ui.dashboard_layout_legacy,
        dashboard_layout_focus: dashboardVersion === "focus" ? normalized : settings.ui.dashboard_layout_focus,
      },
    });
    onSettingsChange(updated);
    setMessage(lang === "ko" ? "대시보드 배치 저장 완료" : "Dashboard layout saved");
  };

  return (
    <div className="page-grid settings-grid">
      <section className="card">
        <div className="row">
          <h2>{lang === "ko" ? "기본 설정" : "Basic Settings"}</h2>
          <button
            className="ghost-btn"
            onClick={async () => {
              try {
                const result = await createExport();
                setMessage(
                  lang === "ko" ? `내보내기 완료: ${result.file}` : `Export created: ${result.file}`
                );
              } catch (error) {
                setMessage(error instanceof Error ? error.message : "Export failed");
              }
            }}
          >
            {lang === "ko" ? "데이터 내보내기" : "Export Data"}
          </button>
        </div>
        <label>
          Nickname
          <input
            type="text"
            value={settings.profile.nickname}
            onChange={async (event) => {
              const updated = await putBasicSettings({
                profile: { ...settings.profile, nickname: event.target.value }
              });
              onSettingsChange(updated);
            }}
          />
        </label>
        <label className="inline">
          <input
            type="checkbox"
            checked={Boolean(settings.audio.enabled)}
            onChange={async (event) => {
              const updated = await putBasicSettings({
                audio: { ...settings.audio, enabled: event.target.checked }
              });
              onSettingsChange(updated);
            }}
          />
          Sound Enabled
        </label>
        <label>
          Theme
          <select
            value={settings.ui.default_theme}
            onChange={async (event) => {
              const nextTheme = event.target.value;
              const updated = await putBasicSettings({
                ui: { ...settings.ui, default_theme: nextTheme }
              });
              onSettingsChange(updated);
              setMessage(`테마 변경: ${nextTheme}`);
            }}
          >
            <option value="studio">Studio (기본)</option>
            <option value="dark" disabled={hud.level < themeUnlock.dark}>Dark {hud.level >= themeUnlock.dark ? "" : `(Lv.${themeUnlock.dark})`}</option>
            <option value="jazz" disabled={hud.level < themeUnlock.jazz}>Jazz Lounge {hud.level >= themeUnlock.jazz ? "" : `(Lv.${themeUnlock.jazz})`}</option>
            <option value="neon" disabled={hud.level < themeUnlock.neon}>Neon {hud.level >= themeUnlock.neon ? "" : `(Lv.${themeUnlock.neon})`}</option>
            <option value="sunset" disabled={hud.level < themeUnlock.sunset}>Sunset Punch {hud.level >= themeUnlock.sunset ? "" : `(Lv.${themeUnlock.sunset})`}</option>
            <option value="forest" disabled={hud.level < themeUnlock.forest}>Forest Groove {hud.level >= themeUnlock.forest ? "" : `(Lv.${themeUnlock.forest})`}</option>
            <option value="ocean" disabled={hud.level < themeUnlock.ocean}>Ocean Drive {hud.level >= themeUnlock.ocean ? "" : `(Lv.${themeUnlock.ocean})`}</option>
            <option value="midnight" disabled={hud.level < themeUnlock.midnight}>Midnight Pulse {hud.level >= themeUnlock.midnight ? "" : `(Lv.${themeUnlock.midnight})`}</option>
            <option value="candy" disabled={hud.level < themeUnlock.candy}>Candy Pop {hud.level >= themeUnlock.candy ? "" : `(Lv.${themeUnlock.candy})`}</option>
            <option value="volcanic" disabled={hud.level < themeUnlock.volcanic}>Volcanic Ember {hud.level >= themeUnlock.volcanic ? "" : `(Lv.${themeUnlock.volcanic})`}</option>
          </select>
        </label>
        <label>
          {lang === "ko" ? "대시보드 버전" : "Dashboard Version"}
          <select
            value={dashboardVersion}
            onChange={async (event) => {
              const next = event.target.value as "legacy" | "focus";
              const updated = await putBasicSettings({
                ui: { ...settings.ui, dashboard_version: next }
              });
              onSettingsChange(updated);
            }}
          >
            <option value="legacy">{lang === "ko" ? "Legacy (기존 HUD 중심)" : "Legacy (HUD-first)"}</option>
            <option value="focus">{lang === "ko" ? "Focus (실행 허브)" : "Focus (Execution Hub)"}</option>
          </select>
        </label>
        <label className="inline">
          <input
            type="checkbox"
            checked={Boolean(settings.ui.dashboard_glass_cards ?? true)}
            onChange={async (event) => {
              const updated = await putBasicSettings({
                ui: { ...settings.ui, dashboard_glass_cards: event.target.checked }
              });
              onSettingsChange(updated);
            }}
          />
          {lang === "ko" ? "대시보드 카드 반투명(글래스)" : "Glass cards on dashboard"}
        </label>
        <div className="tag-help">
          <strong>{lang === "ko" ? "대시보드 배치 (고급)" : "Dashboard Layout (Advanced)"}</strong>
          <small className="muted">
            {lang === "ko"
              ? "현재 버전 레이아웃만 수정됩니다. HUD/타이머는 항상 표시되고 Focus의 Quest Center 높이는 1로 고정됩니다."
              : "Only the active dashboard version is edited. HUD/Timer stay visible and Focus Quest Center height is fixed to 1."}
          </small>
        </div>
        <div className="dashboard-layout-editor settings-dashboard-layout-editor">
          {DASHBOARD_WIDGET_KEYS.map((key) => {
            const item = dashboardLayoutDraft[key];
            const locked = key === "hud" || key === "timer";
            const lockHeight = dashboardVersion === "focus" && key === "nextWin";
            return (
              <div key={key} className="dashboard-layout-row">
                <strong>{dashboardWidgetLabel(key, lang)}</strong>
                <label className="inline">
                  <input
                    type="checkbox"
                    disabled={locked}
                    checked={locked ? true : item.visible}
                    onChange={(event) => updateDashboardLayoutDraft(key, { visible: event.target.checked })}
                  />
                  {locked ? (lang === "ko" ? "고정" : "Locked") : (lang === "ko" ? "표시" : "Visible")}
                </label>
                <label>
                  X
                  <input
                    type="number"
                    min={1}
                    max={3}
                    value={item.x}
                    onChange={(event) =>
                      updateDashboardLayoutDraft(key, { x: Math.max(1, Math.min(3, Number(event.target.value) || 1)) })
                    }
                  />
                </label>
                <label>
                  Y
                  <input
                    type="number"
                    min={1}
                    max={4}
                    value={item.y}
                    onChange={(event) =>
                      updateDashboardLayoutDraft(key, { y: Math.max(1, Math.min(4, Number(event.target.value) || 1)) })
                    }
                  />
                </label>
                <label>
                  W
                  <input
                    type="number"
                    min={1}
                    max={3}
                    value={item.w}
                    onChange={(event) =>
                      updateDashboardLayoutDraft(key, { w: Math.max(1, Math.min(3, Number(event.target.value) || 1)) })
                    }
                  />
                </label>
                <label>
                  H
                  <input
                    type="number"
                    min={1}
                    max={3}
                    disabled={lockHeight}
                    value={item.h}
                    onChange={(event) =>
                      updateDashboardLayoutDraft(key, { h: Math.max(1, Math.min(3, Number(event.target.value) || 1)) })
                    }
                  />
                </label>
              </div>
            );
          })}
        </div>
        <div className="row">
          <button className="ghost-btn" onClick={resetDashboardLayoutDraft}>
            {lang === "ko" ? "레이아웃 기본값 복원" : "Reset Layout"}
          </button>
          <button className="primary-btn" onClick={() => void saveDashboardLayoutDraft()}>
            {lang === "ko" ? "레이아웃 저장" : "Save Layout"}
          </button>
        </div>
        <hr />
        <h3>{lang === "ko" ? "퀘스트 자동 생성/기간" : "Quest Auto / Period"}</h3>
        <div className="song-form-grid">
          {periodKeys.map((period) => (
            <div key={`quest-setting-${period}`} className="quest-setting-box">
              <strong>{period === "short" ? (lang === "ko" ? "단기" : "Short") : period === "mid" ? (lang === "ko" ? "중기" : "Mid") : (lang === "ko" ? "장기" : "Long")}</strong>
              <label>
                {lang === "ko" ? "기간(일)" : "Period Days"}
                <input
                  type="number"
                  min={1}
                  value={questForm.period_days[period]}
                  onChange={(event) =>
                    setQuestForm((prev) => ({
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
                    setQuestForm((prev) => ({
                      ...prev,
                      auto_enabled_by_period: { ...prev.auto_enabled_by_period, [period]: event.target.checked },
                    }))
                  }
                />
                <span>{lang === "ko" ? "자동퀘 활성화" : "Enable auto quest"}</span>
              </label>
              <label>
                {lang === "ko" ? "자동 목표(분)" : "Auto Target Minutes"}
                <input
                  type="number"
                  min={1}
                  value={questForm.auto_target_minutes_by_period[period]}
                  onChange={(event) =>
                    setQuestForm((prev) => ({
                      ...prev,
                      auto_target_minutes_by_period: { ...prev.auto_target_minutes_by_period, [period]: Number(event.target.value || 1) },
                    }))
                  }
                />
              </label>
              <label>
                {lang === "ko" ? "자동 중요도" : "Auto Priority"}
                <select
                  value={questForm.auto_priority_by_period[period]}
                  onChange={(event) =>
                    setQuestForm((prev) => ({
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
                    setQuestForm((prev) => ({
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
        <div className="song-form-grid">
          <div className="quest-setting-box">
            <strong>{lang === "ko" ? "기간 라인 색상" : "Period Lane Colors"}</strong>
            {periodKeys.map((period) => (
              <div key={`period-color-${period}`} className="row">
                <span>{period === "short" ? (lang === "ko" ? "단기" : "Short") : period === "mid" ? (lang === "ko" ? "중기" : "Mid") : (lang === "ko" ? "장기" : "Long")}</span>
                <label>
                  {lang === "ko" ? "테두리" : "Border"}
                  <input
                    type="color"
                    value={questForm.ui_style.period_border[period]}
                    onChange={(event) =>
                      setQuestForm((prev) => ({
                        ...prev,
                        ui_style: {
                          ...prev.ui_style,
                          period_border: { ...prev.ui_style.period_border, [period]: event.target.value },
                        },
                      }))
                    }
                  />
                </label>
                <label>
                  {lang === "ko" ? "배경" : "Fill"}
                  <input
                    type="color"
                    value={questForm.ui_style.period_fill[period]}
                    onChange={(event) =>
                      setQuestForm((prev) => ({
                        ...prev,
                        ui_style: {
                          ...prev.ui_style,
                          period_fill: { ...prev.ui_style.period_fill, [period]: event.target.value },
                        },
                      }))
                    }
                  />
                </label>
              </div>
            ))}
          </div>
          <div className="quest-setting-box">
            <strong>{lang === "ko" ? "중요도/난이도 색상" : "Priority / Difficulty Colors"}</strong>
            {(["urgent", "normal", "low"] as const).map((key) => (
              <label key={`priority-color-${key}`}>
                {lang === "ko" ? `중요도(${questPriorityLabel(key)})` : `Priority (${questPriorityLabel(key)})`}
                <input
                  type="color"
                  value={questForm.ui_style.priority_border[key]}
                  onChange={(event) =>
                    setQuestForm((prev) => ({
                      ...prev,
                      ui_style: {
                        ...prev.ui_style,
                        priority_border: { ...prev.ui_style.priority_border, [key]: event.target.value },
                      },
                    }))
                  }
                />
              </label>
            ))}
            {(["low", "mid", "high"] as const).map((key) => (
              <label key={`difficulty-color-${key}`}>
                {lang === "ko" ? `난이도(${questDifficultyLabel(key)})` : `Difficulty (${questDifficultyLabel(key)})`}
                <input
                  type="color"
                  value={questForm.ui_style.difficulty_fill[key]}
                  onChange={(event) =>
                    setQuestForm((prev) => ({
                      ...prev,
                      ui_style: {
                        ...prev.ui_style,
                        difficulty_fill: { ...prev.ui_style.difficulty_fill, [key]: event.target.value },
                      },
                    }))
                  }
                />
              </label>
            ))}
          </div>
        </div>
        <button className="ghost-btn" onClick={() => void saveQuestSettings()}>
          {lang === "ko" ? "퀘스트 설정 저장" : "Save Quest Settings"}
        </button>
        <button
          className="ghost-btn"
          disabled={!canShareCard}
          onClick={() => {
            exportShareCard({
              nickname: settings.profile.nickname,
              level: hud.level,
              rank: hud.rank,
              totalXp: hud.total_xp
            });
            setMessage("공유 카드 이미지를 저장했습니다.");
          }}
        >
          Generate Share Card {canShareCard ? "" : "(Locked)"}
        </button>
      </section>

      <section className="card" data-testid="tutorial-controls">
        <h2>{lang === "ko" ? "튜토리얼" : "Tutorial"}</h2>
        <div className="tag-help">
          <strong>{lang === "ko" ? "선택형 가이드" : "Optional Guide"}</strong>
          <small className="muted">
            {lang === "ko"
              ? "필요할 때만 다시 실행해서 기능을 빠르게 복습할 수 있습니다."
              : "Replay anytime to quickly refresh how features work."}
          </small>
        </div>
        <div className="row">
          <button
            className="primary-btn"
            data-testid="tutorial-start-btn"
            onClick={() => onStartTutorial("core_v1", false)}
          >
            {lang === "ko" ? "코어 튜토리얼 시작" : "Start Core Tutorial"}
          </button>
          <button
            className="ghost-btn"
            data-testid="tutorial-resume-btn"
            disabled={tutorialSummary.core_resume_step_index <= 0 || tutorialSummary.core_completed}
            onClick={() => onStartTutorial("core_v1", true)}
          >
            {lang === "ko" ? "이어하기" : "Resume"}
          </button>
        </div>
        <div className="song-form-grid">
          <label>
            {lang === "ko" ? "딥다이브 선택" : "Deep Dive"}
            <select
              data-testid="tutorial-deepdive-select"
              value={selectedDeepDive}
              onChange={(event) => setSelectedDeepDive(event.target.value)}
            >
              {tutorialSummary.deep_dive_options.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="row">
          <button
            className="ghost-btn"
            disabled={!selectedDeepDive}
            onClick={() => {
              if (!selectedDeepDive) return;
              onStartTutorial(selectedDeepDive, false);
            }}
          >
            {lang === "ko" ? "딥다이브 시작" : "Start Deep Dive"}
          </button>
        </div>
        <small className="muted">
          {tutorialSummary.core_completed
            ? lang === "ko"
              ? "코어 가이드 완료 상태입니다."
              : "Core guide completed."
            : lang === "ko"
            ? `코어 가이드 진행 단계: ${tutorialSummary.core_resume_step_index}`
            : `Core progress step: ${tutorialSummary.core_resume_step_index}`}
        </small>
        {tutorialSummary.guide_finisher_unlocked ? (
          <small className="muted">{lang === "ko" ? "칭호 [가이드 완주자] 획득 완료" : "Title [Guide Finisher] unlocked."}</small>
        ) : null}
      </section>

      <section className="card">
        <div className="row">
          <h2>{lang === "ko" ? "Critical Settings (관리자)" : "Critical Settings (Admin)"}</h2>
          <div className="switch-row">
            <button
              className={`ghost-btn compact-add-btn ${criticalTab === "balance" ? "active-mini" : ""}`}
              onClick={() => setCriticalTab("balance")}
            >
              {lang === "ko" ? "밸런스" : "Balance"}
            </button>
            <button
              className="ghost-btn compact-add-btn"
              onClick={() => setAchievementManagerOpen(true)}
            >
              {lang === "ko" ? "업적 관리" : "Achievements"}
            </button>
          </div>
        </div>
        {criticalTab === "balance" ? (
          <>
        <div className="critical-grid">
          <label>
            start_bonus
            <input
              type="number"
              value={criticalForm.start_bonus}
              onChange={(event) => setCriticalForm((prev) => ({ ...prev, start_bonus: Number(event.target.value) }))}
            />
          </label>
          <label>
            per_10min
            <input
              type="number"
              value={criticalForm.per_10min}
              onChange={(event) => setCriticalForm((prev) => ({ ...prev, per_10min: Number(event.target.value) }))}
            />
          </label>
          <label>
            max_base_xp
            <input
              type="number"
              value={criticalForm.max_base_xp}
              onChange={(event) => setCriticalForm((prev) => ({ ...prev, max_base_xp: Number(event.target.value) }))}
            />
          </label>
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
          </label>
          <label>
            level_curve a
            <input
              type="number"
              value={criticalForm.a}
              onChange={(event) => setCriticalForm((prev) => ({ ...prev, a: Number(event.target.value) }))}
            />
          </label>
          <label>
            level_curve b
            <input
              type="number"
              value={criticalForm.b}
              onChange={(event) => setCriticalForm((prev) => ({ ...prev, b: Number(event.target.value) }))}
            />
          </label>
          <label>
            level_curve c
            <input
              type="number"
              value={criticalForm.c}
              onChange={(event) => setCriticalForm((prev) => ({ ...prev, c: Number(event.target.value) }))}
            />
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
          </label>
        </div>
        <div className="tag-help">
          <strong>{lang === "ko" ? "밸런스 요약" : "Balance Summary"}</strong>
          <div className="row">
            <small>{lang === "ko" ? "30분 기준 기본 XP" : "30m baseline XP"}: {baseline30m.toLocaleString()}</small>
            <small>{lang === "ko" ? `Lv.${criticalForm.max_level} 누적 필요 XP` : `XP to Lv.${criticalForm.max_level}`}: {xpToMax.toLocaleString()}</small>
          </div>
        </div>
        <button
          className="primary-btn"
          onClick={async () => {
            const updated = await putCriticalSettings({
              xp: {
                session: {
                  start_bonus: criticalForm.start_bonus,
                  per_10min: criticalForm.per_10min,
                  max_base_xp: criticalForm.max_base_xp
                }
              },
              critical: {
                backfill_multiplier_default: criticalForm.backfill_multiplier_default,
                achievement_xp_multiplier: criticalForm.achievement_xp_multiplier,
                quest_xp_multiplier: criticalForm.quest_xp_multiplier
              },
              level_curve: {
                a: criticalForm.a,
                b: criticalForm.b,
                c: criticalForm.c,
                max_level: criticalForm.max_level
              }
            });
            onSettingsChange(updated);
            setMessage("Critical 설정 저장 완료");
          }}
        >
          Save Critical Settings
        </button>
        <hr />
        <h3>{lang === "ko" ? "테스트 / 초기화" : "Testing / Reset"}</h3>
        <div className="row">
          <button
            className="ghost-btn"
            onClick={async () => {
              const grant = Math.max(1, grantToNext);
              await adminGrantXp(grant);
              setMessage(lang === "ko" ? `다음 레벨 필요 XP 지급 (+${grant})` : `Granted XP to next level (+${grant})`);
              await onRefresh();
            }}
          >
            {lang === "ko" ? `테스트 레벨업(+${Math.max(1, grantToNext)}XP)` : `Test Level Up (+${Math.max(1, grantToNext)}XP)`}
          </button>
          <button
            className="ghost-btn danger-border"
            onClick={async () => {
              if (!window.confirm(lang === "ko" ? "XP/레벨 기록을 초기화할까요?" : "Reset XP/level progress?")) return;
              await adminResetProgress();
              setMessage(lang === "ko" ? "진행도 초기화 완료" : "Progress reset complete");
              await onRefresh();
            }}
          >
            {lang === "ko" ? "레벨/XP 초기화" : "Reset XP/Level"}
          </button>
          <button
            className="ghost-btn danger-border"
            onClick={async () => {
              if (!window.confirm(lang === "ko" ? "정말 전체 초기화할까요? (세션/미디어/설정)" : "Reset everything?")) return;
              await adminResetAll();
              setMessage(lang === "ko" ? "전체 초기화 완료" : "Full reset complete");
              await onRefresh();
            }}
          >
            {lang === "ko" ? "전체 초기화" : "Full Reset"}
          </button>
        </div>
        <div className="tag-help">
          <strong>{lang === "ko" ? "샌드박스 모의데이터" : "Sandbox Mock Data"}</strong>
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
              ? `모의데이터셋 루트: ${mockStatus.datasets_root ?? "designPack/mock_datasets"}`
              : `Mock datasets root: ${mockStatus.datasets_root ?? "designPack/mock_datasets"}`}
          </small>
          <div className="song-form-grid">
            <label>
              {lang === "ko" ? "데이터셋" : "Dataset"}
              <select data-testid="mock-dataset-select" value={selectedMockDataset} onChange={(event) => setSelectedMockDataset(event.target.value)}>
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
                  setMessage(lang === "ko" ? "모의데이터 적용 완료" : "Mock dataset activated");
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
                  setMessage(lang === "ko" ? "모의데이터 재로드 완료" : "Mock dataset reloaded");
                  await onRefresh();
                } finally {
                  setMockBusy(false);
                }
              }}
            >
              {lang === "ko" ? "모의데이터 재로드" : "Reload Mock"}
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
                  const [datasets, status] = await Promise.all([getMockDatasets(), getMockDataStatus()]);
                  setMockDatasets(datasets);
                  setMockStatus(status);
                  setSelectedMockDataset(result.dataset_id);
                  setMessage(
                    lang === "ko"
                      ? `샌드박스 데이터셋 저장 완료: ${result.dataset_id} (${result.generated_sessions}개 세션 생성) / ${result.data_path}`
                      : `Sandbox dataset exported: ${result.dataset_id} (${result.generated_sessions} sessions) / ${result.data_path}`
                  );
                } finally {
                  setMockExportBusy(false);
                }
              }}
            >
              {lang === "ko" ? "현재 상태를 샌드박스로 저장(+60일 세션)" : "Export current state (+60d sessions)"}
            </button>
          </div>
          {mockDatasets.length > 0 ? (
            <small className="muted">
              {lang === "ko"
                ? "추가 데이터셋은 designPack/mock_datasets/<dataset_id>/data/*.csv 구조로 넣으면 자동 인식됩니다. 샘플은 starter_demo_v1 폴더를 그대로 참고하세요."
                : "Datasets are auto-discovered from designPack/mock_datasets/<dataset_id>/data/*.csv. Use starter_demo_v1 as a template."}
            </small>
          ) : (
            <small className="muted">{lang === "ko" ? "감지된 모의데이터셋이 없습니다." : "No mock datasets found."}</small>
          )}
          <small className="muted">
            {lang === "ko"
              ? "EXE에서 저장한 데이터셋은 dist/BassOS/_internal/designPack/mock_datasets 에 생성될 수 있습니다. 다음 빌드에 포함하려면 해당 폴더를 프로젝트의 designPack/mock_datasets 로 복사하세요."
              : "Datasets exported from EXE may be created in dist/BassOS/_internal/designPack/mock_datasets. Copy them to project designPack/mock_datasets to include in next build."}
          </small>
        </div>
          </>
        ) : null}
      </section>

      <section className="card">
        <h2>Unlockables</h2>
        <div className="unlock-list">
          {unlockables.map((item) => (
            <div key={String(item.unlock_id)} className={`unlock-item ${item.unlocked ? "on" : "off"}`}>
              <div>
                <strong>{normalizeGoalText(String(item.name), lang)}</strong>
                <small>
                  Lv.{String(item.level_required)} · {String(item.type)}
                </small>
              </div>
              <span>{item.unlocked ? "Unlocked" : "Locked"}</span>
            </div>
          ))}
        </div>
      </section>

      {achievementManagerOpen ? (
        <div className="modal-backdrop achievement-manager-backdrop">
          <div className="modal achievement-manager-modal">
            <div className="achievement-manager-head">
              <h2>{lang === "ko" ? "업적 관리" : "Achievement Manager"}</h2>
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
