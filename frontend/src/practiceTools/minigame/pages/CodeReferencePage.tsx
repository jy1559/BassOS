import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { getConfig } from "../api";
import { TheoryStaff, type TheoryStaffNote } from "../components/TheoryStaff";
import { playFretMidi, playFretMidiGroup } from "../games/common/audio";
import { cellToMidi, cellToPc, type Cell } from "../games/common/music";
import { FretboardCanvas, type FretboardMarker } from "../games/fretboard/FretboardCanvas";
import type { MinigameConfig } from "../types/models";
import type { MinigameUserSettings } from "../userSettings";

type Props = {
  userSettings: MinigameUserSettings;
  onOpenSettings?: () => void;
};

type TheoryMode = "NOTE" | "CHORD" | "SCALE";
type StaffClef = "TREBLE" | "BASS";
type NoteOctaveFilter = "ALL" | 1 | 2 | 3 | 4 | 5;

type RuleItem = {
  key: string;
  name_ko?: string;
  group?: string;
  description_ko?: string;
  mood_ko?: string;
  usage_ko?: string;
  intervals: number[];
  degree_labels?: string[];
};

type ToneRow = {
  degree: string;
  note: string;
  semitone: number;
  midi: number;
  isRoot: boolean;
};

type GroupBlock<T> = {
  group: string;
  items: T[];
};

type DetailText = {
  degreeLine: string;
  intervalLine: string;
  description: string;
  mood: string;
  usage: string;
  structureHint: string;
  practiceTip: string;
};

type StoredTheoryState = {
  mode?: TheoryMode;
  clef?: StaffClef;
  rootPc?: number;
  noteOctave?: NoteOctaveFilter | number;
  showFretLabels?: boolean;
  scaleKey?: string;
  chordKey?: string;
  selectedChordGroups?: string[];
  selectedScaleGroups?: string[];
};

type ChordAlias = {
  symbolSuffix: string;
  wordSuffix: string;
  shortName: string;
  fullName: string;
  symbolic: boolean;
};

const NOTE_PCS = Array.from({ length: 12 }, (_, i) => i);
const DEGREE_TABLE = ["1", "b2", "2", "b3", "3", "4", "b5", "5", "b6", "6", "b7", "7"];
const NOTE_NAMES_DISPLAY = ["C", "C#/Db", "D", "D#/Eb", "E", "F", "F#/Gb", "G", "G#/Ab", "A", "A#/Bb", "B"];

const CHORD_GROUP_PRIORITY: Record<string, number> = {
  Triad: 0,
  Seventh: 1,
  Suspended: 2,
  "Added Tone": 3,
  Extended: 4,
  Altered: 5,
};

const SCALE_GROUP_PRIORITY: Record<string, number> = {
  Pentatonic: 0,
  "Diatonic Modes": 1,
  "Minor Variants": 2,
  "Symmetric/Exotic": 3,
};

const GROUP_KO: Record<string, string> = {
  Triad: "기본 트라이어드",
  Seventh: "세븐스",
  Suspended: "서스펜디드",
  "Added Tone": "애드 톤",
  Extended: "확장",
  Altered: "알터드",
  Pentatonic: "펜타토닉",
  "Diatonic Modes": "다이아토닉 모드",
  "Minor Variants": "마이너 계열",
  "Symmetric/Exotic": "대칭/특수",
};

const CHORD_DEFAULT_GROUPS = ["Triad", "Seventh"];
const SCALE_DEFAULT_GROUPS = ["Pentatonic", "Diatonic Modes"];

const CHORD_PRIORITY_IN_GROUP: Record<string, Record<string, number>> = {
  Triad: { maj: 0, min: 1, dim: 2, aug: 3 },
  Seventh: { "7": 0, maj7: 1, m7: 2, m7b5: 3, dim7: 4, mMaj7: 5, "7sus4": 6 },
};

const SCALE_PRIORITY_IN_GROUP: Record<string, Record<string, number>> = {
  Pentatonic: { major_pentatonic: 0, minor_pentatonic: 1, blues: 2 },
};

const THEORY_STATE_KEY = "bassminigame.theory.state.v2";
const NOTE_OCTAVE_VALUES: Array<Exclude<NoteOctaveFilter, "ALL">> = [1, 2, 3, 4, 5];

function pcToDisplayName(pc: number): string {
  return NOTE_NAMES_DISPLAY[((pc % 12) + 12) % 12] ?? "C";
}

function midiToDisplayName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  return `${pcToDisplayName(midi)}${octave}`;
}

function findNearest(values: number[], target: number): number | null {
  if (!values.length) return null;
  let nearest = values[0];
  let nearestGap = Math.abs(nearest - target);
  for (let i = 1; i < values.length; i += 1) {
    const candidate = values[i];
    const gap = Math.abs(candidate - target);
    if (gap < nearestGap || (gap === nearestGap && candidate < nearest)) {
      nearest = candidate;
      nearestGap = gap;
    }
  }
  return nearest;
}

function loadTheoryState(): StoredTheoryState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(THEORY_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredTheoryState;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function saveTheoryState(state: StoredTheoryState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(THEORY_STATE_KEY, JSON.stringify(state));
  } catch {
    // ignore storage failures
  }
}

function normalizeNoteOctave(raw: StoredTheoryState["noteOctave"]): NoteOctaveFilter {
  if (raw === "ALL") return "ALL";
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return "ALL";
  const clamped = Math.max(1, Math.min(5, Math.floor(numeric))) as Exclude<NoteOctaveFilter, "ALL">;
  return clamped;
}

function normalizeKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "").replace(/_/g, "");
}

function chordAliasFromKey(rawKey: string): ChordAlias {
  const key = rawKey.trim();
  const normalized = normalizeKey(key);

  if (normalized === "maj" || normalized === "major" || key === "M") {
    return { symbolSuffix: "", wordSuffix: "major", shortName: "maj", fullName: "major", symbolic: false };
  }
  if (normalized === "min" || normalized === "minor" || key === "m") {
    return { symbolSuffix: "m", wordSuffix: "minor", shortName: "m", fullName: "minor", symbolic: true };
  }
  if (normalized === "dim") return { symbolSuffix: "°", wordSuffix: "dim", shortName: "°", fullName: "diminished", symbolic: true };
  if (normalized === "aug" || normalized === "+") return { symbolSuffix: "+", wordSuffix: "aug", shortName: "+", fullName: "augmented", symbolic: true };
  if (normalized === "7") return { symbolSuffix: "7", wordSuffix: "7", shortName: "7", fullName: "dominant 7", symbolic: true };
  if (normalized === "maj7") return { symbolSuffix: "△7", wordSuffix: "maj7", shortName: "△7", fullName: "major 7", symbolic: true };
  if (normalized === "m7") return { symbolSuffix: "m7", wordSuffix: "m7", shortName: "m7", fullName: "minor 7", symbolic: true };
  if (normalized === "mmaj7" || normalized === "mmmaj7") {
    return { symbolSuffix: "m△7", wordSuffix: "mMaj7", shortName: "m△7", fullName: "minor-major 7", symbolic: true };
  }
  if (normalized === "m7b5") return { symbolSuffix: "ø7", wordSuffix: "m7b5", shortName: "ø7", fullName: "half-diminished 7", symbolic: true };
  if (normalized === "dim7") return { symbolSuffix: "°7", wordSuffix: "dim7", shortName: "°7", fullName: "diminished 7", symbolic: true };
  if (normalized === "sus2") return { symbolSuffix: "sus2", wordSuffix: "sus2", shortName: "sus2", fullName: "suspended2", symbolic: false };
  if (normalized === "sus4") return { symbolSuffix: "sus4", wordSuffix: "sus4", shortName: "sus4", fullName: "suspended4", symbolic: false };
  if (normalized === "7sus4") return { symbolSuffix: "7sus4", wordSuffix: "7sus4", shortName: "7sus4", fullName: "dominant 7 sus4", symbolic: false };
  if (normalized === "add9") return { symbolSuffix: "add9", wordSuffix: "add9", shortName: "add9", fullName: "add9", symbolic: false };
  return { symbolSuffix: key, wordSuffix: key, shortName: key, fullName: key, symbolic: false };
}

function allCells(maxFret: number): Cell[] {
  const out: Cell[] = [];
  for (let string = 0; string < 4; string += 1) {
    for (let fret = 0; fret <= maxFret; fret += 1) out.push({ string, fret });
  }
  return out;
}

function buildToneGrid(count: number): { rows: number; columns: number } {
  const safeCount = Math.max(1, count);
  if (safeCount <= 5) return { rows: 1, columns: safeCount };
  return { rows: 2, columns: Math.ceil(safeCount / 2) };
}

function deriveDegreeLabel(interval: number): string {
  return DEGREE_TABLE[((interval % 12) + 12) % 12] ?? "1";
}

function parseDegreeToken(token: string): { semitone: number; degreeNumber: number } | null {
  const trimmed = token.trim().replace(/\s+/g, "");
  const hit = /^(bb|b|##|#)?(\d{1,2})$/i.exec(trimmed);
  if (!hit) return null;

  const accidental = (hit[1] || "").toLowerCase();
  const degreeNumber = Number(hit[2]);
  if (!Number.isFinite(degreeNumber) || degreeNumber < 1 || degreeNumber > 24) return null;

  const majorOffsets = [0, 2, 4, 5, 7, 9, 11];
  const octave = Math.floor((degreeNumber - 1) / 7);
  const degreeInOctave = ((degreeNumber - 1) % 7) + 1;
  const base = majorOffsets[degreeInOctave - 1] + octave * 12;
  const accidentalOffset = accidental === "bb" ? -2 : accidental === "b" ? -1 : accidental === "#" ? 1 : accidental === "##" ? 2 : 0;
  return { semitone: base + accidentalOffset, degreeNumber };
}

function toDisplayDegree(raw: string, chordKey: string): string {
  if (normalizeKey(chordKey) === "add9" && raw.trim() === "2") return "9";
  return raw;
}

function rootMidiForPc(rootPc: number, clef: StaffClef): number {
  const base = clef === "TREBLE" ? 60 : 48;
  return base + rootPc;
}
function buildToneRows(rootPc: number, mode: "CHORD" | "SCALE", rule: RuleItem | null, clef: StaffClef): ToneRow[] {
  if (!rule) return [];
  const rootMidi = rootMidiForPc(rootPc, clef);
  const out: ToneRow[] = [];

  for (let i = 0; i < rule.intervals.length; i += 1) {
    const interval = rule.intervals[i] ?? 0;
    const fallback = deriveDegreeLabel(interval);
    const rawDegree = rule.degree_labels?.[i] ?? fallback;
    const degree = mode === "CHORD" ? toDisplayDegree(rawDegree, rule.key) : rawDegree;
    const parsed = parseDegreeToken(degree);
    const semitone = parsed ? parsed.semitone : interval;
    out.push({
      degree,
      note: pcToDisplayName(rootPc + semitone),
      semitone,
      midi: rootMidi + semitone,
      isRoot: semitone % 12 === 0 || degree === "1",
    });
  }

  out.sort((a, b) => a.semitone - b.semitone);
  if (mode === "SCALE") {
    out.push({ degree: "8", note: pcToDisplayName(rootPc), semitone: 12, midi: rootMidi + 12, isRoot: false });
  }
  return out;
}

function byRulePriority(a: RuleItem, b: RuleItem, groupPriority: Record<string, number>, itemPriorityByGroup: Record<string, Record<string, number>>): number {
  const groupAKey = a.group || "기타";
  const groupBKey = b.group || "기타";
  const groupA = groupPriority[groupAKey] ?? 99;
  const groupB = groupPriority[groupBKey] ?? 99;
  if (groupA !== groupB) return groupA - groupB;

  const rankA = itemPriorityByGroup[groupAKey]?.[a.key] ?? 999;
  const rankB = itemPriorityByGroup[groupBKey]?.[b.key] ?? 999;
  if (rankA !== rankB) return rankA - rankB;

  return (a.name_ko || a.key).localeCompare(b.name_ko || b.key, "ko");
}

function groupByGroup(items: RuleItem[], groupPriority: Record<string, number>): GroupBlock<RuleItem>[] {
  const grouped = new Map<string, RuleItem[]>();
  for (const item of items) {
    const group = item.group || "기타";
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group)!.push(item);
  }
  const keys = Array.from(grouped.keys()).sort((a, b) => (groupPriority[a] ?? 99) - (groupPriority[b] ?? 99) || a.localeCompare(b, "ko"));
  return keys.map((group) => ({ group, items: grouped.get(group)! }));
}

function groupLabel(group: string): string {
  return GROUP_KO[group] || group;
}

function cleanChordName(name: string): string {
  return name.replace(/\s*트라이어드/gi, "").replace(/\s*triad/gi, "").trim();
}

function chordItemLabel(item: RuleItem): string {
  const alias = chordAliasFromKey(item.key);
  const displayName = cleanChordName(item.name_ko || item.key);
  if (alias.shortName === alias.fullName) return displayName;
  return `${displayName} (${alias.shortName}, ${alias.fullName})`;
}

function scaleItemLabel(item: RuleItem): string {
  return `${item.name_ko || item.key} (${item.key})`;
}

function keepAtLeastOneGroup(prev: string[], nextGroup: string): string[] {
  if (prev.includes(nextGroup)) {
    if (prev.length <= 1) return prev;
    return prev.filter((group) => group !== nextGroup);
  }
  return [...prev, nextGroup];
}

function joinChordName(root: string, suffix: string): string {
  if (!suffix) return root;
  if (/^[0-9m#b+°ø△]/.test(suffix)) return `${root}${suffix}`;
  return `${root} ${suffix}`;
}

function makeTheoryLabel(rootPc: number, mode: "CHORD" | "SCALE", rule: RuleItem | null): { headline: string; subtitle: string } {
  if (!rule) return { headline: "규칙 선택", subtitle: "" };
  const root = pcToDisplayName(rootPc);
  const group = groupLabel(rule.group || "기타");

  if (mode === "SCALE") {
    return { headline: `${root} ${rule.name_ko || rule.key}`, subtitle: `${group} · ${rule.key}` };
  }

  const alias = chordAliasFromKey(rule.key);
  const symbol = `${root}${alias.symbolSuffix}`.trim();
  const full = joinChordName(root, alias.wordSuffix);
  const showBoth = alias.symbolic && Boolean(alias.symbolSuffix) && symbol !== full;
  return {
    headline: showBoth ? `${symbol} (${full})` : full,
    subtitle: `${cleanChordName(rule.name_ko || rule.key)} · ${group}`,
  };
}

function makeDetailText(currentRule: RuleItem | null, tones: ToneRow[], mode: "CHORD" | "SCALE", rootPc: number): DetailText {
  const degreeLine = tones.map((tone) => `${tone.degree}(${tone.note})`).join(" - ");
  const intervalLine = tones.map((tone) => `${tone.semitone}`).join(", ");
  const rootName = pcToDisplayName(rootPc);

  const structureHint =
    mode === "CHORD"
      ? `${rootName} 기준 1-3(또는 b3)-5 뼈대에 7, 9를 더하면 코드 성격이 분명해집니다.`
      : `${rootName} 기준 반음 구조를 익히면 어떤 키에서도 같은 패턴으로 바로 옮길 수 있습니다.`;

  const practiceTip =
    mode === "CHORD"
      ? "루트와 3도/7도를 먼저 잡고, 마지막에 5도와 텐션을 더하면 훨씬 빠르게 외워집니다."
      : "1도부터 8도까지 도수와 음이름을 함께 말하며 올라가면 패턴 암기가 빨라집니다.";

  return {
    degreeLine: degreeLine || "-",
    intervalLine: intervalLine || "-",
    description: currentRule?.description_ko || "선택한 코드/스케일의 구성 설명",
    mood: currentRule?.mood_ko || "-",
    usage: currentRule?.usage_ko || "-",
    structureHint,
    practiceTip,
  };
}

export function CodeReferencePage({ userSettings, onOpenSettings }: Props) {
  const storedStateRef = useRef<StoredTheoryState | null>(loadTheoryState());
  const stored = storedStateRef.current;

  const [config, setConfig] = useState<MinigameConfig | null>(null);
  const [loading, setLoading] = useState(true);

  const [mode, setMode] = useState<TheoryMode>(() => {
    if (stored?.mode === "NOTE" || stored?.mode === "SCALE") return stored.mode;
    return "CHORD";
  });
  const [clef, setClef] = useState<StaffClef>(stored?.clef === "BASS" ? "BASS" : "TREBLE");
  const [rootPc, setRootPc] = useState(() => Math.max(0, Math.min(11, Math.floor(stored?.rootPc ?? 0))));
  const [noteOctave, setNoteOctave] = useState<NoteOctaveFilter>(() => normalizeNoteOctave(stored?.noteOctave));
  const [showFretLabels, setShowFretLabels] = useState(stored?.showFretLabels ?? true);

  const [scaleKey, setScaleKey] = useState(stored?.scaleKey ?? "");
  const [chordKey, setChordKey] = useState(stored?.chordKey ?? "maj");

  const [selectedChordGroups, setSelectedChordGroups] = useState<string[]>(
    Array.isArray(stored?.selectedChordGroups) && stored.selectedChordGroups.length ? stored.selectedChordGroups : CHORD_DEFAULT_GROUPS
  );
  const [selectedScaleGroups, setSelectedScaleGroups] = useState<string[]>(
    Array.isArray(stored?.selectedScaleGroups) && stored.selectedScaleGroups.length ? stored.selectedScaleGroups : SCALE_DEFAULT_GROUPS
  );
  const [showGroupPanel, setShowGroupPanel] = useState(false);
  const prevModeRef = useRef<TheoryMode | null>(null);

  const [viewportH, setViewportH] = useState(() => window.innerHeight);
  const groupPanelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const boot = async () => {
      setLoading(true);
      try {
        const next = await getConfig();
        setConfig(next);
      } finally {
        setLoading(false);
      }
    };
    void boot();
  }, []);

  useEffect(() => {
    const onResize = () => setViewportH(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!showGroupPanel) return;
    const onDown = (event: MouseEvent) => {
      const node = groupPanelRef.current;
      if (!node) return;
      if (node.contains(event.target as Node)) return;
      setShowGroupPanel(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showGroupPanel]);

  useEffect(() => {
    setShowGroupPanel(false);
  }, [mode]);

  useEffect(() => {
    if (mode === "NOTE" && prevModeRef.current !== "NOTE") {
      setClef("BASS");
    }
    prevModeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    saveTheoryState({
      mode,
      clef,
      rootPc,
      noteOctave,
      showFretLabels,
      scaleKey,
      chordKey,
      selectedChordGroups,
      selectedScaleGroups,
    });
  }, [chordKey, clef, mode, noteOctave, rootPc, scaleKey, selectedChordGroups, selectedScaleGroups, showFretLabels]);

  const scaleItems = useMemo<RuleItem[]>(
    () =>
      config
        ? Object.entries(config.scale_rules).map(([key, item]) => ({
            key,
            name_ko: item.name_ko || key,
            group: item.group,
            description_ko: item.description_ko,
            mood_ko: item.mood_ko,
            usage_ko: item.usage_ko,
            intervals: item.intervals,
            degree_labels: item.degree_labels,
          }))
        : [],
    [config]
  );

  const chordItems = useMemo<RuleItem[]>(
    () =>
      config
        ? Object.entries(config.chord_qualities).map(([key, item]) => ({
            key,
            name_ko: item.name_ko || key,
            group: item.group,
            description_ko: item.description_ko,
            mood_ko: item.mood_ko,
            usage_ko: item.usage_ko,
            intervals: item.intervals,
            degree_labels: item.degree_labels,
          }))
        : [],
    [config]
  );

  const sortedScales = useMemo(
    () => [...scaleItems].sort((a, b) => byRulePriority(a, b, SCALE_GROUP_PRIORITY, SCALE_PRIORITY_IN_GROUP)),
    [scaleItems]
  );
  const sortedChords = useMemo(
    () => [...chordItems].sort((a, b) => byRulePriority(a, b, CHORD_GROUP_PRIORITY, CHORD_PRIORITY_IN_GROUP)),
    [chordItems]
  );

  const availableChordGroups = useMemo(
    () => Array.from(new Set(sortedChords.map((item) => item.group || "기타"))).sort((a, b) => (CHORD_GROUP_PRIORITY[a] ?? 99) - (CHORD_GROUP_PRIORITY[b] ?? 99)),
    [sortedChords]
  );
  const availableScaleGroups = useMemo(
    () => Array.from(new Set(sortedScales.map((item) => item.group || "기타"))).sort((a, b) => (SCALE_GROUP_PRIORITY[a] ?? 99) - (SCALE_GROUP_PRIORITY[b] ?? 99)),
    [sortedScales]
  );

  useEffect(() => {
    if (!availableChordGroups.length) return;
    setSelectedChordGroups((prev) => {
      const valid = prev.filter((group) => availableChordGroups.includes(group));
      if (valid.length) return valid;
      const defaults = CHORD_DEFAULT_GROUPS.filter((group) => availableChordGroups.includes(group));
      return defaults.length ? defaults : [availableChordGroups[0]];
    });
  }, [availableChordGroups]);

  useEffect(() => {
    if (!availableScaleGroups.length) return;
    setSelectedScaleGroups((prev) => {
      const valid = prev.filter((group) => availableScaleGroups.includes(group));
      if (valid.length) return valid;
      const defaults = SCALE_DEFAULT_GROUPS.filter((group) => availableScaleGroups.includes(group));
      return defaults.length ? defaults : [availableScaleGroups[0]];
    });
  }, [availableScaleGroups]);

  const visibleChords = useMemo(
    () => sortedChords.filter((item) => selectedChordGroups.includes(item.group || "기타")),
    [selectedChordGroups, sortedChords]
  );
  const visibleScales = useMemo(
    () => sortedScales.filter((item) => selectedScaleGroups.includes(item.group || "기타")),
    [selectedScaleGroups, sortedScales]
  );

  useEffect(() => {
    if (!visibleChords.length) return;
    if (!visibleChords.some((item) => item.key === chordKey)) {
      const preferred = visibleChords.find((item) => item.key === "maj");
      setChordKey(preferred?.key || visibleChords[0].key);
    }
  }, [chordKey, visibleChords]);

  useEffect(() => {
    if (!visibleScales.length) return;
    if (!visibleScales.some((item) => item.key === scaleKey)) {
      const preferred = visibleScales.find((item) => item.key === "major_pentatonic");
      setScaleKey(preferred?.key || visibleScales[0].key);
    }
  }, [scaleKey, visibleScales]);

  const currentScale = useMemo(() => visibleScales.find((item) => item.key === scaleKey) ?? null, [scaleKey, visibleScales]);
  const currentChord = useMemo(() => visibleChords.find((item) => item.key === chordKey) ?? null, [chordKey, visibleChords]);
  const currentRule = mode === "CHORD" ? currentChord : mode === "SCALE" ? currentScale : null;

  const groupedVisibleChords = useMemo(() => groupByGroup(visibleChords, CHORD_GROUP_PRIORITY), [visibleChords]);
  const groupedVisibleScales = useMemo(() => groupByGroup(visibleScales, SCALE_GROUP_PRIORITY), [visibleScales]);

  const maxFret = userSettings.fretboard.maxVisibleFret;
  const cells = useMemo(() => allCells(maxFret), [maxFret]);
  const noteMidiByOctave = useMemo(() => {
    const out = new Map<number, number>();
    for (const cell of cells) {
      if (cellToPc(cell) !== rootPc) continue;
      const midi = cellToMidi(cell);
      const octave = Math.floor(midi / 12) - 1;
      const prev = out.get(octave);
      if (prev === undefined || midi < prev) out.set(octave, midi);
    }
    return new Map([...out.entries()].sort((a, b) => a[0] - b[0]));
  }, [cells, rootPc]);
  const noteOctaveOptions = useMemo<Array<Exclude<NoteOctaveFilter, "ALL">>>(() => {
    const values = Array.from(noteMidiByOctave.keys()).filter(
      (octave): octave is Exclude<NoteOctaveFilter, "ALL"> => octave >= 1 && octave <= 5
    );
    return values.length ? values : NOTE_OCTAVE_VALUES;
  }, [noteMidiByOctave]);
  useEffect(() => {
    if (mode !== "NOTE" || noteOctave === "ALL") return;
    if (noteOctaveOptions.includes(noteOctave)) return;
    const nearest = findNearest(noteOctaveOptions, noteOctave);
    const next = nearest ?? noteOctaveOptions[0] ?? 2;
    setNoteOctave(normalizeNoteOctave(next));
  }, [mode, noteOctave, noteOctaveOptions]);
  const selectedNoteMidi = useMemo(() => {
    if (mode !== "NOTE" || noteOctave === "ALL") return null;
    const exact = noteMidiByOctave.get(noteOctave);
    if (exact !== undefined) return exact;
    const nearestOctave = findNearest(noteOctaveOptions, noteOctave);
    if (nearestOctave === null) return null;
    return noteMidiByOctave.get(nearestOctave) ?? null;
  }, [mode, noteMidiByOctave, noteOctave, noteOctaveOptions]);

  const tones = useMemo(() => {
    if (mode === "NOTE") {
      if (noteOctave === "ALL") {
        const rows = noteOctaveOptions
          .map((octave) => ({ octave, midi: noteMidiByOctave.get(octave) }))
          .filter((entry): entry is { octave: Exclude<NoteOctaveFilter, "ALL">; midi: number } => entry.midi !== undefined)
          .map((entry, idx) => ({
            degree: `${entry.octave}옥`,
            note: midiToDisplayName(entry.midi),
            semitone: 0,
            midi: entry.midi,
            isRoot: idx === 0,
          }));
        if (rows.length) return rows as ToneRow[];
      }
      const fallbackMidi = selectedNoteMidi ?? noteMidiByOctave.values().next().value ?? Math.max(24, Math.min(88, (2 + 1) * 12 + rootPc));
      return [
        {
          degree: `${Math.floor(fallbackMidi / 12) - 1}옥`,
          note: midiToDisplayName(fallbackMidi),
          semitone: 0,
          midi: fallbackMidi,
          isRoot: true,
        },
      ] as ToneRow[];
    }
    return buildToneRows(rootPc, mode, currentRule, clef);
  }, [clef, currentRule, mode, noteMidiByOctave, noteOctave, noteOctaveOptions, rootPc, selectedNoteMidi]);

  const toneGrid = useMemo(() => buildToneGrid(tones.length), [tones.length]);
  const toneGridStyle = useMemo<CSSProperties>(
    () => ({
      gridTemplateColumns: `repeat(${toneGrid.columns}, minmax(0, 1fr))`,
      gridTemplateRows: `repeat(${toneGrid.rows}, minmax(0, 1fr))`,
    }),
    [toneGrid.columns, toneGrid.rows]
  );

  const boardHeight = Math.max(156, Math.min(228, Math.floor((viewportH - 306) * 0.5)));

  const markers = useMemo(() => {
    if (mode === "NOTE") {
      if (noteOctave === "ALL") {
        return cells.filter((cell) => cellToPc(cell) === rootPc).map((cell) => ({ cell, kind: "selected" as const }));
      }
      const targetMidi = selectedNoteMidi;
      return cells
        .filter((cell) => cellToPc(cell) === rootPc)
        .map((cell) => ({ cell, kind: targetMidi !== null && cellToMidi(cell) === targetMidi ? ("root_anchor" as const) : ("selected" as const) }));
    }
    if (!currentRule) return [] as FretboardMarker[];

    const out: FretboardMarker[] = [];
    for (const cell of cells) {
      const rel = (cellToPc(cell) - rootPc + 12) % 12;
      if (!currentRule.intervals.includes(rel)) continue;
      out.push({ cell, kind: rel === 0 ? "root_anchor" : "selected" });
    }
    return out;
  }, [cells, currentRule, mode, noteOctave, rootPc, selectedNoteMidi]);

  const labels = useMemo(() => {
    if (!showFretLabels || !tones.length) return [];

    const degreeByPc = new Map<number, string>();
    for (const tone of tones) {
      const pc = ((rootPc + tone.semitone) % 12 + 12) % 12;
      if (!degreeByPc.has(pc)) degreeByPc.set(pc, tone.degree);
    }

    return markers.map((marker) => {
      const pc = cellToPc(marker.cell);
      const base = pcToDisplayName(pc);
      const degree = degreeByPc.get(pc) || "";
      const octaveOnly = String(Math.floor(cellToMidi(marker.cell) / 12) - 1);
      return {
        cell: marker.cell,
        text: mode === "NOTE" ? octaveOnly : `${base}/${degree}`,
        color: marker.kind === "root_anchor" ? "#ffddad" : "#ecf7ff",
      };
    });
  }, [markers, mode, rootPc, showFretLabels, tones]);
  const notePositionSummary = useMemo(() => {
    if (mode !== "NOTE") return "";

    const matchesNote = (cell: Cell) => {
      if (cellToPc(cell) !== rootPc) return false;
      if (noteOctave === "ALL") return true;
      return selectedNoteMidi !== null && cellToMidi(cell) === selectedNoteMidi;
    };

    const perString = [1, 2, 3, 4]
      .map((displayNo) => {
        const stringIdx = 4 - displayNo;
        const frets = cells
          .filter((cell) => cell.string === stringIdx && matchesNote(cell))
          .map((cell) => cell.fret)
          .sort((a, b) => a - b);
        if (!frets.length) return null;
        return `${displayNo}번줄 ${frets.map((fret) => `${fret}프렛`).join(", ")}`;
      })
      .filter((line): line is string => Boolean(line));

    return perString.join(" · ");
  }, [cells, mode, noteOctave, rootPc, selectedNoteMidi]);

  const staffNotes = useMemo<TheoryStaffNote[]>(
    () => tones.map((tone) => ({ note: tone.note, degree: tone.degree, midi: tone.midi, isRoot: tone.isRoot })),
    [tones]
  );

  const title = useMemo(() => {
    if (mode === "NOTE") {
      const noteName = pcToDisplayName(rootPc);
      const octaveLabel = noteOctave === "ALL" ? "전체 옥타브" : `${noteOctave}옥타브`;
      return {
        headline: noteOctave === "ALL" ? `${noteName} (전체)` : selectedNoteMidi !== null ? midiToDisplayName(selectedNoteMidi) : noteName,
        subtitle: `노트 위치 · ${octaveLabel}`,
      };
    }
    return makeTheoryLabel(rootPc, mode, currentRule);
  }, [currentRule, mode, noteOctave, rootPc, selectedNoteMidi]);

  const detailText = useMemo(() => {
    if (mode === "NOTE") {
      const noteName = pcToDisplayName(rootPc);
      const octaveLabel = noteOctave === "ALL" ? "전체 옥타브" : `${noteOctave}옥타브`;
      const noteLine = noteOctave === "ALL" ? `${noteName} (ALL)` : selectedNoteMidi !== null ? midiToDisplayName(selectedNoteMidi) : noteName;
      return {
        degreeLine: noteLine,
        intervalLine: notePositionSummary || "-",
        description: `${noteName} ${octaveLabel} 기준 4현 베이스 지판 위치`,
        mood: "-",
        usage: "지판 암기",
        structureHint: "같은 음은 같은 줄에서 12프렛 간격으로 반복되고, 줄을 하나 올리면 보통 5프렛 차이로 이어집니다.",
        practiceTip: "4번줄부터 1번줄까지 같은 음 위치를 소리 내어 읽으며 12프렛 반복을 함께 묶어 외우세요.",
      } as DetailText;
    }
    return makeDetailText(currentRule, tones, mode, rootPc);
  }, [currentRule, mode, noteOctave, notePositionSummary, rootPc, selectedNoteMidi, tones]);

  const playToneAt = (idx: number) => {
    const midi = tones[idx]?.midi;
    if (midi === undefined) return;
    void playFretMidi(midi, userSettings.fretboard.fretToneVolume);
  };

  const playAll = () => {
    if (!tones.length) return;
    const ordered = [...tones].sort((a, b) => a.midi - b.midi);
    const spreadMs = mode === "NOTE" ? 0 : mode === "CHORD" ? userSettings.theory.chordSpreadMs : userSettings.theory.scaleSpreadMs;
    void playFretMidiGroup(
      ordered.map((tone) => tone.midi),
      userSettings.fretboard.fretToneVolume,
      spreadMs
    );
  };

  const activeGroups = mode === "CHORD" ? availableChordGroups : availableScaleGroups;
  const selectedGroups = mode === "CHORD" ? selectedChordGroups : selectedScaleGroups;
  const rootPcOptions = NOTE_PCS;

  if (loading || !config) {
    return <div className="mg-loading">지판/코드/스케일 로딩 중...</div>;
  }

  return (
    <section className="mg-page mg-theory-page" data-testid="mg-theory-page">
      <header className="card mg-tab-head mg-theory-head-compact">
        <h2>지판/코드/스케일</h2>
        <p className="muted">오선지, 지판, 도수를 함께 보며 바로 소리로 확인할 수 있습니다.</p>
      </header>

      <section className="card mg-theory-main-card">
        <div className="mg-theory-title-wrap">
          <h3 className="mg-theory-title-main">{title.headline}</h3>
          <p className="mg-theory-title-sub">{title.subtitle}</p>
        </div>

        <div className="mg-theory-control-line">
          <div className="mg-theory-mode-inline">
            <button className={`ghost-btn ${mode === "NOTE" ? "active-mini" : ""}`} onClick={() => setMode("NOTE")}>노트</button>
            <button className={`ghost-btn ${mode === "CHORD" ? "active-mini" : ""}`} onClick={() => setMode("CHORD")}>코드</button>
            <button className={`ghost-btn ${mode === "SCALE" ? "active-mini" : ""}`} onClick={() => setMode("SCALE")}>스케일</button>
          </div>

          <div className="mg-theory-picker-inline">
            <label>
              {mode === "NOTE" ? "노트" : "루트"}
              <select value={rootPc} onChange={(event) => setRootPc(Number(event.target.value))}>
                {rootPcOptions.map((pc) => (
                  <option key={`theory-root-${pc}`} value={pc}>
                    {pcToDisplayName(pc)}
                  </option>
                ))}
              </select>
            </label>

            {mode === "CHORD" ? (
              <label className="is-wide">
                코드 선택
                <select value={chordKey} onChange={(event) => setChordKey(event.target.value)}>
                  {groupedVisibleChords.map((groupBlock) => (
                    <optgroup key={`chord-group-${groupBlock.group}`} label={groupLabel(groupBlock.group)}>
                      {groupBlock.items.map((item) => (
                        <option key={`theory-chord-${item.key}`} value={item.key}>
                          {"\u00A0\u00A0"}
                          {chordItemLabel(item)}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
            ) : mode === "SCALE" ? (
              <label className="is-wide">
                스케일 선택
                <select value={scaleKey} onChange={(event) => setScaleKey(event.target.value)}>
                  {groupedVisibleScales.map((groupBlock) => (
                    <optgroup key={`scale-group-${groupBlock.group}`} label={groupLabel(groupBlock.group)}>
                      {groupBlock.items.map((item) => (
                        <option key={`theory-scale-${item.key}`} value={item.key}>
                          {"\u00A0\u00A0"}
                          {scaleItemLabel(item)}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
            ) : (
              <label className="is-wide">
                옥타브
                <select
                  value={String(noteOctave)}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value === "ALL") {
                      setNoteOctave("ALL");
                      return;
                    }
                    setNoteOctave(normalizeNoteOctave(Number(value)));
                  }}
                >
                  <option value="ALL">전체</option>
                  {noteOctaveOptions.map((oct) => (
                    <option key={`note-oct-${oct}`} value={oct}>
                      {oct}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {mode !== "NOTE" ? (
            <div ref={groupPanelRef} className="mg-theory-group-filter">
              <button className={`ghost-btn ${showGroupPanel ? "active-mini" : ""}`} onClick={() => setShowGroupPanel((prev) => !prev)}>
                {mode === "CHORD" ? "코드 그룹 선택" : "스케일 그룹 선택"}
              </button>
              {showGroupPanel ? (
                <div className="mg-theory-group-panel">
                  {activeGroups.map((group) => (
                    <label key={`group-check-${group}`} className="mg-theory-group-check">
                      <input
                        type="checkbox"
                        checked={selectedGroups.includes(group)}
                        onChange={() => {
                          if (mode === "CHORD") {
                            setSelectedChordGroups((prev) => keepAtLeastOneGroup(prev, group));
                          } else {
                            setSelectedScaleGroups((prev) => keepAtLeastOneGroup(prev, group));
                          }
                        }}
                      />
                      <span>{groupLabel(group)}</span>
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <div />
          )}

          <div className="mg-theory-action-row">
            {onOpenSettings ? (
              <button className="ghost-btn" onClick={onOpenSettings}>
                연습 도구 설정
              </button>
            ) : null}
            <button className="primary-btn mg-theory-play-btn" onClick={playAll} disabled={!tones.length}>
              {mode === "NOTE" ? "노트 재생" : "전체 재생"}
            </button>
          </div>
        </div>

        <div className="mg-theory-layout mg-theory-layout-dense">
          <div className="mg-theory-top">
            <TheoryStaff
              notes={staffNotes}
              title={mode === "NOTE" ? "노트 오선지" : `${mode === "CHORD" ? "코드" : "스케일"} 오선지`}
              clef={clef}
              compact
              onNoteClick={(_, idx) => playToneAt(idx)}
            />

            <div className="mg-theory-note-side">
              <div className="mg-theory-note-grid mg-theory-note-grid-side" style={toneGridStyle}>
                {tones.map((tone, toneIndex) => (
                  <article
                    key={`${tone.note}-${tone.degree}-${tone.semitone}-${toneIndex}`}
                    className={`mg-theory-note-card ${tone.isRoot ? "is-root" : ""}`}
                    onClick={() => playToneAt(toneIndex)}
                  >
                    <strong className="mg-theory-note-name">{tone.note}</strong>
                    <span className="mg-theory-note-degree">{tone.degree}</span>
                  </article>
                ))}
              </div>
            </div>
          </div>

          <div className="mg-theory-bottom">
            <FretboardCanvas
              maxFret={maxFret}
              markers={markers}
              cellLabels={labels}
              onCellClick={(cell) => {
                void playFretMidi(cellToMidi(cell), userSettings.fretboard.fretToneVolume);
              }}
              detectMode={userSettings.fretboard.detectMode}
              showHitZones={false}
              showNoteLabels={false}
              fretLineWidth={userSettings.fretboard.fretLineWidth}
              boardPreset={userSettings.fretboard.boardPreset}
              inlayPreset={userSettings.fretboard.inlayPreset}
              height={boardHeight}
            />

            <div className="mg-theory-bottom-meta">
              <div className="mg-theory-explain">
                {mode === "NOTE" ? (
                  <>
                    <p>
                      <strong>노트:</strong> {detailText.degreeLine}
                    </p>
                    <p>
                      <strong>줄/프렛 위치:</strong> {detailText.intervalLine}
                    </p>
                    <p className="muted">{detailText.structureHint} {detailText.practiceTip}</p>
                  </>
                ) : (
                  <>
                    <p>
                      <strong>구성음/도수:</strong> {detailText.degreeLine}
                    </p>
                    <p>
                      <strong>반음 거리:</strong> {detailText.intervalLine}
                    </p>
                    <p>
                      <strong>핵심 성격:</strong> {detailText.description} | <strong>느낌:</strong> {detailText.mood} | <strong>자주 쓰는 곳:</strong> {detailText.usage}
                    </p>
                    <p className="muted">{detailText.structureHint} {detailText.practiceTip}</p>
                  </>
                )}
              </div>

              <div className="mg-theory-right-controls">
                <button className={`ghost-btn ${showFretLabels ? "active-mini" : ""}`} onClick={() => setShowFretLabels((prev) => !prev)}>
                  지판 라벨 {showFretLabels ? "ON" : "OFF"}
                </button>
                <button className={`ghost-btn ${clef === "TREBLE" ? "active-mini" : ""}`} onClick={() => setClef("TREBLE")}>
                  높은음자리표
                </button>
                <button className={`ghost-btn ${clef === "BASS" ? "active-mini" : ""}`} onClick={() => setClef("BASS")}>
                  낮은음자리표
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </section>
  );
}
