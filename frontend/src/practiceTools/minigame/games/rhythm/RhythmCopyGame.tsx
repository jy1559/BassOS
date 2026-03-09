import { useEffect, useRef, useState } from "react";
import type { GameMetrics, GameMode, RCCalibrationProfile, RhythmTemplate } from "../../types/models";
import type { RhythmNotationMode } from "../../userSettings";
import { buildRhythmCueEvent, playRhythmCue, scheduleToneSequence, type RhythmCueKind, type ScheduledToneEvent } from "../common/audio";
import { classifyTiming, rhythmTimingQuality } from "../common/scoring";
import { createSeededRng } from "../common/seed";
import {
  buildPattern,
  buildQueuedOnsets,
  createQueueCursor,
  getActiveQueuedOnset,
  judgeQueuedInput,
  markOverdueOnsets,
  msToTick,
  patternDurationMs,
  tickToMs,
  TICK_PER_BEAT,
  type QueueCursor,
  type QueuedOnset,
  type RhythmPattern,
} from "./rhythmEngine";
import {
  applyRhythmNoteStates,
  renderRhythm,
  renderRhythmHistory,
  updateRhythmOverlay,
  type RhythmHistoryMarker,
  type RhythmNoteVisualState,
  type RhythmRenderMeta,
} from "./vexflowRenderer";

type HitKind = RhythmCueKind;
type RcPhase = "IDLE" | "PREROLL" | "PLAYBACK";
type TransportMode = "ATTEMPT" | "GUIDE" | "BPM";

type HistoryEntry = {
  id: string;
  relativeMs: number;
  kind: HitKind;
  outcome: RhythmHistoryMarker["outcome"];
};

type AttemptState = {
  source: "PRACTICE" | "CHALLENGE";
  pattern: RhythmPattern;
  judgeOnsets: QueuedOnset[];
  displayOnsets: QueuedOnset[];
  cursor: QueueCursor;
  windowMs: number;
};

type AttemptSummary = {
  perfect: number;
  good: number;
  onsetMisses: number;
  matchedOnsets: number;
  strayInputs: number;
  qualitySum: number;
  accuracy: number;
  noteAccuracy: number;
  timingAccuracy: number;
  avgAbsMs: number;
  absDiffSum: number;
  diffCount: number;
  totalOnsets: number;
};

type RcTransport = {
  mode: TransportMode;
  stop: () => void;
  anchorMs: number;
  sessionStartAt: number;
  endAt: number;
  judgeEndAt: number;
  beatMs: number;
  totalBeats: number;
  pattern: RhythmPattern | null;
  previewOnsets: QueuedOnset[];
  attempt: AttemptState | null;
};

type RcMetricsState = {
  score: number;
  practicedPatterns: number;
  totalInputs: number;
  totalOnsets: number;
  matchedOnsets: number;
  perfect: number;
  good: number;
  miss: number;
  onsetMisses: number;
  strayInputs: number;
  timingQualitySum: number;
  absDiffSum: number;
  diffCount: number;
  lastProblemAccuracy: number;
  lastProblemNoteAccuracy: number;
  lastProblemQualitySum: number;
  lastProblemAvgAbsMs: number;
  failedAttempts: number;
};

type RcMetricsView = RcMetricsState & {
  accuracy: number;
  noteAccuracy: number;
  timingAccuracy: number;
  avgAbsMs: number;
};

type ChallengeProgress = {
  problemIndex: number;
  attemptsLeft: number;
  clearedCount: number;
  failedAttempts: number;
};

type ChallengeFinishPayload = {
  score: number;
  accuracy: number;
  durationSec: number;
  detail: Record<string, unknown>;
};

type Props = {
  mode: GameMode;
  difficulty: string;
  seed: string;
  challengeRunning: boolean;
  challengeToken: number;
  rhythmTemplates: Record<string, RhythmTemplate[]>;
  rhythmWindows: Record<string, number>;
  rhythmConfig: {
    preroll_beats: number;
    challenge_problem_count: number;
    challenge_attempts_per_problem: number;
  };
  notationMode: RhythmNotationMode;
  showMetronomeVisual: boolean;
  metronomeVolume: number;
  calibrationProfile: RCCalibrationProfile | null;
  onMetricsChange: (metrics: GameMetrics) => void;
  onChallengeFinish: (payload: ChallengeFinishPayload) => void | Promise<void>;
};

const INPUT_DEBOUNCE_MS = 45;
const BPM_LISTEN_BEATS = 64;
const ACCURACY_THRESHOLD = 80;
const STRAY_TIMING_WEIGHT = 0.35;

declare global {
  interface Window {
    __mgRcDebug?: {
      press: (kind: HitKind) => void;
      pressActive: () => void;
      currentKind: () => HitKind | "";
      phase: () => string;
      lastProblemAccuracy: () => number;
    };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round1(value: number): number {
  return Number(value.toFixed(1));
}

function createEmptyMetrics(): RcMetricsState {
  return {
    score: 0,
    practicedPatterns: 0,
    totalInputs: 0,
    totalOnsets: 0,
    matchedOnsets: 0,
    perfect: 0,
    good: 0,
    miss: 0,
    onsetMisses: 0,
    strayInputs: 0,
    timingQualitySum: 0,
    absDiffSum: 0,
    diffCount: 0,
    lastProblemAccuracy: 0,
    lastProblemNoteAccuracy: 0,
    lastProblemQualitySum: 0,
    lastProblemAvgAbsMs: 0,
    failedAttempts: 0,
  };
}

function calcRcNoteAccuracy(metrics: RcMetricsState): number {
  if (metrics.totalOnsets <= 0) return 0;
  return round1((metrics.matchedOnsets / metrics.totalOnsets) * 100);
}

function calcRcTimingAccuracy(metrics: RcMetricsState): number {
  const denom = metrics.totalOnsets + metrics.strayInputs * STRAY_TIMING_WEIGHT;
  if (denom <= 0) return 0;
  return round1((metrics.timingQualitySum / denom) * 100);
}

function metricsAvgAbsMs(metrics: RcMetricsState): number {
  if (metrics.diffCount <= 0) return 0;
  return round1(metrics.absDiffSum / metrics.diffCount);
}

function buildMetricsView(metrics: RcMetricsState): RcMetricsView {
  const timingAccuracy = calcRcTimingAccuracy(metrics);
  return {
    ...metrics,
    accuracy: timingAccuracy,
    noteAccuracy: calcRcNoteAccuracy(metrics),
    timingAccuracy,
    avgAbsMs: metricsAvgAbsMs(metrics),
  };
}

function resolveWindowMs(difficulty: string, rhythmWindows: Record<string, number>): number {
  const key = difficulty.toUpperCase();
  const value = Number(rhythmWindows[key] ?? rhythmWindows.EASY ?? 85);
  return Number.isFinite(value) ? Math.max(20, value) : 85;
}

function buildPatternForScope(
  rhythmTemplates: Record<string, RhythmTemplate[]>,
  difficulty: string,
  seed: string,
  scope: string
): RhythmPattern {
  const rng = createSeededRng(`${seed}:${difficulty}:${scope}`);
  return buildPattern(rhythmTemplates, difficulty, rng);
}

function buildBpmEvents(bpm: number, beats: number, volumeScale: number): ScheduledToneEvent[] {
  const beatMs = 60000 / Math.max(30, bpm);
  const events: ScheduledToneEvent[] = [];

  for (let index = 0; index < beats; index += 1) {
    const beatInBar = index % 4;
    const offsetMs = index * beatMs;
    const isKickBeat = beatInBar === 0 || beatInBar === 2;
    const isSnareBeat = beatInBar === 1 || beatInBar === 3;

    if (isKickBeat) {
      events.push({
        offsetMs,
        hz: beatInBar === 0 ? 72 : 78,
        durationSec: 0.13,
        volume: (beatInBar === 0 ? 0.26 : 0.2) * volumeScale,
        type: "sine",
      });
    }

    if (isSnareBeat) {
      events.push({
        offsetMs,
        hz: 184,
        durationSec: 0.055,
        volume: 0.11 * volumeScale,
        type: "sawtooth",
      });
      events.push({
        offsetMs,
        hz: 312,
        durationSec: 0.04,
        volume: 0.07 * volumeScale,
        type: "triangle",
      });
    }

    events.push({
      offsetMs,
      hz: beatInBar === 0 ? 2480 : 2180,
      durationSec: 0.022,
      volume: (beatInBar === 0 ? 0.09 : 0.06) * volumeScale,
      type: "square",
    });
    events.push({
      offsetMs: offsetMs + beatMs / 2,
      hz: 2320,
      durationSec: 0.018,
      volume: 0.05 * volumeScale,
      type: "square",
    });
  }

  return events.sort((a, b) => a.offsetMs - b.offsetMs);
}

function buildAttemptEvents(pattern: RhythmPattern, prerollBeats: number, volumeScale: number): ScheduledToneEvent[] {
  const playbackBeats = Math.max(1, Math.ceil(pattern.totalTicks / TICK_PER_BEAT));
  return buildBpmEvents(pattern.bpm, prerollBeats + playbackBeats, volumeScale);
}

function buildGuideEvents(pattern: RhythmPattern, prerollBeats: number, volumeScale: number): ScheduledToneEvent[] {
  const beatMs = 60000 / Math.max(30, pattern.bpm);
  const events = buildAttemptEvents(pattern, prerollBeats, volumeScale);
  for (const onset of pattern.expected) {
    const offsetMs = prerollBeats * beatMs + (onset.tick / TICK_PER_BEAT) * beatMs;
    events.push(buildRhythmCueEvent(offsetMs, onset.kind, "guide"));
  }
  return events.sort((a, b) => a.offsetMs - b.offsetMs);
}

function interpolateTimelineX(meta: RhythmRenderMeta, tick: number, totalTicks: number): number {
  const anchors = meta.anchors;
  if (!anchors.length) return meta.timelineStartX;
  const clampedTick = clamp(tick, 0, totalTicks);
  const first = anchors[0];

  if (clampedTick <= first.startTick) {
    if (first.startTick <= 0) return first.xCenter;
    const ratio = clampedTick / first.startTick;
    return meta.timelineStartX + (first.xCenter - meta.timelineStartX) * ratio;
  }

  for (let index = 0; index < anchors.length - 1; index += 1) {
    const current = anchors[index];
    const next = anchors[index + 1];
    if (clampedTick <= next.startTick) {
      const span = Math.max(1, next.startTick - current.startTick);
      const ratio = (clampedTick - current.startTick) / span;
      return current.xCenter + (next.xCenter - current.xCenter) * ratio;
    }
  }

  const last = anchors[anchors.length - 1];
  if (clampedTick <= last.endTick) return last.xCenter;
  const remaining = Math.max(1, totalTicks - last.endTick);
  const ratio = (clampedTick - last.endTick) / remaining;
  return last.xCenter + (meta.timelineEndX - last.xCenter) * clamp(ratio, 0, 1);
}

function relativeMsToTimelineX(meta: RhythmRenderMeta, pattern: RhythmPattern, relativeMs: number): number {
  const clampedMs = clamp(relativeMs, 0, patternDurationMs(pattern));
  const tick = msToTick(clampedMs, pattern.bpm);
  return interpolateTimelineX(meta, tick, pattern.totalTicks);
}

function buildHistoryMarkers(meta: RhythmRenderMeta, pattern: RhythmPattern, history: HistoryEntry[]): RhythmHistoryMarker[] {
  return history.map((entry) => ({
    id: entry.id,
    x: relativeMsToTimelineX(meta, pattern, entry.relativeMs),
    kind: entry.kind,
    outcome: entry.outcome,
  }));
}

function findPreviewActiveOnset(onsets: QueuedOnset[], relativeMs: number): QueuedOnset | null {
  for (const onset of onsets) {
    if (relativeMs < onset.earlyMs) return null;
    if (relativeMs <= onset.lateMs) return onset;
  }
  return null;
}

function buildAttemptNoteStates(
  attempt: AttemptState,
  relativeMs: number | null,
  meta: RhythmRenderMeta | null
): Record<string, RhythmNoteVisualState> {
  const states: Record<string, RhythmNoteVisualState> = {};

  for (let index = 0; index < attempt.judgeOnsets.length; index += 1) {
    const onset = attempt.judgeOnsets[index];
    const result = attempt.cursor.results[index];
    if (result.status === "PERFECT" || result.status === "GOOD") {
      states[onset.id] = "hit";
      continue;
    }
    if (result.status === "MISS") {
      states[onset.id] = "miss";
    }
  }

  if (meta) {
    const sustainReferenceMs = relativeMs ?? patternDurationMs(attempt.pattern) + attempt.windowMs + 1;
    for (const tie of meta.ties) {
      if (sustainReferenceMs < tickToMs(tie.triggerTick, attempt.pattern.bpm)) continue;
      const sourceState = states[tie.fromJudgeId];
      if (sourceState === "hit") {
        states[tie.toVisualId] = "hit";
      } else if (sourceState === "miss") {
        states[tie.toVisualId] = "miss";
      }
    }
  }

  if (relativeMs !== null) {
    const active = getActiveQueuedOnset(attempt.displayOnsets, attempt.cursor, relativeMs);
    if (active && !states[active.id]) {
      states[active.id] = "active";
    }
  }

  return states;
}

function buildGuideNoteStates(onsets: QueuedOnset[], relativeMs: number | null): Record<string, RhythmNoteVisualState> {
  if (relativeMs === null) return {};
  const active = findPreviewActiveOnset(onsets, relativeMs);
  if (!active) return {};
  return { [active.id]: "active" };
}

function summarizeAttempt(attempt: AttemptState): AttemptSummary {
  let perfect = 0;
  let good = 0;
  let onsetMisses = 0;
  let matchedOnsets = 0;
  let qualitySum = 0;
  let absDiffSum = 0;
  let diffCount = 0;

  for (let index = 0; index < attempt.judgeOnsets.length; index += 1) {
    const result = attempt.cursor.results[index];
    if (result.status === "PERFECT") {
      perfect += 1;
      matchedOnsets += 1;
      qualitySum += rhythmTimingQuality(result.diffMs ?? 0, attempt.windowMs);
    } else if (result.status === "GOOD") {
      good += 1;
      matchedOnsets += 1;
      qualitySum += rhythmTimingQuality(result.diffMs ?? 0, attempt.windowMs);
    } else if (result.status === "MISS") {
      onsetMisses += 1;
    }

    if (result.diffMs !== null) {
      absDiffSum += Math.abs(result.diffMs);
      diffCount += 1;
    }
  }

  const totalOnsets = attempt.judgeOnsets.length;
  const strayInputs = attempt.cursor.strayInputs;
  const noteAccuracy = totalOnsets > 0 ? round1((matchedOnsets / totalOnsets) * 100) : 0;
  const timingDenom = totalOnsets + strayInputs * STRAY_TIMING_WEIGHT;
  const timingAccuracy = timingDenom > 0 ? round1((qualitySum / timingDenom) * 100) : 0;
  const avgAbsMs = diffCount > 0 ? round1(absDiffSum / diffCount) : 0;

  return {
    perfect,
    good,
    onsetMisses,
    matchedOnsets,
    strayInputs,
    qualitySum,
    accuracy: timingAccuracy,
    noteAccuracy,
    timingAccuracy,
    avgAbsMs,
    absDiffSum,
    diffCount,
    totalOnsets,
  };
}

function cloneMetrics(metrics: RcMetricsState): RcMetricsState {
  return { ...metrics };
}

export function RhythmCopyGame({
  mode,
  difficulty,
  seed,
  challengeRunning,
  challengeToken,
  rhythmTemplates,
  rhythmWindows,
  rhythmConfig,
  notationMode,
  showMetronomeVisual,
  metronomeVolume,
  calibrationProfile,
  onMetricsChange,
  onChallengeFinish,
}: Props) {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const metaRef = useRef<RhythmRenderMeta | null>(null);
  const patternRef = useRef<RhythmPattern | null>(null);
  const transportRef = useRef<RcTransport | null>(null);
  const attemptRef = useRef<AttemptState | null>(null);
  const historyRef = useRef<HistoryEntry[]>([]);
  const metricsRef = useRef<RcMetricsState>(createEmptyMetrics());
  const progressRef = useRef<ChallengeProgress>({
    problemIndex: 0,
    attemptsLeft: 1,
    clearedCount: 0,
    failedAttempts: 0,
  });
  const phaseRef = useRef<RcPhase>("IDLE");
  const activeKindRef = useRef<HitKind | null>(null);
  const beatRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const lastInputAtRef = useRef(0);
  const practicePatternCounterRef = useRef(0);
  const launchTokenRef = useRef(0);
  const challengeStartedAtRef = useRef(0);
  const challengeFinishedRef = useRef(false);

  const [patternView, setPatternView] = useState<RhythmPattern | null>(null);
  const [sessionPhase, setSessionPhase] = useState<RcPhase>("IDLE");
  const [statusText, setStatusText] = useState("문제를 준비했습니다.");
  const [metricsView, setMetricsView] = useState<RcMetricsView>(buildMetricsView(createEmptyMetrics()));
  const [challengeView, setChallengeView] = useState<ChallengeProgress>(progressRef.current);
  const [currentTargetKind, setCurrentTargetKind] = useState<HitKind | null>(null);
  const [currentBeat, setCurrentBeat] = useState(0);

  const windowMs = resolveWindowMs(difficulty, rhythmWindows);
  const timingOffsetMs = calibrationProfile?.avg_offset_ms ?? 0;

  const pushMetrics = (nextMetrics: RcMetricsState, progress = progressRef.current) => {
    metricsRef.current = nextMetrics;
    const nextView = buildMetricsView(nextMetrics);
    setMetricsView(nextView);
    setChallengeView({ ...progress });
    onMetricsChange({
      score: Math.round(nextMetrics.score),
      accuracy: nextView.timingAccuracy,
      detail: {
        correct: nextMetrics.perfect + nextMetrics.good,
        wrong: nextMetrics.miss,
        perfect: nextMetrics.perfect,
        good: nextMetrics.good,
        miss: nextMetrics.miss,
        onset_misses: nextMetrics.onsetMisses,
        note_accuracy: nextView.noteAccuracy,
        timing_accuracy: nextView.timingAccuracy,
        avg_abs_ms: nextView.avgAbsMs,
        problem_accuracy: nextMetrics.lastProblemAccuracy,
        problem_note_accuracy: nextMetrics.lastProblemNoteAccuracy,
        problem_timing_accuracy: nextMetrics.lastProblemAccuracy,
        timing_quality_sum: round1(nextMetrics.timingQualitySum),
        accuracy_threshold: ACCURACY_THRESHOLD,
        failed_attempts: nextMetrics.failedAttempts,
        total_onsets: nextMetrics.totalOnsets,
        matched_onsets: nextMetrics.matchedOnsets,
        stray_inputs: nextMetrics.strayInputs,
        cleared: progress.clearedCount,
        problems: mode === "CHALLENGE" ? rhythmConfig.challenge_problem_count : Math.max(0, nextMetrics.practicedPatterns),
        practiced_patterns: nextMetrics.practicedPatterns,
        calibration_std_ms: calibrationProfile?.std_ms ?? null,
      },
    });
  };

  const updatePhase = (nextPhase: RcPhase) => {
    if (phaseRef.current === nextPhase) return;
    phaseRef.current = nextPhase;
    setSessionPhase(nextPhase);
  };

  const updateTargetKind = (nextKind: HitKind | null) => {
    if (activeKindRef.current === nextKind) return;
    activeKindRef.current = nextKind;
    setCurrentTargetKind(nextKind);
  };

  const updateBeat = (nextBeat: number) => {
    if (beatRef.current === nextBeat) return;
    beatRef.current = nextBeat;
    setCurrentBeat(nextBeat);
  };

  const syncBoard = (relativeMs: number | null, phaseMode: TransportMode | null = transportRef.current?.mode ?? null) => {
    const meta = metaRef.current;
    const pattern = patternRef.current;
    if (!meta || !pattern) return;

    let noteStates: Record<string, RhythmNoteVisualState> = {};
    if (phaseMode === "ATTEMPT" && attemptRef.current) {
      noteStates = buildAttemptNoteStates(attemptRef.current, relativeMs, meta);
    } else if (phaseMode === "GUIDE") {
      const preview = transportRef.current?.previewOnsets ?? [];
      noteStates = buildGuideNoteStates(preview, relativeMs);
    } else if (attemptRef.current) {
      noteStates = buildAttemptNoteStates(attemptRef.current, null, meta);
    }

    applyRhythmNoteStates(meta, noteStates);
    renderRhythmHistory(meta, buildHistoryMarkers(meta, pattern, historyRef.current));
    updateRhythmOverlay(meta, {
      playheadX: relativeMs === null ? null : relativeMsToTimelineX(meta, pattern, relativeMs),
    });
  };

  const stopTransport = (clearAttempt = false) => {
    launchTokenRef.current += 1;
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    transportRef.current?.stop();
    transportRef.current = null;
    if (clearAttempt) {
      attemptRef.current = null;
    }
    updatePhase("IDLE");
    updateBeat(0);
    updateTargetKind(null);
    syncBoard(null, null);
  };

  const loadPattern = (pattern: RhythmPattern, message: string) => {
    stopTransport(true);
    historyRef.current = [];
    patternRef.current = pattern;
    setPatternView(pattern);
    setStatusText(message);
  };

  const finishChallenge = (progress: ChallengeProgress) => {
    if (challengeFinishedRef.current) return;
    challengeFinishedRef.current = true;
    stopTransport(false);
    const metrics = metricsRef.current;
    const noteAccuracy = calcRcNoteAccuracy(metrics);
    const timingAccuracy = calcRcTimingAccuracy(metrics);
    const durationSec = Math.max(1, Math.round((performance.now() - challengeStartedAtRef.current) / 1000));
    void onChallengeFinish({
      score: Math.round(metrics.score),
      accuracy: timingAccuracy,
      durationSec,
      detail: {
        perfect: metrics.perfect,
        good: metrics.good,
        miss: metrics.miss,
        onset_misses: metrics.onsetMisses,
        note_accuracy: noteAccuracy,
        timing_accuracy: timingAccuracy,
        avg_abs_ms: metricsAvgAbsMs(metrics),
        problem_accuracy: metrics.lastProblemAccuracy,
        problem_note_accuracy: metrics.lastProblemNoteAccuracy,
        problem_timing_accuracy: metrics.lastProblemAccuracy,
        timing_quality_sum: round1(metrics.timingQualitySum),
        accuracy_threshold: ACCURACY_THRESHOLD,
        cleared: progress.clearedCount,
        problems: rhythmConfig.challenge_problem_count,
        calibration_std_ms: calibrationProfile?.std_ms ?? null,
        total_onsets: metrics.totalOnsets,
        matched_onsets: metrics.matchedOnsets,
        stray_inputs: metrics.strayInputs,
        failed_attempts: progress.failedAttempts,
      },
    });
  };

  const finalizeAttempt = () => {
    const attempt = attemptRef.current;
    const transport = transportRef.current;
    if (!attempt || !transport) return;

    const finalRelativeMs = patternDurationMs(attempt.pattern) + attempt.windowMs + 1;
    markOverdueOnsets(attempt.judgeOnsets, attempt.cursor, finalRelativeMs);

    const summary = summarizeAttempt(attempt);
    stopTransport(false);
    syncBoard(null, null);

    const passed = summary.timingAccuracy >= ACCURACY_THRESHOLD;
    const baseMetrics = cloneMetrics(metricsRef.current);
    const nextMetrics: RcMetricsState = {
      ...baseMetrics,
      score: baseMetrics.score,
      practicedPatterns: baseMetrics.practicedPatterns + (mode === "PRACTICE" ? 1 : 0),
      totalInputs: baseMetrics.totalInputs + historyRef.current.length,
      totalOnsets: baseMetrics.totalOnsets + summary.totalOnsets,
      matchedOnsets: baseMetrics.matchedOnsets + summary.matchedOnsets,
      perfect: baseMetrics.perfect + summary.perfect,
      good: baseMetrics.good + summary.good,
      miss: baseMetrics.miss + summary.onsetMisses,
      onsetMisses: baseMetrics.onsetMisses + summary.onsetMisses,
      strayInputs: baseMetrics.strayInputs + summary.strayInputs,
      timingQualitySum: baseMetrics.timingQualitySum + summary.qualitySum,
      absDiffSum: baseMetrics.absDiffSum + summary.absDiffSum,
      diffCount: baseMetrics.diffCount + summary.diffCount,
      lastProblemAccuracy: summary.timingAccuracy,
      lastProblemNoteAccuracy: summary.noteAccuracy,
      lastProblemQualitySum: summary.qualitySum,
      lastProblemAvgAbsMs: summary.avgAbsMs,
      failedAttempts: baseMetrics.failedAttempts,
    };

    if (mode === "PRACTICE") {
      nextMetrics.score = Math.round(calcRcTimingAccuracy(nextMetrics));
      pushMetrics(nextMetrics);
      setStatusText(
        `${passed ? "성공" : "실패"}: 노트 ${summary.noteAccuracy.toFixed(1)}% / 타이밍 ${summary.timingAccuracy.toFixed(1)}% / 평균 오차 ${summary.avgAbsMs.toFixed(1)}ms`
      );
      return;
    }

    if (attempt.source === "PRACTICE") {
      setStatusText(
        `연습 결과: 노트 ${summary.noteAccuracy.toFixed(1)}% / 타이밍 ${summary.timingAccuracy.toFixed(1)}% / 평균 오차 ${summary.avgAbsMs.toFixed(1)}ms (점수 반영 안 됨)`
      );
      return;
    }

    const progress = { ...progressRef.current };
    if (passed) {
      progress.clearedCount += 1;
    } else {
      progress.failedAttempts += 1;
    }
    progress.problemIndex += 1;
    progress.attemptsLeft = 1;
    progressRef.current = progress;
    nextMetrics.failedAttempts = progress.failedAttempts;
    nextMetrics.score += Math.round(summary.timingAccuracy);
    pushMetrics(nextMetrics, progress);
    setStatusText(
      `${passed ? "도전 완료" : "도전 종료"}: 노트 ${summary.noteAccuracy.toFixed(1)}% / 타이밍 ${summary.timingAccuracy.toFixed(1)}%`
    );
    if (progress.problemIndex >= rhythmConfig.challenge_problem_count) {
      finishChallenge(progress);
      return;
    }
    const nextPattern = buildPatternForScope(rhythmTemplates, difficulty, seed, `challenge:${challengeToken}:problem:${progress.problemIndex}`);
    loadPattern(
      nextPattern,
      `문제 ${progress.problemIndex + 1}/${rhythmConfig.challenge_problem_count}. 듣고 연습한 뒤 도전하세요.`
    );
  };

  const animateTransport = () => {
    const transport = transportRef.current;
    if (!transport) return;

    const now = performance.now();
    const beatIndex = clamp(Math.floor((now - transport.anchorMs) / transport.beatMs) + 1, 0, transport.totalBeats);
    updateBeat(beatIndex > 0 ? ((beatIndex - 1) % 4) + 1 : 0);

    if (transport.mode === "BPM") {
      updatePhase("PLAYBACK");
      if (now >= transport.endAt) {
        stopTransport(true);
        setStatusText("드럼형 BPM 가이드 완료");
        return;
      }
      rafRef.current = window.requestAnimationFrame(animateTransport);
      return;
    }

    if (now < transport.sessionStartAt) {
      updatePhase("PREROLL");
      updateTargetKind(null);
      syncBoard(null, transport.mode);
      rafRef.current = window.requestAnimationFrame(animateTransport);
      return;
    }

    updatePhase("PLAYBACK");
    const relativeMs = now - transport.sessionStartAt;

    if (transport.mode === "ATTEMPT" && transport.attempt) {
      markOverdueOnsets(transport.attempt.judgeOnsets, transport.attempt.cursor, relativeMs);
      const active = getActiveQueuedOnset(transport.attempt.displayOnsets, transport.attempt.cursor, relativeMs);
      updateTargetKind(active?.kind ?? null);
      syncBoard(clamp(relativeMs, 0, patternDurationMs(transport.attempt.pattern)), "ATTEMPT");

      if (now >= transport.judgeEndAt) {
        finalizeAttempt();
        return;
      }

      rafRef.current = window.requestAnimationFrame(animateTransport);
      return;
    }

    const previewActive = findPreviewActiveOnset(transport.previewOnsets, relativeMs);
    updateTargetKind(previewActive?.kind ?? null);
    if (transport.pattern) {
      syncBoard(clamp(relativeMs, 0, patternDurationMs(transport.pattern)), "GUIDE");
    }
    if (now >= transport.endAt) {
      stopTransport(true);
      setStatusText("드럼 가이드 완료");
      return;
    }
    rafRef.current = window.requestAnimationFrame(animateTransport);
  };

  async function startAttempt(pattern: RhythmPattern, source: AttemptState["source"]) {
    if (phaseRef.current !== "IDLE") return;
    if (mode === "CHALLENGE" && !challengeRunning) return;
    stopTransport(false);
    historyRef.current = [];
    const beatMs = 60000 / Math.max(30, pattern.bpm);
    const judgeOnsets = buildQueuedOnsets(pattern, windowMs, timingOffsetMs);
    const displayOnsets = buildQueuedOnsets(pattern, windowMs, 0);
    const attempt: AttemptState = {
      source,
      pattern,
      judgeOnsets,
      displayOnsets,
      cursor: createQueueCursor(judgeOnsets),
      windowMs,
    };
    attemptRef.current = attempt;

    const launchId = ++launchTokenRef.current;
    const result = await scheduleToneSequence(buildAttemptEvents(pattern, rhythmConfig.preroll_beats, metronomeVolume), 140);
    if (launchId !== launchTokenRef.current) {
      result.stop();
      return;
    }

    const sessionStartAt = result.anchorMs + rhythmConfig.preroll_beats * beatMs;
    transportRef.current = {
      mode: "ATTEMPT",
      stop: result.stop,
      anchorMs: result.anchorMs,
      sessionStartAt,
      endAt: sessionStartAt + patternDurationMs(pattern),
      judgeEndAt: sessionStartAt + patternDurationMs(pattern) + windowMs,
      beatMs,
      totalBeats: rhythmConfig.preroll_beats + Math.max(1, Math.ceil(pattern.totalTicks / TICK_PER_BEAT)),
      pattern,
      previewOnsets: [],
      attempt,
    };

    updatePhase("PREROLL");
    updateTargetKind(null);
    syncBoard(null, "ATTEMPT");
    setStatusText(
      `${source === "CHALLENGE" ? "도전" : "연습"} 시작: 프리롤 ${rhythmConfig.preroll_beats}박 후 재생됩니다.`
    );
    rafRef.current = window.requestAnimationFrame(animateTransport);
  }

  const startGuidePreview = async () => {
    const pattern = patternRef.current;
    if (!pattern) return;
    if (phaseRef.current !== "IDLE") return;
    if (mode === "CHALLENGE" && !challengeRunning) return;
    stopTransport(false);
    historyRef.current = [];

    const beatMs = 60000 / Math.max(30, pattern.bpm);
    const previewOnsets = buildQueuedOnsets(pattern, windowMs, 0);
    const launchId = ++launchTokenRef.current;
    const result = await scheduleToneSequence(buildGuideEvents(pattern, rhythmConfig.preroll_beats, metronomeVolume), 140);
    if (launchId !== launchTokenRef.current) {
      result.stop();
      return;
    }

    const sessionStartAt = result.anchorMs + rhythmConfig.preroll_beats * beatMs;
    transportRef.current = {
      mode: "GUIDE",
      stop: result.stop,
      anchorMs: result.anchorMs,
      sessionStartAt,
      endAt: sessionStartAt + patternDurationMs(pattern),
      judgeEndAt: sessionStartAt + patternDurationMs(pattern),
      beatMs,
      totalBeats: rhythmConfig.preroll_beats + Math.max(1, Math.ceil(pattern.totalTicks / TICK_PER_BEAT)),
      pattern,
      previewOnsets,
      attempt: null,
    };

    updatePhase("PREROLL");
    updateTargetKind(null);
    syncBoard(null, "GUIDE");
    setStatusText("드럼 가이드 재생 중");
    rafRef.current = window.requestAnimationFrame(animateTransport);
  };

  const toggleBpmListen = async () => {
    const active = transportRef.current;
    if (active?.mode === "BPM") {
      stopTransport(true);
      setStatusText("드럼형 BPM 가이드 중지");
      return;
    }

    if (phaseRef.current !== "IDLE") return;
    const bpm = patternRef.current?.bpm ?? 100;
    if (mode === "CHALLENGE" && !challengeRunning) return;
    stopTransport(false);
    const launchId = ++launchTokenRef.current;
    const result = await scheduleToneSequence(buildBpmEvents(bpm, BPM_LISTEN_BEATS, metronomeVolume), 140);
    if (launchId !== launchTokenRef.current) {
      result.stop();
      return;
    }

    const beatMs = 60000 / Math.max(30, bpm);
    transportRef.current = {
      mode: "BPM",
      stop: result.stop,
      anchorMs: result.anchorMs,
      sessionStartAt: result.anchorMs,
      endAt: result.anchorMs + beatMs * BPM_LISTEN_BEATS,
      judgeEndAt: result.anchorMs + beatMs * BPM_LISTEN_BEATS,
      beatMs,
      totalBeats: BPM_LISTEN_BEATS,
      pattern: null,
      previewOnsets: [],
      attempt: null,
    };

    updatePhase("PLAYBACK");
    updateTargetKind(null);
    syncBoard(null, null);
    setStatusText(`${bpm} BPM 드럼형 가이드`);
    rafRef.current = window.requestAnimationFrame(animateTransport);
  };

  const handleInput = (kind: HitKind) => {
    const now = performance.now();
    if (now - lastInputAtRef.current < INPUT_DEBOUNCE_MS) return;
    lastInputAtRef.current = now;

    const transport = transportRef.current;
    const attempt = attemptRef.current;
    if (!transport || transport.mode !== "ATTEMPT" || !attempt) return;

    const relativeMs = now - transport.sessionStartAt;
    const outcome = judgeQueuedInput(attempt.judgeOnsets, attempt.cursor, relativeMs, kind, classifyTiming, attempt.windowMs);
    historyRef.current = [
      ...historyRef.current,
      {
        id: `${now}-${historyRef.current.length}`,
        relativeMs,
        kind,
        outcome:
          outcome.type === "WRONG_TYPE" || outcome.type === "STRAY"
            ? outcome.type
            : outcome.type,
      },
    ];
    updateTargetKind(getActiveQueuedOnset(attempt.displayOnsets, attempt.cursor, relativeMs)?.kind ?? null);
    syncBoard(relativeMs >= 0 ? clamp(relativeMs, 0, patternDurationMs(attempt.pattern)) : null, "ATTEMPT");
  };

  const triggerInput = (kind: HitKind) => {
    void playRhythmCue(kind, "input");
    handleInput(kind);
  };

  const loadNextPracticePattern = (autoStart = false) => {
    practicePatternCounterRef.current += 1;
    const pattern = buildPatternForScope(rhythmTemplates, difficulty, seed, `practice:${practicePatternCounterRef.current}`);
    loadPattern(pattern, "문제를 준비했습니다.");
    if (autoStart) {
      window.setTimeout(() => {
        void startAttempt(pattern, "PRACTICE");
      }, 60);
    }
  };

  useEffect(() => {
    if (!boardRef.current || !patternView) return;
    metaRef.current = renderRhythm(boardRef.current, patternView.measures, { notationMode });
    syncBoard(null, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patternView, notationMode]);

  useEffect(() => {
    if (mode !== "PRACTICE") return;
    challengeFinishedRef.current = false;
    practicePatternCounterRef.current = 0;
    progressRef.current = {
      problemIndex: 0,
      attemptsLeft: 1,
      clearedCount: 0,
      failedAttempts: 0,
    };
    setChallengeView({ ...progressRef.current });
    pushMetrics(createEmptyMetrics());
    loadNextPracticePattern(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, difficulty, seed, notationMode]);

  useEffect(() => {
    if (mode !== "CHALLENGE") return;
    if (!challengeRunning) {
      stopTransport(false);
      return;
    }

    challengeFinishedRef.current = false;
    challengeStartedAtRef.current = performance.now();
    const progress: ChallengeProgress = {
      problemIndex: 0,
      attemptsLeft: 1,
      clearedCount: 0,
      failedAttempts: 0,
    };
    progressRef.current = progress;
    setChallengeView({ ...progress });
    pushMetrics(createEmptyMetrics(), progress);

    const pattern = buildPatternForScope(rhythmTemplates, difficulty, seed, `challenge:${challengeToken}:problem:0`);
    loadPattern(pattern, `문제 1/${rhythmConfig.challenge_problem_count}. 듣고 연습한 뒤 도전하세요.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, challengeRunning, challengeToken, difficulty, seed]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      const key = event.key.toLowerCase();
      if (key === "f") {
        triggerInput("HIT");
      } else if (key === "j") {
        triggerInput("GHOST");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  useEffect(() => {
    window.__mgRcDebug = {
      press: (kind: HitKind) => triggerInput(kind),
      pressActive: () => triggerInput(activeKindRef.current ?? "HIT"),
      currentKind: () => activeKindRef.current ?? "",
      phase: () => phaseRef.current.toLowerCase(),
      lastProblemAccuracy: () => metricsRef.current.lastProblemAccuracy,
    };
    return () => {
      delete window.__mgRcDebug;
    };
  });

  useEffect(() => {
    return () => {
      stopTransport(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const controlsLocked = sessionPhase !== "IDLE";
  const hasPattern = Boolean(patternView);
  const remainingProblems = Math.max(0, rhythmConfig.challenge_problem_count - challengeView.problemIndex);

  return (
    <section className="mg-game-card" data-testid="mg-rc-game" data-session-phase={sessionPhase.toLowerCase()}>
      <div className="mg-row-wrap">
        <div>
          <h3>Rhythm Copy</h3>
          <p className="muted">{statusText}</p>
        </div>
        <div className="mg-mode-pill-row">
          <span className="mg-tag">{difficulty.replace(/_/g, " ")}</span>
          <span className="mg-tag">{patternView ? `${patternView.bpm} BPM` : "-- BPM"}</span>
          <span className="mg-tag">판정 {windowMs}ms</span>
        </div>
      </div>

      {showMetronomeVisual ? (
        <div className="mg-metro-visual" aria-hidden="true">
          {[1, 2, 3, 4].map((beat) => (
            <span key={`metro-${beat}`} className={`mg-metro-dot ${currentBeat === beat ? "active" : ""}`}>
              {beat}
            </span>
          ))}
        </div>
      ) : null}

      {mode === "CHALLENGE" ? (
        <div className="mg-rc-progress-wrap">
          <div className="mg-rc-progress-label">
            <span>
              문제 {Math.min(challengeView.problemIndex + 1, rhythmConfig.challenge_problem_count)} / {rhythmConfig.challenge_problem_count}
            </span>
            <span>남은 문제 {remainingProblems}</span>
            <span>통과 {challengeView.clearedCount}</span>
          </div>
          <div className="mg-rc-progress-track">
            <div
              className="mg-rc-progress-fill"
              style={{ width: `${(challengeView.problemIndex / Math.max(1, rhythmConfig.challenge_problem_count)) * 100}%` }}
            />
          </div>
        </div>
      ) : null}

      <section className="mg-stats-grid">
        <article className="mg-difficulty-summary">
          <small>점수</small>
          <p>{Math.round(metricsView.score)}</p>
        </article>
        <article className="mg-difficulty-summary">
          <small>노트 정확도</small>
          <p>{metricsView.noteAccuracy.toFixed(1)}%</p>
        </article>
        <article className="mg-difficulty-summary">
          <small>타이밍 정확도</small>
          <p>{metricsView.timingAccuracy.toFixed(1)}%</p>
        </article>
        <article className="mg-difficulty-summary">
          <small>평균 오차</small>
          <p>{metricsView.avgAbsMs.toFixed(1)}ms</p>
        </article>
      </section>

      <section className="mg-stats-grid">
        <article className="mg-difficulty-summary">
          <small>정답</small>
          <p>{metricsView.perfect + metricsView.good}</p>
        </article>
        <article className="mg-difficulty-summary">
          <small>오답</small>
          <p>{metricsView.miss}</p>
        </article>
        <article className="mg-difficulty-summary">
          <small>최근 노트</small>
          <p>{metricsView.lastProblemNoteAccuracy.toFixed(1)}%</p>
        </article>
        <article className="mg-difficulty-summary">
          <small>최근 타이밍</small>
          <p>{metricsView.lastProblemAccuracy.toFixed(1)}%</p>
        </article>
      </section>

      <div ref={boardRef} className="mg-rhythm-board" />

      <div className="mg-hit-controls">
        {mode === "PRACTICE" ? (
          <button
            className="primary-btn"
            onClick={() => patternRef.current && void startAttempt(patternRef.current, "PRACTICE")}
            disabled={controlsLocked || !hasPattern}
          >
            문제 시작 (예비박)
          </button>
        ) : null}
        {mode === "CHALLENGE" ? (
          <button
            className="primary-btn"
            onClick={() => patternRef.current && void startAttempt(patternRef.current, "CHALLENGE")}
            disabled={controlsLocked || !hasPattern || !challengeRunning}
          >
            도전 (점수 반영)
          </button>
        ) : null}
        <button className="ghost-btn" onClick={() => void toggleBpmListen()} disabled={controlsLocked && transportRef.current?.mode !== "BPM"}>
          BPM 듣기 / 그루브
        </button>
        <button
          data-testid="mg-rc-guide-button"
          className="ghost-btn"
          onClick={() => void startGuidePreview()}
          disabled={controlsLocked || !hasPattern || (mode === "CHALLENGE" && !challengeRunning)}
        >
          정답 듣기
        </button>
        {mode === "CHALLENGE" ? (
          <button
            className="ghost-btn"
            onClick={() => patternRef.current && void startAttempt(patternRef.current, "PRACTICE")}
            disabled={controlsLocked || !hasPattern || !challengeRunning}
          >
            연습 시도
          </button>
        ) : null}
        {mode === "PRACTICE" ? (
          <button className="ghost-btn" onClick={() => loadNextPracticePattern(false)}>
            새 문제
          </button>
        ) : null}
      </div>

      <div className="mg-hit-controls">
        <button className="primary-btn" onClick={() => triggerInput("HIT")}>
          F HIT
        </button>
        <button className="ghost-btn" onClick={() => triggerInput("GHOST")}>
          J GHOST
        </button>
      </div>

      <p className="mg-help-text">
        {mode === "CHALLENGE"
          ? "점수모드에서는 도전으로 시작한 1회만 점수에 반영됩니다. BPM 듣기, 정답 듣기, 연습 시도는 타이머만 흐르고 점수에는 들어가지 않습니다."
          : "F는 일반 노트, J는 고스트 노트 입력입니다. 붙임줄 뒤 음은 치지 않지만, 그 위치를 지나가면 앞 음 결과에 맞춰 함께 표시됩니다."}
      </p>
    </section>
  );
}
