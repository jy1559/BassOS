import { useEffect, useMemo, useRef, useState } from "react";
import type { ChallengeSignal, GameMetrics, GameMode } from "../../types/models";
import type {
  FretboardBoardPreset,
  FbhChallengeSettings,
  FbhDegreeWeights,
  FbhJudge,
  FretboardInlayPreset,
  FbhNearSettings,
  FbhPracticeSettings,
  FbhRangeSettings,
  HitDetectMode,
} from "../../userSettings";
import { defaultUserSettings } from "../../userSettings";
import { playFretMidi, playResultCue } from "../common/audio";
import { cellToMidi, cellToPc, midiToName, pcToName, type Cell } from "../common/music";
import { createSeededRng, type SeededRng } from "../common/seed";
import { FretboardCanvas, type FretboardMarker } from "./FretboardCanvas";
import { MAX_FRET, cellsInRange, containsCell, manhattanL1, nearestByManhattan } from "./fretboardMath";

type RuleDict = Record<
  string,
  {
    intervals: number[];
    name_ko?: string;
    group?: string;
    degree_labels?: string[];
  }
>;

type Props = {
  mode: GameMode;
  difficulty: string;
  seed: string;
  challenge: ChallengeSignal;
  challengeRules: FbhChallengeSettings;
  practiceRules: FbhPracticeSettings;
  soundEnabled: boolean;
  onSoundEnabledChange: (enabled: boolean) => void;
  onMetricsChange: (metrics: GameMetrics) => void;
  onChallengeTerminated: (payload: {
    reason: "LIVES_DEPLETED";
    score: number;
    accuracy: number;
    detail: Record<string, unknown>;
  }) => void;
  maxVisibleFret: number;
  detectMode: HitDetectMode;
  onDetectModeChange: (mode: HitDetectMode) => void;
  showHitZones: boolean;
  onShowHitZonesChange: (enabled: boolean) => void;
  showFretNotes: boolean;
  onShowFretNotesChange: (enabled: boolean) => void;
  fretLineWidth: number;
  fretToneVolume: number;
  boardPreset: FretboardBoardPreset;
  inlayPreset: FretboardInlayPreset;
  onBackHome: () => void;
  onStopChallenge: () => void;
  rangeConfig: Partial<Record<string, FbhRangeSettings>>;
  chordQualities: RuleDict;
  scaleRules: RuleDict;
};

type CodeSource = {
  key: string;
  label: string;
  intervals: number[];
  degreeLabels: string[];
  basic: boolean;
  extended: boolean;
  modal: boolean;
};

const MAX_NEAR_STRING_DELTA = 2;
type CodeDisplayMode = "SYMBOL" | "FULL" | "BOTH";
const FALLBACK_CODE_SOURCE: CodeSource = {
  key: "7",
  label: "7",
  intervals: [0, 4, 7, 10],
  degreeLabels: ["1", "3", "5", "b7"],
  basic: true,
  extended: false,
  modal: false,
};

type Question = {
  judge: FbhJudge;
  promptMain: string;
  promptType: string;
  promptSub?: string;
  acceptedCells: Cell[];
  anchor?: Cell;
  rootAnchor?: Cell;
  constraintRange?: {
    minFret: number;
    maxFret: number;
    label: string;
  };
};

const SEMITONE_TO_DEGREE = ["1", "b2", "2", "b3", "3", "4", "b5", "5", "b6", "6", "b7", "7"];

function normalizeConfig(difficulty: string, rangeConfig: Partial<Record<string, FbhRangeSettings>>): FbhRangeSettings {
  const fallback = defaultUserSettings.fbh.ranges.MASTER;
  const base =
    rangeConfig[difficulty] ??
    rangeConfig[difficulty.toUpperCase()] ??
    defaultUserSettings.fbh.ranges[difficulty.toUpperCase() as keyof typeof defaultUserSettings.fbh.ranges] ??
    fallback;
  const minFret = Math.max(0, Math.min(MAX_FRET, Math.floor(base.minFret)));
  const maxFret = Math.max(minFret, Math.min(MAX_FRET, Math.floor(base.maxFret)));
  const pcRangeBase = base.pcRange ?? fallback.pcRange;
  let pcMinFret = Math.max(0, Math.min(MAX_FRET, Math.floor(pcRangeBase.minFret)));
  let pcMaxFret = Math.max(pcMinFret, Math.min(MAX_FRET, Math.floor(pcRangeBase.maxFret)));
  if (pcMaxFret === pcMinFret) {
    if (pcMaxFret < MAX_FRET) pcMaxFret += 1;
    else pcMinFret = Math.max(0, pcMinFret - 1);
  }
  const span = Math.max(1, pcMaxFret - pcMinFret + 1);
  let windowMinSize = Math.max(2, Math.min(12, Math.floor(pcRangeBase.windowMinSize)));
  let windowMaxSize = Math.max(2, Math.min(12, Math.floor(pcRangeBase.windowMaxSize)));
  if (windowMaxSize < windowMinSize) windowMaxSize = windowMinSize;
  if (windowMinSize > span) windowMinSize = span;
  if (windowMaxSize > span) windowMaxSize = span;
  if (windowMaxSize < windowMinSize) windowMaxSize = windowMinSize;
  const judges = (base.judges ?? []).filter((judge): judge is FbhJudge => typeof judge === "string");
  return {
    ...base,
    minFret,
    maxFret,
    judges: judges.length ? judges : fallback.judges,
    pcRange: {
      minFret: pcMinFret,
      maxFret: pcMaxFret,
      windowMinSize,
      windowMaxSize,
    },
  };
}

function weightedPick<T>(rng: SeededRng, items: Array<{ item: T; weight: number }>): T {
  const normalized = items.filter((entry) => entry.weight > 0);
  if (!normalized.length) return items[0].item;
  const total = normalized.reduce((sum, entry) => sum + entry.weight, 0);
  let cursor = rng.next() * total;
  for (const entry of normalized) {
    cursor -= entry.weight;
    if (cursor <= 0) return entry.item;
  }
  return normalized[normalized.length - 1].item;
}

function parseDegreeToken(token: string): { semitone: number; degreeNumber: number; accidental: string } | null {
  const trimmed = token.trim().replace(/\s+/g, "");
  const match = /^(bb|b|##|#)?(\d{1,2})$/i.exec(trimmed);
  if (!match) return null;
  const accidental = (match[1] || "").toLowerCase();
  const degreeNumber = Number(match[2]);
  if (!Number.isFinite(degreeNumber) || degreeNumber < 1 || degreeNumber > 32) return null;
  const majorOffsets = [0, 2, 4, 5, 7, 9, 11];
  const octave = Math.floor((degreeNumber - 1) / 7);
  const degreeInOctave = ((degreeNumber - 1) % 7) + 1;
  const base = majorOffsets[degreeInOctave - 1] + octave * 12;
  const accidentalOffset = accidental === "bb" ? -2 : accidental === "b" ? -1 : accidental === "#" ? 1 : accidental === "##" ? 2 : 0;
  return {
    semitone: base + accidentalOffset,
    degreeNumber,
    accidental,
  };
}

function deriveDegreeLabel(interval: number): string {
  return SEMITONE_TO_DEGREE[((interval % 12) + 12) % 12] ?? "1";
}

function baseWeightForDegree(token: string, weights: FbhDegreeWeights): number {
  const parsed = parseDegreeToken(token);
  if (!parsed) return weights.chordToneWeight;
  const isExtended = parsed.degreeNumber >= 9;
  let weight = isExtended ? weights.extDegreeWeight : weights.chordToneWeight;
  if (parsed.accidental.includes("#")) weight *= weights.sharpWeight;
  if (parsed.accidental.includes("b")) weight *= weights.flatWeight;
  return Math.max(0.01, weight);
}

function buildCodeSources(chordQualities: RuleDict, scaleRules: RuleDict): CodeSource[] {
  const out: CodeSource[] = [];

  for (const [key, value] of Object.entries(chordQualities)) {
    const group = (value.group || "").toLowerCase();
    const label = value.name_ko || key;
    const intervals = value.intervals ?? [0, 4, 7];
    const degreeLabels =
      value.degree_labels && value.degree_labels.length ? [...value.degree_labels] : intervals.map((interval) => deriveDegreeLabel(interval));
    const basic = group.includes("triad") || group.includes("seventh") || key === "maj" || key === "min" || key === "m7" || key === "7";
    const extended = group.includes("extended") || group.includes("altered") || intervals.length > 4;
    out.push({
      key,
      label,
      intervals,
      degreeLabels,
      basic,
      extended,
      modal: false,
    });
  }

  for (const [key, value] of Object.entries(scaleRules)) {
    const label = value.name_ko || key;
    const intervals = value.intervals ?? [0, 2, 4, 7, 9];
    const degreeLabels =
      value.degree_labels && value.degree_labels.length ? [...value.degree_labels] : intervals.map((interval) => deriveDegreeLabel(interval));
    out.push({
      key,
      label,
      intervals,
      degreeLabels,
      basic: false,
      extended: false,
      modal: true,
    });
  }
  return out;
}

function selectCodeSourcePool(sources: CodeSource[], cfg: FbhRangeSettings): CodeSource[] {
  const { basic, extended, modal } = cfg.code.levels;
  const selected = sources.filter((source) => (basic && source.basic) || (extended && source.extended) || (modal && source.modal));
  return selected.length ? selected : sources.filter((source) => source.basic || source.extended || source.modal);
}

function chordSuffixFromKey(rawKey: string): string {
  const key = rawKey.trim();
  if (!key) return "";
  if (key === "M") return "";
  if (key === "m") return "m";
  if (key === "M7") return "Δ7";
  if (key === "M9") return "Δ9";

  const lower = key.toLowerCase().replace(/\s+/g, "").replace(/_/g, "");
  if (lower === "maj" || lower === "major") return "";
  if (lower === "min" || lower === "minor") return "m";
  if (lower === "7" || lower === "dom7" || lower === "dominant7") return "7";
  if (lower === "maj7" || lower === "major7") return "Δ7";
  if (lower === "maj9" || lower === "major9") return "Δ9";
  if (lower === "m7b5" || lower === "min7b5" || lower.includes("halfdim")) return "ø7";
  if (lower === "dim7" || lower === "o7" || lower === "°7") return "°7";
  if (lower === "dim" || lower === "o" || lower === "°") return "°";
  if (lower === "aug" || lower === "+") return "+";

  // Best-effort fallback for uncommon chord keys.
  return key
    .replace(/major/gi, "Δ")
    .replace(/maj/gi, "Δ")
    .replace(/minor/gi, "m")
    .replace(/min/gi, "m")
    .replace(/aug/gi, "+")
    .replace(/dim/gi, "°")
    .replace(/\s+/g, "");
}

function chordWordFromKey(rawKey: string): string {
  const key = rawKey.trim();
  if (!key) return "";
  if (key === "M") return "maj";
  if (key === "m") return "min";
  const lower = key.toLowerCase().replace(/\s+/g, "").replace(/_/g, "");
  if (lower === "maj" || lower === "major") return "maj";
  if (lower === "min" || lower === "minor") return "min";
  if (lower === "7" || lower === "dom7" || lower === "dominant7") return "7";
  if (lower === "maj7" || lower === "major7") return "maj7";
  if (lower === "maj9" || lower === "major9") return "maj9";
  if (lower === "m7b5" || lower === "min7b5" || lower.includes("halfdim")) return "m7b5";
  if (lower === "dim7" || lower === "o7" || lower === "°7") return "dim7";
  if (lower === "dim" || lower === "o" || lower === "°") return "dim";
  if (lower === "aug" || lower === "+") return "aug";
  return key;
}

function formatCodePrompt(rootText: string, source: CodeSource, mode: CodeDisplayMode): string {
  if (source.modal) {
    return `${rootText} ${source.label}`;
  }
  const symbol = `${rootText}${chordSuffixFromKey(source.key)}`;
  const full = `${rootText} ${chordWordFromKey(source.key)}`.trim();
  if (mode === "FULL") return full;
  if (mode === "BOTH") return `${symbol} / ${full}`;
  return symbol;
}

function questionTypeText(judge: FbhJudge): string {
  if (judge === "PC") return "노트 찾기";
  if (judge === "PC_RANGE") return "노트 찾기 (프랫 범위)";
  if (judge === "MIDI") return "노트 찾기 (옥타브 포함)";
  if (judge === "PC_NEAR") return "가까운 노트 찾기";
  if (judge === "MIDI_NEAR") return "가까운 노트 찾기 (옥타브 포함)";
  if (judge === "CODE") return "코드 도수 찾기";
  if (judge === "CODE_MIDI") return "코드 도수 찾기 (옥타브 포함)";
  return "루트 기준 도수 찾기";
}

function rangeLabel(minFret: number, maxFret: number): string {
  return `${minFret}~${maxFret}프렛`;
}

function pickDegreeToken(
  rng: SeededRng,
  degreeLabels: string[],
  weights: FbhDegreeWeights,
  fallbackIntervals: number[]
): { token: string; semitone: number } | null {
  const tokens = degreeLabels.length ? degreeLabels : fallbackIntervals.map((interval) => deriveDegreeLabel(interval));
  const parsed = tokens
    .map((token) => {
      const info = parseDegreeToken(token);
      if (!info) return null;
      return { token, semitone: info.semitone, weight: baseWeightForDegree(token, weights) };
    })
    .filter(Boolean) as Array<{ token: string; semitone: number; weight: number }>;
  if (!parsed.length) return null;
  const selected = weightedPick(
    rng,
    parsed.map((item) => ({ item, weight: item.weight }))
  );
  return {
    token: selected.token,
    semitone: selected.semitone,
  };
}

function randomAccidental(rng: SeededRng, weights: FbhDegreeWeights): string {
  const emptyWeight = 1;
  const sharpWeight = Math.max(0.01, weights.sharpWeight);
  const flatWeight = Math.max(0.01, weights.flatWeight);
  return weightedPick(rng, [
    { item: "", weight: emptyWeight },
    { item: "#", weight: sharpWeight },
    { item: "b", weight: flatWeight },
  ]);
}

function generateRootNearDegreeToken(rng: SeededRng, cfg: FbhRangeSettings): { token: string; semitone: number } {
  const allow9Plus = cfg.rootNear.allow9Plus;
  const chance = cfg.rootNear.degree9PlusRate;
  const number = allow9Plus && rng.bool(chance) ? rng.int(9, 12) : rng.int(1, 8);
  const accidental = rng.bool(0.34) ? randomAccidental(rng, cfg.rootNear.degreeWeights) : "";
  const token = `${accidental}${number}`;
  const parsed = parseDegreeToken(token);
  if (parsed) return { token, semitone: parsed.semitone };
  return { token: "1", semitone: 0 };
}

function nearStringAllowed(cell: Cell, anchor: Cell): boolean {
  return Math.abs(cell.string - anchor.string) <= MAX_NEAR_STRING_DELTA;
}

function matchesNearDirection(cell: Cell, anchor: Cell, near: FbhNearSettings): boolean {
  if (near.fretDirection === "GE_ANCHOR" && cell.fret < anchor.fret) return false;
  if (near.fretDirection === "LE_ANCHOR" && cell.fret > anchor.fret) return false;
  if (near.stringDirection === "SAME" && cell.string !== anchor.string) return false;
  if (near.stringDirection === "UPPER" && cell.string <= anchor.string) return false;
  if (near.stringDirection === "LOWER" && cell.string >= anchor.string) return false;
  return true;
}

function nearFilteredCells(cells: Cell[], anchor: Cell, near: FbhNearSettings): Cell[] {
  return cells.filter((cell) => matchesNearDirection(cell, anchor, near) && nearStringAllowed(cell, anchor));
}

function anchorEligible(anchor: Cell, near: FbhNearSettings): boolean {
  if (near.stringDirection === "UPPER" && anchor.string >= 3) return false;
  if (near.stringDirection === "LOWER" && anchor.string <= 0) return false;
  return true;
}

function pickAnchorForCandidates(rng: SeededRng, pool: Cell[], candidates: Cell[], near: FbhNearSettings): Cell {
  const eligible = pool.filter((anchor) => {
    if (!anchorEligible(anchor, near)) return false;
    const filtered = nearFilteredCells(candidates, anchor, near);
    return filtered.length > 0;
  });
  if (eligible.length) return rng.pick(eligible);
  const fallback = pool.filter((anchor) => anchorEligible(anchor, near));
  if (fallback.length) return rng.pick(fallback);
  return rng.pick(pool);
}

function collectNearAccepted(candidates: Cell[], anchor: Cell, near: FbhNearSettings): Cell[] {
  const directional = nearFilteredCells(candidates, anchor, near);
  const anchorLimited = candidates.filter((cell) => nearStringAllowed(cell, anchor));
  const base = directional.length ? directional : anchorLimited;
  if (!base.length) return [];
  const threshold = Math.max(4, near.l1Distance);
  const inRange = base.filter((cell) => manhattanL1(cell, anchor) <= threshold);
  if (inRange.length) return inRange;
  return nearestByManhattan(base, anchor);
}

function anyJudge(rng: SeededRng, cfg: FbhRangeSettings): FbhJudge {
  const judges = cfg.judges.length ? cfg.judges : defaultUserSettings.fbh.ranges.MASTER.judges;
  return rng.pick(judges);
}

function chooseQuestion(
  rng: SeededRng,
  questionPool: Cell[],
  answerPool: Cell[],
  cfg: FbhRangeSettings,
  codeSources: CodeSource[],
  judge: FbhJudge,
  codeDisplayMode: CodeDisplayMode
): Question | null {
  if (judge === "PC_RANGE") {
    const envMin = Math.max(0, Math.min(MAX_FRET, cfg.pcRange.minFret));
    const envMax = Math.max(envMin, Math.min(MAX_FRET, cfg.pcRange.maxFret));
    const envelopePool = answerPool.filter((cell) => cell.fret >= envMin && cell.fret <= envMax);
    if (!envelopePool.length) return null;

    const span = Math.max(1, envMax - envMin + 1);
    const minSize = Math.max(1, Math.min(cfg.pcRange.windowMinSize, span));
    const maxSize = Math.max(minSize, Math.min(cfg.pcRange.windowMaxSize, span));
    const size = rng.int(minSize, maxSize);
    const start = rng.int(envMin, envMax - size + 1);
    const end = start + size - 1;

    const windowPool = envelopePool.filter((cell) => cell.fret >= start && cell.fret <= end);
    if (!windowPool.length) return null;
    const target = rng.pick(windowPool);
    const pc = cellToPc(target);
    const acceptedCells = windowPool.filter((cell) => cellToPc(cell) === pc);
    if (!acceptedCells.length) return null;

    const label = rangeLabel(start, end);
    return {
      judge,
      promptMain: pcToName(pc),
      promptType: questionTypeText(judge),
      promptSub: `제약: ${label} 범위 내에서 찾기`,
      acceptedCells,
      constraintRange: {
        minFret: start,
        maxFret: end,
        label,
      },
    };
  }

  if (judge === "PC") {
    const target = rng.pick(questionPool);
    const pc = cellToPc(target);
    return {
      judge,
      promptMain: pcToName(pc),
      promptType: questionTypeText(judge),
      acceptedCells: answerPool.filter((cell) => cellToPc(cell) === pc),
    };
  }

  if (judge === "MIDI") {
    const target = rng.pick(questionPool);
    const midi = cellToMidi(target);
    return {
      judge,
      promptMain: midiToName(midi),
      promptType: questionTypeText(judge),
      acceptedCells: answerPool.filter((cell) => cellToMidi(cell) === midi),
    };
  }

  if (judge === "PC_NEAR") {
    const pc = cellToPc(rng.pick(questionPool));
    const candidates = answerPool.filter((cell) => cellToPc(cell) === pc);
    if (!candidates.length) return null;
    const anchor = pickAnchorForCandidates(rng, questionPool, candidates, cfg.near);
    const acceptedCells = collectNearAccepted(candidates, anchor, cfg.near);
    return {
      judge,
      promptMain: pcToName(pc),
      promptType: questionTypeText(judge),
      acceptedCells,
      anchor,
    };
  }

  if (judge === "MIDI_NEAR") {
    const midi = cellToMidi(rng.pick(questionPool));
    const candidates = answerPool.filter((cell) => cellToMidi(cell) === midi);
    if (!candidates.length) return null;
    const anchor = pickAnchorForCandidates(rng, questionPool, candidates, cfg.near);
    const acceptedCells = collectNearAccepted(candidates, anchor, cfg.near);
    return {
      judge,
      promptMain: midiToName(midi),
      promptType: questionTypeText(judge),
      acceptedCells,
      anchor,
    };
  }

  if (judge === "CODE") {
    if (!codeSources.length) return null;
    const source = rng.pick(codeSources);
    const pickedDegree = pickDegreeToken(rng, source.degreeLabels, cfg.code.degreeWeights, source.intervals);
    if (!pickedDegree) return null;
    const rootPc = rng.int(0, 11);
    const targetPc = ((rootPc + pickedDegree.semitone) % 12 + 12) % 12;
    const acceptedCells = answerPool.filter((cell) => cellToPc(cell) === targetPc);
    if (!acceptedCells.length) return null;
    return {
      judge,
      promptMain: `${formatCodePrompt(pcToName(rootPc), source, codeDisplayMode)} - ${pickedDegree.token}도`,
      promptType: questionTypeText(judge),
      acceptedCells,
    };
  }

  if (judge === "CODE_MIDI") {
    if (!codeSources.length) return null;
    const source = rng.pick(codeSources);
    const pickedDegree = pickDegreeToken(rng, source.degreeLabels, cfg.code.degreeWeights, source.intervals);
    if (!pickedDegree) return null;
    const rootCell = rng.pick(questionPool);
    const rootMidi = cellToMidi(rootCell);
    const targetMidi = rootMidi + pickedDegree.semitone;
    const acceptedCells = answerPool.filter((cell) => cellToMidi(cell) === targetMidi);
    if (!acceptedCells.length) return null;
    return {
      judge,
      promptMain: `${formatCodePrompt(midiToName(rootMidi), source, codeDisplayMode)} - ${pickedDegree.token}도`,
      promptType: questionTypeText(judge),
      acceptedCells,
    };
  }

  if (judge === "ROOT_NEAR") {
    const source = codeSources.length ? rng.pick(codeSources) : null;
    const degree = generateRootNearDegreeToken(rng, cfg);

    const candidatesByAnchor = questionPool
      .filter((anchor) => anchorEligible(anchor, cfg.rootNear.near))
      .map((rootAnchor) => {
        const rootMidi = cellToMidi(rootAnchor);
        const semitone = cfg.rootNear.includeOctave ? degree.semitone : ((degree.semitone % 12) + 12) % 12;
        const targetMidi = rootMidi + semitone;
        const exactCandidates = cfg.rootNear.includeOctave
          ? answerPool.filter((cell) => cellToMidi(cell) === targetMidi)
          : answerPool.filter((cell) => cellToPc(cell) === ((targetMidi % 12) + 12) % 12);
        const accepted = collectNearAccepted(exactCandidates, rootAnchor, cfg.rootNear.near);
        return {
          rootAnchor,
          accepted,
        };
      })
      .filter((entry) => entry.accepted.length > 0);

    if (!candidatesByAnchor.length) return null;
    const selected = rng.pick(candidatesByAnchor);
    const rootName = pcToName(cellToPc(selected.rootAnchor));
    return {
      judge,
      promptMain: `${formatCodePrompt(rootName, source ?? FALLBACK_CODE_SOURCE, codeDisplayMode)} - ${degree.token}도`,
      promptType: questionTypeText(judge),
      acceptedCells: selected.accepted,
      rootAnchor: selected.rootAnchor,
    };
  }

  return null;
}

function makeQuestion(
  rng: SeededRng,
  questionPool: Cell[],
  answerPool: Cell[],
  cfg: FbhRangeSettings,
  codeSources: CodeSource[],
  codeDisplayMode: CodeDisplayMode,
  previousQuestion?: Question | null
): Question {
  const prevKey = previousQuestion ? questionKey(previousQuestion) : "";
  for (let i = 0; i < 72; i += 1) {
    const judge = anyJudge(rng, cfg);
    const next = chooseQuestion(rng, questionPool, answerPool, cfg, codeSources, judge, codeDisplayMode);
    if (!next || !next.acceptedCells.length) continue;
    if (prevKey && questionKey(next) === prevKey) continue;
    return next;
  }

  const target = rng.pick(questionPool);
  const fallbackRange = chooseQuestion(rng, questionPool, answerPool, cfg, codeSources, "PC_RANGE", codeDisplayMode);
  if (fallbackRange && fallbackRange.acceptedCells.length) return fallbackRange;
  const pc = cellToPc(target);
  return {
    judge: "PC",
    promptMain: pcToName(pc),
    promptType: questionTypeText("PC"),
    acceptedCells: answerPool.filter((cell) => cellToPc(cell) === pc),
  };
}

function questionKey(question: Question): string {
  const accepted = [...question.acceptedCells]
    .sort((a, b) => a.string - b.string || a.fret - b.fret)
    .map((cell) => `${cell.string}:${cell.fret}`)
    .join(",");
  const anchor = question.anchor ? `${question.anchor.string}:${question.anchor.fret}` : "";
  const rootAnchor = question.rootAnchor ? `${question.rootAnchor.string}:${question.rootAnchor.fret}` : "";
  const promptSub = question.promptSub || "";
  const range = question.constraintRange ? `${question.constraintRange.minFret}:${question.constraintRange.maxFret}` : "";
  return [question.judge, question.promptMain, promptSub, range, anchor, rootAnchor, accepted].join("|");
}

export function FretboardHuntGame({
  mode,
  difficulty,
  seed,
  challenge,
  challengeRules,
  practiceRules,
  soundEnabled,
  onSoundEnabledChange,
  onMetricsChange,
  onChallengeTerminated,
  maxVisibleFret,
  detectMode,
  onDetectModeChange,
  showHitZones,
  onShowHitZonesChange,
  showFretNotes,
  onShowFretNotesChange,
  fretLineWidth,
  fretToneVolume,
  boardPreset,
  inlayPreset,
  onBackHome,
  onStopChallenge,
  rangeConfig,
  chordQualities,
  scaleRules,
}: Props) {
  const cfg = useMemo(() => normalizeConfig(difficulty, rangeConfig), [difficulty, rangeConfig]);
  const questionPool = useMemo(() => cellsInRange(cfg.minFret, cfg.maxFret), [cfg.maxFret, cfg.minFret]);
  const answerPool = useMemo(() => cellsInRange(0, MAX_FRET), []);
  const codeSources = useMemo(() => selectCodeSourcePool(buildCodeSources(chordQualities, scaleRules), cfg), [chordQualities, scaleRules, cfg]);
  const rngRef = useRef(createSeededRng("init"));
  const challengeEndNotifiedRef = useRef(false);
  const scoreRef = useRef(0);

  const [question, setQuestion] = useState<Question | null>(null);
  const [score, setScore] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [hits, setHits] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [feedback, setFeedback] = useState<FretboardMarker | null>(null);
  const [selectedCell, setSelectedCell] = useState<Cell | null>(null);
  const [livesLeft, setLivesLeft] = useState(challengeRules.lives);
  const [endedByLives, setEndedByLives] = useState(false);
  const [showAllAnswers, setShowAllAnswers] = useState(false);
  const [requireManualNext, setRequireManualNext] = useState(false);
  const [showSettingsOverlay, setShowSettingsOverlay] = useState(false);
  const [codeDisplayMode, setCodeDisplayMode] = useState<CodeDisplayMode>("SYMBOL");
  const [viewportH, setViewportH] = useState(() => window.innerHeight);

  useEffect(() => {
    scoreRef.current = score;
  }, [score]);

  useEffect(() => {
    const onResize = () => setViewportH(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const resetSession = (salt: string) => {
    rngRef.current = createSeededRng(`${seed}|FBH|${difficulty}|${salt}`);
    challengeEndNotifiedRef.current = false;
    setScore(0);
    setAttempts(0);
    setHits(0);
    setWrong(0);
    setFeedback(null);
    setSelectedCell(null);
    setEndedByLives(false);
    setLivesLeft(challengeRules.lives);
    setShowAllAnswers(false);
    setRequireManualNext(false);
    setShowSettingsOverlay(false);
    setQuestion(makeQuestion(rngRef.current, questionPool, answerPool, cfg, codeSources, codeDisplayMode, null));
  };

  useEffect(() => {
    if (mode === "CHALLENGE") return;
    resetSession("PRACTICE");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, seed, difficulty, questionPool.length, answerPool.length, cfg.minFret, cfg.maxFret, cfg.judges.join("|"), codeSources.length, codeDisplayMode]);

  useEffect(() => {
    if (mode !== "CHALLENGE") return;
    resetSession(`CHALLENGE:${challenge.token}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenge.token, mode, challengeRules.lives, challengeRules.correctScore, challengeRules.wrongPenalty]);

  useEffect(() => {
    const accuracy = attempts > 0 ? Number(((hits / attempts) * 100).toFixed(1)) : 0;
    onMetricsChange({
      score,
      accuracy,
      detail: {
        attempts,
        hits,
        wrong,
        judge: question?.judge ?? "",
        lives_left: livesLeft,
      },
    });
  }, [attempts, hits, livesLeft, onMetricsChange, question?.judge, score, wrong]);

  const disabled = mode === "CHALLENGE" && (!challenge.running || endedByLives);

  const evaluate = (cell: Cell): boolean => {
    if (!question) return false;
    return containsCell(question.acceptedCells, cell);
  };

  const notifyLivesEnded = (nextScore: number) => {
    if (challengeEndNotifiedRef.current) return;
    challengeEndNotifiedRef.current = true;
    const totalAttempts = attempts + 1;
    const totalHits = hits;
    const totalWrong = wrong + 1;
    const accuracy = totalAttempts > 0 ? Number(((totalHits / totalAttempts) * 100).toFixed(1)) : 0;
    onChallengeTerminated({
      reason: "LIVES_DEPLETED",
      score: nextScore,
      accuracy,
      detail: {
        attempts: totalAttempts,
        hits: totalHits,
        wrong: totalWrong,
        lives_left: 0,
      },
    });
  };

  const nextQuestion = () => {
    setFeedback(null);
    setSelectedCell(null);
    setShowAllAnswers(false);
    setRequireManualNext(false);
    setQuestion((prev) => makeQuestion(rngRef.current, questionPool, answerPool, cfg, codeSources, codeDisplayMode, prev));
  };

  const revealAnswers = () => {
    if (!question) return;
    setSelectedCell(null);
    setShowAllAnswers(true);
    setRequireManualNext(practiceRules.requireNextAfterReveal);
  };

  const submitCell = (cell: Cell) => {
    if (!question || disabled) return;
    if (mode === "PRACTICE" && requireManualNext) return;

    const correct = evaluate(cell);
    setAttempts((prev) => prev + 1);
    setSelectedCell(null);

    if (correct) {
      setFeedback({ cell, kind: "correct" });
      setHits((prev) => prev + 1);
      if (mode === "CHALLENGE") {
        setScore((prev) => prev + challengeRules.correctScore);
      }
      if (mode === "PRACTICE") {
        if (practiceRules.checkMode === "CONFIRM" && soundEnabled) {
          void playResultCue("ok");
        }
        if (practiceRules.revealAnswersOnCorrect) {
          setShowAllAnswers(true);
        }
        if (practiceRules.requireNextAfterReveal) {
          setRequireManualNext(true);
        } else {
          window.setTimeout(() => {
            nextQuestion();
          }, 160);
        }
      } else {
        window.setTimeout(() => {
          setFeedback(null);
          setQuestion((prev) => makeQuestion(rngRef.current, questionPool, answerPool, cfg, codeSources, codeDisplayMode, prev));
        }, 160);
      }
      return;
    }

    setFeedback({ cell, kind: "wrong" });
    setWrong((prev) => prev + 1);
    if (mode === "PRACTICE" && practiceRules.checkMode === "CONFIRM" && soundEnabled) {
      void playResultCue("bad");
    }

    if (mode === "CHALLENGE") {
      const nextScore = scoreRef.current - challengeRules.wrongPenalty;
      setScore(nextScore);
      if (challengeRules.lives > 0) {
        setLivesLeft((prev) => {
          const nextLives = Math.max(0, prev - 1);
          if (nextLives <= 0) {
            setEndedByLives(true);
            notifyLivesEnded(nextScore);
          } else {
            window.setTimeout(() => {
              setFeedback(null);
              setQuestion((prev) => makeQuestion(rngRef.current, questionPool, answerPool, cfg, codeSources, codeDisplayMode, prev));
            }, 140);
          }
          return nextLives;
        });
        return;
      }

      window.setTimeout(() => {
        setFeedback(null);
        setQuestion((prev) => makeQuestion(rngRef.current, questionPool, answerPool, cfg, codeSources, codeDisplayMode, prev));
      }, 140);
    }
  };

  const handleCellClick = (cell: Cell) => {
    if (!question || disabled) return;
    if (mode === "PRACTICE" && requireManualNext) return;
    if (soundEnabled) {
      void playFretMidi(cellToMidi(cell), fretToneVolume);
    }
    if (mode === "PRACTICE" && practiceRules.checkMode === "CONFIRM") {
      setFeedback(null);
      setShowAllAnswers(false);
      setSelectedCell((prev) => (prev && prev.string === cell.string && prev.fret === cell.fret ? null : cell));
      return;
    }
    submitCell(cell);
  };

  const confirmSelectedCell = () => {
    if (!selectedCell || disabled || mode !== "PRACTICE" || practiceRules.checkMode !== "CONFIRM") return;
    submitCell(selectedCell);
  };

  const markers: FretboardMarker[] = [];
  if (mode === "PRACTICE" && showAllAnswers && question) {
    for (const cell of question.acceptedCells) {
      markers.push({ cell, kind: "correct" });
    }
  }
  if (selectedCell) markers.push({ cell: selectedCell, kind: "selected" });
  if (question?.anchor) markers.push({ cell: question.anchor, kind: "anchor" });
  if (question?.rootAnchor) markers.push({ cell: question.rootAnchor, kind: "root_anchor" });
  if (feedback) markers.push(feedback);

  const accuracy = attempts > 0 ? Number(((hits / attempts) * 100).toFixed(1)) : 0;
  const boardHeight = Math.max(250, Math.min(760, Math.floor((viewportH - 190) * 0.78)));
  const practiceStatsText = `정답 ${hits} · 오답 ${wrong} · 정답률 ${accuracy}%`;

  return (
    <section className="mg-game-card mg-fbh-game-full" data-testid="mg-fbh-game">
      <div className="mg-game-topline">
        <div className="mg-fbh-left-col">
          <button data-testid="mg-back-home" className="ghost-btn mg-fbh-home-btn" onClick={onBackHome}>
            ⌂
          </button>
          {mode === "PRACTICE" ? <div className="mg-fbh-practice-stats">{practiceStatsText}</div> : null}
        </div>
        {mode === "CHALLENGE" ? (
          <div className="mg-fbh-score-box">
            <div className="mg-fbh-score-main">점수 {score}</div>
            <div className="mg-fbh-score-sub">
              정답 {hits}/{attempts} · 정답률 {accuracy}%
              {challengeRules.lives > 0 ? (
                <span className="mg-heart-strip" data-testid="mg-fbh-hearts">
                  {Array.from({ length: challengeRules.lives }, (_, idx) => (
                    <span key={`heart-${idx}`} className={idx < livesLeft ? "is-alive" : "is-dead"}>
                      ❤
                    </span>
                  ))}
                </span>
              ) : null}
              <span className="mg-fbh-timer-inline">{challenge.remainingSec}s</span>
            </div>
          </div>
        ) : (
          <div />
        )}
        <div className="mg-fbh-tools-wrap">
          <button data-testid="mg-fbh-gear" className="ghost-btn mg-fbh-gear-btn" onClick={() => setShowSettingsOverlay((prev) => !prev)}>
            ⚙
          </button>
          {showSettingsOverlay ? (
            <div className="mg-fbh-gear-panel">
              <button className={`ghost-btn ${soundEnabled ? "active-mini" : ""}`} onClick={() => onSoundEnabledChange(!soundEnabled)}>
                프렛 소리 {soundEnabled ? "ON" : "OFF"}
              </button>
              <button className={`ghost-btn ${showHitZones ? "active-mini" : ""}`} onClick={() => onShowHitZonesChange(!showHitZones)}>
                인식 범위 {showHitZones ? "ON" : "OFF"}
              </button>
              <button className={`ghost-btn ${showFretNotes ? "active-mini" : ""}`} onClick={() => onShowFretNotesChange(!showFretNotes)}>
                프렛 음명 표시 {showFretNotes ? "ON" : "OFF"}
              </button>
              <div className="mg-fbh-code-mode">
                <small className="muted">코드 표기</small>
                <div className="mg-hit-controls">
                  <button className={`ghost-btn ${codeDisplayMode === "SYMBOL" ? "active-mini" : ""}`} onClick={() => setCodeDisplayMode("SYMBOL")}>
                    기호
                  </button>
                  <button className={`ghost-btn ${codeDisplayMode === "FULL" ? "active-mini" : ""}`} onClick={() => setCodeDisplayMode("FULL")}>
                    풀표기
                  </button>
                  <button className={`ghost-btn ${codeDisplayMode === "BOTH" ? "active-mini" : ""}`} onClick={() => setCodeDisplayMode("BOTH")}>
                    둘 다
                  </button>
                </div>
              </div>
              {mode === "CHALLENGE" ? (
                <button data-testid="mg-stop-challenge" className="primary-btn danger-border" onClick={onStopChallenge}>
                  중지
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mg-fbh-prompt" data-testid="mg-fbh-prompt">
        <div className="mg-fbh-prompt-type">{question?.promptType ?? "노트 찾기"}</div>
        <div className="mg-fbh-prompt-main">{question?.promptMain ?? "..."}</div>
        {question?.promptSub ? <div className="mg-fbh-prompt-sub">{question.promptSub}</div> : null}
      </div>

      <FretboardCanvas
        maxFret={MAX_FRET}
        markers={markers}
        onCellClick={handleCellClick}
        disabled={disabled}
        height={boardHeight}
        detectMode={detectMode}
        showHitZones={showHitZones}
        showNoteLabels={showFretNotes}
        fretLineWidth={fretLineWidth}
        boardPreset={boardPreset}
        inlayPreset={inlayPreset}
        constraintRange={question?.judge === "PC_RANGE" ? question.constraintRange : undefined}
      />

      {mode === "PRACTICE" ? (
        <div className="mg-fbh-action-row">
          {practiceRules.checkMode === "CONFIRM" ? (
            <button className="primary-btn mg-fbh-action-btn" onClick={confirmSelectedCell} disabled={!selectedCell}>
              확인
            </button>
          ) : null}
          <button className="primary-btn mg-fbh-action-btn" onClick={nextQuestion}>
            다음 문제
          </button>
          {practiceRules.showAnswerButton ? (
            <button className={`ghost-btn mg-fbh-action-btn ${showAllAnswers ? "active-mini" : ""}`} onClick={revealAnswers}>
              정답 보기
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
