import { useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { Lang } from "../i18n";
import { PracticeToolsTabBuilder } from "./PracticeToolsTabBuilder";
import { MinigameShadowSurface } from "../practiceTools/minigame/MinigameShadowSurface";
import { getUserSettings, putUserSettings } from "../practiceTools/minigame/api";
import { CodeReferencePage } from "../practiceTools/minigame/pages/CodeReferencePage";
import { MiniGameSettingsPage } from "../practiceTools/minigame/pages/MiniGameSettingsPage";
import { PracticeToolsMiniGamePage } from "../practiceTools/minigame/pages/PracticeToolsMiniGamePage";
import type { GameId } from "../practiceTools/minigame/types";
import { defaultUserSettings, type MinigameUserSettings } from "../practiceTools/minigame/userSettings";

type Props = {
  lang: Lang;
  activeTab?: PracticeToolsTabId;
  onActiveTabChange?: (tab: PracticeToolsTabId) => void;
};

type ModalPosition = {
  left: number;
  top: number;
};

type ModalDragState = {
  pointerId: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
};

const MODAL_TOP_OFFSET = 24;

export type PracticeToolsTabId = "tab_builder" | "minigame" | "theory";

const TAB_LABELS: Record<PracticeToolsTabId, { ko: string; en: string }> = {
  tab_builder: { ko: "TAB 생성기", en: "TAB Builder" },
  minigame: { ko: "미니게임", en: "Mini Game" },
  theory: { ko: "이론·코드·스케일", en: "Theory / Chord / Scale" },
};

function isModalDragBlockedTarget(target: EventTarget | null): boolean {
  const node = target as HTMLElement | null;
  if (!node) return false;
  return Boolean(node.closest("button,input,select,textarea,a,label,[role='button']"));
}

function clampModalPosition(position: ModalPosition, width: number, height: number): ModalPosition {
  const margin = 16;
  const maxLeft = Math.max(margin, window.innerWidth - width - margin);
  const maxTop = Math.max(margin, window.innerHeight - height - margin);
  return {
    left: Math.round(Math.max(margin, Math.min(position.left, maxLeft))),
    top: Math.round(Math.max(margin, Math.min(position.top, maxTop))),
  };
}

function defaultModalPosition(width: number, height: number): ModalPosition {
  return clampModalPosition(
    {
      left: Math.round((window.innerWidth - width) / 2),
      top: MODAL_TOP_OFFSET,
    },
    width,
    height
  );
}

export function PracticeToolsPage({ lang, activeTab, onActiveTabChange }: Props) {
  const [fallbackActiveTab, setFallbackActiveTab] = useState<PracticeToolsTabId>("tab_builder");
  const [selectedGame, setSelectedGame] = useState<GameId | null>(null);
  const [userSettings, setUserSettings] = useState<MinigameUserSettings>(defaultUserSettings);
  const [settingsBusy, setSettingsBusy] = useState(true);
  const [settingsError, setSettingsError] = useState("");
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [modalPosition, setModalPosition] = useState<ModalPosition | null>(null);
  const [modalDragging, setModalDragging] = useState(false);
  const modalCardRef = useRef<HTMLDivElement | null>(null);
  const modalDragRef = useRef<ModalDragState | null>(null);
  const resolvedActiveTab = activeTab ?? fallbackActiveTab;

  const selectTab = (nextTab: PracticeToolsTabId) => {
    if (activeTab === undefined) {
      setFallbackActiveTab(nextTab);
    }
    onActiveTabChange?.(nextTab);
  };

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

  useEffect(() => {
    if (!showSettingsModal) {
      modalDragRef.current = null;
      setModalDragging(false);
      setModalPosition(null);
      return;
    }

    const updatePosition = () => {
      const node = modalCardRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const anchored = defaultModalPosition(rect.width, rect.height);
      setModalPosition((prev) => (prev ? clampModalPosition(prev, rect.width, rect.height) : anchored));
    };

    const frameId = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", updatePosition);
    };
  }, [showSettingsModal]);

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
      selectTab("theory");
      return;
    }
    setShowSettingsModal(true);
  };

  const beginModalDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (isModalDragBlockedTarget(event.target)) return;
    const node = modalCardRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    modalDragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    };
    setModalDragging(true);
    setModalPosition(clampModalPosition({ left: rect.left, top: rect.top }, rect.width, rect.height));
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const moveModalDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = modalDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setModalPosition(
      clampModalPosition(
        {
          left: event.clientX - drag.offsetX,
          top: event.clientY - drag.offsetY,
        },
        drag.width,
        drag.height
      )
    );
  };

  const endModalDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = modalDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    modalDragRef.current = null;
    setModalDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const modalCardStyle: CSSProperties | undefined = modalPosition
    ? {
        left: `${modalPosition.left}px`,
        top: `${modalPosition.top}px`,
      }
    : undefined;

  return (
    <div className="page-grid practice-tools-shell">
      <section className="card practice-tools-overview">
        <div className="ui-page-header">
          <div className="ui-page-header-main">
            <h2>{lang === "ko" ? "연습 도구" : "Practice Tools"}</h2>
            <p>
              {lang === "ko"
                ? `왼쪽 사이드바에서 ${TAB_LABELS[resolvedActiveTab].ko} 화면을 바로 선택할 수 있습니다.`
                : `Use the left sidebar to jump directly to the ${TAB_LABELS[resolvedActiveTab].en} view.`}
            </p>
          </div>
          <div className="ui-page-header-actions">
            {settingsBusy ? <small className="muted">{lang === "ko" ? "설정 불러오는 중..." : "Loading settings..."}</small> : null}
            {resolvedActiveTab !== "tab_builder" ? (
              <button className="ghost-btn" onClick={() => setShowSettingsModal(true)}>
                {lang === "ko" ? "연습 도구 설정" : "Practice Tool Settings"}
              </button>
            ) : null}
          </div>
        </div>

        {settingsError ? <div className="settings-inline-error">{settingsError}</div> : null}
      </section>

      <section className="practice-tools-stage">
        {resolvedActiveTab === "tab_builder" ? <PracticeToolsTabBuilder lang={lang} /> : null}

        {resolvedActiveTab === "minigame" ? (
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

        {resolvedActiveTab === "theory" ? (
          <MinigameShadowSurface className="practice-tools-shadow-host practice-tools-shadow-host-theory">
            <CodeReferencePage userSettings={userSettings} onOpenSettings={() => setShowSettingsModal(true)} />
          </MinigameShadowSurface>
        ) : null}
      </section>

      {showSettingsModal ? (
        <div className="practice-tools-modal-backdrop" onClick={() => setShowSettingsModal(false)}>
          <div
            ref={modalCardRef}
            className={`practice-tools-modal-card ${modalDragging ? "dragging" : ""} ${modalPosition ? "is-positioned" : ""}`}
            style={modalCardStyle}
            onClick={(event) => event.stopPropagation()}
          >
            <div
              className="practice-tools-modal-head"
              onPointerDown={beginModalDrag}
              onPointerMove={moveModalDrag}
              onPointerUp={endModalDrag}
              onPointerCancel={endModalDrag}
            >
              <div>
                <strong>{lang === "ko" ? "연습 도구 설정" : "Practice Tool Settings"}</strong>
                <small className="muted">
                  {lang === "ko"
                    ? "헤더를 드래그해 위치를 옮길 수 있습니다. BassOS 메인 설정과 분리된 미니게임 전용 설정입니다."
                    : "Drag the header to move this popup. These settings stay separate from main BassOS settings."}
                </small>
              </div>
              <button className="ghost-btn" onClick={() => setShowSettingsModal(false)}>
                {lang === "ko" ? "닫기" : "Close"}
              </button>
            </div>
            <div className="practice-tools-modal-body" data-testid="practice-tools-modal-body">
              <MinigameShadowSurface className="practice-tools-shadow-host practice-tools-modal-shadow">
                <MiniGameSettingsPage settings={userSettings} onApply={applyUserSettings} />
              </MinigameShadowSurface>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
