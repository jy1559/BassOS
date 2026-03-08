
import { useEffect, useMemo, useRef, useState } from "react";
import {
  FBH_JUDGES,
  RC_DIFFICULTIES,
  defaultUserSettings,
  parseUserSettingsText,
  resetUserSettings,
  saveUserSettings,
  type FbhJudge,
  type MinigameUserSettings,
  userSettingsToBlob,
} from "../userSettings";

type Props = {
  settings: MinigameUserSettings;
  onApply: (next: MinigameUserSettings) => void;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const nearFretOptions: Array<{ value: MinigameUserSettings["fbh"]["ranges"]["EASY"]["near"]["fretDirection"]; label: string }> = [
  { value: "ANY", label: "ANY" },
  { value: "GE_ANCHOR", label: "앵커 이상 프렛" },
  { value: "LE_ANCHOR", label: "앵커 이하 프렛" },
];

const nearStringOptions: Array<{ value: MinigameUserSettings["fbh"]["ranges"]["EASY"]["near"]["stringDirection"]; label: string }> = [
  { value: "ANY", label: "ANY" },
  { value: "SAME", label: "같은 줄" },
  { value: "UPPER", label: "윗줄만" },
  { value: "LOWER", label: "아랫줄만" },
];

const detectModeOptions: MinigameUserSettings["fretboard"]["detectMode"][] = ["ZONE", "WIRE", "HYBRID"];
const notationOptions: MinigameUserSettings["rhythm"]["notationMode"][] = ["BASS_STAFF", "PERCUSSION"];
const boardPresetOptions: MinigameUserSettings["fretboard"]["boardPreset"][] = ["CLASSIC", "MAPLE", "DARK"];
const inlayPresetOptions: MinigameUserSettings["fretboard"]["inlayPreset"][] = ["DOT", "BLOCK", "TRIANGLE"];

function fbhJudgeLabel(judge: FbhJudge): string {
  const labels: Record<FbhJudge, string> = {
    PC: "음 이름 위치 찾기",
    PC_RANGE: "지정 구간 안에서 음 찾기",
    MIDI: "옥타브 포함 음 높이 찾기",
    PC_NEAR: "기준 음 주변 찾기",
    MIDI_NEAR: "옥타브 포함 주변 찾기",
    CODE: "코드 음 찾기",
    CODE_MIDI: "옥타브 포함 코드 음 찾기",
    ROOT_NEAR: "루트 근처 코드 음 찾기",
  };
  return labels[judge];
}

export function MiniGameSettingsPage({ settings, onApply }: Props) {
  const [draft, setDraft] = useState<MinigameUserSettings>(settings);
  const [message, setMessage] = useState("변경 후 '설정 저장'을 누르면 즉시 적용됩니다.");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const jsonPreview = useMemo(() => JSON.stringify(draft, null, 2), [draft]);

  const applyNow = (next: MinigameUserSettings, savedMessage: string) => {
    const saved = saveUserSettings(next);
    setDraft(saved);
    onApply(saved);
    setMessage(savedMessage);
  };

  const patchDraft = (updater: (prev: MinigameUserSettings) => MinigameUserSettings) => {
    setDraft((prev) => updater(prev));
  };

  const updateRange = (
    diff: (typeof RC_DIFFICULTIES)[number],
    updater: (prev: MinigameUserSettings["fbh"]["ranges"]["EASY"]) => MinigameUserSettings["fbh"]["ranges"]["EASY"]
  ) => {
    setDraft((prev) => ({
      ...prev,
      fbh: {
        ...prev.fbh,
        ranges: {
          ...prev.fbh.ranges,
          [diff]: updater(prev.fbh.ranges[diff]),
        },
      },
    }));
  };

  const updateCodeWeight = (
    diff: (typeof RC_DIFFICULTIES)[number],
    key: keyof MinigameUserSettings["fbh"]["ranges"]["EASY"]["code"]["degreeWeights"],
    value: number
  ) => {
    updateRange(diff, (prev) => ({
      ...prev,
      code: {
        ...prev.code,
        degreeWeights: {
          ...prev.code.degreeWeights,
          [key]: value,
        },
      },
    }));
  };

  const updateRootWeight = (
    diff: (typeof RC_DIFFICULTIES)[number],
    key: keyof MinigameUserSettings["fbh"]["ranges"]["EASY"]["rootNear"]["degreeWeights"],
    value: number
  ) => {
    updateRange(diff, (prev) => ({
      ...prev,
      rootNear: {
        ...prev.rootNear,
        degreeWeights: {
          ...prev.rootNear.degreeWeights,
          [key]: value,
        },
      },
    }));
  };

  const updateRhythmWindow = (diff: (typeof RC_DIFFICULTIES)[number], ms: number) => {
    patchDraft((prev) => ({
      ...prev,
      rhythm: {
        ...prev.rhythm,
        windowsMs: {
          ...prev.rhythm.windowsMs,
          [diff]: clamp(Math.floor(ms), 20, 160),
        },
      },
    }));
  };

  const updatePcRange = (
    diff: (typeof RC_DIFFICULTIES)[number],
    patch: Partial<MinigameUserSettings["fbh"]["ranges"]["EASY"]["pcRange"]>
  ) => {
    updateRange(diff, (prev) => ({
      ...prev,
      pcRange: {
        ...prev.pcRange,
        ...patch,
      },
    }));
  };

  const updateTheorySpread = (key: keyof MinigameUserSettings["theory"], value: number) => {
    patchDraft((prev) => ({
      ...prev,
      theory: {
        ...prev.theory,
        [key]: clamp(Math.floor(value), 0, 400),
      },
    }));
  };

  return (
    <section className="mg-page" data-testid="mg-settings-page">
      <header className="card mg-tab-head">
        <h2>설정</h2>
        <p className="muted">공통 설정 + FBH 판정/출제/챌린지 옵션을 난이도별로 설정할 수 있습니다.</p>
      </header>

      <section className="card">
        <h3>공통 지판 설정</h3>
        <div className="mg-grid-form">
          <label>
            최대 표시 프렛
            <input
              type="number"
              min={12}
              max={21}
              value={draft.fretboard.maxVisibleFret}
              onChange={(event) =>
                patchDraft((prev) => ({
                  ...prev,
                  fretboard: { ...prev.fretboard, maxVisibleFret: clamp(Math.floor(Number(event.target.value || 21)), 12, 21) },
                }))
              }
            />
          </label>
          <label>
            판정 방식
            <select
              value={draft.fretboard.detectMode}
              onChange={(event) =>
                patchDraft((prev) => ({
                  ...prev,
                  fretboard: { ...prev.fretboard, detectMode: event.target.value as MinigameUserSettings["fretboard"]["detectMode"] },
                }))
              }
            >
              {detectModeOptions.map((mode) => (
                <option key={`detect-${mode}`} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </label>
          <label>
            지판 프리셋
            <select
              value={draft.fretboard.boardPreset}
              onChange={(event) =>
                patchDraft((prev) => ({
                  ...prev,
                  fretboard: {
                    ...prev.fretboard,
                    boardPreset: event.target.value as MinigameUserSettings["fretboard"]["boardPreset"],
                  },
                }))
              }
            >
              {boardPresetOptions.map((preset) => (
                <option key={`board-preset-${preset}`} value={preset}>
                  {preset}
                </option>
              ))}
            </select>
          </label>
          <label>
            인레이 프리셋
            <select
              value={draft.fretboard.inlayPreset}
              onChange={(event) =>
                patchDraft((prev) => ({
                  ...prev,
                  fretboard: {
                    ...prev.fretboard,
                    inlayPreset: event.target.value as MinigameUserSettings["fretboard"]["inlayPreset"],
                  },
                }))
              }
            >
              {inlayPresetOptions.map((preset) => (
                <option key={`inlay-preset-${preset}`} value={preset}>
                  {preset}
                </option>
              ))}
            </select>
          </label>
          <label>
            프렛 선 두께
            <input
              type="number"
              min={1.2}
              max={4}
              step={0.1}
              value={draft.fretboard.fretLineWidth}
              onChange={(event) =>
                patchDraft((prev) => ({
                  ...prev,
                  fretboard: { ...prev.fretboard, fretLineWidth: clamp(Number(event.target.value || 2.4), 1.2, 4) },
                }))
              }
            />
          </label>
          <label>
            프렛 사운드 볼륨
            <input
              type="number"
              min={0.02}
              max={1}
              step={0.01}
              value={draft.fretboard.fretToneVolume}
              onChange={(event) =>
                patchDraft((prev) => ({
                  ...prev,
                  fretboard: { ...prev.fretboard, fretToneVolume: clamp(Number(event.target.value || 0.2), 0.02, 1) },
                }))
              }
            />
          </label>
        </div>
        <div className="mg-hit-controls">
          <button
            className={`ghost-btn ${draft.fretboard.showHitZones ? "active-mini" : ""}`}
            onClick={() =>
              patchDraft((prev) => ({ ...prev, fretboard: { ...prev.fretboard, showHitZones: !prev.fretboard.showHitZones } }))
            }
          >
            인식 영역 표시
          </button>
          <button
            className={`ghost-btn ${draft.fretboard.showFretNotes ? "active-mini" : ""}`}
            onClick={() =>
              patchDraft((prev) => ({ ...prev, fretboard: { ...prev.fretboard, showFretNotes: !prev.fretboard.showFretNotes } }))
            }
          >
            프렛 음명 표시
          </button>
        </div>
      </section>

      <section className="card">
        <h3>리듬 카피 설정</h3>
        <div className="mg-grid-form">
          <label>
            표기 모드
            <select
              value={draft.rhythm.notationMode}
              onChange={(event) =>
                patchDraft((prev) => ({
                  ...prev,
                  rhythm: { ...prev.rhythm, notationMode: event.target.value as MinigameUserSettings["rhythm"]["notationMode"] },
                }))
              }
            >
              {notationOptions.map((mode) => (
                <option key={`notation-${mode}`} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </label>
          <label>
            메트로놈 볼륨
            <input
              type="number"
              min={0.05}
              max={1.5}
              step={0.05}
              value={draft.rhythm.metronomeVolume}
              onChange={(event) =>
                patchDraft((prev) => ({
                  ...prev,
                  rhythm: { ...prev.rhythm, metronomeVolume: clamp(Number(event.target.value || 0.9), 0.05, 1.5) },
                }))
              }
            />
          </label>
          <label>
            프리롤 비트
            <input
              type="number"
              min={1}
              max={8}
              value={draft.rhythm.prerollBeats}
              onChange={(event) =>
                patchDraft((prev) => ({
                  ...prev,
                  rhythm: { ...prev.rhythm, prerollBeats: clamp(Math.floor(Number(event.target.value || 4)), 1, 8) },
                }))
              }
            />
          </label>
        </div>
        <div className="mg-calibration-result">
          <strong>Rhythm Copy 점수모드</strong>
          <span>120초 제한 안에서 5문제를 진행합니다.</span>
          <span>미리 듣기와 연습은 자유지만, 문제마다 도전 1회만 점수에 반영됩니다.</span>
        </div>
        <div className="mg-hit-controls">
          <button
            className={`ghost-btn ${draft.rhythm.showMetronomeVisual ? "active-mini" : ""}`}
            onClick={() =>
              patchDraft((prev) => ({ ...prev, rhythm: { ...prev.rhythm, showMetronomeVisual: !prev.rhythm.showMetronomeVisual } }))
            }
          >
            메트로놈 시각
          </button>
        </div>
        <div className="mg-settings-table">
          {RC_DIFFICULTIES.map((diff) => (
            <label key={`rc-window-${diff}`}>
              {diff} 윈도우(ms)
              <input
                type="number"
                min={20}
                max={160}
                value={draft.rhythm.windowsMs[diff]}
                onChange={(event) => updateRhythmWindow(diff, Number(event.target.value || draft.rhythm.windowsMs[diff]))}
              />
            </label>
          ))}
        </div>
      </section>

      <section className="card">
        <h3>Theory 전체 재생 간격</h3>
        <div className="mg-grid-form">
          <label>
            코드 간격(ms)
            <input
              data-testid="mg-theory-chord-spread-range"
              type="range"
              min={0}
              max={400}
              step={5}
              value={draft.theory.chordSpreadMs}
              onChange={(event) => updateTheorySpread("chordSpreadMs", Number(event.target.value || 0))}
            />
            <input
              data-testid="mg-theory-chord-spread-number"
              type="number"
              min={0}
              max={400}
              step={1}
              value={draft.theory.chordSpreadMs}
              onChange={(event) => updateTheorySpread("chordSpreadMs", Number(event.target.value || 0))}
            />
          </label>
          <label>
            스케일 간격(ms)
            <input
              data-testid="mg-theory-scale-spread-range"
              type="range"
              min={0}
              max={400}
              step={5}
              value={draft.theory.scaleSpreadMs}
              onChange={(event) => updateTheorySpread("scaleSpreadMs", Number(event.target.value || 0))}
            />
            <input
              data-testid="mg-theory-scale-spread-number"
              type="number"
              min={0}
              max={400}
              step={1}
              value={draft.theory.scaleSpreadMs}
              onChange={(event) => updateTheorySpread("scaleSpreadMs", Number(event.target.value || 0))}
            />
          </label>
        </div>
      </section>

      <section className="card">
        <h3>라인 매퍼 설정</h3>
        <div className="mg-settings-table">
          {RC_DIFFICULTIES.map((diff) => (
            <label key={`lm-max-${diff}`}>
              {diff} 최대 프렛
              <input
                type="number"
                min={0}
                max={21}
                value={draft.lm.maxFretByDifficulty[diff]}
                onChange={(event) =>
                  patchDraft((prev) => ({
                    ...prev,
                    lm: {
                      ...prev.lm,
                      maxFretByDifficulty: {
                        ...prev.lm.maxFretByDifficulty,
                        [diff]: clamp(Math.floor(Number(event.target.value || prev.lm.maxFretByDifficulty[diff])), 0, 21),
                      },
                    },
                  }))
                }
              />
            </label>
          ))}
        </div>
        <div className="mg-hit-controls">
          <button
            className={`ghost-btn ${draft.lm.explainOn ? "active-mini" : ""}`}
            onClick={() => patchDraft((prev) => ({ ...prev, lm: { ...prev.lm, explainOn: !prev.lm.explainOn } }))}
          >
            해설 표시
          </button>
        </div>
      </section>

      <section className="card">
        <h3>FBH 난이도별 출제 설정</h3>
        <div className="mg-settings-grid-rows">
          {RC_DIFFICULTIES.map((diff) => {
            const range = draft.fbh.ranges[diff];
            return (
              <details className="mg-fbh-settings-block" key={`fbh-${diff}`} open={diff === "EASY"}>
                <summary>
                  <strong>{diff}</strong> | {range.minFret}~{range.maxFret} fret | {range.judges.map((judge) => fbhJudgeLabel(judge)).join(", ")}
                </summary>

                <div className="mg-settings-row mg-fbh-settings-row">
                  <label>
                    최소 프렛
                    <input
                      type="number"
                      min={0}
                      max={21}
                      value={range.minFret}
                      onChange={(event) =>
                        updateRange(diff, (prev) => ({ ...prev, minFret: clamp(Math.floor(Number(event.target.value || 0)), 0, 21) }))
                      }
                    />
                  </label>
                  <label>
                    최대 프렛
                    <input
                      type="number"
                      min={0}
                      max={21}
                      value={range.maxFret}
                      onChange={(event) =>
                        updateRange(diff, (prev) => ({ ...prev, maxFret: clamp(Math.floor(Number(event.target.value || 0)), 0, 21) }))
                      }
                    />
                  </label>
                </div>

                <div className="mg-grid-form">
                  <label>
                    지정 구간 문제 최소 프렛
                    <input
                      type="number"
                      min={0}
                      max={21}
                      value={range.pcRange.minFret}
                      onChange={(event) =>
                        updatePcRange(diff, { minFret: clamp(Math.floor(Number(event.target.value || 0)), 0, 21) })
                      }
                    />
                  </label>
                  <label>
                    지정 구간 문제 최대 프렛
                    <input
                      type="number"
                      min={0}
                      max={21}
                      value={range.pcRange.maxFret}
                      onChange={(event) =>
                        updatePcRange(diff, { maxFret: clamp(Math.floor(Number(event.target.value || 0)), 0, 21) })
                      }
                    />
                  </label>
                  <label>
                    지정 구간 길이 최소값
                    <input
                      type="number"
                      min={2}
                      max={12}
                      value={range.pcRange.windowMinSize}
                      onChange={(event) =>
                        updatePcRange(diff, { windowMinSize: clamp(Math.floor(Number(event.target.value || 4)), 2, 12) })
                      }
                    />
                  </label>
                  <label>
                    지정 구간 길이 최대값
                    <input
                      type="number"
                      min={2}
                      max={12}
                      value={range.pcRange.windowMaxSize}
                      onChange={(event) =>
                        updatePcRange(diff, { windowMaxSize: clamp(Math.floor(Number(event.target.value || 6)), 2, 12) })
                      }
                    />
                  </label>
                </div>

                <div className="mg-hit-controls">
                  {FBH_JUDGES.map((judge) => {
                    const active = range.judges.includes(judge);
                    return (
                      <button
                        key={`judge-${diff}-${judge}`}
                        className={`ghost-btn ${active ? "active-mini" : ""}`}
                        onClick={() =>
                          updateRange(diff, (prev) => {
                            const list = prev.judges;
                            const next = list.includes(judge) ? list.filter((item) => item !== judge) : [...list, judge];
                            return { ...prev, judges: next.length ? (next as FbhJudge[]) : [judge] };
                          })
                        }
                      >
                        {fbhJudgeLabel(judge)}
                      </button>
                    );
                  })}
                </div>

                <div className="mg-grid-form">
                  <label>
                    L1 거리
                    <input
                      type="number"
                      min={1}
                      max={12}
                      value={range.near.l1Distance}
                      onChange={(event) =>
                        updateRange(diff, (prev) => ({
                          ...prev,
                          near: { ...prev.near, l1Distance: clamp(Math.floor(Number(event.target.value || 4)), 1, 12) },
                        }))
                      }
                    />
                  </label>
                  <label>
                    프렛 제한
                    <select
                      value={range.near.fretDirection}
                      onChange={(event) =>
                        updateRange(diff, (prev) => ({ ...prev, near: { ...prev.near, fretDirection: event.target.value as typeof prev.near.fretDirection } }))
                      }
                    >
                      {nearFretOptions.map((item) => (
                        <option key={`${diff}-fret-${item.value}`} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    줄 제한
                    <select
                      value={range.near.stringDirection}
                      onChange={(event) =>
                        updateRange(diff, (prev) => ({ ...prev, near: { ...prev.near, stringDirection: event.target.value as typeof prev.near.stringDirection } }))
                      }
                    >
                      {nearStringOptions.map((item) => (
                        <option key={`${diff}-string-${item.value}`} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="mg-hit-controls">
                  <button
                    className={`ghost-btn ${range.code.levels.basic ? "active-mini" : ""}`}
                    onClick={() => updateRange(diff, (prev) => ({ ...prev, code: { ...prev.code, levels: { ...prev.code.levels, basic: !prev.code.levels.basic } } }))}
                  >
                    기초
                  </button>
                  <button
                    className={`ghost-btn ${range.code.levels.extended ? "active-mini" : ""}`}
                    onClick={() =>
                      updateRange(diff, (prev) => ({ ...prev, code: { ...prev.code, levels: { ...prev.code.levels, extended: !prev.code.levels.extended } } }))
                    }
                  >
                    확장/알터드
                  </button>
                  <button
                    className={`ghost-btn ${range.code.levels.modal ? "active-mini" : ""}`}
                    onClick={() => updateRange(diff, (prev) => ({ ...prev, code: { ...prev.code, levels: { ...prev.code.levels, modal: !prev.code.levels.modal } } }))}
                  >
                    모드스케일
                  </button>
                  <button
                    className={`ghost-btn ${range.rootNear.includeOctave ? "active-mini" : ""}`}
                    onClick={() => updateRange(diff, (prev) => ({ ...prev, rootNear: { ...prev.rootNear, includeOctave: !prev.rootNear.includeOctave } }))}
                  >
                    ROOT 옥타브
                  </button>
                  <button
                    className={`ghost-btn ${range.rootNear.allow9Plus ? "active-mini" : ""}`}
                    onClick={() => updateRange(diff, (prev) => ({ ...prev, rootNear: { ...prev.rootNear, allow9Plus: !prev.rootNear.allow9Plus } }))}
                  >
                    ROOT 9~12
                  </button>
                </div>

                <div className="mg-grid-form">
                  <label>
                    구성음 가중치
                    <input
                      type="number"
                      min={0.1}
                      max={20}
                      step={0.1}
                      value={range.code.degreeWeights.chordToneWeight}
                      onChange={(event) => updateCodeWeight(diff, "chordToneWeight", clamp(Number(event.target.value || 4), 0.1, 20))}
                    />
                  </label>
                  <label>
                    9+ 가중치
                    <input
                      type="number"
                      min={0.1}
                      max={20}
                      step={0.1}
                      value={range.code.degreeWeights.extDegreeWeight}
                      onChange={(event) => updateCodeWeight(diff, "extDegreeWeight", clamp(Number(event.target.value || 1), 0.1, 20))}
                    />
                  </label>
                  <label>
                    # 가중치
                    <input
                      type="number"
                      min={0.1}
                      max={20}
                      step={0.1}
                      value={range.code.degreeWeights.sharpWeight}
                      onChange={(event) => updateCodeWeight(diff, "sharpWeight", clamp(Number(event.target.value || 1), 0.1, 20))}
                    />
                  </label>
                  <label>
                    b 가중치
                    <input
                      type="number"
                      min={0.1}
                      max={20}
                      step={0.1}
                      value={range.code.degreeWeights.flatWeight}
                      onChange={(event) => updateCodeWeight(diff, "flatWeight", clamp(Number(event.target.value || 1), 0.1, 20))}
                    />
                  </label>
                  <label>
                    ROOT 9+ 확률
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.01}
                      value={range.rootNear.degree9PlusRate}
                      onChange={(event) =>
                        updateRange(diff, (prev) => ({ ...prev, rootNear: { ...prev.rootNear, degree9PlusRate: clamp(Number(event.target.value || 0.18), 0, 1) } }))
                      }
                    />
                  </label>
                  <label>
                    ROOT 구성음
                    <input
                      type="number"
                      min={0.1}
                      max={20}
                      step={0.1}
                      value={range.rootNear.degreeWeights.chordToneWeight}
                      onChange={(event) => updateRootWeight(diff, "chordToneWeight", clamp(Number(event.target.value || 4), 0.1, 20))}
                    />
                  </label>
                </div>
              </details>
            );
          })}
        </div>
      </section>

      <section className="card">
        <h3>FBH 챌린지 설정</h3>
        <div className="mg-grid-form">
          <label>
            정답 점수
            <input
              type="number"
              min={1}
              max={100}
              value={draft.fbh.challenge.correctScore}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  fbh: { ...prev.fbh, challenge: { ...prev.fbh.challenge, correctScore: clamp(Math.floor(Number(event.target.value || 1)), 1, 100) } },
                }))
              }
            />
          </label>
          <label>
            오답 감점
            <input
              type="number"
              min={0}
              max={100}
              value={draft.fbh.challenge.wrongPenalty}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  fbh: { ...prev.fbh, challenge: { ...prev.fbh.challenge, wrongPenalty: clamp(Math.floor(Number(event.target.value || 0)), 0, 100) } },
                }))
              }
            />
          </label>
          <label>
            제한 시간(초)
            <input
              type="number"
              min={10}
              max={900}
              value={draft.fbh.challenge.timeLimitSec}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  fbh: { ...prev.fbh, challenge: { ...prev.fbh.challenge, timeLimitSec: clamp(Math.floor(Number(event.target.value || 120)), 10, 900) } },
                }))
              }
            />
          </label>
          <label>
            목숨(0=무제한)
            <input
              type="number"
              min={0}
              max={20}
              value={draft.fbh.challenge.lives}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  fbh: { ...prev.fbh, challenge: { ...prev.fbh.challenge, lives: clamp(Math.floor(Number(event.target.value || 0)), 0, 20) } },
                }))
              }
            />
          </label>
        </div>
      </section>

      <section className="card">
        <h3>FBH 연습모드 보조 기능</h3>
        <div className="mg-hit-controls">
          <button
            className={`ghost-btn ${draft.fbh.practice.checkMode === "CONFIRM" ? "active-mini" : ""}`}
            onClick={() =>
              patchDraft((prev) => ({
                ...prev,
                fbh: { ...prev.fbh, practice: { ...prev.fbh.practice, checkMode: "CONFIRM" } },
              }))
            }
          >
            정답 확인 모드
          </button>
          <button
            className={`ghost-btn ${draft.fbh.practice.checkMode === "INSTANT" ? "active-mini" : ""}`}
            onClick={() =>
              patchDraft((prev) => ({
                ...prev,
                fbh: { ...prev.fbh, practice: { ...prev.fbh.practice, checkMode: "INSTANT" } },
              }))
            }
          >
            즉시 확인 모드
          </button>
          <button
            className={`ghost-btn ${draft.fbh.practice.showAnswerButton ? "active-mini" : ""}`}
            onClick={() =>
              patchDraft((prev) => ({
                ...prev,
                fbh: { ...prev.fbh, practice: { ...prev.fbh.practice, showAnswerButton: !prev.fbh.practice.showAnswerButton } },
              }))
            }
          >
            정답 보기 버튼
          </button>
          <button
            className={`ghost-btn ${draft.fbh.practice.revealAnswersOnCorrect ? "active-mini" : ""}`}
            onClick={() =>
              patchDraft((prev) => ({
                ...prev,
                fbh: { ...prev.fbh, practice: { ...prev.fbh.practice, revealAnswersOnCorrect: !prev.fbh.practice.revealAnswersOnCorrect } },
              }))
            }
          >
            정답 시 전체 위치 표시
          </button>
          <button
            className={`ghost-btn ${draft.fbh.practice.requireNextAfterReveal ? "active-mini" : ""}`}
            onClick={() =>
              patchDraft((prev) => ({
                ...prev,
                fbh: { ...prev.fbh, practice: { ...prev.fbh.practice, requireNextAfterReveal: !prev.fbh.practice.requireNextAfterReveal } },
              }))
            }
          >
            표시 후 다음버튼 필요
          </button>
        </div>
      </section>

      <section className="card">
        <h3>저장 / 백업</h3>
        <div className="mg-hit-controls">
          <button className="primary-btn" onClick={() => applyNow(draft, "설정이 저장되었습니다.")}>
            설정 저장
          </button>
          <button
            className="ghost-btn"
            onClick={() => {
              const reset = resetUserSettings();
              onApply(reset);
              setDraft(reset);
              setMessage("기본값으로 복원되었습니다.");
            }}
          >
            기본값 복원
          </button>
          <button
            className="ghost-btn"
            onClick={() => {
              const blob = userSettingsToBlob(draft);
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `bassminigame-settings-${new Date().toISOString().slice(0, 10)}.json`;
              a.click();
              URL.revokeObjectURL(url);
              setMessage("설정 JSON을 내보냈습니다.");
            }}
          >
            설정 내보내기
          </button>
          <button className="ghost-btn" onClick={() => inputRef.current?.click()}>
            설정 불러오기
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="application/json"
            style={{ display: "none" }}
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              try {
                const text = await file.text();
                const parsed = parseUserSettingsText(text);
                applyNow(parsed, "설정 JSON을 불러와 적용했습니다.");
              } catch {
                setMessage("설정 파일 파싱에 실패했습니다.");
              } finally {
                event.target.value = "";
              }
            }}
          />
        </div>
        <p className="mg-help-text">{message}</p>
        <details>
          <summary>현재 설정 JSON 미리보기</summary>
          <pre className="mg-json-preview">{jsonPreview}</pre>
        </details>
      </section>

      <section className="card">
        <h3>기본값 참고</h3>
        <pre className="mg-json-preview">{JSON.stringify(defaultUserSettings, null, 2)}</pre>
      </section>
    </section>
  );
}
