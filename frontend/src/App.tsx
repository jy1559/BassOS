import { useEffect, useMemo, useRef, useState } from "react";
import {
  completeTutorial,
  completeOnboarding,
  getAchievements,
  getCatalogs,
  getDrillLibrary,
  getGallery,
  getHudSummary,
  getQuests,
  getRecentAchievements,
  getSettings,
  getTutorialState,
  getUnlockables,
  putBasicSettings,
  saveTutorialProgress,
  startTutorial,
} from "./api";
import { t, type Lang } from "./i18n";
import type {
  Achievement,
  AchievementRecent,
  GalleryItem,
  HudSummary,
  Quest,
  Settings,
  TutorialState,
} from "./types/models";
import { AchievementsPage } from "./pages/AchievementsPage";
import { DashboardPage } from "./pages/DashboardPage";
import { DrillLibraryPage } from "./pages/DrillLibraryPage";
import { GalleryPage } from "./pages/GalleryPage";
import { OnboardingWizard } from "./pages/OnboardingWizard";
import { PracticeStudioPage } from "./pages/PracticeStudioPage";
import { PracticeToolsPage } from "./pages/PracticeToolsPage";
import { QuestsPage } from "./pages/QuestsPage";
import { RecommendationsPage } from "./pages/RecommendationsPage";
import { ReviewPage } from "./pages/ReviewPage";
import { SessionsPage } from "./pages/SessionsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SongsPage } from "./pages/SongsPage";
import { XPPage } from "./pages/XPPage";
import { TutorialOverlay } from "./components/tutorial/TutorialOverlay";
import { GlobalMetronomeDock, MetronomeProvider } from "./metronome";
import { CORE_CAMPAIGN_ID, DEEP_DIVE_CAMPAIGNS, getTutorialCampaign } from "./tutorial/campaigns";
import type { TutorialCampaign } from "./tutorial/types";

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

type Toast = { id: number; text: string; type: "success" | "error" | "info" };
type CelebrateType = "level" | "achievement";
type Celebrate = { id: number; type: CelebrateType; title: string; subtitle: string };
type TutorialRuntime = { campaign: TutorialCampaign; stepIndex: number };

function preventBrowserReload() {
  window.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if (key === "f5" || (event.ctrlKey && key === "r")) {
      event.preventDefault();
    }
  });
}

export default function App() {
  const [tab, setTab] = useState<TabId>("dashboard");
  const [navOpen, setNavOpen] = useState<Record<NavGroupId, boolean>>({
    tools: false,
    library: true,
    records: false,
    challenge: false,
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
  const [celebrate, setCelebrate] = useState<Celebrate | null>(null);

  const signalReadyRef = useRef(false);
  const prevLevelRef = useRef(0);
  const prevRecentKeyRef = useRef("");

  const lang = (settings?.ui?.language ?? "ko") as Lang;

  const notify = (text: string, type: "success" | "error" | "info" = "info") => {
    const id = Date.now() + Math.floor(Math.random() * 10000);
    setToasts((prev) => [...prev, { id, text, type }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, 2600);
  };

  const emitCelebrate = (type: CelebrateType, title: string, subtitle: string) => {
    setCelebrate({ id: Date.now() + Math.floor(Math.random() * 1000), type, title, subtitle });
  };

  const applySignals = (nextHud: HudSummary, nextRecent: AchievementRecent[]) => {
    const uiLang = (settings?.ui?.language ?? "ko") as Lang;
    const latest = nextRecent[0];
    const latestKey = latest ? `${latest.achievement_id}:${latest.created_at}` : "";

    if (!signalReadyRef.current) {
      signalReadyRef.current = true;
      prevLevelRef.current = nextHud.level;
      prevRecentKeyRef.current = latestKey;
      return;
    }

    if (nextHud.level > prevLevelRef.current) {
      notify(uiLang === "ko" ? `레벨업! Lv.${nextHud.level}` : `Level up! Lv.${nextHud.level}`, "success");
      emitCelebrate(
        "level",
        uiLang === "ko" ? `레벨 ${nextHud.level} 달성` : `Reached Lv.${nextHud.level}`,
        uiLang === "ko" ? "지금 텐션 좋습니다. 다음 구간도 그대로 갑시다." : "Strong pace. Keep the groove going."
      );
    }
    prevLevelRef.current = nextHud.level;

    if (latestKey && latestKey !== prevRecentKeyRef.current) {
      notify(uiLang === "ko" ? `업적 달성: ${latest.name}` : `Achievement unlocked: ${latest.name}`, "success");
      emitCelebrate(
        "achievement",
        uiLang === "ko" ? "업적 달성" : "Achievement Unlocked",
        latest.name || (uiLang === "ko" ? "새 업적" : "New achievement")
      );
    }
    if (latestKey) prevRecentKeyRef.current = latestKey;
  };

  const deepDiveOptions = useMemo(
    () =>
      DEEP_DIVE_CAMPAIGNS.map((item) => ({
        id: item.id,
        label: item.label[lang],
      })),
    [lang]
  );

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
      setTab(campaign.steps[nextIndex]?.tab as TabId);
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
    setTab(tutorialRuntime.campaign.steps[nextIndex]?.tab as TabId);
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
            ? `가이드 완주! +${result.xp_granted}XP, 칭호 [가이드 완주자] 획득.`
            : `Guide complete! +${result.xp_granted} XP and title unlocked.`,
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
      applySignals(nextHud, nextRecentAchievements);
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
      void Promise.all([getHudSummary(), getRecentAchievements(5)])
        .then(([nextHud, nextRecent]) => {
          setHud(nextHud);
          setRecentAchievements(nextRecent);
          applySignals(nextHud, nextRecent);
        })
        .catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(interval);
  }, [settings?.ui?.language]);

  useEffect(() => {
    if (!celebrate) return;
    const timer = window.setTimeout(() => setCelebrate(null), 2100);
    return () => window.clearTimeout(timer);
  }, [celebrate]);

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

  if (!settings || !hud || !catalogs) {
    return <div className="screen-center">Loading BassOS...</div>;
  }

  return (
    <MetronomeProvider>
      <div className={`app-root theme-${settings.ui.default_theme ?? "studio"}`}>
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
                  onClick={() => setTab(item.id)}
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
                      <button key={item.id} className={`nav-btn ${tab === item.id ? "active" : ""}`} onClick={() => setTab(item.id)}>
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
              onClick={() => setTab("settings")}
            >
              {lang === "ko" ? "⚙ 설정" : "⚙ Settings"}
            </button>
            <button
              className="ghost-btn sidebar-guide-btn"
              data-testid="tutorial-help-btn"
              onClick={() => void openTutorial(CORE_CAMPAIGN_ID, false)}
            >
              {lang === "ko" ? "? 가이드" : "? Guide"}
            </button>
          </div>
        </aside>

        <main
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
            <div className="topbar-actions">
              <GlobalMetronomeDock />
              <button
                className="ghost-btn"
                onClick={async () => {
                  const next = settings.ui.language === "ko" ? "en" : "ko";
                  const updated = await putBasicSettings({ ui: { ...settings.ui, language: next } });
                  setSettings(updated);
                }}
              >
                {settings.ui.language === "ko" ? "EN" : "KO"}
              </button>
            </div>
          </header>

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
              onNavigate={(nextTab) => setTab(nextTab)}
              onSettingsChange={setSettings}
            />
          ) : null}
          {tab === "practice" ? (
            <PracticeStudioPage
              lang={lang}
              hud={hud}
              catalogs={catalogs}
              backingTracks={catalogs.backing_tracks}
              onRefresh={loadAll}
              notify={notify}
            />
          ) : null}
          {tab === "tools" ? <PracticeToolsPage lang={lang} /> : null}
          {tab === "recommend" ? (
            <RecommendationsPage
              lang={lang}
              ladder={catalogs.song_ladder}
              library={catalogs.song_library}
              settings={settings}
              onRefresh={loadAll}
              onOpenLibrary={() => setTab("songs")}
              setMessage={(msg) => notify(msg, "success")}
            />
          ) : null}
          {tab === "sessions" ? <SessionsPage lang={lang} notify={notify} onRefresh={loadAll} /> : null}
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
          {tab === "quests" ? <QuestsPage lang={lang} notify={notify} onRefresh={loadAll} /> : null}
          {tab === "achievements" ? (
            <AchievementsPage
              lang={lang}
              settings={settings}
              items={achievements}
              onRefresh={loadAll}
              setMessage={(msg) => notify(msg, "success")}
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
              tutorialSummary={{
                core_completed: Boolean(tutorialState?.completed),
                core_resume_step_index: Number(tutorialState?.resume_step_index ?? 0),
                deep_dive_options: deepDiveOptions,
                guide_finisher_unlocked: Boolean(settings.profile.guide_finisher_unlocked),
              }}
              onStartTutorial={(campaignId, resume) => void openTutorial(campaignId, resume)}
            />
          ) : null}

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

          <div className="toast-stack">
            {toasts.map((toast) => (
              <div key={toast.id} className={`toast ${toast.type}`}>
                {toast.text}
              </div>
            ))}
          </div>

          {celebrate ? (
            <div key={celebrate.id} className={`global-celebrate ${celebrate.type}`}>
              <strong>{celebrate.title}</strong>
              <small>{celebrate.subtitle}</small>
            </div>
          ) : null}
        </main>
      </div>
    </MetronomeProvider>
  );
}
