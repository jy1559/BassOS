import { useEffect, useMemo, useRef, useState } from "react";
import {
  completeTutorial,
  completeOnboarding,
  getAchievements,
  getCatalogs,
  getDrillLibrary,
  getGallery,
  getHudSummary,
  getLevelUpCopy,
  getQuests,
  getRecentAchievements,
  getSettings,
  putBasicSettings,
  getTutorialState,
  getUnlockables,
  saveTutorialProgress,
  startTutorial,
} from "./api";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { t, type Lang } from "./i18n";
import type {
  Achievement,
  AchievementRecent,
  GalleryItem,
  HudSummary,
  Quest,
  SessionStopResult,
  Settings,
  TutorialState,
} from "./types/models";
import { AchievementsPage } from "./pages/AchievementsPage";
import { DashboardPage } from "./pages/DashboardPage";
import { DrillLibraryPage } from "./pages/DrillLibraryPage";
import { GalleryPage } from "./pages/GalleryPage";
import { OnboardingWizard } from "./pages/OnboardingWizard";
import {
  PracticeStudioPage,
  type SessionPipVideoControlPayload,
  type SessionPipVideoPayload,
} from "./pages/PracticeStudioPage";
import { PracticeToolsPage } from "./pages/PracticeToolsPage";
import { QuestsPage } from "./pages/QuestsPage";
import { RecommendationsPage } from "./pages/RecommendationsPage";
import { ReviewPage } from "./pages/ReviewPage";
import { SessionsPage } from "./pages/SessionsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SongsPage } from "./pages/SongsPage";
import { XPPage } from "./pages/XPPage";
import { TutorialOverlay } from "./components/tutorial/TutorialOverlay";
import { SessionStopModal } from "./components/session/SessionStopModal";
import { MetronomePipPanel, MetronomeProvider, useMetronome } from "./metronome";
import { ShortcutRouterProvider, useShortcutLayer, useShortcutRouter } from "./shortcutRouter";
import type { ShortcutActionId } from "./keyboardShortcuts";
import { CORE_CAMPAIGN_ID, getTutorialCampaign } from "./tutorial/campaigns";
import type { TutorialCampaign } from "./tutorial/types";
import { configureGenreCatalog } from "./genreCatalog";
import { formatDisplayXp, getXpDisplayScale } from "./utils/xpDisplay";

type TabId =
  | "dashboard"
  | "practice"
  | "tools"
  | "sessions"
  | "review"
  | "xp"
  | "quests"
  | "achievements"
  | "recommend"
  | "songs"
  | "drills"
  | "gallery"
  | "media"
  | "settings";
type NavGroupId = "tools" | "library" | "records" | "challenge";

type ToastLane = "top-right" | "bottom-right";
type Toast = {
  id: number;
  lane: ToastLane;
  title: string;
  subtitle?: string;
  icon?: string;
  type: "success" | "error" | "info";
  style?: "default" | "achievement" | "quest";
};
type FxOverlayEvent =
  | {
      id: number;
      kind: "level";
      level: number;
      beforeLevel: number;
      afterLevel: number;
      title: string;
      subtitle: string;
      tierUp: boolean;
      beforeTier: string;
      afterTier: string;
      tierColor: string;
      badgeBefore: string;
      badgeAfter: string;
    }
  | {
      id: number;
      kind: "session";
      title: string;
      subtitle: string;
      durationMin: number;
      gainedXp: number;
      cheer: string;
    };
type FxOverlayPayload =
  | Omit<Extract<FxOverlayEvent, { kind: "level" }>, "id">
  | Omit<Extract<FxOverlayEvent, { kind: "session" }>, "id">;
type TutorialRuntime = { campaign: TutorialCampaign; stepIndex: number };
type FxBadgeTier = "bronze" | "silver" | "gold" | "platinum" | "diamond" | "challenger";
type SessionPipPosition = { left: number; top: number };
type SessionPipDragState = {
  pointerId: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
};

const TAB_SHORTCUT_ACTIONS: Array<{ action: ShortcutActionId; tab: TabId }> = [
  { action: "tab_dashboard", tab: "dashboard" },
  { action: "tab_practice", tab: "practice" },
  { action: "tab_gallery", tab: "gallery" },
  { action: "tab_songs", tab: "songs" },
  { action: "tab_drills", tab: "drills" },
  { action: "tab_recommend", tab: "recommend" },
  { action: "tab_review", tab: "review" },
  { action: "tab_xp", tab: "xp" },
  { action: "tab_sessions", tab: "sessions" },
  { action: "tab_quests", tab: "quests" },
  { action: "tab_achievements", tab: "achievements" },
  { action: "tab_tools", tab: "tools" },
  { action: "tab_settings", tab: "settings" },
];

function preventBrowserReload() {
  window.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if (key === "f5" || (event.ctrlKey && key === "r")) {
      event.preventDefault();
    }
  });
}

function fxBadgeTier(level: number): FxBadgeTier {
  if (level >= 50) return "challenger";
  if (level >= 40) return "diamond";
  if (level >= 30) return "platinum";
  if (level >= 20) return "gold";
  if (level >= 10) return "silver";
  return "bronze";
}

function fxBadgeStep(level: number): number {
  const lv = Math.max(1, level);
  if (lv >= 50) return 10;
  if (lv >= 40) return lv - 39;
  if (lv >= 30) return lv - 29;
  if (lv >= 20) return lv - 19;
  if (lv >= 10) return lv - 9;
  return lv;
}

function fxTierLabel(tier: FxBadgeTier, lang: Lang): string {
  if (lang === "ko") {
    if (tier === "bronze") return "브론즈";
    if (tier === "silver") return "실버";
    if (tier === "gold") return "골드";
    if (tier === "platinum") return "플래티넘";
    if (tier === "diamond") return "다이아";
    return "챌린저";
  }
  if (tier === "bronze") return "Bronze";
  if (tier === "silver") return "Silver";
  if (tier === "gold") return "Gold";
  if (tier === "platinum") return "Platinum";
  if (tier === "diamond") return "Diamond";
  return "Challenger";
}

function fmtSec(totalSec: number): string {
  const safe = Math.max(0, totalSec);
  const mm = String(Math.floor(safe / 60)).padStart(2, "0");
  const ss = String(safe % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function activityName(activity: string | undefined, lang: Lang): string {
  const raw = String(activity || "").trim().toLowerCase();
  if (raw === "song") return lang === "ko" ? "곡 연습" : "Song Practice";
  if (raw === "drill") return lang === "ko" ? "드릴 연습" : "Drill Practice";
  if (raw === "etc") return lang === "ko" ? "기타 활동" : "Other";
  return lang === "ko" ? "선택 없음" : "No target";
}

function isPipDragBlockedTarget(target: EventTarget | null): boolean {
  const node = target as HTMLElement | null;
  if (!node) return false;
  return Boolean(node.closest("button,input,select,textarea,video,iframe,a,label,summary,[role='button']"));
}

function clampPipPosition(position: SessionPipPosition, width: number, height: number): SessionPipPosition {
  const margin = 8;
  const maxLeft = Math.max(margin, window.innerWidth - width - margin);
  const maxTop = Math.max(margin, window.innerHeight - height - margin);
  return {
    left: Math.round(Math.max(margin, Math.min(position.left, maxLeft))),
    top: Math.round(Math.max(margin, Math.min(position.top, maxTop))),
  };
}

const PRACTICE_SCROLL_STORAGE_KEY = "bassos.practice.scrollTop.v1";

function AppBody() {
  const [tab, setTab] = useState<TabId>("dashboard");
  const [navOpen, setNavOpen] = useState<Record<NavGroupId, boolean>>({
    tools: true,
    library: true,
    records: true,
    challenge: true,
  });
  const [settings, setSettings] = useState<Settings | null>(null);
  const [hud, setHud] = useState<HudSummary | null>(null);
  const [quests, setQuests] = useState<Quest[]>([]);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [recentAchievements, setRecentAchievements] = useState<AchievementRecent[]>([]);
  const [catalogs, setCatalogs] = useState<{
    song_ladder: Array<Record<string, string>>;
    song_library: Array<Record<string, string>>;
    drills: Array<Record<string, string>>;
    drill_library: Array<Record<string, string>>;
    backing_tracks: Array<Record<string, string>>;
  } | null>(null);
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [unlockables, setUnlockables] = useState<Array<Record<string, unknown>>>([]);
  const [tutorialState, setTutorialState] = useState<TutorialState | null>(null);
  const [tutorialRuntime, setTutorialRuntime] = useState<TutorialRuntime | null>(null);
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [fxQueue, setFxQueue] = useState<FxOverlayEvent[]>([]);
  const [activeFx, setActiveFx] = useState<FxOverlayEvent | null>(null);
  const [showGlobalStopModal, setShowGlobalStopModal] = useState(false);
  const [sessionPipElapsedSec, setSessionPipElapsedSec] = useState(0);
  const [sessionPipVideo, setSessionPipVideo] = useState<SessionPipVideoPayload | null>(null);
  const [sessionPipVideoControls, setSessionPipVideoControls] = useState<SessionPipVideoControlPayload | null>(null);
  const [sessionPipPosition, setSessionPipPosition] = useState<SessionPipPosition | null>(null);
  const [sessionPipDragging, setSessionPipDragging] = useState(false);
  const [sessionPipCollapsed, setSessionPipCollapsed] = useState(false);
  const [sessionPipVideoOpen, setSessionPipVideoOpen] = useState(false);

  const signalReadyRef = useRef(false);
  const prevLevelRef = useRef(0);
  const seenAchievementKeysRef = useRef<Set<string>>(new Set());
  const prevClaimableQuestIdsRef = useRef<Set<string>>(new Set());
  const contentRef = useRef<HTMLElement | null>(null);
  const prevTabRef = useRef<TabId>("dashboard");
  const practiceScrollTopRef = useRef(0);
  const practiceScrollUserInputRef = useRef(false);
  const practiceScrollUserInputTimerRef = useRef<number | null>(null);
  const isPracticeScrollRestoringRef = useRef(false);
  const sessionPipRef = useRef<HTMLDivElement | null>(null);
  const sessionPipDragRef = useRef<SessionPipDragState | null>(null);
  const shortcutRouter = useShortcutRouter();
  const metronome = useMetronome();

  const lang = (settings?.ui?.language ?? "ko") as Lang;
  const xpDisplayScale = getXpDisplayScale(settings);
  const activeSessionId = hud?.active_session?.session_id || "";
  const activeSessionStartMs = hud?.active_session?.start_at ? new Date(hud.active_session.start_at).getTime() : 0;
  const activeSessionSongId = String(hud?.active_session?.song_library_id || "");

  useEffect(() => {
    shortcutRouter.setBindings(settings?.ui?.keyboard_shortcuts);
  }, [settings?.ui?.keyboard_shortcuts, shortcutRouter]);

  const handleSessionPipVideoChange = (payload: SessionPipVideoPayload | null) => {
    if (!payload) {
      setSessionPipVideo(null);
      setSessionPipVideoControls(null);
      return;
    }
    if (!activeSessionId) {
      setSessionPipVideo(null);
      setSessionPipVideoControls(null);
      return;
    }
    if (
      payload.sessionId !== activeSessionId ||
      payload.targetKind !== "song" ||
      !activeSessionSongId ||
      payload.targetId !== activeSessionSongId
    ) {
      setSessionPipVideo(null);
      setSessionPipVideoControls(null);
      return;
    }
    setSessionPipVideo(payload);
  };

  const handleSessionPipVideoControlChange = (payload: SessionPipVideoControlPayload | null) => {
    if (!payload) {
      setSessionPipVideoControls(null);
      return;
    }
    if (!activeSessionId || payload.sessionId !== activeSessionId) {
      setSessionPipVideoControls(null);
      return;
    }
    if (
      payload.targetKind !== "song" ||
      !activeSessionSongId ||
      payload.targetId !== activeSessionSongId
    ) {
      setSessionPipVideoControls(null);
      return;
    }
    setSessionPipVideoControls(payload);
  };

  const savePracticeScrollTop = (rawValue: number) => {
    const value = Math.max(0, Math.floor(Number(rawValue) || 0));
    practiceScrollTopRef.current = value;
    try {
      window.sessionStorage.setItem(PRACTICE_SCROLL_STORAGE_KEY, String(value));
    } catch {
      // Ignore storage write failures.
    }
  };

  const loadPracticeScrollTop = (): number => {
    if (practiceScrollTopRef.current > 0) return practiceScrollTopRef.current;
    try {
      const raw = window.sessionStorage.getItem(PRACTICE_SCROLL_STORAGE_KEY);
      const parsed = Number(raw || 0);
      if (Number.isFinite(parsed) && parsed > 0) {
        practiceScrollTopRef.current = Math.floor(parsed);
        return practiceScrollTopRef.current;
      }
    } catch {
      // Ignore storage read failures.
    }
    return 0;
  };

  const switchTab = (nextTab: TabId) => {
    if (tab === "practice" && contentRef.current) {
      const stableTop = practiceScrollTopRef.current;
      savePracticeScrollTop(stableTop > 0 ? stableTop : contentRef.current.scrollTop);
    }
    setTab(nextTab);
  };

  const pushToast = ({
    title,
    subtitle,
    lane = "top-right",
    type = "info",
    style = "default",
    icon,
    timeout = 2800,
  }: {
    title: string;
    subtitle?: string;
    lane?: ToastLane;
    type?: "success" | "error" | "info";
    style?: "default" | "achievement" | "quest";
    icon?: string;
    timeout?: number;
  }) => {
    const id = Date.now() + Math.floor(Math.random() * 10000);
    setToasts((prev) => [...prev, { id, lane, title, subtitle, type, style, icon }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, timeout);
  };

  const notify = (text: string, type: "success" | "error" | "info" = "info") => {
    pushToast({ title: text, lane: "top-right", type, style: "default" });
  };

  const enqueueFx = (event: FxOverlayPayload) => {
    setFxQueue((prev) => [...prev, { ...event, id: Date.now() + Math.floor(Math.random() * 10000) } as FxOverlayEvent]);
  };

  const applySignals = (
    nextHud: HudSummary,
    nextRecent: AchievementRecent[],
    nextQuests: Quest[],
    nextAchievements: Achievement[]
  ) => {
    const uiLang = (settings?.ui?.language ?? "ko") as Lang;
    const uiSettings = (settings?.ui ?? {}) as Settings["ui"];
    const levelNotifyOn = uiSettings.notify_level_up !== false;
    const levelFxOn = uiSettings.fx_level_up_overlay ?? uiSettings.enable_confetti ?? true;
    const achievementNotifyOn = uiSettings.notify_achievement_unlock !== false;
    const questNotifyOn = uiSettings.notify_quest_complete !== false;

    if (!signalReadyRef.current) {
      signalReadyRef.current = true;
      prevLevelRef.current = nextHud.level;
      seenAchievementKeysRef.current = new Set(
        nextRecent.map((item) => `${item.achievement_id}:${item.created_at}`)
      );
      prevClaimableQuestIdsRef.current = new Set(
        nextQuests.filter((item) => item.claimable).map((item) => item.quest_id)
      );
      return;
    }

    if (nextHud.level > prevLevelRef.current) {
      const beforeLevel = prevLevelRef.current;
      const afterLevel = nextHud.level;
      void (async () => {
        let subtitle = uiLang === "ko" ? "새 티어가 열렸습니다." : "A new tier has opened.";
        let tierUp = false;
        let beforeTier = "bronze";
        let afterTier = "bronze";
        let tierColor = "#4f7cff";
        let badgeBefore = "";
        let badgeAfter = "";
        try {
          const copy = await getLevelUpCopy({
            level: afterLevel,
            before_level: beforeLevel,
            lang: uiLang,
          });
          subtitle = copy.line || subtitle;
          tierUp = copy.tier_up === true;
          beforeTier = copy.before_tier || beforeTier;
          afterTier = copy.after_tier || afterTier;
          tierColor = copy.tier_color || tierColor;
          badgeBefore = copy.badge_before || "";
          badgeAfter = copy.badge_after || "";
        } catch {
          // Keep fallback copy when API fetch fails.
        }
        if (levelNotifyOn && !levelFxOn) {
          pushToast({
            lane: "top-right",
            type: "success",
            style: "quest",
            title: uiLang === "ko" ? `레벨업! Lv.${afterLevel}` : `Level up! Lv.${afterLevel}`,
            subtitle,
          });
        }
        if (levelFxOn) {
          enqueueFx({
            kind: "level",
            level: afterLevel,
            beforeLevel,
            afterLevel,
            title: uiLang === "ko" ? `LEVEL UP! Lv.${afterLevel}` : `LEVEL UP! Lv.${afterLevel}`,
            subtitle,
            tierUp,
            beforeTier,
            afterTier,
            tierColor,
            badgeBefore,
            badgeAfter,
          });
        }
      })();
    }
    prevLevelRef.current = nextHud.level;

    const achievementMap = new Map(nextAchievements.map((item) => [item.achievement_id, item]));
    for (const item of [...nextRecent].reverse()) {
      const key = `${item.achievement_id}:${item.created_at}`;
      if (seenAchievementKeysRef.current.has(key)) continue;
      seenAchievementKeysRef.current.add(key);
      const detail = achievementMap.get(item.achievement_id);
      if (String(detail?.rule_type || "").toLowerCase() === "manual") continue;
      const icon = detail?.icon_url || (detail?.icon_path ? `/media/${detail.icon_path}` : "");
      const title = uiLang === "ko" ? "업적 달성!" : "Achievement Unlocked!";
      const subtitle = detail?.description || item.name || (uiLang === "ko" ? "새 업적" : "New achievement");
      if (achievementNotifyOn) {
        pushToast({
          lane: "bottom-right",
          type: "success",
          style: "achievement",
          title: `${title} ${item.name ? `· ${item.name}` : ""}`.trim(),
          subtitle,
          icon,
          timeout: 6200,
        });
      }
    }

    const prevClaimable = prevClaimableQuestIdsRef.current;
    const nextClaimable = new Set(nextQuests.filter((item) => item.claimable).map((item) => item.quest_id));
    for (const quest of nextQuests) {
      if (!quest.claimable || prevClaimable.has(quest.quest_id)) continue;
      if (questNotifyOn) {
        pushToast({
          lane: "top-right",
          type: "success",
          style: "quest",
          title: uiLang === "ko" ? "퀘스트 완료! 보상을 수령하세요" : "Quest complete! Claim your reward",
          subtitle: quest.title,
          timeout: 4200,
        });
      }
    }
    prevClaimableQuestIdsRef.current = nextClaimable;
  };

  const syncCoreTutorialState = async () => {
    try {
      const state = await getTutorialState(CORE_CAMPAIGN_ID);
      setTutorialState(state);
    } catch {
      // Keep current tutorial state on transient sync failures.
    }
  };

  const openTutorial = async (campaignId: string, resume = false) => {
    const campaign = getTutorialCampaign(campaignId);
    if (!campaign) {
      notify(lang === "ko" ? "튜토리얼 캠페인을 찾지 못했습니다." : "Tutorial campaign not found.", "error");
      return;
    }
    try {
      const started = await startTutorial(campaignId);
      const startIndex = resume ? started.resume_step_index : 0;
      if (!resume) {
        await saveTutorialProgress(campaignId, 0);
      }
      const nextIndex = Math.max(0, Math.min(startIndex, campaign.steps.length - 1));
      setTutorialRuntime({ campaign, stepIndex: nextIndex });
      switchTab(campaign.steps[nextIndex]?.tab as TabId);
      if (campaignId === CORE_CAMPAIGN_ID) {
        setTutorialState((prev) =>
          prev
            ? {
                ...prev,
                campaign_id: campaignId,
                completed: false,
                resume_step_index: nextIndex,
              }
            : prev
        );
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : "Tutorial start failed", "error");
    }
  };

  const closeTutorial = async () => {
    if (tutorialRuntime) {
      try {
        await saveTutorialProgress(tutorialRuntime.campaign.id, tutorialRuntime.stepIndex);
        if (tutorialRuntime.campaign.id === CORE_CAMPAIGN_ID) {
          setTutorialState((prev) =>
            prev
              ? {
                  ...prev,
                  campaign_id: tutorialRuntime.campaign.id,
                  resume_step_index: tutorialRuntime.stepIndex,
                }
              : prev
          );
        }
      } catch {
        // Keep close flow silent on transient network failure.
      }
    }
    setTutorialRuntime(null);
    if (tutorialRuntime?.campaign.id === CORE_CAMPAIGN_ID) {
      await syncCoreTutorialState();
    }
  };

  const moveTutorialStep = async (direction: "prev" | "next") => {
    if (!tutorialRuntime) return;
    const maxIndex = Math.max(0, tutorialRuntime.campaign.steps.length - 1);
    const delta = direction === "next" ? 1 : -1;
    const nextIndex = Math.max(0, Math.min(maxIndex, tutorialRuntime.stepIndex + delta));
    if (nextIndex === tutorialRuntime.stepIndex) return;
    setTutorialRuntime({ ...tutorialRuntime, stepIndex: nextIndex });
    switchTab(tutorialRuntime.campaign.steps[nextIndex]?.tab as TabId);
    if (tutorialRuntime.campaign.id === CORE_CAMPAIGN_ID) {
      setTutorialState((prev) =>
        prev
          ? {
              ...prev,
              campaign_id: tutorialRuntime.campaign.id,
              resume_step_index: nextIndex,
            }
          : prev
      );
    }
    try {
      await saveTutorialProgress(tutorialRuntime.campaign.id, nextIndex);
    } catch {
      // Ignore save failures and keep local step state.
    }
  };

  const finishTutorial = async () => {
    if (!tutorialRuntime) return;
    try {
      const result = await completeTutorial(tutorialRuntime.campaign.id);
      if (result.reward_granted) {
        notify(
          lang === "ko"
            ? `가이드 완주! +${formatDisplayXp(result.xp_granted, xpDisplayScale)} XP, 칭호 [가이드 완주자] 획득.`
            : `Guide complete! +${formatDisplayXp(result.xp_granted, xpDisplayScale)} XP and title unlocked.`,
          "success"
        );
      } else {
        notify(lang === "ko" ? "가이드 완료!" : "Guide completed.", "success");
      }
      setTutorialRuntime(null);
      await loadAll();
      const state = await getTutorialState(tutorialRuntime.campaign.id);
      setTutorialState(state);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Tutorial completion failed", "error");
    }
  };

  const loadAll = async () => {
    setBusy(true);
    try {
      const [
        nextSettings,
        nextHud,
        nextQuests,
        nextAchievements,
        nextRecentAchievements,
        nextCatalogs,
        nextDrillLibrary,
        nextGallery,
        nextUnlockables,
        nextTutorialState,
      ] = await Promise.all([
        getSettings(),
        getHudSummary(),
        getQuests(),
        getAchievements(),
        getRecentAchievements(5),
        getCatalogs(),
        getDrillLibrary(),
        getGallery(600),
        getUnlockables(),
        getTutorialState(CORE_CAMPAIGN_ID),
      ]);
      nextCatalogs.drill_library = nextDrillLibrary;
      setSettings(nextSettings);
      setHud(nextHud);
      setQuests(nextQuests);
      setAchievements(nextAchievements);
      setRecentAchievements(nextRecentAchievements);
      setCatalogs(nextCatalogs);
      setGallery(nextGallery);
      setUnlockables(nextUnlockables.items);
      setTutorialState(nextTutorialState);
      applySignals(nextHud, nextRecentAchievements, nextQuests, nextAchievements);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Unknown error", "error");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    preventBrowserReload();
    void loadAll();
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void Promise.all([getHudSummary(), getRecentAchievements(5), getQuests(), getAchievements()])
        .then(([nextHud, nextRecent, nextQuests, nextAchievements]) => {
          setHud(nextHud);
          setRecentAchievements(nextRecent);
          setQuests(nextQuests);
          setAchievements(nextAchievements);
          applySignals(nextHud, nextRecent, nextQuests, nextAchievements);
        })
        .catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(interval);
  }, [settings]);

  useEffect(() => {
    const contentEl = contentRef.current;
    if (!contentEl) {
      prevTabRef.current = tab;
      return;
    }
    const previousTab = prevTabRef.current;
    if (previousTab === "practice" && tab !== "practice") {
      const stableTop = practiceScrollTopRef.current;
      savePracticeScrollTop(stableTop > 0 ? stableTop : contentEl.scrollTop);
    }
    if (tab === "practice") {
      const restoreTop = loadPracticeScrollTop();
      if (restoreTop > 0) {
        isPracticeScrollRestoringRef.current = true;
        const apply = () => {
          if (contentRef.current) {
            contentRef.current.scrollTop = restoreTop;
          }
        };
        let rafId = 0;
        const startedAt = Date.now();
        const step = () => {
          apply();
          if (Date.now() - startedAt < 1600) {
            rafId = window.requestAnimationFrame(step);
          }
        };
        rafId = window.requestAnimationFrame(step);
        const timerA = window.setTimeout(apply, 0);
        const timerB = window.setTimeout(apply, 120);
        const timerC = window.setTimeout(apply, 320);
        const timerD = window.setTimeout(apply, 640);
        const timerDone = window.setTimeout(() => {
          isPracticeScrollRestoringRef.current = false;
        }, 1760);
        prevTabRef.current = tab;
        return () => {
          if (rafId) window.cancelAnimationFrame(rafId);
          window.clearTimeout(timerA);
          window.clearTimeout(timerB);
          window.clearTimeout(timerC);
          window.clearTimeout(timerD);
          window.clearTimeout(timerDone);
          isPracticeScrollRestoringRef.current = false;
        };
      }
    }
    prevTabRef.current = tab;
  }, [tab]);

  useEffect(() => {
    const contentEl = contentRef.current;
    if (!contentEl || tab !== "practice") return;
    const markUserScrollIntent = () => {
      practiceScrollUserInputRef.current = true;
      if (practiceScrollUserInputTimerRef.current !== null) {
        window.clearTimeout(practiceScrollUserInputTimerRef.current);
      }
      practiceScrollUserInputTimerRef.current = window.setTimeout(() => {
        practiceScrollUserInputRef.current = false;
        practiceScrollUserInputTimerRef.current = null;
      }, 420);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const code = event.code || "";
      if (
        code === "ArrowUp" ||
        code === "ArrowDown" ||
        code === "PageUp" ||
        code === "PageDown" ||
        code === "Home" ||
        code === "End" ||
        code === "Space"
      ) {
        markUserScrollIntent();
      }
    };
    const syncPracticeScroll = () => {
      if (isPracticeScrollRestoringRef.current) return;
      if (!practiceScrollUserInputRef.current) return;
      savePracticeScrollTop(contentEl.scrollTop);
    };
    contentEl.addEventListener("wheel", markUserScrollIntent, { passive: true });
    contentEl.addEventListener("touchmove", markUserScrollIntent, { passive: true });
    contentEl.addEventListener("pointerdown", markUserScrollIntent, { passive: true });
    window.addEventListener("keydown", onKeyDown);
    contentEl.addEventListener("scroll", syncPracticeScroll, { passive: true });
    return () => {
      contentEl.removeEventListener("wheel", markUserScrollIntent);
      contentEl.removeEventListener("touchmove", markUserScrollIntent);
      contentEl.removeEventListener("pointerdown", markUserScrollIntent);
      window.removeEventListener("keydown", onKeyDown);
      contentEl.removeEventListener("scroll", syncPracticeScroll);
      if (practiceScrollUserInputTimerRef.current !== null) {
        window.clearTimeout(practiceScrollUserInputTimerRef.current);
        practiceScrollUserInputTimerRef.current = null;
      }
      practiceScrollUserInputRef.current = false;
    };
  }, [tab]);

  useEffect(() => {
    if (activeFx || !fxQueue.length) return;
    const [next] = fxQueue;
    setFxQueue((prev) => prev.slice(1));
    setActiveFx(next);
  }, [fxQueue, activeFx]);

  useEffect(() => {
    if (!activeFx) return;
    const timer = window.setTimeout(() => setActiveFx(null), activeFx.kind === "session" ? 4200 : 3600);
    return () => window.clearTimeout(timer);
  }, [activeFx]);

  useEffect(() => {
    if (!activeSessionId || !activeSessionStartMs) {
      setSessionPipElapsedSec(0);
      setShowGlobalStopModal(false);
      setSessionPipVideo(null);
      setSessionPipVideoControls(null);
      setSessionPipDragging(false);
      setSessionPipPosition(null);
      setSessionPipCollapsed(false);
      setSessionPipVideoOpen(false);
      sessionPipDragRef.current = null;
      return;
    }
    const tick = () => setSessionPipElapsedSec(Math.max(0, Math.floor((Date.now() - activeSessionStartMs) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [activeSessionId, activeSessionStartMs]);

  useEffect(() => {
    if (!activeSessionId) return;
    setSessionPipCollapsed(false);
    setSessionPipVideoOpen(false);
    setSessionPipVideo(null);
    setSessionPipVideoControls(null);
  }, [activeSessionId]);

  useEffect(() => {
    if (!settings) return;
    configureGenreCatalog({
      groups: Array.isArray(settings.ui?.song_genre_groups) ? settings.ui.song_genre_groups : null,
      aliases:
        settings.ui?.song_genre_aliases && typeof settings.ui.song_genre_aliases === "object"
          ? settings.ui.song_genre_aliases
          : null,
    });
  }, [settings?.ui?.song_genre_groups, settings?.ui?.song_genre_aliases, settings]);

  useEffect(() => {
    if (!activeSessionId) return;
    const onResize = () => {
      const node = sessionPipRef.current;
      if (!node) return;
      setSessionPipPosition((prev) => {
        if (!prev) return prev;
        const rect = node.getBoundingClientRect();
        return clampPipPosition(prev, rect.width || node.offsetWidth || 0, rect.height || node.offsetHeight || 0);
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [activeSessionId]);

  const patchUiSettings = async (patch: Partial<Settings["ui"]>) => {
    setSettings((prev) => (prev ? { ...prev, ui: { ...prev.ui, ...patch } } : prev));
    try {
      const updated = await putBasicSettings({
        ui: patch,
      } as Partial<Settings>);
      setSettings(updated);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Failed to save setting", "error");
      void loadAll();
    }
  };

  const onSessionCompleted = (result: SessionStopResult, source: "normal" | "quick") => {
    const ui = (settings?.ui ?? {}) as Settings["ui"];
    const levelNotifyOn = ui.notify_level_up !== false;
    const levelFxOn = ui.fx_level_up_overlay ?? ui.enable_confetti ?? true;
    const summaryLike = (result as SessionStopResult & { summary?: { total_duration_min?: number; total_xp?: number } }).summary;
    const chainSummary = result.session_chain || null;
    const summarizedDuration = Number(summaryLike?.total_duration_min ?? chainSummary?.total_duration_min ?? 0);
    const summarizedXp = Number(summaryLike?.total_xp ?? chainSummary?.total_xp ?? 0);
    const durationMin = Math.max(
      0,
      summarizedDuration || Number(result.event?.duration_min || (source === "quick" ? 10 : 0))
    );
    const gainedXp = summarizedXp || Number(result.xp_breakdown?.total_xp || 0);
    const beforeLevel = Math.max(1, Number(result.before_level || 1));
    const afterLevel = Math.max(1, Number(result.after_level || beforeLevel));
    const gamification = result.gamification || {};
    const sessionMessage =
      String(gamification.session_message || result.coach_message || "").trim() ||
      (lang === "ko" ? "리듬 상승 완료. 다음 라운드 준비!" : "Rhythm boost complete. Queue the next run!");
    const levelMessage =
      String(gamification.level_message || "").trim() ||
      (lang === "ko" ? "새 티어가 열렸습니다." : "A new tier has opened.");
    prevLevelRef.current = Math.max(prevLevelRef.current, afterLevel);
    if (result.level_up && afterLevel > beforeLevel) {
      if (levelNotifyOn && !levelFxOn) {
        pushToast({
          lane: "top-right",
          type: "success",
          style: "quest",
          title: lang === "ko" ? `레벨업! Lv.${afterLevel}` : `Level up! Lv.${afterLevel}`,
          subtitle: levelMessage,
          timeout: 4200,
        });
      }
      if (levelFxOn) {
        enqueueFx({
          kind: "level",
          level: afterLevel,
          beforeLevel,
          afterLevel,
          title: lang === "ko" ? `LEVEL UP! Lv.${afterLevel}` : `LEVEL UP! Lv.${afterLevel}`,
          subtitle: levelMessage,
          tierUp: gamification.tier_up === true,
          beforeTier: String(gamification.before_tier || "bronze"),
          afterTier: String(gamification.after_tier || "bronze"),
          tierColor: String(gamification.tier_color || "#4f7cff"),
          badgeBefore: String(gamification.badge_before || ""),
          badgeAfter: String(gamification.badge_after || ""),
        });
      }
    }
    const isQuick = durationMin <= 10 || source === "quick";
    const shouldFx = isQuick ? ui.fx_session_complete_quick === true : ui.fx_session_complete_normal !== false;
    if (durationMin <= 0 && gainedXp <= 0) return;
    if (!shouldFx) return;
    enqueueFx({
      kind: "session",
      title: lang === "ko" ? "세션 완료!" : "Session Complete!",
      subtitle: isQuick ? (lang === "ko" ? "빠른 세션" : "Quick Session") : (lang === "ko" ? "일반 세션" : "Standard Session"),
      durationMin,
      gainedXp,
      cheer: sessionMessage,
    });
  };

  const onQuestClaimed = (_questTitle: string) => {
    // Intentionally silent: claim notifications are disabled by design.
  };

  const onAchievementClaimed = (_payload: { name: string; description?: string; icon?: string }) => {
    // Intentionally silent: claim notifications are disabled by design.
  };

  const navGroups: Array<{ id: NavGroupId; title: string; tabs: Array<{ id: TabId; label: string }> }> = useMemo(
    () => [
      {
        id: "challenge",
        title: lang === "ko" ? "도전" : "Challenges",
        tabs: [
          { id: "quests", label: t(lang, "questsPage") },
          { id: "achievements", label: t(lang, "achievements") }
        ]
      },
      {
        id: "library",
        title: lang === "ko" ? "라이브러리" : "Library",
        tabs: [
          { id: "songs", label: lang === "ko" ? "곡" : "Songs" },
          { id: "drills", label: lang === "ko" ? "드릴/배킹트랙" : "Drills/Backing" },
          { id: "recommend", label: lang === "ko" ? "추천곡" : "Recommendations" },
        ]
      },
      {
        id: "tools",
        title: lang === "ko" ? "연습 도구" : "Practice Tools",
        tabs: [{ id: "tools", label: lang === "ko" ? "TAB 생성기" : "TAB Builder" }],
      },
      {
        id: "records",
        title: lang === "ko" ? "기록" : "Records",
        tabs: [
          { id: "review", label: lang === "ko" ? "돌아보기" : "Review" },
          { id: "xp", label: lang === "ko" ? "XP기록" : "XP Log" },
          { id: "sessions", label: lang === "ko" ? "세션 기록" : "Sessions" },
        ]
      }
    ],
    [lang]
  );

  const priorityTabs: Array<{ id: TabId; label: string }> = useMemo(
    () => [
      { id: "dashboard", label: t(lang, "dashboard") },
      { id: "practice", label: lang === "ko" ? "연습 스튜디오" : "Practice Studio" },
      { id: "gallery", label: lang === "ko" ? "기록장" : "Journal" },
    ],
    [lang]
  );

  useShortcutLayer({
    priority: 100,
    handlers: Object.fromEntries(
      TAB_SHORTCUT_ACTIONS.map(({ action, tab: nextTab }) => [
        action,
        () => {
          switchTab(nextTab);
        },
      ])
    ) as Partial<Record<ShortcutActionId, (event: KeyboardEvent) => void>>,
  });

  useShortcutLayer(
    activeFx
      ? {
          priority: 650,
          allowInEditable: true,
          handlers: {
            popup_close: () => {
              setActiveFx(null);
            },
          },
        }
      : null
  );

  useShortcutLayer(
    activeSessionId && tab !== "practice"
      ? {
          priority: 400,
          allowInEditable: true,
          handlers: {
            metronome_toggle: () => {
              void metronome.toggle();
            },
            video_toggle: () => {
              if (!sessionPipVideoControls?.canControl) return false;
              sessionPipVideoControls.togglePlayback();
            },
            video_restart: () => {
              if (!sessionPipVideoControls?.canControl) return false;
              sessionPipVideoControls.restart();
            },
            video_pin_save: () => {
              if (!sessionPipVideoControls?.canControl) return false;
              sessionPipVideoControls.savePinAtCurrent();
            },
            video_pin_jump: () => {
              if (!sessionPipVideoControls?.canControl) return false;
              sessionPipVideoControls.jumpToPin();
            },
            video_pin_clear: () => {
              if (!sessionPipVideoControls?.canControl) return false;
              sessionPipVideoControls.clearPin();
            },
            pip_video_toggle: () => {
              if (!sessionPipVideo) return false;
              setSessionPipVideoOpen((prev) => !prev);
            },
            pip_collapse_toggle: () => {
              setSessionPipCollapsed((prev) => !prev);
            },
            pip_open_studio: () => {
              switchTab("practice");
            },
            pip_stop_session: () => {
              setShowGlobalStopModal(true);
            },
          },
        }
      : null
  );

  const globalStopDrills = useMemo(() => {
    if (!catalogs) return [];
    const seen = new Set<string>();
    return [...catalogs.drills, ...catalogs.drill_library].filter((item) => {
      const id = String(item.drill_id || "").trim();
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }, [catalogs]);

  const sessionPipTaskLabel = useMemo(() => {
    const active = hud?.active_session;
    if (!active?.session_id) return activityName(undefined, lang);
    if (active.song_library_id) {
      const song = catalogs?.song_library.find((item) => String(item.library_id || "") === String(active.song_library_id || ""));
      return String(song?.title || active.song_library_id || activityName(active.activity, lang));
    }
    if (active.drill_id) {
      const drill = [...(catalogs?.drills || []), ...(catalogs?.drill_library || [])].find(
        (item) => String(item.drill_id || "") === String(active.drill_id || "")
      );
      return String(drill?.name || active.drill_id || activityName(active.activity, lang));
    }
    const rawActivity = String(active.activity || "").trim().toLowerCase();
    const rawSubActivity = String(active.sub_activity || "").trim().toLowerCase();
    if (rawActivity === "etc") {
      if (!rawSubActivity || rawSubActivity === "etc") return activityName(undefined, lang);
      if (rawSubActivity === "songdiscovery") return lang === "ko" ? "곡 탐색" : "Song discovery";
      if (rawSubActivity === "community") return lang === "ko" ? "커뮤니티" : "Community";
      if (rawSubActivity === "gear") return lang === "ko" ? "장비" : "Gear";
    }
    return activityName(active.activity, lang);
  }, [catalogs, hud?.active_session, lang]);

  const beginSessionPipDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!activeSessionId) return;
    if (isPipDragBlockedTarget(event.target)) return;
    const node = sessionPipRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    const nextPosition = clampPipPosition(
      { left: rect.left, top: rect.top },
      rect.width || node.offsetWidth || 0,
      rect.height || node.offsetHeight || 0
    );
    setSessionPipPosition(nextPosition);
    sessionPipDragRef.current = {
      pointerId: event.pointerId,
      offsetX,
      offsetY,
      width: rect.width || node.offsetWidth || 0,
      height: rect.height || node.offsetHeight || 0,
    };
    setSessionPipDragging(true);
    node.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const moveSessionPip = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = sessionPipDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const next = clampPipPosition(
      { left: event.clientX - drag.offsetX, top: event.clientY - drag.offsetY },
      drag.width,
      drag.height
    );
    setSessionPipPosition(next);
  };

  const endSessionPipDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = sessionPipDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    sessionPipDragRef.current = null;
    setSessionPipDragging(false);
    if (sessionPipRef.current?.hasPointerCapture(event.pointerId)) {
      sessionPipRef.current.releasePointerCapture(event.pointerId);
    }
  };

  const sessionPipStyle: CSSProperties | undefined = sessionPipPosition
    ? {
        left: `${sessionPipPosition.left}px`,
        top: `${sessionPipPosition.top}px`,
        right: "auto",
        bottom: "auto",
      }
    : undefined;

  if (!settings || !hud || !catalogs) {
    return <div className="screen-center">Loading BassOS...</div>;
  }

  const startupTheme = settings.profile.onboarded ? settings.ui.default_theme ?? "studio" : "studio";

  return (
    <div className={`app-root theme-${startupTheme}`}>
        {!settings.profile.onboarded ? (
          <OnboardingWizard
            lang={lang}
            onComplete={async (payload) => {
              await completeOnboarding(payload);
              await loadAll();
              notify(lang === "ko" ? "온보딩 완료" : "Onboarding completed", "success");
            }}
          />
        ) : null}

        <aside className="sidebar">
          <div className="logo-panel">
            <h1>BassOS</h1>
            <p>Practice Game OS</p>
          </div>
          <nav>
            <div className="nav-group">
              <small className="nav-group-title">{lang === "ko" ? "핵심" : "Core"}</small>
              {priorityTabs.map((item) => (
                <button
                  key={item.id}
                  className={`nav-btn nav-btn-priority ${tab === item.id ? "active" : ""}`}
                  onClick={() => switchTab(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            {navGroups.map((group) => (
              <div key={group.id} className={`nav-subgroup ${navOpen[group.id] ? "open" : "collapsed"}`}>
                <button
                  className="nav-group-toggle"
                  onClick={() => setNavOpen((prev) => ({ ...prev, [group.id]: !prev[group.id] }))}
                >
                  <small className="nav-group-title">{group.title}</small>
                  <span>{navOpen[group.id] ? "−" : "+"}</span>
                </button>
                {navOpen[group.id]
                  ? group.tabs.map((item) => (
                      <button key={item.id} className={`nav-btn ${tab === item.id ? "active" : ""}`} onClick={() => switchTab(item.id)}>
                        {item.label}
                      </button>
                    ))
                  : null}
              </div>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <button
              className={`nav-btn ${tab === "settings" ? "active" : ""}`}
              data-testid="sidebar-settings-btn"
              onClick={() => switchTab("settings")}
            >
              {lang === "ko" ? "⚙ 설정" : "⚙ Settings"}
            </button>
            <button
              className="ghost-btn sidebar-guide-btn"
              data-testid="tutorial-help-btn"
              onClick={() =>
                void openTutorial(
                  CORE_CAMPAIGN_ID,
                  Boolean(
                    tutorialState &&
                      !tutorialState.completed &&
                      Number(tutorialState.resume_step_index ?? 0) > 0
                  )
                )
              }
            >
              {lang === "ko" ? "가이드" : "Guide"}
            </button>
          </div>
        </aside>

        <main
          ref={contentRef}
          className={`content ${tab === "dashboard" ? "content-dashboard" : ""} ${tab === "quests" ? "content-quests" : ""} ${tab === "xp" ? "content-xp" : ""} ${
            tab === "review" || tab === "xp" || tab === "sessions" ? "content-records" : ""
          } ${tab === "review" ? "content-record-review" : ""} ${tab === "xp" ? "content-record-xp" : ""} ${
            tab === "sessions" ? "content-record-sessions" : ""
          }`}
        >
          <header className="topbar">
            <div>
              <strong>{settings.profile.nickname || "Bassist"}</strong>
              <span className="muted">
                Lv.{hud.level} {hud.rank} {hud.level_title ? `· ${hud.level_title}` : ""}
              </span>
              {settings.profile.guide_finisher_unlocked ? (
                <small className="muted tutorial-title-chip">
                  {lang === "ko" ? "칭호: 가이드 완주자" : "Title: Guide Finisher"}
                </small>
              ) : null}
            </div>
            <div className="topbar-actions" />
          </header>

          {activeSessionId && tab !== "practice" ? (
            <div
              ref={sessionPipRef}
              className={`session-timer-pip ${sessionPipDragging ? "dragging" : ""} ${sessionPipCollapsed ? "collapsed" : ""}`}
              style={sessionPipStyle}
              data-testid="global-session-pip"
              onPointerMove={moveSessionPip}
              onPointerUp={endSessionPipDrag}
              onPointerCancel={endSessionPipDrag}
            >
              <div className="session-timer-pip-drag-handle" onPointerDown={beginSessionPipDrag}>
                <div className="session-timer-pip-title">
                  {lang === "ko" ? "세션 진행중" : "Session Active"} - {sessionPipTaskLabel}
                </div>
                <div className="session-timer-pip-head">
                  <strong>{fmtSec(sessionPipElapsedSec)}</strong>
                  <div className="session-timer-pip-actions">
                    <button
                      type="button"
                      className="ghost-btn compact-add-btn"
                      data-testid="global-session-pip-collapse"
                      onClick={() => setSessionPipCollapsed((prev) => !prev)}
                    >
                      {sessionPipCollapsed ? (lang === "ko" ? "펼치기" : "Expand") : (lang === "ko" ? "접기" : "Collapse")}
                    </button>
                    <button
                      type="button"
                      className="ghost-btn compact-add-btn"
                      data-testid="global-session-pip-studio"
                      onClick={() => switchTab("practice")}
                      title={lang === "ko" ? "연습 스튜디오로 이동" : "Go to practice studio"}
                    >
                      {lang === "ko" ? "스튜디오" : "Studio"}
                    </button>
                    <button
                      type="button"
                      className={`ghost-btn compact-add-btn ${sessionPipVideoOpen ? "active-mini" : ""}`}
                      data-testid="global-session-pip-video-toggle"
                      onClick={() => setSessionPipVideoOpen((prev) => !prev)}
                      disabled={!sessionPipVideo}
                    >
                      {lang === "ko" ? "영상" : "Video"}
                    </button>
                    <button
                      type="button"
                      className="danger-btn session-timer-pip-stop"
                      data-testid="global-session-pip-stop"
                      onClick={() => setShowGlobalStopModal(true)}
                    >
                      {lang === "ko" ? "종료" : "Stop"}
                    </button>
                  </div>
                </div>
              </div>
              {!sessionPipCollapsed ? (
                <>
                  <MetronomePipPanel placement="inline" visible forceVisible />
                  {sessionPipVideoOpen ? (
                    sessionPipVideo ? (
                      <div className="session-timer-pip-video" data-testid="global-session-pip-video">
                        <div className="session-timer-pip-video-meta">
                          <span>
                            <strong>{sessionPipVideo.title}</strong>
                            <small>{sessionPipVideo.subtitle}</small>
                          </span>
                          {sessionPipVideo.sourceUrl ? (
                            <button
                              type="button"
                              className="ghost-btn compact-add-btn"
                              onClick={() => window.open(sessionPipVideo.sourceUrl, "_blank", "noopener,noreferrer")}
                            >
                              {lang === "ko" ? "원본" : "Source"}
                            </button>
                          ) : null}
                        </div>
                        <div className="session-timer-pip-video-controls">
                          <button
                            type="button"
                            className="ghost-btn compact-add-btn"
                            onClick={() => sessionPipVideoControls?.togglePlayback()}
                            disabled={!sessionPipVideoControls?.canControl}
                          >
                            {sessionPipVideoControls?.isPlaying
                              ? (lang === "ko" ? "일시정지" : "Pause")
                              : (lang === "ko" ? "재생" : "Play")}
                          </button>
                          <button
                            type="button"
                            className="ghost-btn compact-add-btn"
                            onClick={() =>
                              sessionPipVideoControls?.hasPin
                                ? sessionPipVideoControls?.jumpToPin()
                                : sessionPipVideoControls?.restart()
                            }
                            disabled={!sessionPipVideoControls?.canControl}
                          >
                            {sessionPipVideoControls?.hasPin
                              ? (lang === "ko" ? "핀으로" : "To Pin")
                              : (lang === "ko" ? "처음으로" : "Restart")}
                          </button>
                          <button
                            type="button"
                            className="ghost-btn compact-add-btn"
                            onClick={() => sessionPipVideoControls?.savePinAtCurrent()}
                            disabled={!sessionPipVideoControls?.canControl}
                          >
                            {lang === "ko" ? "핀 저장" : "Pin"}
                          </button>
                          {!sessionPipVideoControls?.canControl ? (
                            <small className="muted">
                              {lang === "ko"
                                ? "스튜디오 영상이 준비되면 PiP 제어를 사용할 수 있습니다."
                                : "PiP controls are available when studio video is ready."}
                            </small>
                          ) : null}
                        </div>
                      </div>
                    ) : (
                      <div className="session-timer-pip-video session-timer-pip-video-empty">
                        <div className="session-timer-pip-video-fallback">♪</div>
                        <small className="muted">
                          {lang === "ko"
                            ? "현재 세션에 연결된 영상을 찾을 수 없습니다."
                            : "No linked video for the current session."}
                        </small>
                      </div>
                    )
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}

          {tab === "dashboard" ? (
            <DashboardPage
              lang={lang}
              hud={hud}
              quests={quests}
              catalogs={catalogs}
              settings={settings}
              achievements={achievements}
              recentAchievements={recentAchievements}
              gallery={gallery}
              onRefresh={loadAll}
              notify={notify}
              onNavigate={(nextTab) => switchTab(nextTab)}
              onSettingsChange={setSettings}
              onSessionCompleted={onSessionCompleted}
              onQuestClaimed={onQuestClaimed}
            />
          ) : null}
          <div className={`practice-page-shell ${tab === "practice" ? "active" : "inactive"}`}>
            <PracticeStudioPage
              lang={lang}
              hud={hud}
              catalogs={catalogs}
              backingTracks={catalogs.backing_tracks}
              onRefresh={loadAll}
              notify={notify}
              isActive={tab === "practice"}
              pipMode={settings.ui.practice_video_pip_mode ?? "mini"}
              tabSwitchPlayback={settings.ui.practice_video_tab_switch_playback ?? "continue"}
              onSessionPipVideoChange={handleSessionPipVideoChange}
              onSessionPipVideoControlChange={handleSessionPipVideoControlChange}
              onSessionCompleted={(result) => onSessionCompleted(result, "normal")}
              xpDisplayScale={xpDisplayScale}
            />
          </div>
          {tab === "tools" ? <PracticeToolsPage lang={lang} /> : null}
          {tab === "recommend" ? (
            <RecommendationsPage
              lang={lang}
              ladder={catalogs.song_ladder}
              library={catalogs.song_library}
              settings={settings}
              onRefresh={loadAll}
              onOpenLibrary={() => switchTab("songs")}
              setMessage={(msg) => notify(msg, "success")}
            />
          ) : null}
          {tab === "sessions" ? <SessionsPage lang={lang} settings={settings} notify={notify} onRefresh={loadAll} /> : null}
          {tab === "review" ? (
            <ReviewPage
              lang={lang}
              refreshToken={hud.total_xp}
              catalogs={{
                song_library: catalogs.song_library,
                drill_library: catalogs.drill_library,
              }}
            />
          ) : null}
          {tab === "xp" ? <XPPage lang={lang} refreshToken={hud.total_xp} settings={settings} onSettingsChange={setSettings} /> : null}
          {tab === "quests" ? (
            <QuestsPage
              lang={lang}
              notify={notify}
              onRefresh={loadAll}
              onQuestClaimed={(quest) => onQuestClaimed(quest.title || (lang === "ko" ? "퀘스트" : "Quest"))}
            />
          ) : null}
          {tab === "achievements" ? (
            <AchievementsPage
              lang={lang}
              settings={settings}
              items={achievements}
              onRefresh={loadAll}
              setMessage={(msg) => notify(msg, "success")}
              onAchievementClaimed={onAchievementClaimed}
            />
          ) : null}
          {tab === "songs" ? (
            <SongsPage
              lang={lang}
              items={catalogs.song_library}
              ladder={catalogs.song_ladder}
              settings={settings}
              onSettingsChange={setSettings}
              onRefresh={loadAll}
              setMessage={(msg) => notify(msg, "success")}
            />
          ) : null}
          {tab === "drills" ? (
            <DrillLibraryPage
              lang={lang}
              items={catalogs.drill_library}
              backingTracks={catalogs.backing_tracks}
              onRefresh={loadAll}
              setMessage={(msg) => notify(msg, "success")}
            />
          ) : null}
          {tab === "gallery" ? (
            <GalleryPage
              lang={lang}
              catalogs={catalogs}
              settings={settings}
              onSettingsChange={setSettings}
              onRefresh={loadAll}
              setMessage={(msg) => notify(msg, "success")}
            />
          ) : null}
          {tab === "settings" ? (
            <SettingsPage
              lang={lang}
              settings={settings}
              hud={hud}
              unlockables={unlockables}
              onSettingsChange={setSettings}
              setMessage={(msg) => notify(msg, "success")}
              onRefresh={loadAll}
            />
          ) : null}

          <SessionStopModal
            open={showGlobalStopModal}
            lang={lang}
            xpDisplayScale={xpDisplayScale}
            songs={catalogs.song_library}
            drills={globalStopDrills}
            activeSession={hud.active_session}
            testIdPrefix="global"
            notify={notify}
            onClose={() => setShowGlobalStopModal(false)}
            onSaved={async (result) => {
              onSessionCompleted(result, "normal");
              await loadAll();
            }}
            onDiscarded={async () => {
              await loadAll();
            }}
          />

          {tutorialRuntime ? (
            <TutorialOverlay
              lang={lang}
              open={Boolean(tutorialRuntime)}
              campaignLabel={tutorialRuntime.campaign.label[lang]}
              steps={tutorialRuntime.campaign.steps}
              stepIndex={tutorialRuntime.stepIndex}
              onPrev={() => void moveTutorialStep("prev")}
              onNext={() => void moveTutorialStep("next")}
              onClose={() => void closeTutorial()}
              onComplete={() => void finishTutorial()}
            />
          ) : null}

          {busy ? <div className="busy-indicator">Syncing...</div> : null}

          <div className="toast-stack toast-stack-top">
            {toasts
              .filter((toast) => toast.lane === "top-right")
              .map((toast) => (
                <div
                  key={toast.id}
                  className={`toast ${toast.type} ${toast.style === "quest" ? "toast-quest" : toast.style === "achievement" ? "toast-achievement" : ""}`}
                >
                  <strong>{toast.title}</strong>
                  {toast.subtitle ? <small>{toast.subtitle}</small> : null}
                </div>
              ))}
          </div>

          <div className="toast-stack toast-stack-bottom">
            {toasts
              .filter((toast) => toast.lane === "bottom-right")
              .map((toast) => (
                <div
                  key={toast.id}
                  className={`toast ${toast.type} ${toast.style === "quest" ? "toast-quest" : toast.style === "achievement" ? "toast-achievement" : ""}`}
                >
                  {toast.style === "achievement" ? (
                    <>
                      <div className="toast-achievement-icon-wrap">
                        {toast.icon ? (
                          <img src={toast.icon} alt="achievement icon" className="toast-achievement-icon" />
                        ) : (
                          <span className="toast-achievement-fallback">★</span>
                        )}
                      </div>
                      <div className="toast-achievement-copy">
                        <strong>{toast.title}</strong>
                        {toast.subtitle ? <small>{toast.subtitle}</small> : null}
                      </div>
                    </>
                  ) : (
                    <>
                      <strong>{toast.title}</strong>
                      {toast.subtitle ? <small>{toast.subtitle}</small> : null}
                    </>
                  )}
                </div>
              ))}
          </div>

          {activeFx ? (
            <div
              key={activeFx.id}
              className={`global-fx-overlay fx-${activeFx.kind}`}
              onClick={() => setActiveFx(null)}
              role="button"
              tabIndex={0}
            >
              {activeFx.kind === "level" ? (
                <div className="confetti-layer">
                  {Array.from({ length: 56 }).map((_, index) => (
                    <span
                      key={`${activeFx.id}_confetti_${index}`}
                      className={`confetti confetti-${index % 4}`}
                      style={{
                        left: `${(index * 17) % 100}%`,
                        animationDelay: `${(index % 8) * 70}ms`,
                        animationDuration: `${1000 + (index % 5) * 220}ms`,
                      }}
                    />
                  ))}
                </div>
              ) : null}
              {activeFx.kind === "session" ? (
                <div className="firework-layer" aria-hidden>
                  <span className="firework firework-a" />
                  <span className="firework firework-b" />
                  <span className="firework firework-c" />
                </div>
              ) : null}
              <div
                className={`global-fx-card global-fx-${activeFx.kind} ${activeFx.kind === "level" && activeFx.tierUp ? "global-fx-tier-up" : ""}`}
                style={
                  activeFx.kind === "level"
                    ? ({
                        ["--fx-tier-color" as string]: activeFx.tierColor || "#4f7cff",
                      } as CSSProperties)
                    : undefined
                }
                onClick={(event) => event.stopPropagation()}
              >
                {activeFx.kind === "level" ? (
                  <>
                    {(() => {
                      const beforeLevel = Math.max(1, Number(activeFx.beforeLevel || activeFx.level - 1));
                      const afterLevel = Math.max(beforeLevel, Number(activeFx.afterLevel || activeFx.level));
                      const beforeTier = fxBadgeTier(beforeLevel);
                      const afterTier = fxBadgeTier(afterLevel);
                      const beforeStep = Math.min(10, fxBadgeStep(beforeLevel));
                      const afterStep = Math.min(10, fxBadgeStep(afterLevel));
                      return (
                        <div className={`fx-level-badge-flow ${activeFx.tierUp ? "tier-up" : ""}`}>
                          <div className="fx-level-badge-stage">
                            <div className={`hud-emblem hud-emblem-fx tier-${beforeTier} step-${beforeStep}`}>
                              <span className="emblem-core" />
                              {beforeStep >= 2 ? <span className="emblem-ring ring-1" /> : null}
                              {beforeStep >= 4 ? <span className="emblem-ring ring-2" /> : null}
                              {beforeStep >= 6 ? <span className="emblem-wing left" /> : null}
                              {beforeStep >= 7 ? <span className="emblem-wing right" /> : null}
                              {beforeStep >= 8 ? <span className="emblem-gem" /> : null}
                              {beforeStep >= 10 ? <span className="emblem-crown" /> : null}
                            </div>
                            <small>{fxTierLabel(beforeTier, lang)} · Lv.{beforeLevel}</small>
                          </div>
                          <span className="tier-badge-arrow">→</span>
                          <div className="fx-level-badge-stage fx-level-badge-stage-next">
                            <div className={`hud-emblem hud-emblem-fx tier-${afterTier} step-${afterStep}`}>
                              <span className="emblem-core" />
                              {afterStep >= 2 ? <span className="emblem-ring ring-1" /> : null}
                              {afterStep >= 4 ? <span className="emblem-ring ring-2" /> : null}
                              {afterStep >= 6 ? <span className="emblem-wing left" /> : null}
                              {afterStep >= 7 ? <span className="emblem-wing right" /> : null}
                              {afterStep >= 8 ? <span className="emblem-gem" /> : null}
                              {afterStep >= 10 ? <span className="emblem-crown" /> : null}
                            </div>
                            <small>{fxTierLabel(afterTier, lang)} · Lv.{afterLevel}</small>
                          </div>
                        </div>
                      );
                    })()}
                    <small>{lang === "ko" ? "레벨 상승" : "Level Up"}</small>
                    <strong>{activeFx.title}</strong>
                    <p>{activeFx.subtitle}</p>
                  </>
                ) : (
                  <>
                    <small>{activeFx.subtitle}</small>
                    <strong>{activeFx.title}</strong>
                    <p>
                      {lang === "ko"
                        ? `총 ${activeFx.durationMin}분 · +${formatDisplayXp(activeFx.gainedXp, xpDisplayScale)} XP`
                        : `${activeFx.durationMin} min · +${formatDisplayXp(activeFx.gainedXp, xpDisplayScale)} XP`}
                    </p>
                    <em>{activeFx.cheer}</em>
                  </>
                )}
              </div>
            </div>
          ) : null}
        </main>
      </div>
  );
}

export default function App() {
  return (
    <MetronomeProvider>
      <ShortcutRouterProvider>
        <AppBody />
      </ShortcutRouterProvider>
    </MetronomeProvider>
  );
}
