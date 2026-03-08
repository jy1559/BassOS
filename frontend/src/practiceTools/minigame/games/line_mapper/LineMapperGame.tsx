import { useEffect, useMemo, useRef, useState } from "react";
import type { ChallengeSignal, GameMetrics, GameMode } from "../../types/models";
import type { FretboardBoardPreset, FretboardInlayPreset, HitDetectMode } from "../../userSettings";
import { playFretMidi, playResultCue } from "../common/audio";
import { cellToMidi, pcToName, sameCell, type Cell } from "../common/music";
import { createSeededRng } from "../common/seed";
import { FretboardCanvas, type FretboardMarker, type MarkerKind } from "../fretboard/FretboardCanvas";
import { LineOptionBoard } from "./LineOptionBoard";
import {
  buildLineMapperQuestion,
  evaluateLineMapperQuestion,
  questionErrorType,
  questionPocketLabel,
  type CompleteQuestion,
  type FixQuestion,
  type LineMapperEvaluation,
  type LineMapperQuestion,
  type LineMapperStage,
  type PositionQuestion,
} from "./lineRuleEngine";

type Props = {
  mode: GameMode;
  difficulty: string;
  practiceStage: LineMapperStage;
  seed: string;
  challenge: ChallengeSignal;
  soundEnabled: boolean;
  onSoundEnabledChange: (enabled: boolean) => void;
  fretToneVolume: number;
  maxVisibleFret: number;
  detectMode: HitDetectMode;
  onDetectModeChange: (mode: HitDetectMode) => void;
  showHitZones: boolean;
  onShowHitZonesChange: (enabled: boolean) => void;
  showFretNotes: boolean;
  onShowFretNotesChange: (enabled: boolean) => void;
  fretLineWidth: number;
  boardPreset: FretboardBoardPreset;
  inlayPreset: FretboardInlayPreset;
  maxFretByDifficulty: Partial<Record<string, number>>;
  explainOn: boolean;
  onExplainOnChange: (enabled: boolean) => void;
  scaleRules: Record<
    string,
    {
      name_ko?: string;
      intervals: number[];
      description_ko?: string;
      mood_ko?: string;
      usage_ko?: string;
      degree_labels?: string[];
      stable_degrees?: string[];
      avoid_degrees?: string[];
      teaching_family?: string;
    }
  >;
  chordQualities: Record<
    string,
    {
      intervals: number[];
      name_ko?: string;
      description_ko?: string;
      mood_ko?: string;
      usage_ko?: string;
      degree_labels?: string[];
      stable_degrees?: string[];
      avoid_degrees?: string[];
      teaching_family?: string;
    }
  >;
  onMetricsChange: (metrics: GameMetrics) => void;
};

function incrementCounter(source: Record<string, number>, key: string): Record<string, number> {
  if (!key) return source;
  return { ...source, [key]: (source[key] ?? 0) + 1 };
}

function uniqueCells(cells: Cell[]): Cell[] {
  return cells.filter((cell, index) => cells.findIndex((candidate) => sameCell(candidate, cell)) === index);
}

function pushMarker(markers: FretboardMarker[], cell: Cell, kind: MarkerKind) {
  if (markers.some((item) => item.kind === kind && sameCell(item.cell, cell))) return;
  markers.push({ cell, kind });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function labelText(noteName: string, degreeLabel: string): string {
  return `${noteName}/${degreeLabel}`;
}

function stageLegend(question: LineMapperQuestion | null): string {
  if (!question) return "";
  if (question.stage === "POSITION") return "주황점: 루트 · 황토점: 이미 주어진 음 · 보라점: 선택한 음";
  if (question.stage === "FIX") return "파란점: 찍힌 음 · 빨간점: 규칙 밖 음(해설 시)";
  return "초록 큰점: 시작 · 하늘 작은점: 목표 · 보라점: 선택한 음";
}

function stageGoalText(question: LineMapperQuestion | null): string {
  if (!question) return "문제를 준비 중입니다.";
  if (question.stage === "POSITION") return "빈칸으로 남은 구성음 위치를 찾으세요";
  if (question.stage === "FIX") return "스케일/코드에 맞지 않는 보기 하나를 찾으세요";
  return question.direction === "UP" ? "시작음부터 끝음까지 상행으로 완성하세요" : "시작음부터 끝음까지 하행으로 완성하세요";
}

function boardMaxFretForQuestion(question: LineMapperQuestion | null, maxVisibleFret: number): number {
  if (!question) return maxVisibleFret;
  return Math.max(maxVisibleFret, question.displayMaxFret ?? 0);
}

function stepClass(isBlank: boolean, isActive: boolean, isFilled: boolean, isWrong: boolean, isCorrect: boolean, isEndpoint: boolean): string {
  return [
    "mg-lm-step-chip",
    isBlank ? "is-blank" : "",
    isActive ? "is-active" : "",
    isFilled ? "is-filled" : "",
    isWrong ? "is-wrong" : "",
    isCorrect ? "is-correct" : "",
    isEndpoint ? "is-endpoint" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function LineMapperGame({
  mode,
  difficulty,
  practiceStage,
  seed,
  challenge,
  soundEnabled,
  onSoundEnabledChange,
  fretToneVolume,
  maxVisibleFret,
  detectMode,
  onDetectModeChange,
  showHitZones,
  onShowHitZonesChange,
  showFretNotes,
  onShowFretNotesChange,
  fretLineWidth,
  boardPreset,
  inlayPreset,
  maxFretByDifficulty,
  explainOn,
  onExplainOnChange,
  scaleRules,
  chordQualities,
  onMetricsChange,
}: Props) {
  const rngRef = useRef(createSeededRng("init"));
  const [question, setQuestion] = useState<LineMapperQuestion | null>(null);
  const [review, setReview] = useState<LineMapperEvaluation | null>(null);
  const [score, setScore] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [stageCounts, setStageCounts] = useState<Record<string, number>>({});
  const [errorTypeCounts, setErrorTypeCounts] = useState<Record<string, number>>({});
  const [targetDegreeCounts, setTargetDegreeCounts] = useState<Record<string, number>>({});
  const [positionAnswers, setPositionAnswers] = useState<Cell[]>([]);
  const [completeAnswers, setCompleteAnswers] = useState<Record<number, Cell>>({});
  const [activeBlankIndex, setActiveBlankIndex] = useState<number | null>(null);
  const [expandedFixIndex, setExpandedFixIndex] = useState(0);
  const [showRuleSummary, setShowRuleSummary] = useState(false);
  const [isFixPreviewPlaying, setIsFixPreviewPlaying] = useState(false);
  const positionAnswersRef = useRef<Cell[]>([]);
  const completeAnswersRef = useRef<Record<number, Cell>>({});
  const fixPreviewTokenRef = useRef(0);
  const expandedFixIndexRef = useRef(0);

  const disabled = mode === "CHALLENGE" && !challenge.running;

  const nextQuestion = () => {
    const next = buildLineMapperQuestion(
      rngRef.current,
      difficulty,
      mode === "CHALLENGE" ? null : practiceStage,
      mode === "CHALLENGE",
      scaleRules,
      chordQualities,
      maxFretByDifficulty
    );
    setQuestion(next);
    setReview(null);
    setPositionAnswers([]);
    positionAnswersRef.current = [];
    setCompleteAnswers({});
    completeAnswersRef.current = {};
    setActiveBlankIndex(next.stage === "COMPLETE" ? next.blankIndices[0] ?? null : null);
    setExpandedFixIndex(0);
    expandedFixIndexRef.current = 0;
  };

  const resetSession = (salt: string) => {
    rngRef.current = createSeededRng(`${seed}|LM3|${difficulty}|${practiceStage}|${salt}`);
    setScore(0);
    setAttempts(0);
    setCorrect(0);
    setStageCounts({});
    setErrorTypeCounts({});
    setTargetDegreeCounts({});
    setPositionAnswers([]);
    positionAnswersRef.current = [];
    setCompleteAnswers({});
    completeAnswersRef.current = {};
    setActiveBlankIndex(null);
    setExpandedFixIndex(0);
    expandedFixIndexRef.current = 0;
    nextQuestion();
  };

  useEffect(() => {
    if (mode === "CHALLENGE") return;
    resetSession("PRACTICE");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, difficulty, practiceStage, seed]);

  useEffect(() => {
    if (mode !== "CHALLENGE") return;
    resetSession(`CHALLENGE:${challenge.token}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenge.token, mode]);

  useEffect(() => {
    onMetricsChange({
      score,
      accuracy: attempts > 0 ? Number(((correct / attempts) * 100).toFixed(1)) : 0,
      detail: {
        attempts,
        correct,
        stage: question?.stage ?? practiceStage,
        errorType: question ? questionErrorType(question) : "",
        targetDegree: question?.targetDegree ?? "",
        pocketRange: question ? questionPocketLabel(question) : "",
        stage_counts: stageCounts,
        error_type_counts: errorTypeCounts,
        target_degree_counts: targetDegreeCounts,
      },
    });
  }, [attempts, correct, errorTypeCounts, onMetricsChange, practiceStage, question, score, stageCounts, targetDegreeCounts]);

  const ruleSummary = useMemo(() => {
    if (!question) return null;
    const items = question.rule.intervals.map((interval, index) => {
      const normalized = ((interval % 12) + 12) % 12;
      return {
        note: pcToName((question.rootPc + normalized) % 12),
        degree: question.rule.degreeLabels[index] ?? "",
      };
    });
    return {
      notes: items.map((item) => item.note).join(" · "),
      degrees: items.map((item) => item.degree).join(" · "),
      mood: question.rule.mood ?? question.rule.description ?? "기본 구성음을 먼저 익히기 좋은 패턴입니다.",
      usage: question.rule.usage ?? question.rule.description ?? "",
    };
  }, [question]);

  const accuracy = attempts > 0 ? Number(((correct / attempts) * 100).toFixed(1)) : 0;
  const boardMaxFret = boardMaxFretForQuestion(question, maxVisibleFret);
  const legendText = stageLegend(question);
  const currentGoal = stageGoalText(question);
  const expandedFixOption = useMemo(() => {
    if (!question || question.stage !== "FIX") return null;
    return question.options[expandedFixIndex] ?? question.options[0] ?? null;
  }, [expandedFixIndex, question]);
  const fixReviewMarkers = useMemo(() => {
    if (!question || question.stage !== "FIX" || !review) return [];
    const option = question.options[expandedFixIndex] ?? null;
    const lineCells = option?.line.map((step) => step.cell) ?? [];
    return question.pocketTones
      .filter((tone) => !lineCells.some((cell) => sameCell(cell, tone.cell)))
      .map((tone) => ({
        cell: tone.cell,
        kind: tone.role === "ROOT" ? ("root_anchor" as const) : ("lm_shown_tone" as const),
      }));
  }, [expandedFixIndex, question, review]);
  const fixReviewLabels = useMemo(() => {
    if (!expandedFixOption || !review) return [];
    return expandedFixOption.line.map((step, index) => ({
      cell: step.cell,
      text: labelText(step.noteName, step.degreeLabel),
      color:
        expandedFixOption.invalidIndex === index && expandedFixIndex === review.correctFixIndex
          ? "rgba(255, 235, 235, 0.98)"
          : "rgba(247, 254, 255, 0.96)",
    }));
  }, [expandedFixIndex, expandedFixOption, review]);
  const completeReviewLabels = useMemo(() => {
    if (!question || question.stage !== "COMPLETE" || !review) return [];
    return question.line.map((step) => ({
      cell: step.cell,
      text: labelText(step.noteName, step.degreeLabel),
      color: "rgba(247, 254, 255, 0.96)",
    }));
  }, [question, review]);

  const canConfirm = useMemo(() => {
    if (!question || review || disabled) return false;
    if (question.stage === "FIX") return true;
    if (question.stage === "POSITION") return positionAnswers.length > 0;
    return Object.keys(completeAnswers).length > 0;
  }, [completeAnswers, disabled, positionAnswers.length, question, review]);
  const revealBoardLabels = Boolean(review) && showFretNotes;

  const actionHint = useMemo(() => {
    if (review) return "Space로도 다음 문제로 넘어갈 수 있습니다.";
    if (mode === "CHALLENGE") return "Space나 확인으로 제출할 수 있고, 다음 문제를 누르면 오답 1회로 집계됩니다.";
    if (!question) return "문제를 준비 중입니다.";
    if (question.stage === "POSITION") return "하나 이상 고르면 확인할 수 있습니다. 선택한 음은 다시 누르면 해제됩니다.";
    if (question.stage === "COMPLETE") return "하나 이상 고르면 확인할 수 있습니다. 빈칸 카드를 눌러 수정할 자리를 고를 수 있습니다.";
    return "보기만 고른 뒤 확인하거나 Space로 제출할 수 있습니다.";
  }, [mode, question, review]);

  const markers: FretboardMarker[] = useMemo(() => {
    const out: FretboardMarker[] = [];
    if (!question || question.stage === "FIX") return out;

    if (question.stage === "POSITION") {
      for (const tone of question.pocketTones) {
        if (!question.shownCells.some((cell) => sameCell(cell, tone.cell))) continue;
        pushMarker(out, tone.cell, tone.role === "ROOT" ? "root_anchor" : "lm_shown_tone");
      }
      for (const cell of positionAnswers) pushMarker(out, cell, "selected");
    }

    if (question.stage === "COMPLETE") {
      pushMarker(out, question.line[0].cell, "lm_start_primary");
      pushMarker(out, question.line[question.line.length - 1].cell, "lm_goal_secondary");
      for (const cell of Object.values(completeAnswers)) pushMarker(out, cell, "selected");
    }

    if (review) {
      if (question.stage === "COMPLETE") {
        for (const cell of review.correctCells) pushMarker(out, cell, "correct");
        for (const cell of review.solutionCells ?? []) {
          if (review.correctCells.some((item) => sameCell(item, cell)) || review.wrongCells.some((item) => sameCell(item, cell))) continue;
          pushMarker(out, cell, "solution");
        }
      } else {
        for (const cell of review.correctCells) pushMarker(out, cell, "correct");
      }
      for (const cell of review.wrongCells) pushMarker(out, cell, "wrong");
    }

    return out;
  }, [completeAnswers, positionAnswers, question, review]);

  const registerAttempt = (questionItem: LineMapperQuestion, ok: boolean) => {
    setAttempts((prev) => prev + 1);
    setStageCounts((prev) => incrementCounter(prev, questionItem.stage));
    setTargetDegreeCounts((prev) => incrementCounter(prev, questionItem.targetDegree));
    const errorType = questionErrorType(questionItem);
    if (errorType) setErrorTypeCounts((prev) => incrementCounter(prev, errorType));
    if (!ok) return;
    setCorrect((prev) => prev + 1);
    if (mode === "CHALLENGE") setScore((prev) => prev + 1);
  };

  const submitEvaluation = (evaluation: LineMapperEvaluation) => {
    if (!question) return;
    if (soundEnabled) {
      void playResultCue(evaluation.ok ? "ok" : "bad");
    }
    registerAttempt(question, evaluation.ok);
    if (explainOn) {
      setReview(evaluation);
      return;
    }
    window.setTimeout(() => nextQuestion(), 160);
  };

  const handleFixSelect = async (questionItem: FixQuestion, index: number) => {
    if (review || disabled) return;
    const option = questionItem.options[index];
    const previewCell = option?.line[option.invalidIndex ?? Math.max(0, option.line.length - 1)]?.cell ?? option?.line[0]?.cell;
    if (soundEnabled && previewCell) {
      await playFretMidi(cellToMidi(previewCell), fretToneVolume);
    }
    submitEvaluation(evaluateLineMapperQuestion(questionItem, { stage: "FIX", index }));
  };

  const playFixOptionAscending = async () => {
    if (!question || question.stage !== "FIX" || !soundEnabled || isFixPreviewPlaying) return;
    const option = question.options[expandedFixIndex];
    if (!option) return;
    const token = Date.now();
    fixPreviewTokenRef.current = token;
    setIsFixPreviewPlaying(true);
    try {
      const orderedCells = option.line
        .map((step) => step.cell)
        .slice()
        .sort((left, right) => cellToMidi(left) - cellToMidi(right));
      for (const cell of orderedCells) {
        if (fixPreviewTokenRef.current !== token) return;
        await playFretMidi(cellToMidi(cell), fretToneVolume);
        await wait(110);
      }
    } finally {
      if (fixPreviewTokenRef.current === token) {
        setIsFixPreviewPlaying(false);
      }
    }
  };

  const handlePositionBoardClick = async (questionItem: PositionQuestion, cell: Cell) => {
    if (review || disabled) return;
    if (questionItem.shownCells.some((shownCell) => sameCell(shownCell, cell))) return;
    if (soundEnabled) {
      await playFretMidi(cellToMidi(cell), fretToneVolume);
    }
    if (positionAnswers.some((picked) => sameCell(picked, cell))) {
      const nextAnswers = positionAnswersRef.current.filter((picked) => !sameCell(picked, cell));
      positionAnswersRef.current = nextAnswers;
      setPositionAnswers(nextAnswers);
      return;
    }
    const nextAnswers = uniqueCells([...positionAnswersRef.current, cell]);
    positionAnswersRef.current = nextAnswers;
    setPositionAnswers(nextAnswers);
  };

  const handleCompleteBoardClick = async (questionItem: CompleteQuestion, cell: Cell) => {
    if (review || disabled) return;
    if (soundEnabled) {
      await playFretMidi(cellToMidi(cell), fretToneVolume);
    }

    const assignedBlankIndex = Object.entries(completeAnswersRef.current).find(([, picked]) => sameCell(picked, cell))?.[0];
    if (assignedBlankIndex !== undefined) {
      setActiveBlankIndex(Number(assignedBlankIndex));
      return;
    }

    const targetBlankIndex = activeBlankIndex ?? questionItem.blankIndices.find((blankIndex) => !completeAnswersRef.current[blankIndex]) ?? null;
    if (targetBlankIndex === null) return;

    const nextAnswers = { ...completeAnswersRef.current, [targetBlankIndex]: cell };
    completeAnswersRef.current = nextAnswers;
    setCompleteAnswers(nextAnswers);
    const nextBlank = questionItem.blankIndices.find((blankIndex) => !nextAnswers[blankIndex]);
    setActiveBlankIndex(nextBlank ?? null);
  };

  const confirmCurrentQuestion = async () => {
    if (!question || !canConfirm) return;
    if (question.stage === "FIX") {
      await handleFixSelect(question, expandedFixIndexRef.current);
      return;
    }
    if (question.stage === "POSITION") {
      const selectedCells = uniqueCells(positionAnswersRef.current);
      const correctSelections = selectedCells.filter((cell) => question.acceptedCells.some((target) => sameCell(target, cell)));
      const wrongSelections = selectedCells.filter((cell) => !question.acceptedCells.some((target) => sameCell(target, cell)));
      submitEvaluation(evaluateLineMapperQuestion(question, { stage: "POSITION", cells: correctSelections, mistakes: wrongSelections }));
      return;
    }
    const orderedCells = question.blankIndices.map((blankIndex) => completeAnswersRef.current[blankIndex]).filter(Boolean) as Cell[];
    submitEvaluation(evaluateLineMapperQuestion(question, { stage: "COMPLETE", cells: orderedCells, mistakes: [] }));
  };

  const skipCurrentQuestion = () => {
    if (!question) return;
    if (review) {
      nextQuestion();
      return;
    }
    if (mode === "CHALLENGE") {
      registerAttempt(question, false);
    }
    nextQuestion();
  };

  const resetCompleteAnswers = (questionItem: CompleteQuestion) => {
    setCompleteAnswers({});
    completeAnswersRef.current = {};
    setActiveBlankIndex(questionItem.blankIndices[0] ?? null);
  };

  useEffect(() => {
    expandedFixIndexRef.current = expandedFixIndex;
  }, [expandedFixIndex]);

  useEffect(() => {
    fixPreviewTokenRef.current += 1;
    setIsFixPreviewPlaying(false);
  }, [expandedFixIndex, question]);

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      return Boolean(
        element?.tagName === "INPUT"
        || element?.tagName === "TEXTAREA"
        || element?.tagName === "SELECT"
        || element?.isContentEditable,
      );
    };

    const blurActiveElement = () => {
      const active = document.activeElement as HTMLElement | null;
      if (active?.blur) active.blur();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.code !== "Space") return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      blurActiveElement();
      if (review) {
        nextQuestion();
        return;
      }
      if (!disabled && canConfirm) {
        void confirmCurrentQuestion();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space" || isTypingTarget(event.target)) return;
      event.preventDefault();
      blurActiveElement();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canConfirm, disabled, review]);

  const handleBoardClick = async (cell: Cell) => {
    if (!question) return;
    if (question.stage === "POSITION") {
      await handlePositionBoardClick(question, cell);
      return;
    }
    if (question.stage === "COMPLETE") {
      await handleCompleteBoardClick(question, cell);
    }
  };

  return (
    <section className="mg-game-card mg-lm-game-card" data-testid="mg-lm-game">
      <header className="mg-lm-header">
        <small className="mg-lm-goal">{currentGoal}</small>
        <div className="mg-lm-title-row">
          <h2>{question ? `${question.rootName} ${question.rule.label}` : "-"}</h2>
          {question ? (
            <button
              type="button"
              data-testid="mg-lm-rule-toggle"
              className={`ghost-btn mg-lm-rule-toggle ${showRuleSummary ? "active-mini" : ""}`}
              onClick={() => setShowRuleSummary((prev) => !prev)}
            >
              구성음
            </button>
          ) : null}
        </div>
        {showRuleSummary && ruleSummary ? (
          <div className="mg-lm-rule-summary" data-testid="mg-lm-rule-summary">
            <span>구성음 {ruleSummary.notes}</span>
            <span>도수 {ruleSummary.degrees}</span>
          </div>
        ) : null}
        <div className="mg-lm-inline-metrics">
          {mode === "CHALLENGE" ? <span>점수 {score}</span> : null}
          <span>정답 {correct}/{attempts}</span>
          {mode === "CHALLENGE" ? <span>정확도 {accuracy}%</span> : null}
        </div>
      </header>

      {question?.stage === "FIX" ? (
        <>
          <p className="mg-lm-legend">{legendText}</p>
          <section className="card mg-lm-line-card" data-testid="mg-lm-fix-board">
            {expandedFixOption ? (
              <article className="mg-lm-fix-preview" data-testid="mg-lm-fix-preview">
                <div className="mg-lm-fix-preview-head">
                  <div>
                    <strong>확대 보기 {expandedFixIndex + 1}</strong>
                    <small className="muted">눌러서 크게 보고 아래 확인 버튼으로 제출합니다.</small>
                  </div>
                  <button
                    type="button"
                    data-testid="mg-lm-fix-audio-preview"
                    className="ghost-btn"
                    onClick={() => void playFixOptionAscending()}
                    disabled={!soundEnabled || isFixPreviewPlaying}
                  >
                    {isFixPreviewPlaying ? "상행 재생 중" : "상행으로 듣기"}
                  </button>
                </div>
                <LineOptionBoard
                  line={expandedFixOption.line.map((step) => step.cell)}
                  start={expandedFixOption.line[0]?.cell ?? question.anchorCell}
                  goal={expandedFixOption.line[expandedFixOption.line.length - 1]?.cell ?? question.targetCell}
                  invalidIndex={expandedFixOption.invalidIndex}
                  showEndpoints={false}
                  showWrongHighlight={Boolean(review && review.correctFixIndex === expandedFixIndex)}
                  maxVisibleFret={Math.max(question.displayMaxFret, 4)}
                  height={214}
                  boardAspectRatio={4.35}
                  showNoteLabels={false}
                  cellLabels={fixReviewLabels}
                  extraMarkers={fixReviewMarkers}
                  fretLineWidth={fretLineWidth}
                  boardPreset={boardPreset}
                  inlayPreset={inlayPreset}
                />
              </article>
            ) : null}
            <div className="mg-lm-option-scroll">
              <div
                className="mg-lm-option-grid"
                style={{
                  gridTemplateColumns: `repeat(${question.options.length}, minmax(150px, 1fr))`,
                  minWidth: `${Math.max(question.options.length * 170, 320)}px`,
                }}
              >
                {question.options.map((option, index) => (
                  <button
                    key={option.id}
                    type="button"
                    data-testid={`mg-lm-fix-option-${index}`}
                    className={[
                      "mg-lm-option-btn",
                      expandedFixIndex === index ? "is-active" : "",
                      review?.selectedFixIndex === index && !review.ok ? "is-wrong" : "",
                      review?.correctFixIndex === index ? "is-correct" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => {
                      expandedFixIndexRef.current = index;
                      setExpandedFixIndex(index);
                    }}
                    disabled={disabled}
                  >
                    <span className="mg-lm-option-label">보기 {index + 1}</span>
                    <LineOptionBoard
                      line={option.line.map((step) => step.cell)}
                      start={option.line[0]?.cell ?? question.anchorCell}
                      goal={option.line[option.line.length - 1]?.cell ?? question.targetCell}
                      invalidIndex={option.invalidIndex}
                      showEndpoints={false}
                      showWrongHighlight={Boolean(review && review.correctFixIndex === index)}
                      maxVisibleFret={Math.max(question.displayMaxFret, 4)}
                      height={90}
                      boardAspectRatio={3.1}
                      showNoteLabels={false}
                      fretLineWidth={fretLineWidth}
                      boardPreset={boardPreset}
                      inlayPreset={inlayPreset}
                    />
                  </button>
                ))}
              </div>
            </div>
          </section>
        </>
      ) : null}

      {question?.stage === "POSITION" ? (
        <>
          <p className="mg-lm-legend">
            {legendText}
          </p>
          <FretboardCanvas
            maxFret={boardMaxFret}
            markers={markers}
            onCellClick={handleBoardClick}
            disabled={disabled || Boolean(review)}
            height={298}
            detectMode={detectMode}
            hitProfile="FRET_CENTERED"
            showHitZones={showHitZones}
            showNoteLabels={revealBoardLabels}
            cellLabels={review ? completeReviewLabels : []}
            fretLineWidth={fretLineWidth}
            boardPreset={boardPreset}
            inlayPreset={inlayPreset}
            constraintRange={{ ...question.pocketRange, label: question.pocketRange.label }}
          />
        </>
      ) : null}

      {question?.stage === "COMPLETE" ? (
        <>
          <div className="mg-lm-route-strip">
            <div className="mg-lm-endpoint-badge is-start">
              <small>시작</small>
              <strong>{question.line[0].noteName}</strong>
              <span>{question.line[0].degreeLabel}</span>
            </div>
            <div className="mg-lm-route-arrow">{question.direction === "UP" ? "상행" : "하행"}</div>
            <div className="mg-lm-endpoint-badge is-end">
              <small>끝</small>
              <strong>{question.line[question.line.length - 1].noteName}</strong>
              <span>{question.line[question.line.length - 1].degreeLabel}</span>
            </div>
          </div>
          <p className="mg-lm-legend">{legendText}</p>
          <FretboardCanvas
            maxFret={boardMaxFret}
            markers={markers}
            onCellClick={handleBoardClick}
            disabled={disabled || Boolean(review)}
            height={298}
            detectMode={detectMode}
            hitProfile="FRET_CENTERED"
            showHitZones={showHitZones}
            showNoteLabels={revealBoardLabels}
            fretLineWidth={fretLineWidth}
            boardPreset={boardPreset}
            inlayPreset={inlayPreset}
          />
          <section className="card mg-lm-line-card" data-testid="mg-lm-complete-board">
            <div className="mg-lm-step-row">
              {question.line.map((step, index) => {
                const isBlank = question.blankIndices.includes(index);
                const isActive = activeBlankIndex === index;
                const selectedCell = completeAnswers[index];
                const blankOrder = question.blankIndices.indexOf(index);
                const isWrong =
                  Boolean(review) &&
                  isBlank &&
                  Boolean(selectedCell) &&
                  !question.acceptedCellsByStep[blankOrder]?.some((candidate) => sameCell(candidate, selectedCell));
                const isCorrect = review ? !isWrong : Boolean(selectedCell);
                const noteText = review ? step.noteName : isBlank ? (selectedCell ? "선택됨" : "아직 비어 있음") : step.noteName;
                const degreeText =
                  review
                    ? step.degreeLabel
                    : isBlank
                    ? isActive
                      ? "현재 입력 칸"
                      : selectedCell
                      ? "다른 음으로 교체 가능"
                      : "지판에서 눌러 채우기"
                    : step.degreeLabel;
                const chipContent = (
                  <>
                    <strong>{!isBlank ? (index === 0 ? "시작" : "끝") : `중간 ${question.blankIndices.indexOf(index) + 1}`}</strong>
                    <span>{noteText}</span>
                    <small>{degreeText}</small>
                  </>
                );
                if (!review && isBlank) {
                  return (
                    <button
                      key={`complete-step-${index}`}
                      type="button"
                      className={stepClass(true, isActive, Boolean(selectedCell), false, Boolean(selectedCell), false)}
                      onClick={() => setActiveBlankIndex(index)}
                      disabled={disabled}
                    >
                      {chipContent}
                    </button>
                  );
                }
                return (
                  <div key={`complete-step-${index}`} className={stepClass(isBlank, isActive, Boolean(selectedCell), isWrong, isCorrect, !isBlank)}>
                    {chipContent}
                  </div>
                );
              })}
            </div>
          </section>
        </>
      ) : null}

      {review && ruleSummary ? (
        <section className={`card mg-explain-card ${review.ok ? "ok" : "bad"}`}>
          <h4>{review.title}</h4>
          <p className="mg-lm-review-main">{review.explanation.reason}</p>
          <div className="mg-lm-review-grid">
            <article>
              <small>구성음</small>
              <strong>{ruleSummary.notes}</strong>
            </article>
            <article>
              <small>도수</small>
              <strong>{ruleSummary.degrees}</strong>
            </article>
            <article>
              <small>느낌</small>
              <strong>{ruleSummary.mood}</strong>
            </article>
          </div>
        </section>
      ) : null}

      <section className="card mg-lm-action-bar" data-testid="mg-lm-action-bar">
        <div className="mg-hit-controls">
          {!review ? (
            <button
              type="button"
              data-testid="mg-lm-confirm"
              className="primary-btn"
              onClick={() => void confirmCurrentQuestion()}
              disabled={!canConfirm}
            >
              확인
            </button>
          ) : null}
          <button
            type="button"
            data-testid="mg-lm-next"
            className="ghost-btn"
            onClick={skipCurrentQuestion}
            disabled={disabled && !review}
          >
            다음 문제
          </button>
          {!review && question?.stage === "COMPLETE" ? (
            <button type="button" className="ghost-btn" onClick={() => resetCompleteAnswers(question)} disabled={disabled}>
              다시 입력
            </button>
          ) : null}
        </div>
        <small className="muted">{actionHint}</small>
      </section>

      <details className="card mg-lm-extra-panel" data-testid="mg-lm-theory-card">
        <summary>더보기</summary>
        <div className="mg-lm-extra-block">
          {ruleSummary ? (
            <>
              <div className="mg-lm-mini-meta">
                <small>구성음</small>
                <strong>{ruleSummary.notes}</strong>
              </div>
              <div className="mg-lm-mini-meta">
                <small>도수</small>
                <strong>{ruleSummary.degrees}</strong>
              </div>
              <div className="mg-lm-mini-meta">
                <small>느낌</small>
                <strong>{ruleSummary.mood}</strong>
              </div>
              {ruleSummary.usage ? (
                <div className="mg-lm-mini-meta">
                  <small>언제 쓰나</small>
                  <strong>{ruleSummary.usage}</strong>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
        <div className="mg-lm-extra-block">
          <div className="mg-hit-controls">
            <button className={`ghost-btn ${soundEnabled ? "active-mini" : ""}`} onClick={() => onSoundEnabledChange(!soundEnabled)}>
              소리 {soundEnabled ? "ON" : "OFF"}
            </button>
            <button className={`ghost-btn ${showHitZones ? "active-mini" : ""}`} onClick={() => onShowHitZonesChange(!showHitZones)}>
              판정 영역 {showHitZones ? "ON" : "OFF"}
            </button>
            <button className={`ghost-btn ${showFretNotes ? "active-mini" : ""}`} onClick={() => onShowFretNotesChange(!showFretNotes)}>
              복기용 음이름 {showFretNotes ? "ON" : "OFF"}
            </button>
            <button className={`ghost-btn ${detectMode === "HYBRID" ? "active-mini" : ""}`} onClick={() => onDetectModeChange(detectMode === "ZONE" ? "WIRE" : detectMode === "WIRE" ? "HYBRID" : "ZONE")}>
              판정 방식 {detectMode}
            </button>
            <button className={`ghost-btn ${explainOn ? "active-mini" : ""}`} onClick={() => onExplainOnChange(!explainOn)}>
              해설 {explainOn ? "ON" : "OFF"}
            </button>
          </div>
        </div>
      </details>
    </section>
  );
}
