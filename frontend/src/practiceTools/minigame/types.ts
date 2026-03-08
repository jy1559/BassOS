export type GameId = "FBH" | "RC" | "LM";
export type GameTab = GameId;
export type AppTab = "GAME" | "THEORY" | "SETTINGS";
export type TabView = "HOME" | "PLAY";

export type GameMode = "PRACTICE" | "CHALLENGE";

export type ChallengeSignal = {
  running: boolean;
  remainingSec: number;
  token: number;
  durationSec: number;
};

export type GameMetrics = {
  score: number;
  accuracy?: number;
  detail?: Record<string, unknown>;
};

export type MinigameConfig = {
  challenge_seconds: number;
  tick: {
    beat: number;
    measure: number;
  };
  fretboard: {
    max_visible_fret: number;
  };
  difficulties: Record<GameId, string[]>;
  rhythm_windows_ms: Record<string, number>;
  rhythm: {
    preroll_beats: number;
    challenge_problem_count: number;
    challenge_attempts_per_problem: number;
    calibration: {
      bpm: number;
      capture_sec: number;
      rank_std_ms: Record<string, number>;
    };
  };
  rhythm_templates: Record<string, RhythmTemplate[]>;
  scale_rules: Record<
    string,
    {
      name_ko?: string;
      intervals: number[];
      group?: string;
      description_ko?: string;
      mood_ko?: string;
      usage_ko?: string;
      degree_labels?: string[];
      stable_degrees?: string[];
      avoid_degrees?: string[];
      teaching_family?: string;
    }
  >;
  chord_qualities: Record<
    string,
    {
      intervals: number[];
      name_ko?: string;
      group?: string;
      description_ko?: string;
      mood_ko?: string;
      usage_ko?: string;
      degree_labels?: string[];
      stable_degrees?: string[];
      avoid_degrees?: string[];
      teaching_family?: string;
    }
  >;
};

export type RhythmEventKind = "HIT" | "GHOST" | "REST";
export type RhythmEventLane = "LOW" | "MID" | "OCTAVE";

export type RhythmEvent = {
  start: number;
  dur: number;
  kind: RhythmEventKind;
  lane?: RhythmEventLane;
  displayKey?: string;
  tieToNext?: boolean;
  dot?: boolean;
  tuplet?: number;
  accent?: boolean;
  technique?: string;
};

export type RhythmMeasure = {
  events: RhythmEvent[];
};

export type RhythmTemplate = {
  name: string;
  bpm: [number, number];
  measures: RhythmMeasure[];
};

export type MinigameRecord = {
  record_id: string;
  created_at: string;
  game: GameId;
  mode: "CHALLENGE";
  difficulty: string;
  score: number;
  accuracy: number;
  seed: string;
  duration_sec: number;
  share_text: string;
  detail_json: Record<string, unknown>;
  source: string;
};

export type RecordPeriod = "ALL" | "D30" | "TODAY";

export type MinigameStats = {
  summary: {
    plays: number;
    avg_score: number;
    best_score: number;
    avg_accuracy: number;
    avg_duration_sec: number;
  };
  trend: Array<{
    record_id: string;
    created_at: string;
    score: number;
    difficulty: string;
  }>;
  detail: Record<string, unknown>;
};

export type RCCalibrationProfile = {
  avg_offset_ms: number;
  std_ms: number;
  rank: string;
  captured_at: string;
};

export type RCChallengeState = {
  problemIndex: number;
  attemptsLeft: number;
  clearedCount: number;
  totalPerfect: number;
  totalGood: number;
  totalMiss: number;
  elapsedSec: number;
};

export type AppSettings = {
  ui?: {
    default_theme?: string;
    language?: string;
  };
  minigame?: {
    challenge_seconds?: number;
  };
};
