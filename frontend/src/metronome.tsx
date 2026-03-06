import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type WaveKey = OscillatorType;

type MetronomePreset = {
  bpm: number;
  signatureTop: number;
  signatureBottom: number;
  accentInput: string;
  masterVolume: number;
};

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
  profileKey: string;
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
  setProfileKey: (value: string) => void;
  setBpmValue: (value: number) => void;
  applyBpmInput: () => boolean;
  start: () => Promise<boolean>;
  stop: () => void;
  toggle: () => Promise<boolean>;
};

const MetronomeContext = createContext<MetronomeContextValue | null>(null);

const BPM_MIN = 30;
const BPM_MAX = 260;
const METRONOME_PRESET_STORAGE_KEY = "bassos.metronome.presets.v1";
const SIGNATURE_PRESETS: Array<{ top: number; bottom: number; label: string }> = [
  { top: 4, bottom: 4, label: "4/4" },
  { top: 3, bottom: 4, label: "3/4" },
  { top: 6, bottom: 8, label: "6/8" },
  { top: 5, bottom: 4, label: "5/4" },
  { top: 7, bottom: 8, label: "7/8" },
  { top: 3, bottom: 3, label: "3/3" },
];

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function clampFloat(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

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

function signatureLabel(top: number, bottom: number): string {
  return `${top}/${bottom}`;
}

function normalizePreset(raw: unknown): MetronomePreset | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const bpm = clampInt(Number(item.bpm), BPM_MIN, BPM_MAX, 90);
  const signatureTop = clampInt(Number(item.signatureTop), 1, 12, 4);
  const signatureBottom = clampInt(Number(item.signatureBottom), 1, 16, 4);
  const accentInput = String(item.accentInput || "1").trim() || "1";
  const masterVolume = clampFloat(Number(item.masterVolume), 0.01, 1, 0.65);
  return { bpm, signatureTop, signatureBottom, accentInput, masterVolume };
}

function readPresetStore(): Record<string, MetronomePreset> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(METRONOME_PRESET_STORAGE_KEY);
    if (!raw) return {};
    const decoded = JSON.parse(raw) as Record<string, unknown>;
    if (!decoded || typeof decoded !== "object") return {};
    const next: Record<string, MetronomePreset> = {};
    for (const [key, value] of Object.entries(decoded)) {
      const normalized = normalizePreset(value);
      if (!normalized) continue;
      next[key] = normalized;
    }
    return next;
  } catch {
    return {};
  }
}

function writePresetStore(payload: Record<string, MetronomePreset>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(METRONOME_PRESET_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore local storage errors.
  }
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
  const [profileKey, setProfileKey] = useState("");

  const accentBeats = useMemo(() => parseAccentBeats(accentInput, signatureTop), [accentInput, signatureTop]);
  const audioRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<number | null>(null);
  const beatRef = useRef(1);
  const barRef = useRef(1);
  const profileHydratingRef = useRef(false);
  const profileHydrateTimerRef = useRef<number | null>(null);

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
    if (profileHydrateTimerRef.current !== null) {
      window.clearTimeout(profileHydrateTimerRef.current);
      profileHydrateTimerRef.current = null;
    }
    if (!profileKey) {
      profileHydratingRef.current = false;
      return;
    }
    profileHydratingRef.current = true;
    const preset = readPresetStore()[profileKey];
    if (preset) {
      setBpm(preset.bpm);
      setBpmInput(String(preset.bpm));
      setSignatureTop(preset.signatureTop);
      setSignatureBottom(preset.signatureBottom);
      setAccentInput(preset.accentInput || "1");
      setMasterVolume(preset.masterVolume);
      setError("");
    }
    profileHydrateTimerRef.current = window.setTimeout(() => {
      profileHydratingRef.current = false;
      profileHydrateTimerRef.current = null;
    }, 0);
    return () => {
      if (profileHydrateTimerRef.current !== null) {
        window.clearTimeout(profileHydrateTimerRef.current);
        profileHydrateTimerRef.current = null;
      }
    };
  }, [profileKey]);

  useEffect(() => {
    if (!profileKey) return;
    if (profileHydratingRef.current) return;
    const store = readPresetStore();
    const nextPreset: MetronomePreset = {
      bpm,
      signatureTop,
      signatureBottom,
      accentInput,
      masterVolume,
    };
    const prevPreset = store[profileKey];
    if (
      prevPreset &&
      prevPreset.bpm === nextPreset.bpm &&
      prevPreset.signatureTop === nextPreset.signatureTop &&
      prevPreset.signatureBottom === nextPreset.signatureBottom &&
      prevPreset.accentInput === nextPreset.accentInput &&
      Math.abs(prevPreset.masterVolume - nextPreset.masterVolume) < 0.0001
    ) {
      return;
    }
    store[profileKey] = nextPreset;
    writePresetStore(store);
  }, [profileKey, bpm, signatureTop, signatureBottom, accentInput, masterVolume]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (profileHydrateTimerRef.current !== null) {
        window.clearTimeout(profileHydrateTimerRef.current);
        profileHydrateTimerRef.current = null;
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
    profileKey,
    setOpen,
    setBpmInput,
    setSignatureTop: (value) => setSignatureTop(clampInt(value, 1, 12, 4)),
    setSignatureBottom: (value) => setSignatureBottom(clampInt(value, 1, 16, 4)),
    setAccentInput,
    setMasterVolume: (value) => setMasterVolume(clampFloat(value, 0.01, 1, 0.65)),
    setShowAdvanced,
    setStrongHz: (value) => setStrongHz(clampInt(value, 300, 3200, 1350)),
    setWeakHz: (value) => setWeakHz(clampInt(value, 200, 2800, 900)),
    setStrongWave,
    setWeakWave,
    setStrongGain: (value) => setStrongGain(clampFloat(value, 0.2, 1.5, 1.0)),
    setWeakGain: (value) => setWeakGain(clampFloat(value, 0.1, 1.5, 0.65)),
    setProfileKey: (value) => setProfileKey(String(value || "").trim()),
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
  forceVisible = false,
}: {
  placement?: "inline" | "floating";
  visible?: boolean;
  forceVisible?: boolean;
}) {
  const metro = useMetronome();
  const beats = Array.from({ length: metro.signatureTop }).map((_, idx) => idx + 1);
  const accentSet = useMemo(() => parseAccentBeats(metro.accentInput, metro.signatureTop), [metro.accentInput, metro.signatureTop]);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (!visible) setSettingsOpen(false);
  }, [visible]);

  if (!visible) return null;
  if (!forceVisible && !metro.running && !metro.open) return null;

  const panel = (
    <div
      className={`metronome-pip-panel ${placement}`}
      data-testid={placement === "inline" ? "global-metronome-pip-inline" : "global-metronome-pip-floating"}
    >
      <div className="metronome-pip-head">
        <strong>
          {metro.bpm} BPM · {signatureLabel(metro.signatureTop, metro.signatureBottom)}
        </strong>
        <button
          type="button"
          className={`tiny-info ${settingsOpen ? "active-mini" : ""}`}
          onClick={() => setSettingsOpen((prev) => !prev)}
          title="메트로놈 설정"
        >
          ⚙
        </button>
      </div>
      <div className="metronome-pip-main">
        <div className="metronome-visual metronome-pip-visual">
          {beats.map((value) => {
            const active = metro.running && value === metro.beat;
            const accent = accentSet.has(value);
            return <span key={`pip_beat_${value}`} className={`metronome-light ${active ? "active" : ""} ${accent ? "accent" : ""}`} />;
          })}
        </div>
        <div className="metronome-pip-transport">
          <button type="button" className={metro.running ? "danger-btn" : "primary-btn"} onClick={() => void metro.toggle()}>
            {metro.running ? "중지" : "시작"}
          </button>
          <small className="muted">{metro.running ? `${metro.beat}/${metro.signatureTop}` : "OFF"}</small>
        </div>
      </div>
      {settingsOpen ? (
        <div className="metronome-pip-settings">
          <div className="metronome-pip-bpm-compact">
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
          <input type="range" min={BPM_MIN} max={BPM_MAX} value={metro.bpm} onChange={(event) => metro.setBpmValue(Number(event.target.value))} />
          <div className="metronome-signature-pills compact">
            {SIGNATURE_PRESETS.map((preset) => {
              const active = metro.signatureTop === preset.top && metro.signatureBottom === preset.bottom;
              return (
                <button
                  key={`pip_signature_${preset.label}`}
                  type="button"
                  className={`ghost-btn compact-add-btn ${active ? "active-mini" : ""}`}
                  onClick={() => {
                    metro.setSignatureTop(preset.top);
                    metro.setSignatureBottom(preset.bottom);
                  }}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
          <label className="metronome-volume-inline">
            <small>VOL</small>
            <input type="range" min={0.01} max={1} step={0.01} value={metro.masterVolume} onChange={(event) => metro.setMasterVolume(Number(event.target.value))} />
          </label>
        </div>
      ) : null}
      {metro.error ? <small className="danger-text">{metro.error}</small> : null}
    </div>
  );

  if (placement === "floating" && typeof document !== "undefined") {
    return createPortal(panel, document.body);
  }
  return panel;
}

export function GlobalMetronomeDock({ embedded = false }: { embedded?: boolean }) {
  const metro = useMetronome();
  const [embeddedExpanded, setEmbeddedExpanded] = useState(false);
  const beats = Array.from({ length: metro.signatureTop }).map((_, idx) => idx + 1);
  const accentSet = useMemo(() => parseAccentBeats(metro.accentInput, metro.signatureTop), [metro.accentInput, metro.signatureTop]);
  const showDock = embedded ? embeddedExpanded : metro.open;
  const toggleDock = () => {
    if (embedded) {
      setEmbeddedExpanded((prev) => !prev);
      return;
    }
    metro.setOpen(!metro.open);
  };

  return (
    <div className={`metronome-inline ${embedded ? "embedded" : ""}`}>
      <button className={`metronome-toggle ${metro.running ? "running" : ""}`} onClick={toggleDock} title={showDock ? "메트로놈 접기" : "메트로놈 열기"}>
        <span>메트로놈</span>
        <strong>
          {metro.bpm} BPM · {signatureLabel(metro.signatureTop, metro.signatureBottom)}
        </strong>
        <small>{showDock ? "접기" : "열기"}</small>
      </button>

      {showDock ? (
        <aside className={`metronome-dock card ${embedded ? "embedded" : ""}`}>
          <div className="row metronome-dock-top">
            <strong>Metronome</strong>
            <div className="row">
              <button className={`tiny-info ${metro.showAdvanced ? "active-mini" : ""}`} onClick={() => metro.setShowAdvanced(!metro.showAdvanced)} title="고급 설정">
                ⚙
              </button>
              <button className="tiny-info" onClick={toggleDock} title="접기">
                ×
              </button>
            </div>
          </div>

          <div className="metronome-main-row">
            <div className="metronome-visual metronome-visual-hero">
              {beats.map((value) => {
                const active = metro.running && value === metro.beat;
                const accent = accentSet.has(value);
                return <span key={value} className={`metronome-light ${active ? "active" : ""} ${accent ? "accent" : ""}`} title={`Beat ${value}`} />;
              })}
            </div>
            <div className="metronome-main-actions">
              <button className={metro.running ? "danger-btn" : "primary-btn"} onClick={() => void metro.toggle()}>
                {metro.running ? "정지" : "시작"}
              </button>
              <small className="muted">Bar {metro.bar} · Beat {metro.beat}</small>
            </div>
          </div>

          <div className="metronome-compact-controls">
            <div className="metronome-bpm-cluster">
              <label>BPM</label>
              <div className="metronome-bpm-row">
                <button type="button" className="ghost-btn compact-add-btn" onClick={() => metro.setBpmValue(Math.max(BPM_MIN, metro.bpm - 1))}>
                  -
                </button>
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
                <button type="button" className="ghost-btn compact-add-btn" onClick={() => metro.setBpmValue(Math.min(BPM_MAX, metro.bpm + 1))}>
                  +
                </button>
              </div>
              <input type="range" min={BPM_MIN} max={BPM_MAX} value={metro.bpm} onChange={(event) => metro.setBpmValue(Number(event.target.value))} />
            </div>

            <div className="metronome-signature-cluster">
              <label>박자</label>
              <div className="metronome-signature-pills">
                {SIGNATURE_PRESETS.map((preset) => {
                  const active = metro.signatureTop === preset.top && metro.signatureBottom === preset.bottom;
                  return (
                    <button
                      key={`signature_${preset.label}`}
                      type="button"
                      className={`ghost-btn compact-add-btn ${active ? "active-mini" : ""}`}
                      onClick={() => {
                        metro.setSignatureTop(preset.top);
                        metro.setSignatureBottom(preset.bottom);
                      }}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="metronome-volume-inline">
              <small>볼륨</small>
              <input type="range" min={0.01} max={1} step={0.01} value={metro.masterVolume} onChange={(event) => metro.setMasterVolume(Number(event.target.value))} />
            </label>
          </div>

          {metro.showAdvanced ? (
            <div className="metronome-advanced">
              <label>
                강박
                <input value={metro.accentInput} onChange={(event) => metro.setAccentInput(event.target.value)} placeholder="1,3" />
              </label>
              <label>
                분자
                <input type="number" min={1} max={12} value={metro.signatureTop} onChange={(event) => metro.setSignatureTop(Number(event.target.value))} />
              </label>
              <label>
                분모
                <input type="number" min={1} max={16} value={metro.signatureBottom} onChange={(event) => metro.setSignatureBottom(Number(event.target.value))} />
              </label>
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
              <label>
                Strong Gain
                <input type="number" step={0.05} min={0.2} max={1.5} value={metro.strongGain} onChange={(event) => metro.setStrongGain(Number(event.target.value))} />
              </label>
              <label>
                Weak Gain
                <input type="number" step={0.05} min={0.1} max={1.5} value={metro.weakGain} onChange={(event) => metro.setWeakGain(Number(event.target.value))} />
              </label>
            </div>
          ) : null}

          {metro.error ? <small className="danger-text">{metro.error}</small> : null}
        </aside>
      ) : null}
    </div>
  );
}
