import type { Cell } from "../common/music";
import { cellToMidi, cellToPc, midiToName, pcToName, sameCell } from "../common/music";
import type { SeededRng } from "../common/seed";
import { MAX_FRET, cellsInRange, manhattanL1 } from "../fretboard/fretboardMath";

export type LineMapperStage = "POSITION" | "FIX" | "COMPLETE";
export type RuleType = "CHORD" | "SCALE";
export type TeachingFamily = "CHORD" | "PENTATONIC" | "MODE" | "ADVANCED";
export type LineMapperErrorType = "OUTSIDE_RULE" | "OUTSIDE_POCKET" | "MISSED_TARGET" | "UNSTABLE_LANDING";
export type PocketToneRole = "ROOT" | "STABLE" | "COLOR";
type LineMotion = "UP" | "DOWN" | "ARC" | "APPROACH";

export type RuleDef = {
  key: string;
  label: string;
  ruleType: RuleType;
  intervals: number[];
  degreeLabels: string[];
  stableDegrees: string[];
  avoidDegrees: string[];
  teachingFamily: TeachingFamily;
  description?: string;
  mood?: string;
  usage?: string;
};

export type PocketRange = {
  minFret: number;
  maxFret: number;
  label: string;
};

export type ExplanationBlock = {
  pocket: string;
  target: string;
  reason: string;
  next: string;
};

export type PocketTone = {
  cell: Cell;
  noteName: string;
  degreeLabel: string;
  role: PocketToneRole;
};

export type LineStep = {
  cell: Cell;
  noteName: string;
  degreeLabel: string;
  isTarget?: boolean;
};

export type CompleteChoice = {
  id: string;
  cell: Cell;
  noteName: string;
  degreeLabel: string;
  isCorrect: boolean;
};

export type FixOption = {
  id: string;
  line: LineStep[];
  invalidIndex: number | null;
  isWrong: boolean;
};

type BaseQuestion = {
  stage: LineMapperStage;
  rootPc: number;
  rootName: string;
  rule: RuleDef;
  pocketRange: PocketRange;
  displayMaxFret: number;
  anchorCell: Cell;
  targetDegree: string;
  targetCell: Cell;
  prompt: string;
  explanation: ExplanationBlock;
  pocketTones: PocketTone[];
  guideTones: PocketTone[];
  correctAnswer: unknown;
};

export type PositionQuestion = BaseQuestion & {
  stage: "POSITION";
  shownCells: Cell[];
  missingCells: Cell[];
  correctAnswer: Cell[];
  acceptedCells: Cell[];
};

export type FixQuestion = BaseQuestion & {
  stage: "FIX";
  options: FixOption[];
  correctAnswer: number;
  wrongOptionIndex: number;
  wrongNoteIndex: number;
  errorType: LineMapperErrorType;
  validLine: LineStep[];
};

export type CompleteQuestion = BaseQuestion & {
  stage: "COMPLETE";
  direction: "UP" | "DOWN";
  line: LineStep[];
  blankIndices: number[];
  acceptedCellsByStep: Cell[][];
  choiceGroups: Array<{
    blankIndex: number;
    correctOptionId: string;
    options: CompleteChoice[];
  }>;
  correctAnswer: Cell[];
};

export type LineMapperQuestion = PositionQuestion | FixQuestion | CompleteQuestion;

export type LineMapperAnswer =
  | { stage: "POSITION"; cells: Cell[]; mistakes?: Cell[] }
  | { stage: "FIX"; index: number }
  | { stage: "COMPLETE"; cells: Cell[]; mistakes?: Cell[] };

export type LineMapperEvaluation = {
  ok: boolean;
  title: string;
  statusText: string;
  explanation: ExplanationBlock;
  wrongCells: Cell[];
  correctCells: Cell[];
  solutionCells?: Cell[];
  selectedFixIndex?: number;
  correctFixIndex?: number;
};

type RawRuleInput = {
  name_ko?: string;
  intervals?: number[];
  degree_labels?: string[];
  stable_degrees?: string[];
  avoid_degrees?: string[];
  teaching_family?: string;
  description_ko?: string;
  mood_ko?: string;
  usage_ko?: string;
};

type PocketContext = {
  rootPc: number;
  rootName: string;
  rule: RuleDef;
  pocketRange: PocketRange;
  anchorCell: Cell;
  maxFret: number;
  pocketCells: Cell[];
  allowedCells: Cell[];
  rootCells: Cell[];
  stableCells: Cell[];
  colorCells: Cell[];
  degreeToCells: Map<string, Cell[]>;
};

type LineTemplate = {
  key: string;
  label: string;
  families: TeachingFamily[];
  degrees: string[];
  motion: LineMotion;
};

const DEGREE_TABLE = ["1", "b2", "2", "b3", "3", "4", "b5", "5", "b6", "6", "b7", "7"];
const STAGE_WEIGHTS: Array<{ stage: LineMapperStage; weight: number }> = [
  { stage: "POSITION", weight: 45 },
  { stage: "FIX", weight: 35 },
  { stage: "COMPLETE", weight: 20 },
];
const LINE_TEMPLATES: LineTemplate[] = [
  { key: "arpeggio_major", label: "아르페지오 연결", families: ["CHORD", "MODE", "ADVANCED"], degrees: ["1", "3", "5", "3"], motion: "ARC" },
  { key: "arpeggio_minor", label: "아르페지오 연결", families: ["CHORD", "MODE", "ADVANCED"], degrees: ["1", "b3", "5", "b7"], motion: "UP" },
  { key: "dominant_push", label: "도착음 접근", families: ["CHORD", "MODE", "ADVANCED"], degrees: ["1", "3", "5", "b7", "1"], motion: "UP" },
  { key: "major_penta_up", label: "메이저 펜타토닉 상행", families: ["PENTATONIC", "MODE"], degrees: ["1", "2", "3", "5"], motion: "UP" },
  { key: "major_penta_down", label: "메이저 펜타토닉 하행", families: ["PENTATONIC", "MODE"], degrees: ["6", "5", "3", "1"], motion: "DOWN" },
  { key: "minor_penta_up", label: "마이너 펜타토닉 상행", families: ["PENTATONIC", "MODE"], degrees: ["1", "b3", "4", "5"], motion: "UP" },
  { key: "minor_penta_down", label: "마이너 펜타토닉 하행", families: ["PENTATONIC", "MODE"], degrees: ["b7", "5", "4", "1"], motion: "DOWN" },
  { key: "approach_23", label: "도착음 접근", families: ["PENTATONIC", "MODE", "ADVANCED"], degrees: ["1", "2", "3"], motion: "APPROACH" },
  { key: "approach_45", label: "도착음 접근", families: ["PENTATONIC", "MODE", "ADVANCED"], degrees: ["1", "4", "5"], motion: "APPROACH" },
  { key: "approach_b71", label: "도착음 접근", families: ["PENTATONIC", "MODE", "ADVANCED"], degrees: ["5", "b7", "1"], motion: "APPROACH" },
];
const STABLE_DEGREE_DEFAULTS = ["1", "b3", "3", "5", "b7", "7", "6", "2"];
const AVOID_DEGREE_DEFAULTS = ["b2", "2", "4", "#4", "b5", "b6", "#5"];
const DEGREE_TO_SEMITONE: Record<string, number> = {
  "1": 0,
  b2: 1,
  "2": 2,
  "#2": 3,
  b3: 3,
  "3": 4,
  "4": 5,
  "#4": 6,
  b5: 6,
  "5": 7,
  "#5": 8,
  b6: 8,
  "6": 9,
  bb7: 9,
  b7: 10,
  "7": 11,
};

function canonicalDegreeLabel(raw: string | undefined): string {
  const text = String(raw || "").trim();
  if (!text) return "?";
  if (text === "9") return "2";
  if (text === "b9") return "b2";
  if (text === "#9") return "#2";
  if (text === "11") return "4";
  if (text === "#11") return "#4";
  if (text === "13") return "6";
  if (text === "b13") return "b6";
  if (text === "bb7") return "6";
  return text;
}

function uniqueList(items: string[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    const value = canonicalDegreeLabel(item);
    if (!value || out.includes(value)) continue;
    out.push(value);
  }
  return out;
}

function teachingFamilyFromRule(key: string, ruleType: RuleType, family: string | undefined): TeachingFamily {
  if (family === "CHORD" || family === "PENTATONIC" || family === "MODE" || family === "ADVANCED") return family;
  if (ruleType === "CHORD") return "CHORD";
  if (key.includes("pentatonic") || key === "blues") return "PENTATONIC";
  if (["ionian", "dorian", "phrygian", "lydian", "mixolydian", "aeolian", "locrian"].includes(key)) return "MODE";
  return "ADVANCED";
}

function buildRuleDef(key: string, item: RawRuleInput | undefined, ruleType: RuleType, fallbackLabel: string): RuleDef {
  const intervals = Array.isArray(item?.intervals) && item?.intervals.length ? item?.intervals.map((value) => Number(value)) : [0, 3, 5, 7, 10];
  const degreeLabels = intervals.map((interval, index) => canonicalDegreeLabel(item?.degree_labels?.[index] ?? DEGREE_TABLE[((interval % 12) + 12) % 12] ?? "?"));
  const stableDegrees =
    uniqueList(item?.stable_degrees ?? []).length > 0
      ? uniqueList(item?.stable_degrees ?? [])
      : uniqueList(degreeLabels.filter((label) => STABLE_DEGREE_DEFAULTS.includes(label))).slice(0, 4);
  const avoidDegrees =
    uniqueList(item?.avoid_degrees ?? []).length > 0
      ? uniqueList(item?.avoid_degrees ?? [])
      : uniqueList(degreeLabels.filter((label) => AVOID_DEGREE_DEFAULTS.includes(label)));

  return {
    key,
    label: item?.name_ko || fallbackLabel,
    ruleType,
    intervals,
    degreeLabels,
    stableDegrees: stableDegrees.length ? stableDegrees : uniqueList(degreeLabels.slice(0, Math.min(3, degreeLabels.length))),
    avoidDegrees,
    teachingFamily: teachingFamilyFromRule(key, ruleType, item?.teaching_family),
    description: item?.description_ko,
    mood: item?.mood_ko,
    usage: item?.usage_ko,
  };
}

function pickExistingRules(keys: string[], source: Record<string, RawRuleInput>, ruleType: RuleType, fallbackLabel: string): RuleDef[] {
  return keys.filter((key) => source[key]).map((key) => buildRuleDef(key, source[key], ruleType, fallbackLabel));
}

function toRuleList(
  scaleRules: Record<string, RawRuleInput>,
  chordQualities: Record<string, RawRuleInput>,
  difficulty: string
): RuleDef[] {
  const diff = difficulty.toUpperCase();
  if (diff === "EASY") {
    return pickExistingRules(["maj", "min", "7", "m7"], chordQualities, "CHORD", "코드톤");
  }
  if (diff === "NORMAL") {
    return [
      ...pickExistingRules(["maj", "min", "7", "m7"], chordQualities, "CHORD", "코드톤"),
      ...pickExistingRules(["major_pentatonic", "minor_pentatonic"], scaleRules, "SCALE", "스케일"),
    ];
  }
  if (diff === "HARD") {
    return [
      ...pickExistingRules(["7", "m7", "maj7"], chordQualities, "CHORD", "코드톤"),
      ...pickExistingRules(["minor_pentatonic", "major_pentatonic", "blues", "dorian", "mixolydian"], scaleRules, "SCALE", "스케일"),
    ];
  }
  if (diff === "VERY_HARD") {
    return [
      ...pickExistingRules(["maj7", "m7", "m7b5", "9", "13"], chordQualities, "CHORD", "코드톤"),
      ...pickExistingRules(["dorian", "mixolydian", "aeolian", "harmonic_minor", "lydian_dominant"], scaleRules, "SCALE", "스케일"),
    ];
  }
  return [
    ...pickExistingRules(["7b9", "7#9", "13"], chordQualities, "CHORD", "코드톤"),
    ...pickExistingRules(["melodic_minor", "altered", "whole_tone", "diminished_half_whole", "phrygian_dominant"], scaleRules, "SCALE", "스케일"),
  ];
}

function degreeLabelForRule(rule: RuleDef, cell: Cell, rootPc: number): string {
  const rel = (cellToPc(cell) - rootPc + 12) % 12;
  const idx = rule.intervals.findIndex((interval) => ((interval % 12) + 12) % 12 === rel);
  if (idx >= 0) return rule.degreeLabels[idx] ?? DEGREE_TABLE[rel] ?? "?";
  return canonicalDegreeLabel(DEGREE_TABLE[rel] ?? "?");
}

function inRule(cell: Cell, rootPc: number, intervals: Set<number>): boolean {
  const rel = (cellToPc(cell) - rootPc + 12) % 12;
  return intervals.has(rel);
}

function pickWeightedStage(rng: SeededRng): LineMapperStage {
  const total = STAGE_WEIGHTS.reduce((sum, item) => sum + item.weight, 0);
  let target = rng.int(1, total);
  for (const item of STAGE_WEIGHTS) {
    target -= item.weight;
    if (target <= 0) return item.stage;
  }
  return "POSITION";
}

export function stageLabel(stage: LineMapperStage): string {
  if (stage === "POSITION") return "1단계 코드 음 찾기";
  if (stage === "FIX") return "2단계 틀린 지판 찾기";
  return "3단계 스케일 상/하행 완성";
}

export function stageStatLabel(stage: string): string {
  if (stage === "POSITION") return "코드 음 찾기";
  if (stage === "FIX") return "틀린 지판 찾기";
  if (stage === "COMPLETE") return "스케일 상/하행 완성";
  return stage;
}

export function errorTypeLabel(errorType: string): string {
  if (errorType === "OUTSIDE_RULE") return "규칙 밖 음";
  if (errorType === "OUTSIDE_POCKET") return "포지션 밖 음";
  if (errorType === "MISSED_TARGET") return "목표 놓침";
  if (errorType === "UNSTABLE_LANDING") return "불안정 착지";
  return errorType;
}

function maxFretForDifficulty(difficulty: string, maxFretByDifficulty?: Partial<Record<string, number>>): number {
  const diff = difficulty.toUpperCase();
  const configured = maxFretByDifficulty?.[diff];
  const fallback =
    diff === "EASY"
      ? 7
      : diff === "NORMAL"
      ? 10
      : diff === "HARD"
      ? 12
      : diff === "VERY_HARD"
      ? 15
      : 21;
  return Math.max(3, Math.min(MAX_FRET, configured !== undefined ? configured : fallback));
}

function buildPocketContext(
  rng: SeededRng,
  difficulty: string,
  scaleRules: Record<string, RawRuleInput>,
  chordQualities: Record<string, RawRuleInput>,
  maxFretByDifficulty?: Partial<Record<string, number>>
): PocketContext {
  const rules = toRuleList(scaleRules, chordQualities, difficulty);
  const safeMaxFret = maxFretForDifficulty(difficulty, maxFretByDifficulty);
  const attempts = Math.max(30, rules.length * 12);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const rule =
      rules.length > 0 ? rng.pick(rules) : buildRuleDef("fallback", { name_ko: "마이너 펜타토닉", intervals: [0, 3, 5, 7, 10] }, "SCALE", "마이너 펜타토닉");
    const rootPc = rng.int(0, 11);
    const windowMin = rng.int(0, Math.max(0, safeMaxFret - 3));
    const windowMax = Math.min(safeMaxFret, windowMin + 3);
    const pocketCells = cellsInRange(windowMin, windowMax);
    const intervals = new Set(rule.intervals.map((value) => ((value % 12) + 12) % 12));
    const allowedCells = pocketCells.filter((cell) => inRule(cell, rootPc, intervals));
    const rootCells = allowedCells.filter((cell) => degreeLabelForRule(rule, cell, rootPc) === "1");
    if (allowedCells.length < 5 || !rootCells.length) continue;

    const degreeToCells = new Map<string, Cell[]>();
    for (const cell of allowedCells) {
      const degree = degreeLabelForRule(rule, cell, rootPc);
      const list = degreeToCells.get(degree) ?? [];
      list.push(cell);
      degreeToCells.set(degree, list);
    }

    const stableCells = allowedCells.filter((cell) => {
      const degree = degreeLabelForRule(rule, cell, rootPc);
      return degree !== "1" && rule.stableDegrees.includes(degree);
    });
    const colorCells = allowedCells.filter((cell) => {
      const degree = degreeLabelForRule(rule, cell, rootPc);
      return degree !== "1" && !rule.stableDegrees.includes(degree);
    });
    if (!stableCells.length && !colorCells.length) continue;

    const centerAnchor = rootCells
      .slice()
      .sort((a, b) => {
        const scoreA = Math.abs(a.fret - (windowMin + windowMax) / 2) + Math.abs(a.string - 1.5);
        const scoreB = Math.abs(b.fret - (windowMin + windowMax) / 2) + Math.abs(b.string - 1.5);
        return scoreA - scoreB;
      })[0];

    return {
      rootPc,
      rootName: pcToName(rootPc),
      rule,
      pocketRange: {
        minFret: windowMin,
        maxFret: windowMax,
        label: `${windowMin}~${windowMax}프렛 포지션`,
      },
      anchorCell: centerAnchor,
      maxFret: safeMaxFret,
      pocketCells,
      allowedCells,
      rootCells,
      stableCells,
      colorCells,
      degreeToCells,
    };
  }

  const fallbackRule = buildRuleDef("fallback", { name_ko: "마이너 펜타토닉", intervals: [0, 3, 5, 7, 10] }, "SCALE", "마이너 펜타토닉");
  const rootPc = 0;
  const pocketCells = cellsInRange(0, Math.min(3, safeMaxFret));
  const allowedCells = pocketCells.filter((cell) => inRule(cell, rootPc, new Set(fallbackRule.intervals)));
  const rootCells = allowedCells.filter((cell) => degreeLabelForRule(fallbackRule, cell, rootPc) === "1");
  const degreeToCells = new Map<string, Cell[]>();
  for (const cell of allowedCells) {
    const degree = degreeLabelForRule(fallbackRule, cell, rootPc);
    const list = degreeToCells.get(degree) ?? [];
    list.push(cell);
    degreeToCells.set(degree, list);
  }

  return {
    rootPc,
    rootName: pcToName(rootPc),
    rule: fallbackRule,
    pocketRange: { minFret: 0, maxFret: Math.min(3, safeMaxFret), label: `0~${Math.min(3, safeMaxFret)}프렛 포지션` },
    anchorCell: rootCells[0] ?? allowedCells[0] ?? { string: 0, fret: 0 },
    maxFret: safeMaxFret,
    pocketCells,
    allowedCells,
    rootCells,
    stableCells: allowedCells.filter((cell) => {
      const degree = degreeLabelForRule(fallbackRule, cell, rootPc);
      return degree !== "1" && fallbackRule.stableDegrees.includes(degree);
    }),
    colorCells: allowedCells.filter((cell) => !fallbackRule.stableDegrees.includes(degreeLabelForRule(fallbackRule, cell, rootPc))),
    degreeToCells,
  };
}

function noteName(cell: Cell): string {
  return midiToName(cellToMidi(cell));
}

function buildPocketTones(context: PocketContext): PocketTone[] {
  return context.allowedCells.map((cell) => {
    const degreeLabel = degreeLabelForRule(context.rule, cell, context.rootPc);
    const role: PocketToneRole =
      degreeLabel === "1" ? "ROOT" : context.rule.stableDegrees.includes(degreeLabel) ? "STABLE" : "COLOR";
    return {
      cell,
      noteName: noteName(cell),
      degreeLabel,
      role,
    };
  });
}

function pocketToneForCell(context: PocketContext, cell: Cell): PocketTone {
  const degreeLabel = degreeLabelForRule(context.rule, cell, context.rootPc);
  return {
    cell,
    noteName: noteName(cell),
    degreeLabel,
    role: degreeLabel === "1" ? "ROOT" : context.rule.stableDegrees.includes(degreeLabel) ? "STABLE" : "COLOR",
  };
}

function fullRuleCells(context: PocketContext): Cell[] {
  const intervals = new Set(context.rule.intervals.map((value) => ((value % 12) + 12) % 12));
  return cellsInRange(0, MAX_FRET).filter((cell) => inRule(cell, context.rootPc, intervals));
}

function fullNonRuleCells(context: PocketContext): Cell[] {
  const intervals = new Set(context.rule.intervals.map((value) => ((value % 12) + 12) % 12));
  return cellsInRange(0, MAX_FRET).filter((cell) => !inRule(cell, context.rootPc, intervals));
}

function sortCellsByBoard(cells: Cell[]): Cell[] {
  return cells.slice().sort((a, b) => a.fret - b.fret || a.string - b.string);
}

function boardSignature(cells: Cell[]): string {
  return sortCellsByBoard(cells)
    .map((cell) => `${cell.string}:${cell.fret}`)
    .join("|");
}

function displayMaxFretForCells(cells: Cell[]): number {
  const maxFret = cells.reduce((value, cell) => Math.max(value, cell.fret), 0);
  return Math.min(MAX_FRET, Math.max(5, maxFret + 2));
}

function noteCountForDifficulty(difficulty: string): number {
  const diff = difficulty.toUpperCase();
  if (diff === "EASY") return 6;
  if (diff === "NORMAL") return 7;
  if (diff === "HARD") return 8;
  if (diff === "VERY_HARD") return 9;
  return 10;
}

function sequenceLengthForDifficulty(difficulty: string): number {
  const diff = difficulty.toUpperCase();
  if (diff === "EASY") return 4;
  if (diff === "NORMAL") return 5;
  if (diff === "HARD") return 6;
  if (diff === "VERY_HARD") return 7;
  return 8;
}

function maxSequenceLengthForDifficulty(difficulty: string): number {
  const diff = difficulty.toUpperCase();
  if (diff === "EASY") return 5;
  if (diff === "NORMAL") return 6;
  if (diff === "HARD") return 6;
  if (diff === "VERY_HARD") return 7;
  return 8;
}

function positionMissingCountForDifficulty(difficulty: string): number {
  const diff = difficulty.toUpperCase();
  return diff === "HARD" || diff === "VERY_HARD" || diff === "MASTER" ? 2 : 1;
}

type CompleteEndpointPolicy = "BOTH_ROOT" | "ONE_ROOT" | "ANY";

function completeEndpointPolicyForDifficulty(difficulty: string): CompleteEndpointPolicy {
  const diff = difficulty.toUpperCase();
  if (diff === "EASY" || diff === "NORMAL") return "BOTH_ROOT";
  if (diff === "HARD") return "ONE_ROOT";
  return "ANY";
}

function degreePriority(degree: string): number {
  const order = ["1", "3", "b3", "5", "b7", "7", "6", "2", "4", "#4", "b5", "b2", "b6"];
  const index = order.indexOf(degree);
  return index >= 0 ? index : order.length + 1;
}

function buildGuideTones(context: PocketContext, targetDegree: string, targetCell?: Cell): PocketTone[] {
  const out: PocketTone[] = [];
  const rootCell = chooseHandFriendlyCell(context.rootCells, context.anchorCell);
  if (rootCell) out.push(pocketToneForCell(context, rootCell));
  const rootMidi = rootCell ? cellToMidi(rootCell) : cellToMidi(context.anchorCell);
  const targetMidi = targetCell ? cellToMidi(targetCell) : rootMidi;
  const lowMidi = Math.min(rootMidi, targetMidi);
  const highMidi = Math.max(rootMidi, targetMidi);

  const candidates = context.allowedCells
    .filter((cell) => !sameCell(cell, rootCell))
    .map((cell) => pocketToneForCell(context, cell))
    .filter((tone) => tone.degreeLabel !== targetDegree)
    .sort((a, b) => {
      const routePenaltyA = targetCell && (cellToMidi(a.cell) < lowMidi || cellToMidi(a.cell) > highMidi) ? 1 : 0;
      const routePenaltyB = targetCell && (cellToMidi(b.cell) < lowMidi || cellToMidi(b.cell) > highMidi) ? 1 : 0;
      const roleScoreA = a.role === "STABLE" ? 0 : 1;
      const roleScoreB = b.role === "STABLE" ? 0 : 1;
      return (
        routePenaltyA - routePenaltyB ||
        roleScoreA - roleScoreB ||
        degreePriority(a.degreeLabel) - degreePriority(b.degreeLabel) ||
        naturalPositionCost(rootCell, a.cell) - naturalPositionCost(rootCell, b.cell) ||
        cellDistanceSort(context.anchorCell, a.cell, b.cell)
      );
    });

  for (const tone of candidates) {
    if (out.some((item) => item.degreeLabel === tone.degreeLabel)) continue;
    out.push(tone);
    if (out.length >= 2) break;
  }

  return out.slice(0, 2);
}

function degreeRoleInfo(rule: RuleDef, degree: string): { label: string; reason: string } {
  if (degree === "1") {
    return {
      label: "루트",
      reason: "기준점이 가장 분명해서 라인을 닫을 때 중심이 바로 잡힙니다.",
    };
  }
  if (rule.stableDegrees.includes(degree)) {
    return {
      label: rule.ruleType === "CHORD" ? "안정 코드톤" : "핵심 스케일톤",
      reason:
        rule.ruleType === "CHORD"
          ? "코드 뼈대를 바로 들려줘서 멈췄을 때 라인이 단단하게 서는 음입니다."
          : "포지션 성격을 또렷하게 보여줘서 도착점으로 잡으면 모양이 선명해집니다.",
    };
  }
  if (rule.avoidDegrees.includes(degree)) {
    return {
      label: "긴장음",
      reason: "마찰감이 강해서 오래 세우기보다는 다음 안정음으로 흘려주는 편이 자연스럽습니다.",
    };
  }
  return {
    label: "색채음",
    reason: "흐름에 맛을 더할 때는 좋지만, 끝음으로 세우면 중심이 약해지기 쉽습니다.",
  };
}

function landingReason(rule: RuleDef, targetDegree: string): string {
  const info = degreeRoleInfo(rule, targetDegree);
  if (targetDegree === "1") {
    return "루트에 멈추면 중심이 가장 분명하게 들립니다.";
  }
  return `${targetDegree}는 ${info.label}이라 멈췄을 때 도착감이 잘 납니다.`;
}

function compareLandingDegrees(rule: RuleDef, chosenDegree: string, targetDegree: string): string {
  if (chosenDegree === "포켓밖") {
    return "선택한 음은 포켓 밖이라 같은 손모양 안에서 이어지지 않습니다.";
  }

  const chosen = degreeRoleInfo(rule, chosenDegree);
  const target = degreeRoleInfo(rule, targetDegree);
  if (chosenDegree === targetDegree) return landingReason(rule, targetDegree);
  if (chosen.label === target.label) {
    return `${chosenDegree}도 쓸 수는 있지만, 이번 문제는 ${targetDegree}에 멈춰야 도착감이 더 분명합니다.`;
  }
  return `${chosenDegree}는 ${chosen.label}이라 끝음으로 두면 흐립니다. ${targetDegree}처럼 ${target.label}에 닿아야 정리됩니다.`;
}

function approachReason(fromDegree: string, targetDegree: string): string {
  const from = DEGREE_TO_SEMITONE[fromDegree];
  const target = DEGREE_TO_SEMITONE[targetDegree];
  if (from === undefined || target === undefined) {
    return `${fromDegree}가 ${targetDegree}로 들어가기 전 방향을 잡아줍니다.`;
  }
  const distance = Math.abs(from - target);
  if (distance <= 2 || distance >= 10) {
    return `${fromDegree}가 바로 앞에서 ${targetDegree}를 밀어줘서 도착이 또렷해집니다.`;
  }
  return `${fromDegree}가 중간 연결을 매끈하게 만들어 ${targetDegree}로 자연스럽게 갑니다.`;
}

function degreeTargetPool(context: PocketContext): Array<{ degree: string; cells: Cell[] }> {
  const candidates = new Map<string, Cell[]>();
  for (const cell of [...context.rootCells, ...context.stableCells]) {
    const degree = degreeLabelForRule(context.rule, cell, context.rootPc);
    const list = candidates.get(degree) ?? [];
    list.push(cell);
    candidates.set(degree, list);
  }
  return [...candidates.entries()].map(([degree, cells]) => ({ degree, cells })).filter((item) => item.cells.length > 0);
}

function cellDistanceSort(anchor: Cell, a: Cell, b: Cell): number {
  return manhattanL1(a, anchor) - manhattanL1(b, anchor) || a.fret - b.fret || a.string - b.string;
}

function naturalPositionCost(anchor: Cell, cell: Cell): number {
  const midiGap = cellToMidi(cell) - cellToMidi(anchor);
  const fretGap = Math.abs(cell.fret - anchor.fret);
  const stringGap = Math.abs(cell.string - anchor.string);
  let cost = manhattanL1(cell, anchor) * 8 + fretGap * 2 + stringGap * 5;
  if (midiGap < 0) cost += 14 + Math.abs(midiGap) * 1.8;
  if (Math.abs(midiGap) > 8) cost += 18 + (Math.abs(midiGap) - 8) * 2;
  return cost;
}

function chooseNearestCell(cells: Cell[], anchor: Cell): Cell {
  return cells.slice().sort((a, b) => cellDistanceSort(anchor, a, b))[0] ?? cells[0];
}

function chooseHandFriendlyCell(cells: Cell[], anchor: Cell): Cell {
  return (
    cells
      .slice()
      .sort((a, b) => naturalPositionCost(anchor, a) - naturalPositionCost(anchor, b) || cellDistanceSort(anchor, a, b))[0] ?? cells[0]
  );
}

function shuffleWithRng<T>(rng: SeededRng, items: T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = rng.int(0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function templatePoolForContext(context: PocketContext): LineTemplate[] {
  const availableDegrees = new Set([...context.degreeToCells.keys()]);
  return LINE_TEMPLATES.filter(
    (template) =>
      template.families.includes(context.rule.teachingFamily) && template.degrees.every((degree) => availableDegrees.has(degree))
  );
}

function motionExpectation(motion: LineMotion, stepIndex: number, lastStepIndex: number): "UP" | "DOWN" | "FREE" {
  if (motion === "UP") return "UP";
  if (motion === "DOWN") return "DOWN";
  if (motion === "ARC") return stepIndex === lastStepIndex ? "DOWN" : "UP";
  if (motion === "APPROACH") return stepIndex === lastStepIndex ? "UP" : "FREE";
  return "FREE";
}

function lineStartCost(anchorCell: Cell, candidate: Cell, motion: LineMotion): number {
  const midiGap = cellToMidi(candidate) - cellToMidi(anchorCell);
  const baseCost = manhattanL1(candidate, anchorCell) * 7 + Math.abs(candidate.fret - anchorCell.fret) * 2;
  if (motion === "UP") return baseCost + Math.max(0, midiGap) * 0.8;
  if (motion === "DOWN") return baseCost + Math.max(0, -midiGap) * 0.8;
  return baseCost + Math.abs(midiGap) * 0.35;
}

function lineStepCost(template: LineTemplate, previous: Cell, candidate: Cell, stepIndex: number, lastStepIndex: number, beforePrevious?: Cell | null): number {
  const midiGap = cellToMidi(candidate) - cellToMidi(previous);
  const absMidiGap = Math.abs(midiGap);
  const fretGap = Math.abs(candidate.fret - previous.fret);
  const stringGap = Math.abs(candidate.string - previous.string);
  let cost = fretGap * 3 + stringGap * 6 + absMidiGap * 0.75 + manhattanL1(candidate, previous) * 2;

  if (sameCell(candidate, previous)) cost += 36;
  if (fretGap > 4) cost += 16 + (fretGap - 4) * 4;
  if (stringGap > 1) cost += 10 + (stringGap - 1) * 6;
  if (absMidiGap > 8) cost += 24 + (absMidiGap - 8) * 4;

  const expected = motionExpectation(template.motion, stepIndex, lastStepIndex);
  if (expected === "UP") {
    if (midiGap < 0) cost += 30 + absMidiGap * 3;
    if (midiGap === 0) cost += 8;
  } else if (expected === "DOWN") {
    if (midiGap > 0) cost += 30 + absMidiGap * 3;
    if (midiGap === 0) cost += 8;
  }

  if (template.motion === "APPROACH" && stepIndex === lastStepIndex) {
    if (absMidiGap > 4) cost += 18 + (absMidiGap - 4) * 4;
    if (stringGap > 1) cost += 12;
  }

  if (beforePrevious) {
    const previousMidiGap = cellToMidi(previous) - cellToMidi(beforePrevious);
    if (previousMidiGap !== 0 && midiGap !== 0 && Math.sign(previousMidiGap) !== Math.sign(midiGap)) {
      cost += template.motion === "ARC" && stepIndex === lastStepIndex ? 4 : 16;
    }
  }

  return cost;
}

function searchTemplateLine(
  degreeToCells: Map<string, Cell[]>,
  template: LineTemplate,
  anchorCell: Cell,
  maxStep: number
): Cell[] | null {
  const picked: Cell[] = [];
  let bestLine: Cell[] | null = null;
  let bestCost = Number.POSITIVE_INFINITY;
  const lastStepIndex = template.degrees.length - 1;

  const walk = (index: number, previous: Cell | null, beforePrevious: Cell | null, costSoFar: number) => {
    if (index >= template.degrees.length) {
      if (costSoFar < bestCost) {
        bestCost = costSoFar;
        bestLine = picked.slice();
      }
      return;
    }

    const degree = template.degrees[index];
    const source = degreeToCells.get(degree) ?? [];
    const ordered = source
      .slice()
      .sort((a, b) => {
        const aCost = previous
          ? lineStepCost(template, previous, a, index, lastStepIndex, beforePrevious)
          : lineStartCost(anchorCell, a, template.motion);
        const bCost = previous
          ? lineStepCost(template, previous, b, index, lastStepIndex, beforePrevious)
          : lineStartCost(anchorCell, b, template.motion);
        return aCost - bCost || cellDistanceSort(previous ?? anchorCell, a, b);
      });

    for (const candidate of ordered) {
      if (previous) {
        const handDistance = manhattanL1(candidate, previous);
        const midiGap = Math.abs(cellToMidi(candidate) - cellToMidi(previous));
        const fretGap = Math.abs(candidate.fret - previous.fret);
        if (handDistance > maxStep || midiGap > 10 || fretGap > 5) continue;
        if (sameCell(candidate, previous) && ordered.length > 1) continue;
      }

      const nextCost =
        costSoFar +
        (previous
          ? lineStepCost(template, previous, candidate, index, lastStepIndex, beforePrevious)
          : lineStartCost(anchorCell, candidate, template.motion));
      if (nextCost >= bestCost) continue;

      picked[index] = candidate;
      walk(index + 1, candidate, previous, nextCost);
    }
  };

  walk(0, null, null, 0);
  return bestLine;
}

function buildTemplateLine(context: PocketContext, template: LineTemplate): Cell[] | null {
  return searchTemplateLine(context.degreeToCells, template, context.anchorCell, 4) ?? searchTemplateLine(context.degreeToCells, template, context.anchorCell, 5);
}

function toLineSteps(context: PocketContext, cells: Cell[], targetDegree: string): LineStep[] {
  return cells.map((cell) => {
    const degreeLabel = degreeLabelForRule(context.rule, cell, context.rootPc);
    return {
      cell,
      noteName: noteName(cell),
      degreeLabel,
      isTarget: degreeLabel === targetDegree,
    };
  });
}

function lineSignature(cells: Cell[]): string {
  return cells.map((cell) => `${cell.string}:${cell.fret}`).join("|");
}

function buildExplanation(context: PocketContext, targetDegree: string, targetCell: Cell, reason: string, next: string): ExplanationBlock {
  const targetNote = noteName(targetCell);
  return {
    pocket: `${context.rootName} ${context.rule.label} / ${context.pocketRange.label}`,
    target: `${targetDegree} (${targetNote})`,
    reason,
    next,
  };
}

function toneSummaryForCells(context: PocketContext, cells: Cell[]): string {
  return cells
    .map((cell) => `${degreeLabelForRule(context.rule, cell, context.rootPc)}(${noteName(cell)})`)
    .join(", ");
}

function cellListEquals(left: Cell[], right: Cell[]): boolean {
  if (left.length !== right.length) return false;
  const leftKeys = left.map((cell) => `${cell.string}:${cell.fret}`).sort();
  const rightKeys = right.map((cell) => `${cell.string}:${cell.fret}`).sort();
  return leftKeys.every((key, index) => key === rightKeys[index]);
}

function completeEndpointMatches(policy: CompleteEndpointPolicy, start: RuleMidiBucket, end: RuleMidiBucket): boolean {
  const startIsRoot = start.degreeLabel === "1";
  const endIsRoot = end.degreeLabel === "1";
  if (policy === "BOTH_ROOT") return startIsRoot && endIsRoot;
  if (policy === "ONE_ROOT") return startIsRoot || endIsRoot;
  return true;
}

function buildPositionQuestion(context: PocketContext, difficulty: string): PositionQuestion | null {
  const candidateTones = context.allowedCells
    .map((cell) => pocketToneForCell(context, cell))
    .filter((tone) => tone.degreeLabel !== "1")
    .sort((a, b) => {
      const roleGap = (a.role === "STABLE" ? 0 : 1) - (b.role === "STABLE" ? 0 : 1);
      return (
        roleGap ||
        degreePriority(a.degreeLabel) - degreePriority(b.degreeLabel) ||
        naturalPositionCost(context.anchorCell, a.cell) - naturalPositionCost(context.anchorCell, b.cell) ||
        cellDistanceSort(context.anchorCell, a.cell, b.cell)
      );
    });
  if (!candidateTones.length) return null;

  const missingCount = Math.min(positionMissingCountForDifficulty(difficulty), candidateTones.length);
  const missing: PocketTone[] = [];

  for (const tone of candidateTones) {
    if (missing.length >= missingCount) break;
    if (missing.length === 0) {
      missing.push(tone);
      continue;
    }
    if (!missing.some((item) => item.degreeLabel === tone.degreeLabel)) {
      missing.push(tone);
    }
  }

  for (const tone of candidateTones) {
    if (missing.length >= missingCount) break;
    if (!missing.some((item) => sameCell(item.cell, tone.cell))) {
      missing.push(tone);
    }
  }

  if (!missing.length) return null;

  const missingCells = missing.map((tone) => tone.cell);
  const shownCells = context.allowedCells.filter((cell) => !missingCells.some((target) => sameCell(target, cell)));
  const targetDegree = [...new Set(missing.map((tone) => tone.degreeLabel))].join(" / ");
  const targetCell = missingCells[0];
  const missingLabel = toneSummaryForCells(context, missingCells);

  return {
    stage: "POSITION",
    rootPc: context.rootPc,
    rootName: context.rootName,
    rule: context.rule,
    pocketRange: context.pocketRange,
    displayMaxFret: context.pocketRange.maxFret,
    anchorCell: context.anchorCell,
    targetDegree,
    targetCell,
    prompt: missingCells.length > 1 ? `비어 있는 구성음 ${missingCells.length}개를 채우세요.` : "비어 있는 구성음 위치를 채우세요.",
    explanation: buildExplanation(
      context,
      targetDegree,
      targetCell,
      `빠진 음은 ${missingLabel}입니다.`,
      "루트와 이미 보이는 구성음을 먼저 보고 빈칸을 찾으세요."
    ),
    pocketTones: buildPocketTones(context),
    guideTones: [],
    shownCells,
    missingCells,
    correctAnswer: missingCells,
    acceptedCells: missingCells,
  };
}

function fixClusterCost(anchor: Cell, cell: Cell): number {
  return (
    manhattanL1(cell, anchor) * 7 +
    Math.abs(cell.fret - anchor.fret) * 2 +
    Math.abs(cell.string - anchor.string) * 5 +
    Math.abs(cellToMidi(cell) - cellToMidi(anchor)) * 0.35
  );
}

function hasDuplicateMidi(cells: Cell[]): boolean {
  const seen = new Set<number>();
  for (const cell of cells) {
    const midi = cellToMidi(cell);
    if (seen.has(midi)) return true;
    seen.add(midi);
  }
  return false;
}

function fixStartsOnRoot(difficulty: string): boolean {
  const diff = difficulty.toUpperCase();
  return diff === "EASY" || diff === "NORMAL" || diff === "HARD";
}

function fixOptionCountForDifficulty(difficulty: string): number {
  const diff = difficulty.toUpperCase();
  if (diff === "EASY") return 2;
  if (diff === "NORMAL") return 3;
  return 4;
}

function fixSetsTooSimilar(left: Cell[], right: Cell[]): boolean {
  if (left.length !== right.length) return false;
  const shared = left.filter((cell) => right.some((candidate) => sameCell(candidate, cell))).length;
  if (shared >= left.length - 1) return true;

  let changed = 0;
  let nearChanged = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (sameCell(a, b)) continue;
    changed += 1;
    if (Math.abs(a.fret - b.fret) <= 1 && Math.abs(a.string - b.string) <= 1) {
      nearChanged += 1;
    }
  }
  return changed <= 1 || (changed <= 2 && nearChanged === changed);
}

function buildClusteredRuleSet(
  rng: SeededRng,
  context: PocketContext,
  difficulty: string,
  noteCount: number,
  usedSignatures: Set<string>,
  existingSets: Cell[][]
): Cell[] | null {
  const rootFirst = fixStartsOnRoot(difficulty);
  const anchors = shuffleWithRng(rng, rootFirst ? context.rootCells : fullRuleCells(context));
  for (const anchor of anchors) {
    const cluster = fullRuleCells(context)
      .filter(
        (cell) =>
          Math.abs(cell.fret - anchor.fret) <= (rootFirst ? 12 : 8) &&
          Math.abs(cell.string - anchor.string) <= (rootFirst ? 3 : 2) &&
          Math.abs(cellToMidi(cell) - cellToMidi(anchor)) <= (rootFirst ? 24 : 14)
      )
      .sort((a, b) => fixClusterCost(anchor, a) - fixClusterCost(anchor, b) || a.fret - b.fret || a.string - b.string);
    if (cluster.length < noteCount) continue;

    const uniqueByMidi: Cell[] = [];
    const midiSeen = new Set<number>();
    for (const cell of cluster) {
      const midi = cellToMidi(cell);
      if (midiSeen.has(midi)) continue;
      midiSeen.add(midi);
      uniqueByMidi.push(cell);
    }
    if (uniqueByMidi.length < noteCount) continue;

    const anchorMidi = cellToMidi(anchor);
    const sortedByMidi = uniqueByMidi.slice().sort((a, b) => cellToMidi(a) - cellToMidi(b));
    const picked = rootFirst
      ? (() => {
          const ascending = sortedByMidi.filter((cell) => !sameCell(cell, anchor) && cellToMidi(cell) > anchorMidi);
          if (ascending.length >= noteCount - 1) {
            return [anchor, ...ascending.slice(0, noteCount - 1)];
          }
          const wider = fullRuleCells(context)
            .filter((cell) => !sameCell(cell, anchor) && cellToMidi(cell) > anchorMidi)
            .sort((a, b) => fixClusterCost(anchor, a) - fixClusterCost(anchor, b) || cellToMidi(a) - cellToMidi(b));
          const uniqueWider: Cell[] = [];
          const widerSeen = new Set<number>();
          for (const cell of wider) {
            const midi = cellToMidi(cell);
            if (widerSeen.has(midi)) continue;
            widerSeen.add(midi);
            uniqueWider.push(cell);
          }
          return [anchor, ...uniqueWider.slice(0, noteCount - 1)];
        })()
      : (() => {
          const start = rng.int(0, Math.max(0, sortedByMidi.length - noteCount));
          return sortedByMidi.slice(start, start + noteCount);
        })();
    if (picked.length < noteCount) continue;
    if (hasDuplicateMidi(picked)) continue;
    const fretSpan = picked[picked.length - 1].fret - picked[0].fret;
    if (fretSpan > (rootFirst ? 10 : 8)) continue;
    if (rootFirst && degreeLabelForRule(context.rule, picked[0], context.rootPc) !== "1") continue;
    if (existingSets.some((item) => fixSetsTooSimilar(item, picked))) continue;
    const signature = lineSignature(picked);
    if (usedSignatures.has(signature)) continue;
    usedSignatures.add(signature);
    return picked;
  }
  return null;
}

function buildWrongFixSet(rng: SeededRng, context: PocketContext, sourceSet: Cell[], usedSignatures: Set<string>): { cells: Cell[]; wrongIndex: number } | null {
  const nonRuleCells = fullNonRuleCells(context);
  const candidateIndices = shuffleWithRng(
    rng,
    Array.from({ length: sourceSet.length }, (_, index) => index)
  );

  for (const index of candidateIndices) {
    const sourceCell = sourceSet[index];
    const strictReplacements = nonRuleCells
      .filter((cell) => !sourceSet.some((item) => sameCell(item, cell)))
      .filter((cell) => !sourceSet.some((item) => cellToMidi(item) === cellToMidi(cell)))
      .filter(
        (cell) =>
          Math.abs(cell.fret - sourceCell.fret) <= 5 &&
          Math.abs(cell.string - sourceCell.string) <= 2 &&
          Math.abs(cellToMidi(cell) - cellToMidi(sourceCell)) <= 8
      )
      .filter(
        (cell) =>
          Math.abs(cell.fret - sourceCell.fret) >= 2 ||
          Math.abs(cell.string - sourceCell.string) >= 1 ||
          Math.abs(cellToMidi(cell) - cellToMidi(sourceCell)) >= 3
      )
      .sort((a, b) => fixClusterCost(sourceCell, a) - fixClusterCost(sourceCell, b));
    const fallbackReplacements = nonRuleCells
      .filter((cell) => !sourceSet.some((item) => sameCell(item, cell)))
      .filter((cell) => !sourceSet.some((item) => cellToMidi(item) === cellToMidi(cell)))
      .filter(
        (cell) =>
          Math.abs(cell.fret - sourceCell.fret) <= 7 &&
          Math.abs(cell.string - sourceCell.string) <= 2 &&
          Math.abs(cellToMidi(cell) - cellToMidi(sourceCell)) <= 10
      )
      .sort((a, b) => fixClusterCost(sourceCell, a) - fixClusterCost(sourceCell, b));
    for (const replacement of strictReplacements.length ? strictReplacements : fallbackReplacements) {
      const next = sourceSet.map((cell, cellIndex) => (cellIndex === index ? replacement : cell));
      if (hasDuplicateMidi(next)) continue;
      const signature = lineSignature(next);
      if (usedSignatures.has(signature)) continue;
      usedSignatures.add(signature);
      return {
        cells: next,
        wrongIndex: next.findIndex((cell) => sameCell(cell, replacement)),
      };
    }
  }

  return null;
}

type RuleMidiBucket = {
  midi: number;
  cells: Cell[];
  degreeLabel: string;
  noteName: string;
};

function buildRuleMidiBuckets(context: PocketContext): RuleMidiBucket[] {
  const map = new Map<number, Cell[]>();
  for (const cell of fullRuleCells(context)) {
    const midi = cellToMidi(cell);
    const list = map.get(midi) ?? [];
    list.push(cell);
    map.set(midi, list);
  }

  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([midi, cells]) => ({
      midi,
      cells: sortCellsByBoard(cells),
      degreeLabel: degreeLabelForRule(context.rule, cells[0], context.rootPc),
      noteName: midiToName(midi),
    }));
}

function chooseRepresentativeCell(cells: Cell[], anchor: Cell): Cell {
  return (
    cells
      .slice()
      .sort((a, b) => naturalPositionCost(anchor, a) - naturalPositionCost(anchor, b) || cellDistanceSort(anchor, a, b))[0] ?? cells[0]
  );
}

function buildRepresentativeSequence(buckets: RuleMidiBucket[], anchorCell: Cell): Cell[] {
  const out: Cell[] = [];
  let anchor = anchorCell;
  for (const bucket of buckets) {
    const picked = chooseRepresentativeCell(bucket.cells, anchor);
    out.push(picked);
    anchor = picked;
  }
  return out;
}

function buildFixQuestion(rng: SeededRng, context: PocketContext, difficulty: string): FixQuestion | null {
  const noteCount = noteCountForDifficulty(difficulty);
  const validSetTarget = Math.max(1, fixOptionCountForDifficulty(difficulty) - 1);
  const usedSignatures = new Set<string>();
  const validSets: Cell[][] = [];

  for (let attempt = 0; attempt < 40 && validSets.length < validSetTarget; attempt += 1) {
    const picked = buildClusteredRuleSet(rng, context, difficulty, noteCount, usedSignatures, validSets);
    if (!picked) break;
    validSets.push(picked);
  }
  if (validSets.length < validSetTarget) return null;

  const brokenBase = rng.pick(validSets);
  const broken = buildWrongFixSet(rng, context, brokenBase, usedSignatures);
  if (!broken) return null;

  const targetCell = validSets[0][0];
  const options = shuffleWithRng(rng, [
    ...validSets.map((cells, index) => ({
      id: `fix-valid-${index}`,
      line: toLineSteps(context, cells, "규칙음"),
      invalidIndex: null,
      isWrong: false,
    })),
    {
      id: "fix-wrong",
      line: toLineSteps(context, broken.cells, "규칙음"),
      invalidIndex: broken.wrongIndex,
      isWrong: true,
    },
  ]);
  const wrongOptionIndex = options.findIndex((option) => option.isWrong);
  if (wrongOptionIndex < 0) return null;

  const displayCells = options.flatMap((option) => option.line.map((step) => step.cell));

  return {
    stage: "FIX",
    rootPc: context.rootPc,
    rootName: context.rootName,
    rule: context.rule,
    pocketRange: context.pocketRange,
    displayMaxFret: displayMaxFretForCells(displayCells),
    anchorCell: context.anchorCell,
    targetDegree: "규칙음",
    targetCell,
    prompt: "찍힌 음들 중 규칙 밖 음이 섞인 보기 하나를 고르세요.",
    explanation: {
      pocket: `${context.rootName} ${context.rule.label}`,
      target: `${context.rule.label} 안에 없는 음 1개`,
      reason: "한 보기에는 이 코드/스케일에 없는 음이 1개 섞여 있습니다.",
      next: "루트보다 음 집합 자체가 규칙 안에 들어오는지 먼저 보세요.",
    },
    pocketTones: buildPocketTones(context),
    guideTones: [],
    options,
    validLine: toLineSteps(context, validSets[0], "규칙음"),
    correctAnswer: wrongOptionIndex,
    wrongOptionIndex,
    wrongNoteIndex: options[wrongOptionIndex].invalidIndex ?? 0,
    errorType: "OUTSIDE_RULE",
  };
}

function buildCompleteQuestion(rng: SeededRng, context: PocketContext, difficulty: string): CompleteQuestion | null {
  const buckets = buildRuleMidiBuckets(context);
  const totalLength = sequenceLengthForDifficulty(difficulty);
  if (buckets.length < totalLength) return null;

  const directions: Array<"UP" | "DOWN"> = shuffleWithRng(rng, ["UP", "DOWN"]);
  let chosenDirection: "UP" | "DOWN" | null = null;
  let chosenWindow: RuleMidiBucket[] | null = null;

  for (const direction of directions) {
    const windows: RuleMidiBucket[][] = [];
    for (let start = 0; start <= buckets.length - totalLength; start += 1) {
      const window = buckets.slice(start, start + totalLength);
      const span = window[window.length - 1].midi - window[0].midi;
      const maxStep = window.slice(1).reduce((value, bucket, index) => Math.max(value, bucket.midi - window[index].midi), 0);
      if (span < totalLength - 1 || span > 15 || maxStep > 5) continue;
      windows.push(direction === "UP" ? window : window.slice().reverse());
    }
    if (windows.length) {
      chosenDirection = direction;
      chosenWindow = rng.pick(windows);
      break;
    }
  }

  if (!chosenDirection || !chosenWindow) return null;

  const lineCells = buildRepresentativeSequence(chosenWindow, context.anchorCell);
  if (lineCells.length < 4) return null;

  const blankIndices = Array.from({ length: lineCells.length - 2 }, (_, index) => index + 1);
  const targetCell = lineCells[lineCells.length - 1];
  const targetDegree = degreeLabelForRule(context.rule, targetCell, context.rootPc);

  return {
    stage: "COMPLETE",
    rootPc: context.rootPc,
    rootName: context.rootName,
    rule: context.rule,
    pocketRange: context.pocketRange,
    displayMaxFret: displayMaxFretForCells(lineCells),
    anchorCell: lineCells[0],
    targetDegree,
    targetCell,
    direction: chosenDirection,
    prompt: `시작음과 끝음 사이를 ${chosenDirection === "UP" ? "올라가며" : "내려가며"} 순서대로 누르세요.`,
    explanation: {
      pocket: `${context.rootName} ${context.rule.label}`,
      target: `${lineCells[0] ? noteName(lineCells[0]) : "-"} -> ${noteName(targetCell)} ${chosenDirection === "UP" ? "상행" : "하행"}`,
      reason: "중간 음들을 규칙 안에서 순서대로 눌러야 라인이 매끈하게 이어집니다.",
      next: "시작음과 끝음 사이에 들어가는 음을 한 칸씩 차례대로 보세요.",
    },
    pocketTones: buildPocketTones(context),
    guideTones: [],
    line: toLineSteps(context, lineCells, targetDegree),
    blankIndices,
    acceptedCellsByStep: chosenWindow.slice(1, -1).map((bucket) => bucket.cells),
    choiceGroups: [],
    correctAnswer: lineCells.slice(1, -1),
  };
}

function buildFixQuestionV2(rng: SeededRng, context: PocketContext, difficulty: string): FixQuestion | null {
  const noteCount = noteCountForDifficulty(difficulty);
  const validSetTarget = Math.max(1, fixOptionCountForDifficulty(difficulty) - 1);
  const usedSignatures = new Set<string>();
  const validSets: Cell[][] = [];

  for (let attempt = 0; attempt < 40 && validSets.length < validSetTarget; attempt += 1) {
    const picked = buildClusteredRuleSet(rng, context, difficulty, noteCount, usedSignatures, validSets);
    if (!picked) break;
    validSets.push(picked);
  }
  if (validSets.length < validSetTarget) return null;

  const brokenBase = rng.pick(validSets);
  const broken = buildWrongFixSet(rng, context, brokenBase, usedSignatures);
  if (!broken) return null;

  const targetCell = validSets[0][0];
  const options = shuffleWithRng(rng, [
    ...validSets.map((cells, index) => ({
      id: `fix-valid-${index}`,
      line: toLineSteps(context, cells, "규칙음"),
      invalidIndex: null,
      isWrong: false,
    })),
    {
      id: "fix-wrong",
      line: toLineSteps(context, broken.cells, "규칙음"),
      invalidIndex: broken.wrongIndex,
      isWrong: true,
    },
  ]);
  const wrongOptionIndex = options.findIndex((option) => option.isWrong);
  if (wrongOptionIndex < 0) return null;

  const displayCells = options.flatMap((option) => option.line.map((step) => step.cell));

  return {
    stage: "FIX",
    rootPc: context.rootPc,
    rootName: context.rootName,
    rule: context.rule,
    pocketRange: context.pocketRange,
    displayMaxFret: displayMaxFretForCells(displayCells),
    anchorCell: context.anchorCell,
    targetDegree: "규칙음",
    targetCell,
    prompt: "스케일/코드에 맞지 않는 보기 하나를 고르세요.",
    explanation: {
      pocket: `${context.rootName} ${context.rule.label}`,
      target: `${context.rule.label}에 없는 음 1개`,
      reason: "한 보기에는 이 코드/스케일에 없는 음이 1개 섞여 있습니다.",
      next: "루트보다 음 묶음 전체가 규칙 안인지 먼저 보세요.",
    },
    pocketTones: buildPocketTones(context),
    guideTones: [],
    options,
    validLine: toLineSteps(context, validSets[0], "규칙음"),
    correctAnswer: wrongOptionIndex,
    wrongOptionIndex,
    wrongNoteIndex: options[wrongOptionIndex].invalidIndex ?? 0,
    errorType: "OUTSIDE_RULE",
  };
}

function buildFallbackFixQuestion(rng: SeededRng, context: PocketContext, difficulty: string): FixQuestion | null {
  const noteCount = Math.min(5, noteCountForDifficulty(difficulty));
  const validSetTarget = Math.max(1, fixOptionCountForDifficulty(difficulty) - 1);
  const buckets = buildRuleMidiBuckets(context);
  if (buckets.length < noteCount) return null;

  const startIndices = buckets
    .map((bucket, index) => ({ bucket, index }))
    .filter(({ bucket }) => !fixStartsOnRoot(difficulty) || bucket.degreeLabel === "1")
    .map(({ index }) => index);
  const validSets: Cell[][] = [];

  for (const startIndex of startIndices) {
    const window = buckets.slice(startIndex, startIndex + noteCount);
    if (window.length < noteCount) continue;
    const line = buildRepresentativeSequence(window, window[0].cells[0] ?? context.anchorCell);
    if (line.length < noteCount || hasDuplicateMidi(line)) continue;
    if (fixStartsOnRoot(difficulty) && degreeLabelForRule(context.rule, line[0], context.rootPc) !== "1") continue;
    if (validSets.some((item) => fixSetsTooSimilar(item, line))) continue;
    validSets.push(line);
    if (validSets.length >= validSetTarget) break;
  }

  if (validSets.length < 1) return null;
  while (validSets.length < validSetTarget) {
    const shifted = buildRepresentativeSequence(buckets.slice(Math.max(0, buckets.length - noteCount)), context.anchorCell);
    if (
      shifted.length === noteCount &&
      !hasDuplicateMidi(shifted) &&
      !validSets.some((item) => fixSetsTooSimilar(item, shifted))
    ) {
      validSets.push(shifted);
      continue;
    }
    break;
  }
  if (validSets.length < validSetTarget) return null;

  const usedSignatures = new Set(validSets.map((cells) => lineSignature(cells)));
  const broken = buildWrongFixSet(rng, context, validSets[0], usedSignatures);
  if (!broken) return null;

  const options = shuffleWithRng(rng, [
    ...validSets.map((cells, index) => ({
      id: `fix-fallback-valid-${index}`,
      line: toLineSteps(context, cells, "규칙음"),
      invalidIndex: null,
      isWrong: false,
    })),
    {
      id: "fix-fallback-wrong",
      line: toLineSteps(context, broken.cells, "규칙음"),
      invalidIndex: broken.wrongIndex,
      isWrong: true,
    },
  ]);
  const wrongOptionIndex = options.findIndex((option) => option.isWrong);
  if (wrongOptionIndex < 0) return null;

  const displayCells = options.flatMap((option) => option.line.map((step) => step.cell));

  return {
    stage: "FIX",
    rootPc: context.rootPc,
    rootName: context.rootName,
    rule: context.rule,
    pocketRange: context.pocketRange,
    displayMaxFret: displayMaxFretForCells(displayCells),
    anchorCell: context.anchorCell,
    targetDegree: "규칙음",
    targetCell: validSets[0][0],
    prompt: "스케일/코드에 맞지 않는 보기 하나를 고르세요.",
    explanation: {
      pocket: `${context.rootName} ${context.rule.label}`,
      target: `${context.rule.label}에 없는 음 1개`,
      reason: "한 보기에는 이 코드/스케일에 없는 음이 1개 섞여 있습니다.",
      next: "루트를 먼저 보고 나머지 음이 같은 묶음 안에 있는지 확인하세요.",
    },
    pocketTones: buildPocketTones(context),
    guideTones: [],
    options,
    validLine: toLineSteps(context, validSets[0], "규칙음"),
    correctAnswer: wrongOptionIndex,
    wrongOptionIndex,
    wrongNoteIndex: options[wrongOptionIndex].invalidIndex ?? 0,
    errorType: "OUTSIDE_RULE",
  };
}

function buildCompleteQuestionV2(rng: SeededRng, context: PocketContext, difficulty: string): CompleteQuestion | null {
  const buckets = buildRuleMidiBuckets(context);
  const minLength = sequenceLengthForDifficulty(difficulty);
  const maxLength = Math.min(maxSequenceLengthForDifficulty(difficulty), buckets.length);
  const policy = completeEndpointPolicyForDifficulty(difficulty);
  const candidates: Array<{ direction: "UP" | "DOWN"; window: RuleMidiBucket[] }> = [];

  for (const direction of shuffleWithRng(rng, ["UP", "DOWN"] as Array<"UP" | "DOWN">)) {
    for (let length = minLength; length <= maxLength; length += 1) {
      for (let start = 0; start <= buckets.length - length; start += 1) {
        const forwardWindow = buckets.slice(start, start + length);
        const orderedWindow = direction === "UP" ? forwardWindow : forwardWindow.slice().reverse();
        const span = Math.abs(orderedWindow[orderedWindow.length - 1].midi - orderedWindow[0].midi);
        const maxStep = orderedWindow.slice(1).reduce((value, bucket, index) => Math.max(value, Math.abs(bucket.midi - orderedWindow[index].midi)), 0);
        if (span < length - 1 || span > 16 || maxStep > 5) continue;
        if (!completeEndpointMatches(policy, orderedWindow[0], orderedWindow[orderedWindow.length - 1])) continue;
        candidates.push({ direction, window: orderedWindow });
      }
    }
  }

  if (!candidates.length) return null;

  const picked = rng.pick(candidates);
  const lineCells = buildRepresentativeSequence(picked.window, context.anchorCell);
  if (lineCells.length < 4) return null;

  const blankIndices = Array.from({ length: lineCells.length - 2 }, (_, index) => index + 1);
  const targetCell = lineCells[lineCells.length - 1];
  const targetDegree = degreeLabelForRule(context.rule, targetCell, context.rootPc);
  const startCell = lineCells[0];
  const startDegree = degreeLabelForRule(context.rule, startCell, context.rootPc);

  return {
    stage: "COMPLETE",
    rootPc: context.rootPc,
    rootName: context.rootName,
    rule: context.rule,
    pocketRange: context.pocketRange,
    displayMaxFret: displayMaxFretForCells(lineCells),
    anchorCell: startCell,
    targetDegree,
    targetCell,
    direction: picked.direction,
    prompt: `시작음에서 끝음까지 ${picked.direction === "UP" ? "상행" : "하행"}으로 빈칸을 순서대로 채우세요.`,
    explanation: {
      pocket: `${context.rootName} ${context.rule.label}`,
      target: `${noteName(startCell)}(${startDegree}) -> ${noteName(targetCell)}(${targetDegree})`,
      reason: `중간 음은 ${picked.direction === "UP" ? "낮은 음에서 높은 음으로" : "높은 음에서 낮은 음으로"} 한 칸씩 이어집니다.`,
      next: "시작음과 끝음을 먼저 보고 사이 음을 순서대로 채우세요.",
    },
    pocketTones: buildPocketTones(context),
    guideTones: [],
    line: toLineSteps(context, lineCells, targetDegree),
    blankIndices,
    acceptedCellsByStep: picked.window.slice(1, -1).map((bucket) => bucket.cells),
    choiceGroups: [],
    correctAnswer: lineCells.slice(1, -1),
  };
}

function buildFallbackPositionQuestion(context: PocketContext): PositionQuestion {
  const targetCell = context.rootCells[0] ?? context.anchorCell;
  const missingCells = [targetCell];
  return {
    stage: "POSITION",
    rootPc: context.rootPc,
    rootName: context.rootName,
    rule: context.rule,
    pocketRange: context.pocketRange,
    displayMaxFret: context.pocketRange.maxFret,
    anchorCell: context.anchorCell,
    targetDegree: "1",
    targetCell,
    prompt: "비어 있는 루트 위치를 채우세요.",
    explanation: buildExplanation(
      context,
      "1",
      targetCell,
      `빠진 음은 1(${noteName(targetCell)})입니다.`,
      "루트부터 먼저 찾으면 다른 구성음도 더 잘 보입니다."
    ),
    pocketTones: buildPocketTones(context),
    guideTones: [],
    shownCells: context.allowedCells.filter((cell) => !sameCell(cell, targetCell)),
    missingCells,
    correctAnswer: missingCells,
    acceptedCells: missingCells,
  };
}

export function buildLineMapperQuestion(
  rng: SeededRng,
  difficulty: string,
  stage: LineMapperStage | null,
  _challengeMode: boolean,
  scaleRules: Record<string, RawRuleInput>,
  chordQualities: Record<string, RawRuleInput>,
  maxFretByDifficulty?: Partial<Record<string, number>>
): LineMapperQuestion {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const nextStage = stage ?? pickWeightedStage(rng);
    const context = buildPocketContext(rng, difficulty, scaleRules, chordQualities, maxFretByDifficulty);
    const question =
      nextStage === "POSITION"
        ? buildPositionQuestion(context, difficulty)
        : nextStage === "FIX"
        ? buildFixQuestionV2(rng, context, difficulty)
        : buildCompleteQuestionV2(rng, context, difficulty);
    if (question) return question;
  }

  const fallback = buildPocketContext(rng, difficulty, scaleRules, chordQualities, maxFretByDifficulty);
  if (stage === "FIX") {
    return buildFallbackFixQuestion(rng, fallback, difficulty) ?? buildFallbackPositionQuestion(fallback);
  }
  return buildPositionQuestion(fallback, difficulty) ?? buildFallbackPositionQuestion(fallback);
}

function questionToneSummary(question: { rule: RuleDef; rootPc: number }, cells: Cell[]): string {
  return cells
    .map((cell) => `${degreeLabelForRule(question.rule, cell, question.rootPc)}(${noteName(cell)})`)
    .join(", ");
}

function uniqueCells(cells: Cell[]): Cell[] {
  return cells.filter((cell, index) => cells.findIndex((candidate) => sameCell(candidate, cell)) === index);
}

function explanationFromWrongPosition(question: PositionQuestion): ExplanationBlock {
  return {
    pocket: question.explanation.pocket,
    target: question.explanation.target,
    reason: `빈칸은 ${questionToneSummary(question, question.missingCells)}입니다.`,
    next: "루트와 이미 찍힌 구성음 사이의 빈칸을 먼저 보세요.",
  };
}

function evaluatePositionV2(question: PositionQuestion, answerCells: Cell[], mistakes: Cell[] = []): LineMapperEvaluation {
  const pickedCells = uniqueCells(answerCells);
  const ok = mistakes.length === 0 && cellListEquals(pickedCells, question.acceptedCells);
  return {
    ok,
    title: ok ? "정답입니다." : "오답입니다.",
    statusText: ok ? `빈칸 ${question.acceptedCells.length}개를 모두 찾았습니다.` : `빈칸은 ${questionToneSummary(question, question.acceptedCells)}였습니다.`,
    explanation: ok ? question.explanation : explanationFromWrongPosition(question),
    wrongCells: uniqueCells(mistakes),
    correctCells: question.acceptedCells,
  };
}

function evaluateFixV2(question: FixQuestion, answerIndex: number): LineMapperEvaluation {
  const ok = answerIndex === question.wrongOptionIndex;
  const selectedOption = question.options[answerIndex];
  const selectedCell =
    selectedOption && selectedOption.invalidIndex !== null && selectedOption.invalidIndex !== undefined
      ? selectedOption.line[selectedOption.invalidIndex]?.cell
      : undefined;
  const wrongCell = question.options[question.wrongOptionIndex]?.line[question.wrongNoteIndex]?.cell;
  const wrongSummary = wrongCell ? questionToneSummary(question, [wrongCell]) : "규칙 밖 음";

  return {
    ok,
    title: ok ? "정답입니다." : "오답입니다.",
    statusText: ok ? `${wrongSummary}이 섞인 보기를 찾았습니다.` : `틀린 보기는 ${wrongSummary}이 섞인 예제였습니다.`,
    explanation: {
      pocket: question.explanation.pocket,
      target: question.explanation.target,
      reason: `${wrongSummary}이 이 코드/스케일 밖 음입니다.`,
      next: "음 이름보다 찍힌 음 묶음 전체가 규칙 안인지 먼저 보세요.",
    },
    wrongCells: ok ? [] : selectedCell ? [selectedCell] : [],
    correctCells: wrongCell ? [wrongCell] : [],
    selectedFixIndex: answerIndex,
    correctFixIndex: question.wrongOptionIndex,
  };
}

function evaluateCompleteV2(question: CompleteQuestion, answerCells: Cell[], mistakes: Cell[] = []): LineMapperEvaluation {
  const incomplete = answerCells.length !== question.correctAnswer.length;
  const wrongCellsByOrder = answerCells.filter(
    (value, index) => !question.acceptedCellsByStep[index]?.some((candidate) => sameCell(candidate, value))
  );
  const correctPicked = answerCells.filter((value, index) =>
    question.acceptedCellsByStep[index]?.some((candidate) => sameCell(candidate, value))
  );
  const wrongIndex = wrongCellsByOrder.length > 0 ? answerCells.findIndex((value) => sameCell(value, wrongCellsByOrder[0])) : -1;
  const ok = !incomplete && wrongIndex < 0 && mistakes.length === 0;
  const firstWrongCell = wrongIndex >= 0 ? answerCells[wrongIndex] : mistakes[0];
  const correctSequence = questionToneSummary(question, question.correctAnswer);
  const wrongCells = uniqueCells([...wrongCellsByOrder, ...mistakes]);

  return {
    ok,
    title: ok ? "정답입니다." : "오답입니다.",
    statusText: ok ? "시작음부터 끝음까지 순서대로 완성했습니다." : `정답 순서는 ${correctSequence}입니다.`,
    explanation: {
      pocket: question.explanation.pocket,
      target: question.explanation.target,
      reason: ok
        ? `${correctSequence} 순서로 연결하면 됩니다.`
        : incomplete
        ? `중간 음을 끝까지 채우지 않았습니다. 정답은 ${correctSequence}입니다.`
        : `${firstWrongCell ? `${questionToneSummary(question, [firstWrongCell])} 자리에서` : "중간 음 순서에서"} 벗어났습니다. 정답은 ${correctSequence}입니다.`,
      next: "시작음과 끝음을 먼저 본 뒤 사이 음을 차례대로 채우세요.",
    },
    wrongCells,
    correctCells: uniqueCells(correctPicked),
    solutionCells: question.line.map((step) => step.cell),
  };
}

export function evaluateLineMapperQuestion(question: LineMapperQuestion, answer: LineMapperAnswer): LineMapperEvaluation {
  if (question.stage === "POSITION" && answer.stage === "POSITION") {
    return evaluatePositionV2(question, answer.cells, answer.mistakes);
  }
  if (question.stage === "FIX" && answer.stage === "FIX") {
    return evaluateFixV2(question, answer.index);
  }
  if (question.stage === "COMPLETE" && answer.stage === "COMPLETE") {
    return evaluateCompleteV2(question, answer.cells, answer.mistakes);
  }

  return {
    ok: false,
    title: "오답입니다.",
    statusText: "현재 문제 형식과 맞지 않는 입력입니다.",
    explanation: {
      pocket: question.explanation.pocket,
      target: question.explanation.target,
      reason: "문제 형식에 맞는 입력 방식으로 다시 시도해보세요.",
      next: "코드 음 찾기=지판 클릭, 틀린 지판 찾기=보기 선택, 스케일 완성=지판 클릭 방식입니다.",
    },
    wrongCells: [],
    correctCells: [question.targetCell],
  };
}

export function questionErrorType(question: LineMapperQuestion): LineMapperErrorType | "" {
  return question.stage === "FIX" ? question.errorType : "";
}

export function questionPocketLabel(question: LineMapperQuestion): string {
  return `${question.pocketRange.minFret}-${question.pocketRange.maxFret}`;
}

export { pickWeightedStage };




