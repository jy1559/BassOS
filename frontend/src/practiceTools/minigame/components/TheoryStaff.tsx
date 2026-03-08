type TheoryStaffNote = {
  note: string;
  degree: string;
  midi?: number;
  isRoot?: boolean;
};

type StaffClef = "TREBLE" | "BASS";

type Props = {
  notes: TheoryStaffNote[];
  title?: string;
  clef?: StaffClef;
  compact?: boolean;
  onNoteClick?: (note: TheoryStaffNote, index: number) => void;
};

const BASE_RESERVED_SLOTS = 12; // 8 notes + about 4-5 spare positions

const LETTER_INDEX: Record<string, number> = {
  C: 0,
  D: 1,
  E: 2,
  F: 3,
  G: 4,
  A: 5,
  B: 6,
};

function parseNoteWithOctave(note: string): { letter: string; accidental: string; octave: number | null } {
  const hit = /^([A-G])([#b]?)(-?\d+)?/.exec(note.trim());
  if (!hit) return { letter: "C", accidental: "", octave: null };
  return {
    letter: hit[1],
    accidental: hit[2] || "",
    octave: hit[3] ? Number(hit[3]) : null,
  };
}

function midiToLetterAndAccidental(midi: number): { letter: string; accidental: string } {
  const pc = ((Math.round(midi) % 12) + 12) % 12;
  const table: Array<{ letter: string; accidental: string }> = [
    { letter: "C", accidental: "" },
    { letter: "C", accidental: "#" },
    { letter: "D", accidental: "" },
    { letter: "D", accidental: "#" },
    { letter: "E", accidental: "" },
    { letter: "F", accidental: "" },
    { letter: "F", accidental: "#" },
    { letter: "G", accidental: "" },
    { letter: "G", accidental: "#" },
    { letter: "A", accidental: "" },
    { letter: "A", accidental: "#" },
    { letter: "B", accidental: "" },
  ];
  return table[pc] ?? { letter: "C", accidental: "" };
}

function staffStepByNote(note: TheoryStaffNote, clef: StaffClef): { step: number; accidental: string } {
  const parsed = parseNoteWithOctave(note.note);
  const fromMidi = note.midi !== undefined ? midiToLetterAndAccidental(note.midi) : null;
  const letter = parsed.letter || fromMidi?.letter || "C";
  const accidental = parsed.accidental || fromMidi?.accidental || "";

  const letterIdx = LETTER_INDEX[letter] ?? 0;
  const octave =
    parsed.octave !== null
      ? parsed.octave
      : note.midi !== undefined
      ? Math.floor(note.midi / 12) - 1
      : clef === "TREBLE"
      ? 4
      : 2;

  const diatonicIndex = octave * 7 + letterIdx;
  const baseIndex = clef === "TREBLE" ? 4 * 7 + LETTER_INDEX.E : 2 * 7 + LETTER_INDEX.G;
  return {
    step: diatonicIndex - baseIndex,
    accidental,
  };
}

export function TheoryStaff({ notes, title = "오선지", clef = "TREBLE", compact = false, onNoteClick }: Props) {
  const noteCount = Math.max(1, notes.length);
  const reservedSlots = Math.max(BASE_RESERVED_SLOTS, noteCount);

  const contentWidth = compact ? 500 : 640;
  const viewHeight = compact ? 138 : 160;
  const baseTopLineY = compact ? 20 : 24;
  const lineGap = compact ? 8 : 9.8;
  const baseBottomLineY = baseTopLineY + lineGap * 4;

  const firstX = compact ? 56 : 68;
  const usableWidth = Math.max(240, contentWidth - firstX - 18);
  const slotGap = reservedSlots > 1 ? usableWidth / (reservedSlots - 1) : usableWidth;

  const usedSlots = Math.min(
    reservedSlots,
    noteCount <= reservedSlots ? Math.max(6, noteCount + (noteCount >= 6 ? 2 : 1)) : reservedSlots
  );
  const startSlot = (reservedSlots - usedSlots) / 2;
  const clickable = Boolean(onNoteClick);
  const metrics = notes.map((item) => staffStepByNote(item, clef));

  const safeTopY = compact ? 10 : 12;
  const safeBottomY = viewHeight - 50;
  let minShiftY = Number.NEGATIVE_INFINITY;
  let maxShiftY = Number.POSITIVE_INFINITY;
  for (const metric of metrics) {
    const baseY = baseBottomLineY - metric.step * (lineGap / 2);
    minShiftY = Math.max(minShiftY, safeTopY - baseY);
    maxShiftY = Math.min(maxShiftY, safeBottomY - baseY);
  }
  let staffShiftY = 0;
  if (Number.isFinite(minShiftY) && Number.isFinite(maxShiftY)) {
    if (minShiftY <= maxShiftY) {
      staffShiftY = Math.max(minShiftY, Math.min(0, maxShiftY));
    } else {
      staffShiftY = (minShiftY + maxShiftY) / 2;
    }
  }

  const topLineY = baseTopLineY + staffShiftY;
  const bottomLineY = topLineY + lineGap * 4;
  const noteYs = metrics.map((metric) => bottomLineY - metric.step * (lineGap / 2));
  const lowestNoteY = noteYs.length ? Math.max(...noteYs) : bottomLineY;
  const lowDepth = Math.max(0, lowestNoteY - bottomLineY);
  const labelOffset = lowDepth > lineGap ? 24 : 18;
  const labelAnchorY = Math.max(bottomLineY + 20, lowestNoteY + labelOffset);
  const noteLabelY = Math.min(viewHeight - 22, labelAnchorY);
  const degreeLabelY = Math.min(viewHeight - 8, noteLabelY + 13);

  return (
    <div className="mg-theory-staff-wrap">
      <div className="mg-theory-staff-title">{title}</div>
      <svg className="mg-theory-staff" viewBox={`0 0 ${contentWidth} ${viewHeight}`} role="img" aria-label={`${title} 음표`}>
        <rect x={0} y={0} width={contentWidth} height={viewHeight} rx={10} fill="rgba(255,255,255,0.7)" />

        {[0, 1, 2, 3, 4].map((i) => (
          <line
            key={`line-${i}`}
            x1={42}
            x2={contentWidth - 14}
            y1={topLineY + i * lineGap}
            y2={topLineY + i * lineGap}
            stroke="rgba(40, 52, 62, 0.36)"
            strokeWidth={1.2}
          />
        ))}

        <text x={27} y={topLineY + lineGap * 2.28} className="mg-theory-clef" textAnchor="middle">
          {clef === "TREBLE" ? "\uD834\uDD1E" : "\uD834\uDD22"}
        </text>

        {notes.map((item, idx) => {
          const progress = noteCount > 1 ? idx / (noteCount - 1) : 0.5;
          const slot = startSlot + progress * (usedSlots - 1);
          const x = firstX + slot * slotGap;

          const metric = metrics[idx] ?? staffStepByNote(item, clef);
          const y = noteYs[idx] ?? bottomLineY;
          const color = item.isRoot ? "#e67e22" : "#0f7f8f";

          const ledgerSteps: number[] = [];
          if (metric.step < 0) {
            for (let s = -2; s >= metric.step; s -= 2) ledgerSteps.push(s);
          } else if (metric.step > 8) {
            for (let s = 10; s <= metric.step; s += 2) ledgerSteps.push(s);
          }

          return (
            <g
              key={`${item.note}-${item.degree}-${idx}`}
              className={clickable ? "is-clickable" : ""}
              style={clickable ? { cursor: "pointer" } : undefined}
              onClick={() => onNoteClick?.(item, idx)}
            >
              {ledgerSteps.map((ledgerStep) => {
                const ledgerY = bottomLineY - ledgerStep * (lineGap / 2);
                return (
                  <line
                    key={`ledger-${idx}-${ledgerStep}`}
                    x1={x - 14}
                    x2={x + 14}
                    y1={ledgerY}
                    y2={ledgerY}
                    stroke="rgba(40, 52, 62, 0.46)"
                    strokeWidth={1.3}
                  />
                );
              })}

              {metric.accidental ? (
                <text x={x - 18} y={y + 5} className="mg-theory-accidental" textAnchor="middle">
                  {metric.accidental}
                </text>
              ) : null}

              <ellipse cx={x} cy={y} rx={10.4} ry={7.4} transform={`rotate(-22 ${x} ${y})`} fill={color} />
              <text x={x} y={noteLabelY} className="mg-theory-note-label" textAnchor="middle">
                {item.note}
              </text>
              <text x={x} y={degreeLabelY} className="mg-theory-degree-label" textAnchor="middle">
                {item.degree}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export type { TheoryStaffNote };
