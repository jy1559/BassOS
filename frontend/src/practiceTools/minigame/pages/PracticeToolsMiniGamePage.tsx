import { useEffect, useMemo, useRef, useState } from "react";
import { deleteRecord, getConfig, getGameImageUrl, getLeaderboard, getSeed, getStats, postRecord } from "../api";
import { FretboardHuntGame } from "../games/fretboard/FretboardHuntGame";
import { LineMapperGame } from "../games/line_mapper/LineMapperGame";
import { errorTypeLabel, stageStatLabel, type LineMapperStage } from "../games/line_mapper/lineRuleEngine";
import { loadCalibrationProfile } from "../games/rhythm/calibration";
import { RhythmCalibrationPanel } from "../games/rhythm/RhythmCalibrationPanel";
import { RhythmCopyGame } from "../games/rhythm/RhythmCopyGame";
import type {
  GameId,
  GameMetrics,
  GameMode,
  MinigameConfig,
  MinigameRecord,
  MinigameStats,
  RCCalibrationProfile,
  RecordPeriod,
  TabView,
} from "../types/models";
import { RC_DIFFICULTIES, type MinigameUserSettings } from "../userSettings";

const boardPresetOptions: MinigameUserSettings["fretboard"]["boardPreset"][] = ["CLASSIC", "MAPLE", "DARK"];
const inlayPresetOptions: MinigameUserSettings["fretboard"]["inlayPreset"][] = ["DOT", "BLOCK", "TRIANGLE"];
const detectModeOptions: MinigameUserSettings["fretboard"]["detectMode"][] = ["ZONE", "WIRE", "HYBRID"];
const notationModeOptions: MinigameUserSettings["rhythm"]["notationMode"][] = ["BASS_STAFF", "PERCUSSION"];
type TrendWindow = "10" | "30" | "ALL";

const lmPracticeOptions: Array<{ stage: LineMapperStage; label: string; desc: string }> = [
  { stage: "POSITION", label: "코드 음 찾기", desc: "프렛 구간 안 빈칸을 찍으며 구성음을 익힙니다." },
  { stage: "FIX", label: "틀린 지판 찾기", desc: "보기 4개 중 규칙 밖 음이 섞인 지판을 고릅니다." },
  { stage: "COMPLETE", label: "스케일 상/하행 완성", desc: "시작음과 끝음 사이를 순서대로 채웁니다." },
];

type Props = {
  selectedGame: GameId | null;
  onSelectGame: (game: GameId) => void;
  onBackToHub: () => void;
  userSettings: MinigameUserSettings;
  onUserSettingsChange: (next: MinigameUserSettings) => void;
  onOpenUtilityTab: (tab: "THEORY" | "SETTINGS") => void;
};

type ChallengeResultModal = {
  game: GameId;
  score: number;
  accuracy: number;
  correct: number;
  wrong: number;
  ratio: number;
  durationSec: number;
  reason: string;
  share: string;
  detail: Record<string, unknown>;
};

const gameMeta: Record<GameId, { title: string; desc: string }> = {
  FBH: { title: "Fretboard Hunt", desc: "지판에서 목표 음을 빠르게 찾는 훈련" },
  RC: { title: "Rhythm Copy", desc: "들은 리듬을 정확한 타이밍으로 따라치기" },
  LM: { title: "Line Mapper", desc: "한 포지션 안에서 스케일/코드 모양과 도착음을 보고 짧은 라인을 익히는 훈련" },
};

const diffColorClass: Record<string, string> = {
  EASY: "is-easy",
  NORMAL: "is-normal",
  HARD: "is-hard",
  VERY_HARD: "is-very-hard",
  MASTER: "is-master",
};

function buildShareText(game: GameId, difficulty: string, score: number, accuracy: number, seed: string): string {
  if (game === "RC") return `RC|CHALLENGE|${difficulty}|SCORE=${score}|ACC=${Math.round(accuracy)}%|SEED=${seed}`;
  return `${game}|CHALLENGE|${difficulty}|SCORE=${score}|SEED=${seed}`;
}

function mergedDifficultyList(config: MinigameConfig | null, game: GameId): string[] {
  const fromConfig = config?.difficulties?.[game] ?? [];
  const merged = Array.from(new Set([...fromConfig, ...RC_DIFFICULTIES]));
  return merged.length ? merged : RC_DIFFICULTIES;
}

function extractCorrectWrong(game: GameId, metrics: GameMetrics): { correct: number; wrong: number } {
  const detail = (metrics.detail ?? {}) as Record<string, unknown>;
  if (game === "FBH") {
    const correct = Number(detail.hits ?? 0);
    const wrong = Number(detail.wrong ?? Math.max(0, Number(detail.attempts ?? 0) - correct));
    return { correct: Math.max(0, Math.floor(correct)), wrong: Math.max(0, Math.floor(wrong)) };
  }
  if (game === "LM") {
    const correct = Number(detail.correct ?? 0);
    const attempts = Number(detail.attempts ?? 0);
    return { correct: Math.max(0, Math.floor(correct)), wrong: Math.max(0, Math.floor(attempts - correct)) };
  }
  const perfect = Number(detail.perfect ?? 0);
  const good = Number(detail.good ?? 0);
  const miss = Number(detail.miss ?? 0);
  return { correct: Math.max(0, Math.floor(perfect + good)), wrong: Math.max(0, Math.floor(miss)) };
}

function difficultyDescription(game: GameId, diff: string): string {
  const key = diff.toUpperCase();
  const common: Record<string, string> = {
    EASY: "기본 문제 위주로 천천히 정확도를 올리는 단계입니다.",
    NORMAL: "기본 문제에 조건이 조금 늘어나 반응 속도를 함께 보는 단계입니다.",
    HARD: "문제 유형이 섞이기 시작해 빠른 판단과 실수 관리가 필요한 단계입니다.",
    VERY_HARD: "복합 조건 문제가 자주 나와 정확도 유지가 중요한 고난도 단계입니다.",
    MASTER: "여러 유형이 동시에 섞여 가장 빠르고 안정적인 플레이를 요구하는 단계입니다.",
  };
  if (game === "FBH") {
    const fbh: Record<string, string> = {
      EASY: "음 이름 하나를 보고 지판에서 위치를 찾는 기본 문제가 중심입니다.",
      NORMAL: "같은 음을 지정된 프렛 구간 안에서 찾는 문제가 추가됩니다.",
      HARD: "기준 음 주변에서 찾는 문제까지 섞여 반응 속도가 더 중요해집니다.",
      VERY_HARD: "코드에 들어가는 음 고르기와 위치 찾기 문제가 함께 나옵니다.",
      MASTER: "위치 찾기, 주변 찾기, 코드 음 찾기가 모두 섞여 출제됩니다.",
    };
    return fbh[key] ?? common[key] ?? "난이도 설명 없음";
  }
  if (game === "RC") {
    const rc: Record<string, string> = {
      EASY: "단순한 박자 패턴을 듣고 그대로 따라 치는 문제가 중심입니다.",
      NORMAL: "기본 패턴에 변형이 조금 섞인 문제까지 다루는 단계입니다.",
      HARD: "더 빠르고 촘촘한 패턴이 늘어나 타이밍 정확도가 중요해집니다.",
      VERY_HARD: "복잡한 리듬 패턴이 자주 나와 실수 후 복구까지 요구됩니다.",
      MASTER: "짧은 판정 안에서 다양한 패턴을 정확히 재현해야 합니다.",
    };
    return rc[key] ?? common[key] ?? "난이도 설명 없음";
  }
  const lm: Record<string, string> = {
    EASY: "한 포지션 안에서 루트와 기본 도착음을 눈에 익히는 단계입니다.",
    NORMAL: "포켓 안에서 코드톤과 펜타토닉 도착음을 구분하는 단계입니다.",
    HARD: "틀린 착지와 잘못된 연결음을 빠르게 골라내야 하는 단계입니다.",
    VERY_HARD: "도리안/믹솔리디안 같은 모드 안에서 안정음과 경과음을 구분하는 단계입니다.",
    MASTER: "한 포지션 안에서 더 까다로운 도착음 판단과 라인 완성을 빠르게 처리하는 단계입니다.",
  };
  return lm[key] ?? common[key] ?? "난이도 설명 없음";
}

function judgeTypeLabel(key: string): string {
  const map: Record<string, string> = {
    PC: "음 이름 위치 찾기",
    PC_RANGE: "지정 구간 안에서 음 찾기",
    MIDI: "옥타브 포함 음 높이 찾기",
    PC_NEAR: "기준 음 주변 찾기",
    MIDI_NEAR: "옥타브 포함 주변 찾기",
    CODE: "코드 음 찾기",
    CODE_MIDI: "옥타브 포함 코드 음 찾기",
    ROOT_NEAR: "루트 근처 코드 음 찾기",
  };
  return map[key] ?? key;
}

function formatMinute(ts: string): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return ts;
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")} ${`${date.getHours()}`.padStart(2, "0")}:${`${date.getMinutes()}`.padStart(2, "0")}`;
}

function formatSecond(ts: string): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return ts;
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")} ${`${date.getHours()}`.padStart(2, "0")}:${`${date.getMinutes()}`.padStart(2, "0")}:${`${date.getSeconds()}`.padStart(2, "0")}`;
}

function valueNumber(input: unknown, fallback: number): number {
  const n = Number(input);
  return Number.isFinite(n) ? n : fallback;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const normalized = Math.floor(valueNumber(value, fallback));
  return Math.max(min, Math.min(max, normalized));
}

function clampFloat(value: unknown, min: number, max: number, fallback: number): number {
  const normalized = valueNumber(value, fallback);
  return Math.max(min, Math.min(max, normalized));
}

function toRcDifficulty(difficulty: string): (typeof RC_DIFFICULTIES)[number] {
  const key = difficulty.toUpperCase();
  const found = RC_DIFFICULTIES.find((item) => item === key);
  return found ?? "EASY";
}

function deepCloneSettings(settings: MinigameUserSettings): MinigameUserSettings {
  return JSON.parse(JSON.stringify(settings)) as MinigameUserSettings;
}

function numberMapEntries(raw: unknown): Array<{ key: string; value: number }> {
  if (!raw || typeof raw !== "object") return [];
  const src = raw as Record<string, unknown>;
  return Object.entries(src)
    .map(([key, value]) => ({ key, value: Math.max(0, valueNumber(value, 0)) }))
    .sort((a, b) => b.value - a.value);
}

function recordCorrectCount(record: MinigameRecord): number {
  const payload = record.detail_json ?? {};
  const perfect = valueNumber(payload.perfect, 0);
  const good = valueNumber(payload.good, 0);
  const fallbackFromRhythm = perfect + good;
  return Math.max(0, valueNumber(payload.correct, valueNumber(payload.hits, fallbackFromRhythm)));
}

function recordWrongCount(record: MinigameRecord): number {
  const payload = record.detail_json ?? {};
  return Math.max(0, valueNumber(payload.wrong, valueNumber(payload.miss, 0)));
}

export function PracticeToolsMiniGamePage({ selectedGame, onSelectGame, onBackToHub, userSettings, onUserSettingsChange, onOpenUtilityTab }: Props) {
  const [config, setConfig] = useState<MinigameConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [modeByGame, setModeByGame] = useState<Record<GameId, GameMode>>({ FBH: "PRACTICE", RC: "PRACTICE", LM: "PRACTICE" });
  const [viewByGame, setViewByGame] = useState<Record<GameId, TabView>>({ FBH: "HOME", RC: "HOME", LM: "HOME" });
  const [difficultyByGame, setDifficultyByGame] = useState<Record<GameId, string>>({ FBH: "EASY", RC: "EASY", LM: "EASY" });
  const [lmPracticeStage, setLmPracticeStage] = useState<LineMapperStage>("POSITION");
  const [lbDiffByGame, setLbDiffByGame] = useState<Record<GameId, string>>({ FBH: "ALL", RC: "ALL", LM: "ALL" });
  const [periodByGame, setPeriodByGame] = useState<Record<GameId, RecordPeriod>>({ FBH: "ALL", RC: "ALL", LM: "ALL" });
  const [trendWindowByGame, setTrendWindowByGame] = useState<Record<GameId, TrendWindow>>({ FBH: "10", RC: "10", LM: "10" });
  const [soundByGame, setSoundByGame] = useState<Record<"FBH" | "LM", boolean>>({ FBH: true, LM: true });
  const [seedText, setSeedText] = useState("");

  const [metricsByGame, setMetricsByGame] = useState<Record<GameId, GameMetrics>>({ FBH: { score: 0, accuracy: 0 }, RC: { score: 0, accuracy: 0 }, LM: { score: 0, accuracy: 0 } });
  const metricsRef = useRef(metricsByGame);
  const rcChallengeStartRef = useRef(0);

  const [leaderboard, setLeaderboard] = useState<MinigameRecord[]>([]);
  const [stats, setStats] = useState<MinigameStats | null>(null);
  const [loadingDashboard, setLoadingDashboard] = useState(false);
  const [statusByGame, setStatusByGame] = useState<Record<GameId, string>>({ FBH: "준비 완료", RC: "준비 완료", LM: "준비 완료" });

  const [timedChallengeGame, setTimedChallengeGame] = useState<"FBH" | "LM" | null>(null);
  const [timedChallengeToken, setTimedChallengeToken] = useState(0);
  const [timedRemainingSec, setTimedRemainingSec] = useState(120);
  const [timedDurationSec, setTimedDurationSec] = useState(120);
  const [rcChallengeRunning, setRcChallengeRunning] = useState(false);
  const [rcChallengeToken, setRcChallengeToken] = useState(0);
  const [rcRemainingSec, setRcRemainingSec] = useState(120);
  const [rcDurationSec, setRcDurationSec] = useState(120);
  const [challengeResult, setChallengeResult] = useState<ChallengeResultModal | null>(null);
  const timedEndingRef = useRef(false);
  const rcEndingRef = useRef(false);
  const [rcCalibrationProfile, setRcCalibrationProfile] = useState<RCCalibrationProfile | null>(() => loadCalibrationProfile());
  const [isRcCalibrationOpen, setIsRcCalibrationOpen] = useState(false);

  const [detailRecord, setDetailRecord] = useState<MinigameRecord | null>(null);
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<MinigameUserSettings | null>(null);
  const [deletingRecordId, setDeletingRecordId] = useState("");

  const activeGame: GameId = selectedGame ?? "FBH";
  const currentMode = modeByGame[activeGame];
  const currentView = viewByGame[activeGame];
  const currentDifficulty = difficultyByGame[activeGame] || "EASY";
  const difficulties = mergedDifficultyList(config, activeGame);
  const challengeSecondsDefault = config?.challenge_seconds ?? 120;
  const fbhChallengeSeconds = Math.max(10, userSettings.fbh.challenge.timeLimitSec || challengeSecondsDefault);

  const rhythmConfig = useMemo(() => ({
    preroll_beats: userSettings.rhythm.prerollBeats || config?.rhythm?.preroll_beats || 4,
    challenge_problem_count: config?.rhythm?.challenge_problem_count || 5,
    challenge_attempts_per_problem: config?.rhythm?.challenge_attempts_per_problem || 1,
  }), [config, userSettings.rhythm.prerollBeats]);

  const rhythmWindows = { ...(config?.rhythm_windows_ms ?? {}), ...userSettings.rhythm.windowsMs };
  const moveViewFor = (game: GameId, next: TabView) => setViewByGame((prev) => ({ ...prev, [game]: next }));
  const moveView = (next: TabView) => moveViewFor(activeGame, next);

  const refreshDashboard = async (game: GameId, diff: string, period: RecordPeriod) => {
    setLoadingDashboard(true);
    try {
      const [top, stat] = await Promise.all([
        getLeaderboard({ game, difficulty: diff || "ALL", period, limit: 20 }),
        getStats({ game, difficulty: diff || "ALL", period }),
      ]);
      setLeaderboard(top);
      setStats(stat);
    } finally {
      setLoadingDashboard(false);
    }
  };

  const openSettingsModal = () => {
    setSettingsDraft(deepCloneSettings(userSettings));
    setIsSettingsOpen(true);
  };

  const closeSettingsModal = () => {
    setIsSettingsOpen(false);
    setSettingsDraft(null);
  };

  const patchSettingsDraft = (updater: (prev: MinigameUserSettings) => MinigameUserSettings) => {
    setSettingsDraft((prev) => (prev ? updater(prev) : prev));
  };

  const saveSettingsDraft = () => {
    if (!settingsDraft) return;
    onUserSettingsChange(settingsDraft);
    closeSettingsModal();
  };

  const openSettingsTabFromModal = () => {
    if (settingsDraft) {
      onUserSettingsChange(settingsDraft);
    }
    closeSettingsModal();
    onOpenUtilityTab("SETTINGS");
  };

  useEffect(() => {
    metricsRef.current = metricsByGame;
  }, [metricsByGame]);

  useEffect(() => {
    const boot = async () => {
      setLoading(true);
      try {
        const [cfg, seed] = await Promise.all([getConfig(), getSeed()]);
        setConfig(cfg);
        setDifficultyByGame({
          FBH: (cfg.difficulties.FBH?.[0] ?? "EASY").toUpperCase(),
          RC: (cfg.difficulties.RC?.[0] ?? "EASY").toUpperCase(),
          LM: (cfg.difficulties.LM?.[0] ?? "EASY").toUpperCase(),
        });
        setSeedText(seed.seed);
      } finally {
        setLoading(false);
      }
    };
    void boot();
  }, []);

  useEffect(() => {
    if (!config || !selectedGame) return;
    void refreshDashboard(selectedGame, lbDiffByGame[selectedGame], periodByGame[selectedGame]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, selectedGame, lbDiffByGame.FBH, lbDiffByGame.RC, lbDiffByGame.LM, periodByGame.FBH, periodByGame.RC, periodByGame.LM]);

  const saveAndShowResult = async (game: GameId, metrics: GameMetrics, durationSec: number, reason: string) => {
    const score = Math.round(metrics.score || 0);
    const accuracy = Number(metrics.accuracy || 0);
    const { correct, wrong } = extractCorrectWrong(game, metrics);
    const ratio = correct + wrong > 0 ? Number(((correct / (correct + wrong)) * 100).toFixed(1)) : 0;
    const diff = difficultyByGame[game] || "EASY";
    const share = buildShareText(game, diff, score, accuracy, seedText);
    const detailPayload = { ...(metrics.detail ?? {}), reason, correct, wrong, ratio };
    try {
      await postRecord({
        game,
        mode: "CHALLENGE",
        difficulty: diff,
        score,
        accuracy,
        seed: seedText,
        duration_sec: durationSec,
        share_text: share,
        detail_json: detailPayload,
        source: "app",
      });
      setStatusByGame((prev) => ({ ...prev, [game]: `기록 저장 완료: ${share}` }));
      if (selectedGame === game) await refreshDashboard(game, lbDiffByGame[game], periodByGame[game]);
    } catch (error) {
      setStatusByGame((prev) => ({ ...prev, [game]: error instanceof Error ? error.message : "기록 저장 실패" }));
    }
    setChallengeResult({ game, score, accuracy, correct, wrong, ratio, durationSec, reason, share, detail: detailPayload });
  };

  const finalizeTimedChallenge = async (reason: string, metricsOverride?: GameMetrics) => {
    if (!timedChallengeGame || timedEndingRef.current) return;
    timedEndingRef.current = true;
    const game = timedChallengeGame;
    const durationSec = Math.max(1, timedDurationSec);
    setTimedChallengeGame(null);
    setTimedRemainingSec(0);
    try {
      await saveAndShowResult(game, metricsOverride ?? metricsRef.current[game], durationSec, reason);
    } finally {
      timedEndingRef.current = false;
    }
  };

  const finalizeRcChallenge = async (reason: string, metricsOverride?: GameMetrics, durationSecOverride?: number) => {
    if (!rcChallengeRunning || rcEndingRef.current) return;
    rcEndingRef.current = true;
    setRcChallengeRunning(false);
    setRcRemainingSec(0);
    const durationSec = durationSecOverride !== undefined
      ? Math.max(1, Math.round(durationSecOverride))
      : Math.max(1, Math.round((performance.now() - rcChallengeStartRef.current) / 1000));
    try {
      await saveAndShowResult("RC", metricsOverride ?? metricsRef.current.RC, durationSec, reason);
    } finally {
      rcEndingRef.current = false;
    }
  };

  const startTimedChallengeFor = (game: "FBH" | "LM") => {
    timedEndingRef.current = false;
    const duration = game === "FBH" ? fbhChallengeSeconds : challengeSecondsDefault;
    setTimedChallengeGame(game);
    setTimedChallengeToken((prev) => prev + 1);
    setTimedDurationSec(duration);
    setTimedRemainingSec(duration);
    moveViewFor(game, "PLAY");
    setMetricsByGame((prev) => ({ ...prev, [game]: { score: 0, accuracy: 0 } }));
  };

  const startRcChallenge = () => {
    rcEndingRef.current = false;
    const duration = challengeSecondsDefault;
    rcChallengeStartRef.current = performance.now();
    setRcDurationSec(duration);
    setRcRemainingSec(duration);
    setRcChallengeRunning(true);
    setRcChallengeToken((prev) => prev + 1);
    moveViewFor("RC", "PLAY");
    setMetricsByGame((prev) => ({ ...prev, RC: { score: 0, accuracy: 0 } }));
  };

  const stopActiveChallenge = async () => {
    if (!selectedGame) return;
    if (selectedGame === "RC" && rcChallengeRunning) {
      await finalizeRcChallenge("STOP_BUTTON");
      return;
    }
    if ((selectedGame === "FBH" || selectedGame === "LM") && timedChallengeGame === selectedGame) {
      await finalizeTimedChallenge("STOP_BUTTON");
    }
  };

  const leavePlay = async () => {
    if (!selectedGame) return;
    const challengeActive =
      (selectedGame === "RC" && rcChallengeRunning) ||
      ((selectedGame === "FBH" || selectedGame === "LM") && timedChallengeGame === selectedGame);
    if (challengeActive) {
      await stopActiveChallenge();
      return;
    }
    moveView("HOME");
  };

  useEffect(() => {
    if (!timedChallengeGame) return;
    const timer = window.setInterval(() => {
      setTimedRemainingSec((prev) => {
        if (prev <= 1) {
          window.clearInterval(timer);
          void finalizeTimedChallenge("TIME_UP");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timedChallengeGame, timedDurationSec]);

  useEffect(() => {
    if (!rcChallengeRunning) return;
    const timer = window.setInterval(() => {
      setRcRemainingSec((prev) => {
        if (prev <= 1) {
          window.clearInterval(timer);
          void finalizeRcChallenge("TIME_UP", undefined, rcDurationSec);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rcChallengeRunning, rcDurationSec]);

  useEffect(() => {
    if (!timedChallengeGame) return;
    if (selectedGame === timedChallengeGame) return;
    void finalizeTimedChallenge("GAME_SWITCH");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGame, timedChallengeGame]);

  useEffect(() => {
    if (!rcChallengeRunning) return;
    if (selectedGame === "RC") return;
    void finalizeRcChallenge("GAME_SWITCH");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGame, rcChallengeRunning]);

  useEffect(() => {
    if (!challengeResult) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      moveViewFor(challengeResult.game, "HOME");
      setChallengeResult(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [challengeResult]);

  const deleteRecordById = async (recordId: string) => {
    if (!selectedGame) return;
    if (!window.confirm("이 기록을 영구 삭제할까요?")) return;
    setDeletingRecordId(recordId);
    try {
      await deleteRecord(recordId);
      setDetailRecord((prev) => (prev?.record_id === recordId ? null : prev));
      await refreshDashboard(selectedGame, lbDiffByGame[selectedGame], periodByGame[selectedGame]);
    } finally {
      setDeletingRecordId("");
    }
  };

  if (loading || !config) return <div className="mg-loading">미니게임 로딩 중..</div>;

  if (!selectedGame) {
    return (
      <div className="mg-page" data-testid="mg-game-hub">
        <section className="card mg-hub-head">
          <h2>Select a Game</h2>
          <p className="muted">원하는 연습 게임을 선택해 들어가세요.</p>
        </section>
        <section className="mg-game-hub-grid">
          {(Object.keys(gameMeta) as GameId[]).map((game) => (
            <article
              key={game}
              className="card mg-hub-card"
              data-testid={`mg-game-card-${game}`}
              role="button"
              tabIndex={0}
              onClick={() => {
                onSelectGame(game);
                moveViewFor(game, "HOME");
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onSelectGame(game);
                moveViewFor(game, "HOME");
              }}
            >
              <h3 className="mg-hub-title">{gameMeta[game].title}</h3>
              <p className="muted mg-hub-desc">{gameMeta[game].desc}</p>
              <div className="mg-hub-thumb-wrap">
                <img className="mg-hub-thumb" src={getGameImageUrl(game)} alt={`${gameMeta[game].title} preview`} loading="lazy" />
              </div>
              <button
                data-testid={`mg-enter-game-${game}`}
                className="primary-btn"
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectGame(game);
                  moveViewFor(game, "HOME");
                }}
              >
                들어가기
              </button>
            </article>
          ))}
        </section>
      </div>
    );
  }

  const challengeActive =
    (selectedGame === "RC" && rcChallengeRunning) ||
    ((selectedGame === "FBH" || selectedGame === "LM") && timedChallengeGame === selectedGame);
  const challengeDurationLabel = selectedGame === "FBH" ? fbhChallengeSeconds : challengeSecondsDefault;
  const rcChallengeLabel = `${challengeSecondsDefault}s / ${rhythmConfig.challenge_problem_count}문제`;
  const trendWindow = trendWindowByGame[selectedGame];
  const trendItemsRaw = stats?.trend ?? [];
  const trendItems = trendWindow === "10" ? trendItemsRaw.slice(-10) : trendWindow === "30" ? trendItemsRaw.slice(-30) : trendItemsRaw;
  const trendMin = Math.min(0, ...(trendItems.map((item) => item.score) ?? [0]));
  const trendMax = Math.max(0, ...(trendItems.map((item) => item.score) ?? [0]));
  const trendRange = Math.max(1, trendMax - trendMin);
  const trendBaselineY = 100 - ((0 - trendMin) / trendRange) * 100;
  const trendPoints = trendItems.map((item, idx) => {
    const x = trendItems.length <= 1 ? 50 : (idx / (trendItems.length - 1)) * 100;
    const y = 100 - ((item.score - trendMin) / trendRange) * 100;
    return { item, x, y };
  });
  const statsDetail = (stats?.detail ?? {}) as Record<string, unknown>;
  const judgeCountEntries = numberMapEntries(statsDetail.judge_counts).map((entry) => ({
    ...entry,
    label: judgeTypeLabel(entry.key),
  }));
  const lmStageEntries = numberMapEntries(statsDetail.stage_counts).map((entry) => ({ ...entry, label: stageStatLabel(entry.key) }));
  const lmErrorEntries = numberMapEntries(statsDetail.error_type_counts).map((entry) => ({ ...entry, label: errorTypeLabel(entry.key) }));
  const lmTargetEntries = numberMapEntries(statsDetail.target_degree_counts);

  const activeDraftDiff = toRcDifficulty(currentDifficulty);
  const activeSettings = settingsDraft ?? userSettings;
  const activeFbhRange = activeSettings.fbh.ranges[activeDraftDiff] ?? activeSettings.fbh.ranges.EASY;
  const patchActiveFbhRange = (updater: (prev: MinigameUserSettings["fbh"]["ranges"]["EASY"]) => MinigameUserSettings["fbh"]["ranges"]["EASY"]) => {
    patchSettingsDraft((prev) => {
      const base = prev.fbh.ranges[activeDraftDiff] ?? prev.fbh.ranges.EASY;
      return {
        ...prev,
        fbh: {
          ...prev.fbh,
          ranges: {
            ...prev.fbh.ranges,
            [activeDraftDiff]: updater(base),
          },
        },
      };
    });
  };

  return (
    <div className={`mg-page mg-game-shell ${currentView === "HOME" ? "is-home" : "is-play"}`} data-testid="mg-page">
      {currentView === "HOME" ? (
        <>
          <header className="card mg-dashboard-head">
            <h2>{gameMeta[selectedGame].title}</h2>
            <p className="muted">{statusByGame[selectedGame]}</p>
            <div className="mg-home-mode-grid">
              <button data-testid="mg-mode-practice" className={`mg-big-toggle ${currentMode === "PRACTICE" ? "active" : ""}`} onClick={() => setModeByGame((prev) => ({ ...prev, [selectedGame]: "PRACTICE" }))}>연습 모드</button>
              <button data-testid="mg-mode-challenge" className={`mg-big-toggle ${currentMode === "CHALLENGE" ? "active" : ""}`} onClick={() => setModeByGame((prev) => ({ ...prev, [selectedGame]: "CHALLENGE" }))}>점수 모드</button>
            </div>
          </header>

          {selectedGame === "LM" && currentMode === "PRACTICE" ? (
            <section className="card mg-lm-home-mode-card" data-testid="mg-lm-home-mode-card">
              <div className="mg-row-wrap">
                <strong>연습 방식 선택</strong>
                <small className="muted">하나만 고르고 바로 들어갑니다.</small>
              </div>
              <div className="mg-lm-home-mode-grid">
                {lmPracticeOptions.map((option) => (
                  <button
                    key={option.stage}
                    type="button"
                    data-testid={`mg-lm-home-mode-${option.stage.toLowerCase()}`}
                    className={`mg-lm-home-mode-btn ${lmPracticeStage === option.stage ? "is-active" : ""}`}
                    onClick={() => setLmPracticeStage(option.stage)}
                  >
                    <strong>{option.label}</strong>
                    <small>{option.desc}</small>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <section className="mg-dashboard-grid">
            <section className="card mg-difficulty-panel" data-testid="mg-difficulty-panel">
              <div className="mg-row-wrap">
                <h3>난이도 선택</h3>
                {selectedGame === "RC" ? (
                  <button data-testid="mg-rc-open-calibration" className="ghost-btn" onClick={() => setIsRcCalibrationOpen(true)}>
                    싱크 조절
                  </button>
                ) : null}
              </div>
              <div className="mg-difficulty-list">
                {difficulties.map((diff) => {
                  const key = diff.toUpperCase();
                  return (
                    <button key={diff} className={`mg-difficulty-item ${diffColorClass[key] ?? ""} ${currentDifficulty === diff ? "active" : ""}`} onClick={() => setDifficultyByGame((prev) => ({ ...prev, [selectedGame]: diff }))}>
                      <strong>{diff.replace(/_/g, " ")}</strong>
                      <small>{difficultyDescription(selectedGame, diff)}</small>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="card mg-leaderboard-panel">
              <div className="mg-lb-fixed-top">
                <div className="mg-row-wrap"><h3>Leaderboard</h3><small className="muted">점수모드 기록만 집계</small></div>
                <div className="mg-lb-filter-row">
                  <label>난이도
                    <select value={lbDiffByGame[selectedGame]} onChange={(event) => setLbDiffByGame((prev) => ({ ...prev, [selectedGame]: event.target.value }))}>
                      <option value="ALL">ALL</option>
                      {difficulties.map((diff) => <option key={`lb-${diff}`} value={diff}>{diff.replace(/_/g, " ")}</option>)}
                    </select>
                  </label>
                  <div className="mg-period-filter">
                    {(["ALL", "D30", "TODAY"] as RecordPeriod[]).map((period) => (
                      <button key={period} className={`ghost-btn ${periodByGame[selectedGame] === period ? "active-mini" : ""}`} onClick={() => setPeriodByGame((prev) => ({ ...prev, [selectedGame]: period }))}>{period === "ALL" ? "전체" : period === "D30" ? "최근 30일" : "오늘"}</button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="mg-lb-list">
                {loadingDashboard ? <small className="muted">리더보드 로딩 중..</small> : null}
                {!loadingDashboard && leaderboard.length === 0 ? <small className="muted">기록이 없습니다.</small> : null}
                {leaderboard.map((item, idx) => (
                  <article key={item.record_id} className="mg-lb-item" data-testid={`mg-lb-item-${idx + 1}`}>
                    <strong>{idx + 1}. {item.score}점</strong>
                    <span>{formatMinute(item.created_at)}</span>
                    <div className="mg-lb-item-actions">
                      <button className="ghost-btn" onClick={() => setDetailRecord(item)}>i</button>
                      <button className="ghost-btn" onClick={() => void deleteRecordById(item.record_id)} disabled={deletingRecordId === item.record_id}>X</button>
                    </div>
                  </article>
                ))}
              </div>
              <div className="mg-row-wrap">
                <button className="ghost-btn" onClick={() => setIsStatsOpen(true)}>통계</button>
                <button className="ghost-btn" onClick={openSettingsModal}>세팅</button>
              </div>
            </section>
          </section>

          <section className="mg-home-action-bar">
            <button className="ghost-btn mg-home-action-btn" onClick={onBackToHub}>뒤로가기</button>
            {currentMode === "PRACTICE" ? <button data-testid="mg-start-practice" className="mg-start-btn mg-home-action-btn" onClick={() => moveView("PLAY")}>연습 시작</button> : null}
            {currentMode === "CHALLENGE" && selectedGame !== "RC" ? <button data-testid="mg-start-challenge-120" className="mg-start-btn mg-home-action-btn" onClick={() => startTimedChallengeFor(selectedGame as "FBH" | "LM")}>점수 모드 시작 ({challengeDurationLabel}s)</button> : null}
            {currentMode === "CHALLENGE" && selectedGame === "RC" ? <button data-testid="mg-start-challenge-rc" className="mg-start-btn mg-home-action-btn" onClick={startRcChallenge}>점수 모드 시작 ({rcChallengeLabel})</button> : null}
          </section>
        </>
      ) : null}

      {currentView === "PLAY" ? (
        <section className={`mg-main-left ${selectedGame === "FBH" ? "mg-play-fbh-shell" : ""}`}>
          {selectedGame === "FBH" ? (
            <section className="card mg-inline-board-settings" data-testid="mg-inline-board-settings">
              <div className="mg-row-wrap">
                <strong>간편 설정</strong>
                <small className="muted">변경 즉시 적용 + 자동 저장</small>
              </div>
              <div className="mg-grid-form">
                <label>
                  판정 흐름
                  <div className="mg-hit-controls">
                    <button
                      type="button"
                      className={`ghost-btn ${userSettings.fbh.practice.checkMode === "CONFIRM" ? "active-mini" : ""}`}
                      onClick={() =>
                        onUserSettingsChange({
                          ...userSettings,
                          fbh: { ...userSettings.fbh, practice: { ...userSettings.fbh.practice, checkMode: "CONFIRM" } },
                        })
                      }
                    >
                      정답 확인
                    </button>
                    <button
                      type="button"
                      className={`ghost-btn ${userSettings.fbh.practice.checkMode === "INSTANT" ? "active-mini" : ""}`}
                      onClick={() =>
                        onUserSettingsChange({
                          ...userSettings,
                          fbh: { ...userSettings.fbh, practice: { ...userSettings.fbh.practice, checkMode: "INSTANT" } },
                        })
                      }
                    >
                      즉시 확인
                    </button>
                  </div>
                </label>
                <label>
                  소리
                  <div className="mg-hit-controls">
                    <button
                      type="button"
                      className={`ghost-btn ${soundByGame.FBH ? "active-mini" : ""}`}
                      onClick={() => setSoundByGame((prev) => ({ ...prev, FBH: !prev.FBH }))}
                    >
                      {soundByGame.FBH ? "ON" : "OFF"}
                    </button>
                  </div>
                </label>
                <label>
                  판정 방식
                  <div className="mg-hit-controls">
                    {detectModeOptions.map((option) => (
                      <button
                        key={`play-detect-${option}`}
                        type="button"
                        className={`ghost-btn ${userSettings.fretboard.detectMode === option ? "active-mini" : ""}`}
                        onClick={() =>
                          onUserSettingsChange({
                            ...userSettings,
                            fretboard: { ...userSettings.fretboard, detectMode: option },
                          })
                        }
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </label>
                <label>
                  지판 프리셋
                  <select
                    value={userSettings.fretboard.boardPreset}
                    onChange={(event) =>
                      onUserSettingsChange({
                        ...userSettings,
                        fretboard: {
                          ...userSettings.fretboard,
                          boardPreset: event.target.value as MinigameUserSettings["fretboard"]["boardPreset"],
                        },
                      })
                    }
                  >
                    {boardPresetOptions.map((option) => (
                      <option key={`play-board-${option}`} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  인레이 프리셋
                  <select
                    value={userSettings.fretboard.inlayPreset}
                    onChange={(event) =>
                      onUserSettingsChange({
                        ...userSettings,
                        fretboard: {
                          ...userSettings.fretboard,
                          inlayPreset: event.target.value as MinigameUserSettings["fretboard"]["inlayPreset"],
                        },
                      })
                    }
                  >
                    {inlayPresetOptions.map((option) => (
                      <option key={`play-inlay-${option}`} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </section>
          ) : null}

          {selectedGame !== "FBH" ? (
            <div className="mg-row-wrap">
              <button data-testid="mg-back-home" className="ghost-btn" onClick={() => void leavePlay()}>메인으로</button>
              {challengeActive ? (
                <div className="mg-hit-controls">
                  <strong className="mg-timer">{selectedGame === "RC" ? rcRemainingSec : timedRemainingSec}s</strong>
                  <button data-testid="mg-stop-challenge" className="primary-btn danger-border" onClick={() => void stopActiveChallenge()}>중지</button>
                </div>
              ) : null}
            </div>
          ) : null}

          {selectedGame === "FBH" ? (
            <FretboardHuntGame
              mode={currentMode}
              difficulty={currentDifficulty}
              seed={seedText}
              challenge={{ running: timedChallengeGame === "FBH", remainingSec: timedRemainingSec, token: timedChallengeToken, durationSec: timedDurationSec }}
              challengeRules={userSettings.fbh.challenge}
              practiceRules={userSettings.fbh.practice}
              soundEnabled={soundByGame.FBH}
              onSoundEnabledChange={(enabled) => setSoundByGame((prev) => ({ ...prev, FBH: enabled }))}
              onMetricsChange={(metrics) => setMetricsByGame((prev) => ({ ...prev, FBH: metrics }))}
              onChallengeTerminated={(payload) => {
                if (timedChallengeGame !== "FBH") return;
                void finalizeTimedChallenge(payload.reason, { score: payload.score, accuracy: payload.accuracy, detail: payload.detail });
              }}
              maxVisibleFret={userSettings.fretboard.maxVisibleFret}
              detectMode={userSettings.fretboard.detectMode}
              onDetectModeChange={(mode) => onUserSettingsChange({ ...userSettings, fretboard: { ...userSettings.fretboard, detectMode: mode } })}
              showHitZones={userSettings.fretboard.showHitZones}
              onShowHitZonesChange={(enabled) => onUserSettingsChange({ ...userSettings, fretboard: { ...userSettings.fretboard, showHitZones: enabled } })}
              showFretNotes={userSettings.fretboard.showFretNotes}
              onShowFretNotesChange={(enabled) => onUserSettingsChange({ ...userSettings, fretboard: { ...userSettings.fretboard, showFretNotes: enabled } })}
              fretLineWidth={userSettings.fretboard.fretLineWidth}
              fretToneVolume={userSettings.fretboard.fretToneVolume}
              boardPreset={userSettings.fretboard.boardPreset}
              inlayPreset={userSettings.fretboard.inlayPreset}
              onBackHome={() => { void leavePlay(); }}
              onStopChallenge={() => { void stopActiveChallenge(); }}
              rangeConfig={userSettings.fbh.ranges}
              chordQualities={config.chord_qualities}
              scaleRules={config.scale_rules}
            />
          ) : null}

          {selectedGame === "LM" ? (
            <LineMapperGame
              mode={currentMode}
              difficulty={currentDifficulty}
              practiceStage={lmPracticeStage}
              seed={seedText}
              challenge={{ running: timedChallengeGame === "LM", remainingSec: timedRemainingSec, token: timedChallengeToken, durationSec: timedDurationSec }}
              soundEnabled={soundByGame.LM}
              onSoundEnabledChange={(enabled) => setSoundByGame((prev) => ({ ...prev, LM: enabled }))}
              fretToneVolume={userSettings.fretboard.fretToneVolume}
              maxVisibleFret={userSettings.fretboard.maxVisibleFret}
              detectMode={userSettings.fretboard.detectMode}
              onDetectModeChange={(mode) => onUserSettingsChange({ ...userSettings, fretboard: { ...userSettings.fretboard, detectMode: mode } })}
              showHitZones={userSettings.fretboard.showHitZones}
              onShowHitZonesChange={(enabled) => onUserSettingsChange({ ...userSettings, fretboard: { ...userSettings.fretboard, showHitZones: enabled } })}
              showFretNotes={userSettings.fretboard.showFretNotes}
              onShowFretNotesChange={(enabled) => onUserSettingsChange({ ...userSettings, fretboard: { ...userSettings.fretboard, showFretNotes: enabled } })}
              fretLineWidth={userSettings.fretboard.fretLineWidth}
              boardPreset={userSettings.fretboard.boardPreset}
              inlayPreset={userSettings.fretboard.inlayPreset}
              maxFretByDifficulty={userSettings.lm.maxFretByDifficulty}
              explainOn={userSettings.lm.explainOn}
              onExplainOnChange={(enabled) => onUserSettingsChange({ ...userSettings, lm: { ...userSettings.lm, explainOn: enabled } })}
              scaleRules={config.scale_rules}
              chordQualities={config.chord_qualities}
              onMetricsChange={(metrics) => setMetricsByGame((prev) => ({ ...prev, LM: metrics }))}
            />
          ) : null}

          {selectedGame === "RC" ? (
            <RhythmCopyGame
              mode={currentMode}
              difficulty={currentDifficulty}
              seed={seedText}
              challengeRunning={rcChallengeRunning}
              challengeToken={rcChallengeToken}
              rhythmTemplates={config.rhythm_templates}
              rhythmWindows={rhythmWindows}
              rhythmConfig={rhythmConfig}
              notationMode={userSettings.rhythm.notationMode}
              showMetronomeVisual={userSettings.rhythm.showMetronomeVisual}
              metronomeVolume={userSettings.rhythm.metronomeVolume}
              calibrationProfile={rcCalibrationProfile}
              onMetricsChange={(metrics) => setMetricsByGame((prev) => ({ ...prev, RC: metrics }))}
              onChallengeFinish={async (payload) => {
                await finalizeRcChallenge("COMPLETED", { score: payload.score, accuracy: payload.accuracy, detail: payload.detail }, payload.durationSec);
              }}
            />
          ) : null}
        </section>
      ) : null}

      {isStatsOpen ? (
        <div className="mg-modal-backdrop">
          <section className="card mg-large-modal">
            <div className="mg-row-wrap">
              <h3>{gameMeta[selectedGame].title} 통계</h3>
              <button className="ghost-btn" onClick={() => setIsStatsOpen(false)}>
                닫기
              </button>
            </div>
            <small className="muted">
              필터: {lbDiffByGame[selectedGame]} / {periodByGame[selectedGame] === "ALL" ? "전체" : periodByGame[selectedGame] === "D30" ? "최근 30일" : "오늘"}
            </small>

            <section className="mg-stats-grid">
              <article className="mg-difficulty-summary">
                <small>총 플레이</small>
                <p>{stats?.summary.plays ?? 0}</p>
              </article>
              <article className="mg-difficulty-summary">
                <small>평균 점수</small>
                <p>{(stats?.summary.avg_score ?? 0).toFixed(1)}</p>
              </article>
              <article className="mg-difficulty-summary">
                <small>최고 점수</small>
                <p>{stats?.summary.best_score ?? 0}</p>
              </article>
              <article className="mg-difficulty-summary">
                <small>평균 정확도</small>
                <p>{(stats?.summary.avg_accuracy ?? 0).toFixed(1)}%</p>
              </article>
            </section>

            <section className="mg-modal-section">
              <div className="mg-row-wrap">
                <h4>시도별 점수 추이</h4>
                <div className="mg-period-filter">
                  {(["10", "30", "ALL"] as TrendWindow[]).map((range) => (
                    <button
                      key={`trend-${range}`}
                      className={`ghost-btn ${trendWindowByGame[selectedGame] === range ? "active-mini" : ""}`}
                      onClick={() => setTrendWindowByGame((prev) => ({ ...prev, [selectedGame]: range }))}
                    >
                      {range === "ALL" ? "전체" : `${range}회`}
                    </button>
                  ))}
                </div>
              </div>
              {trendItems.length === 0 ? <small className="muted">표시할 추이 데이터가 없습니다.</small> : null}
              {trendItems.length > 0 ? (
                <div className="mg-score-line-wrap">
                  <svg className="mg-score-line-svg" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="score trend chart">
                    <line x1="0" y1={trendBaselineY} x2="100" y2={trendBaselineY} className="mg-score-line-base" />
                    <polyline
                      className="mg-score-line-main"
                      points={trendPoints.map((point) => `${point.x},${point.y}`).join(" ")}
                    />
                    {trendPoints.map((point) => (
                      <circle key={`score-dot-${point.item.record_id}`} cx={point.x} cy={point.y} r="1.5" className="mg-score-line-dot">
                        <title>{`${formatMinute(point.item.created_at)} / ${point.item.score}점`}</title>
                      </circle>
                    ))}
                  </svg>
                </div>
              ) : null}
              <small className="muted">최근 데이터 기준 {trendWindow === "ALL" ? `${trendItemsRaw.length}회 전체` : `${trendItems.length}회`} 표시</small>
            </section>

            <section className="mg-modal-section">
              <h4>게임 상세 지표</h4>
              {selectedGame === "FBH" ? (
                <>
                  <div className="mg-stats-grid">
                    <article className="mg-difficulty-summary">
                      <small>총 정답</small>
                      <p>{valueNumber(statsDetail.total_correct, 0)}</p>
                    </article>
                    <article className="mg-difficulty-summary">
                      <small>총 오답</small>
                      <p>{valueNumber(statsDetail.total_wrong, 0)}</p>
                    </article>
                  </div>
                  <div className="mg-detail-list">
                    <strong>판정 유형 분포</strong>
                    {judgeCountEntries.length === 0 ? <small className="muted">기록 없음</small> : null}
                    {judgeCountEntries.map((entry) => (
                      <div key={entry.key} className="mg-detail-row">
                        <span>{entry.label}</span>
                        <strong>{entry.value}</strong>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}

              {selectedGame === "RC" ? (
                <div className="mg-stats-grid">
                  <article className="mg-difficulty-summary">
                    <small>Perfect</small>
                    <p>{valueNumber(statsDetail.total_perfect, 0)}</p>
                  </article>
                  <article className="mg-difficulty-summary">
                    <small>Miss</small>
                    <p>{valueNumber(statsDetail.total_miss, 0)}</p>
                  </article>
                  <article className="mg-difficulty-summary">
                    <small>평균 노트</small>
                    <p>{valueNumber(statsDetail.avg_note_accuracy, 0).toFixed(1)}%</p>
                  </article>
                  <article className="mg-difficulty-summary">
                    <small>평균 타이밍</small>
                    <p>{valueNumber(statsDetail.avg_timing_accuracy, 0).toFixed(1)}%</p>
                  </article>
                </div>
              ) : null}

              {selectedGame === "LM" ? (
                <>
                  <div className="mg-stats-grid">
                    <article className="mg-difficulty-summary">
                      <small>총 정답</small>
                      <p>{valueNumber(statsDetail.total_correct, 0)}</p>
                    </article>
                    <article className="mg-difficulty-summary">
                      <small>총 오답</small>
                      <p>{valueNumber(statsDetail.total_wrong, 0)}</p>
                    </article>
                  </div>
                  <div className="mg-detail-list">
                    <strong>단계 분포</strong>
                    {lmStageEntries.length === 0 ? <small className="muted">기록 없음</small> : null}
                    {lmStageEntries.map((entry) => (
                      <div key={entry.key} className="mg-detail-row">
                        <span>{entry.label}</span>
                        <strong>{entry.value}</strong>
                      </div>
                    ))}
                  </div>
                  <div className="mg-detail-list">
                    <strong>오류 유형 분포</strong>
                    {lmErrorEntries.length === 0 ? <small className="muted">기록 없음</small> : null}
                    {lmErrorEntries.map((entry) => (
                      <div key={entry.key} className="mg-detail-row">
                        <span>{entry.label}</span>
                        <strong>{entry.value}</strong>
                      </div>
                    ))}
                  </div>
                  <div className="mg-detail-list">
                    <strong>도착음 분포</strong>
                    {lmTargetEntries.length === 0 ? <small className="muted">기록 없음</small> : null}
                    {lmTargetEntries.map((entry) => (
                      <div key={entry.key} className="mg-detail-row">
                        <span>{entry.key}</span>
                        <strong>{entry.value}</strong>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </section>
          </section>
        </div>
      ) : null}

      {isRcCalibrationOpen ? (
        <div className="mg-modal-backdrop">
          <section className="card mg-large-modal">
            <div className="mg-row-wrap">
              <h3>싱크 조절</h3>
              <button className="ghost-btn" onClick={() => setIsRcCalibrationOpen(false)}>
                닫기
              </button>
            </div>
            <RhythmCalibrationPanel
              bpm={config?.rhythm?.calibration?.bpm ?? 140}
              captureSec={config?.rhythm?.calibration?.capture_sec ?? 8}
              thresholds={config?.rhythm?.calibration?.rank_std_ms ?? { S: 14, A: 24, B: 36, C: 52 }}
              profile={rcCalibrationProfile}
              onProfileChange={setRcCalibrationProfile}
              metronomeVolume={userSettings.rhythm.metronomeVolume}
            />
          </section>
        </div>
      ) : null}

      {isSettingsOpen && settingsDraft ? (
        <div className="mg-modal-backdrop">
          <section className="card mg-large-modal" data-testid="mg-game-settings-modal">
            <div className="mg-row-wrap">
              <h3>{gameMeta[selectedGame].title} 세팅</h3>
              <button className="ghost-btn" onClick={closeSettingsModal}>
                닫기
              </button>
            </div>

            <section className="mg-modal-section">
              <h4>공통 지판/표시 설정</h4>
              <div className="mg-grid-form">
                <label>
                  지판 프리셋
                  <select
                    value={activeSettings.fretboard.boardPreset}
                    onChange={(event) =>
                      patchSettingsDraft((prev) => ({
                        ...prev,
                        fretboard: {
                          ...prev.fretboard,
                          boardPreset: event.target.value as MinigameUserSettings["fretboard"]["boardPreset"],
                        },
                      }))
                    }
                  >
                    {boardPresetOptions.map((option) => (
                      <option key={`board-${option}`} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  인레이 프리셋
                  <select
                    value={activeSettings.fretboard.inlayPreset}
                    onChange={(event) =>
                      patchSettingsDraft((prev) => ({
                        ...prev,
                        fretboard: {
                          ...prev.fretboard,
                          inlayPreset: event.target.value as MinigameUserSettings["fretboard"]["inlayPreset"],
                        },
                      }))
                    }
                  >
                    {inlayPresetOptions.map((option) => (
                      <option key={`inlay-${option}`} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  판정 방식
                  <select
                    value={activeSettings.fretboard.detectMode}
                    onChange={(event) =>
                      patchSettingsDraft((prev) => ({
                        ...prev,
                        fretboard: {
                          ...prev.fretboard,
                          detectMode: event.target.value as MinigameUserSettings["fretboard"]["detectMode"],
                        },
                      }))
                    }
                  >
                    {detectModeOptions.map((option) => (
                      <option key={`detect-${option}`} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  최대 표시 프렛
                  <input
                    type="number"
                    min={12}
                    max={21}
                    value={activeSettings.fretboard.maxVisibleFret}
                    onChange={(event) =>
                      patchSettingsDraft((prev) => ({
                        ...prev,
                        fretboard: {
                          ...prev.fretboard,
                          maxVisibleFret: clampInt(event.target.value, 12, 21, prev.fretboard.maxVisibleFret),
                        },
                      }))
                    }
                  />
                </label>
                <label>
                  프렛 선 두께
                  <input
                    type="number"
                    min={1.2}
                    max={4}
                    step={0.1}
                    value={activeSettings.fretboard.fretLineWidth}
                    onChange={(event) =>
                      patchSettingsDraft((prev) => ({
                        ...prev,
                        fretboard: {
                          ...prev.fretboard,
                          fretLineWidth: clampFloat(event.target.value, 1.2, 4, prev.fretboard.fretLineWidth),
                        },
                      }))
                    }
                  />
                </label>
                <label>
                  프렛 톤 볼륨
                  <input
                    type="number"
                    min={0.02}
                    max={1}
                    step={0.01}
                    value={activeSettings.fretboard.fretToneVolume}
                    onChange={(event) =>
                      patchSettingsDraft((prev) => ({
                        ...prev,
                        fretboard: {
                          ...prev.fretboard,
                          fretToneVolume: clampFloat(event.target.value, 0.02, 1, prev.fretboard.fretToneVolume),
                        },
                      }))
                    }
                  />
                </label>
              </div>
              <div className="mg-setting-checks">
                <label className="mg-check-row">
                  <input
                    type="checkbox"
                    checked={activeSettings.fretboard.showHitZones}
                    onChange={(event) =>
                      patchSettingsDraft((prev) => ({
                        ...prev,
                        fretboard: { ...prev.fretboard, showHitZones: event.target.checked },
                      }))
                    }
                  />
                  판정 영역 표시
                </label>
                <label className="mg-check-row">
                  <input
                    type="checkbox"
                    checked={activeSettings.fretboard.showFretNotes}
                    onChange={(event) =>
                      patchSettingsDraft((prev) => ({
                        ...prev,
                        fretboard: { ...prev.fretboard, showFretNotes: event.target.checked },
                      }))
                    }
                  />
                  지판 음이름 표시
                </label>
              </div>
            </section>

            {selectedGame === "FBH" ? (
              <section className="mg-modal-section">
                <h4>Fretboard Hunt 설정</h4>
                <div className="mg-grid-form">
                  <label>
                    점수 모드 시간(초)
                    <input
                      type="number"
                      min={10}
                      max={900}
                      value={activeSettings.fbh.challenge.timeLimitSec}
                      onChange={(event) =>
                        patchSettingsDraft((prev) => ({
                          ...prev,
                          fbh: {
                            ...prev.fbh,
                            challenge: {
                              ...prev.fbh.challenge,
                              timeLimitSec: clampInt(event.target.value, 10, 900, prev.fbh.challenge.timeLimitSec),
                            },
                          },
                        }))
                      }
                    />
                  </label>
                  <label>
                    정답 점수
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={activeSettings.fbh.challenge.correctScore}
                      onChange={(event) =>
                        patchSettingsDraft((prev) => ({
                          ...prev,
                          fbh: {
                            ...prev.fbh,
                            challenge: {
                              ...prev.fbh.challenge,
                              correctScore: clampInt(event.target.value, 1, 100, prev.fbh.challenge.correctScore),
                            },
                          },
                        }))
                      }
                    />
                  </label>
                  <label>
                    오답 패널티
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={activeSettings.fbh.challenge.wrongPenalty}
                      onChange={(event) =>
                        patchSettingsDraft((prev) => ({
                          ...prev,
                          fbh: {
                            ...prev.fbh,
                            challenge: {
                              ...prev.fbh.challenge,
                              wrongPenalty: clampInt(event.target.value, 0, 100, prev.fbh.challenge.wrongPenalty),
                            },
                          },
                        }))
                      }
                    />
                  </label>
                  <label>
                    라이프
                    <input
                      type="number"
                      min={0}
                      max={20}
                      value={activeSettings.fbh.challenge.lives}
                      onChange={(event) =>
                        patchSettingsDraft((prev) => ({
                          ...prev,
                          fbh: {
                            ...prev.fbh,
                            challenge: {
                              ...prev.fbh.challenge,
                              lives: clampInt(event.target.value, 0, 20, prev.fbh.challenge.lives),
                            },
                          },
                        }))
                      }
                    />
                  </label>
                </div>
                <div className="mg-setting-checks">
                  <label className="mg-check-row">
                    <input
                      type="checkbox"
                      checked={activeSettings.fbh.practice.showAnswerButton}
                      onChange={(event) =>
                        patchSettingsDraft((prev) => ({
                          ...prev,
                          fbh: {
                            ...prev.fbh,
                            practice: { ...prev.fbh.practice, showAnswerButton: event.target.checked },
                          },
                        }))
                      }
                    />
                    연습 모드 정답 버튼 표시
                  </label>
                  <label className="mg-check-row">
                    <input
                      type="checkbox"
                      checked={activeSettings.fbh.practice.revealAnswersOnCorrect}
                      onChange={(event) =>
                        patchSettingsDraft((prev) => ({
                          ...prev,
                          fbh: {
                            ...prev.fbh,
                            practice: { ...prev.fbh.practice, revealAnswersOnCorrect: event.target.checked },
                          },
                        }))
                      }
                    />
                    정답 시 허용음 강조
                  </label>
                  <label className="mg-check-row">
                    <input
                      type="checkbox"
                      checked={activeSettings.fbh.practice.requireNextAfterReveal}
                      onChange={(event) =>
                        patchSettingsDraft((prev) => ({
                          ...prev,
                          fbh: {
                            ...prev.fbh,
                            practice: { ...prev.fbh.practice, requireNextAfterReveal: event.target.checked },
                          },
                        }))
                      }
                    />
                    정답 표시 후 다음 문제 버튼 필요
                  </label>
                </div>
                <div className="mg-settings-row">
                  <strong>{activeDraftDiff}</strong>
                  <label>
                    난이도 최소 프렛
                    <input
                      type="number"
                      min={0}
                      max={21}
                      value={activeFbhRange.minFret}
                      onChange={(event) =>
                        patchActiveFbhRange((prev) => ({
                          ...prev,
                          minFret: clampInt(event.target.value, 0, 21, prev.minFret),
                        }))
                      }
                    />
                  </label>
                  <label>
                    난이도 최대 프렛
                    <input
                      type="number"
                      min={0}
                      max={21}
                      value={activeFbhRange.maxFret}
                      onChange={(event) =>
                        patchActiveFbhRange((prev) => ({
                          ...prev,
                          maxFret: clampInt(event.target.value, 0, 21, prev.maxFret),
                        }))
                      }
                    />
                  </label>
                  <label>
                    지정 구간 길이 최소값
                    <input
                      type="number"
                      min={2}
                      max={12}
                      value={activeFbhRange.pcRange.windowMinSize}
                      onChange={(event) =>
                        patchActiveFbhRange((prev) => ({
                          ...prev,
                          pcRange: {
                            ...prev.pcRange,
                            windowMinSize: clampInt(event.target.value, 2, 12, prev.pcRange.windowMinSize),
                          },
                        }))
                      }
                    />
                  </label>
                </div>
              </section>
            ) : null}

            {selectedGame === "RC" ? (
              <section className="mg-modal-section">
                <h4>Rhythm Copy 설정</h4>
                <div className="mg-grid-form">
                  <label>
                    악보 모드
                    <select
                      value={activeSettings.rhythm.notationMode}
                      onChange={(event) =>
                        patchSettingsDraft((prev) => ({
                          ...prev,
                          rhythm: {
                            ...prev.rhythm,
                            notationMode: event.target.value as MinigameUserSettings["rhythm"]["notationMode"],
                          },
                        }))
                      }
                    >
                      {notationModeOptions.map((option) => (
                        <option key={`notation-${option}`} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    프리롤 비트
                    <input
                      type="number"
                      min={1}
                      max={8}
                      value={activeSettings.rhythm.prerollBeats}
                      onChange={(event) =>
                        patchSettingsDraft((prev) => ({
                          ...prev,
                          rhythm: {
                            ...prev.rhythm,
                            prerollBeats: clampInt(event.target.value, 1, 8, prev.rhythm.prerollBeats),
                          },
                        }))
                      }
                    />
                  </label>
                  <label>
                    메트로놈 볼륨
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.05}
                      value={activeSettings.rhythm.metronomeVolume}
                      onChange={(event) =>
                        patchSettingsDraft((prev) => ({
                          ...prev,
                          rhythm: {
                            ...prev.rhythm,
                            metronomeVolume: clampFloat(event.target.value, 0, 1, prev.rhythm.metronomeVolume),
                          },
                        }))
                      }
                    />
                  </label>
                </div>
                <div className="mg-calibration-result">
                  <strong>점수모드 고정 규칙</strong>
                  <span>총 120초 안에 5문제를 진행합니다.</span>
                  <span>문제마다 정답 듣기와 연습 시도는 자유지만, 도전 1회만 점수에 반영됩니다.</span>
                </div>
                <div className="mg-setting-checks">
                  <label className="mg-check-row">
                    <input
                      type="checkbox"
                      checked={activeSettings.rhythm.showMetronomeVisual}
                      onChange={(event) =>
                        patchSettingsDraft((prev) => ({
                          ...prev,
                          rhythm: { ...prev.rhythm, showMetronomeVisual: event.target.checked },
                        }))
                      }
                    />
                    메트로놈 시각화
                  </label>
                </div>
                <div className="mg-settings-table">
                  {RC_DIFFICULTIES.map((diff) => (
                    <label key={`rhythm-win-${diff}`}>
                      {diff}
                      <input
                        type="number"
                        min={20}
                        max={160}
                        value={activeSettings.rhythm.windowsMs[diff]}
                        onChange={(event) =>
                          patchSettingsDraft((prev) => ({
                            ...prev,
                            rhythm: {
                              ...prev.rhythm,
                              windowsMs: {
                                ...prev.rhythm.windowsMs,
                                [diff]: clampInt(event.target.value, 20, 160, prev.rhythm.windowsMs[diff]),
                              },
                            },
                          }))
                        }
                      />
                    </label>
                  ))}
                </div>
              </section>
            ) : null}

            {selectedGame === "LM" ? (
              <section className="mg-modal-section">
                <h4>Line Mapper 설정</h4>
                <div className="mg-setting-checks">
                  <label className="mg-check-row">
                    <input
                      type="checkbox"
                      checked={activeSettings.lm.explainOn}
                      onChange={(event) =>
                        patchSettingsDraft((prev) => ({
                          ...prev,
                          lm: { ...prev.lm, explainOn: event.target.checked },
                        }))
                      }
                    />
                    정답/오답 설명 표시
                  </label>
                </div>
                <div className="mg-settings-table">
                  {RC_DIFFICULTIES.map((diff) => (
                    <label key={`lm-maxfret-${diff}`}>
                      {diff}
                      <input
                        type="number"
                        min={1}
                        max={21}
                        value={activeSettings.lm.maxFretByDifficulty[diff]}
                        onChange={(event) =>
                          patchSettingsDraft((prev) => ({
                            ...prev,
                            lm: {
                              ...prev.lm,
                              maxFretByDifficulty: {
                                ...prev.lm.maxFretByDifficulty,
                                [diff]: clampInt(event.target.value, 1, 21, prev.lm.maxFretByDifficulty[diff]),
                              },
                            },
                          }))
                        }
                      />
                    </label>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="mg-setting-actions">
              <button className="ghost-btn" onClick={closeSettingsModal}>
                취소
              </button>
              <button className="primary-btn" onClick={saveSettingsDraft}>
                저장
              </button>
              <button className="ghost-btn" onClick={openSettingsTabFromModal}>
                고급 설정 탭 열기
              </button>
            </section>
          </section>
        </div>
      ) : null}

      {detailRecord ? (
        <div className="mg-modal-backdrop">
          <section className="card mg-record-detail-modal">
            <div className="mg-row-wrap">
              <h3>기록 상세</h3>
              <button className="ghost-btn" onClick={() => setDetailRecord(null)}>
                닫기
              </button>
            </div>
            <div className="mg-detail-list">
              <div className="mg-detail-row">
                <span>점수</span>
                <strong>{detailRecord.score}</strong>
              </div>
              <div className="mg-detail-row">
                <span>시간</span>
                <strong>{formatSecond(detailRecord.created_at)}</strong>
              </div>
              <div className="mg-detail-row">
                <span>플레이 시간</span>
                <strong>{valueNumber(detailRecord.duration_sec, 0)}s</strong>
              </div>
              <div className="mg-detail-row">
                <span>{detailRecord.game === "RC" ? "타이밍 정확도" : "정확도"}</span>
                <strong>{valueNumber(detailRecord.accuracy, 0).toFixed(1)}%</strong>
              </div>
              {detailRecord.game === "RC" ? (
                <div className="mg-detail-row">
                  <span>노트 정확도</span>
                  <strong>{valueNumber(detailRecord.detail_json?.note_accuracy, 0).toFixed(1)}%</strong>
                </div>
              ) : null}
              <div className="mg-detail-row">
                <span>정답 수</span>
                <strong>{recordCorrectCount(detailRecord)}</strong>
              </div>
              <div className="mg-detail-row">
                <span>오답 수</span>
                <strong>{recordWrongCount(detailRecord)}</strong>
              </div>
            </div>
            <div className="mg-setting-actions">
              <button
                className="ghost-btn"
                onClick={() => void deleteRecordById(detailRecord.record_id)}
                disabled={deletingRecordId === detailRecord.record_id}
              >
                이 기록 삭제
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {challengeResult ? (
        <div className="mg-modal-backdrop" data-testid="mg-challenge-result">
          <section className="card mg-challenge-modal">
            <h3>SCORE</h3>
            <p className="mg-result-score">{challengeResult.score}</p>
            {challengeResult.game === "RC" ? (
              <small className="muted">
                정답 {challengeResult.correct} / 오답 {challengeResult.wrong} / 노트 {valueNumber(challengeResult.detail.note_accuracy, 0).toFixed(1)}% / 타이밍 {challengeResult.accuracy.toFixed(1)}%
              </small>
            ) : (
              <small className="muted">정답 {challengeResult.correct} / 오답 {challengeResult.wrong} / 정확도 {challengeResult.accuracy.toFixed(1)}%</small>
            )}
            <div className="mg-hit-controls mg-result-actions">
              <button data-testid="mg-result-exit" className="ghost-btn" onClick={() => { moveViewFor(challengeResult.game, "HOME"); setChallengeResult(null); }}>나가기</button>
              <button data-testid="mg-result-restart" className="primary-btn" onClick={() => { const game = challengeResult.game; setChallengeResult(null); setModeByGame((prev) => ({ ...prev, [game]: "CHALLENGE" })); if (game === "RC") startRcChallenge(); if (game === "FBH" || game === "LM") startTimedChallengeFor(game); }}>다시 시작</button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
