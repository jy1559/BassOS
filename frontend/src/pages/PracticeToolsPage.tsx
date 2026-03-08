import { useEffect, useState } from "react";
import type { Lang } from "../i18n";
import { PracticeToolsTabBuilder } from "./PracticeToolsTabBuilder";
import { MinigameShadowSurface } from "../practiceTools/minigame/MinigameShadowSurface";
import { getUserSettings, putUserSettings } from "../practiceTools/minigame/api";
import { CodeReferencePage } from "../practiceTools/minigame/pages/CodeReferencePage";
import { MiniGameSettingsPage } from "../practiceTools/minigame/pages/MiniGameSettingsPage";
import { PracticeToolsMiniGamePage } from "../practiceTools/minigame/pages/PracticeToolsMiniGamePage";
import type { GameId } from "../practiceTools/minigame/types";
import { defaultUserSettings, type MinigameUserSettings } from "../practiceTools/minigame/userSettings";

type Props = { lang: Lang };
type PracticeToolsTabId = "tab_builder" | "minigame" | "theory";

const TAB_ITEMS: Array<{ id: PracticeToolsTabId; labelKo: string; labelEn: string }> = [
  { id: "tab_builder", labelKo: "TAB 생성기", labelEn: "TAB Builder" },
  { id: "minigame", labelKo: "미니게임", labelEn: "Mini Game" },
  { id: "theory", labelKo: "이론·코드·스케일", labelEn: "Theory / Chord / Scale" },
];

export function PracticeToolsPage({ lang }: Props) {
  const [activeTab, setActiveTab] = useState<PracticeToolsTabId>("tab_builder");
  const [selectedGame, setSelectedGame] = useState<GameId | null>(null);
  const [userSettings, setUserSettings] = useState<MinigameUserSettings>(defaultUserSettings);
  const [settingsBusy, setSettingsBusy] = useState(true);
  const [settingsError, setSettingsError] = useState("");
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getUserSettings()
      .then((next) => {
        if (cancelled) return;
        setUserSettings(next);
        setSettingsError("");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setSettingsError(error instanceof Error ? error.message : "연습 도구 설정을 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!cancelled) setSettingsBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const applyUserSettings = (next: MinigameUserSettings) => {
    setUserSettings(next);
    setSettingsError("");
    void putUserSettings(next)
      .then((saved) => {
        setUserSettings(saved);
      })
      .catch((error: unknown) => {
        setSettingsError(error instanceof Error ? error.message : "연습 도구 설정 저장에 실패했습니다.");
      });
  };

  const openUtilityTab = (tab: "THEORY" | "SETTINGS") => {
    if (tab === "THEORY") {
      setActiveTab("theory");
      return;
    }
    setShowSettingsModal(true);
  };

  return (
    <div className="page-grid practice-tools-shell">
      <section className="card practice-tools-overview">
        <div className="ui-page-header">
          <div className="ui-page-header-main">
            <h2>{lang === "ko" ? "연습 도구" : "Practice Tools"}</h2>
            <p>
              {lang === "ko"
                ? "기존 TAB 생성기는 그대로 유지하고, BassMiniGame의 미니게임과 이론 화면을 같은 영역에 병합했습니다."
                : "TAB Builder stays intact while BassMiniGame tools are merged into the same workspace."}
            </p>
          </div>
          <div className="ui-page-header-actions">
            {settingsBusy ? <small className="muted">{lang === "ko" ? "설정 불러오는 중..." : "Loading settings..."}</small> : null}
            {activeTab !== "tab_builder" ? (
              <button className="ghost-btn" onClick={() => setShowSettingsModal(true)}>
                {lang === "ko" ? "연습 도구 설정" : "Practice Tool Settings"}
              </button>
            ) : null}
          </div>
        </div>

        <div className="practice-tools-tab-strip" role="tablist" aria-label={lang === "ko" ? "연습 도구 내부 탭" : "Practice tools tabs"}>
          {TAB_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={activeTab === item.id}
              className={`ghost-btn practice-tools-tab-btn ${activeTab === item.id ? "active-mini" : ""}`}
              onClick={() => setActiveTab(item.id)}
            >
              {lang === "ko" ? item.labelKo : item.labelEn}
            </button>
          ))}
        </div>

        {settingsError ? <div className="settings-inline-error">{settingsError}</div> : null}
      </section>

      <section className="practice-tools-stage">
        {activeTab === "tab_builder" ? <PracticeToolsTabBuilder lang={lang} /> : null}

        {activeTab === "minigame" ? (
          <MinigameShadowSurface className="practice-tools-shadow-host">
            <PracticeToolsMiniGamePage
              selectedGame={selectedGame}
              onSelectGame={setSelectedGame}
              onBackToHub={() => setSelectedGame(null)}
              userSettings={userSettings}
              onUserSettingsChange={applyUserSettings}
              onOpenUtilityTab={openUtilityTab}
            />
          </MinigameShadowSurface>
        ) : null}

        {activeTab === "theory" ? (
          <MinigameShadowSurface className="practice-tools-shadow-host">
            <CodeReferencePage userSettings={userSettings} onOpenSettings={() => setShowSettingsModal(true)} />
          </MinigameShadowSurface>
        ) : null}
      </section>

      {showSettingsModal ? (
        <div className="practice-tools-modal-backdrop" onClick={() => setShowSettingsModal(false)}>
          <div className="practice-tools-modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="practice-tools-modal-head">
              <div>
                <strong>{lang === "ko" ? "연습 도구 설정" : "Practice Tool Settings"}</strong>
                <small className="muted">
                  {lang === "ko"
                    ? "BassOS 메인 설정과 분리된 미니게임 전용 설정입니다."
                    : "This popup controls the isolated minigame settings only."}
                </small>
              </div>
              <button className="ghost-btn" onClick={() => setShowSettingsModal(false)}>
                {lang === "ko" ? "닫기" : "Close"}
              </button>
            </div>
            <MinigameShadowSurface className="practice-tools-shadow-host practice-tools-modal-shadow">
              <MiniGameSettingsPage settings={userSettings} onApply={applyUserSettings} />
            </MinigameShadowSurface>
          </div>
        </div>
      ) : null}
    </div>
  );
}
