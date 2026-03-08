export type HitDetectMode = "ZONE" | "WIRE" | "HYBRID";
export type RhythmNotationMode = "BASS_STAFF" | "PERCUSSION";
export type FretboardBoardPreset = "CLASSIC" | "MAPLE" | "DARK";
export type FretboardInlayPreset = "DOT" | "BLOCK" | "TRIANGLE";
export type RcDifficulty = "EASY" | "NORMAL" | "HARD" | "VERY_HARD" | "MASTER";
export type FbhJudge = "PC" | "PC_RANGE" | "MIDI" | "PC_NEAR" | "MIDI_NEAR" | "CODE" | "CODE_MIDI" | "ROOT_NEAR";
export type FbhNearFretDirection = "ANY" | "GE_ANCHOR" | "LE_ANCHOR";
export type FbhNearStringDirection = "ANY" | "SAME" | "UPPER" | "LOWER";

export const RC_DIFFICULTIES: RcDifficulty[] = ["EASY", "NORMAL", "HARD", "VERY_HARD", "MASTER"];
export const FBH_JUDGES: FbhJudge[] = ["PC", "PC_RANGE", "MIDI", "PC_NEAR", "MIDI_NEAR", "CODE", "CODE_MIDI", "ROOT_NEAR"];

export type FbhNearSettings = {
  l1Distance: number;
  fretDirection: FbhNearFretDirection;
  stringDirection: FbhNearStringDirection;
};

export type FbhDegreeWeights = {
  chordToneWeight: number;
  extDegreeWeight: number;
  sharpWeight: number;
  flatWeight: number;
};

export type FbhCodeSettings = {
  levels: {
    basic: boolean;
    extended: boolean;
    modal: boolean;
  };
  degreeWeights: FbhDegreeWeights;
};

export type FbhRootNearSettings = {
  includeOctave: boolean;
  allow9Plus: boolean;
  degree9PlusRate: number;
  degreeWeights: FbhDegreeWeights;
  near: FbhNearSettings;
};

export type FbhPcRangeSettings = {
  minFret: number;
  maxFret: number;
  windowMinSize: number;
  windowMaxSize: number;
};

export type FbhRangeSettings = {
  minFret: number;
  maxFret: number;
  judges: FbhJudge[];
  pcRange: FbhPcRangeSettings;
  near: FbhNearSettings;
  code: FbhCodeSettings;
  rootNear: FbhRootNearSettings;
};

export type FbhChallengeSettings = {
  correctScore: number;
  wrongPenalty: number;
  timeLimitSec: number;
  lives: number;
};

export type FbhPracticeCheckMode = "CONFIRM" | "INSTANT";

export type FbhPracticeSettings = {
  checkMode: FbhPracticeCheckMode;
  showAnswerButton: boolean;
  revealAnswersOnCorrect: boolean;
  requireNextAfterReveal: boolean;
};

export type MinigameUserSettings = {
  version: number;
  fretboard: {
    maxVisibleFret: number;
    detectMode: HitDetectMode;
    showHitZones: boolean;
    showFretNotes: boolean;
    fretLineWidth: number;
    fretToneVolume: number;
    boardPreset: FretboardBoardPreset;
    inlayPreset: FretboardInlayPreset;
  };
  rhythm: {
    notationMode: RhythmNotationMode;
    showPlayhead: boolean;
    showAnswerHighlight: boolean;
    showMetronomeVisual: boolean;
    metronomeVolume: number;
    prerollBeats: number;
    challengeProblemCount: number;
    challengeAttemptsPerProblem: number;
    windowsMs: Record<RcDifficulty, number>;
  };
  theory: {
    chordSpreadMs: number;
    scaleSpreadMs: number;
  };
  fbh: {
    ranges: Record<RcDifficulty, FbhRangeSettings>;
    challenge: FbhChallengeSettings;
    practice: FbhPracticeSettings;
  };
  lm: {
    maxFretByDifficulty: Record<RcDifficulty, number>;
    explainOn: boolean;
  };
};

const STORAGE_KEY = "mg_user_settings_v3";
const LEGACY_STORAGE_KEY_V2 = "mg_user_settings_v2";
const LEGACY_STORAGE_KEY_V1 = "mg_user_settings_v1";

const defaultNearSettings = (): FbhNearSettings => ({
  l1Distance: 4,
  fretDirection: "ANY",
  stringDirection: "ANY",
});

const defaultDegreeWeights = (): FbhDegreeWeights => ({
  chordToneWeight: 4,
  extDegreeWeight: 1,
  sharpWeight: 1,
  flatWeight: 1,
});

const defaultCodeSettings = (): FbhCodeSettings => ({
  levels: {
    basic: true,
    extended: false,
    modal: false,
  },
  degreeWeights: defaultDegreeWeights(),
});

const defaultRootNearSettings = (): FbhRootNearSettings => ({
  includeOctave: true,
  allow9Plus: true,
  degree9PlusRate: 0.18,
  degreeWeights: defaultDegreeWeights(),
  near: defaultNearSettings(),
});

const defaultPcRangeSettings = (minFret: number, maxFret: number): FbhPcRangeSettings => ({
  minFret,
  maxFret,
  windowMinSize: 4,
  windowMaxSize: 6,
});

const defaultFbhRange = (minFret: number, maxFret: number, judges: FbhJudge[], pcRange: FbhPcRangeSettings): FbhRangeSettings => ({
  minFret,
  maxFret,
  judges: [...judges],
  pcRange: { ...pcRange },
  near: defaultNearSettings(),
  code: defaultCodeSettings(),
  rootNear: defaultRootNearSettings(),
});

export const defaultUserSettings: MinigameUserSettings = {
  version: 3,
  fretboard: {
    maxVisibleFret: 21,
    detectMode: "HYBRID",
    showHitZones: false,
    showFretNotes: false,
    fretLineWidth: 2.4,
    fretToneVolume: 0.2,
    boardPreset: "CLASSIC",
    inlayPreset: "DOT",
  },
  rhythm: {
    notationMode: "BASS_STAFF",
    showPlayhead: true,
    showAnswerHighlight: true,
    showMetronomeVisual: true,
    metronomeVolume: 0.9,
    prerollBeats: 4,
    challengeProblemCount: 5,
    challengeAttemptsPerProblem: 1,
    windowsMs: {
      EASY: 105,
      NORMAL: 85,
      HARD: 65,
      VERY_HARD: 52,
      MASTER: 45,
    },
  },
  theory: {
    chordSpreadMs: 50,
    scaleSpreadMs: 120,
  },
  fbh: {
    ranges: {
      EASY: defaultFbhRange(0, 4, ["PC_RANGE"], defaultPcRangeSettings(3, 10)),
      NORMAL: defaultFbhRange(0, 8, ["PC_RANGE", "MIDI"], defaultPcRangeSettings(4, 12)),
      HARD: defaultFbhRange(0, 12, ["PC_RANGE", "MIDI", "PC_NEAR"], defaultPcRangeSettings(5, 14)),
      VERY_HARD: defaultFbhRange(0, 15, ["PC_RANGE", "PC_NEAR", "MIDI_NEAR", "CODE"], defaultPcRangeSettings(5, 17)),
      MASTER: defaultFbhRange(0, 21, ["PC_RANGE", "PC_NEAR", "MIDI_NEAR", "CODE", "CODE_MIDI", "ROOT_NEAR"], defaultPcRangeSettings(5, 21)),
    },
    challenge: {
      correctScore: 2,
      wrongPenalty: 1,
      timeLimitSec: 120,
      lives: 0,
    },
    practice: {
      checkMode: "CONFIRM",
      showAnswerButton: true,
      revealAnswersOnCorrect: true,
      requireNextAfterReveal: true,
    },
  },
  lm: {
    maxFretByDifficulty: {
      EASY: 7,
      NORMAL: 10,
      HARD: 12,
      VERY_HARD: 15,
      MASTER: 21,
    },
    explainOn: true,
  },
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toNum(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeDifficultyMap<T>(source: Partial<Record<RcDifficulty, T>>, fallback: Record<RcDifficulty, T>): Record<RcDifficulty, T> {
  const out = { ...fallback } as Record<RcDifficulty, T>;
  for (const diff of RC_DIFFICULTIES) {
    if (source[diff] !== undefined) out[diff] = source[diff] as T;
  }
  return out;
}

function parseDetectMode(raw: unknown): HitDetectMode {
  return raw === "ZONE" || raw === "WIRE" || raw === "HYBRID" ? raw : defaultUserSettings.fretboard.detectMode;
}

function parseNotationMode(raw: unknown): RhythmNotationMode {
  return raw === "PERCUSSION" || raw === "BASS_STAFF" ? raw : defaultUserSettings.rhythm.notationMode;
}

function parseBoardPreset(raw: unknown): FretboardBoardPreset {
  return raw === "CLASSIC" || raw === "MAPLE" || raw === "DARK" ? raw : defaultUserSettings.fretboard.boardPreset;
}

function parseInlayPreset(raw: unknown): FretboardInlayPreset {
  return raw === "DOT" || raw === "BLOCK" || raw === "TRIANGLE" ? raw : defaultUserSettings.fretboard.inlayPreset;
}

function isFbhJudge(raw: unknown): raw is FbhJudge {
  return typeof raw === "string" && FBH_JUDGES.includes(raw as FbhJudge);
}

function parseNearFretDirection(raw: unknown, fallback: FbhNearFretDirection): FbhNearFretDirection {
  return raw === "ANY" || raw === "GE_ANCHOR" || raw === "LE_ANCHOR" ? raw : fallback;
}

function parseNearStringDirection(raw: unknown, fallback: FbhNearStringDirection): FbhNearStringDirection {
  return raw === "ANY" || raw === "SAME" || raw === "UPPER" || raw === "LOWER" ? raw : fallback;
}

function normalizeNearSettings(raw: unknown, fallback: FbhNearSettings): FbhNearSettings {
  const item = (raw && typeof raw === "object" ? raw : {}) as Partial<FbhNearSettings>;
  return {
    l1Distance: clamp(Math.floor(toNum(item.l1Distance, fallback.l1Distance)), 1, 12),
    fretDirection: parseNearFretDirection(item.fretDirection, fallback.fretDirection),
    stringDirection: parseNearStringDirection(item.stringDirection, fallback.stringDirection),
  };
}

function normalizeDegreeWeights(raw: unknown, fallback: FbhDegreeWeights): FbhDegreeWeights {
  const item = (raw && typeof raw === "object" ? raw : {}) as Partial<FbhDegreeWeights>;
  return {
    chordToneWeight: clamp(toNum(item.chordToneWeight, fallback.chordToneWeight), 0.1, 20),
    extDegreeWeight: clamp(toNum(item.extDegreeWeight, fallback.extDegreeWeight), 0.1, 20),
    sharpWeight: clamp(toNum(item.sharpWeight, fallback.sharpWeight), 0.1, 20),
    flatWeight: clamp(toNum(item.flatWeight, fallback.flatWeight), 0.1, 20),
  };
}

function normalizeCodeSettings(raw: unknown, fallback: FbhCodeSettings): FbhCodeSettings {
  const item = (raw && typeof raw === "object" ? raw : {}) as Partial<FbhCodeSettings>;
  const levels = (item.levels && typeof item.levels === "object" ? item.levels : {}) as Partial<FbhCodeSettings["levels"]>;
  const nextLevels = {
    basic: Boolean(levels.basic ?? fallback.levels.basic),
    extended: Boolean(levels.extended ?? fallback.levels.extended),
    modal: Boolean(levels.modal ?? fallback.levels.modal),
  };
  if (!nextLevels.basic && !nextLevels.extended && !nextLevels.modal) {
    nextLevels.basic = true;
  }
  return {
    levels: nextLevels,
    degreeWeights: normalizeDegreeWeights(item.degreeWeights, fallback.degreeWeights),
  };
}

function normalizeRootNearSettings(raw: unknown, fallback: FbhRootNearSettings): FbhRootNearSettings {
  const item = (raw && typeof raw === "object" ? raw : {}) as Partial<FbhRootNearSettings>;
  return {
    includeOctave: Boolean(item.includeOctave ?? fallback.includeOctave),
    allow9Plus: Boolean(item.allow9Plus ?? fallback.allow9Plus),
    degree9PlusRate: clamp(toNum(item.degree9PlusRate, fallback.degree9PlusRate), 0, 1),
    degreeWeights: normalizeDegreeWeights(item.degreeWeights, fallback.degreeWeights),
    near: normalizeNearSettings(item.near, fallback.near),
  };
}

function normalizeJudgeList(raw: unknown, fallback: FbhJudge[], legacyJudge?: unknown): FbhJudge[] {
  const out: FbhJudge[] = [];
  const fromArray = Array.isArray(raw) ? raw : [];
  const base = fromArray.length ? fromArray : legacyJudge ? [legacyJudge] : [];
  for (const value of base) {
    if (!isFbhJudge(value)) continue;
    if (!out.includes(value)) out.push(value);
  }
  return out.length ? out : [...fallback];
}

function normalizeJudgeListWithMigration(raw: unknown, fallback: FbhJudge[], migrateLegacyPcToRange: boolean, legacyJudge?: unknown): FbhJudge[] {
  const list = normalizeJudgeList(raw, fallback, legacyJudge);
  if (!migrateLegacyPcToRange) return list;
  let changed = false;
  const out: FbhJudge[] = [];
  for (const judge of list) {
    if (judge === "PC") {
      changed = true;
      if (!out.includes("PC_RANGE")) out.push("PC_RANGE");
      continue;
    }
    if (!out.includes(judge)) out.push(judge);
  }
  if (!changed) return list;
  return out.length ? out : ["PC_RANGE"];
}

function normalizePcRangeSettings(raw: unknown, fallback: FbhPcRangeSettings): FbhPcRangeSettings {
  const item = (raw && typeof raw === "object" ? raw : {}) as Partial<FbhPcRangeSettings>;

  let minFret = clamp(Math.floor(toNum(item.minFret, fallback.minFret)), 0, 21);
  let maxFret = clamp(Math.floor(toNum(item.maxFret, fallback.maxFret)), 0, 21);
  if (maxFret < minFret) maxFret = minFret;
  // Keep at least 2 frets so window size(2~12) remains satisfiable.
  if (maxFret === minFret) {
    if (maxFret < 21) maxFret += 1;
    else minFret = Math.max(0, minFret - 1);
  }

  const span = Math.max(1, maxFret - minFret + 1);
  let windowMinSize = clamp(Math.floor(toNum(item.windowMinSize, fallback.windowMinSize)), 2, 12);
  let windowMaxSize = clamp(Math.floor(toNum(item.windowMaxSize, fallback.windowMaxSize)), 2, 12);
  if (windowMaxSize < windowMinSize) windowMaxSize = windowMinSize;
  if (windowMinSize > span) windowMinSize = span;
  if (windowMaxSize > span) windowMaxSize = span;
  if (windowMaxSize < windowMinSize) windowMaxSize = windowMinSize;

  return {
    minFret,
    maxFret,
    windowMinSize,
    windowMaxSize,
  };
}

function normalizeFbhRangeSettings(raw: unknown, fallback: FbhRangeSettings): FbhRangeSettings {
  const item = (raw && typeof raw === "object" ? raw : {}) as Partial<FbhRangeSettings> & { judge?: unknown };
  const minFret = clamp(Math.floor(toNum(item.minFret, fallback.minFret)), 0, 21);
  let maxFret = clamp(Math.floor(toNum(item.maxFret, fallback.maxFret)), 0, 21);
  if (maxFret < minFret) maxFret = minFret;
  const migrateLegacyPcToRange = item.pcRange === undefined;
  return {
    minFret,
    maxFret,
    judges: normalizeJudgeListWithMigration(item.judges, fallback.judges, migrateLegacyPcToRange, item.judge),
    pcRange: normalizePcRangeSettings(item.pcRange, fallback.pcRange),
    near: normalizeNearSettings(item.near, fallback.near),
    code: normalizeCodeSettings(item.code, fallback.code),
    rootNear: normalizeRootNearSettings(item.rootNear, fallback.rootNear),
  };
}

function normalizeFbhChallengeSettings(raw: unknown, fallback: FbhChallengeSettings): FbhChallengeSettings {
  const item = (raw && typeof raw === "object" ? raw : {}) as Partial<FbhChallengeSettings>;
  return {
    correctScore: clamp(Math.floor(toNum(item.correctScore, fallback.correctScore)), 1, 100),
    wrongPenalty: clamp(Math.floor(toNum(item.wrongPenalty, fallback.wrongPenalty)), 0, 100),
    timeLimitSec: clamp(Math.floor(toNum(item.timeLimitSec, fallback.timeLimitSec)), 10, 900),
    lives: clamp(Math.floor(toNum(item.lives, fallback.lives)), 0, 20),
  };
}

function normalizeFbhPracticeSettings(raw: unknown, fallback: FbhPracticeSettings): FbhPracticeSettings {
  const item = (raw && typeof raw === "object" ? raw : {}) as Partial<FbhPracticeSettings>;
  return {
    checkMode: item.checkMode === "INSTANT" ? "INSTANT" : fallback.checkMode,
    showAnswerButton: Boolean(item.showAnswerButton ?? fallback.showAnswerButton),
    revealAnswersOnCorrect: Boolean(item.revealAnswersOnCorrect ?? fallback.revealAnswersOnCorrect),
    requireNextAfterReveal: Boolean(item.requireNextAfterReveal ?? fallback.requireNextAfterReveal),
  };
}

export function normalizeUserSettings(raw: unknown): MinigameUserSettings {
  const source = (raw && typeof raw === "object" ? raw : {}) as Partial<MinigameUserSettings>;
  const fretboard = (source.fretboard ?? {}) as Partial<MinigameUserSettings["fretboard"]>;
  const rhythm = (source.rhythm ?? {}) as Partial<MinigameUserSettings["rhythm"]>;
  const theory = (source.theory ?? {}) as Partial<MinigameUserSettings["theory"]>;
  const fbh = (source.fbh ?? {}) as Partial<MinigameUserSettings["fbh"]>;
  const lm = (source.lm ?? {}) as Partial<MinigameUserSettings["lm"]>;

  const rawRanges = (fbh.ranges ?? {}) as Partial<Record<RcDifficulty, unknown>>;
  const ranges = {} as MinigameUserSettings["fbh"]["ranges"];
  for (const diff of RC_DIFFICULTIES) {
    const fallback = defaultUserSettings.fbh.ranges[diff];
    ranges[diff] = normalizeFbhRangeSettings(rawRanges[diff], fallback);
  }

  const rawLm = lm.maxFretByDifficulty ?? {};
  const lmMax = normalizeDifficultyMap(rawLm as Partial<Record<RcDifficulty, number>>, defaultUserSettings.lm.maxFretByDifficulty);
  for (const diff of RC_DIFFICULTIES) {
    lmMax[diff] = clamp(Math.floor(toNum(lmMax[diff], defaultUserSettings.lm.maxFretByDifficulty[diff])), 0, 21);
  }

  const rawWindows = rhythm.windowsMs ?? {};
  const windows = normalizeDifficultyMap(rawWindows as Partial<Record<RcDifficulty, number>>, defaultUserSettings.rhythm.windowsMs);
  for (const diff of RC_DIFFICULTIES) {
    windows[diff] = clamp(Math.floor(toNum(windows[diff], defaultUserSettings.rhythm.windowsMs[diff])), 20, 160);
  }

  return {
    version: 3,
    fretboard: {
      maxVisibleFret: clamp(Math.floor(toNum(fretboard.maxVisibleFret, defaultUserSettings.fretboard.maxVisibleFret)), 12, 21),
      detectMode: parseDetectMode(fretboard.detectMode),
      showHitZones: Boolean(fretboard.showHitZones ?? defaultUserSettings.fretboard.showHitZones),
      showFretNotes: Boolean(fretboard.showFretNotes ?? defaultUserSettings.fretboard.showFretNotes),
      fretLineWidth: clamp(toNum(fretboard.fretLineWidth, defaultUserSettings.fretboard.fretLineWidth), 1.2, 4),
      fretToneVolume: clamp(toNum(fretboard.fretToneVolume, defaultUserSettings.fretboard.fretToneVolume), 0.02, 1),
      boardPreset: parseBoardPreset(fretboard.boardPreset),
      inlayPreset: parseInlayPreset(fretboard.inlayPreset),
    },
    rhythm: {
      notationMode: parseNotationMode(rhythm.notationMode),
      showPlayhead: Boolean(rhythm.showPlayhead ?? defaultUserSettings.rhythm.showPlayhead),
      showAnswerHighlight: Boolean(rhythm.showAnswerHighlight ?? defaultUserSettings.rhythm.showAnswerHighlight),
      showMetronomeVisual: Boolean(rhythm.showMetronomeVisual ?? defaultUserSettings.rhythm.showMetronomeVisual),
      metronomeVolume: clamp(toNum(rhythm.metronomeVolume, defaultUserSettings.rhythm.metronomeVolume), 0.05, 1.5),
      prerollBeats: clamp(Math.floor(toNum(rhythm.prerollBeats, defaultUserSettings.rhythm.prerollBeats)), 1, 8),
      challengeProblemCount: clamp(Math.floor(toNum(rhythm.challengeProblemCount, defaultUserSettings.rhythm.challengeProblemCount)), 1, 30),
      challengeAttemptsPerProblem: clamp(
        Math.floor(toNum(rhythm.challengeAttemptsPerProblem, defaultUserSettings.rhythm.challengeAttemptsPerProblem)),
        1,
        10
      ),
      windowsMs: windows,
    },
    theory: {
      chordSpreadMs: clamp(Math.floor(toNum(theory.chordSpreadMs, defaultUserSettings.theory.chordSpreadMs)), 0, 400),
      scaleSpreadMs: clamp(Math.floor(toNum(theory.scaleSpreadMs, defaultUserSettings.theory.scaleSpreadMs)), 0, 400),
    },
    fbh: {
      ranges,
      challenge: normalizeFbhChallengeSettings(fbh.challenge, defaultUserSettings.fbh.challenge),
      practice: normalizeFbhPracticeSettings(fbh.practice, defaultUserSettings.fbh.practice),
    },
    lm: {
      maxFretByDifficulty: lmMax,
      explainOn: Boolean(lm.explainOn ?? defaultUserSettings.lm.explainOn),
    },
  };
}

function readStorage(key: string): MinigameUserSettings | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return normalizeUserSettings(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function loadUserSettings(): MinigameUserSettings {
  const next = readStorage(STORAGE_KEY);
  if (next) return next;

  const legacyV2 = readStorage(LEGACY_STORAGE_KEY_V2);
  if (legacyV2) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(legacyV2));
    return legacyV2;
  }

  const legacyV1 = readStorage(LEGACY_STORAGE_KEY_V1);
  if (legacyV1) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(legacyV1));
    return legacyV1;
  }
  return defaultUserSettings;
}

export function saveUserSettings(settings: MinigameUserSettings): MinigameUserSettings {
  return normalizeUserSettings(settings);
}

export function resetUserSettings(): MinigameUserSettings {
  return normalizeUserSettings(defaultUserSettings);
}

export function userSettingsToBlob(settings: MinigameUserSettings): Blob {
  const normalized = normalizeUserSettings(settings);
  return new Blob([JSON.stringify(normalized, null, 2)], { type: "application/json" });
}

export function parseUserSettingsText(text: string): MinigameUserSettings {
  const parsed = JSON.parse(text);
  return normalizeUserSettings(parsed);
}
