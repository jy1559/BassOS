import { useEffect, useMemo, useRef, useState } from "react";
import type { Lang } from "../i18n";
import { useMetronome } from "../metronome";

type Props = { lang: Lang };

type LengthKey = "1/16" | "1/8" | "1/4" | "1/2" | "1";
type LengthModifier = "normal" | "dot" | "triplet";

type TabNote = {
  id: string;
  stringNo: 1 | 2 | 3 | 4;
  fret: string;
  isRest: boolean;
  length: LengthKey;
  modifier: LengthModifier;
};

type TabProject = {
  version: number;
  bar_count: number;
  signature_top: number;
  signature_bottom: number;
  bpm: number;
  bars: TabNote[][];
  created_at: string;
};

const MIN_BARS = 4;

const lengthOrder: LengthKey[] = ["1/16", "1/8", "1/4", "1/2", "1"];
const lengthByKey: Record<string, LengthKey> = {
  q: "1/16",
  w: "1/8",
  e: "1/4",
  r: "1/2",
  t: "1"
};

const quarterUnits: Record<LengthKey, number> = {
  "1/16": 0.25,
  "1/8": 0.5,
  "1/4": 1,
  "1/2": 2,
  "1": 4
};

const stringBaseHz: Record<1 | 2 | 3 | 4, number> = {
  1: 98.0,
  2: 73.42,
  3: 55.0,
  4: 41.2
};

const stringLabel: Record<1 | 2 | 3 | 4, string> = {
  1: "G",
  2: "D",
  3: "A",
  4: "E"
};

function modifierScale(modifier: LengthModifier): number {
  if (modifier === "dot") return 1.5;
  if (modifier === "triplet") return 2 / 3;
  return 1;
}

function noteUnits(note: TabNote): number {
  return quarterUnits[note.length] * modifierScale(note.modifier);
}

function nextId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `n_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function createNote(overrides?: Partial<TabNote>): TabNote {
  return {
    id: nextId(),
    stringNo: 4,
    fret: "",
    isRest: false,
    length: "1/4",
    modifier: "normal",
    ...overrides
  };
}

function createBar(): TabNote[] {
  return [createNote({ isRest: true, length: "1", modifier: "normal" })];
}

function cloneNote(note: TabNote): TabNote {
  return {
    ...note,
    id: nextId(),
  };
}

function cloneBar(bar: TabNote[]): TabNote[] {
  return bar.map((note) => cloneNote(note));
}

function cloneBars(bars: TabNote[][]): TabNote[][] {
  return bars.map((bar) => cloneBar(bar));
}

function ensureBarCount(raw: number): number {
  const safe = Math.max(MIN_BARS, Math.floor(raw || MIN_BARS));
  return Math.ceil(safe / 4) * 4;
}

function resizeBars(prev: TabNote[][], nextCount: number): TabNote[][] {
  if (prev.length >= nextCount) {
    return prev.slice(0, nextCount).map((bar) => (bar.length ? bar : createBar()));
  }
  return [...prev, ...Array.from({ length: nextCount - prev.length }).map(() => createBar())];
}

function sanitizeLength(raw: unknown): LengthKey {
  const asString = String(raw ?? "");
  return lengthOrder.includes(asString as LengthKey) ? (asString as LengthKey) : "1/4";
}

function sanitizeModifier(raw: unknown): LengthModifier {
  const asString = String(raw ?? "normal");
  if (asString === "dot" || asString === "triplet") return asString;
  return "normal";
}

function sanitizeNote(raw: unknown): TabNote {
  const v = typeof raw === "object" && raw ? (raw as Record<string, unknown>) : {};
  const no = Number(v.stringNo);
  return {
    id: String(v.id || nextId()),
    stringNo: ([1, 2, 3, 4].includes(no) ? no : 4) as 1 | 2 | 3 | 4,
    fret: String(v.fret ?? "").replace(/[^0-9]/g, "").slice(0, 2),
    isRest: Boolean(v.isRest),
    length: sanitizeLength(v.length),
    modifier: sanitizeModifier(v.modifier)
  };
}

function sanitizeBars(raw: unknown, countHint: number): TabNote[][] {
  const count = ensureBarCount(countHint);
  if (!Array.isArray(raw)) {
    return Array.from({ length: count }).map(() => createBar());
  }
  const bars = raw.map((bar) => {
    if (!Array.isArray(bar)) return createBar();
    const notes = bar.map((item) => sanitizeNote(item));
    return notes.length ? notes : createBar();
  });
  return resizeBars(bars, count);
}

function triggerDownload(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function toTabText(bar: TabNote[]): string[] {
  const lines = ["|", "|", "|", "|"];
  for (const note of bar) {
    const slots = Math.max(2, Math.round(noteUnits(note) * 4) + 1);
    for (let s = 1; s <= 4; s += 1) {
      if (note.stringNo === s) {
        const suffix = note.modifier === "dot" ? "." : note.modifier === "triplet" ? "3" : "";
        const token = note.isRest ? `r${suffix}` : `${note.fret || "0"}${suffix}`;
        lines[s - 1] += token.padEnd(slots, "-");
      } else {
        lines[s - 1] += "-".repeat(slots);
      }
    }
  }
  return lines.map((line) => `${line}|`);
}

function barCapacity(signatureTop: number, signatureBottom: number): number {
  return signatureTop * (4 / Math.max(1, signatureBottom));
}

function usedUnits(bar: TabNote[]): number {
  return bar.reduce((acc, note) => acc + noteUnits(note), 0);
}

export function PracticeToolsPage({ lang }: Props) {
  const metro = useMetronome();

  const [barCount, setBarCount] = useState(4);
  const [bars, setBars] = useState<TabNote[][]>(Array.from({ length: 4 }).map(() => createBar()));
  const [selectedBarIdx, setSelectedBarIdx] = useState(0);
  const [selectedNoteIdx, setSelectedNoteIdx] = useState(0);
  const [playCursor, setPlayCursor] = useState<{ barIdx: number; noteIdx: number } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [useMetronomeWithPlay, setUseMetronomeWithPlay] = useState(true);
  const [barClipboard, setBarClipboard] = useState<TabNote[] | null>(null);
  const [barRepeatCount, setBarRepeatCount] = useState(1);
  const [noteRepeatCount, setNoteRepeatCount] = useState(2);
  const [composeLength, setComposeLength] = useState<LengthKey>("1/4");
  const [composeModifier, setComposeModifier] = useState<LengthModifier>("normal");
  const [composeStringNo, setComposeStringNo] = useState<1 | 2 | 3 | 4>(4);
  const [composeRest, setComposeRest] = useState(false);

  const jsonInputRef = useRef<HTMLInputElement | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const playTokenRef = useRef(0);
  const historyRef = useRef<TabNote[][][]>([]);

  const selectedBar = bars[selectedBarIdx] ?? [];
  const selectedNote = selectedBar[selectedNoteIdx] ?? null;
  const selectedUsed = useMemo(() => usedUnits(selectedBar), [selectedBar]);
  const capacity = useMemo(() => barCapacity(metro.signatureTop, metro.signatureBottom), [metro.signatureTop, metro.signatureBottom]);
  const overCapacity = selectedUsed > capacity;

  const previewText = useMemo(() => {
    const rowG: string[] = [];
    const rowD: string[] = [];
    const rowA: string[] = [];
    const rowE: string[] = [];
    bars.forEach((bar, idx) => {
      const [g, d, a, e] = toTabText(bar);
      rowG.push(`${idx + 1}`.padStart(2, "0") + g);
      rowD.push("  " + d);
      rowA.push("  " + a);
      rowE.push("  " + e);
    });
    return [rowG.join("  "), rowD.join("  "), rowA.join("  "), rowE.join("  ")].join("\n");
  }, [bars]);

  const applyBars = (updater: (prev: TabNote[][]) => TabNote[][]) => {
    setBars((prev) => {
      historyRef.current.push(cloneBars(prev));
      if (historyRef.current.length > 120) historyRef.current.shift();
      return updater(prev);
    });
  };

  const undoBars = () => {
    const previous = historyRef.current.pop();
    if (!previous) return;
    setBars(cloneBars(previous));
    setSelectedNoteIdx(0);
  };

  const clearHistory = () => {
    historyRef.current = [];
  };

  const updateSelectedNote = (patch: Partial<TabNote>) => {
    applyBars((prev) => prev.map((bar, bIdx) => {
      if (bIdx !== selectedBarIdx) return bar;
      return bar.map((note, nIdx) => nIdx !== selectedNoteIdx ? note : { ...note, ...patch });
    }));
  };

  const appendComposedNote = (stringNo: 1 | 2 | 3 | 4, fret: string, rest = composeRest) => {
    let insertIdx = 0;
    applyBars((prev) => prev.map((bar, idx) => {
      if (idx !== selectedBarIdx) return bar;
      insertIdx = bar.length;
      const next = [
        ...bar,
        createNote({
          stringNo,
          fret: rest ? "" : fret,
          isRest: rest,
          length: composeLength,
          modifier: composeModifier,
        }),
      ];
      return next;
    }));
    setSelectedNoteIdx(insertIdx);
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === "c") {
        if (selectedBar.length) {
          setBarClipboard(cloneBar(selectedBar));
        }
        event.preventDefault();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === "z") {
        undoBars();
        event.preventDefault();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === "v") {
        if (!barClipboard) return;
        applyBars((prev) =>
          prev.map((bar, idx) => (idx === selectedBarIdx ? cloneBar(barClipboard) : bar))
        );
        setSelectedNoteIdx(0);
        event.preventDefault();
        return;
      }
      if (lengthByKey[key]) {
        const nextLength = lengthByKey[key];
        setComposeLength(nextLength);
        if (selectedNote) updateSelectedNote({ length: nextLength });
        event.preventDefault();
        return;
      }
      if (key === "a") {
        setComposeRest((prev) => !prev);
        if (selectedNote) updateSelectedNote({ isRest: !selectedNote.isRest, fret: selectedNote.isRest ? selectedNote.fret : "" });
        event.preventDefault();
        return;
      }
      if (key === "s") {
        const next = composeModifier === "dot" ? "normal" : "dot";
        setComposeModifier(next);
        if (selectedNote) updateSelectedNote({ modifier: next });
        event.preventDefault();
        return;
      }
      if (key === "d") {
        const next = composeModifier === "triplet" ? "normal" : "triplet";
        setComposeModifier(next);
        if (selectedNote) updateSelectedNote({ modifier: next });
        event.preventDefault();
        return;
      }
      if (key === "f") {
        setComposeModifier("normal");
        if (selectedNote) updateSelectedNote({ modifier: "normal" });
        event.preventDefault();
        return;
      }
      if (!selectedNote) return;
      if (key === "arrowup") {
        const next = Math.max(1, selectedNote.stringNo - 1) as 1 | 2 | 3 | 4;
        setComposeStringNo(next);
        updateSelectedNote({ stringNo: next });
        event.preventDefault();
        return;
      }
      if (key === "arrowdown") {
        const next = Math.min(4, selectedNote.stringNo + 1) as 1 | 2 | 3 | 4;
        setComposeStringNo(next);
        updateSelectedNote({ stringNo: next });
        event.preventDefault();
        return;
      }
      if (/^[0-9]$/.test(key)) {
        const next = `${selectedNote.fret}${key}`.slice(-2);
        updateSelectedNote({ fret: next, isRest: false });
        event.preventDefault();
        return;
      }
      if (key === "backspace") {
        updateSelectedNote({ fret: selectedNote.fret.slice(0, -1) });
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedNote, selectedBar, selectedBarIdx, selectedNoteIdx, barClipboard, composeModifier]);

  const ensureAudio = async (): Promise<AudioContext> => {
    if (!audioRef.current) {
      audioRef.current = new window.AudioContext();
    }
    if (audioRef.current.state === "suspended") {
      await audioRef.current.resume();
    }
    return audioRef.current;
  };

  const playTone = async (hz: number, sec: number, volume = 0.3) => {
    const ctx = await ensureAudio();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = hz;
    gain.gain.value = volume;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime;
    osc.start(now);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + Math.max(0.04, sec * 0.92));
    osc.stop(now + Math.max(0.04, sec * 0.92));
  };

  const playNote = (note: TabNote, sec: number): void => {
    if (note.isRest) return;
    if (!note.fret.trim()) return;
    const fret = Number(note.fret);
    if (!Number.isFinite(fret)) return;
    const hz = stringBaseHz[note.stringNo] * Math.pow(2, Math.max(0, Math.min(36, fret)) / 12);
    void playTone(hz, sec);
  };

  const stopPlayback = () => {
    playTokenRef.current += 1;
    setPlaying(false);
    setPlayCursor(null);
  };

  const startPlayback = async () => {
    if (playing) {
      stopPlayback();
      return;
    }
    const token = playTokenRef.current + 1;
    playTokenRef.current = token;
    setPlaying(true);

    let autoStartedMetronome = false;
    if (useMetronomeWithPlay && !metro.running) {
      const started = await metro.start();
      autoStartedMetronome = started;
    }

    const bpm = Math.max(30, metro.bpm);
    for (let barIdx = 0; barIdx < bars.length; barIdx += 1) {
      const bar = bars[barIdx] ?? [];
      for (let noteIdx = 0; noteIdx < bar.length; noteIdx += 1) {
        if (playTokenRef.current !== token) break;
        const note = bar[noteIdx];
        setPlayCursor({ barIdx, noteIdx });
        const sec = (60 / bpm) * noteUnits(note);
        playNote(note, sec);
        await new Promise((resolve) => window.setTimeout(resolve, Math.max(40, sec * 1000)));
      }
      if (playTokenRef.current !== token) break;
    }

    if (playTokenRef.current === token) {
      setPlaying(false);
      setPlayCursor(null);
      if (autoStartedMetronome) {
        metro.stop();
      }
    }
  };

  const addFourBars = () => {
    setBarCount((prev) => {
      const next = ensureBarCount(prev + 4);
      applyBars((old) => resizeBars(old, next));
      return next;
    });
  };

  const removeFourBars = () => {
    setBarCount((prev) => {
      const next = ensureBarCount(Math.max(MIN_BARS, prev - 4));
      applyBars((old) => resizeBars(old, next));
      setSelectedBarIdx((current) => Math.min(current, next - 1));
      setSelectedNoteIdx(0);
      return next;
    });
  };

  const resetAll = () => {
    clearHistory();
    setBarCount(4);
    setBars(Array.from({ length: 4 }).map(() => createBar()));
    setSelectedBarIdx(0);
    setSelectedNoteIdx(0);
    stopPlayback();
  };

  const saveJson = () => {
    const payload: TabProject = {
      version: 3,
      bar_count: barCount,
      signature_top: metro.signatureTop,
      signature_bottom: metro.signatureBottom,
      bpm: metro.bpm,
      bars,
      created_at: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    triggerDownload(`bassos_tab_${Date.now()}.json`, blob);
  };

  const loadJson = async (file: File | null) => {
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text()) as Partial<TabProject> & {
        tab?: { bars?: number; cells?: unknown[] };
      };
      const nextCount = ensureBarCount(Number(raw.bar_count ?? raw.tab?.bars ?? 4));
      let nextBars = sanitizeBars(raw.bars, nextCount);

      if (!raw.bars && Array.isArray(raw.tab?.cells)) {
        const cells = raw.tab.cells.map((cell) => sanitizeNote(cell));
        nextBars = Array.from({ length: nextCount }).map((_, barIdx) => {
          const start = barIdx * 16;
          const block = cells.slice(start, start + 16);
          return block.length ? block : createBar();
        });
      }

      setBarCount(nextCount);
      clearHistory();
      setBars(nextBars);
      setSelectedBarIdx(0);
      setSelectedNoteIdx(0);

      if (raw.signature_top) metro.setSignatureTop(Number(raw.signature_top));
      if (raw.signature_bottom) metro.setSignatureBottom(Number(raw.signature_bottom));
      if (raw.bpm) {
        metro.setBpmInput(String(raw.bpm));
        metro.applyBpmInput();
      }

      window.alert(lang === "ko" ? "TAB JSON을 불러왔습니다." : "TAB JSON loaded.");
    } catch {
      window.alert(lang === "ko" ? "JSON 형식이 올바르지 않습니다." : "Invalid JSON format.");
    }
  };

  const saveImage = () => {
    const barsPerRow = 4;
    const rows = Math.ceil(barCount / barsPerRow);
    const marginX = 24;
    const marginY = 28;
    const barGap = 16;
    const rowGap = 50;
    const unitWidth = 28;

    const rowWidths = Array.from({ length: rows }).map((_, rowIdx) => {
      const first = rowIdx * barsPerRow;
      const list = bars.slice(first, first + barsPerRow);
      return list.reduce((acc, bar) => {
        const width = Math.max(1.5, usedUnits(bar)) * unitWidth;
        return acc + width;
      }, 0) + Math.max(0, list.length - 1) * barGap;
    });

    const width = marginX * 2 + Math.max(...rowWidths, 500);
    const height = marginY * 2 + rows * (4 * 22 + 48) + Math.max(0, rows - 1) * rowGap;

    const canvas = document.createElement("canvas");
    canvas.width = width * 2;
    canvas.height = height * 2;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(2, 2);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#162127";
    ctx.font = "bold 16px Segoe UI";
    ctx.fillText(`BassOS TAB  ${metro.bpm} BPM  ${metro.signatureTop}/${metro.signatureBottom}`, marginX, 20);

    for (let rowIdx = 0; rowIdx < rows; rowIdx += 1) {
      const rowY = marginY + rowIdx * (4 * 22 + 48 + rowGap);
      const firstBar = rowIdx * barsPerRow;
      const rowBars = bars.slice(firstBar, firstBar + barsPerRow);
      let xCursor = marginX;

      for (let localIdx = 0; localIdx < rowBars.length; localIdx += 1) {
        const barIdx = firstBar + localIdx;
        const bar = rowBars[localIdx];
        const widthUnits = Math.max(1.5, usedUnits(bar));
        const barWidth = widthUnits * unitWidth;

        for (let line = 0; line < 4; line += 1) {
          const y = rowY + line * 22;
          ctx.strokeStyle = "#9db2b9";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(xCursor, y);
          ctx.lineTo(xCursor + barWidth, y);
          ctx.stroke();
        }

        ctx.strokeStyle = "#5d6c72";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(xCursor, rowY);
        ctx.lineTo(xCursor, rowY + 66);
        ctx.moveTo(xCursor + barWidth, rowY);
        ctx.lineTo(xCursor + barWidth, rowY + 66);
        ctx.stroke();

        ctx.fillStyle = "#5d6c72";
        ctx.font = "12px Segoe UI";
        ctx.fillText(`Bar ${barIdx + 1}`, xCursor + 3, rowY + 84);

        let noteX = xCursor;
        for (const note of bar) {
          const noteWidth = noteUnits(note) * unitWidth;
          const suffix = note.modifier === "dot" ? "." : note.modifier === "triplet" ? "3" : "";
          const text = note.isRest ? `r${suffix}` : `${note.fret || "-"}${suffix}`;
          const y = rowY + (note.stringNo - 1) * 22 + 4;
          ctx.fillStyle = "#172026";
          ctx.font = "12px Consolas";
          ctx.fillText(text, noteX + 4, y);
          noteX += noteWidth;
        }

        xCursor += barWidth + barGap;
      }
    }

    canvas.toBlob((blob) => {
      if (!blob) return;
      triggerDownload(`bassos_tab_${Date.now()}.png`, blob);
    }, "image/png");
  };

  useEffect(() => {
    return () => {
      stopPlayback();
      if (audioRef.current) {
        void audioRef.current.close();
      }
    };
  }, []);

  return (
    <div className="page-grid songs-page-list">
      <section className="card" data-testid="tutorial-tools-metronome">
        <div className="row">
          <h2>{lang === "ko" ? "TAB 메이커" : "TAB Maker"}</h2>
          <small className="muted">{lang === "ko" ? `${barCount}마디 (4마디 단위)` : `${barCount} bars (4-bar units)`}</small>
        </div>

        <div className="tab-toolbar">
          <button className="ghost-btn" onClick={addFourBars}>+4 {lang === "ko" ? "마디" : "Bars"}</button>
          <button className="ghost-btn" onClick={removeFourBars} disabled={barCount <= MIN_BARS}>-4 {lang === "ko" ? "마디" : "Bars"}</button>
          <button className="ghost-btn" onClick={saveJson}>{lang === "ko" ? "JSON 저장" : "Save JSON"}</button>
          <button className="ghost-btn" onClick={() => jsonInputRef.current?.click()}>{lang === "ko" ? "JSON 불러오기" : "Load JSON"}</button>
          <button className="ghost-btn" onClick={saveImage}>{lang === "ko" ? "이미지 저장" : "Save Image"}</button>
          <button className={`primary-btn ${playing ? "danger-border" : ""}`} onClick={() => void startPlayback()}>
            {playing ? (lang === "ko" ? "재생 중지" : "Stop Playback") : (lang === "ko" ? "TAB 재생" : "Play TAB")}
          </button>
          <button className="ghost-btn" onClick={resetAll}>{lang === "ko" ? "초기화" : "Reset"}</button>
          <label className="inline">
            <input type="checkbox" checked={useMetronomeWithPlay} onChange={(event) => setUseMetronomeWithPlay(event.target.checked)} />
            {lang === "ko" ? "재생 시 메트로놈" : "Metronome while playback"}
          </label>
          <div className="inline">
            <input
              type="number"
              min={1}
              max={16}
              value={barRepeatCount}
              onChange={(event) => setBarRepeatCount(Math.max(1, Math.min(16, Number(event.target.value) || 1)))}
              style={{ width: 64 }}
            />
            <button
              className="ghost-btn"
              onClick={() => {
                if (!selectedBar.length) return;
                setBarClipboard(cloneBar(selectedBar));
                applyBars((prev) => {
                  const next = [...prev];
                  for (let i = 1; i <= barRepeatCount; i += 1) {
                    const idx = selectedBarIdx + i;
                    if (idx >= next.length) break;
                    next[idx] = cloneBar(selectedBar);
                  }
                  return next;
                });
              }}
            >
              {lang === "ko" ? "다음 마디 반복" : "Repeat Next Bars"}
            </button>
          </div>
        </div>

        <small className="muted tab-shortcut-hint">
          {lang === "ko" ? "단축키: Ctrl+C/V=마디 복사/붙여넣기, Ctrl+Z=실행 취소, A=쉼표, Q/W/E/R/T=길이, S=점음표, D=셋잇단, F=일반, 숫자=프렛" : "Shortcuts: Ctrl+C/V bar copy-paste, Ctrl+Z undo, A rest, Q/W/E/R/T length, S dotted, D triplet, F normal, numbers fret"}
        </small>

        <input
          ref={jsonInputRef}
          type="file"
          accept="application/json,.json"
          style={{ display: "none" }}
          onChange={async (event) => {
            await loadJson(event.target.files?.[0] ?? null);
            event.target.value = "";
          }}
        />

        <div className="tab-builder-layout">
          <div className="tab-editor-panel">
            <label>
              {lang === "ko" ? "편집 마디" : "Editing Bar"}
              <select
                value={selectedBarIdx}
                onChange={(event) => {
                  setSelectedBarIdx(Number(event.target.value));
                  setSelectedNoteIdx(0);
                }}
              >
                {Array.from({ length: barCount }).map((_, idx) => (
                  <option key={idx} value={idx}>Bar {idx + 1}</option>
                ))}
              </select>
            </label>

            <div className={`tab-usage ${overCapacity ? "warn" : ""}`}>
              <strong>{lang === "ko" ? "마디 길이" : "Bar Length"}</strong>
              <span>{selectedUsed.toFixed(2)} / {capacity.toFixed(2)}</span>
            </div>

            <div className="tab-compose-panel">
              <div className="switch-row">
                {lengthOrder.map((len) => (
                  <button
                    key={len}
                    className={`ghost-btn ${composeLength === len ? "active-mini" : ""}`}
                    onClick={() => setComposeLength(len)}
                    title={`Shortcut: ${Object.entries(lengthByKey).find(([, value]) => value === len)?.[0]?.toUpperCase() ?? ""}`}
                  >
                    {len}
                  </button>
                ))}
              </div>
              <div className="switch-row">
                <button className={`ghost-btn ${composeModifier === "normal" ? "active-mini" : ""}`} onClick={() => setComposeModifier("normal")}>
                  {lang === "ko" ? "일반 (F)" : "Normal (F)"}
                </button>
                <button className={`ghost-btn ${composeModifier === "dot" ? "active-mini" : ""}`} onClick={() => setComposeModifier("dot")}>
                  {lang === "ko" ? "점 (S)" : "Dotted (S)"}
                </button>
                <button className={`ghost-btn ${composeModifier === "triplet" ? "active-mini" : ""}`} onClick={() => setComposeModifier("triplet")}>
                  {lang === "ko" ? "셋잇단 (D)" : "Triplet (D)"}
                </button>
                <label className="inline">
                  <input type="checkbox" checked={composeRest} onChange={(event) => setComposeRest(event.target.checked)} />
                  {lang === "ko" ? "쉼표(A)" : "Rest (A)"}
                </label>
                <label>
                  {lang === "ko" ? "기본 줄" : "String"}
                  <select value={composeStringNo} onChange={(event) => setComposeStringNo(Number(event.target.value) as 1 | 2 | 3 | 4)}>
                    {[1, 2, 3, 4].map((stringNo) => <option key={stringNo} value={stringNo}>{stringLabel[stringNo as 1 | 2 | 3 | 4]}</option>)}
                  </select>
                </label>
              </div>
            </div>

            <div className="tab-note-list compact-list">
              {selectedBar.map((note, noteIdx) => {
                const active = (playCursor?.barIdx === selectedBarIdx && playCursor?.noteIdx === noteIdx) || selectedNoteIdx === noteIdx;
                const text = note.isRest ? "Rest" : `${stringLabel[note.stringNo]}-${note.fret || "0"}`;
                const modifier = note.modifier === "dot" ? "·" : note.modifier === "triplet" ? "(3)" : "";
                return (
                  <button
                    key={note.id}
                    className={`tab-note-chip ${active ? "active" : ""}`}
                    onClick={() => {
                      setSelectedNoteIdx(noteIdx);
                      setComposeLength(note.length);
                      setComposeModifier(note.modifier);
                      setComposeStringNo(note.stringNo);
                      setComposeRest(note.isRest);
                    }}
                  >
                    <strong>#{noteIdx + 1}</strong>
                    <span>{text}</span>
                    <small>{note.length}{modifier}</small>
                  </button>
                );
              })}
            </div>

            <div className="row">
              <button className="ghost-btn" onClick={() => {
                appendComposedNote(composeStringNo, "0", composeRest);
              }}>{lang === "ko" ? "노트 추가" : "Add Note"}</button>
              <button className="ghost-btn" onClick={() => {
                setBarClipboard(cloneBar(selectedBar));
              }} disabled={!selectedBar.length}>{lang === "ko" ? "마디 복사" : "Copy Bar"}</button>
              <button className="ghost-btn" onClick={() => {
                if (!barClipboard) return;
                applyBars((prev) => prev.map((bar, idx) => idx !== selectedBarIdx ? bar : cloneBar(barClipboard)));
                setSelectedNoteIdx(0);
              }} disabled={!barClipboard}>{lang === "ko" ? "마디 붙여넣기" : "Paste Bar"}</button>
              <button className="ghost-btn" onClick={() => {
                if (!selectedBar.length) return;
                applyBars((prev) => prev.map((bar, idx) => idx !== selectedBarIdx ? bar : (bar.filter((_, nIdx) => nIdx !== selectedNoteIdx).length ? bar.filter((_, nIdx) => nIdx !== selectedNoteIdx) : createBar())));
                setSelectedNoteIdx((idx) => Math.max(0, idx - 1));
              }}>{lang === "ko" ? "선택 삭제" : "Delete Selected"}</button>
              <button className="ghost-btn" onClick={undoBars}>{lang === "ko" ? "실행 취소 (Ctrl+Z)" : "Undo (Ctrl+Z)"}</button>
            </div>

            {selectedNote ? (
              <>
                <div className="song-form-grid">
                  <label>
                    {lang === "ko" ? "길이" : "Length"}
                    <div className="switch-row">
                      {lengthOrder.map((len) => (
                        <button
                          key={len}
                          className={`ghost-btn ${selectedNote.length === len ? "active-mini" : ""}`}
                          onClick={() => updateSelectedNote({ length: len })}
                        >
                          {len}
                        </button>
                      ))}
                    </div>
                  </label>
                  <label>
                    {lang === "ko" ? "변형" : "Modifier"}
                    <div className="switch-row">
                      <button className={`ghost-btn ${selectedNote.modifier === "normal" ? "active-mini" : ""}`} onClick={() => updateSelectedNote({ modifier: "normal" })}>
                        {lang === "ko" ? "일반" : "Normal"}
                      </button>
                      <button className={`ghost-btn ${selectedNote.modifier === "dot" ? "active-mini" : ""}`} onClick={() => updateSelectedNote({ modifier: "dot" })}>
                        {lang === "ko" ? "점음표" : "Dotted"}
                      </button>
                      <button className={`ghost-btn ${selectedNote.modifier === "triplet" ? "active-mini" : ""}`} onClick={() => updateSelectedNote({ modifier: "triplet" })}>
                        {lang === "ko" ? "셋잇단" : "Triplet"}
                      </button>
                    </div>
                  </label>
                  <label className="inline">
                    <input type="checkbox" checked={selectedNote.isRest} onChange={(event) => updateSelectedNote({ isRest: event.target.checked, fret: event.target.checked ? "" : selectedNote.fret })} />
                    {lang === "ko" ? "쉼표" : "Rest"}
                  </label>
                  <label>
                    {lang === "ko" ? "노트 반복 삽입" : "Repeat Selected Note"}
                    <div className="row">
                      <input
                        type="number"
                        min={1}
                        max={16}
                        value={noteRepeatCount}
                        onChange={(event) => setNoteRepeatCount(Math.max(1, Math.min(16, Number(event.target.value) || 1)))}
                      />
                      <button
                        className="ghost-btn"
                        onClick={() => {
                          applyBars((prev) => prev.map((bar, idx) => {
                            if (idx !== selectedBarIdx) return bar;
                            const insertAt = selectedNoteIdx + 1;
                            const clones = Array.from({ length: noteRepeatCount }).map(() => cloneNote(selectedNote));
                            return [...bar.slice(0, insertAt), ...clones, ...bar.slice(insertAt)];
                          }));
                        }}
                      >
                        {lang === "ko" ? "삽입" : "Insert"}
                      </button>
                    </div>
                  </label>
                </div>

                <div className="tab-fretboard">
                  {[1, 2, 3, 4].map((stringNo) => (
                    <div key={stringNo} className="tab-fret-row">
                      <strong>{stringLabel[stringNo as 1 | 2 | 3 | 4]}</strong>
                      <div className="tab-fret-buttons">
                        {Array.from({ length: 13 }).map((_, fret) => {
                          const active = !composeRest && composeStringNo === stringNo && selectedNote && !selectedNote.isRest && selectedNote.stringNo === stringNo && selectedNote.fret === String(fret);
                          return (
                            <button
                              key={`${stringNo}-${fret}`}
                              className={`tab-fret-btn ${active ? "active" : ""}`}
                              onClick={() => {
                                setComposeStringNo(stringNo as 1 | 2 | 3 | 4);
                                appendComposedNote(stringNo as 1 | 2 | 3 | 4, String(fret), composeRest);
                              }}
                            >
                              {fret}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : null}

            <small className={`muted ${overCapacity ? "danger-text" : ""}`}>
              {overCapacity
                ? (lang === "ko" ? "마디 길이가 박자를 초과했습니다. 길이를 줄여주세요." : "Bar exceeds time signature. Reduce note lengths.")
                : (lang === "ko" ? "길이/변형을 먼저 고르고 프렛 클릭으로 즉시 추가하세요. Ctrl+Z 실행 취소 지원." : "Pick length/modifier first, click fret to append instantly. Ctrl+Z undo supported.")}
            </small>
          </div>

          <div className="tab-preview-panel">
            <h3>{lang === "ko" ? "TAB 미리보기" : "TAB Preview"}</h3>
            <pre className="tab-preview-pre">{previewText}</pre>
          </div>
        </div>
      </section>
    </div>
  );
}
