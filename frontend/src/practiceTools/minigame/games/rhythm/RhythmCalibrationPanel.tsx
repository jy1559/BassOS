import { useEffect, useRef, useState } from "react";
import type { RCCalibrationProfile } from "../../types/models";
import { playTone, startMetronome } from "../common/audio";
import { computeMean, computeStd, rankByStd, saveCalibrationProfile } from "./calibration";

type Props = {
  bpm: number;
  captureSec: number;
  thresholds: Record<string, number>;
  profile: RCCalibrationProfile | null;
  onProfileChange: (profile: RCCalibrationProfile) => void;
  metronomeVolume: number;
};

type TapMarker = {
  id: string;
  diffMs: number;
};

const DIFF_VISUAL_CLAMP_MS = 90;
const MAX_MARKERS = 24;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function formatDiffText(diffMs: number | null): string {
  if (diffMs === null) return "--";
  const absMs = Math.round(Math.abs(diffMs));
  if (absMs <= 5) return "정박";
  return `${absMs}ms ${diffMs < 0 ? "빠름" : "느림"}`;
}

function rankComment(rank: string): string {
  if (rank === "S") return "대박입니다. 박을 거의 끌고 다니는 수준입니다.";
  if (rank === "A") return "좋습니다. 합주에서도 꽤 안정적으로 붙을 느낌입니다.";
  if (rank === "B") return "적당히 맞습니다. 조금만 더 다듬으면 훨씬 단단해집니다.";
  if (rank === "C") return "좀 더 또박또박 쳐야 합니다. 지금은 박보다 손이 먼저 놀고 있습니다.";
  return "대충 친 거 아닌가 싶습니다. 메트로놈에 더 바짝 붙여서 다시 해보세요.";
}

function playFinishTone(rank: string): void {
  const tones =
    rank === "S"
      ? [784, 1046, 1318]
      : rank === "A"
        ? [698, 932, 1174]
        : rank === "B"
          ? [587, 784, 988]
          : [440, 554, 659];
  tones.forEach((hz, index) => {
    window.setTimeout(() => {
      void playTone(hz, 0.12, 0.12 + index * 0.02, "triangle");
    }, index * 80);
  });
}

export function RhythmCalibrationPanel({
  bpm,
  captureSec,
  thresholds,
  profile,
  onProfileChange,
  metronomeVolume,
}: Props) {
  const stopRef = useRef<(() => void) | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const metroStartRef = useRef(0);
  const firstTapRef = useRef(0);
  const captureUntilRef = useRef(0);
  const samplesRef = useRef<number[]>([]);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("메트로놈에 맞춰서 계속 클릭하세요.");
  const [sampleCount, setSampleCount] = useState(0);
  const [lastDiffMs, setLastDiffMs] = useState<number | null>(null);
  const [liveAvgMs, setLiveAvgMs] = useState(0);
  const [liveStdMs, setLiveStdMs] = useState(0);
  const [markers, setMarkers] = useState<TapMarker[]>([]);
  const [resultPulse, setResultPulse] = useState(0);

  const stopAll = () => {
    stopRef.current?.();
    stopRef.current = null;
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setRunning(false);
  };

  const finish = () => {
    stopAll();
    const samples = samplesRef.current.slice();
    if (samples.length < 4) {
      setMessage("샘플이 너무 적습니다. 조금 더 길게 맞춰서 다시 눌러보세요.");
      return;
    }
    const avg = computeMean(samples);
    const std = computeStd(samples);
    const rank = rankByStd(std, thresholds);
    const next: RCCalibrationProfile = {
      avg_offset_ms: Number(avg.toFixed(2)),
      std_ms: Number(std.toFixed(2)),
      rank,
      captured_at: new Date().toISOString(),
    };
    saveCalibrationProfile(next);
    onProfileChange(next);
    setResultPulse((prev) => prev + 1);
    playFinishTone(rank);
    setMessage(`측정 완료. 평균 ${Math.round(avg)}ms, 표준편차 ${Math.round(std)}ms, 랭크 ${rank}`);
  };

  const tap = () => {
    if (!running) return;
    const now = performance.now();
    const interval = 60_000 / Math.max(30, bpm);
    const metroStart = metroStartRef.current;
    if (!metroStart) return;
    const k = Math.round((now - metroStart) / interval);
    const nearest = metroStart + k * interval;
    const diff = now - nearest;

    if (!firstTapRef.current) {
      firstTapRef.current = now;
      captureUntilRef.current = now + captureSec * 1000;
      timeoutRef.current = window.setTimeout(() => finish(), captureSec * 1000 + 30);
      setMessage("계속 같은 박에 맞춰 눌러주세요.");
    }
    if (now > captureUntilRef.current) return;

    const nextSamples = [...samplesRef.current, diff];
    samplesRef.current = nextSamples;
    setSampleCount(nextSamples.length);
    setLastDiffMs(diff);
    setLiveAvgMs(computeMean(nextSamples));
    setLiveStdMs(computeStd(nextSamples));
    setMarkers((prev) => [...prev.slice(-(MAX_MARKERS - 1)), { id: `${now}-${nextSamples.length}`, diffMs: diff }]);
  };

  const start = () => {
    stopAll();
    samplesRef.current = [];
    setSampleCount(0);
    setLastDiffMs(null);
    setLiveAvgMs(0);
    setLiveStdMs(0);
    setMarkers([]);
    setMessage("메트로놈에 맞춰서 계속 클릭하세요.");
    firstTapRef.current = 0;
    captureUntilRef.current = 0;
    metroStartRef.current = performance.now();
    stopRef.current = startMetronome(bpm, 4, undefined, metronomeVolume);
    setRunning(true);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      const key = event.key.toLowerCase();
      if (key === "j" || key === "f" || key === " " || key === "enter") tap();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, bpm, captureSec]);

  useEffect(() => {
    return () => stopAll();
  }, []);

  const visibleRank = running && sampleCount > 0 ? rankByStd(liveStdMs, thresholds) : profile?.rank ?? "-";

  return (
    <section className="mg-game-card" data-testid="mg-rc-calibration">
      <div className="mg-row-wrap">
        <div>
          <h3>리듬 캘리브레이션</h3>
          <p className="muted">{bpm} BPM 메트로놈에 맞춰 계속 클릭하세요. F/J/Space/Enter 모두 됩니다.</p>
        </div>
        <div className="mg-mode-pill-row">
          <span className="mg-tag">최근 입력 {formatDiffText(lastDiffMs)}</span>
          <span className="mg-tag">실시간 랭크 {visibleRank}</span>
        </div>
      </div>

      <section className="mg-calibration-liveboard">
        <div className="mg-calibration-lane" aria-hidden="true">
          <span className="mg-calibration-side is-left">빠름</span>
          <span className="mg-calibration-side is-right">느림</span>
          <div className="mg-calibration-center" />
          {markers.map((marker, index) => {
            const clamped = clamp(marker.diffMs, -DIFF_VISUAL_CLAMP_MS, DIFF_VISUAL_CLAMP_MS);
            const percent = (clamped / DIFF_VISUAL_CLAMP_MS) * 44;
            return (
              <span
                key={marker.id}
                className="mg-calibration-marker"
                style={{
                  left: `${50 + percent}%`,
                  opacity: `${0.28 + (index + 1) / Math.max(1, markers.length) * 0.72}`,
                }}
              />
            );
          })}
        </div>

        <div className="mg-stats-grid">
          <article className="mg-difficulty-summary">
            <small>샘플 수</small>
            <p>{sampleCount}</p>
          </article>
          <article className="mg-difficulty-summary">
            <small>평균 오차</small>
            <p>{Math.round(running ? liveAvgMs : profile?.avg_offset_ms ?? 0)}ms</p>
          </article>
          <article className="mg-difficulty-summary">
            <small>표준편차</small>
            <p>{Math.round(running ? liveStdMs : profile?.std_ms ?? 0)}ms</p>
          </article>
          <article className="mg-difficulty-summary">
            <small>지금 판정</small>
            <p>{formatDiffText(lastDiffMs)}</p>
          </article>
        </div>
      </section>

      <div className="mg-hit-controls">
        <button className="primary-btn" onClick={start} disabled={running}>
          측정 시작
        </button>
        <button className="ghost-btn" onClick={tap} disabled={!running}>
          타격 입력 (J/F)
        </button>
        <button className="ghost-btn" onClick={stopAll} disabled={!running}>
          중지
        </button>
      </div>

      <p className="mg-help-text">{message}</p>

      {profile ? (
        <div
          key={`${profile.captured_at}-${resultPulse}`}
          className={`mg-calibration-result mg-calibration-rank-card is-rank-${profile.rank.toLowerCase()}`}
        >
          <div className="mg-row-wrap">
            <strong>현재 보정 프로필</strong>
            <span className="mg-calibration-rank-badge">{profile.rank}</span>
          </div>
          <span>평균 오차: {Math.round(profile.avg_offset_ms)}ms (판정 보정에 사용)</span>
          <span>표준편차: {Math.round(profile.std_ms)}ms</span>
          <span>측정 시각: {profile.captured_at.replace("T", " ").slice(0, 19)}</span>
          <strong className="mg-calibration-comment">{rankComment(profile.rank)}</strong>
        </div>
      ) : null}
    </section>
  );
}
