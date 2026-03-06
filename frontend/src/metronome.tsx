import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

import { createPortal } from "react-dom";

type WaveKey = OscillatorType;

type MetronomeContextValue = {
  running: boolean;
  open: boolean;
  beat: number;
  bar: number;
  bpm: number;
  bpmInput: string;
  signatureTop: number;
  signatureBottom: number;
  accentInput: string;
  masterVolume: number;
  error: string;
  showAdvanced: boolean;
  strongHz: number;
  weakHz: number;
  strongWave: WaveKey;
  weakWave: WaveKey;
  strongGain: number;
  weakGain: number;
  setOpen: (value: boolean) => void;
  setBpmInput: (value: string) => void;
  setSignatureTop: (value: number) => void;
  setSignatureBottom: (value: number) => void;
  setAccentInput: (value: string) => void;
  setMasterVolume: (value: number) => void;
  setShowAdvanced: (value: boolean) => void;
  setStrongHz: (value: number) => void;
  setWeakHz: (value: number) => void;
  setStrongWave: (value: WaveKey) => void;
  setWeakWave: (value: WaveKey) => void;
  setStrongGain: (value: number) => void;
  setWeakGain: (value: number) => void;
  setBpmValue: (value: number) => void;
  applyBpmInput: () => boolean;
  start: () => Promise<boolean>;
  stop: () => void;
  toggle: () => Promise<boolean>;
};

const MetronomeContext = createContext<MetronomeContextValue | null>(null);

const BPM_MIN = 30;
const BPM_MAX = 260;

function parseAccentBeats(raw: string, signatureTop: number): Set<number> {
  const parsed = raw
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item) && item >= 1 && item <= signatureTop);
  return new Set(parsed.length ? parsed : [1]);
}

function parseBpmInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

type ProviderProps = { children: React.ReactNode };

export function MetronomeProvider({ children }: ProviderProps) {
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState(false);
  const [beat, setBeat] = useState(1);
  const [bar, setBar] = useState(1);
  const [bpm, setBpm] = useState(90);
  const [bpmInput, setBpmInput] = useState("90");
  const [signatureTop, setSignatureTop] = useState(4);
  const [signatureBottom, setSignatureBottom] = useState(4);
  const [accentInput, setAccentInput] = useState("1");
  const [masterVolume, setMasterVolume] = useState(0.65);
  const [error, setError] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [strongHz, setStrongHz] = useState(1350);
  const [weakHz, setWeakHz] = useState(900);
  const [strongWave, setStrongWave] = useState<WaveKey>("square");
  const [weakWave, setWeakWave] = useState<WaveKey>("square");
  const [strongGain, setStrongGain] = useState(1.0);
  const [weakGain, setWeakGain] = useState(0.65);

  const accentBeats = useMemo(() => parseAccentBeats(accentInput, signatureTop), [accentInput, signatureTop]);
  const audioRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<number | null>(null);
  const beatRef = useRef(1);
  const barRef = useRef(1);

  const ensureAudio = async (): Promise<AudioContext> => {
    if (!audioRef.current) {
      audioRef.current = new window.AudioContext();
    }
    if (audioRef.current.state === "suspended") {
      await audioRef.current.resume();
    }
    return audioRef.current;
  };

  const playTone = async (hz: number, durationSec: number, volume: number, wave: WaveKey) => {
    const ctx = await ensureAudio();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = wave;
    osc.frequency.value = hz;
    gain.gain.value = Math.max(0.005, Math.min(1, volume));

    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;
    osc.start(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + Math.max(0.03, durationSec));
    osc.stop(now + Math.max(0.03, durationSec));
  };

  const applyBpmInput = (): boolean => {
    const parsed = parseBpmInput(bpmInput);
    if (parsed === null) {
      setError("BPM을 숫자로 입력해 주세요.");
      return false;
    }
    if (parsed < BPM_MIN || parsed > BPM_MAX) {
      setError(`BPM 범위는 ${BPM_MIN}~${BPM_MAX} 입니다.`);
      return false;
    }
    const rounded = Math.round(parsed);
    setError("");
    setBpm(rounded);
    setBpmInput(String(rounded));
    return true;
  };

  const setBpmValue = (value: number) => {
    const rounded = Math.round(value);
    if (rounded < BPM_MIN || rounded > BPM_MAX) return;
    setError("");
    setBpm(rounded);
    setBpmInput(String(rounded));
  };

  const start = async (): Promise<boolean> => {
    if (!applyBpmInput()) return false;
    beatRef.current = 1;
    barRef.current = 1;
    setBeat(1);
    setBar(1);
    setRunning(true);
    return true;
  };

  const stop = () => setRunning(false);

  const toggle = async (): Promise<boolean> => {
    if (running) {
      stop();
      return true;
    }
    return start();
  };

  useEffect(() => {
    if (!running) {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    const intervalMs = Math.max(40, Math.round((60 / Math.max(BPM_MIN, bpm)) * 1000));

    const tick = () => {
      const currentBeat = beatRef.current;
      const currentBar = barRef.current;
      const isAccent = accentBeats.has(currentBeat);

      const hz = isAccent ? strongHz : weakHz;
      const wave = isAccent ? strongWave : weakWave;
      const gainRatio = isAccent ? strongGain : weakGain;
      void playTone(hz, 0.07, masterVolume * gainRatio, wave);

      setBeat(currentBeat);
      setBar(currentBar);

      let nextBeat = currentBeat + 1;
      let nextBar = currentBar;
      if (nextBeat > signatureTop) {
        nextBeat = 1;
        nextBar += 1;
      }
      beatRef.current = nextBeat;
      barRef.current = nextBar;
    };

    tick();
    timerRef.current = window.setInterval(tick, intervalMs);

    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [running, bpm, signatureTop, accentBeats, strongHz, weakHz, strongWave, weakWave, masterVolume, strongGain, weakGain]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (audioRef.current) {
        void audioRef.current.close();
      }
    };
  }, []);

  const value: MetronomeContextValue = {
    running,
    open,
    beat,
    bar,
    bpm,
    bpmInput,
    signatureTop,
    signatureBottom,
    accentInput,
    masterVolume,
    error,
    showAdvanced,
    strongHz,
    weakHz,
    strongWave,
    weakWave,
    strongGain,
    weakGain,
    setOpen,
    setBpmInput,
    setSignatureTop: (value) => setSignatureTop(Math.max(1, Math.min(12, Math.round(value || 4)))),
    setSignatureBottom: (value) => {
      const next = Math.round(value || 4);
      if ([2, 4, 8, 16].includes(next)) setSignatureBottom(next);
    },
    setAccentInput,
    setMasterVolume: (value) => setMasterVolume(Math.max(0.01, Math.min(1, value))),
    setShowAdvanced,
    setStrongHz: (value) => setStrongHz(Math.max(300, Math.min(3200, Math.round(value)))),
    setWeakHz: (value) => setWeakHz(Math.max(200, Math.min(2800, Math.round(value)))),
    setStrongWave,
    setWeakWave,
    setStrongGain: (value) => setStrongGain(Math.max(0.2, Math.min(1.5, value))),
    setWeakGain: (value) => setWeakGain(Math.max(0.1, Math.min(1.5, value))),
    setBpmValue,
    applyBpmInput,
    start,
    stop,
    toggle,
  };

  return <MetronomeContext.Provider value={value}>{children}</MetronomeContext.Provider>;
}

export function useMetronome(): MetronomeContextValue {
  const context = useContext(MetronomeContext);
  if (!context) throw new Error("useMetronome must be used inside MetronomeProvider");
  return context;
}

export function MetronomePipPanel({
  placement = "inline",
  visible = true,
}: {
  placement?: "inline" | "floating";
  visible?: boolean;
}) {
  const metro = useMetronome();
  const beats = Array.from({ length: metro.signatureTop }).map((_, idx) => idx + 1);
  const accentSet = useMemo(() => parseAccentBeats(metro.accentInput, metro.signatureTop), [metro.accentInput, metro.signatureTop]);

  if (!visible || (!metro.running && !metro.open)) return null;

  const panel = (
    <div
      className={`metronome-pip-panel ${placement}`}
      data-testid={placement === "inline" ? "global-metronome-pip-inline" : "global-metronome-pip-floating"}
    >
      <div className="metronome-pip-head">
        <strong>METRO</strong>
        <div className="metronome-pip-bpm-inline">
          <button type="button" className="ghost-btn compact-add-btn" onClick={() => metro.setBpmValue(Math.max(BPM_MIN, metro.bpm - 1))}>
            -
          </button>
          <input
            value={metro.bpmInput}
            inputMode="numeric"
            onChange={(event) => metro.setBpmInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") metro.applyBpmInput();
            }}
            onBlur={() => {
              if (metro.bpmInput.trim()) metro.applyBpmInput();
            }}
            aria-label="Metronome BPM"
          />
          <button type="button" className="ghost-btn compact-add-btn" onClick={() => metro.setBpmValue(Math.min(BPM_MAX, metro.bpm + 1))}>
            +
          </button>
        </div>
        <button
          type="button"
          className={metro.running ? "danger-btn" : "primary-btn"}
          onClick={() => void metro.toggle()}
        >
          {metro.running ? "정지" : "시작"}
        </button>
      </div>
      <div className="metronome-visual metronome-pip-visual">
        {beats.map((value) => {
          const active = value === metro.beat;
          const accent = accentSet.has(value);
          return <span key={`pip_beat_${value}`} className={`metronome-light ${active ? "active" : ""} ${accent ? "accent" : ""}`} />;
        })}
      </div>
      {metro.error ? <small className="danger-text">{metro.error}</small> : null}
    </div>
  );

  if (placement === "floating" && typeof document !== "undefined") {
    return createPortal(panel, document.body);
  }
  return panel;
}

export function GlobalMetronomeDock() {
  const metro = useMetronome();
  const beats = Array.from({ length: metro.signatureTop }).map((_, idx) => idx + 1);
  const accentSet = useMemo(() => parseAccentBeats(metro.accentInput, metro.signatureTop), [metro.accentInput, metro.signatureTop]);

  return (
    <div className="metronome-inline">
      <button
        className={`metronome-toggle ${metro.running ? "running" : ""}`}
        onClick={() => metro.setOpen(!metro.open)}
        title={metro.open ? "메트로놈 닫기" : "메트로놈 열기"}
      >
        <span>메트로놈</span>
        <strong>{metro.running ? `${metro.beat}/${metro.signatureTop}` : "OFF"}</strong>
      </button>

      {metro.open ? (
        <aside className="metronome-dock card">
          <div className="row">
            <strong>Metronome</strong>
            <div className="row">
              <button className="tiny-info" onClick={() => metro.setShowAdvanced(!metro.showAdvanced)} title="고급 설정">
                ⚙
              </button>
              <button className="tiny-info" onClick={() => metro.setOpen(false)} title="닫기">
                ×
              </button>
            </div>
          </div>

          <div className="metronome-visual">
            {beats.map((value) => {
              const active = metro.running && value === metro.beat;
              const accent = accentSet.has(value);
              return <span key={value} className={`metronome-light ${active ? "active" : ""} ${accent ? "accent" : ""}`} title={`Beat ${value}`} />;
            })}
          </div>

          <label>
            BPM
            <div className="metronome-bpm-row">
              <input
                value={metro.bpmInput}
                onChange={(event) => metro.setBpmInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") metro.applyBpmInput();
                }}
                onBlur={() => {
                  if (metro.bpmInput.trim()) metro.applyBpmInput();
                }}
                inputMode="numeric"
              />
              <button className="ghost-btn" onClick={() => metro.applyBpmInput()}>
                적용
              </button>
            </div>
          </label>

          <input type="range" min={BPM_MIN} max={BPM_MAX} value={metro.bpm} onChange={(event) => metro.setBpmValue(Number(event.target.value))} />

          <div className="metronome-mini-grid">
            <label>
              박자
              <input type="number" min={1} max={12} value={metro.signatureTop} onChange={(event) => metro.setSignatureTop(Number(event.target.value))} />
            </label>
            <label>
              분모
              <select value={metro.signatureBottom} onChange={(event) => metro.setSignatureBottom(Number(event.target.value))}>
                {[2, 4, 8, 16].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label>
            강박 위치
            <input value={metro.accentInput} onChange={(event) => metro.setAccentInput(event.target.value)} placeholder="1,3" />
          </label>

          <label>
            볼륨
            <input type="range" min={0.01} max={1} step={0.01} value={metro.masterVolume} onChange={(event) => metro.setMasterVolume(Number(event.target.value))} />
          </label>

          {metro.showAdvanced ? (
            <div className="metronome-advanced">
              <label>
                Strong Hz
                <input type="number" value={metro.strongHz} onChange={(event) => metro.setStrongHz(Number(event.target.value))} />
              </label>
              <label>
                Weak Hz
                <input type="number" value={metro.weakHz} onChange={(event) => metro.setWeakHz(Number(event.target.value))} />
              </label>
              <label>
                Strong Wave
                <select value={metro.strongWave} onChange={(event) => metro.setStrongWave(event.target.value as WaveKey)}>
                  <option value="square">square</option>
                  <option value="sine">sine</option>
                  <option value="triangle">triangle</option>
                  <option value="sawtooth">sawtooth</option>
                </select>
              </label>
              <label>
                Weak Wave
                <select value={metro.weakWave} onChange={(event) => metro.setWeakWave(event.target.value as WaveKey)}>
                  <option value="square">square</option>
                  <option value="sine">sine</option>
                  <option value="triangle">triangle</option>
                  <option value="sawtooth">sawtooth</option>
                </select>
              </label>
            </div>
          ) : null}

          {metro.error ? <small className="danger-text">{metro.error}</small> : null}
          <small className="muted">Bar {metro.bar} · Beat {metro.beat}</small>
          <button className="primary-btn" onClick={() => void metro.toggle()}>
            {metro.running ? "정지" : "시작"}
          </button>
        </aside>
      ) : null}
    </div>
  );
}
