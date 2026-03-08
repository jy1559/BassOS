import type { RhythmGrade } from "../common/scoring";
import type { RhythmEvent, RhythmMeasure, RhythmTemplate } from "../../types/models";
import type { SeededRng } from "../common/seed";

export type ExpectedOnset = {
  id: string;
  tick: number;
  kind: "HIT" | "GHOST";
};

export type RhythmPattern = {
  name: string;
  bpm: number;
  measures: RhythmMeasure[];
  expected: ExpectedOnset[];
  totalTicks: number;
};

export type QueuedOnset = ExpectedOnset & {
  index: number;
  idealMs: number;
  judgeMs: number;
  earlyMs: number;
  lateMs: number;
};

export type QueueOnsetStatus = "PENDING" | "PERFECT" | "GOOD" | "MISS";

export type QueueCursor = {
  nextPendingIndex: number;
  matchedCount: number;
  strayInputs: number;
  dirty: boolean;
  results: Array<{
    status: QueueOnsetStatus;
    diffMs: number | null;
    wrongType: boolean;
    consumedAtMs: number | null;
  }>;
};

export type QueueInputOutcome = {
  type: RhythmGrade | "WRONG_TYPE" | "STRAY";
  onset: QueuedOnset | null;
  diffMs: number | null;
  missedIndices: number[];
};

export const TICK_PER_BEAT = 48;
export const TICK_PER_MEASURE = 192;

export function buildExpectedOnsetId(tick: number, kind: ExpectedOnset["kind"]): string {
  return `onset-${tick}-${kind.toLowerCase()}`;
}

function cloneMeasure(measure: RhythmMeasure): RhythmMeasure {
  return {
    events: measure.events.map((event) => ({ ...event })),
  };
}

type BassDisplayPalette = {
  walk: string[];
  rootIndex: number;
  lowCeiling: number;
  midCeiling: number;
  octaveIndex: number;
  turnaroundIndex: number;
};

const BASS_DISPLAY_PALETTES: BassDisplayPalette[] = [
  {
    walk: ["e/2", "g/2", "a/2", "b/2", "d/3", "e/3", "g/3", "a/3"],
    rootIndex: 0,
    lowCeiling: 2,
    midCeiling: 5,
    octaveIndex: 5,
    turnaroundIndex: 4,
  },
  {
    walk: ["a/2", "b/2", "c/3", "d/3", "e/3", "g/3", "a/3"],
    rootIndex: 0,
    lowCeiling: 2,
    midCeiling: 4,
    octaveIndex: 6,
    turnaroundIndex: 4,
  },
  {
    walk: ["d/2", "e/2", "g/2", "a/2", "c/3", "d/3", "f/3", "g/3"],
    rootIndex: 0,
    lowCeiling: 2,
    midCeiling: 5,
    octaveIndex: 5,
    turnaroundIndex: 4,
  },
  {
    walk: ["g/2", "a/2", "b/2", "d/3", "e/3", "g/3", "a/3"],
    rootIndex: 0,
    lowCeiling: 2,
    midCeiling: 4,
    octaveIndex: 5,
    turnaroundIndex: 4,
  },
];

function clampIndex(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function findDisplayIndex(palette: BassDisplayPalette, displayKey: string | undefined): number {
  const index = displayKey ? palette.walk.indexOf(displayKey) : -1;
  return index >= 0 ? index : palette.rootIndex;
}

function laneFromDisplayIndex(
  palette: BassDisplayPalette,
  displayIndex: number
): "LOW" | "MID" | "OCTAVE" {
  if (displayIndex <= palette.lowCeiling) return "LOW";
  if (displayIndex >= palette.octaveIndex) return "OCTAVE";
  return "MID";
}

function pickLaneDisplayIndex(
  lane: "LOW" | "MID" | "OCTAVE",
  palette: BassDisplayPalette,
  baseIndex: number,
  accent: boolean
): number {
  if (lane === "LOW") {
    return accent
      ? palette.rootIndex
      : clampIndex(baseIndex, palette.rootIndex, palette.lowCeiling);
  }
  if (lane === "MID") {
    return clampIndex(baseIndex, palette.lowCeiling, palette.midCeiling);
  }
  return clampIndex(baseIndex, palette.octaveIndex, palette.walk.length - 1);
}

function applyBassLineDisplay(measures: RhythmMeasure[], rng: SeededRng, difficulty: string) {
  const palette = rng.pick(BASS_DISPLAY_PALETTES);
  const rank = difficultyRank(difficulty);
  let currentIndex = palette.rootIndex;
  let direction = rng.bool(0.5) ? 1 : -1;
  let tieEndTick = -1;
  let tieDisplayKey: string | null = null;

  for (let measureIndex = 0; measureIndex < measures.length; measureIndex += 1) {
    const baseTick = measureIndex * TICK_PER_MEASURE;
    const events = [...(measures[measureIndex]?.events ?? [])].sort((a, b) => a.start - b.start);

    if (measureIndex > 0 && rng.bool(0.56)) {
      direction *= -1;
    }

    for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
      const event = events[eventIndex];
      if (event.kind === "REST") continue;

      const absTick = baseTick + event.start;
      let nextIndex = currentIndex;

      if (event.displayKey) {
        nextIndex = findDisplayIndex(palette, event.displayKey);
      } else if (tieEndTick === absTick && tieDisplayKey) {
        nextIndex = findDisplayIndex(palette, tieDisplayKey);
      } else if (event.kind === "GHOST") {
        nextIndex = clampIndex(currentIndex - direction, palette.rootIndex, palette.midCeiling);
      } else if (event.lane === "OCTAVE") {
        nextIndex = palette.octaveIndex + ((eventIndex + measureIndex) % 2);
      } else if (event.accent || event.start === 0) {
        nextIndex = event.lane === "MID"
          ? palette.turnaroundIndex
          : measureIndex % 2 === 0
            ? palette.rootIndex
            : Math.min(palette.lowCeiling, palette.rootIndex + 1);
      } else if (event.start === 96) {
        nextIndex = rank >= 4 && rng.bool(0.45)
          ? palette.turnaroundIndex
          : Math.min(palette.midCeiling, palette.rootIndex + 2);
      } else if (event.dur >= TICK_PER_BEAT) {
        nextIndex = rng.bool(0.5) ? palette.turnaroundIndex : palette.rootIndex;
      } else if (event.lane) {
        nextIndex = pickLaneDisplayIndex(event.lane, palette, currentIndex + direction, false);
      } else {
        const leap = rank >= 4 && rng.bool(0.28) ? direction * 2 : direction;
        nextIndex = clampIndex(currentIndex + leap, palette.rootIndex, palette.walk.length - 1);
      }

      if (event.lane) {
        nextIndex = pickLaneDisplayIndex(event.lane, palette, nextIndex, Boolean(event.accent));
      }

      nextIndex = clampIndex(nextIndex, palette.rootIndex, palette.walk.length - 1);
      if (nextIndex <= palette.rootIndex || nextIndex >= palette.walk.length - 1) {
        direction *= -1;
      }

      event.displayKey = palette.walk[nextIndex];
      if (!event.lane) {
        event.lane = laneFromDisplayIndex(palette, nextIndex);
      }

      currentIndex = nextIndex;
      if (event.tieToNext) {
        tieEndTick = absTick + event.dur;
        tieDisplayKey = event.displayKey;
      } else {
        tieEndTick = -1;
        tieDisplayKey = null;
      }
    }

    if (measureIndex < measures.length - 1 && tieEndTick < 0 && rng.bool(0.42)) {
      currentIndex = clampIndex(
        palette.rootIndex + (measureIndex % 2 === 0 ? 2 : 1),
        palette.rootIndex,
        palette.midCeiling
      );
    }
  }
}

function pickTemplates(templatesByDifficulty: Record<string, RhythmTemplate[]>, difficulty: string): RhythmTemplate[] {
  const key = difficulty.toLowerCase();
  if (templatesByDifficulty[key]?.length) return templatesByDifficulty[key] ?? [];
  if (key === "very_hard" && templatesByDifficulty.hard?.length) return templatesByDifficulty.hard;
  if (key === "master" && templatesByDifficulty.hard?.length) return templatesByDifficulty.hard;
  if (templatesByDifficulty.normal?.length) return templatesByDifficulty.normal;
  if (templatesByDifficulty.easy?.length) return templatesByDifficulty.easy;
  return [];
}

function difficultyRank(difficulty: string): number {
  const diff = difficulty.toUpperCase();
  if (diff === "EASY") return 1;
  if (diff === "NORMAL") return 2;
  if (diff === "HARD") return 3;
  if (diff === "VERY_HARD") return 4;
  return 5;
}

function splitEvent(source: RhythmEvent, firstDur: number, secondDur: number, tie = false): [RhythmEvent, RhythmEvent] {
  return [
    {
      ...source,
      dur: firstDur,
      tieToNext: tie,
    },
    {
      ...source,
      start: source.start + firstDur,
      dur: secondDur,
      tieToNext: false,
    },
  ];
}

function addGhostVariation(events: RhythmEvent[], rng: SeededRng, rank: number) {
  if (!rng.bool(0.40 + rank * 0.04)) return;
  const candidates = events.filter((item) => item.kind === "HIT" && item.start % 24 !== 0);
  if (!candidates.length) return;
  const first = rng.pick(candidates);
  first.kind = "GHOST";

  if (rank >= 4 && candidates.length > 1 && rng.bool(0.32)) {
    const secondPool = candidates.filter((item) => item !== first && item.kind === "HIT");
    if (secondPool.length) {
      rng.pick(secondPool).kind = "GHOST";
    }
  }
}

function addSplitVariation(events: RhythmEvent[], rng: SeededRng, rank: number) {
  if (!rng.bool(0.26 + rank * 0.03)) return;
  const idx = events.findIndex((item) => item.kind !== "REST" && item.dur === 48);
  if (idx < 0) return;
  const [a, b] = splitEvent(events[idx], 24, 24, false);
  events.splice(idx, 1, a, b);
}

function addDottedVariation(events: RhythmEvent[], rng: SeededRng, rank: number) {
  if (rank < 2 || !rng.bool(0.40)) return;
  const idx = events.findIndex((item, i) => {
    if (i >= events.length - 1) return false;
    const next = events[i + 1];
    if (item.kind === "REST" || next.kind === "REST") return false;
    if (item.dur !== 24 || next.dur !== 24) return false;
    return next.start === item.start + 24;
  });
  if (idx < 0) return;
  events[idx].dur = 36;
  events[idx].dot = true;
  events[idx].tieToNext = false;
  events[idx + 1].start = events[idx].start + 36;
  events[idx + 1].dur = 12;
  events[idx + 1].dot = false;
}

function addOffbeatRestVariation(events: RhythmEvent[], rng: SeededRng, rank: number) {
  if (rank < 3 || !rng.bool(0.28 + rank * 0.02)) return;
  const idx = events.findIndex((item) => item.kind === "HIT" && item.dur === 48);
  if (idx < 0) return;
  const source = events[idx];
  const offbeatHit = rng.bool(0.65);
  const replacement: RhythmEvent[] = [
    {
      ...source,
      dur: 24,
      kind: offbeatHit ? "REST" : source.kind,
      tieToNext: false,
      dot: false,
      tuplet: undefined,
    },
    {
      ...source,
      start: source.start + 24,
      dur: 24,
      kind: offbeatHit ? source.kind : "REST",
      tieToNext: false,
      dot: false,
      tuplet: undefined,
    },
  ];
  events.splice(idx, 1, ...replacement);
}

function addTripletVariation(events: RhythmEvent[], rng: SeededRng, rank: number) {
  if (rank < 4 || !rng.bool(0.44)) return;
  const idx = events.findIndex((item) => item.kind !== "REST" && item.dur === 48);
  if (idx < 0) return;
  const base = events[idx];
  const triplet: RhythmEvent[] = [
    { ...base, dur: 16, tuplet: 3, tieToNext: false },
    { ...base, start: base.start + 16, dur: 16, tuplet: 3, tieToNext: false },
    { ...base, start: base.start + 32, dur: 16, tuplet: 3, tieToNext: false },
  ];
  events.splice(idx, 1, ...triplet);
}

function addAnticipationVariation(events: RhythmEvent[], rng: SeededRng, rank: number) {
  if (rank < 4 || !rng.bool(0.24 + rank * 0.02)) return;
  const idx = events.findIndex((item, i) => {
    if (i >= events.length - 1) return false;
    const next = events[i + 1];
    return item.kind === "REST" && item.dur === 48 && next.kind !== "REST";
  });
  if (idx < 0) return;
  const rest = events[idx];
  const next = events[idx + 1];
  const anticipationKind = next.kind === "GHOST" ? "GHOST" : rng.bool(0.35) ? "GHOST" : "HIT";
  events.splice(
    idx,
    1,
    {
      ...rest,
      dur: 24,
      kind: "REST",
      tieToNext: false,
      dot: false,
      tuplet: undefined,
    },
    {
      ...rest,
      start: rest.start + 24,
      dur: 24,
      kind: anticipationKind,
      tieToNext: false,
      dot: false,
      tuplet: undefined,
    }
  );
}

function addTieAcrossBeat(events: RhythmEvent[], rng: SeededRng, rank: number) {
  if (rank < 3 || !rng.bool(0.34)) return;
  const idx = events.findIndex((item) => {
    if (item.kind === "REST") return false;
    if (item.dur < 24) return false;
    const beatEnd = (Math.floor(item.start / TICK_PER_BEAT) + 1) * TICK_PER_BEAT;
    return beatEnd > item.start && beatEnd < item.start + item.dur;
  });
  if (idx < 0) return;
  const source = events[idx];
  const beatEnd = (Math.floor(source.start / TICK_PER_BEAT) + 1) * TICK_PER_BEAT;
  const firstDur = beatEnd - source.start;
  const secondDur = source.dur - firstDur;
  if (firstDur <= 0 || secondDur <= 0) return;
  const [a, b] = splitEvent(source, firstDur, secondDur, true);
  events.splice(idx, 1, a, b);
}

function normalizeEvents(events: RhythmEvent[]) {
  for (const event of events) {
    if (!event.dot) delete event.dot;
    if (!event.tuplet) delete event.tuplet;
    if (!event.tieToNext) delete event.tieToNext;
  }
}

function mutateMeasure(measure: RhythmMeasure, rng: SeededRng, difficulty: string) {
  const events = [...measure.events].sort((a, b) => a.start - b.start);
  const rank = difficultyRank(difficulty);
  if (!events.length) return;

  addGhostVariation(events, rng, rank);
  addSplitVariation(events, rng, rank);
  addDottedVariation(events, rng, rank);
  addOffbeatRestVariation(events, rng, rank);
  addTripletVariation(events, rng, rank);
  addAnticipationVariation(events, rng, rank);
  addTieAcrossBeat(events, rng, rank);

  events.sort((a, b) => a.start - b.start);
  normalizeEvents(events);
  measure.events = events;
}

export function buildPattern(
  templatesByDifficulty: Record<string, RhythmTemplate[]>,
  difficulty: string,
  rng: SeededRng
): RhythmPattern {
  const list = pickTemplates(templatesByDifficulty, difficulty);
  const selected = list.length
    ? rng.pick(list)
    : {
        name: "fallback",
        bpm: [80, 100] as [number, number],
        measures: [{ events: [] }],
      };

  const bpmMin = selected.bpm?.[0] ?? 80;
  const bpmMax = selected.bpm?.[1] ?? 100;
  const bpm = rng.int(bpmMin, bpmMax);

  const baseMeasures = selected.measures?.length ? selected.measures : [{ events: [] }];
  const measures: RhythmMeasure[] = [];
  for (let i = 0; i < 4; i += 1) {
    const source = cloneMeasure(baseMeasures[i % baseMeasures.length]);
    mutateMeasure(source, rng, difficulty);
    measures.push(source);
  }

  applyBassLineDisplay(measures, rng, difficulty);

  const expected = buildExpectedOnsets(measures);
  return {
    name: selected.name,
    bpm,
    measures,
    expected,
    totalTicks: TICK_PER_MEASURE * 4,
  };
}

export function buildExpectedOnsets(measures: RhythmMeasure[]): ExpectedOnset[] {
  const expected: ExpectedOnset[] = [];
  let previousTieEndTick = -1;

  for (let measureIndex = 0; measureIndex < measures.length; measureIndex += 1) {
    const base = measureIndex * TICK_PER_MEASURE;
    const events = [...(measures[measureIndex]?.events ?? [])].sort((a, b) => a.start - b.start);

    for (const event of events) {
      const absTick = base + event.start;
      const isTiedTarget = previousTieEndTick === absTick;
      if (event.kind !== "REST" && !isTiedTarget) {
        expected.push({
          id: buildExpectedOnsetId(absTick, event.kind),
          tick: absTick,
          kind: event.kind,
        });
      }
      previousTieEndTick = event.tieToNext ? absTick + event.dur : -1;
    }
  }

  return expected;
}

export function tickToMs(tick: number, bpm: number): number {
  return (tick / TICK_PER_BEAT) * (60000 / bpm);
}

export function msToTick(ms: number, bpm: number): number {
  return (ms / (60000 / bpm)) * TICK_PER_BEAT;
}

export function patternDurationMs(pattern: RhythmPattern): number {
  return tickToMs(pattern.totalTicks, pattern.bpm);
}

export function buildQueuedOnsets(pattern: RhythmPattern, windowMs: number, timingOffsetMs = 0): QueuedOnset[] {
  return pattern.expected.map((onset, index) => {
    const idealMs = tickToMs(onset.tick, pattern.bpm);
    const judgeMs = idealMs + timingOffsetMs;
    return {
      ...onset,
      index,
      idealMs,
      judgeMs,
      earlyMs: judgeMs - windowMs,
      lateMs: judgeMs + windowMs,
    };
  });
}

export function createQueueCursor(onsets: QueuedOnset[]): QueueCursor {
  return {
    nextPendingIndex: 0,
    matchedCount: 0,
    strayInputs: 0,
    dirty: false,
    results: onsets.map(() => ({
      status: "PENDING",
      diffMs: null,
      wrongType: false,
      consumedAtMs: null,
    })),
  };
}

function consumeMiss(cursor: QueueCursor, onset: QueuedOnset, diffMs: number | null, consumedAtMs: number, wrongType = false) {
  const result = cursor.results[onset.index];
  if (result.status !== "PENDING") return;
  cursor.results[onset.index] = {
    status: "MISS",
    diffMs,
    wrongType,
    consumedAtMs,
  };
  cursor.dirty = true;
  if (cursor.nextPendingIndex === onset.index) {
    cursor.nextPendingIndex += 1;
  }
}

export function markOverdueOnsets(onsets: QueuedOnset[], cursor: QueueCursor, relativeMs: number): number[] {
  const missedIndices: number[] = [];
  while (cursor.nextPendingIndex < onsets.length) {
    const onset = onsets[cursor.nextPendingIndex];
    if (relativeMs <= onset.lateMs) break;
    consumeMiss(cursor, onset, null, relativeMs, false);
    missedIndices.push(onset.index);
  }
  return missedIndices;
}

export function getActiveQueuedOnset(onsets: QueuedOnset[], cursor: QueueCursor, relativeMs: number): QueuedOnset | null {
  for (let index = cursor.nextPendingIndex; index < onsets.length; index += 1) {
    const onset = onsets[index];
    const result = cursor.results[index];
    if (result.status !== "PENDING") continue;
    if (relativeMs < onset.earlyMs) return null;
    if (relativeMs <= onset.lateMs) return onset;
  }
  return null;
}

export function judgeQueuedInput(
  onsets: QueuedOnset[],
  cursor: QueueCursor,
  relativeMs: number,
  kind: ExpectedOnset["kind"],
  classifyGrade: (diffMs: number, windowMs: number) => RhythmGrade,
  windowMs: number
): QueueInputOutcome {
  const missedIndices = markOverdueOnsets(onsets, cursor, relativeMs);
  const onset = getActiveQueuedOnset(onsets, cursor, relativeMs);

  if (!onset) {
    cursor.strayInputs += 1;
    cursor.dirty = true;
    return {
      type: "STRAY",
      onset: null,
      diffMs: null,
      missedIndices,
    };
  }

  const diffMs = relativeMs - onset.judgeMs;
  if (onset.kind !== kind) {
    consumeMiss(cursor, onset, diffMs, relativeMs, true);
    return {
      type: "WRONG_TYPE",
      onset,
      diffMs,
      missedIndices,
    };
  }

  const grade = classifyGrade(diffMs, windowMs);
  cursor.results[onset.index] = {
    status: grade === "MISS" ? "MISS" : grade,
    diffMs,
    wrongType: false,
    consumedAtMs: relativeMs,
  };
  cursor.nextPendingIndex = onset.index + 1;
  if (grade === "MISS") {
    cursor.dirty = true;
  } else {
    cursor.matchedCount += 1;
  }

  return {
    type: grade,
    onset,
    diffMs,
    missedIndices,
  };
}

export function isQueueComplete(onsets: QueuedOnset[], cursor: QueueCursor): boolean {
  return cursor.results.length === onsets.length && cursor.results.every((result) => result.status !== "PENDING");
}

export function isQueueCleared(onsets: QueuedOnset[], cursor: QueueCursor): boolean {
  return onsets.length > 0 && cursor.matchedCount === onsets.length && cursor.strayInputs === 0 && !cursor.dirty;
}
